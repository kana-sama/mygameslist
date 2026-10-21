import { label, room, state, changeRoom, takePreviewSelection, isGridKey, isExtraKey, extraKeys, roomKeys, addExtraRoom, deleteExtraRoom, setRoomLink, linkedKeys } from "./model.js";
import { style, element, pictures, board, extraBoard } from "./view.js";
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
          <div class="inspector-tools">
          <div class="hud-crest" aria-hidden="true">
            <span class="hud-wing"></span>
            <svg class="hud-emblem" viewBox="0 0 104 44" focusable="false">
              <path fill="#78243d" d="M18 14h8V8h8V4h8V0h20v4h8v4h8v6h8v26H18z"/>
              <path fill="#ee315e" d="M20 14h8V8h8V4h8V2h16v2h8v4h8v6h8v24H20z"/>
              <path fill="#f0efd8" d="M26 16h6V10h8V6h24v4h8v6h6v20H26z"/>
              <path fill="#989c87" d="M26 20h6v12h40V20h6v16H26zM36 10h4v4h-4zM64 10h4v4h-4z"/>
              <path fill="#080a08" d="M36 16h32v4h4v12H32V20h4z"/>
              <path fill="#ea315e" d="M44 8h16v4H44zM48 6h8v10h-8z"/>
              <path fill="#f0efd8" d="M44 18h16v4h4v12h-8v4h-8v-4h-8V22h4z"/>
              <path fill="#aaa991" d="M44 22h4v12h-4zM56 22h4v12h-4z"/>
              <path fill="#080a08" d="M44 24h16v4h-4v6h-8v-6h-4z"/>
              <path fill="#f0efd8" d="M48 24h4v10h-4z"/>
              <path fill="#080a08" d="M18 36h68v8H18z"/>
              <path fill="#ee315e" d="M12 36h12v4h12v-2h32v2h12v-4h12v4h-8v4H20v-4h-8z"/>
              <path fill="#f0efd8" d="M28 40h16v2H28zM60 40h16v2H60z"/>
              <path fill="#78243d" d="M0 24h14v4H0zM90 24h14v4H90z"/>
              <path fill="#f0efd8" d="M0 24h10v2H0zM94 24h10v2H94z"/>
            </svg>
            <span class="hud-wing"></span>
          </div>
          <div class="toolbar">
            <button class="primary upload" type="button">Загрузить скрины</button>
            <input class="file-input" type="file" accept="image/*" multiple aria-label="Скриншоты Barbuta" hidden>
          </div>
          <div class="import-status" role="status" aria-live="polite"></div>
          <details class="failures" hidden><summary></summary><ul></ul></details>
          </div>
          <div class="inspector-room">
          <div class="room-header">
            <div class="room-name">
              <h3 aria-label="Комната"></h3>
              <input class="room-title-input" type="text" aria-label="Название комнаты" hidden>
              <button class="rename-room quiet" type="button" aria-label="Переименовать комнату" hidden>Имя</button>
            </div>
            <label class="solved-toggle"><input type="checkbox"><span>Разгадано</span></label>
          </div>
          <div class="room-picture">
            <img alt="">
            <div class="picture-empty">
              <svg viewBox="0 0 32 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2 0h28v2h2v20h-2v2H2v-2H0V2h2zm2 4v16h24V4zm4 2h4v4H8zm10 4h4v4h2v4H8v-2h2v-2h4v2h2v-4h2z"/></svg>
              <span>Нет скриншота</span>
            </div>
          </div>
          <div class="save-row"><button class="remove quiet" type="button">Убрать скрин</button></div>
          <div class="room-links">
            <div class="connection-list" aria-label="Связанные комнаты" hidden></div>
            <select class="connect-room" aria-label="Связать с комнатой"></select>
          </div>
          </div>
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
  if (!roomKeys(value).includes(selected)) selected = "4,3";
  let dragDepth = 0, noteTimer = 0, noteFlush = null, saveFailure = null, noteUI = null, titleEditing = null, connectionsSignature = "";
  const drafts = new Map(), writes = new Set();
  const deleting = new Set();
  const queue = [];
  let importIdle = Promise.resolve();
  const images = pictures(api, error => { status.textContent = error.message; status.classList.add("error"); });
  const map = board(true, select);
  const extras = extraBoard(true, select);
  const mapPanel = $(".map-panel"), inspector = $(".inspector");
  const titleInput = $(".room-title-input"), renameButton = $(".rename-room"), connectRoom = $(".connect-room");
  mapPanel.append(extras.grid, map.grid);

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
    const extraHeight = extras.grid.hidden ? 0 : extras.grid.getBoundingClientRect().height + px(frame.rowGap);
    const availableHeight = root.clientHeight - inset(outer, ["Top", "Bottom"]) - frameHeight - extraHeight;
    const availableWidth = root.clientWidth - inset(outer, ["Left", "Right"]);
    if (atlas.classList.contains("stacked")) {
      const remainingHeight = availableHeight - inspector.getBoundingClientRect().height - px(getComputedStyle(inspector).marginTop);
      const fromHeight = Math.max(0, remainingHeight - gap) * 32 / 23 + gap;
      const width = `${Math.max(0, Math.min(availableWidth - frameWidth, fromHeight))}px`;
      // The inspector keeps its full width; update only on a real size change.
      if (atlas.style.getPropertyValue("--mobile-map-width") !== width) atlas.style.setProperty("--mobile-map-width", width);
      return;
    }
    const fromHeight = Math.max(0, availableHeight - gap) * 32 / 23 + gap + frameWidth;
    const fromWidth = availableWidth - px(layout.columnGap) - px(outer.getPropertyValue("--sidebar-min"));
    const width = `${Math.max(0, Math.min(fromHeight, fromWidth))}px`;
    if (atlas.style.getPropertyValue("--map-width") !== width) atlas.style.setProperty("--map-width", width);
  }
  const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitMap);
  sizeObserver?.observe(root);
  sizeObserver?.observe(extras.grid);
  sizeObserver?.observe(inspector);
  window.addEventListener("resize", fitMap);
  // The stylesheet loads asynchronously; fit again once its grid gap is available.
  root.querySelector('link[rel="stylesheet"]')?.addEventListener("load", fitMap, { once: true, signal: api.signal });
  fitMap();

  function render() {
    if (!roomKeys(value).includes(selected)) {
      drafts.delete(selected);
      disposeNoteUI();
      titleEditing = null;
      selected = "4,3";
    }
    const item = room(value, selected);
    renderTitle();
    $(".picture-empty").hidden = !!item.image;
    $(".remove").hidden = !isExtraKey(selected) && !item.image;
    $(".remove").textContent = isExtraKey(selected) ? "Удалить комнату" : "Убрать скрин";
    $(".remove").disabled = deleting.has(selected);
    editButton.disabled = deleting.has(selected);
    check.disabled = !item.image;
    check.checked = !!item.image && !!item.solved;
    images.show($(".room-picture img"), item.image);
    $(".room-picture img").alt = `Комната ${label(selected, value)}`;
    renderConnections();
    renderNote(drafts.get(selected)?.text ?? item.note);
    map.render(value, selected, images);
    extras.render(value, selected, images);
    fitMap();
    images.prune(value);
  }
  function select(key) {
    if (!roomKeys(value).includes(key)) return;
    if (selected !== key) finishRename();
    void flushNotes().catch(() => undefined);
    if (selected !== key) disposeNoteUI();
    selected = key;
    render();
  }
  function focusRoom(key) {
    (isExtraKey(key) ? extras : map).focus(key);
  }
  function renderTitle() {
    const editing = titleEditing?.key === selected && isExtraKey(selected);
    $("h3").textContent = label(selected, value);
    $("h3").hidden = editing;
    titleInput.hidden = !editing;
    renameButton.hidden = !isExtraKey(selected) || editing;
    renameButton.disabled = deleting.has(selected);
  }
  function finishRename(cancel = false) {
    const session = titleEditing;
    if (!session) return;
    const title = titleInput.value.trim();
    titleEditing = null;
    renderTitle();
    if (!cancel && title && title !== label(session.key, value)) void save(session.key, { title }).catch(() => undefined);
  }
  function renderConnections() {
    const neighbors = linkedKeys(value, selected);
    const available = roomKeys(value).filter(key => key !== selected && !neighbors.includes(key));
    const signature = JSON.stringify([selected, neighbors, roomKeys(value).map(key => [key, label(key, value)])]);
    if (signature === connectionsSignature) return;
    connectionsSignature = signature;
    const list = $(".connection-list");
    list.replaceChildren();
    list.hidden = !neighbors.length;
    for (const key of neighbors) {
      const connection = element("span", "connection");
      const open = element("button", "connection-open", label(key, value));
      open.type = "button";
      open.setAttribute("aria-label", `Открыть комнату ${label(key, value)}`);
      open.addEventListener("click", () => { select(key); focusRoom(key); });
      const remove = element("button", "connection-remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Убрать связь с комнатой ${label(key, value)}`);
      const from = selected;
      remove.addEventListener("click", () => { void saveLink(from, key, false).catch(() => undefined); });
      connection.append(open, remove);
      list.append(connection);
    }
    const blank = element("option", "", "Связать с комнатой…");
    blank.value = "";
    connectRoom.replaceChildren(blank);
    for (const [name, matches] of [["Карта", isGridKey], ["Особые комнаты", isExtraKey]]) {
      const keys = available.filter(matches);
      if (!keys.length) continue;
      const group = element("optgroup");
      group.label = name;
      for (const key of keys) {
        const option = element("option", "", label(key, value));
        option.value = key;
        group.append(option);
      }
      connectRoom.append(group);
    }
    connectRoom.value = "";
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
    return write(current => isExtraKey(key) && !state(current).rooms[key] ? current : changeRoom(current, key, patch), retry, `${key}:${Object.keys(patch).join(",")}`);
  }
  function saveLink(a, b, enabled) {
    const retry = () => saveLink(a, b, enabled);
    return write(current => setRoomLink(current, a, b, enabled), retry, `link:${[a, b].sort().join(":")}`);
  }
  function removeRoom(key) {
    if (!isExtraKey(key)) return save(key, { image: null, solved: false });
    if (deleting.has(key)) return Promise.resolve();
    const pending = removeExtraRoom(key);
    writes.add(pending);
    savingStatus();
    return pending.finally(() => { writes.delete(pending); savingStatus(); });
  }
  async function removeExtraRoom(key) {
    deleting.add(key);
    if (noteUI?.key === key) disposeNoteUI();
    if (titleEditing?.key === key) finishRename();
    render();
    try {
      // Finish the note batch before deletion so an older draft cannot restore it.
      await flushNotes();
      const current = state(api.state.get().value);
      const fallback = linkedKeys(current, key).find(neighbor => roomKeys(current).includes(neighbor)) ?? "4,3";
      if (selected === key) select(fallback);
      await write(current => deleteExtraRoom(current, key), () => removeRoom(key), `delete:${key}`);
      drafts.delete(key);
    } finally {
      deleting.delete(key);
      if (!disposed) render();
    }
  }
  function flushNotes() {
    window.clearTimeout(noteTimer); noteTimer = 0;
    // A second flush waits for the first and then captures any newer drafts.
    if (noteFlush) return noteFlush.then(() => flushNotes());
    if (!drafts.size || disposed) return Promise.resolve();
    const batch = [...drafts];
    noteFlush = write(current => batch.reduce((next, [key, draft]) =>
      isExtraKey(key) && !state(next).rooms[key] ? next : changeRoom(next, key, { note: draft.text }), current), flushNotes, "notes")
      .then(() => { for (const [key, draft] of batch) if (drafts.get(key) === draft) drafts.delete(key); })
      .finally(() => { noteFlush = null; savingStatus(); });
    return noteFlush;
  }
  async function beforeClose() {
    finishRename();
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
    if (disposed || noteUI !== session || deleting.has(session.key)) return;
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
  renameButton.addEventListener("click", () => {
    if (!isExtraKey(selected) || deleting.has(selected)) return;
    titleEditing = { key: selected };
    titleInput.value = label(selected, value);
    renderTitle();
    titleInput.focus();
    titleInput.select();
  });
  titleInput.addEventListener("blur", () => finishRename());
  titleInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    finishRename(event.key === "Escape");
    renameButton.focus();
  });
  connectRoom.addEventListener("change", () => {
    const key = connectRoom.value;
    connectRoom.value = "";
    if (key) void saveLink(selected, key, true).catch(() => undefined);
  });
  check.addEventListener("change", () => { void save(selected, { solved: check.checked }).catch(() => undefined); });
  $(".remove").addEventListener("click", () => { void removeRoom(selected).catch(() => undefined); });
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
          const { key: locatedKey, blob } = await extract(file);
          const extra = locatedKey === null;
          const key = extra ? `extra:${crypto.randomUUID()}` : locatedKey;
          api.signal.throwIfAborted();
          const name = extra ? "особая комната" : `комната ${label(key, value)}`;
          ref = await api.assets.upload(blob, { name: `Barbuta-${extra ? "extra-room" : label(key, value)}.png`, alt: `Экран Barbuta, ${name}` });
          const existed = !extra && !!room(api.state.get().value, key).image;
          const pending = api.state.update(current => extra ? addExtraRoom(current, key, { image: ref }) : changeRoom(current, key, { image: ref }));
          writes.add(pending);
          try { await pending; } finally { writes.delete(pending); }
          if (existed) replaced++; else added++;
          visited.add(label(key, state(api.state.get().value))); lastKey = key;
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
    if (!delta || !isGridKey(selected)) return;
    event.preventDefault();
    const [x, y] = selected.split(",").map(Number);
    select(`${Math.max(0, Math.min(7, x + delta[0]))},${Math.max(0, Math.min(7, y + delta[1]))}`);
    map.focus(selected);
  });
  extras.grid.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" || !isExtraKey(selected)) return;
    const keys = extraKeys(value), index = keys.indexOf(selected);
    if (index === -1) return;
    event.preventDefault();
    select(keys[Math.max(0, Math.min(keys.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))]);
    extras.focus(selected);
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
