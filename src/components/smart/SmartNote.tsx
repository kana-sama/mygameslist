import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Game, Note } from "../../domain/types";
import { smartProgramBaseUrl } from "../../domain/smartNote";
import { useLibrarySelector } from "../../state/LibraryContext";
import type { SmartNoteApi, SmartNoteBeforeClose, SmartNoteMode, SmartNotePageControls, SmartNoteScope } from "../../state/smartNoteRuntime";
import { composedContains, deepestActiveElement, smartFocusableElements } from "./smartNoteFocus";
import { createSmartNoteUi, SmartNoteUiPortals, type SmartNoteUiBridge } from "./smartNoteUi";
import "./smartNote.css";
const emptyGames: readonly Game[] = [];

export type SmartNoteScopeFactory = (noteId: string, mode: SmartNoteMode, page: SmartNotePageControls) => SmartNoteScope;
export interface SmartNoteModule { mount: (root: HTMLElement, api: SmartNoteApi) => void | (() => void) | Promise<void | (() => void)> }
export type SmartNoteModuleLoader = (url: string) => Promise<SmartNoteModule>;
const nativeLoader: SmartNoteModuleLoader = (url) => import(/* @vite-ignore */ url);
type SmartHostNote = Pick<Note, "id" | "smart">;

function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

function SmartMount({ note, mode, createScope, page, loader, registerClose, gameSuggestions }: { gameSuggestions: readonly Game[]; note: SmartHostNote; mode: SmartNoteMode; createScope: SmartNoteScopeFactory; page: SmartNotePageControls; loader: SmartNoteModuleLoader; registerClose?: (handler: SmartNoteBeforeClose | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [uiBridge, setUiBridge] = useState<SmartNoteUiBridge | null>(null);
  const [visible, setVisible] = useState(mode === "page");
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ message: string; retry: boolean } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (visible || !host.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [visible]);
  const definition = note.smart;
  useEffect(() => {
    if (!visible || !host.current || !definition) return;
    const entrypoint = definition.entrypoints[mode];
    if (!entrypoint) return;
    let stopped = false;
    let cleanup: (() => void) | undefined;
    let scope: SmartNoteScope | undefined;
    let ui: SmartNoteUiBridge | undefined;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    const root = document.createElement("div");
    shadow.replaceChildren(root);
    // The shelf measures a light-DOM clone, so notify it when opaque content
    // changes. Observe the natural inner root rather than the clipped viewport.
    let sizeFrame = 0;
    const notifySize = () => {
      if (mode !== "preview" || stopped || sizeFrame) return;
      sizeFrame = window.requestAnimationFrame(() => {
        sizeFrame = 0;
        if (!stopped) host.current?.dispatchEvent(new CustomEvent("shelf-content-resize", { bubbles: true }));
      });
    };
    const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(notifySize);
    sizeObserver?.observe(root);
    const contentObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(notifySize);
    contentObserver?.observe(shadow, { attributes: true, characterData: true, childList: true, subtree: true });
    root.addEventListener("load", notifySize, true);
    notifySize();
    setFailure(null); setSaveError(null); setLoading(true);
    const run = async () => {
      let imported = false;
      try {
        // Scope creation/get must reject conflicts before any program executes.
        scope = createScope(note.id, mode, page);
        scope.api.state.get();
        registerClose?.(() => {
          try {
            const pending = scope!.prepareClose();
            return pending?.catch(reason => { if (!stopped) setSaveError(message(reason)); throw reason; });
          } catch (reason) { if (!stopped) setSaveError(message(reason)); throw reason; }
        });
        ui = createSmartNoteUi(root, scope.api.signal);
        setUiBridge(ui);
        const api: SmartNoteApi = { ...scope.api, ui: ui.api, state: { ...scope.api.state,
          update: async (...args) => { try { const result = await scope!.api.state.update(...args); if (!stopped) setSaveError(null); return result; } catch (reason) { if (!stopped) setSaveError(message(reason)); throw reason; } },
          set: async (...args) => { try { const result = await scope!.api.state.set(...args); if (!stopped) setSaveError(null); return result; } catch (reason) { if (!stopped) setSaveError(message(reason)); throw reason; } },
        } };
        const base = smartProgramBaseUrl(note as Note, import.meta.env.BASE_URL);
        const module = await loader(new URL(entrypoint, new URL(base, document.baseURI)).href);
        imported = true;
        if (stopped) return;
        if (typeof module.mount !== "function") throw new Error("Модуль заметки не экспортирует mount(root, api)");
        const result = await module.mount(root, api);
        if (result !== undefined && typeof result !== "function") throw new Error("mount должен вернуть функцию очистки или undefined");
        if (stopped) { if (typeof result === "function") result(); root.replaceChildren(); }
        else cleanup = typeof result === "function" ? result : undefined;
      } catch (reason) {
        if (!stopped) {
          root.replaceChildren();
          registerClose?.(null);
          ui?.dispose();
          scope?.dispose();
          setFailure({ message: message(reason), retry: !imported && reason instanceof TypeError });
        }
      } finally { if (!stopped) setLoading(false); }
    };
    void run();
    return () => {
      stopped = true;
      registerClose?.(null);
      if (sizeFrame) window.cancelAnimationFrame(sizeFrame);
      sizeObserver?.disconnect();
      contentObserver?.disconnect();
      root.removeEventListener("load", notifySize, true);
      ui?.dispose();
      scope?.dispose();
      try { cleanup?.(); } catch (reason) { console.error("Smart note cleanup failed", reason); }
      // Detach the mount so late async code cannot reinsert itself in the visible tree.
      shadow.replaceChildren();
    };
  }, [visible, attempt, note.id, definition?.program.hash, mode, createScope, page, loader, registerClose]);
  return <div className={`smart-note-mount smart-note-mount--${mode}`}>
    <div aria-busy={loading} data-shelf-shadow-content={mode === "preview" ? "" : undefined} data-smart-mount={mode} ref={host} />
    {uiBridge ? <SmartNoteUiPortals bridge={uiBridge} gameSuggestions={gameSuggestions} /> : null}
    {loading ? <p className="smart-note-status" role="status">Загрузка заметки…</p> : null}
    {failure ? <div className="field-error" role="alert">Не удалось открыть заметку: {failure.message}{failure.retry ? <button type="button" onClick={() => setAttempt((value) => value + 1)}>Повторить загрузку</button> : <p>После исправления кода может потребоваться обновить страницу.</p>}</div> : null}
    {saveError ? <p className="field-error" role="alert">Изменение не сохранено: {saveError}</p> : null}
  </div>;
}

const modalStack: HTMLElement[] = [];
const inertLocks = new Map<HTMLElement, { count: number; previous: boolean }>();
let overflowBefore = "";
function lockBackground(portal: HTMLElement) {
  if (!modalStack.length) { overflowBefore = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  modalStack.push(portal);
  const siblings = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== portal);
  for (const sibling of siblings) {
    const lock = inertLocks.get(sibling) ?? { count: 0, previous: sibling.inert };
    lock.count++; inertLocks.set(sibling, lock); sibling.inert = true;
  }
  return () => {
    modalStack.splice(modalStack.indexOf(portal), 1);
    for (const sibling of siblings) { const lock = inertLocks.get(sibling)!; if (--lock.count === 0) { sibling.inert = lock.previous; inertLocks.delete(sibling); } }
    if (!modalStack.length) document.body.style.overflow = overflowBefore;
  };
}

function SmartModal({ note, createScope, page, loader, onClose, registerClose, gameSuggestions }: { gameSuggestions: readonly Game[]; note: SmartHostNote; createScope: SmartNoteScopeFactory; page: SmartNotePageControls; loader: SmartNoteModuleLoader; onClose: () => void; registerClose: (handler: SmartNoteBeforeClose | null) => void }) {
  const [portal] = useState(() => document.createElement("div"));
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const previousFocus = deepestActiveElement();
    document.body.append(portal);
    const unlock = lockBackground(portal);
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modalStack.at(-1) !== portal) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = smartFocusableElements(dialog.current);
      const index = focusable.indexOf(deepestActiveElement() as HTMLElement);
      event.preventDefault();
      const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
      (focusable[next] ?? dialog.current).focus();
    };
    const focusin = (event?: FocusEvent) => {
      const target = event?.target instanceof Element ? event.target : deepestActiveElement();
      if (modalStack.at(-1) === portal && dialog.current && !composedContains(dialog.current, target)) close.current?.focus();
    };
    let focusFrame = 0;
    const focusout = (event: FocusEvent) => {
      if (dialog.current && event.relatedTarget instanceof Element && composedContains(dialog.current, event.relatedTarget)) return;
      // Safari can run microtasks while native focus is still passing through
      // BODY. Wait for the destination before repairing an unknown transition.
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => { focusFrame = 0; focusin(); });
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    document.addEventListener("focusout", focusout);
    return () => {
      document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", focusin); document.removeEventListener("focusout", focusout);
      window.cancelAnimationFrame(focusFrame);
      unlock(); portal.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [portal, onClose]);
  return createPortal(<div className="smart-note-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }}><div aria-labelledby={titleId} aria-modal="true" className="smart-note-dialog" ref={dialog} role="dialog" tabIndex={-1}>
    <header className="smart-note-dialog-header"><h2 id={titleId}>{note.smart?.title}</h2><button aria-label="Закрыть заметку" onClick={onClose} ref={close} type="button">×</button></header>
    <SmartMount gameSuggestions={gameSuggestions} createScope={createScope} loader={loader} mode="page" note={note} page={page} registerClose={registerClose} />
  </div></div>, portal);
}

export function SmartNote({ note, createScope, loader = nativeLoader, dragging = false, conflict = false, gameSuggestions = emptyGames }: { gameSuggestions?: readonly Game[]; note: SmartHostNote; createScope: SmartNoteScopeFactory; loader?: SmartNoteModuleLoader; dragging?: boolean; conflict?: boolean }) {
  const [open, setOpen] = useState(false);
  const origin = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hasPage = Boolean(note.smart?.entrypoints.page);
  const prepareClose = useRef<SmartNoteBeforeClose | null>(null);
  const closing = useRef<Promise<void> | null>(null);
  const registerClose = useCallback((handler: SmartNoteBeforeClose | null) => { prepareClose.current = handler; if (!handler) closing.current = null; }, []);
  const close = useCallback(() => {
    if (closing.current) return;
    try {
      const handler = prepareClose.current;
      const pending = handler?.();
      if (!pending) { setOpen(false); return; }
      closing.current = pending;
      void pending.then(() => { if (prepareClose.current === handler) setOpen(false); }, () => undefined).finally(() => { if (closing.current === pending) closing.current = null; });
    } catch { /* The mount exposes the error and remains available for retry. */ }
  }, []);
  const controls = useRef<SmartNotePageControls>({ open: () => false, close });
  controls.current.open = () => { if (!hasPage || conflict || dragging) return false; setOpen(true); return true; };
  const page = useRef<SmartNotePageControls>({ open: () => controls.current.open(), close }).current;
  useEffect(() => { if (conflict) setOpen(false); }, [conflict]);
  const clickSuppressed = (event: MouseEvent) => event.defaultPrevented || dragging || origin.current?.moved || Boolean(document.getSelection()?.toString());
  const onClick = (event: MouseEvent) => {
    if (clickSuppressed(event)) return;
    const interactive = event.nativeEvent.composedPath().some((target) => target instanceof Element && target.matches('button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="slider"], [role="textbox"], [contenteditable]:not([contenteditable="false"]), [tabindex], [data-smart-no-open]'));
    if (!interactive) page.open();
  };
  return <div className="smart-note" onClick={onClick} onPointerDown={(event) => { origin.current = { x: event.clientX, y: event.clientY, moved: false }; }} onPointerMove={(event) => { const start = origin.current; if (start && Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) start.moved = true; }}>
    <h1 className="smart-note-title">{hasPage ? <button onClick={(event) => { if (!clickSuppressed(event)) page.open(); }} type="button">{note.smart?.title}</button> : note.smart?.title}</h1>
    {conflict ? <p className="field-error" role="alert">Локальные изменения этой заметки конфликтуют с опубликованной программой. Разрешите конфликт в локальных правках.</p> : <SmartMount gameSuggestions={gameSuggestions} createScope={createScope} loader={loader} mode="preview" note={note} page={page} />}
    {open && !conflict ? <SmartModal gameSuggestions={gameSuggestions} createScope={createScope} loader={loader} note={note} onClose={close} page={page} registerClose={registerClose} /> : null}
  </div>;
}

export function ConnectedSmartNote({ note, dragging }: { note: SmartHostNote; dragging?: boolean }) {
  const createScope = useLibrarySelector((library) => library.createSmartNoteScope);
  const conflict = useLibrarySelector((library) => library.conflicts.some((entry) => entry.path === `/notes/${note.id}` || entry.path.startsWith(`/notes/${note.id}/`)));
  const games = useLibrarySelector((library) => library.games);
  return <SmartNote gameSuggestions={Object.values(games)} conflict={conflict} createScope={createScope} dragging={dragging} note={note} />;
}
