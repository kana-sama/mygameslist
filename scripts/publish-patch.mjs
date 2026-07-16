#!/usr/bin/env node

/**
 * Apply a browser-produced PatchEnvelopeV1 and create a local commit.
 *
 * The browser copies an inert base64(gzip(JSON)) payload. On macOS the stable
 * `npm run publish:clipboard` entrypoint reads it via `/usr/bin/pbpaste` and
 * passes the bytes to this module without placing the payload in the shell
 * command, argv, environment, or terminal input buffer.
 *
 * Raw JSON on stdin and a raw JSON/base64 file passed as `--file /path/to/file`
 * remain available for diagnostics and backup recovery. No payload field is
 * ever interpreted as a path, remote, branch, argument, or command. The script
 * only applies the patch and creates a local Git or Jujutsu commit; it never
 * updates branches, bookmarks, remotes, dependencies, builds, previews, or pushes.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { LIBRARY_SCHEMA_VERSION, computeRevision, hashCanonical, validateLibrary } from "./validate-data.mjs";

export const MISSING_VALUE_HASH = "0".repeat(64);
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const ROOTS = new Set(["games", "notes", "assets"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FIELDS = {
  games: new Set(["title", "coverAssetId", "platforms", "tags", "status", "placement", "reviewMarkdown"]),
  notes: new Set(["bodyMarkdown", "attachments", "rank"]),
  assets: new Set(),
};

export function decodePatchInput(input) {
  let source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (source.length > MAX_INPUT_BYTES) throw new Error("Patch input is larger than 16 MiB");
  let text = source.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Patch input is empty");

  if (!text.startsWith("{")) {
    const encoded = text.replace(/[\t\n\r ]/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("Patch is neither raw JSON nor canonical base64");
    }
    source = Buffer.from(encoded, "base64");
    if (source[0] === 0x1f && source[1] === 0x8b) source = gunzipSync(source, { maxOutputLength: MAX_INPUT_BYTES });
    text = source.toString("utf8").replace(/^\uFEFF/, "").trim();
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Patch payload is not valid JSON: ${cause.message}`);
  }
  return value;
}

export function validatePatchEnvelope(patch, database) {
  if (!isPlainObject(patch)) throw new Error("Patch envelope must be an object");
  exactKeys(patch, ["patchVersion", "schemaVersion", "baseRevision", "operations"], "patch");
  if (patch.patchVersion !== 1) throw new Error("patch.patchVersion must equal 1");
  if (patch.schemaVersion !== LIBRARY_SCHEMA_VERSION || patch.schemaVersion !== database.schemaVersion) {
    throw new Error("Patch schemaVersion is not compatible with the static database");
  }
  const expectedRevision = database.revision || computeRevision(database);
  if (typeof patch.baseRevision !== "string" || patch.baseRevision !== expectedRevision) {
    throw new Error(`Stale patch: base revision ${JSON.stringify(patch.baseRevision)} does not match ${JSON.stringify(expectedRevision)}`);
  }
  if (!isPlainObject(patch.operations)) throw new Error("patch.operations must be an object map");
  if (Object.keys(patch.operations).length === 0) throw new Error("Patch contains no operations");
  if (Object.keys(patch.operations).length > 100_000) throw new Error("Patch contains too many operations");

  const parsed = [];
  for (const [pointer, operation] of Object.entries(patch.operations)) {
    const tokens = parseOperationPath(pointer);
    validateOperation(operation, pointer);
    const current = readPath(database, tokens);
    if (current.exists !== operation.baseExists) throw new Error(`${pointer}: base existence guard failed`);
    const expectedHash = current.exists ? hashCanonical(current.value) : MISSING_VALUE_HASH;
    if (operation.baseHash.toLowerCase() !== expectedHash) throw new Error(`${pointer}: base hash guard failed`);
    parsed.push({ pointer, tokens, operation });
  }

  const paths = new Set(parsed.map(({ pointer }) => pointer));
  for (const { pointer, tokens } of parsed) {
    if (tokens.length === 3 && paths.has(`/${escapePointer(tokens[0])}/${escapePointer(tokens[1])}`)) {
      throw new Error(`${pointer}: overlaps an entity-level operation`);
    }
  }
  return parsed;
}

export function applyPatch(database, patch) {
  validateLibrary(database);
  const parsed = validatePatchEnvelope(patch, database);
  const next = structuredClone(database);
  const gameTimes = new Map();
  const noteTimes = new Map();
  const remember = (map, id, changedAt) => {
    if (!map.has(id) || map.get(id) < changedAt) map.set(id, changedAt);
  };

  for (const { tokens, operation } of parsed.sort((left, right) => left.pointer.localeCompare(right.pointer))) {
    const [root, id, field] = tokens;
    if (field === undefined) {
      if (operation.operation === "delete") delete next[root][id];
      else next[root][id] = structuredClone(operation.value);
    } else {
      if (!Object.hasOwn(next[root], id) || !isPlainObject(next[root][id])) {
        throw new Error(`/${root}/${id}/${field}: parent entity does not exist`);
      }
      if (operation.operation === "delete") delete next[root][id][field];
      else next[root][id][field] = structuredClone(operation.value);
    }
    if (root === "games") remember(gameTimes, id, operation.changedAt);
    if (root === "notes") {
      remember(noteTimes, id, operation.changedAt);
      const note = next.notes[id] ?? database.notes[id];
      if (note) remember(gameTimes, note.gameId, operation.changedAt);
    }
  }

  for (const [id, changedAt] of gameTimes) if (next.games[id]) next.games[id].updatedAt = changedAt;
  for (const [id, changedAt] of noteTimes) if (next.notes[id]) next.notes[id].updatedAt = changedAt;
  next.publicationId = randomUUID();
  next.revision = "";
  next.revision = computeRevision(next);
  validateLibrary(next);
  return next;
}

function parseOperationPath(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.includes("\u0000")) {
    throw new Error(`${pointer}: operation path must be a JSON Pointer`);
  }
  const rawTokens = pointer.slice(1).split("/");
  if (rawTokens.length < 2 || rawTokens.length > 3 || rawTokens.some((token) => /~(?:[^01]|$)/.test(token))) {
    throw new Error(`${pointer}: expected /root/id or /root/id/field`);
  }
  const tokens = rawTokens.map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (tokens.some((token) => token === "" || PROTOTYPE_KEYS.has(token))) throw new Error(`${pointer}: contains an unsafe path token`);
  const [root, id, field] = tokens;
  if (!ROOTS.has(root)) throw new Error(`${pointer}: root is not patchable`);
  if (root === "assets" ? !SHA256_RE.test(id) : !UUID_RE.test(id)) throw new Error(`${pointer}: entity id is invalid`);
  if (field !== undefined && !FIELDS[root].has(field)) throw new Error(`${pointer}: field is not patchable`);
  return tokens;
}

function validateOperation(operation, pointer) {
  if (!isPlainObject(operation)) throw new Error(`${pointer}: operation must be an object`);
  const common = ["operation", "baseExists", "baseHash", "changedAt", "transactionId"];
  exactKeys(operation, operation.operation === "set" ? [...common, "value"] : common, pointer);
  if (operation.operation !== "set" && operation.operation !== "delete") throw new Error(`${pointer}: unsupported operation`);
  if (typeof operation.baseExists !== "boolean") throw new Error(`${pointer}: baseExists must be boolean`);
  if (typeof operation.baseHash !== "string" || !SHA256_RE.test(operation.baseHash)) {
    throw new Error(`${pointer}: baseHash must be a SHA-256 hash`);
  }
  if (!operation.baseExists && operation.baseHash !== MISSING_VALUE_HASH) {
    throw new Error(`${pointer}: a missing base must use the zero hash`);
  }
  if (typeof operation.changedAt !== "string" || !ISO_DATE_RE.test(operation.changedAt) || Number.isNaN(Date.parse(operation.changedAt))) {
    throw new Error(`${pointer}: changedAt must be an ISO-8601 UTC timestamp`);
  }
  if (typeof operation.transactionId !== "string" || operation.transactionId.trim() === "" || operation.transactionId.length > 200) {
    throw new Error(`${pointer}: transactionId must be a short non-empty string`);
  }
  if (operation.operation === "set" && operation.value === undefined) throw new Error(`${pointer}: set requires value`);
}

function readPath(database, tokens) {
  let value = database;
  for (const token of tokens) {
    if (!isPlainObject(value) || !Object.hasOwn(value, token)) return { exists: false, value: undefined };
    value = value[token];
  }
  return { exists: true, value };
}

function escapePointer(token) {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function exactKeys(value, expected, at) {
  const wanted = new Set(expected);
  for (const key of Object.keys(value)) if (!wanted.has(key)) throw new Error(`${at}: unknown field ${key}`);
  for (const key of wanted) if (!Object.hasOwn(value, key)) throw new Error(`${at}: missing field ${key}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function git(root, args, options = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: options.inherit ? "inherit" : "pipe" });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function run(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    const reason = result.error?.message ?? (result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`);
    throw new Error(`${command} ${args.join(" ")} failed: ${reason}`);
  }
}

function findRepositoryRoot() {
  const result = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

function assertLibraryFileClean(root, relativeDataPath) {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=no", "--", relativeDataPath]).stdout.trim();
  if (status) throw new Error(`${relativeDataPath} already has uncommitted changes`);
}

function repositoryKind(root) {
  return existsSync(path.join(root, ".jj")) ? "jj" : "git";
}

function commitLibraryUpdate(root, relativeDataPath, kind) {
  if (kind === "jj") {
    run(root, "jj", ["split", "-A", "@-", "-m", "Update game library", "--", relativeDataPath]);
    return;
  }
  git(root, ["commit", "--only", "-m", "Update game library", "--", relativeDataPath], { inherit: true });
}

async function readPayloadArgument(args) {
  if (args.length === 0) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  if (args.length === 2 && args[0] === "--file") return readFile(path.resolve(args[1]));
  throw new Error("Usage: node scripts/publish-patch.mjs [--file PATCH_FILE]");
}

/**
 * Applies a patch and creates one path-isolated local commit. Repository
 * synchronization, branch/bookmark movement, builds, previews, and pushes are
 * deliberately outside this function.
 */
export function publishPatchInRepository(root, patch) {
  const relativeDataPath = "public/data/library.json";
  const dataPath = path.join(root, relativeDataPath);
  const kind = repositoryKind(root);
  assertLibraryFileClean(root, relativeDataPath);
  const original = readFileSync(dataPath, "utf8");
  const database = JSON.parse(original);
  validateLibrary(database);
  const next = applyPatch(database, patch);
  const operationCount = Object.keys(patch.operations).length;
  const tempPath = `${dataPath}.tmp-${process.pid}`;
  let committed = false;

  try {
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
    renameSync(tempPath, dataPath);
    git(root, ["diff", "--check", "--", relativeDataPath]);
    commitLibraryUpdate(root, relativeDataPath, kind);
    committed = true;
  } finally {
    if (!committed) {
      try { unlinkSync(tempPath); } catch {}
      writeFileSync(dataPath, original, "utf8");
      if (kind === "git") git(root, ["restore", "--staged", "--", relativeDataPath], { allowFailure: true });
    }
  }

  process.stdout.write(`Applied ${operationCount} operation${operationCount === 1 ? "" : "s"}; created ${kind === "jj" ? "Jujutsu" : "Git"} commit ‘Update game library’.\n`);
  return { committed: true, kind, next };
}

export function publishPatchInput(payloadInput) {
  const patch = decodePatchInput(payloadInput);
  const root = findRepositoryRoot();
  return publishPatchInRepository(root, patch);
}

async function main() {
  publishPatchInput(await readPayloadArgument(process.argv.slice(2)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
