import { execFileSync } from "node:child_process";
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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MISSING_VALUE_HASH,
  applyPatch,
  decodePatchInput,
  ensureBuildDependencies,
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
    schemaVersion: 1,
    revision: "",
    publicationId: null,
    games: {},
    notes: {},
    collections: {},
    collectionItems: {},
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
    schemaVersion: 1,
    baseRevision: database.revision,
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
  throw new Error(`${name} not found on PATH`);
}

function makeRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "mylib-publish-test-"));
  temporaryPaths.push(root);
  mkdirSync(path.join(root, "public", "data"), { recursive: true });
  writeFileSync(path.join(root, "public", "data", "library.json"), `${JSON.stringify(emptyDatabase(), null, 2)}\n`);
  writeFileSync(path.join(root, "package.json"), '{"private":true}\n');
  git(root, "init");
  git(root, "branch", "-M", "main");
  git(root, "config", "user.name", "CLI Test");
  git(root, "config", "user.email", "cli-test@example.invalid");
  git(root, "add", "--", ".");
  git(root, "commit", "-m", "Initial library");
  return root;
}

function nonInteractiveHooks(overrides = {}) {
  return {
    installDependencies: vi.fn(),
    validateAndBuild: vi.fn(),
    confirm: vi.fn(() => true),
    preview: vi.fn(),
    ...overrides,
  };
}

describe("publish patch payload", () => {
  it("accepts raw JSON and base64-encoded gzip", () => {
    const patch = createPatch();
    const json = JSON.stringify(patch);
    expect(decodePatchInput(json)).toEqual(patch);
    expect(decodePatchInput(gzipSync(json).toString("base64"))).toEqual(patch);
  });

  it("applies a guarded create and derives publication metadata", () => {
    const result = applyPatch(emptyDatabase(), createPatch());
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
      schemaVersion: 1,
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

  it("runs npm ci only when Vite is absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-dependencies-test-"));
    temporaryPaths.push(root);
    const commandRunner = vi.fn();
    expect(ensureBuildDependencies(root, commandRunner)).toBe(true);
    expect(commandRunner).toHaveBeenCalledWith(root, "npm", ["ci"]);

    mkdirSync(path.join(root, "node_modules", "vite"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "vite", "package.json"), "{}");
    commandRunner.mockClear();
    expect(ensureBuildDependencies(root, commandRunner)).toBe(false);
    expect(commandRunner).not.toHaveBeenCalled();
  });
});

describe("publish patch Git transaction", () => {
  it("rejects a dirty tracked tree before changing library data", () => {
    const root = makeRepository();
    const original = readFileSync(path.join(root, "public", "data", "library.json"), "utf8");
    writeFileSync(path.join(root, "package.json"), '{"private":true,"dirty":true}\n');

    expect(() => publishPatchInRepository(root, createPatch(), nonInteractiveHooks())).toThrow(/not clean/);
    expect(readFileSync(path.join(root, "public", "data", "library.json"), "utf8")).toBe(original);
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("rejects invalid input and a stale base without a commit", () => {
    const root = makeRepository();
    const originalHead = git(root, "rev-parse", "HEAD");
    expect(() => decodePatchInput("not-json-or-base64%%%"))
      .toThrow(/neither raw JSON nor canonical base64/);

    const stale = createPatch();
    stale.baseRevision = "f".repeat(64);
    expect(() => publishPatchInRepository(root, stale, nonInteractiveHooks())).toThrow(/Stale patch/);
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("restores library data and creates no commit when the build fails", () => {
    const root = makeRepository();
    const dataPath = path.join(root, "public", "data", "library.json");
    const original = readFileSync(dataPath, "utf8");
    const originalHead = git(root, "rev-parse", "HEAD");
    const hooks = nonInteractiveHooks({
      validateAndBuild: vi.fn(() => { throw new Error("intentional build failure"); }),
    });

    expect(() => publishPatchInRepository(root, createPatch(), hooks)).toThrow(/intentional build failure/);
    expect(readFileSync(dataPath, "utf8")).toBe(original);
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(hooks.confirm).not.toHaveBeenCalled();
    expect(hooks.preview).not.toHaveBeenCalled();
  });

  it("commits only library.json and never updates the origin remote", () => {
    const root = makeRepository();
    const remote = `${root}-origin.git`;
    temporaryPaths.push(remote);
    execFileSync("git", ["clone", "--bare", root, remote], { stdio: ["ignore", "pipe", "pipe"] });
    git(root, "remote", "add", "origin", remote);
    const remoteHeadBefore = git(remote, "rev-parse", "main");
    const hooks = nonInteractiveHooks();
    const shimDirectory = mkdtempSync(path.join(tmpdir(), "mylib-git-shim-"));
    temporaryPaths.push(shimDirectory);
    const gitLog = path.join(shimDirectory, "commands.log");
    const gitShim = path.join(shimDirectory, "git");
    writeFileSync(gitShim, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MYLIB_GIT_LOG"\nexec "$MYLIB_REAL_GIT" "$@"\n');
    chmodSync(gitShim, 0o755);
    const previousEnvironment = {
      path: process.env.PATH,
      log: process.env.MYLIB_GIT_LOG,
      git: process.env.MYLIB_REAL_GIT,
    };
    process.env.MYLIB_GIT_LOG = gitLog;
    process.env.MYLIB_REAL_GIT = findExecutable("git");
    process.env.PATH = `${shimDirectory}${path.delimiter}${process.env.PATH}`;
    let result;
    try {
      result = publishPatchInRepository(root, createPatch(), hooks);
    } finally {
      if (previousEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = previousEnvironment.path;
      if (previousEnvironment.log === undefined) delete process.env.MYLIB_GIT_LOG;
      else process.env.MYLIB_GIT_LOG = previousEnvironment.log;
      if (previousEnvironment.git === undefined) delete process.env.MYLIB_REAL_GIT;
      else process.env.MYLIB_REAL_GIT = previousEnvironment.git;
    }

    expect(result.committed).toBe(true);
    expect(git(root, "show", "-s", "--format=%s", "HEAD")).toBe("Update game library");
    expect(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"))
      .toBe("public/data/library.json");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(remote, "rev-parse", "main")).toBe(remoteHeadBefore);
    expect(git(root, "rev-parse", "HEAD")).not.toBe(remoteHeadBefore);
    expect(readFileSync(gitLog, "utf8").split("\n").filter(Boolean))
      .not.toContainEqual(expect.stringMatching(/^push(?:\s|$)/));
    expect(hooks.confirm).toHaveBeenCalledOnce();
    expect(hooks.preview).toHaveBeenCalledOnce();
  });
});
