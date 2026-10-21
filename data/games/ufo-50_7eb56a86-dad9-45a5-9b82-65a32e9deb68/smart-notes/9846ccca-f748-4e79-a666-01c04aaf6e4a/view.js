import { keys, label, room } from "./model.js";

export function style(root) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./style.css", import.meta.url).href;
  root.append(link);
}
export function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
export function pictures(api, onError) {
  const cache = new Map();
  const bindings = new WeakMap();
  let disposed = false;
  return {
    show(img, ref) {
      const id = ref?.$asset;
      if (img.dataset.asset === (id ?? "") && (!id || bindings.get(img) === cache.get(id) && cache.has(id))) return;
      img.dataset.asset = id ?? "";
      img.removeAttribute("src");
      img.hidden = !id;
      if (!id) return;
      if (!cache.has(id)) cache.set(id, api.assets.url(ref).then(handle => {
        if (disposed) { handle.release(); return null; }
        return handle;
      }).catch(error => { cache.delete(id); if (!disposed) onError?.(error); return null; }));
      bindings.set(img, cache.get(id));
      cache.get(id).then(handle => { if (handle && !disposed && img.dataset.asset === id) img.src = handle.url; });
    },
    prune(value) {
      const live = new Set(Object.values(value.rooms).map(r => r.image?.$asset));
      for (const [id, pending] of cache) if (!live.has(id)) {
        cache.delete(id); pending.then(handle => handle?.release());
      }
    },
    dispose() { disposed = true; for (const pending of cache.values()) pending.then(handle => handle?.release()); cache.clear(); }
  };
}
export function board(interactive, onSelect) {
  const grid = element("div", interactive ? "board" : "board mini");
  grid.setAttribute("aria-label", "Карта замка 8 на 8");
  const cells = new Map();
  for (const key of keys) {
    const cell = element(interactive ? "button" : "div", "cell");
    cell.dataset.key = key;
    if (interactive) { cell.type = "button"; cell.addEventListener("click", () => onSelect(key)); }
    const img = element("img"); img.alt = ""; img.hidden = true;
    const coord = element("span", "coord", label(key));
    const mark = element("span", "mark"); mark.setAttribute("aria-hidden", "true");
    cell.append(img, coord, mark); grid.append(cell); cells.set(key, { cell, img, mark });
  }
  return {
    grid,
    render(value, selected, images) {
      for (const [key, { cell, img, mark }] of cells) {
        const item = room(value, key);
        cell.classList.toggle("filled", !!item.image);
        cell.classList.toggle("solved", !!item.solved && !!item.image);
        cell.classList.toggle("selected", key === selected);
        cell.setAttribute("aria-label", `${label(key)} · ${item.image ? item.solved ? "разгадано" : "не разгадано" : "не исследовано"}${item.note ? " · есть заметка" : ""}`);
        if (interactive) { cell.setAttribute("aria-pressed", String(key === selected)); cell.tabIndex = selected === null || key === selected ? 0 : -1; }
        mark.textContent = item.solved && item.image ? "✓" : item.note ? "•" : "";
        images.show(img, item.image);
      }
    },
    focus(key) { cells.get(key)?.cell.focus(); }
  };
}
