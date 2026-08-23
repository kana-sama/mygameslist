import { describe, expect, it } from "vitest";
import { loadSidebarLayoutMode, toggleSidebarLayoutMode } from "../src/state/sidebarLayoutPreference";

const STORAGE_KEY = "mygameslist:sidebar-layout:v1";

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

describe("sidebar layout preference", () => {
  it("loads only the exact persisted top value", () => {
    expect(loadSidebarLayoutMode(storageWith("top"))).toBe("top");
    expect(loadSidebarLayoutMode(storageWith("unexpected"))).toBe("side");
  });

  it("stores top and removes the key when returning to side", () => {
    const storage = memoryStorage();

    expect(toggleSidebarLayoutMode("side", storage)).toBe("top");
    expect(storage.getItem(STORAGE_KEY)).toBe("top");
    expect(toggleSidebarLayoutMode("top", storage)).toBe("side");
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to side when storage reads throw", () => {
    const throwingReadStorage: Pick<Storage, "getItem"> = {
      getItem: () => { throw new Error("read blocked"); },
    };

    expect(loadSidebarLayoutMode(throwingReadStorage)).toBe("side");
  });

  it("keeps the next session mode when storage writes throw", () => {
    const throwingWriteStorage: Pick<Storage, "setItem" | "removeItem"> = {
      setItem: () => { throw new Error("write blocked"); },
      removeItem: () => { throw new Error("remove blocked"); },
    };

    expect(toggleSidebarLayoutMode("side", throwingWriteStorage)).toBe("top");
  });
});
