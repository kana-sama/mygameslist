import { label, room, state, changeRoom, takePreviewSelection } from "./model.js";
import { style, element, pictures, board } from "./view.js";
import { extract } from "./images.js";

export function mount(root, api) {
  style(root);
  const atlas = element("div", "atlas page");
  root.classList.add("page-root");
  atlas.innerHTML = `
    <div class="workspace">
      <div class="main-layout">
        <section class="map-panel" aria-label="Личная карта"></section>
        <aside class="inspector" aria-label="Выбранная комната">
          <div class="toolbar">
            <button class="primary upload" type="button">Загрузить скрины</button>
            <input class="file-input" type="file" accept="image/*" multiple aria-label="Скриншоты Barbuta" hidden>
          </div>
          <div class="import-status" role="status" aria-live="polite"></div>
          <details class="failures" hidden><summary></summary><ul></ul></details>
          <h3 aria-label="Комната"></h3>
          <div class="room-picture" hidden><img alt=""></div>
          <label class="solved-toggle"><input type="checkbox"><span>Разгадано</span></label>
          <textarea rows="5" placeholder="Заметка" aria-label="Заметка" spellcheck="false"></textarea>
          <div class="save-row"><span class="save-status" role="status"></span><button class="retry quiet" type="button" hidden>Повторить</button><button class="remove quiet" type="button">Убрать скрин</button></div>
        </aside>
      </div>
    </div>
    <div class="drop-overlay" hidden>Отпустите скриншоты</div>`;
  root.append(atlas);
  const $ = selector => atlas.querySelector(selector);
  const fileInput = $(".file-input"), note = $("textarea");
  const check = $(".solved-toggle input");
  const status = $(".import-status"), saveStatus = $(".save-status"), errorList = $(".failures ul");
  let value = state(api.state.get().value), selected = takePreviewSelection() ?? "4,3", busy = false, disposed = false;
  let dragDepth = 0, noteTimer = 0, noteFlush = null, saveFailure = null;
  const drafts = new Map(), writes = new Set();
  const queue = [];
  const images = pictures(api, error => { status.textContent = error.message; status.classList.add("error"); });
  const map = board(true, select);
  const mapPanel = $(".map-panel");
  mapPanel.append(map.grid);

  // The root fills the host's flex slot, independently of map/sidebar content.
  // Observe that stable slot rather than a panel whose width this changes.
  function fitMap() {
    const gap = 7 * (parseFloat(getComputedStyle(atlas).getPropertyValue("--map-gap")) || 0);
    const width = Math.max(0, (root.clientHeight - gap) * 32 / 23 + gap);
    const stacked = root.clientWidth <= 680 || root.clientWidth < width + 260;
    atlas.classList.toggle("stacked", stacked);
    atlas.style.setProperty("--map-width", `${width}px`);
  }
  const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitMap);
  sizeObserver?.observe(root);
  window.addEventListener("resize", fitMap);
  // The stylesheet loads asynchronously; fit again once its grid gap is available.
  root.querySelector('link[rel="stylesheet"]')?.addEventListener("load", fitMap, { once: true, signal: api.signal });
  fitMap();

  function render(forceText = false) {
    const item = room(value, selected);
    $("h3").textContent = label(selected);
    $(".room-picture").hidden = !item.image;
    $(".remove").hidden = !item.image;
    check.disabled = !item.image;
    check.checked = !!item.image && !!item.solved;
    images.show($(".room-picture img"), item.image);
    $(".room-picture img").alt = `Комната ${label(selected)}`;
    const text = drafts.get(selected)?.text ?? item.note;
    if ((forceText || root.getRootNode().activeElement !== note) && note.value !== text) note.value = text;
    map.render(value, selected, images);
    images.prune(value);
  }
  function select(key) {
    void flushNotes().catch(() => undefined);
    selected = key;
    render(true);
  }
  function savingStatus() {
    if (disposed) return;
    saveStatus.textContent = saveFailure ? `Не сохранено: ${saveFailure.error.message}` : drafts.size || writes.size ? "Сохраняю…" : "Сохранено";
    saveStatus.classList.toggle("error", !!saveFailure);
    $(".retry").hidden = !saveFailure;
  }
  function write(reducer, retry, kind) {
    const pending = api.state.update(reducer);
    writes.add(pending);
    savingStatus();
    return pending.then(() => {
      if (saveFailure?.kind === kind) saveFailure = null;
    }, error => {
      saveFailure = { error, retry, kind };
      throw error;
    }).finally(() => { writes.delete(pending); savingStatus(); });
  }
  function save(key, patch) {
    const retry = () => save(key, patch);
    return write(current => changeRoom(current, key, patch), retry, `${key}:${Object.keys(patch).join(",")}`);
  }
  function flushNotes() {
    window.clearTimeout(noteTimer); noteTimer = 0;
    // A second flush waits for the first and then captures any newer drafts.
    if (noteFlush) return noteFlush.then(() => flushNotes());
    if (!drafts.size || disposed) return Promise.resolve();
    const batch = [...drafts];
    noteFlush = write(current => batch.reduce((next, [key, draft]) => changeRoom(next, key, { note: draft.text }), current), flushNotes, "notes")
      .then(() => { for (const [key, draft] of batch) if (drafts.get(key) === draft) drafts.delete(key); })
      .finally(() => { noteFlush = null; savingStatus(); });
    return noteFlush;
  }
  async function beforeClose() {
    do {
      // Subscribe to pending immediate writes before awaiting the note batch.
      await Promise.all([flushNotes(), ...writes]);
    } while (drafts.size || writes.size || noteFlush);
    if (saveFailure) throw saveFailure.error;
  }
  note.addEventListener("input", () => {
    drafts.set(selected, { text: note.value });
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { noteTimer = 0; void flushNotes().catch(() => undefined); }, 400);
    savingStatus();
  });
  note.addEventListener("blur", () => { void flushNotes().catch(() => undefined); });
  check.addEventListener("change", () => { void save(selected, { solved: check.checked }).catch(() => undefined); });
  $(".remove").addEventListener("click", () => { void save(selected, { image: null, solved: false }).catch(() => undefined); });
  $(".retry").addEventListener("click", () => { if (saveFailure) void saveFailure.retry().catch(() => undefined); });
  const unsubscribeClose = api.page.beforeClose(beforeClose);
  $(".upload").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { void importFiles([...fileInput.files]); fileInput.value = ""; });

  async function importFiles(files) {
    if (!files.length || disposed) return;
    queue.push(...files);
    if (busy) return;
    busy = true;
    errorList.replaceChildren(); $(".failures").hidden = true; status.classList.remove("error");
    let done = 0, added = 0, replaced = 0, failed = 0, lastKey = null;
    const visited = new Set();
    try {
      while (queue.length && !api.signal.aborted) {
        const file = queue.shift();
        status.textContent = `Обрабатываю ${done + 1} из ${done + queue.length + 1} · ${file.name}`;
        atlas.setAttribute("aria-busy", "true");
        let ref;
        try {
          const { key, blob } = await extract(file);
          api.signal.throwIfAborted();
          ref = await api.assets.upload(blob, { name: `Barbuta-${label(key)}.png`, alt: `Экран Barbuta, комната ${label(key)}` });
          const existed = !!room(api.state.get().value, key).image;
          const pending = api.state.update(current => changeRoom(current, key, { image: ref }));
          writes.add(pending);
          try { await pending; } finally { writes.delete(pending); }
          if (existed) replaced++; else added++;
          visited.add(label(key)); lastKey = key;
        } catch (error) {
          if (api.signal.aborted) break;
          failed++;
          errorList.append(element("li", "", `${file.name}: ${error.message}`));
          $(".failures").hidden = false;
          $(".failures summary").textContent = `Не импортировано: ${failed}`;
        } finally { if (ref && !api.signal.aborted) api.assets.release(ref); done++; }
      }
      if (!disposed) {
        if (lastKey) select(lastKey);
        status.textContent = `Готово · добавлено ${added} · заменено ${replaced}${failed ? ` · ошибок ${failed}` : ""}${visited.size ? ` — ${[...visited].join(", ")}` : ""}`;
        status.classList.toggle("error", !added && !replaced && failed > 0);
      }
    } finally { busy = false; atlas.removeAttribute("aria-busy"); }
  }

  function hasFiles(event) { return [...(event.dataTransfer?.types ?? [])].includes("Files"); }
  atlas.addEventListener("dragenter", event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); dragDepth++; $(".drop-overlay").hidden = false;
  });
  atlas.addEventListener("dragover", event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
  atlas.addEventListener("dragleave", event => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $(".drop-overlay").hidden = true;
  });
  atlas.addEventListener("drop", event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation(); dragDepth = 0; $(".drop-overlay").hidden = true;
    void importFiles([...event.dataTransfer.files]);
  });
  atlas.addEventListener("paste", event => {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith("image/"));
    if (files.length) { event.preventDefault(); void importFiles(files); }
  });
  map.grid.addEventListener("keydown", event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    const [x, y] = selected.split(",").map(Number);
    select(`${Math.max(0, Math.min(7, x + delta[0]))},${Math.max(0, Math.min(7, y + delta[1]))}`);
    map.focus(selected);
  });
  render(true);
  const unsubscribe = api.state.subscribe(snapshot => { value = state(snapshot.value); render(); });
  return () => {
    disposed = true;
    window.clearTimeout(noteTimer);
    unsubscribeClose();
    queue.length = 0;
    sizeObserver?.disconnect();
    window.removeEventListener("resize", fitMap);
    unsubscribe();
    images.dispose();
  };
}
