import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Game } from "../../domain/types";
import type { SmartNoteEditorOptions, SmartNoteMarkdownOptions, SmartNoteUi } from "../../state/smartNoteRuntime";
import { LazyMonacoNoteEditor } from "../LazyMonacoNoteEditor";
import type { MonacoMarkdownEditorHandle } from "../MonacoMarkdownEditor";
import { MarkdownView } from "../Markdown";
import { composedContains } from "./smartNoteFocus";
import { observeSmartNoteStyles, registerSmartNoteStyleBoundary } from "./smartNoteStyles";

interface Widget {
  id: string;
  kind: "markdown" | "editor";
  value: string;
  options: SmartNoteMarkdownOptions | SmartNoteEditorOptions;
  host: HTMLElement;
  content: HTMLElement;
  styles: HTMLElement;
  defaults: HTMLStyleElement;
  styleCopies: Map<Element, Element>;
  styleLifecycle: { refresh(): void; dispose(): void };
  stylesPending: boolean;
  styleError: Error | null;
  stylesInitialized: boolean;
  revealed: boolean;
  editor: MonacoMarkdownEditorHandle | null;
  focusRequested: boolean;
  disposed: boolean;
}
let nextId = 0;
const emptyGames: readonly Game[] = [];
const ignoreFiles = () => {};

/** Host-owned UI only. The state runtime has no React or editor dependencies. */
export function createSmartNoteUi(root: HTMLElement, signal: AbortSignal) {
  let closed = false;
  let widgets: readonly Widget[] = [];
  const listeners = new Set<() => void>();
  const publish = () => { widgets = [...widgets]; listeners.forEach(listener => listener()); };
  const active = () => { if (closed || signal.aborted) throw new Error("Smart note UI scope disposed"); };
  const live = (widget: Widget) => { active(); if (widget.disposed) throw new Error("Smart note UI disposed"); };

  // Use the actual service styles, including Vite's live style tags and Monaco's
  // dynamically inserted rules. Never copy authored styles from another shadow.
  const mirrorStyles = () => {
    const sources = [...root.ownerDocument.querySelectorAll('style, link[rel~="stylesheet"]')];
    const bodyStyle = getComputedStyle(root.ownerDocument.body);
    const serviceStyle = getComputedStyle(root.ownerDocument.documentElement);
    for (const widget of widgets) {
      const current = new Set(sources);
      for (const [source, copy] of widget.styleCopies) {
        if (!current.has(source)) { copy.remove(); widget.styleCopies.delete(source); }
      }
      let previous: Element | null = null;
      for (const source of sources) {
        let copy = widget.styleCopies.get(source);
        if (!copy) { copy = source.cloneNode(true) as Element; widget.styleCopies.set(source, copy); }
        else {
          for (const attribute of [...copy.attributes]) if (!source.hasAttribute(attribute.name)) copy.removeAttribute(attribute.name);
          for (const attribute of source.attributes) if (copy.getAttribute(attribute.name) !== attribute.value) copy.setAttribute(attribute.name, attribute.value);
          if (source instanceof HTMLStyleElement && copy.textContent !== source.textContent) copy.textContent = source.textContent;
        }
        // Keep loaded link nodes in place when another widget or Monaco style
        // appears. Replacing/reinserting them starts fresh shadow CSS requests.
        const next: Element | null = previous ? previous.nextElementSibling : widget.styles.firstElementChild;
        if (copy !== next) widget.styles.insertBefore(copy, next);
        previous = copy;
      }
      // :root/body selectors do not match inside a shadow tree. Carry the
      // service's inherited defaults and variables across that boundary.
      const declarations = [`font:${bodyStyle.font || serviceStyle.font}`, `color:${bodyStyle.color}`, `color-scheme:${serviceStyle.colorScheme}`];
      for (let i = 0; i < serviceStyle.length; i++) {
        const property = serviceStyle.item(i);
        if (property.startsWith("--")) declarations.push(`${property}:${serviceStyle.getPropertyValue(property)}`);
      }
      const defaults = `:host{all:initial;display:block;position:relative;min-width:0;${declarations.join(";")}${widget.kind === "editor" ? ";height:100%" : ""}}${widget.kind === "editor" ? ".smart-ui-content,.smart-ui-content>.monaco-note-editor{height:100%;min-height:0;min-width:0}" : ""}`;
      if (widget.defaults.textContent !== defaults) widget.defaults.textContent = defaults;
      widget.stylesInitialized = true;
      widget.styleLifecycle.refresh();
    }
  };
  const isStyle = (node: Node) => node instanceof Element && (node.matches('style, link[rel~="stylesheet"]') || Boolean(node.querySelector('style, link[rel~="stylesheet"]')));
  const observer = new MutationObserver(records => {
    if (records.some(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('style, link[rel~="stylesheet"]') || [...record.addedNodes, ...record.removedNodes].some(isStyle) || record.type === "attributes" && record.target === root.ownerDocument.documentElement)) mirrorStyles();
  });
  observer.observe(root.ownerDocument.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });

  function mount(kind: Widget["kind"], target: HTMLElement, options: SmartNoteMarkdownOptions | SmartNoteEditorOptions) {
    active();
    if (!(target instanceof HTMLElement) || !composedContains(root, target)) throw new Error("Smart note UI target must belong to the current mount");
    // A widget cannot mount more UI inside the service-owned tree.
    if (widgets.some(widget => composedContains(widget.host, target))) throw new Error("Smart note UI target is service-owned");
    const host = root.ownerDocument.createElement("div"); host.dataset.smartUi = kind;
    const shadow = host.attachShadow({ mode: "open" });
    registerSmartNoteStyleBoundary(shadow);
    const styles = root.ownerDocument.createElement("div"); styles.style.display = "contents";
    const defaults = root.ownerDocument.createElement("style"); styles.append(defaults);
    const content = root.ownerDocument.createElement("div"); content.className = "smart-ui-content";
    const status = root.ownerDocument.createElement("div");
    // This loader must work before the service CSS itself has loaded.
    status.style.cssText = "position:absolute;inset:0;display:grid;place-items:center";
    // Monaco consumes its own keyboard events. Do not let an unhandled Escape
    // close the modal while it is dismissing a suggestion or other transient UI.
    if (kind === "editor" && (options as SmartNoteEditorOptions).onCancel) content.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    shadow.append(styles, content); target.append(host);
    const widget: Widget = { id: `smart-ui-${++nextId}`, kind, value: options.value, options, host, content, styles, defaults, styleCopies: new Map(), styleLifecycle: { refresh() {}, dispose() {} }, stylesPending: false, styleError: null, stylesInitialized: false, revealed: false, editor: null, focusRequested: false, disposed: false };
    const gateStyles = () => {
      if (closed || signal.aborted || widget.disposed) return;
      if (widget.stylesInitialized && !widget.stylesPending && !widget.styleError && (kind === "markdown" || widget.editor)) widget.revealed = true;
      // Additional service styles must not interrupt siblings which already
      // rendered successfully. A cold editor remains gated until its lazy
      // component and the mirrored styles have both become ready.
      const hidden = !widget.revealed && (widget.stylesPending || Boolean(widget.styleError));
      content.inert = hidden;
      content.style.visibility = hidden ? "hidden" : "";
      content.style.opacity = hidden ? "0" : "";
      if (hidden) {
        content.setAttribute("aria-hidden", "true");
        status.setAttribute("role", widget.styleError ? "alert" : "status");
        status.textContent = widget.styleError?.message ?? (kind === "editor" ? "Загружаем редактор…" : "Загрузка заметки…");
        shadow.append(status);
      } else {
        content.removeAttribute("aria-hidden"); status.remove();
        if (widget.editor && widget.focusRequested) { widget.focusRequested = false; widget.editor.focus(); }
      }
      host.setAttribute("aria-busy", String(hidden && !widget.styleError));
    };
    widget.styleLifecycle = observeSmartNoteStyles(shadow, pending => {
      const changed = widget.stylesPending !== pending;
      if (pending && !widget.revealed && kind === "editor" && (options as SmartNoteEditorOptions).autoFocus) widget.focusRequested = true;
      widget.stylesPending = pending; gateStyles();
      if (changed) publish();
    }, reason => { if (!widget.revealed) { widget.styleError = reason; gateStyles(); publish(); } });
    widgets = [...widgets, widget]; mirrorStyles(); publish();
    const dispose = () => {
      if (widget.disposed) return;
      widget.disposed = true; widget.styleLifecycle.dispose(); widget.editor = null;
      widgets = widgets.filter(entry => entry !== widget); host.remove(); publish();
    };
    return { update(value: string) { live(widget); if (widget.value !== value) { widget.value = value; publish(); } }, dispose,
      focus() { live(widget); if (widget.editor && (widget.revealed || !widget.stylesPending) && !widget.styleError) widget.editor.focus(); else widget.focusRequested = true; } };
  }
  const api: SmartNoteUi = { markdown: (target, options) => { const { update, dispose } = mount("markdown", target, options); return { update, dispose }; }, editor: (target, options) => mount("editor", target, options) };
  function dispose() {
    if (closed) return;
    closed = true; observer.disconnect(); signal.removeEventListener("abort", dispose);
    for (const widget of widgets) { widget.disposed = true; widget.styleLifecycle.dispose(); widget.editor = null; widget.host.remove(); }
    widgets = []; publish();
  }
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();
  return { api, dispose, getSnapshot: () => widgets, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    callback(widget: Widget, name: "onBlur" | "onSubmit" | "onCancel") { if (!closed && !signal.aborted && !widget.disposed) (widget.options as SmartNoteEditorOptions)[name]?.(); },
    change(widget: Widget, value: string) { if (closed || signal.aborted || widget.disposed || widget.value === value) return; widget.value = value; publish(); widget.options.onChange?.(value); },
  };
}
export type SmartNoteUiBridge = ReturnType<typeof createSmartNoteUi>;

export function SmartNoteUiPortals({ bridge, gameSuggestions = emptyGames }: { bridge: SmartNoteUiBridge; gameSuggestions?: readonly Game[] }) {
  const widgets = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  return widgets.map(widget => createPortal(widget.styleError ? null : widget.kind === "markdown"
    ? <MarkdownView markdown={widget.value} onTaskChange={widget.options.onChange ? value => bridge.change(widget, value) : undefined} taskChangesDisabled={!widget.options.onChange} />
    : <LazyMonacoNoteEditor
      ref={editor => { widget.editor = editor; if (editor && widget.stylesInitialized && !widget.stylesPending && !widget.styleError) widget.revealed = true; if (editor && widget.focusRequested && (widget.revealed || !widget.stylesPending)) { widget.focusRequested = false; editor.focus(); } }}
      modelKey={widget.id} value={widget.value} gameSuggestions={gameSuggestions}
      filesDisabled onImageFiles={ignoreFiles} onFileFiles={ignoreFiles}
      autoFocus={(widget.revealed || !widget.stylesPending) && (widget.options as SmartNoteEditorOptions).autoFocus}
      onBlur={(widget.options as SmartNoteEditorOptions).onBlur ? () => bridge.callback(widget, "onBlur") : undefined}
      onChange={value => bridge.change(widget, value)}
      onSubmit={(widget.options as SmartNoteEditorOptions).onSubmit ? () => bridge.callback(widget, "onSubmit") : undefined}
      onCancel={(widget.options as SmartNoteEditorOptions).onCancel ? () => bridge.callback(widget, "onCancel") : undefined}
    />, widget.content, widget.id));
}
