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
          <div class="room-header">
            <h3 aria-label="Комната"></h3>
            <label class="solved-toggle"><input type="checkbox"><span>Разгадано</span></label>
          </div>
          <div class="room-picture" hidden><img alt=""></div>
          <div class="save-row"><button class="remove quiet" type="button">Убрать скрин</button></div>
          <div class="note-panel">
            <div class="note-actions"><span class="save-status" role="status"></span><button class="retry quiet" type="button" hidden>Повторить</button><button class="edit-note quiet" type="button">Редактировать</button></div>
            <div class="note-empty">Заметки пока нет</div>
            <div class="note-content" aria-label="Заметка"></div>
          </div>
        </aside>
      </div>
    </div>
    <div class="drop-overlay" hidden>Отпустите скриншоты</div>`;
  root.append(atlas);
  const $ = selector => atlas.querySelector(selector);
  const fileInput = $(".file-input"), noteTarget = $(".note-content"), editButton = $(".edit-note");
  const check = $(".solved-toggle input");
  const status = $(".import-status"), saveStatus = $(".save-status"), errorList = $(".failures ul");
  let value = state(api.state.get().value), selected = takePreviewSelection() ?? "4,3", busy = false, disposed = false;
  let dragDepth = 0, noteTimer = 0, noteFlush = null, saveFailure = null, noteUI = null;
  const drafts = new Map(), writes = new Set();
  const queue = [];
  let importIdle = Promise.resolve();
  const images = pictures(api, error => { status.textContent = error.message; status.classList.add("error"); });
  const map = board(true, select);
  const mapPanel = $(".map-panel");
  mapPanel.append(map.grid);

  // The root fills the host's flex slot, independently of map/sidebar content.
  // Observe that stable slot rather than a panel whose width this changes.
  function fitMap() {
    atlas.classList.toggle("stacked", root.clientWidth <= 680);
    const outer = getComputedStyle(atlas), frame = getComputedStyle(mapPanel);
    const layout = getComputedStyle($(".main-layout")), grid = getComputedStyle(map.grid);
    const px = value => parseFloat(value) || 0;
    const inset = (style, sides) => sides.reduce((sum, side) =>
      sum + px(style[`padding${side}`]) + px(style[`border${side}Width`]), 0);
    const frameWidth = inset(frame, ["Left", "Right"]);
    const frameHeight = inset(frame, ["Top", "Bottom"]);
    const gap = 7 * px(grid.columnGap);
    const availableHeight = root.clientHeight - inset(outer, ["Top", "Bottom"]) - frameHeight;
    const fromHeight = Math.max(0, availableHeight - gap) * 32 / 23 + gap + frameWidth;
    const availableWidth = root.clientWidth - inset(outer, ["Left", "Right"]);
    const fromWidth = availableWidth - px(layout.columnGap) - px(outer.getPropertyValue("--sidebar-min"));
    atlas.style.setProperty("--map-width", `${Math.max(0, Math.min(fromHeight, fromWidth))}px`);
  }
  const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitMap);
  sizeObserver?.observe(root);
  window.addEventListener("resize", fitMap);
  // The stylesheet loads asynchronously; fit again once its grid gap is available.
  root.querySelector('link[rel="stylesheet"]')?.addEventListener("load", fitMap, { once: true, signal: api.signal });
  fitMap();

  function render() {
    const item = room(value, selected);
    $("h3").textContent = label(selected);
    $(".room-picture").hidden = !item.image;
    $(".remove").hidden = !item.image;
    check.disabled = !item.image;
    check.checked = !!item.image && !!item.solved;
    images.show($(".room-picture img"), item.image);
    $(".room-picture img").alt = `Комната ${label(selected)}`;
    renderNote(drafts.get(selected)?.text ?? item.note);
    map.render(value, selected, images);
    images.prune(value);
  }
  function select(key) {
    void flushNotes().catch(() => undefined);
    if (selected !== key) disposeNoteUI();
    selected = key;
    render();
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
  function disposeNoteUI() {
    const previous = noteUI;
    noteUI = null;
    previous?.handle.dispose();
  }
  function noteChanged(session, text) {
    if (disposed || noteUI !== session) return;
    session.text = text;
    drafts.set(session.key, { text });
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { noteTimer = 0; void flushNotes().catch(() => undefined); }, 400);
    savingStatus();
  }
  function renderNote(text) {
    // State subscriptions must never replace an active editor or its selection.
    if (noteUI?.kind === "editor") return;
    editButton.textContent = "Редактировать";
    noteTarget.classList.remove("editing");
    $(".note-empty").hidden = !!text;
    noteTarget.hidden = !text;
    if (noteUI) { noteUI.handle.update(text); return; }
    const session = { key: selected, kind: "markdown", text };
    noteUI = session;
    session.handle = api.ui.markdown(noteTarget, {
      value: text,
      onChange: next => { noteChanged(session, next); if (noteUI === session) renderNote(next); }
    });
  }
  function startEditing() {
    const text = drafts.get(selected)?.text ?? room(value, selected).note;
    disposeNoteUI();
    const session = { key: selected, kind: "editor", text, finishRequested: false, finishing: null };
    noteUI = session;
    editButton.textContent = "Готово";
    $(".note-empty").hidden = true;
    noteTarget.hidden = false;
    noteTarget.classList.add("editing");
    session.handle = api.ui.editor(noteTarget, {
      value: text,
      onChange: next => noteChanged(session, next),
      onBlur: () => { if (noteUI === session) void flushNotes().catch(() => undefined); },
      onSubmit: () => { if (noteUI === session) void finishEditing().catch(() => undefined); },
      onCancel: () => { if (noteUI === session) void finishEditing().catch(() => undefined); },
      autoFocus: true
    });
  }
  function finishEditing() {
    const session = noteUI;
    if (session?.kind !== "editor") return Promise.resolve();
    session.finishRequested = true;
    if (session.finishing) return session.finishing;
    session.finishing = (async () => {
      do {
        await flushNotes();
        if (disposed || noteUI !== session) return;
      } while (drafts.size);
      disposeNoteUI();
      renderNote(session.text);
      editButton.focus();
    })().finally(() => { session.finishing = null; });
    return session.finishing;
  }
  editButton.addEventListener("click", () => {
    if (noteUI?.kind === "editor") void finishEditing().catch(() => undefined);
    else startEditing();
  });
  check.addEventListener("change", () => { void save(selected, { solved: check.checked }).catch(() => undefined); });
  $(".remove").addEventListener("click", () => { void save(selected, { image: null, solved: false }).catch(() => undefined); });
  $(".retry").addEventListener("click", () => {
    if (saveFailure) void saveFailure.retry().then(() => {
      if (noteUI?.finishRequested) return finishEditing();
    }).catch(() => undefined);
  });
  const unsubscribeClose = api.page.beforeClose(beforeClose);
  $(".upload").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    // Safari needs the chosen FileList to stay alive while queued files are read.
    const selection = fileInput.files;
    void importFiles([...selection]).finally(() => {
      if (fileInput.files === selection) fileInput.value = "";
    });
  });

  async function importFiles(files) {
    if (!files.length || disposed) return;
    queue.push(...files);
    if (busy) return importIdle;
    let finishImport;
    importIdle = new Promise(resolve => { finishImport = resolve; });
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
    } finally { busy = false; atlas.removeAttribute("aria-busy"); finishImport(); }
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
  render();
  const unsubscribe = api.state.subscribe(snapshot => { value = state(snapshot.value); render(); });
  return () => {
    disposed = true;
    window.clearTimeout(noteTimer);
    disposeNoteUI();
    unsubscribeClose();
    queue.length = 0;
    sizeObserver?.disconnect();
    window.removeEventListener("resize", fitMap);
    unsubscribe();
    images.dispose();
  };
}
