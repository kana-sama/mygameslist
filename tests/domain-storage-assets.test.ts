import {
  PATCH_STORAGE_KEY,
  applyPatch,
  bytesToBase64,
  diffLibrary,
  libraryRevisionIsValid,
  makeWebPAsset,
  savePatch,
  validateLibrary,
  webkitStorageBytes,
  withComputedRevision,
  type Game,
  type LibraryDatabase,
} from "../src/domain";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const DATE = "2026-07-16T10:00:00.000Z";
const game = (): Game => ({ id: GAME_ID, title: "Mario", coverAssetId: null, platforms: ["NES"], tags: [], status: "wishlist", placement: { tierId: "unranked", rank: 1024 }, reviewMarkdown: "", createdAt: DATE, updatedAt: DATE });
const empty = (): LibraryDatabase => ({ schemaVersion: 1, revision: "", publicationId: null, games: {}, notes: {}, collections: {}, collectionItems: {}, assets: {} });

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  failWrites = false;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { if (this.failWrites) throw new DOMException("full", "QuotaExceededError"); this.values.set(key, value); }
}

describe("patch creation/revert and storage recovery", () => {
  it("uses a missing hash for creation and disappears after a full revert", () => {
    const base = empty(); const current = structuredClone(base); current.games[GAME_ID] = game();
    const patch = diffLibrary(base, current, { changedAt: DATE, transactionId: "create" });
    expect(patch.operations[`/games/${GAME_ID}`].baseExists).toBe(false);
    expect(applyPatch(base, patch).games[GAME_ID].title).toBe("Mario");
    expect(Object.keys(diffLibrary(base, base, { previousPatch: patch }).operations)).toHaveLength(0);
  });

  it("does not destroy the previous value when Safari rejects setItem", () => {
    const storage = new MemoryStorage(); storage.setItem(PATCH_STORAGE_KEY, "previous-valid-value");
    const current = empty(); current.games[GAME_ID] = game(); const patch = diffLibrary(empty(), current, { changedAt: DATE, transactionId: "create" });
    storage.failWrites = true;
    expect(savePatch(storage, patch).ok).toBe(false);
    expect(storage.getItem(PATCH_STORAGE_KEY)).toBe("previous-valid-value");
    expect(webkitStorageBytes(storage)).toBe(2 * (PATCH_STORAGE_KEY.length + "previous-valid-value".length));
  });
});

describe("assets and revision", () => {
  it("deduplicates WebP by the SHA-256 of raw bytes and validates record content", () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const first = makeWebPAsset(bytes, 1, 1, "cover", "a.webp");
    const second = makeWebPAsset(bytes, 1, 1, "cover", "b.webp");
    expect(first.id).toBe(second.id);
    const database = empty(); database.assets[first.id] = first;
    expect(validateLibrary(database).ok).toBe(true);
    database.assets[first.id].base64 = bytesToBase64(new Uint8Array([...bytes, 1]));
    expect(validateLibrary(database).ok).toBe(false);
  });

  it("computes and verifies published revisions while accepting only an empty bootstrap revision", () => {
    expect(libraryRevisionIsValid(empty())).toBe(true);
    const dirty = empty(); dirty.games[GAME_ID] = game();
    expect(libraryRevisionIsValid(dirty)).toBe(false);
    const publication = withComputedRevision({ ...dirty, publicationId: "22222222-2222-4222-8222-222222222222" });
    expect(libraryRevisionIsValid(publication)).toBe(true);
  });
});
