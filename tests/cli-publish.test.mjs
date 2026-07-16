import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import {
  MISSING_VALUE_HASH,
  applyPatch,
  buildCommitMessage,
  decodePatchInput,
  publishPatchInRepository,
  validatePatchEnvelope,
} from "../scripts/publish-patch.mjs";
import { computeRevision, hashCanonical, validateLibrary } from "../scripts/validate-data.mjs";

const GAME_ID = "00000000-0000-4000-8000-000000000001";
const TRANSACTION_ID = "00000000-0000-4000-8000-000000000002";
const CELESTE_ID = "00000000-0000-4000-8000-000000000003";
const CONTRA_ID = "00000000-0000-4000-8000-000000000004";
const CELESTE_NOTE_ID = "00000000-0000-4000-8000-000000000005";
const CONTRA_NOTE_ID = "00000000-0000-4000-8000-000000000006";
const DUCKTALES_NOTE_ID = "00000000-0000-4000-8000-000000000007";
const NOW = "2026-07-16T06:00:00.000Z";
const temporaryPaths = [];
const CREATE_GAME_MESSAGE = `Add DuckTales

Games:
- Add "DuckTales"`;

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

function game(overrides = {}) {
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
    ...overrides,
  };
}

function note(id, gameId, bodyMarkdown, overrides = {}) {
  return {
    id,
    gameId,
    bodyMarkdown,
    attachments: [],
    rank: 1024,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function asset(id, originalName, overrides = {}) {
  return {
    id,
    kind: "image",
    mime: "image/webp",
    width: 1,
    height: 1,
    byteLength: 12,
    alt: "",
    originalName,
    ...overrides,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function webpBytes(label = "fixture") {
  return Buffer.from(`RIFFxxxxWEBP${label}`);
}

function imageAsset(bytes, originalName = "cover.png") {
  return {
    id: sha256(bytes),
    kind: "image",
    mime: "image/webp",
    width: 1,
    height: 1,
    byteLength: bytes.byteLength,
    alt: "",
    originalName,
  };
}

function fileAsset(bytes, originalName = "route.txt") {
  return {
    id: sha256(bytes),
    kind: "file",
    mime: "text/plain",
    byteLength: bytes.byteLength,
    originalName,
  };
}

function setOperation(value) {
  return {
    operation: "set",
    value,
    baseExists: false,
    baseHash: MISSING_VALUE_HASH,
    changedAt: NOW,
    transactionId: TRANSACTION_ID,
  };
}

function createMediaPatch(bytes, metadata, database = emptyDatabase()) {
  const noteValue = note(DUCKTALES_NOTE_ID, GAME_ID, "Route", {
    attachments: metadata.kind === "file"
      ? [{ type: "file", assetId: metadata.id, label: metadata.originalName }]
      : [{ type: "image", assetId: metadata.id, alt: "Route" }],
  });
  return {
    patchVersion: 2,
    schemaVersion: 2,
    baseRevision: database.revision || computeRevision(database),
    operations: {
      [`/assets/${metadata.id}`]: setOperation(metadata),
      [`/games/${GAME_ID}`]: setOperation(game({ coverAssetId: metadata.kind === "image" ? metadata.id : null })),
      [`/notes/${DUCKTALES_NOTE_ID}`]: setOperation(noteValue),
    },
    blobs: { [metadata.id]: bytes.toString("base64") },
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

function makeRepository(database = emptyDatabase()) {
  const root = mkdtempSync(path.join(tmpdir(), "mylib-publish-test-"));
  temporaryPaths.push(root);
  mkdirSync(path.join(root, "public", "data"), { recursive: true });
  writeFileSync(path.join(root, "public", "data", "library.json"), `${JSON.stringify(database, null, 2)}\n`);
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

function makeJujutsuRepository(database = emptyDatabase()) {
  const root = makeRepository(database);
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
    expect(buildCommitMessage(database, result)).toEqual({
      subject: "Add DuckTales",
      body: `Games:\n- Add "DuckTales"`,
      message: CREATE_GAME_MESSAGE,
    });
  });

  it("builds a dynamic subject and a semantic body without embedding image data", () => {
    const celesteAssetId = "a".repeat(64);
    const contraAssetId = "b".repeat(64);
    const ducktalesAssetId = "c".repeat(64);
    const before = emptyDatabase();
    before.games[CELESTE_ID] = game({
      id: CELESTE_ID,
      title: "Celeste",
      coverAssetId: celesteAssetId,
      tags: ["platformer"],
      placement: { tierId: "b", rank: 1024 },
    });
    before.games[CONTRA_ID] = game({ id: CONTRA_ID, title: "Contra", coverAssetId: contraAssetId });
    before.notes[CELESTE_NOTE_ID] = note(CELESTE_NOTE_ID, CELESTE_ID, "Climb carefully");
    before.notes[CONTRA_NOTE_ID] = note(CONTRA_NOTE_ID, CONTRA_ID, "Secret path");
    before.assets[celesteAssetId] = asset(celesteAssetId, "celeste.webp", { alt: "Celeste cover" });
    before.assets[contraAssetId] = asset(contraAssetId, "contra.webp");

    const after = structuredClone(before);
    after.games[CELESTE_ID] = {
      ...after.games[CELESTE_ID],
      title: "Celeste Classic",
      tags: ["platformer", "precision"],
      status: "completed",
      placement: { tierId: "a", rank: 1024 },
    };
    delete after.games[CONTRA_ID];
    after.games[GAME_ID] = game({ coverAssetId: ducktalesAssetId });
    after.notes[CELESTE_NOTE_ID] = {
      ...after.notes[CELESTE_NOTE_ID],
      bodyMarkdown: "Take the hidden route",
      attachments: [{ type: "link", url: "https://example.com/route", label: "Route" }],
    };
    delete after.notes[CONTRA_NOTE_ID];
    after.notes[DUCKTALES_NOTE_ID] = note(DUCKTALES_NOTE_ID, GAME_ID, "Boss route");
    after.assets[celesteAssetId] = { ...after.assets[celesteAssetId], alt: "Celeste Classic cover" };
    delete after.assets[contraAssetId];
    after.assets[ducktalesAssetId] = asset(ducktalesAssetId, "ducktales.webp");

    const result = buildCommitMessage(before, after);
    expect(result).toEqual({
      subject: "Update Celeste Classic, Contra, DuckTales",
      body: `Games:
- Add "DuckTales"
- Update "Celeste" -> "Celeste Classic": title, tags, status playing -> completed, tier B -> A
- Remove "Contra"

Notes:
- Add note for "DuckTales" ("Boss route")
- Update note for "Celeste Classic" ("Take the hidden route"): text, attachments
- Remove note from "Contra" ("Secret path")

Images:
- Add "ducktales.webp" (1×1, 12 B)
- Update "celeste.webp": alt text
- Remove "contra.webp" (1×1, 12 B)`,
      message: `Update Celeste Classic, Contra, DuckTales

Games:
- Add "DuckTales"
- Update "Celeste" -> "Celeste Classic": title, tags, status playing -> completed, tier B -> A
- Remove "Contra"

Notes:
- Add note for "DuckTales" ("Boss route")
- Update note for "Celeste Classic" ("Take the hidden route"): text, attachments
- Remove note from "Contra" ("Secret path")

Images:
- Add "ducktales.webp" (1×1, 12 B)
- Update "celeste.webp": alt text
- Remove "contra.webp" (1×1, 12 B)`,
    });
    expect(after.assets[ducktalesAssetId]).not.toHaveProperty("base64");
  });

  it("bounds and sanitizes commit messages for large patches", () => {
    const before = emptyDatabase();
    const after = emptyDatabase();
    for (let index = 0; index < 25; index += 1) {
      const id = `game-${String(index).padStart(2, "0")}`;
      after.games[id] = game({
        id,
        title: `Game ${index} with a deliberately long title\nthat cannot inject a commit paragraph`,
      });
    }

    const result = buildCommitMessage(before, after);
    expect(Array.from(result.subject)).toHaveLength(result.subject.length);
    expect(Array.from(result.subject).length).toBeLessThanOrEqual(72);
    expect(result.subject).not.toMatch(/[\r\n]/);
    expect(result.subject).toMatch(/\+\d+ games$/);
    expect(result.body.match(/^- Add /gm)).toHaveLength(20);
    expect(result.body).toContain("- ... 5 more game changes");
    expect(result.message.length).toBeLessThan(10_000);

    const unicodeAfter = emptyDatabase();
    unicodeAfter.games[GAME_ID] = game({ title: "🎮".repeat(100) });
    const unicode = buildCommitMessage(emptyDatabase(), unicodeAfter);
    expect(Array.from(unicode.subject).length).toBeLessThanOrEqual(72);
    expect(unicode.subject).not.toContain("�");
  });

  it("bounds note details and prevents Markdown from injecting commit paragraphs", () => {
    const before = emptyDatabase();
    before.games[GAME_ID] = game();
    const after = structuredClone(before);
    for (let index = 0; index < 25; index += 1) {
      const id = `note-${String(index).padStart(2, "0")}`;
      after.notes[id] = note(id, GAME_ID, `Route ${index}\nInjected paragraph ${"x".repeat(2_000)}`);
    }

    const result = buildCommitMessage(before, after);
    expect(result.subject).toBe("Update DuckTales");
    expect(result.body.match(/^- Add note /gm)).toHaveLength(20);
    expect(result.body).toContain("- ... 5 more note changes");
    expect(result.body).not.toContain("\nInjected paragraph");
    expect(result.message.length).toBeLessThan(10_000);
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

    patch.operations = {
      [`/games/${GAME_ID}`]: {
        ...operation,
        value: { ...game(), title: "Replacement" },
        baseHash: hashCanonical(game()),
      },
    };
    expect(() => validatePatchEnvelope(patch, database)).toThrow(/existing games and notes must use field operations/);
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

  it("accepts V2 blobs and migrates V1 inline image operations", () => {
    const bytes = webpBytes("v1-migration");
    const metadata = imageAsset(bytes);
    const v2 = createMediaPatch(bytes, metadata);
    expect(() => validatePatchEnvelope(v2, emptyDatabase())).not.toThrow();

    const legacy = {
      ...v2,
      patchVersion: 1,
      operations: structuredClone(v2.operations),
    };
    delete legacy.blobs;
    legacy.operations[`/assets/${metadata.id}`].value = {
      id: metadata.id,
      mime: "image/webp",
      width: 1,
      height: 1,
      base64: bytes.toString("base64"),
      alt: "",
      originalName: "cover.png",
    };
    const result = applyPatch(emptyDatabase(), legacy);
    expect(result.assets[metadata.id]).toEqual(metadata);
    expect(result.notes[DUCKTALES_NOTE_ID].attachments[0].type).toBe("image");
  });

  it("rejects missing, orphaned, noncanonical, mismatched, and wrongly-sized blobs", () => {
    const bytes = Buffer.from("file fixture");
    const metadata = fileAsset(bytes);
    const original = createMediaPatch(bytes, metadata);

    const missing = structuredClone(original);
    missing.blobs = {};
    expect(() => validatePatchEnvelope(missing, emptyDatabase())).toThrow(/missing blob payload/);

    const orphan = structuredClone(original);
    const orphanBytes = Buffer.from("orphan");
    orphan.blobs[sha256(orphanBytes)] = orphanBytes.toString("base64");
    expect(() => validatePatchEnvelope(orphan, emptyDatabase())).toThrow(/orphan blob payload/);

    const noncanonical = structuredClone(original);
    noncanonical.blobs[metadata.id] = `${bytes.toString("base64").slice(0, -2)}==`;
    expect(() => validatePatchEnvelope(noncanonical, emptyDatabase())).toThrow(/canonical base64|SHA-256/);

    const wrongHash = structuredClone(original);
    wrongHash.blobs[metadata.id] = Buffer.from("different bytes").toString("base64");
    expect(() => validatePatchEnvelope(wrongHash, emptyDatabase())).toThrow(/SHA-256/);

    const wrongSize = structuredClone(original);
    wrongSize.operations[`/assets/${metadata.id}`].value.byteLength += 1;
    expect(() => validatePatchEnvelope(wrongSize, emptyDatabase())).toThrow(/byteLength/);
  });

  it("rejects replacement of an existing deduplicated asset but still permits deletion", () => {
    const bytes = Buffer.from("existing asset");
    const metadata = fileAsset(bytes, "original.txt");
    const database = emptyDatabase();
    database.assets[metadata.id] = metadata;
    database.revision = computeRevision(database);
    const common = {
      baseExists: true,
      baseHash: hashCanonical(metadata),
      changedAt: NOW,
      transactionId: TRANSACTION_ID,
    };
    const replacement = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: database.revision,
      operations: {
        [`/assets/${metadata.id}`]: {
          operation: "set",
          value: { ...metadata, originalName: "replacement.txt" },
          ...common,
        },
      },
      blobs: {},
    };
    expect(() => validatePatchEnvelope(replacement, database)).toThrow(/existing assets cannot be replaced/);

    const deletion = structuredClone(replacement);
    deletion.operations[`/assets/${metadata.id}`] = { operation: "delete", ...common };
    expect(() => validatePatchEnvelope(deletion, database)).not.toThrow();
  });

  it("never derives external media paths from invalid asset ids", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-validator-path-test-"));
    temporaryPaths.push(root);
    const mediaRoot = path.join(root, "media");
    mkdirSync(mediaRoot);
    const outsideBytes = Buffer.from("outside media");
    writeFileSync(path.join(root, "outside.bin"), outsideBytes);
    const unsafeId = "../outside";
    const database = emptyDatabase();
    database.assets[unsafeId] = {
      id: unsafeId,
      kind: "file",
      mime: "application/octet-stream",
      byteLength: outsideBytes.byteLength,
      originalName: "outside.bin",
    };
    database.revision = computeRevision(database);

    let failure;
    try {
      validateLibrary(database, { mediaRoot });
    } catch (cause) {
      failure = cause;
    }
    expect(failure?.errors).toHaveLength(1);
    expect(failure.errors[0]).toMatch(/must equal its lowercase SHA-256 map key/);
    expect(failure.errors[0]).not.toMatch(/media file|media directory|SHA-256$/);
  });

  it("does not traverse a media-root symlink after rejecting it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-validator-symlink-test-"));
    temporaryPaths.push(root);
    const targetRoot = path.join(root, "outside");
    const mediaRoot = path.join(root, "media");
    mkdirSync(targetRoot);
    const expected = Buffer.from("expected bytes");
    const metadata = fileAsset(expected, "save.bin");
    writeFileSync(path.join(targetRoot, `${metadata.id}.bin`), Buffer.from("tampered bytes"));
    symlinkSync(targetRoot, mediaRoot, "dir");
    const database = emptyDatabase();
    database.assets[metadata.id] = metadata;
    database.revision = computeRevision(database);

    let failure;
    try {
      validateLibrary(database, { mediaRoot });
    } catch (cause) {
      failure = cause;
    }
    expect(failure?.errors).toEqual(["$.assets: media root must be a real directory, not a symlink"]);
  });

  it("does not traverse a symlinked media ancestor", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-validator-ancestor-test-"));
    temporaryPaths.push(root);
    const outsidePublic = path.join(root, "outside-public");
    const outsideMedia = path.join(outsidePublic, "media");
    mkdirSync(outsideMedia, { recursive: true });
    const expected = Buffer.from("expected ancestor bytes");
    const metadata = fileAsset(expected, "save.bin");
    writeFileSync(path.join(outsideMedia, `${metadata.id}.bin`), Buffer.from("tampered ancestor bytes"));
    const publicLink = path.join(root, "public");
    symlinkSync(outsidePublic, publicLink, "dir");
    const database = emptyDatabase();
    database.assets[metadata.id] = metadata;
    database.revision = computeRevision(database);

    let failure;
    try {
      validateLibrary(database, { mediaRoot: path.join(publicLink, "media") });
    } catch (cause) {
      failure = cause;
    }
    expect(failure?.errors).toHaveLength(1);
    expect(failure.errors[0]).toMatch(/media ancestor must be a real directory, not a symlink/);
  });

  it("checks external media size before reading or hashing the file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-validator-size-test-"));
    temporaryPaths.push(root);
    const mediaRoot = path.join(root, "public", "media");
    mkdirSync(mediaRoot, { recursive: true });
    const expected = Buffer.from("declared bytes");
    const metadata = fileAsset(expected, "save.bin");
    const filePath = path.join(mediaRoot, `${metadata.id}.bin`);
    writeFileSync(filePath, Buffer.from("different-size bytes"));
    chmodSync(filePath, 0o000);
    const database = emptyDatabase();
    database.assets[metadata.id] = metadata;
    database.revision = computeRevision(database);

    let failure;
    try {
      validateLibrary(database, { mediaRoot });
    } catch (cause) {
      failure = cause;
    } finally {
      chmodSync(filePath, 0o644);
    }
    expect(failure?.errors).toHaveLength(1);
    expect(failure.errors[0]).toMatch(/byteLength: does not match the media file size/);
  });
});

describe("publish patch transaction", () => {
  it("materializes a V2 file blob and commits exactly JSON plus the derived media path", () => {
    const root = makeRepository();
    const bytes = Buffer.from("DuckTales route notes\n");
    const metadata = fileAsset(bytes, "route notes.txt");
    const result = publishPatchInRepository(root, createMediaPatch(bytes, metadata));
    const relativeMediaPath = `public/media/${metadata.id}.bin`;
    const published = JSON.parse(readFileSync(path.join(root, "public", "data", "library.json"), "utf8"));

    expect(result.mediaPaths).toEqual([relativeMediaPath]);
    expect(published.assets[metadata.id]).toEqual(metadata);
    expect(readFileSync(path.join(root, relativeMediaPath))).toEqual(bytes);
    expect(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort())
      .toEqual(["public/data/library.json", relativeMediaPath].sort());
    expect(git(root, "show", "-s", "--format=%B", "HEAD")).toContain(`Files:\n- Add "route notes.txt"`);
    expect(() => validateLibrary(published, { mediaRoot: path.join(root, "public", "media") })).not.toThrow();
  });

  it("publishes a V1 inline new image as V2 metadata plus a derived WebP file", () => {
    const root = makeRepository();
    const bytes = webpBytes("new-v1-image");
    const metadata = imageAsset(bytes);
    const patch = createMediaPatch(bytes, metadata);
    patch.patchVersion = 1;
    delete patch.blobs;
    patch.operations[`/assets/${metadata.id}`].value = {
      id: metadata.id,
      mime: "image/webp",
      width: 1,
      height: 1,
      base64: bytes.toString("base64"),
      alt: "",
      originalName: "cover.png",
    };

    publishPatchInRepository(root, patch);

    const relativeMediaPath = `public/media/${metadata.id}.webp`;
    const published = JSON.parse(readFileSync(path.join(root, "public", "data", "library.json"), "utf8"));
    expect(published.assets[metadata.id]).toEqual(metadata);
    expect(readFileSync(path.join(root, relativeMediaPath))).toEqual(bytes);
    expect(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort())
      .toEqual(["public/data/library.json", relativeMediaPath].sort());
  });

  it("rejects legacy inline assets in the static library", () => {
    const bytes = webpBytes("published-legacy");
    const id = sha256(bytes);
    const database = emptyDatabase();
    database.assets[id] = {
      id,
      mime: "image/webp",
      width: 1,
      height: 1,
      base64: bytes.toString("base64"),
      alt: "Legacy",
      originalName: "legacy.png",
    };
    database.publicationId = TRANSACTION_ID;
    database.revision = computeRevision(database);
    const root = makeRepository(database);

    expect(() => publishPatchInRepository(root, createPatch(database)))
      .toThrow(/static assets must reference files in public\/media|base64 is allowed only in patch\.blobs/);
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("never accepts a media path from asset metadata", () => {
    const root = makeRepository();
    const bytes = Buffer.from("unsafe path");
    const metadata = { ...fileAsset(bytes), path: "../../outside" };
    expect(() => publishPatchInRepository(root, createMediaPatch(bytes, metadata))).toThrow(/unknown field path|path: unknown field/);
    expect(existsSync(path.join(root, "public", "media"))).toBe(false);
  });

  it("rejects missing existing media, symlinks, and hash collisions before changing JSON", () => {
    const bytes = Buffer.from("existing file");
    const metadata = fileAsset(bytes);
    const database = emptyDatabase();
    database.assets[metadata.id] = metadata;
    database.publicationId = TRANSACTION_ID;
    database.revision = computeRevision(database);

    const missingRoot = makeRepository(database);
    const missingOriginal = readFileSync(path.join(missingRoot, "public", "data", "library.json"), "utf8");
    expect(() => publishPatchInRepository(missingRoot, createPatch(database))).toThrow(/public\/media is missing/);
    expect(readFileSync(path.join(missingRoot, "public", "data", "library.json"), "utf8")).toBe(missingOriginal);

    const symlinkRoot = makeRepository(database);
    mkdirSync(path.join(symlinkRoot, "public", "media"));
    const outside = path.join(symlinkRoot, "outside.bin");
    writeFileSync(outside, bytes);
    symlinkSync(outside, path.join(symlinkRoot, "public", "media", `${metadata.id}.bin`));
    expect(() => publishPatchInRepository(symlinkRoot, createPatch(database))).toThrow(/regular media file, not a symlink/);

    const collisionRoot = makeRepository();
    mkdirSync(path.join(collisionRoot, "public", "media"));
    writeFileSync(path.join(collisionRoot, "public", "media", `${metadata.id}.bin`), "collision");
    expect(() => publishPatchInRepository(collisionRoot, createMediaPatch(bytes, metadata))).toThrow(/size does not match|SHA-256/);
    expect(JSON.parse(readFileSync(path.join(collisionRoot, "public", "data", "library.json"), "utf8"))).toEqual(emptyDatabase());
  });

  it("rolls back JSON, media, and index when a media commit fails", () => {
    const root = makeRepository();
    const bytes = Buffer.from("rollback file");
    const metadata = fileAsset(bytes);
    const dataPath = path.join(root, "public", "data", "library.json");
    const original = readFileSync(dataPath, "utf8");
    const originalHead = git(root, "rev-parse", "HEAD");
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    expect(() => publishPatchInRepository(root, createMediaPatch(bytes, metadata))).toThrow(/git commit/);
    expect(readFileSync(dataPath, "utf8")).toBe(original);
    expect(existsSync(path.join(root, "public", "media", `${metadata.id}.bin`))).toBe(false);
    expect(existsSync(path.join(root, "public", "media"))).toBe(false);
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("surfaces media cleanup failures instead of reporting a clean rollback", () => {
    const root = makeRepository();
    const bytes = Buffer.from("rollback permissions");
    const metadata = fileAsset(bytes);
    const dataPath = path.join(root, "public", "data", "library.json");
    const mediaRoot = path.join(root, "public", "media");
    const mediaPath = path.join(mediaRoot, `${metadata.id}.bin`);
    const original = readFileSync(dataPath, "utf8");
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nchmod 0555 public/media\nexit 1\n");
    chmodSync(hook, 0o755);

    let failure;
    let mediaWasLeftBehind = false;
    try {
      publishPatchInRepository(root, createMediaPatch(bytes, metadata));
    } catch (cause) {
      failure = cause;
    } finally {
      mediaWasLeftBehind = existsSync(mediaPath);
      if (existsSync(mediaRoot)) chmodSync(mediaRoot, 0o755);
    }

    expect(failure?.message).toMatch(/Rollback incomplete/);
    expect(failure.message).toMatch(/remove created public\/media\//);
    expect(failure.message).toMatch(/remove created public\/media directory/);
    expect(mediaWasLeftBehind).toBe(true);
    expect(readFileSync(dataPath, "utf8")).toBe(original);
  });

  it("does not delete old unreferenced media", () => {
    const root = makeRepository();
    const mediaRoot = path.join(root, "public", "media");
    mkdirSync(mediaRoot);
    const oldMedia = path.join(mediaRoot, `${"f".repeat(64)}.bin`);
    writeFileSync(oldMedia, "old unreferenced bytes");
    git(root, "add", "--", "public/media");
    git(root, "commit", "-m", "Add old media");

    publishPatchInRepository(root, createPatch());

    expect(readFileSync(oldMedia, "utf8")).toBe("old unreferenced bytes");
    expect(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"))
      .toBe("public/data/library.json");
  });

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
    expect(result.commitMessage).toBe(CREATE_GAME_MESSAGE);
    expect(git(root, "show", "-s", "--format=%B", "HEAD")).toBe(CREATE_GAME_MESSAGE);
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
    expect(result.commitMessage).toBe(CREATE_GAME_MESSAGE);
    expect(jj(root, "log", "-r", "@-", "--no-graph", "-T", "description"))
      .toBe(CREATE_GAME_MESSAGE);
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
    expect(result.commitMessage).toBe(CREATE_GAME_MESSAGE);
    expect(jj(root, "log", "-r", "@-", "--no-graph", "-T", "description"))
      .toBe(CREATE_GAME_MESSAGE);
    expect(jj(root, "diff", "-r", "@-", "--summary")).toBe("M public/data/library.json");
  });

  it.skipIf(!jjExecutable)("keeps unrelated untracked files outside a successful media publication", () => {
    const root = makeJujutsuRepository();
    const workingChangeBefore = jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id");
    const unrelatedPath = "scratch.txt";
    writeFileSync(path.join(root, unrelatedPath), "unrelated local file\n");
    const bytes = Buffer.from("publication media");
    const metadata = fileAsset(bytes, "save.txt");
    const relativeMediaPath = `public/media/${metadata.id}.bin`;

    const result = publishPatchInRepository(root, createMediaPatch(bytes, metadata));
    const noAutoTrack = ["--config", 'snapshot.auto-track="none()"'];

    expect(result.kind).toBe("jj");
    expect(git(root, "status", "--porcelain=v1", "--", unrelatedPath)).toBe(`?? ${unrelatedPath}`);
    expect(jj(root, ...noAutoTrack, "file", "list", "-r", "@", unrelatedPath)).toBe("");
    expect(jj(root, ...noAutoTrack, "diff", "--summary")).toBe("");
    expect(jj(root, ...noAutoTrack, "log", "-r", "@", "--no-graph", "-T", "change_id"))
      .toBe(workingChangeBefore);
    expect(jj(root, ...noAutoTrack, "diff", "-r", "@-", "--summary").split("\n").sort())
      .toEqual([`A ${relativeMediaPath}`, "M public/data/library.json"].sort());
  });

  it.skipIf(!jjExecutable)("restores the exact Jujutsu operation when splitting pre-existing untracked media fails", () => {
    const root = makeJujutsuRepository();
    jj(root, "describe", "-m", "Existing work");
    const workingChangeBefore = jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id");
    const packagePath = path.join(root, "package.json");
    const packageContents = "{\"private\":true,\"local\":true}\n";
    writeFileSync(packagePath, packageContents);

    const bytes = Buffer.from("pre-existing untracked media");
    const metadata = fileAsset(bytes, "existing.txt");
    const relativeMediaPath = `public/media/${metadata.id}.bin`;
    const mediaPath = path.join(root, relativeMediaPath);
    mkdirSync(path.dirname(mediaPath));
    writeFileSync(mediaPath, bytes);
    const dataPath = path.join(root, "public", "data", "library.json");
    const originalData = readFileSync(dataPath, "utf8");

    const shimDirectory = mkdtempSync(path.join(tmpdir(), "mylib-jj-failure-shim-"));
    temporaryPaths.push(shimDirectory);
    const shim = path.join(shimDirectory, "jj");
    writeFileSync(shim, `#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = "split" ]; then exit 73; fi; done\nexec ${JSON.stringify(jjExecutable)} "$@"\n`);
    chmodSync(shim, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDirectory}${path.delimiter}${previousPath}`;
    let failure;
    try {
      publishPatchInRepository(root, createMediaPatch(bytes, metadata));
    } catch (cause) {
      failure = cause;
    } finally {
      process.env.PATH = previousPath;
    }

    expect(failure?.message).toMatch(/jj .* split .* failed: exit 73/s);
    expect(readFileSync(dataPath, "utf8")).toBe(originalData);
    expect(readFileSync(packagePath, "utf8")).toBe(packageContents);
    expect(readFileSync(mediaPath)).toEqual(bytes);
    expect(git(root, "status", "--porcelain=v1", "--", relativeMediaPath)).toBe(`?? ${relativeMediaPath}`);
    const noAutoTrack = ["--config", 'snapshot.auto-track="none()"'];
    expect(jj(root, ...noAutoTrack, "log", "-r", "@", "--no-graph", "-T", "change_id")).toBe(workingChangeBefore);
    expect(jj(root, ...noAutoTrack, "log", "-r", "@", "--no-graph", "-T", "description.first_line()"))
      .toBe("Existing work");
    expect(jj(root, ...noAutoTrack, "diff", "--summary")).toBe("M package.json");
  });

  it.skipIf(!jjExecutable)("forces a large media blob into the isolated Jujutsu commit", () => {
    const root = makeJujutsuRepository();
    const bytes = Buffer.alloc(1_100_000, 0x5a);
    const metadata = fileAsset(bytes, "large-save.bin");
    const workingChangeBefore = jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id");

    const result = publishPatchInRepository(root, createMediaPatch(bytes, metadata));
    const relativeMediaPath = `public/media/${metadata.id}.bin`;

    expect(result.kind).toBe("jj");
    expect(jj(root, "log", "-r", "@", "--no-graph", "-T", "change_id")).toBe(workingChangeBefore);
    expect(jj(root, "diff", "--summary")).toBe("");
    expect(jj(root, "diff", "-r", "@-", "--summary").split("\n").sort())
      .toEqual([`A ${relativeMediaPath}`, "M public/data/library.json"].sort());
    expect(readFileSync(path.join(root, relativeMediaPath))).toEqual(bytes);
  });
});
