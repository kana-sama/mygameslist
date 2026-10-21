import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Game } from "../../domain/types";
import type { SmartNoteEditorOptions, SmartNoteMarkdownOptions, SmartNoteUi } from "../../state/smartNoteRuntime";
import { LazyMonacoNoteEditor } from "../LazyMonacoNoteEditor";
import type { MonacoMarkdownEditorHandle } from "../MonacoMarkdownEditor";
import { MarkdownView } from "../Markdown";
import { composedContains } from "./smartNoteFocus";

interface Widget {
  id: string;
  kind: "markdown" | "editor";
  value: string;
  options: SmartNoteMarkdownOptions | SmartNoteEditorOptions;
  host: HTMLElement;
  content: HTMLElement;
  styles: HTMLElement;
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
      widget.styles.replaceChildren(...sources.map(source => source.cloneNode(true)));
      // :root/body selectors do not match inside a shadow tree. Carry the
      // service's inherited defaults and variables across that boundary.
      const defaults = root.ownerDocument.createElement("style");
      const declarations = [`font:${bodyStyle.font || serviceStyle.font}`, `color:${bodyStyle.color}`, `color-scheme:${serviceStyle.colorScheme}`];
      for (let i = 0; i < serviceStyle.length; i++) {
        const property = serviceStyle.item(i);
        if (property.startsWith("--")) declarations.push(`${property}:${serviceStyle.getPropertyValue(property)}`);
      }
      defaults.textContent = `:host{all:initial;display:block;min-width:0;${declarations.join(";")}${widget.kind === "editor" ? ";height:100%" : ""}}${widget.kind === "editor" ? ".smart-ui-content,.smart-ui-content>.monaco-note-editor{height:100%;min-height:0;min-width:0}" : ""}`;
      widget.styles.append(defaults);
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
    const styles = root.ownerDocument.createElement("div"); styles.style.display = "contents";
    const content = root.ownerDocument.createElement("div"); content.className = "smart-ui-content";
    // Monaco consumes its own keyboard events. Do not let an unhandled Escape
    // close the modal while it is dismissing a suggestion or other transient UI.
    if (kind === "editor" && (options as SmartNoteEditorOptions).onCancel) content.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    shadow.append(styles, content); target.append(host);
    const widget: Widget = { id: `smart-ui-${++nextId}`, kind, value: options.value, options, host, content, styles, editor: null, focusRequested: false, disposed: false };
    widgets = [...widgets, widget]; mirrorStyles(); publish();
    const dispose = () => {
      if (widget.disposed) return;
      widget.disposed = true; widget.editor = null;
      widgets = widgets.filter(entry => entry !== widget); host.remove(); publish();
    };
    return { update(value: string) { live(widget); if (widget.value !== value) { widget.value = value; publish(); } }, dispose,
      focus() { live(widget); if (widget.editor) widget.editor.focus(); else widget.focusRequested = true; } };
  }
  const api: SmartNoteUi = { markdown: (target, options) => { const { update, dispose } = mount("markdown", target, options); return { update, dispose }; }, editor: (target, options) => mount("editor", target, options) };
  function dispose() {
    if (closed) return;
    closed = true; observer.disconnect(); signal.removeEventListener("abort", dispose);
    for (const widget of widgets) { widget.disposed = true; widget.editor = null; widget.host.remove(); }
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
  return widgets.map(widget => createPortal(widget.kind === "markdown"
    ? <MarkdownView markdown={widget.value} onTaskChange={widget.options.onChange ? value => bridge.change(widget, value) : undefined} taskChangesDisabled={!widget.options.onChange} />
    : <LazyMonacoNoteEditor
      ref={editor => { widget.editor = editor; if (editor && widget.focusRequested) { widget.focusRequested = false; editor.focus(); } }}
      modelKey={widget.id} value={widget.value} gameSuggestions={gameSuggestions}
      filesDisabled onImageFiles={ignoreFiles} onFileFiles={ignoreFiles}
      autoFocus={(widget.options as SmartNoteEditorOptions).autoFocus}
      onBlur={(widget.options as SmartNoteEditorOptions).onBlur ? () => bridge.callback(widget, "onBlur") : undefined}
      onChange={value => bridge.change(widget, value)}
      onSubmit={(widget.options as SmartNoteEditorOptions).onSubmit ? () => bridge.callback(widget, "onSubmit") : undefined}
      onCancel={(widget.options as SmartNoteEditorOptions).onCancel ? () => bridge.callback(widget, "onCancel") : undefined}
    />, widget.content, widget.id));
}
