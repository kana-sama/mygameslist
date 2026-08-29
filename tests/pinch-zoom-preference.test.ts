import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPinchZoomBlocked, setPinchZoomBlocked } from "../src/state/pinchZoomPreference";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("pinch zoom preference", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back when Safari throws while reading the localStorage getter", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("blocked"); });

    expect(loadPinchZoomBlocked()).toBe(false);
    expect(setPinchZoomBlocked(true)).toBe(true);
  });

  it("loads only the exact enabled value and returns disabled after a storage read failure", () => {
    expect(loadPinchZoomBlocked(storageWith(null))).toBe(false);
    expect(loadPinchZoomBlocked(storageWith("enabled"))).toBe(true);
    expect(loadPinchZoomBlocked(storageWith("unexpected"))).toBe(false);
    expect(loadPinchZoomBlocked({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });

  it("persists enabled state, removes disabled state, and retains requested state after a storage write failure", () => {
    const storage = memoryStorage();

    expect(setPinchZoomBlocked(true, storage)).toBe(true);
    expect(storage.getItem("mygameslist:block-pinch-zoom:v1")).toBe("enabled");
    expect(setPinchZoomBlocked(false, storage)).toBe(false);
    expect(storage.getItem("mygameslist:block-pinch-zoom:v1")).toBeNull();
    expect(setPinchZoomBlocked(true, { setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } })).toBe(true);
  });
});
