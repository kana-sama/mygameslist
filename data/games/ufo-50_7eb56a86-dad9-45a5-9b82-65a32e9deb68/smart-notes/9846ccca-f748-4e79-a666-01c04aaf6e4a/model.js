export const SIZE = 8;
export const WIDTH = 256;
export const HEIGHT = 184;
export const keys = Array.from({ length: 64 }, (_, i) => `${i % 8},${Math.floor(i / 8)}`);
export function isGridKey(key) {
  return keys.includes(key);
}
export function isExtraKey(key) {
  return typeof key === "string" && /^extra:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}
export function extraKeys(value) {
  const current = state(value);
  return Object.keys(current.rooms).filter(isExtraKey).sort((a, b) =>
    (current.rooms[a]?.order ?? 0) - (current.rooms[b]?.order ?? 0));
}
export function roomKeys(value) {
  return [...keys, ...extraKeys(value)];
}
function hasRoom(value, key) {
  return isGridKey(key) || isExtraKey(key) && Object.hasOwn(value.rooms, key);
}
export function label(key, value) {
  if (isExtraKey(key)) {
    const extra = value && state(value).rooms[key];
    return extra?.title || (extra ? `X${(extra.order ?? extraKeys(value).indexOf(key)) + 1}` : "X");
  }
  const [x, y] = key.split(",").map(Number);
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}
export function state(value) {
  if (!value || value.version !== 1 || !value.rooms || typeof value.rooms !== "object") {
    throw new Error("Неизвестная версия атласа");
  }
  return value;
}
export function room(value, key) {
  const current = state(value);
  if (!hasRoom(current, key)) throw new Error("Неизвестная комната");
  return current.rooms[key] ?? { image: null, note: "", solved: false };
}
export function changeRoom(value, key, patch) {
  const current = state(value);
  const next = { ...room(current, key), ...patch };
  const rooms = { ...current.rooms };
  if (isGridKey(key) && !next.image && !next.note) delete rooms[key];
  else rooms[key] = next;
  return { ...current, rooms };
}
export function addExtraRoom(value, key, patch = {}) {
  const current = state(value);
  if (!isExtraKey(key)) throw new Error("Неизвестная комната");
  if (Object.hasOwn(current.rooms, key)) throw new Error("Комната уже существует");
  const order = Math.max(-1, ...extraKeys(current).map(id => current.rooms[id].order ?? -1)) + 1;
  const next = { image: null, note: "", solved: false, ...patch,
    title: patch.title || `X${order + 1}`, order };
  return { ...current, rooms: { ...current.rooms, [key]: next } };
}
export function deleteExtraRoom(value, key) {
  const current = state(value);
  if (!isExtraKey(key) || !hasRoom(current, key)) throw new Error("Неизвестная комната");
  const rooms = { ...current.rooms };
  delete rooms[key];
  const next = { ...current, rooms };
  if (current.links) next.links = current.links.filter(pair => !pair.includes(key));
  return next;
}
export function setRoomLink(value, a, b, enabled = true) {
  const current = state(value);
  if (a === b || !hasRoom(current, a) || !hasRoom(current, b)) throw new Error("Недопустимая связь комнат");
  const pair = [a, b].sort();
  const links = (current.links ?? []).filter(([x, y]) =>
    !(x === a && y === b || x === b && y === a));
  if (enabled) links.push(pair);
  return { ...current, links };
}
export function linkedKeys(value, key) {
  const current = state(value);
  if (!hasRoom(current, key)) return [];
  const neighbors = new Set((current.links ?? []).flatMap(([a, b]) =>
    a === key ? [b] : b === key ? [a] : []));
  return roomKeys(current).filter(id => id !== key && neighbors.has(id));
}
// Selection is temporary view context shared by the two entrypoints.
let previewSelection = null;
export function selectPreviewRoom(key) {
  if (isGridKey(key) || isExtraKey(key)) previewSelection = key;
}
export function takePreviewSelection() {
  const selected = previewSelection;
  previewSelection = null;
  return selected;
}
// The console captures the complete 384×216 UFO 50 display. Use the central
// 16:9 frame for uniform letterboxing; minimap validation rejects wrong layouts.
export function frame(width, height) {
  const w = Math.min(width, height * 16 / 9);
  const h = w * 9 / 16;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}
export function cropRect(width, height) {
  const f = frame(width, height);
  return { x: f.x + f.w / 6, y: f.y + f.h * 2 / 27, w: f.w * 2 / 3, h: f.h * 23 / 27 };
}
export function locate(pixels) {
  const scores = [];
  let light = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let red = 0, white = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const i = ((168 + y * 4 + dy) * 384 + 16 + x * 4 + dx) * 4;
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (r > 115 && r > g * 1.8 && r > b * 1.2 && g < 110) red++;
      if (r > 140 && g > 140 && b > 110 && Math.max(r,g,b) - Math.min(r,g,b) < 100) white++;
    }
    if (white >= 4) light++;
    scores.push({ key: `${x},${y}`, red });
  }
  scores.sort((a, b) => b.red - a.red);
  if (light < 40) {
    throw new Error("Не вижу единственную красную точку на миникарте. Нужен полный скрин Barbuta с HUD.");
  }
  if (scores[0].red < 4) return null;
  if (scores[1].red > scores[0].red * 0.35) {
    throw new Error("Не вижу единственную красную точку на миникарте. Нужен полный скрин Barbuta с HUD.");
  }
  return scores[0].key;
}
