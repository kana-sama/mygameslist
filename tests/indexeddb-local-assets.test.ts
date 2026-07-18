import {
  LOCAL_ASSET_DATABASE_NAME,
  attachmentPreflight,
  classifyOriginStorage,
  deleteLocalAssetsAtomic,
  inspectLocalAssetIntegrity,
  isQuotaExceededError,
  listLocalAssets,
  makeLocalAsset,
  readLocalAsset,
  requestPersistentOriginStorage,
  sha256Bytes,
  storageIsPersisted,
  updateLocalAssetState,
  writeLocalAssetsAtomic,
  type LibraryDatabase,
} from "../src/domain";
import { createRecoveryArchive } from "../src/state/recoveryExport";
import { verifyAndDeletePublishedLocalAssets } from "../src/state/LibraryContext";

function bytes(value: string): Uint8Array { return new TextEncoder().encode(value); }
function asset(value: string, state: "local" | "publishing" | "awaiting-verification" = "local") {
  const content = bytes(value);
  const blob = new Blob([content], { type: "application/octet-stream" });
  return makeLocalAsset(sha256Bytes(content), blob, blob.type, state, 1000);
}

function emptyLibrary(): LibraryDatabase {
  return { schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LOCAL_ASSET_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("origin storage policy", () => {
  it("calculates remaining quota and every warning level", () => {
    expect(classifyOriginStorage(undefined, undefined)).toEqual({ usage: null, quota: null, remaining: null, ratio: null, level: "unknown" });
    expect(classifyOriginStorage(69, 100)).toMatchObject({ remaining: 31, ratio: 0.69, level: "ok" });
    expect(classifyOriginStorage(70, 100).level).toBe("warning");
    expect(classifyOriginStorage(85, 100).level).toBe("critical");
    expect(classifyOriginStorage(90, 100).level).toBe("blocked");
  });

  it("uses the two-times incoming size plus the 100 MiB reserve", () => {
    const incoming = 8 * 1024 * 1024;
    const requiredBytes = incoming * 2 + 100 * 1024 * 1024;
    expect(attachmentPreflight(classifyOriginStorage(0, requiredBytes), incoming)).toMatchObject({ allowed: true, requiredBytes });
    expect(attachmentPreflight(classifyOriginStorage(1, requiredBytes), incoming)).toMatchObject({ allowed: false, requiredBytes });
    expect(attachmentPreflight(classifyOriginStorage(undefined, undefined), incoming).allowed).toBe(true);
  });

  it("handles unavailable persistence APIs and a denied request", async () => {
    expect(await storageIsPersisted({} as StorageManager)).toBe(false);
    expect(await requestPersistentOriginStorage({ persist: vi.fn(async () => false) } as unknown as StorageManager)).toBe(false);
  });
});

describe("atomic IndexedDB local assets", () => {
  it("stores Blob and metadata together and counts exact bytes", async () => {
    const first = asset("first");
    const second = asset("second-file");
    await writeLocalAssetsAtomic([first, second]);

    const stored = await listLocalAssets();
    expect(stored.map((item) => item.id)).toEqual([first.id, second.id].sort());
    expect(stored.reduce((total, item) => total + item.byteLength, 0)).toBe(first.blob.size + second.blob.size);
    expect(stored.every((item) => item.byteLength === item.blob.size)).toBe(true);
  });

  it("aborts the whole batch when one record cannot be cloned", async () => {
    const first = asset("first");
    const invalid = Object.assign(asset("second"), { uncloneable: () => undefined });
    await expect(writeLocalAssetsAtomic([first, invalid])).rejects.toBeTruthy();
    expect(await listLocalAssets()).toEqual([]);
  });

  it("rejects a SHA mismatch before writing any metadata", async () => {
    const valid = asset("valid");
    const corrupt = { ...asset("actual"), id: valid.id };
    await expect(writeLocalAssetsAtomic([corrupt])).rejects.toThrow("SHA-256");
    expect(await listLocalAssets()).toEqual([]);
  });

  it("updates publication states and deletes several records in one transaction", async () => {
    const first = asset("first");
    const second = asset("second");
    await writeLocalAssetsAtomic([first, second]);
    await updateLocalAssetState([first.id, second.id], "awaiting-verification");
    expect((await readLocalAsset(first.id))?.state).toBe("awaiting-verification");
    await deleteLocalAssetsAtomic([first.id, second.id]);
    expect(await listLocalAssets()).toEqual([]);
  });

  it("reports missing metadata targets and safe orphans independently", async () => {
    const orphan = asset("orphan");
    await writeLocalAssetsAtomic([orphan]);
    const report = await inspectLocalAssetIntegrity(["f".repeat(64)]);
    expect(report.missing).toEqual(["f".repeat(64)]);
    expect(report.orphans.map((item) => item.id)).toEqual([orphan.id]);
    expect(report.totalBytes).toBe(orphan.byteLength);
  });

  it("recognizes authoritative IndexedDB quota failures", () => {
    expect(isQuotaExceededError(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaExceededError(new Error("other"))).toBe(false);
  });
});

describe("publication verification and recovery", () => {
  it("keeps every local Blob when one published file fails verification", async () => {
    const first = asset("first", "awaiting-verification");
    const second = asset("second", "awaiting-verification");
    await writeLocalAssetsAtomic([first, second]);
    const library = emptyLibrary();
    for (const item of [first, second]) library.assets[item.id] = { id: item.id, kind: "file", mime: item.mimeType, byteLength: item.byteLength, originalName: `${item.id}.bin` };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(first.blob, { status: 200 }))
      .mockResolvedValueOnce(new Response("wrong", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyAndDeletePublishedLocalAssets([first.id, second.id], library)).rejects.toThrow();
    expect((await listLocalAssets()).map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("deletes all verified files only after every hash and size match", async () => {
    const first = asset("first", "awaiting-verification");
    const second = asset("second", "awaiting-verification");
    await writeLocalAssetsAtomic([first, second]);
    const library = emptyLibrary();
    for (const item of [first, second]) library.assets[item.id] = { id: item.id, kind: "file", mime: item.mimeType, byteLength: item.byteLength, originalName: `${item.id}.bin` };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(first.blob, { status: 200 }))
      .mockResolvedValueOnce(new Response(second.blob, { status: 200 })));

    await verifyAndDeletePublishedLocalAssets([first.id, second.id], library);
    expect(await listLocalAssets()).toEqual([]);
  });

  it("exports library, patch, metadata, states, and original bytes as a ZIP", async () => {
    const local = asset("recover me");
    const library = emptyLibrary();
    library.assets[local.id] = { id: local.id, kind: "file", mime: local.mimeType, byteLength: local.byteLength, originalName: "save.bin" };
    const patch = { patchVersion: 2 as const, schemaVersion: 2 as const, baseRevision: "", operations: {}, blobs: {} };
    const archive = await createRecoveryArchive(library, patch, [local]);
    const source = new TextDecoder().decode(await archive.arrayBuffer());
    expect(source.slice(0, 2)).toBe("PK");
    expect(source).toContain("library.json");
    expect(source).toContain("patch.json");
    expect(source).toContain("local-assets.json");
    expect(source).toContain(`media/${local.id}.bin`);
    expect(source).toContain("recover me");
  });
});
