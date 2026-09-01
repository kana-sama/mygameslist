import { describe, expect, it } from "vitest";
import {
  createChecklistSearchHistoryStore,
  type ChecklistSearchHistoryRecord,
} from "../src/state/checklistSearchHistory";

const STORAGE_KEY = "mygameslist:checklist-search-history:v1";

function record(gameId: string, itemId: string, touchedAt: number, noteId = `note-${itemId}`): ChecklistSearchHistoryRecord {
  return { gameId, itemId, noteId, touchedAt };
}

function memoryStorage(seed?: string): Storage {
  const values = new Map(seed === undefined ? [] : [[STORAGE_KEY, seed]]);
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: () => null,
    get length() { return values.size; },
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("checklist search history", () => {
  it("records only explicitly successful palette-save identities", () => {
    const storage = memoryStorage();
    const history = createChecklistSearchHistoryStore(storage);

    expect(history.list("game-a", new Set(["item-a"]))).toEqual([]);
    history.record(record("game-a", "item-a", 10));

    expect(history.list("game-a", new Set(["item-a"]))).toEqual([record("game-a", "item-a", 10)]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({ version: 1, records: [record("game-a", "item-a", 10)] });
  });

  it("moves a repeated identity to the front with its latest successful timestamp", () => {
    const history = createChecklistSearchHistoryStore(memoryStorage());
    history.record(record("game-a", "one", 10));
    history.record(record("game-a", "two", 20));
    history.record(record("game-a", "one", 30, "updated-note"));

    expect(history.list("game-a", new Set(["one", "two"]))).toEqual([
      record("game-a", "one", 30, "updated-note"),
      record("game-a", "two", 20),
    ]);
  });

  it("normalizes persisted records newest-first before duplicate selection and caps", () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      records: [
        record("game-a", "duplicate", 10, "old-note"),
        record("game-a", "newest", 40),
        record("game-a", "duplicate", 30, "new-note"),
        record("game-a", "middle", 20),
      ],
    }));
    const history = createChecklistSearchHistoryStore(storage);

    expect(history.list("game-a", new Set(["duplicate", "newest", "middle"]))).toEqual([
      record("game-a", "newest", 40),
      record("game-a", "duplicate", 30, "new-note"),
      record("game-a", "middle", 20),
    ]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({
      version: 1,
      records: [
        record("game-a", "newest", 40),
        record("game-a", "duplicate", 30, "new-note"),
        record("game-a", "middle", 20),
      ],
    });
  });

  it("persists stable newest-first normalization even when only record order changes", () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      records: [
        record("game-a", "equal-first", 20),
        record("game-a", "oldest", 10),
        record("game-a", "newest", 30),
        record("game-a", "equal-second", 20),
      ],
    }));
    createChecklistSearchHistoryStore(storage);

    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({
      version: 1,
      records: [
        record("game-a", "newest", 30),
        record("game-a", "equal-first", 20),
        record("game-a", "equal-second", 20),
        record("game-a", "oldest", 10),
      ],
    });
  });

  it("keeps at most eight records per game and twenty-four globally", () => {
    const history = createChecklistSearchHistoryStore(memoryStorage());
    for (let index = 0; index < 10; index += 1) history.record(record("game-a", `a-${index}`, index));
    expect(history.list("game-a", new Set(Array.from({ length: 10 }, (_, index) => `a-${index}`))).map(({ itemId }) => itemId)).toEqual([
      "a-9", "a-8", "a-7", "a-6", "a-5", "a-4", "a-3", "a-2",
    ]);
    for (const gameId of ["game-b", "game-c", "game-d"]) {
      for (let index = 0; index < 8; index += 1) history.record(record(gameId, `${gameId}-${index}`, 100 + index));
    }

    expect(history.list("game-a", new Set(Array.from({ length: 10 }, (_, index) => `a-${index}`)))).toEqual([]);
    expect(history.list("game-b", new Set(Array.from({ length: 8 }, (_, index) => `game-b-${index}`)))).toHaveLength(8);
    expect(history.list("game-c", new Set(Array.from({ length: 8 }, (_, index) => `game-c-${index}`)))).toHaveLength(8);
    expect(history.list("game-d", new Set(Array.from({ length: 8 }, (_, index) => `game-d-${index}`)))).toHaveLength(8);
  });

  it("evicts oldest records until the serialized UTF-8 payload fits within eight KiB", () => {
    const storage = memoryStorage();
    const history = createChecklistSearchHistoryStore(storage);
    const wide = (suffix: string) => `${"界".repeat(1_300)}-${suffix}`;
    history.record(record("game-a", wide("one"), 1, "note"));
    history.record(record("game-a", wide("two"), 2, "note"));
    history.record(record("game-a", wide("three"), 3, "note"));

    expect(history.list("game-a", new Set([wide("one"), wide("two"), wide("three")])).map(({ itemId }) => itemId)).toEqual([
      wide("three"),
      wide("two"),
    ]);
    expect(new TextEncoder().encode(storage.getItem(STORAGE_KEY)!).byteLength).toBeLessThanOrEqual(8 * 1024);
  });

  it("recovers from corrupt or incompatible stored payloads", () => {
    const corrupt = createChecklistSearchHistoryStore(memoryStorage("not json"));
    corrupt.record(record("game-a", "fresh", 1));
    expect(corrupt.list("game-a", new Set(["fresh"]))).toEqual([record("game-a", "fresh", 1)]);

    const incompatible = createChecklistSearchHistoryStore(memoryStorage(JSON.stringify({ version: 2, records: [record("game-a", "old", 0)] })));
    expect(incompatible.list("game-a", new Set(["old"]))).toEqual([]);
  });

  it("prunes stale identities and returns only valid rows for the current game", () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      records: [record("game-a", "gone", 3), record("game-b", "elsewhere", 2), record("game-a", "keep", 1)],
    }));
    const history = createChecklistSearchHistoryStore(storage);

    expect(history.list("game-a", new Set(["keep"]))).toEqual([record("game-a", "keep", 1)]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({ version: 1, records: [record("game-b", "elsewhere", 2), record("game-a", "keep", 1)] });
  });

  it("continues privately in memory when storage reads or writes throw", () => {
    const failingStorage: Storage = {
      clear: () => { throw new Error("blocked"); },
      getItem: () => { throw new Error("blocked"); },
      key: () => null,
      get length() { return 0; },
      removeItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
    };
    const history = createChecklistSearchHistoryStore(failingStorage);

    expect(() => history.record(record("game-a", "saved", 1))).not.toThrow();
    expect(() => history.list("game-a", new Set(["saved"]))).not.toThrow();
    expect(history.list("game-a", new Set(["saved"]))).toEqual([record("game-a", "saved", 1)]);
  });
});
