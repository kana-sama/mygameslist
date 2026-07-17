#!/usr/bin/env node

/**
 * Apply a browser-produced PatchEnvelopeV1/V2 and create a local commit.
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

import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  LIBRARY_SCHEMA_VERSION,
  assetStorageKind,
  computeRevision,
  externalAssetFilename,
  externalAssetPath,
  hashCanonical,
  isCanonicalBase64,
  isLegacyInlineImageAsset,
  validateLibrary,
} from "./validate-data.mjs";

export const MISSING_VALUE_HASH = "0".repeat(64);
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const ROOTS = new Set(["games", "notes", "assets"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FIELDS = {
  games: new Set(["title", "coverAssetId", "platforms", "tags", "status", "placement", "reviewMarkdown"]),
  notes: new Set(["bodyMarkdown", "attachments", "groupRank", "rank"]),
  assets: new Set(),
};
const GAME_FIELDS = ["title", "coverAssetId", "platforms", "tags", "status", "placement", "reviewMarkdown"];
const NOTE_FIELDS = ["bodyMarkdown", "attachments", "groupRank", "rank"];
const ASSET_FIELDS = ["kind", "mime", "width", "height", "byteLength", "alt", "originalName"];
const COMMIT_SECTION_LIMIT = 20;
const COMMIT_SUBJECT_LIMIT = 72;
const JJ_NO_AUTO_TRACK = ["--config", 'snapshot.auto-track="none()"'];
const FIELD_LABELS = {
  title: "title",
  coverAssetId: "cover",
  platforms: "platforms",
  tags: "tags",
  status: "status",
  placement: "tier position",
  reviewMarkdown: "review",
  bodyMarkdown: "text",
  attachments: "attachments",
  groupRank: "group",
  rank: "order",
  mime: "format",
  width: "width",
  height: "height",
  byteLength: "size",
  kind: "type",
  alt: "alt text",
  originalName: "file name",
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

/** Convert legacy inline image operations to the V2 payload model. */
export function normalizePatchEnvelope(patch) {
  if (!isPlainObject(patch)) throw new Error("Patch envelope must be an object");
  if (patch.patchVersion === 2) {
    exactKeys(patch, ["patchVersion", "schemaVersion", "baseRevision", "operations", "blobs"], "patch");
    return structuredClone(patch);
  }
  if (patch.patchVersion !== 1) throw new Error("patch.patchVersion must equal 1 or 2");
  exactKeys(patch, ["patchVersion", "schemaVersion", "baseRevision", "operations"], "patch");
  if (!isPlainObject(patch.operations)) throw new Error("patch.operations must be an object map");

  const normalized = {
    patchVersion: 2,
    schemaVersion: patch.schemaVersion,
    baseRevision: patch.baseRevision,
    operations: structuredClone(patch.operations),
    blobs: {},
  };
  for (const [pointer, operation] of Object.entries(normalized.operations)) {
    const tokens = parseOperationPath(pointer);
    if (tokens[0] !== "assets" || tokens.length !== 2 || operation?.operation !== "set") continue;
    if (operation.baseExists) {
      if (isLegacyInlineImageAsset(operation.value)) {
        throw new Error(`${pointer}: V1 can migrate only newly-created inline image assets`);
      }
      continue;
    }
    const asset = operation.value;
    if (!isLegacyInlineImageAsset(asset)) throw new Error(`${pointer}: V1 new assets must be inline WebP images`);
    exactKeys(asset, ["id", "mime", "width", "height", "base64", "alt", "originalName"], `${pointer}.value`);
    normalized.blobs[tokens[1]] = asset.base64;
    operation.value = {
      id: asset.id,
      kind: "image",
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      byteLength: typeof asset.base64 === "string" && isCanonicalBase64(asset.base64)
        ? Buffer.from(asset.base64, "base64").byteLength
        : -1,
      alt: asset.alt,
      originalName: asset.originalName,
    };
  }
  return normalized;
}

export function validatePatchEnvelope(patch, database) {
  const normalized = normalizePatchEnvelope(patch);
  if (normalized.schemaVersion !== LIBRARY_SCHEMA_VERSION || normalized.schemaVersion !== database.schemaVersion) {
    throw new Error("Patch schemaVersion is not compatible with the static database");
  }
  const expectedRevision = database.revision || computeRevision(database);
  if (typeof normalized.baseRevision !== "string" || normalized.baseRevision !== expectedRevision) {
    throw new Error(`Stale patch: base revision ${JSON.stringify(normalized.baseRevision)} does not match ${JSON.stringify(expectedRevision)}`);
  }
  if (!isPlainObject(normalized.operations)) throw new Error("patch.operations must be an object map");
  if (Object.keys(normalized.operations).length === 0) throw new Error("Patch contains no operations");
  if (Object.keys(normalized.operations).length > 100_000) throw new Error("Patch contains too many operations");
  if (!isPlainObject(normalized.blobs)) throw new Error("patch.blobs must be an object map");
  if (Object.keys(normalized.blobs).length > 100_000) throw new Error("Patch contains too many blobs");

  const blobBytes = new Map();
  for (const [id, base64] of Object.entries(normalized.blobs)) {
    if (!SHA256_RE.test(id)) throw new Error(`patch.blobs.${id}: key must be a lowercase SHA-256 hash`);
    if (!isCanonicalBase64(base64)) throw new Error(`patch.blobs.${id}: must be canonical base64`);
    const bytes = Buffer.from(base64, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== id) {
      throw new Error(`patch.blobs.${id}: SHA-256 does not match its map key`);
    }
    blobBytes.set(id, bytes);
  }

  const parsed = [];
  const newAssetIds = new Set();
  for (const [pointer, operation] of Object.entries(normalized.operations)) {
    const tokens = parseOperationPath(pointer);
    validateOperation(operation, pointer);
    if (tokens.length === 2 && tokens[0] !== "assets" && operation.operation === "set" && operation.baseExists) {
      throw new Error(`${pointer}: existing games and notes must use field operations`);
    }
    const current = readPath(database, tokens);
    if (current.exists !== operation.baseExists) throw new Error(`${pointer}: base existence guard failed`);
    const expectedHash = current.exists ? hashCanonical(current.value) : MISSING_VALUE_HASH;
    if (operation.baseHash.toLowerCase() !== expectedHash) throw new Error(`${pointer}: base hash guard failed`);
    parsed.push({ pointer, tokens, operation });

    if (tokens[0] === "assets" && tokens.length === 2 && operation.operation === "set") {
      const id = tokens[1];
      const asset = operation.value;
      if (operation.baseExists) throw new Error(`${pointer}: existing assets cannot be replaced`);
      if (isLegacyInlineImageAsset(asset)) throw new Error(`${pointer}: V2 assets must store bytes in patch.blobs`);
      if (!isPlainObject(asset) || asset.id !== id || !new Set(["image", "file"]).has(asset.kind)) {
        throw new Error(`${pointer}: asset metadata is invalid`);
      }
      exactKeys(
        asset,
        asset.kind === "image"
          ? ["id", "kind", "mime", "width", "height", "byteLength", "alt", "originalName"]
          : ["id", "kind", "mime", "byteLength", "originalName"],
        `${pointer}.value`,
      );
      const bytes = blobBytes.get(id);
      if (!bytes) throw new Error(`${pointer}: missing blob payload`);
      if (asset.byteLength !== bytes.byteLength) throw new Error(`${pointer}: blob byteLength does not match asset metadata`);
      if (asset.kind === "image" && !isWebP(bytes)) throw new Error(`${pointer}: image blob is not WebP`);
      newAssetIds.add(id);
    }
  }

  for (const id of blobBytes.keys()) {
    if (!newAssetIds.has(id)) throw new Error(`patch.blobs.${id}: orphan blob payload`);
  }

  const paths = new Set(parsed.map(({ pointer }) => pointer));
  for (const { pointer, tokens } of parsed) {
    if (tokens.length === 3 && paths.has(`/${escapePointer(tokens[0])}/${escapePointer(tokens[1])}`)) {
      throw new Error(`${pointer}: overlaps an entity-level operation`);
    }
  }
  Object.defineProperties(parsed, {
    normalizedPatch: { value: normalized },
    blobBytes: { value: blobBytes },
  });
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

function isWebP(bytes) {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  return hashCanonical(left) === hashCanonical(right);
}

function cleanLabel(value, fallback, limit = 80) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = normalized || fallback;
  const characters = Array.from(label);
  return characters.length <= limit
    ? label
    : `${characters.slice(0, Math.max(1, limit - 1)).join("").trimEnd()}…`;
}

function quotedLabel(value, fallback, limit) {
  return JSON.stringify(cleanLabel(value, fallback, limit));
}

function changedFields(before, after, fields) {
  return fields.filter((field) => !sameValue(before[field], after[field]));
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function collectEntityChanges(beforeMap, afterMap, fields) {
  const changes = [];
  const ids = [...new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)])].sort();
  for (const id of ids) {
    const before = beforeMap[id];
    const after = afterMap[id];
    if (!before) changes.push({ action: "add", id, after, fields });
    else if (!after) changes.push({ action: "remove", id, before, fields });
    else {
      const changed = changedFields(before, after, fields);
      if (changed.length > 0) changes.push({ action: "update", id, before, after, fields: changed });
    }
  }
  const actionOrder = { add: 0, update: 1, remove: 2 };
  return changes.sort((left, right) => actionOrder[left.action] - actionOrder[right.action] || compareText(left.id, right.id));
}

function tierLabel(tierId) {
  return tierId === "unranked" ? "unranked" : String(tierId).toUpperCase();
}

function gameFieldDetails(change) {
  return change.fields.map((field) => {
    if (field === "status") return `status ${change.before.status} -> ${change.after.status}`;
    if (field === "placement") {
      const before = change.before.placement;
      const after = change.after.placement;
      return before.tierId === after.tierId
        ? "tier-list order"
        : `tier ${tierLabel(before.tierId)} -> ${tierLabel(after.tierId)}`;
    }
    return FIELD_LABELS[field] ?? field;
  });
}

function gameChangeLine(change) {
  if (change.action === "add") return `- Add ${quotedLabel(change.after.title, "Untitled game")}`;
  if (change.action === "remove") return `- Remove ${quotedLabel(change.before.title, "Untitled game")}`;
  const beforeTitle = quotedLabel(change.before.title, "Untitled game");
  const afterTitle = quotedLabel(change.after.title, "Untitled game");
  const label = change.before.title === change.after.title ? afterTitle : `${beforeTitle} -> ${afterTitle}`;
  return `- Update ${label}: ${gameFieldDetails(change).join(", ")}`;
}

function noteGame(note, database) {
  return note ? database.games[note.gameId] : undefined;
}

function noteSnippet(note) {
  if (!note) return "";
  const snippet = cleanLabel(note.bodyMarkdown.slice(0, 512), "", 64);
  return snippet ? ` (${JSON.stringify(snippet)})` : "";
}

function noteChangeLine(change, before, after) {
  const note = change.after ?? change.before;
  const game = noteGame(change.after, after) ?? noteGame(change.before, before);
  const gameTitle = quotedLabel(game?.title, "Unknown game");
  if (change.action === "add") return `- Add note for ${gameTitle}${noteSnippet(note)}`;
  if (change.action === "remove") return `- Remove note from ${gameTitle}${noteSnippet(note)}`;
  const details = change.fields.map((field) => FIELD_LABELS[field] ?? field).join(", ");
  return `- Update note for ${gameTitle}${noteSnippet(note)}: ${details}`;
}

function decodedAssetBytes(asset) {
  return Number.isSafeInteger(asset?.byteLength) ? asset.byteLength : 0;
}

function formatByteCount(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

function assetChangeLine(change) {
  const asset = change.after ?? change.before;
  const image = assetStorageKind(asset) === "image";
  const name = quotedLabel(asset.originalName, image ? "Unnamed image" : "Unnamed file");
  const dimensions = image ? `${asset.width}×${asset.height}, ` : "";
  if (change.action === "add") return `- Add ${name} (${dimensions}${formatByteCount(decodedAssetBytes(asset))})`;
  if (change.action === "remove") return `- Remove ${name} (${dimensions}${formatByteCount(decodedAssetBytes(asset))})`;
  const details = change.fields.map((field) => FIELD_LABELS[field] ?? field).join(", ");
  return `- Update ${name}: ${details}`;
}

function limitSection(lines, entityName) {
  if (lines.length <= COMMIT_SECTION_LIMIT) return lines;
  const remaining = lines.length - COMMIT_SECTION_LIMIT;
  return [
    ...lines.slice(0, COMMIT_SECTION_LIMIT),
    `- ... ${remaining} more ${entityName} ${remaining === 1 ? "change" : "changes"}`,
  ];
}

function assetGameIndex(database) {
  const index = new Map();
  const add = (assetId, gameId) => {
    if (!assetId) return;
    if (!index.has(assetId)) index.set(assetId, new Set());
    index.get(assetId).add(gameId);
  };
  for (const game of Object.values(database.games)) add(game.coverAssetId, game.id);
  for (const note of Object.values(database.notes)) {
    for (const attachment of note.attachments) if (attachment.type === "image" || attachment.type === "file") add(attachment.assetId, note.gameId);
  }
  return index;
}

function affectedGames(before, after, gameChanges, noteChanges, assetChanges) {
  const ids = new Set(gameChanges.map((change) => change.id));
  const beforeAssets = assetGameIndex(before);
  const afterAssets = assetGameIndex(after);
  for (const change of noteChanges) {
    if (change.before) ids.add(change.before.gameId);
    if (change.after) ids.add(change.after.gameId);
  }
  for (const change of assetChanges) {
    for (const id of beforeAssets.get(change.id) ?? []) ids.add(id);
    for (const id of afterAssets.get(change.id) ?? []) ids.add(id);
  }
  return [...ids].map((id) => ({
    id,
    title: cleanLabel(after.games[id]?.title ?? before.games[id]?.title, "Untitled game", 48),
    action: gameChanges.find((change) => change.id === id)?.action ?? "update",
  })).sort((left, right) => compareText(left.title, right.title) || compareText(left.id, right.id));
}

function subjectWithGames(verb, games) {
  const suffixFor = (remaining) => remaining > 0 ? ` +${remaining} ${remaining === 1 ? "game" : "games"}` : "";
  const selected = [];
  for (let index = 0; index < games.length; index += 1) {
    const remaining = games.length - index - 1;
    const candidate = `${verb} ${[...selected, games[index].title].join(", ")}${suffixFor(remaining)}`;
    if (Array.from(candidate).length > COMMIT_SUBJECT_LIMIT) break;
    selected.push(games[index].title);
  }
  if (selected.length > 0) return `${verb} ${selected.join(", ")}${suffixFor(games.length - selected.length)}`;
  const suffix = suffixFor(games.length - 1);
  const available = COMMIT_SUBJECT_LIMIT - verb.length - suffix.length - 1;
  return `${verb} ${cleanLabel(games[0].title, "Untitled game", available)}${suffix}`;
}

/** Build a bounded semantic commit message without serializing full Markdown or image data. */
export function buildCommitMessage(before, after) {
  const gameChanges = collectEntityChanges(before.games, after.games, GAME_FIELDS);
  const noteChanges = collectEntityChanges(before.notes, after.notes, NOTE_FIELDS);
  const assetChanges = collectEntityChanges(before.assets, after.assets, ASSET_FIELDS);
  const games = affectedGames(before, after, gameChanges, noteChanges, assetChanges);
  let subject;
  if (games.length > 0) {
    const actions = new Set(games.map((game) => game.action));
    const verb = actions.size === 1 && actions.has("add") ? "Add" : actions.size === 1 && actions.has("remove") ? "Remove" : "Update";
    subject = subjectWithGames(verb, games);
  } else if (assetChanges.length > 0) {
    const actions = new Set(assetChanges.map((change) => change.action));
    const verb = actions.size === 1 && actions.has("add") ? "Add" : actions.size === 1 && actions.has("remove") ? "Remove" : "Update";
    const kinds = new Set(assetChanges.map((change) => assetStorageKind(change.after ?? change.before)));
    subject = `${verb} library ${kinds.size === 1 && kinds.has("image") ? "images" : kinds.size === 1 && kinds.has("file") ? "files" : "media"}`;
  } else {
    subject = "Update game library";
  }

  const sections = [];
  if (gameChanges.length > 0) sections.push(`Games:\n${limitSection(gameChanges.map(gameChangeLine), "game").join("\n")}`);
  if (noteChanges.length > 0) sections.push(`Notes:\n${limitSection(noteChanges.map((change) => noteChangeLine(change, before, after)), "note").join("\n")}`);
  const imageChanges = assetChanges.filter((change) => assetStorageKind(change.after ?? change.before) === "image");
  const fileChanges = assetChanges.filter((change) => assetStorageKind(change.after ?? change.before) === "file");
  if (imageChanges.length > 0) sections.push(`Images:\n${limitSection(imageChanges.map(assetChangeLine), "image").join("\n")}`);
  if (fileChanges.length > 0) sections.push(`Files:\n${limitSection(fileChanges.map(assetChangeLine), "file").join("\n")}`);
  if (sections.length === 0) sections.push("Library:\n- Refresh publication metadata");
  const body = sections.join("\n\n");
  return { subject, body, message: `${subject}\n\n${body}` };
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function preparePublishedAssets(database, blobBytes) {
  const next = structuredClone(database);
  const sources = new Map(blobBytes);

  for (const [id, bytes] of sources) {
    const asset = next.assets[id];
    if (!asset) throw new Error(`Blob ${id} does not belong to a published asset`);
    if (sha256(bytes) !== id) throw new Error(`Blob ${id} does not match its SHA-256 id`);
    if (asset.byteLength !== bytes.byteLength) throw new Error(`Blob ${id} byteLength does not match asset metadata`);
    if (assetStorageKind(asset) === "image" && !isWebP(bytes)) throw new Error(`Blob ${id} is not WebP`);
  }

  next.revision = "";
  next.revision = computeRevision(next);
  validateLibrary(next);
  return { database: next, sources };
}

function safeMediaRoot(root, create = false) {
  const publicRoot = path.join(root, "public");
  const publicStat = lstatSync(publicRoot);
  if (publicStat.isSymbolicLink() || !publicStat.isDirectory()) throw new Error("public must be a real directory, not a symlink");
  const mediaRoot = path.join(publicRoot, "media");
  if (!existsSync(mediaRoot)) {
    if (!create) return { mediaRoot, created: false, exists: false };
    mkdirSync(mediaRoot, { mode: 0o755 });
    return { mediaRoot, created: true, exists: true };
  }
  const mediaStat = lstatSync(mediaRoot);
  if (mediaStat.isSymbolicLink() || !mediaStat.isDirectory()) throw new Error("public/media must be a real directory, not a symlink");
  return { mediaRoot, created: false, exists: true };
}

function verifyMediaTarget(filePath, id, asset) {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${path.basename(filePath)} must be a regular media file, not a symlink`);
  if (stat.size !== asset.byteLength) throw new Error(`${path.basename(filePath)} size does not match library metadata`);
  const bytes = readFileSync(filePath);
  if (sha256(bytes) !== id) throw new Error(`${path.basename(filePath)} SHA-256 does not match its filename`);
  if (assetStorageKind(asset) === "image" && !isWebP(bytes)) throw new Error(`${path.basename(filePath)} is not WebP`);
}

function verifyPublishedMedia(root, database) {
  const external = Object.entries(database.assets);
  if (external.length === 0) return;
  const { mediaRoot, exists } = safeMediaRoot(root);
  if (!exists) throw new Error("public/media is missing for external library assets");
  for (const [id, asset] of external) {
    const filePath = externalAssetPath(mediaRoot, id, asset);
    if (!existsSync(filePath)) throw new Error(`${path.basename(filePath)} is missing`);
    verifyMediaTarget(filePath, id, asset);
  }
}

function prepareMediaWrites(root, database, sources) {
  const { mediaRoot, exists } = safeMediaRoot(root);
  const writes = [];
  const preexistingSourceFiles = [];
  const commitPaths = [];
  for (const [id, asset] of Object.entries(database.assets)) {
    const fileName = externalAssetFilename(id, asset);
    const filePath = externalAssetPath(mediaRoot, id, asset);
    const relativePath = path.posix.join("public", "media", fileName);
    const bytes = sources.get(id);
    if (exists && existsSync(filePath)) {
      verifyMediaTarget(filePath, id, asset);
      if (bytes) preexistingSourceFiles.push({ filePath, relativePath, bytes, id, asset });
    } else if (!bytes) {
      throw new Error(`${fileName} is missing and the patch contains no blob`);
    } else {
      writes.push({ filePath, relativePath, bytes });
    }
    if (bytes) commitPaths.push(relativePath);
  }
  return { writes, preexistingSourceFiles, commitPaths: [...new Set(commitPaths)].sort() };
}

function git(root, args, options = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: options.inherit ? "inherit" : "pipe" });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function run(root, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0 && !options.allowFailure) {
    const reason = result.error?.message ?? (result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`);
    throw new Error(`${command} ${args.join(" ")} failed: ${reason}`);
  }
  return result;
}

function captureJujutsuOperation(root) {
  const args = [
    ...JJ_NO_AUTO_TRACK,
    "op",
    "log",
    "--no-graph",
    "--limit",
    "1",
    "-T",
    'id ++ "\\n"',
  ];
  const result = spawnSync("jj", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `exit ${result.status ?? "unknown"}`;
    throw new Error(`jj ${args.join(" ")} failed: ${detail}`);
  }
  const operationId = result.stdout.trim();
  if (!/^[0-9a-f]{64,}$/.test(operationId)) throw new Error("jj op log returned an invalid operation id");
  return operationId;
}

function findRepositoryRoot() {
  const result = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

function assertLibraryFileClean(root, relativeDataPath) {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=no", "--", relativeDataPath]).stdout.trim();
  if (status) throw new Error(`${relativeDataPath} already has uncommitted changes`);
}

function assertLibraryPathSafe(root, relativeDataPath) {
  for (const relativeDirectory of ["public", path.join("public", "data")]) {
    const stat = lstatSync(path.join(root, relativeDirectory));
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${relativeDirectory} must be a real directory, not a symlink`);
  }
  const stat = lstatSync(path.join(root, relativeDataPath));
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${relativeDataPath} must be a regular file, not a symlink`);
}

function assertMediaPathsClean(root, relativePaths) {
  for (const relativePath of relativePaths) {
    const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all", "--", relativePath]).stdout.trim();
    if (status && !status.split("\n").every((line) => line.startsWith("?? "))) {
      throw new Error(`${relativePath} already has uncommitted changes`);
    }
  }
}

function repositoryKind(root) {
  return existsSync(path.join(root, ".jj")) ? "jj" : "git";
}

function commitLibraryUpdate(root, relativePaths, mediaPaths, kind, message, transaction) {
  if (kind === "jj") {
    transaction.jjMutationAttempted = true;
    if (mediaPaths.length > 0) run(root, "jj", [...JJ_NO_AUTO_TRACK, "file", "track", "--include-ignored", "--", ...mediaPaths]);
    run(root, "jj", [...JJ_NO_AUTO_TRACK, "split", "-A", "@-", "-m", message, "--", ...relativePaths]);
    return;
  }
  if (mediaPaths.length > 0) {
    transaction.gitStageAttempted = true;
    git(root, ["add", "-f", "--", ...mediaPaths]);
  }
  git(root, ["commit", "--only", "-m", message, "--", ...relativePaths], { inherit: true });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function collectRollbackFailure(failures, action, callback) {
  try {
    callback();
  } catch (error) {
    failures.push(`${action}: ${errorMessage(error)}`);
  }
}

function removeRollbackPath(filePath, failures, label) {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") failures.push(`${label}: ${errorMessage(error)}`);
  }
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
  assertLibraryPathSafe(root, relativeDataPath);
  assertLibraryFileClean(root, relativeDataPath);
  const original = readFileSync(dataPath, "utf8");
  const database = JSON.parse(original);
  validateLibrary(database);
  verifyPublishedMedia(root, database);
  const parsed = validatePatchEnvelope(patch, database);
  const semanticNext = applyPatch(database, parsed.normalizedPatch);
  const commit = buildCommitMessage(database, semanticNext);
  const { database: next, sources } = preparePublishedAssets(semanticNext, parsed.blobBytes);
  const media = prepareMediaWrites(root, next, sources);
  assertMediaPathsClean(root, media.commitPaths);
  const commitPaths = [relativeDataPath, ...media.commitPaths];
  const jujutsuOperation = kind === "jj" ? captureJujutsuOperation(root) : null;
  const operationCount = Object.keys(patch.operations).length;
  const tempPath = `${dataPath}.tmp-${process.pid}`;
  const mediaTempPaths = [];
  const createdMediaPaths = [];
  const transaction = { gitStageAttempted: false, jjMutationAttempted: false };
  let createdMediaRoot = false;
  let dataReplaced = false;

  try {
    if (media.writes.length > 0) {
      const mediaDirectory = safeMediaRoot(root, true);
      createdMediaRoot = mediaDirectory.created;
      for (const item of media.writes) {
        const tempMediaPath = path.join(mediaDirectory.mediaRoot, `.${path.basename(item.filePath)}.tmp-${process.pid}`);
        mediaTempPaths.push(tempMediaPath);
        writeFileSync(tempMediaPath, item.bytes, { mode: 0o644, flag: "wx" });
        linkSync(tempMediaPath, item.filePath);
        createdMediaPaths.push(item.filePath);
        unlinkSync(tempMediaPath);
      }
    }
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
    renameSync(tempPath, dataPath);
    dataReplaced = true;
    git(root, ["diff", "--check", "--", ...commitPaths]);
    commitLibraryUpdate(root, commitPaths, media.commitPaths, kind, commit.message, transaction);
  } catch (cause) {
    const rollbackFailures = [];
    if (kind === "git" && transaction.gitStageAttempted) {
      const result = git(root, ["restore", "--staged", "--", ...commitPaths], { allowFailure: true });
      if (result.status !== 0) {
        const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? "unknown"}`;
        rollbackFailures.push(`unstage publication paths: ${detail}`);
      }
    }
    removeRollbackPath(tempPath, rollbackFailures, `remove temporary ${relativeDataPath}`);
    for (const tempMediaPath of mediaTempPaths) {
      removeRollbackPath(tempMediaPath, rollbackFailures, `remove temporary ${path.relative(root, tempMediaPath)}`);
    }
    if (dataReplaced) {
      collectRollbackFailure(rollbackFailures, `restore ${relativeDataPath}`, () => {
        writeFileSync(tempPath, original, { encoding: "utf8", mode: 0o644, flag: "wx" });
        renameSync(tempPath, dataPath);
      });
      removeRollbackPath(tempPath, rollbackFailures, `remove rollback temporary ${relativeDataPath}`);
    }
    for (const filePath of createdMediaPaths) {
      removeRollbackPath(filePath, rollbackFailures, `remove created ${path.relative(root, filePath)}`);
    }
    if (createdMediaRoot) {
      collectRollbackFailure(rollbackFailures, "remove created public/media directory", () => rmdirSync(path.join(root, "public", "media")));
    }
    if (kind === "jj" && transaction.jjMutationAttempted) {
      collectRollbackFailure(rollbackFailures, `restore Jujutsu operation ${jujutsuOperation}`, () => {
        run(root, "jj", [...JJ_NO_AUTO_TRACK, "op", "restore", jujutsuOperation]);
      });
      for (const item of media.preexistingSourceFiles) {
        collectRollbackFailure(rollbackFailures, `restore pre-existing ${item.relativePath}`, () => {
          const { mediaRoot } = safeMediaRoot(root, true);
          const filePath = externalAssetPath(mediaRoot, item.id, item.asset);
          if (existsSync(filePath)) {
            verifyMediaTarget(filePath, item.id, item.asset);
          } else {
            writeFileSync(filePath, item.bytes, { mode: 0o644, flag: "wx" });
          }
        });
      }
    }
    if (rollbackFailures.length > 0) {
      throw new Error(`${errorMessage(cause)}\nRollback incomplete:\n${rollbackFailures.map((failure) => `- ${failure}`).join("\n")}`, { cause });
    }
    throw cause;
  }

  process.stdout.write(`Applied ${operationCount} operation${operationCount === 1 ? "" : "s"}; created ${kind === "jj" ? "Jujutsu" : "Git"} commit ‘${commit.subject}’.\n`);
  return { committed: true, kind, next, mediaPaths: media.commitPaths, commitMessage: commit.message };
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
