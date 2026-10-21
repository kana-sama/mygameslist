import { state, stats } from "./model.js";
import { style, element, pictures, board } from "./view.js";

export function mount(root, api) {
  style(root);
  const wrap = element("div", "atlas preview");
  const map = board(false);
  const footer = element("div", "preview-footer");
  const count = element("span");
  const hint = element("span", "muted", "Открыть атлас ↗");
  footer.append(count, hint); wrap.append(map.grid, footer); root.append(wrap);
  const images = pictures(api, () => { hint.textContent = "Изображения недоступны"; });
  function render({ value }) {
    value = state(value);
    const s = stats(value);
    count.textContent = `${s.found}/64 комнат · ${s.solved} разгадано`;
    wrap.classList.toggle("empty", s.found === 0);
    map.render(value, null, images); images.prune(value);
  }
  render(api.state.get());
  const unsubscribe = api.state.subscribe(render);
  return () => { unsubscribe(); images.dispose(); };
}
