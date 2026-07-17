import {
  PATCH_STORAGE_KEY,
  MISSING_VALUE_HASH,
  applyPatch,
  assetDataUrl,
  bytesToBase64,
  canvasToWebPBytes,
  discardOperation,
  diffLibrary,
  libraryRevisionIsValid,
  loadPatch,
  makeExternalWebPAsset,
  makeFileAsset,
  makeWebPAsset,
  publishedAssetUrl,
  reconcilePatch,
  savePatch,
  validateLibrary,
  webkitStorageBytes,
  withComputedRevision,
  withVideoPreviewFragment,
  type Game,
  type LibraryDatabase,
} from "../src/domain";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const DATE = "2026-07-16T10:00:00.000Z";
const game = (): Game => ({ id: GAME_ID, title: "Mario", coverAssetId: null, platforms: ["NES"], tags: [], status: "wishlist", placement: { tierId: "unranked", rank: 1024 }, reviewMarkdown: "", createdAt: DATE, updatedAt: DATE });
const empty = (): LibraryDatabase => ({ schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} });

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

  it("migrates inline V1 assets into V2 metadata and a separate blob", () => {
    const storage = new MemoryStorage();
    const legacy = makeWebPAsset(new Uint8Array([82, 73, 70, 70, 2, 0, 0, 0, 87, 69, 66, 80]), 1, 1, "note", "note.webp");
    storage.setItem(PATCH_STORAGE_KEY, JSON.stringify({
      patchVersion: 1,
      schemaVersion: 2,
      baseRevision: "",
      operations: {
        [`/assets/${legacy.id}`]: {
          operation: "set",
          value: legacy,
          baseExists: false,
          baseHash: MISSING_VALUE_HASH,
          changedAt: DATE,
          transactionId: "legacy-image",
        },
      },
    }));

    const loaded = loadPatch(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.patch?.patchVersion).toBe(2);
    expect(loaded.patch?.blobs[legacy.id]).toBe(legacy.base64);
    expect(loaded.patch?.operations[`/assets/${legacy.id}`].value).toEqual(expect.objectContaining({ kind: "image", byteLength: 12 }));
    expect(loaded.patch?.operations[`/assets/${legacy.id}`].value).not.toHaveProperty("base64");
  });

  it("does not silently upgrade patches from an unknown schema", () => {
    const storage = new MemoryStorage();
    storage.setItem(PATCH_STORAGE_KEY, JSON.stringify({ patchVersion: 1, schemaVersion: 999, baseRevision: "", operations: {} }));

    const loaded = loadPatch(storage);
    expect(loaded.patch).toBeNull();
    expect(loaded.error?.message).toContain("schemaVersion");
  });

  it("does not repair an incomplete V2 envelope during load", () => {
    const storage = new MemoryStorage();
    storage.setItem(PATCH_STORAGE_KEY, JSON.stringify({ patchVersion: 2, schemaVersion: 2, baseRevision: "", operations: {} }));

    const loaded = loadPatch(storage);
    expect(loaded.patch).toBeNull();
    expect(loaded.error?.message).toContain("/blobs");
  });

  it("keeps blobs with asset operations and prunes them on discard or publication", () => {
    const base = empty();
    const prepared = makeExternalWebPAsset(new Uint8Array([82, 73, 70, 70, 3, 0, 0, 0, 87, 69, 66, 80]), 1, 1, "note", "note.webp");
    const current = structuredClone(base); current.assets[prepared.asset.id] = prepared.asset;
    const patch = diffLibrary(base, current, { changedAt: DATE, transactionId: "image", blobs: { [prepared.asset.id]: prepared.base64 } });

    expect(patch.blobs).toEqual({ [prepared.asset.id]: prepared.base64 });
    expect(discardOperation(patch, `/assets/${prepared.asset.id}`).blobs).toEqual({});
    const published = withComputedRevision({ ...current, publicationId: "22222222-2222-4222-8222-222222222222" });
    expect(reconcilePatch(published, patch).patch.blobs).toEqual({});
  });

  it("reuses compatible static asset metadata by SHA and keeps incompatible kinds conflicted", () => {
    const base = empty();
    const prepared = makeExternalWebPAsset(new Uint8Array([82, 73, 70, 70, 5, 0, 0, 0, 87, 69, 66, 80]), 1, 1, "local", "local.webp");
    const current = structuredClone(base); current.assets[prepared.asset.id] = prepared.asset;
    const patch = diffLibrary(base, current, { changedAt: DATE, transactionId: "image", blobs: { [prepared.asset.id]: prepared.base64 } });

    const compatible = empty();
    compatible.assets[prepared.asset.id] = { ...prepared.asset, alt: "static", originalName: "static.webp" };
    const reused = reconcilePatch(withComputedRevision({ ...compatible, publicationId: NOTE_ID }), patch);
    expect(reused.conflicts).toEqual([]);
    expect(reused.patch.operations).toEqual({});
    expect(reused.patch.blobs).toEqual({});
    expect(reused.effective.assets[prepared.asset.id]).toEqual(compatible.assets[prepared.asset.id]);

    const incompatible = empty();
    incompatible.assets[prepared.asset.id] = { id: prepared.asset.id, kind: "file", mime: "application/octet-stream", byteLength: prepared.asset.byteLength, originalName: "static.bin" };
    const conflicted = reconcilePatch(withComputedRevision({ ...incompatible, publicationId: NOTE_ID }), patch);
    expect(conflicted.conflicts).toHaveLength(1);
    expect(conflicted.patch.operations).toHaveProperty(`/assets/${prepared.asset.id}`);
    expect(conflicted.patch.blobs).toEqual({ [prepared.asset.id]: prepared.base64 });
  });
});

describe("assets and revision", () => {
  it("falls back to the WebP encoder when Safari returns PNG for a WebP canvas request", async () => {
    const canvas = document.createElement("canvas"); canvas.width = 3; canvas.height = 2;
    const imageData = { data: new Uint8ClampedArray(24), width: 3, height: 2 } as ImageData;
    vi.spyOn(canvas, "getContext").mockReturnValue({ getImageData: vi.fn(() => imageData) } as unknown as CanvasRenderingContext2D);
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    const webp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const fallback = vi.fn(async () => webp);

    await expect(canvasToWebPBytes(canvas, 0.82, fallback)).resolves.toEqual(webp);
    expect(fallback).toHaveBeenCalledWith(imageData, 0.82);
  });

  it("deduplicates WebP by the SHA-256 of raw bytes and validates record content", () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const first = makeExternalWebPAsset(bytes, 1, 1, "cover", "a.webp").asset;
    const second = makeExternalWebPAsset(bytes, 1, 1, "cover", "b.webp").asset;
    expect(first.id).toBe(second.id);
    const database = empty(); database.assets[first.id] = first;
    expect(validateLibrary(database).ok).toBe(true);
    (database.assets[first.id] as unknown as Record<string, unknown>).base64 = bytesToBase64(bytes);
    expect(validateLibrary(database).ok).toBe(false);
  });

  it("validates metadata-only file assets independently from their patch blobs", () => {
    const prepared = makeFileAsset(new TextEncoder().encode("save data"), "application/octet-stream", "save.dat");
    expect(makeFileAsset(new TextEncoder().encode("save data"), "text/plain", "copy.txt").asset.id).toBe(prepared.asset.id);
    const database = empty(); database.assets[prepared.asset.id] = prepared.asset;
    expect(validateLibrary(database).ok).toBe(true);

    const current = structuredClone(database);
    const patch = diffLibrary(empty(), current, { changedAt: DATE, transactionId: "file", blobs: { [prepared.asset.id]: prepared.base64 } });
    expect(savePatch(new MemoryStorage(), patch).ok).toBe(true);
    const damaged = structuredClone(patch); damaged.blobs[prepared.asset.id] = bytesToBase64(new TextEncoder().encode("other"));
    expect(savePatch(new MemoryStorage(), damaged).ok).toBe(false);
  });

  it("creates a local data URL for an empty file blob", () => {
    const prepared = makeFileAsset(new Uint8Array(), "application/octet-stream", "empty.dat");
    expect(prepared.base64).toBe("");
    expect(assetDataUrl(prepared.asset, prepared.base64)).toBe("data:application/octet-stream;base64,");
  });

  it("preserves MP4 MIME locally and derives a Pages-safe video filename", () => {
    const prepared = makeFileAsset(new TextEncoder().encode("video"), "video/mp4", "clip.mp4");

    expect(assetDataUrl(prepared.asset, prepared.base64)).toBe(`data:video/mp4;base64,${prepared.base64}`);
    expect(publishedAssetUrl(prepared.asset, "/mylib/")).toBe(`/mylib/media/${prepared.asset.id}.mp4`);
  });

  it("forces WebKit to decode an MP4 preview frame with a non-zero media fragment", () => {
    expect(withVideoPreviewFragment("/media/clip.mp4")).toBe("/media/clip.mp4#t=0.001");
    expect(withVideoPreviewFragment("data:video/mp4;base64,AAAA")).toBe("data:video/mp4;base64,AAAA#t=0.001");
    expect(withVideoPreviewFragment("/media/clip.mp4#quality=hd&t=2")).toBe("/media/clip.mp4#quality=hd&t=0.001");
  });

  it("requires file attachments to reference file assets", () => {
    const image = makeExternalWebPAsset(new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]), 1, 1, "image", "image.webp").asset;
    const database = empty();
    database.games[GAME_ID] = game();
    database.assets[image.id] = image;
    database.notes[NOTE_ID] = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "file", attachments: [{ type: "file", assetId: image.id, label: "Wrong" }], rank: 1024, createdAt: DATE, updatedAt: DATE };
    expect(validateLibrary(database).issues.some((item) => item.message === "Файл должен ссылаться на file asset")).toBe(true);
  });

  it("computes and verifies published revisions while accepting only an empty bootstrap revision", () => {
    expect(libraryRevisionIsValid(empty())).toBe(true);
    const dirty = empty(); dirty.games[GAME_ID] = game();
    expect(libraryRevisionIsValid(dirty)).toBe(false);
    const publication = withComputedRevision({ ...dirty, publicationId: "22222222-2222-4222-8222-222222222222" });
    expect(libraryRevisionIsValid(publication)).toBe(true);
  });
});
