const DISABLED_GAME_STYLE_IDS_KEY = "mygameslist:disabled-game-style-ids:v1";

export function loadDisabledGameStyleIds(): ReadonlySet<string> {
  try {
    const value = JSON.parse(localStorage.getItem(DISABLED_GAME_STYLE_IDS_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function toggleDisabledGameStyleId(current: ReadonlySet<string>, gameId: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(gameId)) next.delete(gameId);
  else next.add(gameId);
  try {
    if (next.size) localStorage.setItem(DISABLED_GAME_STYLE_IDS_KEY, JSON.stringify([...next].sort()));
    else localStorage.removeItem(DISABLED_GAME_STYLE_IDS_KEY);
  } catch {
    // Keep the toggle usable for this session if storage is unavailable.
  }
  return next;
}
