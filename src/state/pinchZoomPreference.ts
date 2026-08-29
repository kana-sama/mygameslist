const PINCH_ZOOM_BLOCKED_KEY = "mygameslist:block-pinch-zoom:v1";
const ENABLED_VALUE = "enabled";

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadPinchZoomBlocked(storage: Pick<Storage, "getItem"> = browserStorage() ?? { getItem: () => null }): boolean {
  try {
    return storage.getItem(PINCH_ZOOM_BLOCKED_KEY) === ENABLED_VALUE;
  } catch {
    return false;
  }
}

export function setPinchZoomBlocked(enabled: boolean, storage: Pick<Storage, "setItem" | "removeItem"> = browserStorage() ?? { setItem: () => {}, removeItem: () => {} }): boolean {
  try {
    if (enabled) storage.setItem(PINCH_ZOOM_BLOCKED_KEY, ENABLED_VALUE);
    else storage.removeItem(PINCH_ZOOM_BLOCKED_KEY);
  } catch {
    // The current React session still uses the explicitly requested value.
  }
  return enabled;
}
