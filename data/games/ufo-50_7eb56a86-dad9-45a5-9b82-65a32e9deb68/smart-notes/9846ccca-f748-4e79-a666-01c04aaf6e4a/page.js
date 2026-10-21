import { label, room, state, stats, changeRoom, WIDTH, HEIGHT } from "./model.js";
import { style, element, pictures, board } from "./view.js";
import { extract } from "./images.js";

export function mount(root, api) {
  style(root);
  const atlas = element("div", "atlas page");
  atlas.innerHTML = `
    <div class="workspace">
      <header class="masthead">
        <div><div class="eyebrow">UFO SOFT · EXPEDITION LOG / 01</div><div class="wordmark">BARBUTA<span>ЛИЧНЫЙ АТЛАС ЗАМКА</span></div></div>
        <div class="totals"><strong class="found">00<span>/64</span></strong><span class="muted">комнат найдено</span><span class="solved-count"></span></div>
      </header>
      <div class="progress-track"><div></div></div>
      <div class="toolbar">
        <button class="primary upload" type="button"><span aria-hidden="true">＋</span> Загрузить скрины</button>
        <span class="import-hint">Пачкой, перетаскиванием или ⌘/Ctrl+V.<br>Позиции определяются по миникарте.</span>
        <button class="quiet sample" type="button">Импортировать пример ↗</button>
        <input class="file-input" type="file" accept="image/*" multiple aria-label="Скриншоты Barbuta" hidden>
      </div>
      <div class="import-status" role="status" aria-live="polite"></div>
      <details class="failures" hidden><summary></summary><ul></ul></details>
      <div class="main-layout">
        <section class="map-panel" aria-label="Личная карта">
          <div class="panel-top"><span class="eyebrow">КАРТА ЗАМКА</span><span class="map-help">← ↑ ↓ → выбрать · двойной клик открыть</span></div>
          <div class="map-frame"><div class="col-labels"><span>A</span><span>B</span><span>C</span><span>D</span><span>E</span><span>F</span><span>G</span><span>H</span></div><div class="row-labels"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span></div><div class="board-slot"></div></div>
          <div class="legend"><span><i class="swatch gray"></i>Не разгадано</span><span><i class="swatch green"></i>Разгадано</span><span class="muted">• есть заметка</span></div>
        </section>
        <aside class="inspector" aria-label="Выбранная комната">
          <div class="room-heading"><div><span class="eyebrow">КОМНАТА</span><h3></h3></div><span class="room-status"></span></div>
          <button class="room-picture" type="button" aria-label="Открыть экран крупно"><img alt=""><span class="picture-hint">Открыть экран ↗</span></button>
          <div class="room-empty"><span class="empty-glyph" aria-hidden="true">＋</span><strong>Здесь ещё темно</strong><p>Загрузи скриншоты — нужные комнаты заполнятся сами.</p></div>
          <label class="solved-toggle"><input type="checkbox"><span class="check-art" aria-hidden="true">✓</span><span>Экран разгадан</span></label>
          <label class="note-label" for="room-note">ПОЛЕВЫЕ ЗАМЕТКИ</label>
          <textarea id="room-note" rows="5" placeholder="Секрет, проход, что проверить…" spellcheck="false"></textarea>
          <div class="save-row"><span class="save-status" role="status">Сохраняется сразу</span><button class="remove quiet" type="button">Убрать скрин</button></div>
          <p class="storage-hint">256×184 · lossless WebP<br>Один файл для карты и большого экрана.</p>
        </aside>
      </div>
      <footer class="atlas-footer"><span>Ни одной лишней подсказки. Только твои открытия.</span><span class="percentage">0% ИССЛЕДОВАНО</span></footer>
    </div>
    <div class="drop-overlay" hidden><span>＋</span><strong>Бросай всю пачку</strong><p>Миникарта подскажет, куда поставить каждый экран.</p></div>
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Просмотр экрана" hidden>
      <div class="viewer-bar"><strong></strong><div class="zoom-controls"><button type="button" class="zoom-out" aria-label="Уменьшить">−</button><output></output><button type="button" class="zoom-in" aria-label="Увеличить">＋</button></div><button class="viewer-close" type="button">Закрыть ×</button></div>
      <div class="viewer-scroll" tabindex="0"><img alt=""></div><p>Исходная пиксельная сетка · без сглаживания · Escape закрыть</p>
    </div>`;
  root.append(atlas);
  const $ = selector => atlas.querySelector(selector);
  const workspace = $(".workspace"), fileInput = $(".file-input"), note = $("textarea");
  const check = $(".solved-toggle input"), viewer = $(".viewer"), viewerImage = $(".viewer img");
  const status = $(".import-status"), saveStatus = $(".save-status"), errorList = $(".failures ul");
  let value = state(api.state.get().value), selected = "4,3", busy = false, disposed = false;
  let writes = 0, zoom = 1, returnFocus = null, dragDepth = 0;
  const queue = [];
  const images = pictures(api, error => { status.textContent = error.message; status.classList.add("error"); });
  const map = board(true, select);
  $(".board-slot").append(map.grid);

  function render(forceText = false) {
    const item = room(value, selected), s = stats(value);
    $(".found").replaceChildren(document.createTextNode(String(s.found).padStart(2, "0")), element("span", "", "/64"));
    $(".solved-count").textContent = `${s.solved} разгадано`;
    $(".progress-track div").style.width = `${s.found / 64 * 100}%`;
    $(".percentage").textContent = `${Math.round(s.found / 64 * 100)}% ИССЛЕДОВАНО`;
    $("h3").textContent = label(selected);
    $(".room-status").textContent = item.image ? item.solved ? "РАЗГАДАНО" : "ЕСТЬ ВОПРОСЫ" : "НЕ ИССЛЕДОВАНО";
    $(".room-status").classList.toggle("complete", !!item.image && item.solved);
    $(".room-picture").hidden = !item.image; $(".room-empty").hidden = !!item.image;
    $(".remove").hidden = !item.image; check.disabled = !item.image; check.checked = !!item.image && !!item.solved;
    images.show($(".room-picture img"), item.image);
    $(".room-picture img").alt = `Комната ${label(selected)}`;
    if (forceText || root.getRootNode().activeElement !== note) note.value = item.note;
    map.render(value, selected, images);
    if (!viewer.hidden) {
      if (!item.image) closeViewer();
      else { images.show(viewerImage, item.image); $(".viewer-bar strong").textContent = `BARBUTA / ${label(selected)}`; }
    }
    images.prune(value);
  }
  function select(key) {
    selected = key;
    render(true);
  }
  async function save(key, patch) {
    writes++;
    saveStatus.textContent = "Сохраняю…"; saveStatus.classList.remove("error");
    try {
      await api.state.update(current => changeRoom(current, key, patch));
      if (!disposed && writes === 1) saveStatus.textContent = "Сохранено";
    } catch (error) {
      if (!disposed) { saveStatus.textContent = `Не сохранено: ${error.message}`; saveStatus.classList.add("error"); }
    } finally { writes--; }
  }
  note.addEventListener("input", () => { void save(selected, { note: note.value }); });
  check.addEventListener("change", () => { void save(selected, { solved: check.checked }); });
  $(".remove").addEventListener("click", () => { void save(selected, { image: null, solved: false }); });
  $(".upload").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { void importFiles([...fileInput.files]); fileInput.value = ""; });
  $(".sample").addEventListener("click", async () => {
    try {
      const response = await fetch(new URL("./example.jpg", import.meta.url), { signal: api.signal });
      if (!response.ok) throw new Error("Не удалось загрузить пример");
      await importFiles([new File([await response.blob()], "Barbuta-пример.jpg", { type: "image/jpeg" })]);
    } catch (error) { if (!disposed) { status.textContent = error.message; status.classList.add("error"); } }
  });

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
          await api.state.update(current => changeRoom(current, key, { image: ref }));
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
  map.grid.addEventListener("dblclick", event => {
    const cell = event.target.closest("[data-key]");
    if (cell) { select(cell.dataset.key); openViewer(); }
  });

  function setZoom(next) {
    zoom = Math.max(1, Math.min(6, next));
    viewerImage.style.width = `${WIDTH * zoom}px`; viewerImage.style.height = `${HEIGHT * zoom}px`;
    $(".zoom-controls output").textContent = `×${zoom}`;
    $(".zoom-out").disabled = zoom === 1; $(".zoom-in").disabled = zoom === 6;
  }
  function openViewer() {
    const item = room(value, selected);
    if (!item.image) return;
    returnFocus = root.getRootNode().activeElement;
    viewer.hidden = false; workspace.inert = true;
    images.show(viewerImage, item.image); viewerImage.alt = `Комната ${label(selected)}`;
    $(".viewer-bar strong").textContent = `BARBUTA / ${label(selected)}`;
    const viewport = $(".viewer-scroll");
    setZoom(Math.floor(Math.min(viewport.clientWidth / WIDTH, viewport.clientHeight / HEIGHT)));
    $(".viewer-close").focus();
  }
  function closeViewer() {
    viewer.hidden = true; workspace.inert = false;
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  $(".room-picture").addEventListener("click", openViewer);
  $(".viewer-close").addEventListener("click", closeViewer);
  $(".zoom-out").addEventListener("click", () => setZoom(zoom - 1));
  $(".zoom-in").addEventListener("click", () => setZoom(zoom + 1));
  atlas.addEventListener("keydown", event => {
    if (event.key === "Escape" && !viewer.hidden) { event.preventDefault(); event.stopPropagation(); closeViewer(); }
  });
  render(true);
  const unsubscribe = api.state.subscribe(snapshot => { value = state(snapshot.value); render(); });
  return () => { disposed = true; queue.length = 0; unsubscribe(); images.dispose(); };
}
