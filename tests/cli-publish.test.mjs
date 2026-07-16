import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import {
  MISSING_VALUE_HASH,
  applyPatch,
  decodePatchInput,
  publishPatchInRepository,
  validatePatchEnvelope,
} from "../scripts/publish-patch.mjs";
import { computeRevision, hashCanonical, validateLibrary } from "../scripts/validate-data.mjs";

const GAME_ID = "00000000-0000-4000-8000-000000000001";
const TRANSACTION_ID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-07-16T06:00:00.000Z";
const temporaryPaths = [];

afterEach(() => {
  while (temporaryPaths.length > 0) rmSync(temporaryPaths.pop(), { recursive: true, force: true });
});

function emptyDatabase() {
  return {
    schemaVersion: 2,
    revision: "",
    publicationId: null,
    games: {},
    notes: {},
    assets: {},
  };
}

function game() {
  return {
    id: GAME_ID,
    title: "DuckTales",
    coverAssetId: null,
    platforms: ["NES"],
    tags: ["platformer"],
    status: "playing",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "Сложная, но честная игра.",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createPatch(database = emptyDatabase()) {
  return {
    patchVersion: 1,
    schemaVersion: 2,
    baseRevision: database.revision || computeRevision(database),
    operations: {
      [`/games/${GAME_ID}`]: {
        operation: "set",
        value: game(),
        baseExists: false,
        baseHash: MISSING_VALUE_HASH,
        changedAt: NOW,
        transactionId: TRANSACTION_ID,
      },
    },
  };
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const jjExecutable = findExecutable("jj");

function jj(root, ...args) {
  if (!jjExecutable) throw new Error("jj is not installed");
  return execFileSync(jjExecutable, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "mylib-publish-test-"));
  temporaryPaths.push(root);
  mkdirSync(path.join(root, "public", "data"), { recursive: true });
  writeFileSync(path.join(root, "public", "data", "library.json"), `${JSON.stringify(emptyDatabase(), null, 2)}\n`);
  writeFileSync(path.join(root, "package.json"), "{\"private\":true}\n");
  writeFileSync(path.join(root, "staged.txt"), "base\n");
  git(root, "init");
  git(root, "branch", "-M", "main");
  git(root, "config", "user.name", "CLI Test");
  git(root, "config", "user.email", "cli-test@example.invalid");
  git(root, "add", "--", ".");
  git(root, "commit", "-m", "Initial library");
  return root;
}

function makeJujutsuRepository() {
  const root = makeRepository();
  execFileSync(jjExecutable, ["git", "init", "--colocate", root], { stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

describe("publish patch payload", () => {
  it("accepts raw JSON and base64-encoded gzip", () => {
    const patch = createPatch();
    const json = JSON.stringify(patch);
    expect(decodePatchInput(json)).toEqual(patch);
    expect(decodePatchInput(gzipSync(json).toString("base64"))).toEqual(patch);
  });

  it("accepts the browser-computed revision of the pristine bootstrap database", () => {
    const database = emptyDatabase();
    const patch = createPatch(database);
    expect(database.revision).toBe("");
    expect(patch.baseRevision).toBe(computeRevision(database));

    const result = applyPatch(database, patch);
    expect(result.games[GAME_ID].title).toBe("DuckTales");
    expect(result.games[GAME_ID].updatedAt).toBe(NOW);
    expect(result.publicationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.revision).toBe(computeRevision(result));
    expect(() => validateLibrary(result)).not.toThrow();
  });

  it("rejects a stale value hash and unsafe or nested paths", () => {
    const database = emptyDatabase();
    database.games[GAME_ID] = game();
    database.publicationId = TRANSACTION_ID;
    database.revision = computeRevision(database);
    const patch = {
      patchVersion: 1,
      schemaVersion: 2,
      baseRevision: database.revision,
      operations: {
        [`/games/${GAME_ID}/title`]: {
          operation: "set",
          value: "Other",
          baseExists: true,
          baseHash: hashCanonical("wrong base"),
          changedAt: NOW,
          transactionId: TRANSACTION_ID,
        },
      },
    };
    expect(() => validatePatchEnvelope(patch, database)).toThrow(/base hash guard failed/);

    const [operation] = Object.values(patch.operations);
    patch.operations = { [`/games/${GAME_ID}/placement/tierId`]: operation };
    expect(() => validatePatchEnvelope(patch, database)).toThrow(/expected \/root\/id/);
  });

  it("rejects legacy collection paths and schema-1 payloads", () => {
    const database = emptyDatabase();
    const patch = createPatch(database);
    const [operation] = Object.values(patch.operations);
    patch.operations = { [`/collections/${GAME_ID}`]: operation };
    expect(() => validatePatchEnvelope(patch, database)).toThrow(/root is not patchable/);

    patch.operations = { [`/games/${GAME_ID}`]: operation };
    patch.schemaVersion = 1;
    expect(() => validatePatchEnvelope(patch, database)).toThrow(/schemaVersion is not compatible/);
    expect(() => validateLibrary({ ...database, schemaVersion: 1, collections: {}, collectionItems: {} })).toThrow(/schemaVersion.*must equal 2/);
  });
});

describe("publish patch transaction", () => {
  it("refuses to mix a patch with pre-existing library.json changes", () => {
    const root = makeRepository();
    const dataPath = path.join(root, "public", "data", "library.json");
    const originalHead = git(root, "rev-parse", "HEAD");
    writeFileSync(dataPath, `${readFileSync(dataPath, "utf8")} `);
    const dirtyData = readFileSync(dataPath, "utf8");

    expect(() => publishPatchInRepository(root, createPatch())).toThrow(/library\.json already has uncommitted changes/);
    expect(readFileSync(dataPath, "utf8")).toBe(dirtyData);
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
  });

  it("rejects invalid input and a stale base without creating a commit", () => {
    const root = makeRepository();
    const originalHead = git(root, "rev-parse", "HEAD");
    const original = readFileSync(path.join(root, "public", "data", "library.json"), "utf8");
    expect(() => decodePatchInput("not-json-or-base64%%%"))
      .toThrow(/neither raw JSON nor canonical base64/);

    const stale = createPatch();
    stale.baseRevision = "f".repeat(64);
    expect(() => publishPatchInRepository(root, stale)).toThrow(/Stale patch/);
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(readFileSync(path.join(root, "public", "data", "library.json"), "utf8")).toBe(original);
  });

  it("restores library.json when the commit itself fails", () => {
    const root = makeRepository();
    const dataPath = path.join(root, "public", "data", "library.json");
    const original = readFileSync(dataPath, "utf8");
    const originalHead = git(root, "rev-parse", "HEAD");
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    expect(() => publishPatchInRepository(root, createPatch())).toThrow(/git commit/);
    expect(readFileSync(dataPath, "utf8")).toBe(original);
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("creates a path-only Git commit on detached HEAD without repository side effects", () => {
    const root = makeRepository();
    const baseHead = git(root, "rev-parse", "HEAD");
    const remote = `${root}-origin.git`;
    temporaryPaths.push(remote);
    execFileSync("git", ["clone", "--bare", root, remote], { stdio: ["ignore", "pipe", "pipe"] });
    git(root, "remote", "add", "origin", remote);
    const remoteHeadBefore = git(remote, "rev-parse", "main");
    git(root, "checkout", "--detach", "HEAD");
    writeFileSync(path.join(root, "staged.txt"), "staged change\n");
    git(root, "add", "--", "staged.txt");
    writeFileSync(path.join(root, "package.json"), "{\"private\":true,\"local\":true}\n");

    const shimDirectory = mkdtempSync(path.join(tmpdir(), "mylib-command-shim-"));
    temporaryPaths.push(shimDirectory);
    const gitLog = path.join(shimDirectory, "git.log");
    const npmLog = path.join(shimDirectory, "npm.log");
    const gitShim = path.join(shimDirectory, "git");
    const npmShim = path.join(shimDirectory, "npm");
    writeFileSync(gitShim, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MYLIB_GIT_LOG"\nexec "$MYLIB_REAL_GIT" "$@"\n');
    writeFileSync(npmShim, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MYLIB_NPM_LOG"\nexit 99\n');
    chmodSync(gitShim, 0o755);
    chmodSync(npmShim, 0o755);
    const previousEnvironment = {
      path: process.env.PATH,
      gitLog: process.env.MYLIB_GIT_LOG,
      npmLog: process.env.MYLIB_NPM_LOG,
      git: process.env.MYLIB_REAL_GIT,
    };
    process.env.MYLIB_GIT_LOG = gitLog;
    process.env.MYLIB_NPM_LOG = npmLog;
    process.env.MYLIB_REAL_GIT = findExecutable("git");
    process.env.PATH = `${shimDirectory}${path.delimiter}${process.env.PATH}`;
    let result;
    try {
      result = publishPatchInRepository(root, createPatch());
    } finally {
      if (previousEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = previousEnvironment.path;
      if (previousEnvironment.gitLog === undefined) delete process.env.MYLIB_GIT_LOG;
      else process.env.MYLIB_GIT_LOG = previousEnvironment.gitLog;
      if (previousEnvironment.npmLog === undefined) delete process.env.MYLIB_NPM_LOG;
      else process.env.MYLIB_NPM_LOG = previousEnvironment.npmLog;
      if (previousEnvironment.git === undefined) delete process.env.MYLIB_REAL_GIT;
      else process.env.MYLIB_REAL_GIT = previousEnvironment.git;
    }

    expect(result.kind).toBe("git");
    expect(git(root, "show", "-s", "--format=%s", "HEAD")).toBe("Update game library");
    expect(git(root, "rev-parse", "HEAD^")).toBe(baseHead);
    expect(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"))
      .toBe("public/data/library.json");
    expect(spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root }).status).not.toBe(0);
    expect(git(root, "rev-parse", "main")).toBe(baseHead);
    expect(git(remote, "rev-parse", "main")).toBe(remoteHeadBefore);
    expect(git(root, "diff", "--cached", "--name-only")).toBe("staged.txt");
    expect(git(root, "diff", "--name-only")).toBe("package.json");
    expect(readFileSync(gitLog, "utf8").split("\n").filter(Boolean))
      .not.toContainEqual(expect.stringMatching(/^(?:symbolic-ref|remote|fetch|pull|merge|push)(?:\s|$)/));
    expect(existsSync(npmLog)).toBe(false);
  });

  it.skipIf(!jjExecutable)("creates an isolated Jujutsu commit while preserving the current change", () => {
    const root = makeJujutsuRepository();
    const mainBefore = jj(root, "log", "-r", "main", "--no-graph", "-T", "commit_id");
    jj(root, "describe", "-m", "Existing work");
    const workingChangeBefore = jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id");
    git(root, "checkout", "--detach", "HEAD");
    writeFileSync(path.join(root, "package.json"), "{\"private\":true,\"local\":true}\n");
    expect(spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root }).status).not.toBe(0);

    const result = publishPatchInRepository(root, createPatch());

    expect(result.kind).toBe("jj");
    expect(jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id")).toBe(workingChangeBefore);
    expect(jj(root, "log", "-r", "@", "--no-graph", "-T", "description.first_line()"))
      .toBe("Existing work");
    expect(jj(root, "diff", "--summary")).toBe("M package.json");
    expect(jj(root, "log", "-r", "@-", "--no-graph", "-T", "description.first_line()"))
      .toBe("Update game library");
    expect(jj(root, "diff", "-r", "@-", "--summary")).toBe("M public/data/library.json");
    expect(jj(root, "log", "-r", "main", "--no-graph", "-T", "commit_id")).toBe(mainBefore);
    expect(JSON.parse(readFileSync(path.join(root, "public", "data", "library.json"), "utf8")).games[GAME_ID].title)
      .toBe("DuckTales");
  });

  it.skipIf(!jjExecutable)("leaves an empty current Jujutsu change after publishing", () => {
    const root = makeJujutsuRepository();
    const workingChangeBefore = jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id");

    const result = publishPatchInRepository(root, createPatch());

    expect(result.kind).toBe("jj");
    expect(jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id")).toBe(workingChangeBefore);
    expect(jj(root, "diff", "--summary")).toBe("");
    expect(jj(root, "log", "-r", "@-", "--no-graph", "-T", "description.first_line()"))
      .toBe("Update game library");
    expect(jj(root, "diff", "-r", "@-", "--summary")).toBe("M public/data/library.json");
  });
});
