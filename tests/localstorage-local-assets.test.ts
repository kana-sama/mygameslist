import {
  attachmentPreflight,
  classifyOriginStorage,
  canonicalStringify,
  deleteLocalAssetsAtomic,
  deleteSafeOrphans,
  diffLibrary,
  finalizePublishedDatabase,
  inspectLocalAssetIntegrity,
  isQuotaExceededError,
  listLocalAssets,
  LOCAL_ASSET_METADATA_PREFIX,
  localAssetDataKey,
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
import type { PendingPublicationJournalV3 } from "../src/state/pendingPublication";

function bytes(value: string): Uint8Array { return new TextEncoder().encode(value); }
function asset(value: string, state: "local" | "publishing" | "awaiting-verification" = "local") {
  const content = bytes(value);
  const blob = new Blob([content], { type: "application/octet-stream" });
  return makeLocalAsset(sha256Bytes(content), blob, blob.type, state, 1000);
}

function emptyLibrary(): LibraryDatabase {
  return { schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} };
}

class FailingStorage implements Storage {
  private readonly values = new Map<string, string>();
  private writes = 0;

  constructor(private readonly failOnWrite: number) {}

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.writes += 1;
    if (this.writes === this.failOnWrite) throw new DOMException("write failed", "UnknownError");
    this.values.set(key, String(value));
  }
}

class ExclusiveTestLockManager {
  private readonly tails = new Map<string, Promise<void>>();

  request<T>(name: string, _options: LockOptions, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<Awaited<T>> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => held);
    this.tails.set(name, tail);
    return previous
      .then(() => callback({ name, mode: "exclusive" } as Lock))
      .finally(() => {
        release();
        if (this.tails.get(name) === tail) this.tails.delete(name);
      }) as Promise<Awaited<T>>;
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: new ExclusiveTestLockManager() });
});

afterEach(() => vi.restoreAllMocks());

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

describe("atomic localStorage assets", () => {
  it("stores binary bytes and metadata separately without Base64", async () => {
    const content = Uint8Array.from({ length: 256 }, (_, index) => index);
    const item = makeLocalAsset(sha256Bytes(content), new Blob([content]), "application/octet-stream", "local", 1000);
    await writeLocalAssetsAtomic([item]);

    const storedData = localStorage.getItem(localAssetDataKey(item.id));
    expect(storedData).not.toBeNull();
    const base64 = btoa(String.fromCharCode(...content));
    expect(storedData).not.toBe(base64);
    expect(storedData).toHaveLength(Math.ceil(content.byteLength * 8 / 15));
    expect(storedData!.length).toBeLessThan(base64.length);
    expect([...storedData!].every((value) => value.charCodeAt(0) <= 0x7fff)).toBe(true);
    expect(new Uint8Array(await (await readLocalAsset(item.id))!.blob.arrayBuffer())).toEqual(content);
  });

  it("stores Blob and metadata together and counts exact bytes", async () => {
    const first = asset("first");
    const second = asset("second-file");
    await writeLocalAssetsAtomic([first, second]);

    const stored = await listLocalAssets();
    expect(stored.map((item) => item.id)).toEqual([first.id, second.id].sort());
    expect(stored.reduce((total, item) => total + item.byteLength, 0)).toBe(first.blob.size + second.blob.size);
    expect(stored.every((item) => item.byteLength === item.blob.size)).toBe(true);
  });

  it("reports an out-of-alphabet localStorage code unit as corrupt", async () => {
    const item = asset("file");
    await writeLocalAssetsAtomic([item]);
    localStorage.setItem(localAssetDataKey(item.id), `\ud800${localStorage.getItem(localAssetDataKey(item.id))!.slice(1)}`);

    const report = await inspectLocalAssetIntegrity([item.id]);
    expect(report.valid).toEqual([]);
    expect(report.corrupt[0]?.asset.id).toBe(item.id);
  });

  it("rolls back the whole batch when one localStorage write fails", async () => {
    const first = asset("first");
    const second = asset("second");
    const storage = new FailingStorage(4);
    await expect(writeLocalAssetsAtomic([first, second], storage)).rejects.toThrow("write failed");
    expect(await listLocalAssets(storage)).toEqual([]);
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

  it("collects only old verified local records and protects journal and crash-stranded states", async () => {
    const local = asset("orphan-local");
    const publishing = asset("orphan-publishing", "publishing");
    const awaiting = asset("orphan-awaiting", "awaiting-verification");
    const journalProtected = asset("journal-protected-local");
    await writeLocalAssetsAtomic([local, publishing, awaiting, journalProtected]);

    expect(await deleteSafeOrphans([], 1000, localStorage, new Set([journalProtected.id]))).toEqual([local.id]);
    expect((await listLocalAssets()).map((item) => item.id).sort()).toEqual([
      publishing.id,
      awaiting.id,
      journalProtected.id,
    ].sort());
  });

  it("does not collect an old local record whose bytes fail integrity verification", async () => {
    const corrupt = asset("corrupt old local");
    await writeLocalAssetsAtomic([corrupt]);
    localStorage.setItem(localAssetDataKey(corrupt.id), `${localStorage.getItem(localAssetDataKey(corrupt.id))}x`);

    expect(await deleteSafeOrphans([], 1000)).toEqual([]);
    expect(localStorage.getItem(localAssetDataKey(corrupt.id))).not.toBeNull();
  });

  it.each(["publishing", "awaiting-verification"] as const)("preserves an earlier candidate that becomes %s while a later integrity check is pending", async (state) => {
    const first = asset(`race-first-${state}`);
    const second = asset(`race-second-${state}`);
    await writeLocalAssetsAtomic([first, second]);
    const [earlier, later] = await listLocalAssets();
    const earlierMetadataKey = `${LOCAL_ASSET_METADATA_PREFIX}${earlier.id}`;
    const earlierDataRaw = localStorage.getItem(localAssetDataKey(earlier.id));
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    let releaseLater!: () => void;
    const laterGate = new Promise<void>((resolve) => { releaseLater = resolve; });
    let signalLaterStarted!: () => void;
    const laterStarted = new Promise<void>((resolve) => { signalLaterStarted = resolve; });
    let integrityReads = 0;
    vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(async function (this: Blob) {
      integrityReads += 1;
      if (integrityReads === 2) {
        signalLaterStarted();
        await laterGate;
      }
      return originalArrayBuffer.call(this);
    });

    const cleanup = deleteSafeOrphans([], 1000);
    await laterStarted;
    await updateLocalAssetState([earlier.id], state);
    const protectedMetadataRaw = localStorage.getItem(earlierMetadataKey);
    releaseLater();

    expect(await cleanup).toEqual([later.id]);
    expect(localStorage.getItem(earlierMetadataKey)).toBe(protectedMetadataRaw);
    expect(localStorage.getItem(localAssetDataKey(earlier.id))).toBe(earlierDataRaw);
  });

  it("fails closed and preserves local bytes when the asset lock is unavailable", async () => {
    const local = asset("lock unavailable");
    await writeLocalAssetsAtomic([local]);
    const metadataKey = `${LOCAL_ASSET_METADATA_PREFIX}${local.id}`;
    const metadataRaw = localStorage.getItem(metadataKey);
    const dataRaw = localStorage.getItem(localAssetDataKey(local.id));
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });

    expect(await deleteSafeOrphans([], 1000)).toEqual([]);
    await expect(updateLocalAssetState([local.id], "publishing")).rejects.toThrow(/Lock/i);
    await expect(deleteLocalAssetsAtomic([local.id])).rejects.toThrow(/Lock/i);
    expect(localStorage.getItem(metadataKey)).toBe(metadataRaw);
    expect(localStorage.getItem(localAssetDataKey(local.id))).toBe(dataRaw);
  });

  it("recognizes authoritative localStorage quota failures", () => {
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

  it("exports library, ordinary patch, journal, provenance, metadata, states, and original bytes without credentials", async () => {
    const local = asset("recover me");
    const library = emptyLibrary();
    library.assets[local.id] = { id: local.id, kind: "file", mime: local.mimeType, byteLength: local.byteLength, originalName: "save.bin" };
    const patch = { patchVersion: 2 as const, schemaVersion: 2 as const, baseRevision: "", operations: {}, blobs: {} };
    const targetDatabase = finalizePublishedDatabase(emptyLibrary(), "00000000-0000-4000-8000-000000000001");
    const journal: PendingPublicationJournalV3 = {
      version: 3,
      sourceCommitSha: "a".repeat(40),
      targetCommitSha: "b".repeat(40),
      targetRevision: targetDatabase.revision,
      targetDatabase,
      remainderPatch: diffLibrary(targetDatabase, targetDatabase),
      localAssetIdsAwaitingVerification: [],
      owner: "kana-sama",
      repo: "mygameslist",
      branch: "main",
      createdAt: "2026-08-11T10:00:00.000Z",
      phase: "awaiting-deployment",
    };
    const archive = await createRecoveryArchive({
      database: library,
      patch,
      ordinaryPatchRaw: JSON.stringify(patch),
      localAssets: [local],
      deployedSourceCommitSha: "c".repeat(40),
      pending: { status: "memory-only", journal },
      githubToken: "ghp_do-not-export",
    } as Parameters<typeof createRecoveryArchive>[0] & { githubToken: string });
    const source = new TextDecoder().decode(await archive.arrayBuffer());
    expect(source.slice(0, 2)).toBe("PK");
    expect(source).toContain("library.json");
    expect(source).toContain("patch.json");
    expect(source).toContain("ordinary-patch.raw.txt");
    expect(source).toContain("provenance.json");
    expect(source).toContain("pending-publication.json");
    expect(source).toContain(journal.targetCommitSha);
    expect(source).toContain("memory-only");
    expect(source).toContain("local-assets.json");
    expect(source).toContain(`media/${local.id}.bin`);
    expect(source).toContain("recover me");
    expect(source).not.toContain("ghp_do-not-export");
  });

  it.each(["corrupt", "legacy"] as const)("preserves exact %s pending raw in the recovery ZIP", async (status) => {
    const raw = status === "corrupt" ? "{exact corrupt pending bytes" : JSON.stringify({ version: 2, exact: "legacy pending bytes" });
    const archive = await createRecoveryArchive({
      database: emptyLibrary(),
      patch: { patchVersion: 2, schemaVersion: 2, baseRevision: "", operations: {}, blobs: {} },
      ordinaryPatchRaw: null,
      localAssets: [],
      deployedSourceCommitSha: null,
      pending: { status, raw },
    });
    const source = new TextDecoder().decode(await archive.arrayBuffer());
    expect(source).toContain("pending-publication.raw.txt");
    expect(source).toContain(raw);
  });

  it("preserves exact durable journal raw and makes the legacy archive overload fail closed", async () => {
    const targetDatabase = finalizePublishedDatabase(emptyLibrary(), "00000000-0000-4000-8000-000000000001");
    const journal: PendingPublicationJournalV3 = {
      version: 3,
      sourceCommitSha: "a".repeat(40),
      targetCommitSha: "b".repeat(40),
      targetRevision: targetDatabase.revision,
      targetDatabase,
      remainderPatch: diffLibrary(targetDatabase, targetDatabase),
      localAssetIdsAwaitingVerification: [],
      owner: "kana-sama",
      repo: "mygameslist",
      branch: "main",
      createdAt: "2026-08-11T10:00:00.000Z",
      phase: "awaiting-deployment",
    };
    const raw = canonicalStringify(journal);
    const patch = diffLibrary(targetDatabase, targetDatabase);
    const archive = await createRecoveryArchive({
      database: targetDatabase,
      patch,
      ordinaryPatchRaw: null,
      localAssets: [],
      deployedSourceCommitSha: journal.targetCommitSha,
      pending: { status: "durable", journal, raw },
    });
    const source = new TextDecoder().decode(await archive.arrayBuffer());
    expect(source).toContain("pending-publication.raw.txt");
    expect(source).toContain(raw);

    await expect(createRecoveryArchive(targetDatabase, patch, [])).rejects.toThrow(/explicit pending\/provenance context/i);
  });
});
