import { describe, expect, it } from "vitest";
import { loadCompletedChecklistFilterEnabled, toggleCompletedChecklistFilterEnabled } from "../src/state/completedChecklistFilterPreference";

const STORAGE_KEY = "mygameslist:hide-completed-checklists:v1";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe("completed checklist filter preference", () => {
  it("loads only the exact persisted enabled value", () => {
    expect(loadCompletedChecklistFilterEnabled(storageWith("enabled"))).toBe(true);
    expect(loadCompletedChecklistFilterEnabled(storageWith("unexpected"))).toBe(false);
  });

  it("defaults to disabled when the preference key is absent", () => {
    expect(loadCompletedChecklistFilterEnabled(storageWith(null))).toBe(false);
  });

  it("stores enabled and removes the key when returning to disabled", () => {
    const storage = memoryStorage();

    expect(toggleCompletedChecklistFilterEnabled(false, storage)).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toBe("enabled");
    expect(toggleCompletedChecklistFilterEnabled(true, storage)).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to disabled when storage reads throw", () => {
    const throwingReadStorage: Pick<Storage, "getItem"> = {
      getItem: () => { throw new Error("read blocked"); },
    };

    expect(loadCompletedChecklistFilterEnabled(throwingReadStorage)).toBe(false);
  });

  it("keeps the next in-memory value when storage writes throw", () => {
    const throwingWriteStorage: Pick<Storage, "setItem" | "removeItem"> = {
      setItem: () => { throw new Error("write blocked"); },
      removeItem: () => { throw new Error("remove blocked"); },
    };

    expect(toggleCompletedChecklistFilterEnabled(false, throwingWriteStorage)).toBe(true);
    expect(toggleCompletedChecklistFilterEnabled(true, throwingWriteStorage)).toBe(false);
  });
});
