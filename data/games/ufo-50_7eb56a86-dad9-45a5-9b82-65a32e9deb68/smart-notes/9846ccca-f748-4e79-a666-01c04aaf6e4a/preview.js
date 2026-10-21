import { state, selectPreviewRoom } from "./model.js";
import { style, element, pictures, board } from "./view.js";

export function mount(root, api) {
  style(root);
  const wrap = element("div", "atlas preview");
  const map = board(true, key => {
    selectPreviewRoom(key);
    api.page.open();
  });
  map.grid.classList.add("mini");
  const error = element("p", "preview-error error");
  error.setAttribute("role", "alert");
  wrap.append(map.grid, error);
  root.append(wrap);
  const images = pictures(api, () => { error.textContent = "Изображения недоступны"; });
  function render({ value }) {
    value = state(value);
    map.render(value, null, images);
    images.prune(value);
  }
  render(api.state.get());
  const unsubscribe = api.state.subscribe(render);
  return () => { unsubscribe(); images.dispose(); };
}
