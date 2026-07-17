import {
  LIBRARY_SCHEMA_VERSION,
  MISSING_VALUE_HASH,
  diffLibrary,
  finalizePublishedDatabase,
  makeFileAsset,
  type LibraryDatabase,
} from "../src/domain";
import {
  PENDING_PUBLICATION_STORAGE_KEY,
  assertValidPendingPublication,
  clearPendingPublication,
  installPendingPublication,
  loadPendingPublication,
  type PendingPublicationReceipt,
} from "../src/state/pendingPublication";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  failNextSet = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new DOMException("secret storage failure", "QuotaExceededError");
    }
    this.values.set(key, value);
  }
}

function base(): LibraryDatabase {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: "",
    publicationId: null,
    games: {},
    notes: {},
    assets: {},
  };
}

function receipt(): PendingPublicationReceipt {
  const bytes = new TextEncoder().encode("saved file");
  const prepared = makeFileAsset(bytes, "application/octet-stream", "save.bin");
  const draft = base();
  draft.assets[prepared.asset.id] = prepared.asset;
  const database = finalizePublishedDatabase(draft, "00000000-0000-4000-8000-000000000001");
  return {
    version: 1,
    owner: "kana-sama",
    repo: "mygameslist",
    branch: "main",
    sourceRevision: "",
    commitSha: "a".repeat(40),
    createdAt: "2026-07-17T00:00:00.000Z",
    database,
    blobs: { [prepared.asset.id]: prepared.base64 },
  };
}

describe("pending GitHub publication", () => {
  it("round-trips a validated published base and temporary media", () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_PUBLICATION_STORAGE_KEY, JSON.stringify(receipt()));
    const loaded = loadPendingPublication(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.receipt?.database.publicationId).toBe("00000000-0000-4000-8000-000000000001");
    expect(Object.keys(loaded.receipt?.blobs ?? {})).toHaveLength(1);
  });

  it("rejects media whose bytes do not match its content-addressed id", () => {
    const value = receipt();
    value.blobs[Object.keys(value.blobs)[0]] = btoa("different");
    expect(() => assertValidPendingPublication(value)).toThrow(/не совпадает|Некорректный/);
  });

  it("atomically replaces the old patch and restores it after a Safari write failure", () => {
    const storage = new MemoryStorage();
    const oldPatch = {
      patchVersion: 2 as const,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      baseRevision: "",
      operations: {
        "/games/00000000-0000-4000-8000-000000000001": {
          operation: "delete" as const,
          baseExists: false,
          baseHash: MISSING_VALUE_HASH,
          changedAt: "2026-07-17T00:00:00.000Z",
          transactionId: "old",
        },
      },
      blobs: {},
    };
    storage.setItem("my-game-library.patch.v1", JSON.stringify(oldPatch));
    const previous = storage.getItem("my-game-library.patch.v1");
    storage.failNextSet = true;
    const result = installPendingPublication(storage, receipt(), diffLibrary(receipt().database, receipt().database));
    expect(result.ok).toBe(false);
    expect(storage.getItem("my-game-library.patch.v1")).toBe(previous);
  });

  it("installs an empty remaining patch and can clear the receipt", () => {
    const storage = new MemoryStorage();
    const pending = receipt();
    const empty = diffLibrary(pending.database, pending.database);
    expect(installPendingPublication(storage, pending, empty)).toEqual({ ok: true });
    expect(storage.getItem("my-game-library.patch.v1")).toBeNull();
    expect(loadPendingPublication(storage).receipt?.commitSha).toBe("a".repeat(40));
    expect(clearPendingPublication(storage)).toBe(true);
    expect(storage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).toBeNull();
  });

  it("does not expose raw corrupted data in its error", () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_PUBLICATION_STORAGE_KEY, "secret-token-not-json");
    const loaded = loadPendingPublication(storage);
    expect(loaded.error?.message).toBe("Ожидающая публикация повреждена");
    expect(loaded.error?.message).not.toContain("secret-token");
  });
});
