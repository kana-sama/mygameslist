export type SidebarLayoutMode = "side" | "top";

const SIDEBAR_LAYOUT_STORAGE_KEY = "mygameslist:sidebar-layout:v1";

export function loadSidebarLayoutMode(
  storage?: Pick<Storage, "getItem">,
): SidebarLayoutMode {
  try {
    return (storage ?? window.localStorage).getItem(SIDEBAR_LAYOUT_STORAGE_KEY) === "top" ? "top" : "side";
  } catch {
    return "side";
  }
}

export function toggleSidebarLayoutMode(
  current: SidebarLayoutMode,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): SidebarLayoutMode {
  const next = current === "side" ? "top" : "side";
  try {
    const target = storage ?? window.localStorage;
    if (next === "top") target.setItem(SIDEBAR_LAYOUT_STORAGE_KEY, "top");
    else target.removeItem(SIDEBAR_LAYOUT_STORAGE_KEY);
  } catch {
    // Keep the current React session usable when browser persistence is unavailable.
  }
  return next;
}
