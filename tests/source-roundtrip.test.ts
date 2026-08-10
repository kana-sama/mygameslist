import { describe, expect, it } from "vitest";
import { computeLibraryRevision, normalizePublishedLibrary } from "../src/domain";
import {
  assembleSourceTree,
  parsePublishedLibraryEnvelope,
  projectGameSourceBundle,
  projectSourceTree,
  validateProjectedSourceInventory,
} from "../src/source";
import type { SourceTreeEntry } from "../src/source/types";
import {
  EXPECTED_LEAVES,
  FILE_ID,
  GAME_A_DIRECTORY,
  GAME_A_ID,
  GAME_A_YAML_PATH,
  IMAGE_A_PATH,
  IMAGE_B_PATH,
  IMAGE_BYTES,
  IMAGE_ID,
  MemorySourceTreeReader,
  NOTE_ATTACHMENTS_ID,
  NOTE_ATTACHMENTS_PATH,
  NOTE_EMPTY_ID,
  NOTE_SHARED_ID,
  PUBLICATION_ID,
  fixtureDatabase,
  projectedEntries,
  projectedFiles,
} from "./fixtures/source-tree";

function changedEntry(
  entries: readonly SourceTreeEntry[],
  path: string,
  change: Partial<SourceTreeEntry>,
): SourceTreeEntry[] {
  return entries.map((entry) => entry.path === path ? { ...entry, ...change } as SourceTreeEntry : structuredClone(entry));
}

function changedFiles(path: string, bytes: Uint8Array): Map<string, Uint8Array> {
  const files = projectedFiles();
  files.set(path, bytes);
  return files;
}

describe("source projection", () => {
  it("projects literal canonical text, logical identities, paths, and deterministic leaf order", async () => {
    const projection = await projectSourceTree(fixtureDatabase());
    expect(projection.leaves).toEqual(EXPECTED_LEAVES);
    expect([...projection.gameBundles.keys()]).toEqual([GAME_A_ID, "22222222-2222-4222-8222-222222222222"]);
  });

  it("normalizes defaults and object order before recomputing the exact semantic revision", async () => {
    const projection = await projectSourceTree(fixtureDatabase());
    expect(projection.database.revision).toBe(computeLibraryRevision(projection.database));
    expect(projection.database.notes[NOTE_EMPTY_ID]).not.toHaveProperty("groupRank");
    expect(Object.keys(projection.database.games)).toEqual([GAME_A_ID, "22222222-2222-4222-8222-222222222222"]);
  });

  it("keeps identities stable while readable game, note, and asset names change", async () => {
    const original = await projectSourceTree(fixtureDatabase());
    const renamed = fixtureDatabase();
    renamed.games[GAME_A_ID].title = "Renamed Quest";
    renamed.notes[NOTE_ATTACHMENTS_ID].bodyMarkdown = "Renamed note body";
    renamed.assets[IMAGE_ID].originalName = "renamed picture.jpeg";
    const changed = await projectSourceTree(renamed);
    const originalById = new Map(original.leaves.map((leaf) => [leaf.logicalId, leaf.path]));
    const changedById = new Map(changed.leaves.map((leaf) => [leaf.logicalId, leaf.path]));

    expect(changedById.get(`game:${GAME_A_ID}`)).not.toBe(originalById.get(`game:${GAME_A_ID}`));
    expect(changedById.get(`note:${NOTE_ATTACHMENTS_ID}`)).not.toBe(originalById.get(`note:${NOTE_ATTACHMENTS_ID}`));
    expect(changedById.get(`asset:${GAME_A_ID}:${IMAGE_ID}`)).not.toBe(originalById.get(`asset:${GAME_A_ID}:${IMAGE_ID}`));
    expect([...changedById.keys()].sort()).toEqual([...originalById.keys()].sort());
  });

  it("rejects direct bundle projection of an incomplete or noncanonical database", async () => {
    const database = fixtureDatabase();
    expect(() => projectGameSourceBundle(database, GAME_A_ID)).toThrow(/normalized|revision|canonical/i);
    const canonical = await projectSourceTree(database);
    expect(() => projectGameSourceBundle(canonical.database, "99999999-9999-4999-8999-999999999999")).toThrow(/game/i);
  });

  it("is byte and path idempotent on the returned canonical database", async () => {
    const first = await projectSourceTree(fixtureDatabase());
    const second = await projectSourceTree(first.database);
    expect(second).toEqual(first);
  });

  it("rejects a nonempty source database whose manifest publication UUID is null", async () => {
    const database = fixtureDatabase();
    database.publicationId = null;
    await expect(projectSourceTree(database)).rejects.toThrow(/publicationId|publication/i);
  });
});

describe("projected source inventory validation", () => {
  it("validates a complete filesystem inventory without reading bytes", async () => {
    const projection = await projectSourceTree(fixtureDatabase());
    const reader = new MemorySourceTreeReader();
    const inventory = validateProjectedSourceInventory(projection, await reader.listEntries());
    expect(reader.reads).toEqual([]);
    expect(inventory.blobShasByPath.size).toBe(0);
    expect(inventory.assetOccurrences).toHaveLength(3);
  });

  it("exposes reusable blob SHAs only after complete Git metadata validation", async () => {
    const projection = await projectSourceTree(fixtureDatabase());
    const entries = projectedEntries(true);
    const result = validateProjectedSourceInventory(projection, entries);
    expect(result.blobShasByPath.size).toBe(EXPECTED_LEAVES.length);
    expect(result.blobShasByPath.get(GAME_A_YAML_PATH)).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each([
    ["missing", (entries: SourceTreeEntry[]) => entries.filter((entry) => entry.path !== IMAGE_A_PATH)],
    ["extra", (entries: SourceTreeEntry[]) => [...entries, { kind: "file", path: "data/extra.txt" } as const]],
    ["duplicate", (entries: SourceTreeEntry[]) => [...entries, structuredClone(entries[0])]],
    ["case collision", (entries: SourceTreeEntry[]) => [...entries, { kind: "file", path: "data/Manifest.yaml" } as const]],
    ["backslash", (entries: SourceTreeEntry[]) => changedEntry(entries, IMAGE_A_PATH, { path: IMAGE_A_PATH.replace("/assets/", "\\assets\\") })],
    ["absolute", (entries: SourceTreeEntry[]) => changedEntry(entries, IMAGE_A_PATH, { path: `/${IMAGE_A_PATH}` })],
    ["traversal", (entries: SourceTreeEntry[]) => changedEntry(entries, IMAGE_A_PATH, { path: "data/games/../manifest.yaml" })],
    ["empty segment", (entries: SourceTreeEntry[]) => changedEntry(entries, IMAGE_A_PATH, { path: IMAGE_A_PATH.replace("/assets/", "//assets/") })],
    ["symlink", (entries: SourceTreeEntry[]) => changedEntry(entries, IMAGE_A_PATH, { kind: "symlink", target: "game.yaml" })],
    ["unsupported", (entries: SourceTreeEntry[]) => changedEntry(entries, IMAGE_A_PATH, { kind: "unsupported" })],
    ["file in directory slot", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_DIRECTORY, { kind: "file" })],
  ])("rejects %s inventory corruption", async (_name, mutate) => {
    const projection = await projectSourceTree(fixtureDatabase());
    expect(() => validateProjectedSourceInventory(projection, mutate(projectedEntries()))).toThrow();
  });

  it.each([
    ["executable file", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "100755", type: "blob", objectId: "a".repeat(40) } })],
    ["file tree type", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "100644", type: "tree", objectId: "a".repeat(40) } })],
    ["directory blob type", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_DIRECTORY, { git: { mode: "040000", type: "blob", objectId: "a".repeat(40) } })],
    ["submodule", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "160000", type: "commit", objectId: "a".repeat(40) } })],
    ["unknown mode", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "100600", type: "blob", objectId: "a".repeat(40) } })],
    ["missing metadata", (entries: SourceTreeEntry[]) => entries.map((entry) => entry.path === GAME_A_YAML_PATH ? { kind: "file", path: entry.path } : entry)],
    ["empty object id", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "100644", type: "blob", objectId: "" } })],
    ["uppercase object id", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "100644", type: "blob", objectId: "A".repeat(40) } })],
    ["mixed object id length", (entries: SourceTreeEntry[]) => changedEntry(entries, GAME_A_YAML_PATH, { git: { mode: "100644", type: "blob", objectId: "a".repeat(64) } })],
  ])("rejects invalid Git inventory metadata: %s", async (_name, mutate) => {
    const projection = await projectSourceTree(fixtureDatabase());
    expect(() => validateProjectedSourceInventory(projection, mutate(projectedEntries(true)))).toThrow();
  });
});

describe("source assembly", () => {
  it("round-trips projection to the normalized database and deduplicated runtime media", async () => {
    const expected = await normalizePublishedLibrary(fixtureDatabase());
    const reader = new MemorySourceTreeReader();
    const assembled = await assembleSourceTree(reader, { sourceCommitSha: "a".repeat(40) });

    expect(assembled.database).toEqual(expected);
    expect(assembled.envelope).toEqual({ sourceCommitSha: "a".repeat(40), database: expected });
    expect([...assembled.runtimeMedia.keys()]).toEqual([`${FILE_ID}.bin`, `${IMAGE_ID}.webp`]);
    expect(assembled.runtimeMedia.get(`${IMAGE_ID}.webp`)).toEqual(IMAGE_BYTES);
    expect(assembled.sourceAssetOccurrences).toBe(3);
    expect(reader.reads.filter((path) => path === IMAGE_A_PATH || path === IMAGE_B_PATH)).toHaveLength(2);
  });

  it("preserves empty, no-final-LF, multiple-final-LF bodies and default group omission", async () => {
    const { database } = await assembleSourceTree(new MemorySourceTreeReader(), { sourceCommitSha: null });
    expect(database.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe("");
    expect(database.notes[NOTE_ATTACHMENTS_ID].bodyMarkdown).toBe("No final LF");
    expect(database.notes[NOTE_SHARED_ID].bodyMarkdown).toBe("# Shared route\n\n\n");
    expect(database.notes[NOTE_EMPTY_ID]).not.toHaveProperty("groupRank");
    expect(database.notes[NOTE_ATTACHMENTS_ID]).not.toHaveProperty("groupRank");
  });

  it.each([
    ["game path id", GAME_A_YAML_PATH, (text: string) => text.replace(GAME_A_ID, "99999999-9999-4999-8999-999999999999")],
    ["note path id", NOTE_ATTACHMENTS_PATH, (text: string) => text.replace(NOTE_ATTACHMENTS_ID, NOTE_EMPTY_ID)],
    ["unknown game key", GAME_A_YAML_PATH, (text: string) => `${text}unknown: true\n`],
    ["unknown note key", NOTE_ATTACHMENTS_PATH, (text: string) => text.replace("rank: 2048\n", "rank: 2048\nunknown: true\n")],
    ["cross-game progress note", GAME_A_YAML_PATH, (text: string) => text.replace(NOTE_EMPTY_ID, NOTE_SHARED_ID)],
    ["missing source asset", NOTE_ATTACHMENTS_PATH, (text: string) => text.replace(FILE_ID, "f".repeat(64))],
  ])("rejects semantic source corruption: %s", async (_name, path, mutate) => {
    const original = new TextDecoder().decode(projectedFiles().get(path));
    const files = changedFiles(path, new TextEncoder().encode(mutate(original)));
    await expect(assembleSourceTree(new MemorySourceTreeReader(projectedEntries(), files), { sourceCommitSha: null })).rejects.toThrow();
  });

  it("rejects malformed UTF-8 before parsing text", async () => {
    await expect(assembleSourceTree(
      new MemorySourceTreeReader(projectedEntries(), changedFiles(GAME_A_YAML_PATH, new Uint8Array([0xc3, 0x28]))),
      { sourceCommitSha: null },
    )).rejects.toThrow(/UTF-8|decode/i);
  });

  it("rejects bad SHA bytes, dimensions, unreferenced assets, and shared-byte disagreement", async () => {
    await expect(assembleSourceTree(
      new MemorySourceTreeReader(projectedEntries(), changedFiles(IMAGE_A_PATH, new Uint8Array(30))),
      { sourceCommitSha: null },
    )).rejects.toThrow();

    const wrongDimensions = IMAGE_BYTES.slice();
    wrongDimensions[24] = 62;
    await expect(assembleSourceTree(
      new MemorySourceTreeReader(projectedEntries(), changedFiles(IMAGE_A_PATH, wrongDimensions)),
      { sourceCommitSha: null },
    )).rejects.toThrow();

    const extraPath = `${GAME_A_DIRECTORY}/assets/extra_${"f".repeat(64)}.bin`;
    await expect(assembleSourceTree(
      new MemorySourceTreeReader(
        [...projectedEntries(), { kind: "file", path: extraPath }],
        new Map([...projectedFiles(), [extraPath, new Uint8Array([9])]]),
      ),
      { sourceCommitSha: null },
    )).rejects.toThrow();

    await expect(assembleSourceTree(
      new MemorySourceTreeReader(projectedEntries(), changedFiles(IMAGE_B_PATH, IMAGE_BYTES.map((byte, index) => index === 29 ? byte ^ 1 : byte))),
      { sourceCommitSha: null },
    )).rejects.toThrow();
  });

  it("rejects noncanonical readable game, note, and asset path names", async () => {
    for (const [from, to] of [
      [GAME_A_DIRECTORY, `data/games/wrong_${GAME_A_ID}`],
      [NOTE_ATTACHMENTS_PATH, `${GAME_A_DIRECTORY}/notes/wrong_${NOTE_ATTACHMENTS_ID}.md`],
      [IMAGE_A_PATH, `${GAME_A_DIRECTORY}/assets/wrong_${IMAGE_ID}.webp`],
    ]) {
      const entries = projectedEntries().map((entry) => ({ ...entry, path: entry.path.replace(from, to) } as SourceTreeEntry));
      const files = new Map([...projectedFiles()].map(([path, bytes]) => [path.replace(from, to), bytes]));
      await expect(assembleSourceTree(new MemorySourceTreeReader(entries, files), { sourceCommitSha: null })).rejects.toThrow();
    }
  });
});

describe("published library envelope parser", () => {
  it("accepts exact provenance keys and excludes commit provenance from semantic revision", async () => {
    const database = await normalizePublishedLibrary(fixtureDatabase());
    const first = parsePublishedLibraryEnvelope({ sourceCommitSha: "a".repeat(40), database });
    const second = parsePublishedLibraryEnvelope({ sourceCommitSha: "b".repeat(64), database });
    expect(first.database.revision).toBe(second.database.revision);
    expect(first.sourceCommitSha).toBe("a".repeat(40));
    expect(second.sourceCommitSha).toBe("b".repeat(64));
  });

  it.each([
    ["missing key", { database: fixtureDatabase() }],
    ["unknown key", { sourceCommitSha: null, database: fixtureDatabase(), extra: true }],
    ["uppercase SHA", { sourceCommitSha: "A".repeat(40), database: fixtureDatabase() }],
    ["wrong SHA length", { sourceCommitSha: "a".repeat(39), database: fixtureDatabase() }],
    ["wrong SHA type", { sourceCommitSha: 1, database: fixtureDatabase() }],
  ])("rejects %s", (_name, value) => {
    expect(() => parsePublishedLibraryEnvelope(value)).toThrow();
  });

  it("rejects a stale semantic revision and owner-derived metadata disagreement", async () => {
    const stale = await normalizePublishedLibrary(fixtureDatabase());
    stale.games[GAME_A_ID].title = "changed after revision";
    expect(() => parsePublishedLibraryEnvelope({ sourceCommitSha: null, database: stale })).toThrow(/revision|valid/i);

    const wrongAlt = await normalizePublishedLibrary(fixtureDatabase());
    wrongAlt.games[GAME_A_ID].coverAssetId = null;
    wrongAlt.assets[IMAGE_ID].alt = "wrong global alt";
    wrongAlt.revision = computeLibraryRevision(wrongAlt);
    expect(() => parsePublishedLibraryEnvelope({ sourceCommitSha: null, database: wrongAlt })).toThrow();
  });

  it("rejects a self-consistent but noncanonical published database instead of repairing it", async () => {
    const database = await normalizePublishedLibrary(fixtureDatabase());
    database.notes[NOTE_EMPTY_ID].groupRank = 1024;
    database.notes[NOTE_EMPTY_ID].doubleWidth = false;
    database.games["22222222-2222-4222-8222-222222222222"].progressItems = [];
    database.revision = computeLibraryRevision(database);
    expect(() => parsePublishedLibraryEnvelope({ sourceCommitSha: null, database })).toThrow(/canonical|normalized/i);
  });
});
