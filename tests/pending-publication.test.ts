import {
  LIBRARY_SCHEMA_VERSION,
  PATCH_STORAGE_KEY,
  canonicalStringify,
  diffLibrary,
  finalizePublishedDatabase,
  makeFileAsset,
  normalizeLibraryDatabase,
  reconcilePatch,
  withComputedRevision,
  type LibraryDatabase,
  type PatchEnvelope,
} from "../src/domain";
import {
  PENDING_PUBLICATION_STORAGE_KEY,
  assertValidPendingPublicationJournal,
  clearPendingPublication,
  discardPendingPublicationAfterRecoveryExport,
  finalizePendingPublicationJournal,
  installPendingPublication,
  installPendingPublicationJournal,
  loadPendingPublication,
  loadPendingPublicationJournal,
  type PendingPublicationJournalV3,
  type PendingPublicationReceipt,
} from "../src/state/pendingPublication";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  failGetAt = Number.POSITIVE_INFINITY;
  failSetAt = Number.POSITIVE_INFINITY;
  failRemoveAt = Number.POSITIVE_INFINITY;
  ignoreRemoveAt = Number.POSITIVE_INFINITY;
  getCount = 0;
  setCount = 0;
  removeCount = 0;
  readOverride: ((key: string, value: string | null, count: number) => string | null) | null = null;
  beforeRemove: ((key: string) => void) | null = null;
  beforeSet: ((key: string, value: string) => void) | null = null;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null {
    this.getCount += 1;
    this.calls.push(`get:${key}`);
    if (this.getCount === this.failGetAt) throw new DOMException("secret read failure", "SecurityError");
    const value = this.values.get(key) ?? null;
    return this.readOverride?.(key, value, this.getCount) ?? value;
  }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void {
    this.removeCount += 1;
    this.calls.push(`remove:${key}`);
    if (this.removeCount === this.failRemoveAt) throw new DOMException("secret remove failure", "SecurityError");
    if (this.removeCount === this.ignoreRemoveAt) return;
    this.beforeRemove?.(key);
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.setCount += 1;
    this.calls.push(`set:${key}`);
    if (this.setCount === this.failSetAt) throw new DOMException("secret set failure", "QuotaExceededError");
    this.beforeSet?.(key, value);
    this.values.set(key, String(value));
  }
  resetTrace(): void {
    this.calls.length = 0;
    this.getCount = 0;
    this.setCount = 0;
    this.removeCount = 0;
  }
}

class ExclusiveTestLockManager {
  readonly requests: string[] = [];
  private readonly tails = new Map<string, Promise<void>>();

  request<T>(name: string, _options: LockOptions, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<Awaited<T>> {
    this.requests.push(name);
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

let testLocks: ExclusiveTestLockManager;

beforeEach(() => {
  testLocks = new ExclusiveTestLockManager();
  Object.defineProperty(navigator, "locks", { configurable: true, value: testLocks });
});

const SOURCE_SHA_40 = "a".repeat(40);
const TARGET_SHA_40 = "b".repeat(40);
const SOURCE_SHA_64 = "a".repeat(64);
const TARGET_SHA_64 = "b".repeat(64);
const GAME_ID = "00000000-0000-4000-8000-000000000002";
const NOTE_ID = "00000000-0000-4000-8000-000000000003";

function draftLibrary(title = "Saved game"): LibraryDatabase {
  const prepared = makeFileAsset(new TextEncoder().encode("saved file"), "application/octet-stream", "save.bin");
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: "",
    publicationId: null,
    games: {
      [GAME_ID]: {
        id: GAME_ID,
        title,
        coverAssetId: null,
        platforms: [],
        tags: [],
        status: "playing",
        placement: { tierId: "unranked", rank: 1024 },
        reviewMarkdown: "",
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    },
    notes: {
      [NOTE_ID]: {
        id: NOTE_ID,
        gameId: GAME_ID,
        bodyMarkdown: "",
        attachments: [{ type: "file", assetId: prepared.asset.id, label: "Save" }],
        rank: 1024,
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
    },
    assets: { [prepared.asset.id]: prepared.asset },
  };
}

function publishedLibrary(publicationId = "00000000-0000-4000-8000-000000000001", title = "Saved game"): LibraryDatabase {
  return finalizePublishedDatabase(draftLibrary(title), publicationId);
}

function editedPatch(base: LibraryDatabase, title = "Local remainder"): PatchEnvelope {
  const edited = structuredClone(base);
  edited.games[GAME_ID].title = title;
  return diffLibrary(base, edited, {
    changedAt: "2026-08-11T10:00:00.000Z",
    transactionId: `title-${title}`,
  });
}

function redundantTitlePatch(base: LibraryDatabase): PatchEnvelope {
  const patch = editedPatch(base, "Temporary different title");
  const path = `/games/${GAME_ID}/title`;
  patch.operations[path] = { ...patch.operations[path], value: base.games[GAME_ID].title };
  return patch;
}

function nonNormalizedPublishedLibrary(kind: "progress" | "note-defaults", publicationId = "00000000-0000-4000-8000-000000000001"): LibraryDatabase {
  const database = publishedLibrary(publicationId);
  if (kind === "progress") database.games[GAME_ID].progressItems = [];
  else Object.assign(database.notes[NOTE_ID], {
    groupRank: 1024,
    doubleWidth: false,
    doubleHeight: false,
    collapsedChecklistSections: [],
  });
  return withComputedRevision(database);
}

function journal(overrides: Partial<PendingPublicationJournalV3> = {}): PendingPublicationJournalV3 {
  const targetDatabase = overrides.targetDatabase ?? publishedLibrary();
  return {
    version: 3,
    sourceCommitSha: SOURCE_SHA_40,
    targetCommitSha: TARGET_SHA_40,
    targetRevision: targetDatabase.revision,
    targetDatabase,
    remainderPatch: diffLibrary(targetDatabase, targetDatabase),
    localAssetIdsAwaitingVerification: Object.keys(targetDatabase.assets).sort(),
    owner: "kana-sama",
    repo: "mygameslist",
    branch: "main",
    createdAt: "2026-08-11T10:00:00.000Z",
    phase: "awaiting-deployment",
    ...overrides,
  };
}

function legacyReceipt(version: 1 | 2 = 2): PendingPublicationReceipt {
  const database = publishedLibrary();
  const common = {
    owner: "kana-sama",
    repo: "mygameslist",
    branch: "main",
    sourceRevision: database.revision,
    commitSha: TARGET_SHA_40,
    createdAt: "2026-08-11T10:00:00.000Z",
    database,
  };
  return version === 1
    ? { ...common, version, blobs: {} }
    : { ...common, version, assetIds: Object.keys(database.assets) };
}

function storedPatchRaw(patch: PatchEnvelope): string | null {
  return Object.keys(patch.operations).length === 0 ? null : JSON.stringify({ ...patch, blobs: {} });
}

describe("pending publication journal v3 validation and load", () => {
  it("round-trips one exact-key v3 record without aliasing caller or loaded objects", async () => {
    const storage = new MemoryStorage();
    const input = journal();
    const expectedTitle = input.targetDatabase.games[GAME_ID].title;
    const installed = await installPendingPublicationJournal(storage, input, { expectedRaw: null });
    expect(installed.status).toBe("durable");
    expect(storage.calls.filter((call) => call === `set:${PENDING_PUBLICATION_STORAGE_KEY}`)).toHaveLength(1);
    input.targetDatabase.games[GAME_ID].title = "mutated caller";
    input.localAssetIdsAwaitingVerification = [];
    const first = loadPendingPublicationJournal(storage);
    expect(first.status).toBe("valid");
    if (first.status !== "valid") return;
    expect(first.journal.targetDatabase.games[GAME_ID].title).toBe(expectedTitle);
    expect(first.raw).toBe(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY));
    first.journal.targetDatabase.games[GAME_ID].title = "mutated load";
    expect(loadPendingPublicationJournal(storage)).toMatchObject({
      status: "valid",
      journal: { targetDatabase: { games: { [GAME_ID]: { title: expectedTitle } } } },
    });
  });

  it.each(Object.keys(journal()))("rejects a missing required top-level key: %s", (key) => {
    const value = structuredClone(journal()) as unknown as Record<string, unknown>;
    delete value[key];
    expect(() => assertValidPendingPublicationJournal(value)).toThrow(/v3/i);
  });

  it("rejects unknown keys and wrong types", () => {
    expect(() => assertValidPendingPublicationJournal({ ...journal(), surprise: true })).toThrow(/v3/i);
    for (const [key, wrong] of [
      ["version", "3"], ["sourceCommitSha", 1], ["targetCommitSha", null], ["targetRevision", false],
      ["targetDatabase", []], ["remainderPatch", "patch"], ["localAssetIdsAwaitingVerification", "asset"],
      ["owner", []], ["repo", 1], ["branch", null], ["createdAt", 0], ["phase", true],
    ] as const) {
      const value = structuredClone(journal()) as unknown as Record<string, unknown>;
      value[key] = wrong;
      expect(() => assertValidPendingPublicationJournal(value), key).toThrow(/v3|Данные|Некоррект|Ожид|патч|публикац|target|asset|репозитор|ветк|дат|фаз/i);
    }
  });

  it("rejects target revision, awaiting patch base, and awaited-asset mismatches", () => {
    expect(() => assertValidPendingPublicationJournal(journal({ targetRevision: "f".repeat(64) }))).toThrow(/revision/i);
    const wrongBase = { ...journal().remainderPatch, baseRevision: "f".repeat(64) };
    expect(() => assertValidPendingPublicationJournal(journal({ remainderPatch: wrongBase }))).toThrow(/patch|base|revision/i);
    expect(() => assertValidPendingPublicationJournal(journal({ localAssetIdsAwaitingVerification: ["f".repeat(64)] }))).toThrow(/asset/i);
  });

  it.each(["progress", "note-defaults"] as const)("rejects a source-valid but non-normalized %s target with a recomputed revision", async (kind) => {
    const targetDatabase = nonNormalizedPublishedLibrary(kind);
    expect(targetDatabase).not.toEqual(normalizeLibraryDatabase(targetDatabase));
    const input = journal({ targetDatabase, targetRevision: targetDatabase.revision });
    const storage = new MemoryStorage();
    const raw = canonicalStringify(input);
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);

    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "corrupt", raw });
    const destination = new MemoryStorage();
    await expect(installPendingPublicationJournal(destination, input, { expectedRaw: null })).rejects.toThrow(/normal|норм|канон/i);
    expect(destination.calls).toEqual([]);
  });

  it("rejects an applicable awaiting patch that deterministic reconciliation prunes", async () => {
    const targetDatabase = publishedLibrary();
    const remainderPatch = redundantTitlePatch(targetDatabase);
    expect(reconcilePatch(targetDatabase, remainderPatch)).toMatchObject({ conflicts: [], prunedCount: 1, patch: { operations: {} } });
    const input = journal({ targetDatabase, targetRevision: targetDatabase.revision, remainderPatch });
    const storage = new MemoryStorage();
    const raw = canonicalStringify(input);
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);

    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "corrupt", raw });
    const destination = new MemoryStorage();
    await expect(installPendingPublicationJournal(destination, input, { expectedRaw: null })).rejects.toThrow(/reconcil|детерминир|патч/i);
    expect(destination.calls).toEqual([]);
  });

  it("accepts matching 40- and 64-character Git IDs and rejects uppercase, invalid, or mixed lengths", () => {
    expect(() => assertValidPendingPublicationJournal(journal())).not.toThrow();
    expect(() => assertValidPendingPublicationJournal(journal({ sourceCommitSha: SOURCE_SHA_64, targetCommitSha: TARGET_SHA_64 }))).not.toThrow();
    for (const [sourceCommitSha, targetCommitSha] of [
      [SOURCE_SHA_40.toUpperCase(), TARGET_SHA_40], [SOURCE_SHA_40, TARGET_SHA_40.toUpperCase()],
      ["a".repeat(39), TARGET_SHA_40], [SOURCE_SHA_40, "b".repeat(65)], [SOURCE_SHA_40, TARGET_SHA_64],
    ]) expect(() => assertValidPendingPublicationJournal(journal({ sourceCommitSha, targetCommitSha }))).toThrow();
  });

  it("rejects noncanonical timestamps, repository coordinates, phases, and asset lists", () => {
    for (const overrides of [
      { createdAt: "2026-08-11T10:00:00Z" }, { createdAt: "2026-02-30T10:00:00.000Z" },
      { owner: "-owner" }, { repo: ".." }, { branch: "refs/../main" }, { branch: "/main" },
      { phase: "waiting" as never },
      { localAssetIdsAwaitingVerification: ["b".repeat(64), "a".repeat(64)] },
      { localAssetIdsAwaitingVerification: [Object.keys(publishedLibrary().assets)[0], Object.keys(publishedLibrary().assets)[0]] },
    ]) expect(() => assertValidPendingPublicationJournal(journal(overrides))).toThrow(/Некоррект|Git|asset|спис|репозитор|ветк|дат|фаз/i);
  });

  it("preserves corrupt raw data and never falls back to an ordinary patch", () => {
    const storage = new MemoryStorage();
    const raw = "{not-json:secret-pending-text";
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    storage.values.set(PATCH_STORAGE_KEY, JSON.stringify(editedPatch(publishedLibrary(), "must stay ignored")));
    const loaded = loadPendingPublicationJournal(storage);
    expect(loaded).toMatchObject({ status: "corrupt", raw });
    expect(loaded.status === "corrupt" ? loaded.error.message : "").not.toContain("secret-pending-text");
    expect(storage.calls).not.toContain(`get:${PATCH_STORAGE_KEY}`);
  });

  it("preserves the exact raw bytes of a parseable but invalid v3 shape", () => {
    const storage = new MemoryStorage();
    const raw = canonicalStringify({ ...journal(), targetRevision: false });
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "corrupt", raw });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(raw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it.each(["duplicate-key", "whitespace", "reordered"] as const)("classifies noncanonical v3 %s bytes as corrupt while preserving exact raw", (kind) => {
    const storage = new MemoryStorage();
    const canonical = canonicalStringify(journal());
    const raw = kind === "duplicate-key"
      ? canonical.replace('"version":3', '"version":3,"version":3')
      : kind === "whitespace"
        ? ` ${canonical}`
        : (() => {
            const { phase, ...rest } = journal();
            return JSON.stringify({ phase, ...rest });
          })();
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "corrupt", raw });
  });

  it("rejects compact v3 bytes with reordered nested database keys", () => {
    const storage = new MemoryStorage();
    const value = journal();
    const database = value.targetDatabase;
    value.targetDatabase = {
      publicationId: database.publicationId,
      assets: database.assets,
      notes: database.notes,
      games: database.games,
      revision: database.revision,
      schemaVersion: database.schemaVersion,
    };
    const raw = JSON.stringify(value);
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "corrupt", raw });
  });

  it.each([1, 2] as const)("classifies strict legacy v%s raw without upgrading or mutating it", (version) => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify(legacyReceipt(version));
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    const loaded = loadPendingPublicationJournal(storage);
    expect(loaded.status).toBe("legacy");
    if (loaded.status !== "legacy") return;
    expect(loaded.raw).toBe(raw);
    expect(loaded.recovery?.database.revision).toBe(legacyReceipt(version).database.revision);
    expect(loaded.recovery?.assetIds).toEqual(version === 1 ? [] : legacyReceipt(2).assetIds);
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(raw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("keeps malformed legacy raw blocking and distinguishes absent/read failure", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ version: 2, token: "must-not-enter-error" });
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    const loaded = loadPendingPublicationJournal(storage);
    expect(loaded).toMatchObject({ status: "legacy", raw, recovery: null });
    expect(loaded.status === "legacy" ? loaded.error.message : "").not.toContain("must-not-enter-error");
    expect(loadPendingPublicationJournal(new MemoryStorage())).toEqual({ status: "absent" });
    const denied = new MemoryStorage();
    denied.failGetAt = 1;
    expect(loadPendingPublicationJournal(denied)).toMatchObject({ status: "read_failure", error: expect.any(Error) });
  });
});

describe("pending publication journal install and recovery update", () => {
  it("uses one setItem, read-verifies, and leaves ordinary patch bytes untouched", async () => {
    const storage = new MemoryStorage();
    const ordinaryRaw = "{\"deliberately\":\"opaque ordinary patch bytes\"}";
    storage.values.set(PATCH_STORAGE_KEY, ordinaryRaw);
    const installed = await installPendingPublicationJournal(storage, journal(), { expectedRaw: null });
    expect(installed.status).toBe("durable");
    expect(storage.calls.filter((call) => call.startsWith("set:"))).toEqual([`set:${PENDING_PUBLICATION_STORAGE_KEY}`]);
    expect(storage.calls.some((call) => call.startsWith("remove:"))).toBe(false);
    expect(storage.values.get(PATCH_STORAGE_KEY)).toBe(ordinaryRaw);
    expect(storage.calls.filter((call) => call === `get:${PENDING_PUBLICATION_STORAGE_KEY}`).length).toBeGreaterThanOrEqual(2);
  });

  it.each(["prewrite-read-failure", "quota", "readback-mismatch", "readback-failure", "budget"] as const)("returns a complete memory-only journal after %s", async (failure) => {
    const storage = new MemoryStorage();
    if (failure === "prewrite-read-failure") storage.failGetAt = 1;
    if (failure === "quota") storage.failSetAt = 1;
    if (failure === "readback-mismatch") {
      let pendingReads = 0;
      storage.readOverride = (key, value) => {
        if (key !== PENDING_PUBLICATION_STORAGE_KEY) return value;
        pendingReads += 1;
        return pendingReads >= 3 ? `${value ?? ""}x` : value;
      };
    }
    if (failure === "readback-failure") {
      let pendingReads = 0;
      storage.readOverride = (key, value) => {
        if (key !== PENDING_PUBLICATION_STORAGE_KEY) return value;
        pendingReads += 1;
        if (pendingReads >= 3) throw new DOMException("secret read failure", "SecurityError");
        return value;
      };
    }
    if (failure === "budget") storage.values.set("filler", "x".repeat(2_000_000));
    const input = journal();
    const result = await installPendingPublicationJournal(storage, input, { expectedRaw: null });
    expect(result.status).toBe("memory_only");
    if (result.status !== "memory_only") return;
    expect(result.journal).toEqual(input);
    expect(result.journal).not.toBe(input);
    expect(result.journal.localAssetIdsAwaitingVerification).toEqual(input.localAssetIdsAwaitingVerification);
    expect(result.error.message).not.toMatch(/secret/);
  });

  it("does not overwrite an existing journal when an initial install expects absence", async () => {
    const storage = new MemoryStorage();
    const currentRaw = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    const ordinaryRaw = "opaque ordinary patch";
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, currentRaw);
    storage.values.set(PATCH_STORAGE_KEY, ordinaryRaw);

    expect(await installPendingPublicationJournal(storage, journal(), { expectedRaw: null })).toEqual({
      status: "changed",
      currentRaw,
    });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(currentRaw);
    expect(storage.values.get(PATCH_STORAGE_KEY)).toBe(ordinaryRaw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("does not overwrite a newer journal when an update names an exact prior raw", async () => {
    const storage = new MemoryStorage();
    const priorRaw = canonicalStringify(journal());
    const currentRaw = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, currentRaw);

    expect(await installPendingPublicationJournal(
      storage,
      journal({ createdAt: "2026-08-11T12:00:00.000Z" }),
      { expectedRaw: priorRaw },
    )).toEqual({ status: "changed", currentRaw });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(currentRaw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it.each([
    ["corrupt", "{corrupt recovery bytes"],
    ["legacy", JSON.stringify(legacyReceipt(2))],
  ] as const)("does not replace exact matching %s recovery bytes", async (_kind, currentRaw) => {
    const storage = new MemoryStorage();
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, currentRaw);

    expect(await installPendingPublicationJournal(storage, journal(), { expectedRaw: currentRaw })).toEqual({
      status: "changed",
      currentRaw,
    });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(currentRaw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("keeps a cross-tab journal installed while a memory-only initial retry was pending", async () => {
    const storage = new MemoryStorage();
    storage.failSetAt = 1;
    const memory = await installPendingPublicationJournal(storage, journal(), { expectedRaw: null });
    expect(memory.status).toBe("memory_only");
    if (memory.status !== "memory_only") return;
    const currentRaw = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    storage.failSetAt = Number.POSITIVE_INFINITY;
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, currentRaw);
    storage.resetTrace();

    expect(await installPendingPublicationJournal(storage, memory.journal, { expectedRaw: null })).toEqual({
      status: "changed",
      currentRaw,
    });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(currentRaw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("rechecks expected raw immediately before setItem and preserves a late replacement", async () => {
    const storage = new MemoryStorage();
    const currentRaw = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    let pendingReads = 0;
    storage.readOverride = (key, value) => {
      if (key !== PENDING_PUBLICATION_STORAGE_KEY) return value;
      pendingReads += 1;
      if (pendingReads === 2) {
        storage.values.set(key, currentRaw);
        return currentRaw;
      }
      return value;
    };

    expect(await installPendingPublicationJournal(storage, journal(), { expectedRaw: null })).toEqual({
      status: "changed",
      currentRaw,
    });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(currentRaw);
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("validates entirely before touching storage", async () => {
    const storage = new MemoryStorage();
    await expect(installPendingPublicationJournal(storage, journal({ targetRevision: "f".repeat(64) }), { expectedRaw: null })).rejects.toThrow();
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("fails closed without a cross-context journal lock", async () => {
    const input = journal();
    const storage = new MemoryStorage();
    expect(await installPendingPublicationJournal(storage, input, { expectedRaw: null, lockManager: null })).toMatchObject({
      status: "memory_only",
      journal: input,
    });
    expect(storage.calls).toEqual([]);

    const raw = canonicalStringify(input);
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    storage.resetTrace();
    expect(await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: input.targetDatabase,
      reconciledRemainderPatch: input.remainderPatch,
      expectedJournalRaw: raw,
      lockManager: null,
    })).toMatchObject({ status: "failure", stage: "lock" });
    expect(await discardPendingPublicationAfterRecoveryExport(storage, "{corrupt", { lockManager: null })).toMatchObject({ status: "failure" });
    expect(storage.calls).toEqual([]);
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(raw);
  });

  it("loads recovery structurally but requires the exact descendant base to install and update", async () => {
    const target = publishedLibrary();
    const descendant = finalizePublishedDatabase(draftLibrary("Descendant"), "00000000-0000-4000-8000-000000000004");
    const recovery = journal({
      targetDatabase: target,
      targetRevision: target.revision,
      phase: "recovery-required",
      remainderPatch: editedPatch(descendant, "Resolved locally"),
    });
    const storage = new MemoryStorage();
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, canonicalStringify(recovery));
    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "valid", journal: { phase: "recovery-required" } });
    const destination = new MemoryStorage();
    await expect(installPendingPublicationJournal(destination, recovery, { expectedRaw: null })).rejects.toThrow();
    await expect(installPendingPublicationJournal(destination, recovery, { expectedRaw: null, recoveryBaseDatabase: target })).rejects.toThrow();
    const installed = await installPendingPublicationJournal(destination, recovery, { expectedRaw: null, recoveryBaseDatabase: descendant });
    expect(installed.status).toBe("durable");
    if (installed.status !== "durable") return;
    const updated = { ...recovery, remainderPatch: editedPatch(descendant, "Manual resolution survives") };
    expect((await installPendingPublicationJournal(destination, updated, {
      expectedRaw: installed.raw,
      recoveryBaseDatabase: descendant,
    })).status).toBe("durable");
    expect(loadPendingPublicationJournal(destination)).toMatchObject({
      status: "valid",
      journal: { remainderPatch: { operations: { [`/games/${GAME_ID}/title`]: { value: "Manual resolution survives" } } } },
    });
  });

  it("rejects a non-normalized recovery base before any storage access", async () => {
    const target = publishedLibrary();
    const recoveryBase = nonNormalizedPublishedLibrary("note-defaults", "00000000-0000-4000-8000-000000000004");
    expect(recoveryBase).not.toEqual(normalizeLibraryDatabase(recoveryBase));
    const recovery = journal({
      targetDatabase: target,
      targetRevision: target.revision,
      phase: "recovery-required",
      remainderPatch: editedPatch(recoveryBase, "Resolved locally"),
    });
    const storage = new MemoryStorage();

    await expect(installPendingPublicationJournal(storage, recovery, {
      expectedRaw: null,
      recoveryBaseDatabase: recoveryBase,
    })).rejects.toThrow(/normal|норм|канон/i);
    expect(storage.calls).toEqual([]);
  });

  it("rejects a recovery update whose applicable patch is not the deterministic reconciliation", async () => {
    const target = publishedLibrary();
    const recoveryBase = finalizePublishedDatabase(draftLibrary("Descendant"), "00000000-0000-4000-8000-000000000004");
    const initial = journal({
      targetDatabase: target,
      targetRevision: target.revision,
      phase: "recovery-required",
      remainderPatch: editedPatch(recoveryBase, "Initial resolution"),
    });
    const storage = new MemoryStorage();
    const installed = await installPendingPublicationJournal(storage, initial, { expectedRaw: null, recoveryBaseDatabase: recoveryBase });
    if (installed.status !== "durable") throw new Error("fixture install failed");
    storage.resetTrace();
    const redundant = redundantTitlePatch(recoveryBase);
    expect(reconcilePatch(recoveryBase, redundant)).toMatchObject({ conflicts: [], prunedCount: 1, patch: { operations: {} } });

    await expect(installPendingPublicationJournal(storage, { ...initial, remainderPatch: redundant }, {
      expectedRaw: installed.raw,
      recoveryBaseDatabase: recoveryBase,
    })).rejects.toThrow(/reconcil|детерминир|патч/i);
    expect(storage.calls).toEqual([]);
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(installed.raw);
  });
});

describe("pending publication journal finalization", () => {
  async function installedJournal(storage: MemoryStorage, input: PendingPublicationJournalV3): Promise<string> {
    const result = await installPendingPublicationJournal(storage, input, { expectedRaw: null });
    if (result.status !== "durable") throw new Error("fixture install failed");
    storage.resetTrace();
    return result.raw;
  }

  it("persists/read-verifies remainder before exact journal CAS removal", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    const result = await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    });
    expect(result).toMatchObject({ status: "finalized", idempotent: false, patchRaw: storedPatchRaw(remainderPatch) });
    const patchSet = storage.calls.indexOf(`set:${PATCH_STORAGE_KEY}`);
    const patchVerify = storage.calls.indexOf(`get:${PATCH_STORAGE_KEY}`, patchSet + 1);
    const journalCas = storage.calls.indexOf(`get:${PENDING_PUBLICATION_STORAGE_KEY}`, patchVerify + 1);
    const journalRemove = storage.calls.indexOf(`remove:${PENDING_PUBLICATION_STORAGE_KEY}`);
    const journalVerify = storage.calls.indexOf(`get:${PENDING_PUBLICATION_STORAGE_KEY}`, journalRemove + 1);
    expect(patchSet).toBeGreaterThanOrEqual(0);
    expect(patchVerify).toBeGreaterThan(patchSet);
    expect(journalCas).toBeGreaterThan(patchVerify);
    expect(journalRemove).toBeGreaterThan(journalCas);
    expect(journalVerify).toBeGreaterThan(journalRemove);
  });

  it("rejects a valid but unrelated remainder for the exact stored awaiting journal with zero mutation", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const journalRemainder = editedPatch(target, "Journal intent");
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch: journalRemainder }));
    const unrelatedRemainder = diffLibrary(target, target);
    const result = await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: unrelatedRemainder,
      expectedJournalRaw: raw,
    });
    expect(result).toMatchObject({ status: "failure", stage: "validation" });
    expect(storage.calls).toEqual([]);
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(raw);
  });

  it("accepts exactly the clean deterministic reconciliation of an awaiting journal onto a descendant base", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const journalRemainder = editedPatch(target, "Journal intent");
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch: journalRemainder }));
    const descendant = finalizePublishedDatabase(draftLibrary(), "00000000-0000-4000-8000-000000000004");
    const reconciled = reconcilePatch(descendant, journalRemainder);
    expect(reconciled.conflicts).toEqual([]);
    expect(await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: descendant,
      reconciledRemainderPatch: reconciled.patch,
      expectedJournalRaw: raw,
    })).toMatchObject({ status: "finalized" });
  });

  it("rejects a recovery finalization whose supplied remainder does not match the stored descendant-based intent", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const descendant = finalizePublishedDatabase(draftLibrary(), "00000000-0000-4000-8000-000000000004");
    const recoveryRemainder = editedPatch(descendant, "Recovery intent");
    const recoveryJournal = journal({
      targetDatabase: target,
      targetRevision: target.revision,
      phase: "recovery-required",
      remainderPatch: recoveryRemainder,
    });
    const installed = await installPendingPublicationJournal(storage, recoveryJournal, { expectedRaw: null, recoveryBaseDatabase: descendant });
    if (installed.status !== "durable") throw new Error("fixture install failed");
    storage.resetTrace();
    const result = await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: descendant,
      reconciledRemainderPatch: diffLibrary(descendant, descendant),
      expectedJournalRaw: installed.raw,
    });
    expect(result).toMatchObject({ status: "failure", stage: "validation" });
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(installed.raw);
  });

  it("rejects rebasing a recovery journal onto a different deployed revision even when field hashes remain clean", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const recoveryBase = finalizePublishedDatabase(draftLibrary(), "00000000-0000-4000-8000-000000000004");
    const recoveryRemainder = editedPatch(recoveryBase, "Recovery intent");
    const recoveryJournal = journal({
      targetDatabase: target,
      targetRevision: target.revision,
      phase: "recovery-required",
      remainderPatch: recoveryRemainder,
    });
    const installed = await installPendingPublicationJournal(storage, recoveryJournal, { expectedRaw: null, recoveryBaseDatabase: recoveryBase });
    if (installed.status !== "durable") throw new Error("fixture install failed");
    storage.resetTrace();
    const differentRevision = finalizePublishedDatabase(draftLibrary(), "00000000-0000-4000-8000-000000000005");
    const cleanButWrongBase = reconcilePatch(differentRevision, recoveryRemainder);
    expect(cleanButWrongBase.conflicts).toEqual([]);
    expect(await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: differentRevision,
      reconciledRemainderPatch: cleanButWrongBase.patch,
      expectedJournalRaw: installed.raw,
    })).toMatchObject({ status: "failure", stage: "validation" });
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });

  it("removes an empty patch before journal removal", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = diffLibrary(target, target);
    storage.values.set(PATCH_STORAGE_KEY, "old ordinary bytes");
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    expect(await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    })).toMatchObject({ status: "finalized", patchRaw: null });
    expect(storage.calls.indexOf(`remove:${PATCH_STORAGE_KEY}`)).toBeLessThan(storage.calls.lastIndexOf(`remove:${PENDING_PUBLICATION_STORAGE_KEY}`));
  });

  it.each(["initial-journal-read", "patch-write", "patch-read", "patch-read-mismatch", "journal-read", "journal-remove", "journal-remove-verify"] as const)("keeps blocking after %s failure", async (failure) => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    if (failure === "initial-journal-read") storage.failGetAt = 1;
    if (failure === "patch-write") storage.failSetAt = 1;
    if (failure === "patch-read") storage.failGetAt = 2;
    if (failure === "patch-read-mismatch") {
      storage.readOverride = (key, value) => key === PATCH_STORAGE_KEY ? `${value ?? ""}x` : value;
    }
    if (failure === "journal-read") storage.failGetAt = 3;
    if (failure === "journal-remove") storage.failRemoveAt = 1;
    if (failure === "journal-remove-verify") storage.failGetAt = 4;
    const result = await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    });
    expect(result.status).not.toBe("finalized");
    if (failure !== "journal-remove-verify") expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(raw);
  });

  it("reports a failed removal verification when storage silently keeps the exact journal", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    storage.ignoreRemoveAt = 1;

    expect(await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    })).toMatchObject({ status: "failure", stage: "journal-remove-read" });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(raw);
  });

  it("preserves a cross-tab replacement at CAS", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    const replacement = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    let pendingReads = 0;
    storage.readOverride = (key, value) => {
      if (key !== PENDING_PUBLICATION_STORAGE_KEY) return value;
      pendingReads += 1;
      if (pendingReads === 2) { storage.values.set(key, replacement); return replacement; }
      return value;
    };
    const result = await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    });
    expect(result).toMatchObject({ status: "changed", currentRaw: replacement });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(replacement);
    expect(storage.calls).not.toContain(`remove:${PENDING_PUBLICATION_STORAGE_KEY}`);
  });

  it("queues an official initial install started during final journal removal", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    const replacement = journal({ createdAt: "2026-08-11T11:00:00.000Z" });
    let replacementInstall: ReturnType<typeof installPendingPublicationJournal> | null = null;
    storage.beforeRemove = (key) => {
      if (key !== PENDING_PUBLICATION_STORAGE_KEY || replacementInstall !== null) return;
      replacementInstall = installPendingPublicationJournal(storage, replacement, { expectedRaw: null });
    };

    const finalized = await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    });
    expect(finalized).toMatchObject({ status: "finalized" });
    expect(replacementInstall).not.toBeNull();
    const replacementResult = await replacementInstall!;
    expect(replacementResult).toMatchObject({ status: "durable" });
    if (replacementResult.status !== "durable") return;
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(replacementResult.raw);
  });

  it("does not touch the ordinary patch when the journal changed before finalization starts", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    const replacement = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, replacement);

    expect(await finalizePendingPublicationJournal(storage, {
      deployedBaseDatabase: target,
      reconciledRemainderPatch: remainderPatch,
      expectedJournalRaw: raw,
    })).toEqual({ status: "changed", currentRaw: replacement });
    expect(storage.calls.some((call) => call === `set:${PATCH_STORAGE_KEY}` || call === `remove:${PATCH_STORAGE_KEY}`)).toBe(false);
  });

  it("replays before clear and converges idempotently after clear", async () => {
    const storage = new MemoryStorage();
    const target = publishedLibrary();
    const remainderPatch = editedPatch(target);
    const raw = await installedJournal(storage, journal({ targetDatabase: target, targetRevision: target.revision, remainderPatch }));
    storage.failRemoveAt = 1;
    expect((await finalizePendingPublicationJournal(storage, { deployedBaseDatabase: target, reconciledRemainderPatch: remainderPatch, expectedJournalRaw: raw })).status).toBe("failure");
    storage.failRemoveAt = Number.POSITIVE_INFINITY;
    storage.resetTrace();
    expect(await finalizePendingPublicationJournal(storage, { deployedBaseDatabase: target, reconciledRemainderPatch: remainderPatch, expectedJournalRaw: raw })).toMatchObject({ status: "finalized", idempotent: false });
    storage.resetTrace();
    expect(await finalizePendingPublicationJournal(storage, { deployedBaseDatabase: target, reconciledRemainderPatch: remainderPatch, expectedJournalRaw: raw })).toMatchObject({ status: "finalized", idempotent: true });
    expect(storage.calls.some((call) => call.startsWith("set:") || call.startsWith("remove:"))).toBe(false);
  });
});

describe("compare-and-clear after recovery export", () => {
  it.each([
    ["recovery", () => canonicalStringify(journal({ phase: "recovery-required" }))],
    ["corrupt", () => "{corrupt exact raw"],
    ["legacy", () => JSON.stringify(legacyReceipt(2))],
  ] as const)("clears exact %s raw and verifies absence", async (_label, makeRaw) => {
    const storage = new MemoryStorage();
    const raw = makeRaw();
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    expect(await discardPendingPublicationAfterRecoveryExport(storage, raw)).toEqual({ status: "cleared" });
    expect(storage.calls.slice(-2)).toEqual([`remove:${PENDING_PUBLICATION_STORAGE_KEY}`, `get:${PENDING_PUBLICATION_STORAGE_KEY}`]);
  });

  it("refuses awaiting state and preserves a newer cross-tab raw", async () => {
    const storage = new MemoryStorage();
    const awaitingRaw = canonicalStringify(journal());
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, awaitingRaw);
    expect((await discardPendingPublicationAfterRecoveryExport(storage, awaitingRaw)).status).toBe("not_recoverable");
    const newerRaw = canonicalStringify(journal({ createdAt: "2026-08-11T11:00:00.000Z" }));
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, newerRaw);
    expect(await discardPendingPublicationAfterRecoveryExport(storage, "{old corrupt")).toEqual({ status: "changed", currentRaw: newerRaw });
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(newerRaw);
  });

  it("clears exact noncanonical v3 raw after load classified it as corrupt", async () => {
    const storage = new MemoryStorage();
    const raw = ` ${canonicalStringify(journal())}`;
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    expect(loadPendingPublicationJournal(storage)).toMatchObject({ status: "corrupt", raw });
    expect(await discardPendingPublicationAfterRecoveryExport(storage, raw)).toEqual({ status: "cleared" });
  });

  it("queues an official initial install started during exported recovery removal", async () => {
    const storage = new MemoryStorage();
    const raw = "{corrupt exact raw";
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    const replacement = journal({ createdAt: "2026-08-11T11:00:00.000Z" });
    let replacementInstall: ReturnType<typeof installPendingPublicationJournal> | null = null;
    storage.beforeRemove = (key) => {
      if (key !== PENDING_PUBLICATION_STORAGE_KEY || replacementInstall !== null) return;
      replacementInstall = installPendingPublicationJournal(storage, replacement, { expectedRaw: null });
    };

    expect(await discardPendingPublicationAfterRecoveryExport(storage, raw)).toEqual({ status: "cleared" });
    expect(replacementInstall).not.toBeNull();
    const replacementResult = await replacementInstall!;
    expect(replacementResult).toMatchObject({ status: "durable" });
    if (replacementResult.status !== "durable") return;
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(replacementResult.raw);
  });

  it.each(["remove", "readback"] as const)("stays blocking on %s failure", async (failure) => {
    const storage = new MemoryStorage();
    const raw = "{corrupt exact raw";
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, raw);
    if (failure === "remove") storage.failRemoveAt = 1;
    else storage.failGetAt = 2;
    expect((await discardPendingPublicationAfterRecoveryExport(storage, raw)).status).toBe("failure");
  });
});

describe("deprecated Task 7 compile bridge", () => {
  it("returns unavailable and performs zero storage mutation for every unsuffixed shim", () => {
    const storage = new MemoryStorage();
    const oldRaw = JSON.stringify(legacyReceipt(2));
    storage.values.set(PENDING_PUBLICATION_STORAGE_KEY, oldRaw);
    storage.resetTrace();
    const receipt = legacyReceipt(2);
    const remaining = diffLibrary(receipt.database, receipt.database);
    expect(loadPendingPublication(storage)).toMatchObject({ receipt: null, raw: null, error: expect.any(Error) });
    expect(installPendingPublication(storage, receipt, remaining)).toMatchObject({ ok: false, error: expect.any(Error) });
    expect(clearPendingPublication(storage)).toBe(false);
    expect(storage.values.get(PENDING_PUBLICATION_STORAGE_KEY)).toBe(oldRaw);
    expect(storage.calls).toEqual([]);
  });
});
