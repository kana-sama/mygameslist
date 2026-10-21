export const SIZE = 8;
export const WIDTH = 256;
export const HEIGHT = 184;
export const keys = Array.from({ length: 64 }, (_, i) => `${i % 8},${Math.floor(i / 8)}`);
export function label(key) {
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
  return state(value).rooms[key] ?? { image: null, note: "", solved: false };
}
export function changeRoom(value, key, patch) {
  const current = state(value);
  if (!keys.includes(key)) throw new Error("Неизвестная комната");
  const next = { ...room(current, key), ...patch };
  const rooms = { ...current.rooms };
  if (!next.image && !next.note) delete rooms[key];
  else rooms[key] = next;
  return { ...current, rooms };
}
export function stats(value) {
  const rooms = Object.values(state(value).rooms);
  return { found: rooms.filter(r => r.image).length, solved: rooms.filter(r => r.image && r.solved).length };
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
  if (light < 40 || scores[0].red < 4 || scores[1].red > scores[0].red * 0.35) {
    throw new Error("Не вижу единственную красную точку на миникарте. Нужен полный скрин Barbuta с HUD.");
  }
  return scores[0].key;
}
