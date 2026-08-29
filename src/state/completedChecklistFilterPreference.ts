const STORAGE_KEY = "mygameslist:hide-completed-checklists:v1";
const ENABLED_VALUE = "enabled";

export function loadCompletedChecklistFilterEnabled(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === ENABLED_VALUE;
  } catch {
    return false;
  }
}

export function toggleCompletedChecklistFilterEnabled(
  current: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage,
): boolean {
  return setCompletedChecklistFilterEnabled(!current, storage);
}

export function setCompletedChecklistFilterEnabled(
  next: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> = window.localStorage,
): boolean {
  try {
    if (next) storage.setItem(STORAGE_KEY, ENABLED_VALUE);
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // The current session still reflects the user's choice.
  }
  return next;
}
