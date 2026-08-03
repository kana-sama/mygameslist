// @vitest-environment node

import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { computeRevision, validateLibrary } from "../scripts/validate-data.mjs";

const GAME_ID = "00000000-0000-4000-8000-000000000001";
const DUCKTALES_NOTE_ID = "00000000-0000-4000-8000-000000000007";
const NOW = "2026-07-16T06:00:00.000Z";
const temporaryPaths = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop(), { recursive: true, force: true });
  }
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

function fileAsset(bytes, originalName = "route.txt") {
  return {
    id: createHash("sha256").update(bytes).digest("hex"),
    kind: "file",
    mime: "text/plain",
    byteLength: bytes.byteLength,
    originalName,
  };
}

function referenceAsset(database, metadata) {
  database.games[GAME_ID] = game();
  database.notes[DUCKTALES_NOTE_ID] = note(DUCKTALES_NOTE_ID, GAME_ID, "", {
    attachments: [{ type: "file", assetId: metadata.id, label: metadata.originalName }],
  });
}

function populatedDatabase(noteOverrides = {}) {
  const database = emptyDatabase();
  database.games[GAME_ID] = game();
  database.notes[DUCKTALES_NOTE_ID] = note(DUCKTALES_NOTE_ID, GAME_ID, "# Route", noteOverrides);
  return database;
}

describe("published data validation", () => {
  it("accepts optional boolean note size fields", () => {
    const database = populatedDatabase({ doubleHeight: false, doubleWidth: true });
    database.revision = computeRevision(database);

    expect(() => validateLibrary(database)).not.toThrow();
  });

  it.each(["doubleHeight", "doubleWidth"])("rejects non-boolean %s note size values", (field) => {
    const database = populatedDatabase({ [field]: "yes" });
    database.revision = computeRevision(database);

    expect(() => validateLibrary(database)).toThrow(new RegExp(`${field}.*must be a boolean`));
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
    referenceAsset(database, metadata);
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
    referenceAsset(database, metadata);
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
    referenceAsset(database, metadata);
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

  it("rejects files in public/media that have no matching asset metadata", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mylib-validator-orphan-test-"));
    temporaryPaths.push(root);
    const mediaRoot = path.join(root, "public", "media");
    mkdirSync(mediaRoot, { recursive: true });
    const fileName = `${"e".repeat(64)}.bin`;
    writeFileSync(path.join(mediaRoot, fileName), "orphan");

    expect(() => validateLibrary(emptyDatabase(), { mediaRoot })).toThrow(`unreferenced media file: ${fileName}`);
  });
});
