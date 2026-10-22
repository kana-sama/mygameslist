import { createContext, Suspense, useContext, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSmartNoteUi, SmartNoteUiPortals } from "../src/components/smart/smartNoteUi";
import type { MonacoNoteEditorProps } from "../src/components/MonacoNoteEditor";
import { observeSmartNoteStyles } from "../src/components/smart/smartNoteStyles";

const Context = createContext("missing");
const editor = vi.hoisted(() => ({ mounted: vi.fn(), disposed: vi.fn(), focused: vi.fn(), pending: null as Promise<void> | null }));
vi.mock("../src/components/LazyMonacoNoteEditor", async () => {
  const { useEffect } = await import("react");
  return { LazyMonacoNoteEditor(props: MonacoNoteEditorProps) {
    const context = useContext(Context);
    if (editor.pending) throw editor.pending;
    useImperativeHandle(props.ref, () => ({ focus: editor.focused }));
    useEffect(() => { editor.mounted(props); return () => editor.disposed(); }, []);
    return <textarea aria-label={context} value={props.value} onChange={event => props.onChange(event.target.value)} onBlur={props.onBlur} />;
  } };
});
const controllers: AbortController[] = [];
afterEach(() => { act(() => controllers.splice(0).forEach(controller => controller.abort())); editor.pending = null; cleanup(); document.body.replaceChildren(); editor.mounted.mockClear(); editor.disposed.mockClear(); editor.focused.mockClear(); });
function setup() {
  const root = document.createElement("div"); document.body.append(root);
  const target = document.createElement("section"); root.append(target);
  const controller = new AbortController(); controllers.push(controller);
  const bridge = createSmartNoteUi(root, controller.signal);
  const view = render(<Context value="service context"><Suspense fallback="Loading"><SmartNoteUiPortals bridge={bridge} gameSuggestions={[]} /></Suspense></Context>);
  return { root, target, controller, bridge, view };
}
function widget(target: HTMLElement) { return target.querySelector("[data-smart-ui]")!.shadowRoot!; }
describe("service UI for synthetic smart note programs", () => {
  it("keeps a ready page and sibling visible while a new editor waits for service CSS", async () => {
    const source = document.createElement("link"); source.rel = "stylesheet"; source.href = "/cold-service.css"; document.head.append(source);
    const { root, target, bridge } = setup();
    const pending = vi.fn(), fail = vi.fn();
    const pageStyles = observeSmartNoteStyles(root, pending, fail);
    const additions: Element[] = [];
    try {
      await act(async () => { bridge.api.markdown(target, { value: "Ready sibling" }); });
      const sibling = widget(target), siblingLink = sibling.querySelector("link")!;
      await act(async () => { fireEvent.load(siblingLink); });
      expect(pending).toHaveBeenLastCalledWith(false);
      const editorTarget = document.createElement("section"); root.append(editorTarget);
      await act(async () => { bridge.api.editor(editorTarget, { value: "Draft", onChange() {} }); });
      expect(pending).toHaveBeenLastCalledWith(false);
      expect(sibling.querySelector("link")).toBe(siblingLink);
      expect(sibling.querySelector(".smart-ui-content")).not.toHaveAttribute("aria-hidden", "true");
      const editorRoot = widget(editorTarget), content = editorRoot.querySelector(".smart-ui-content")!;
      expect(content).toHaveAttribute("aria-hidden", "true");
      expect(editorRoot.querySelector('[role="status"]')).toHaveTextContent("Загружаем редактор…");
      const later = document.createElement("link"); later.rel = "stylesheet"; later.href = "/lazy-service.css";
      const inline = document.createElement("style"); inline.textContent = ".monaco { color: red }";
      additions.push(later, inline);
      await act(async () => { document.head.append(later, inline); });
      expect(sibling.querySelector("link")).toBe(siblingLink);
      expect(sibling.querySelector(".smart-ui-content")).not.toHaveAttribute("aria-hidden", "true");
      expect(pending).toHaveBeenLastCalledWith(false);
      const editorLink = editorRoot.querySelector("link")!;
      await act(async () => { inline.textContent = ".monaco { color: blue }"; });
      expect(editorRoot.textContent).toContain(".monaco { color: blue }");
      expect(editorRoot.querySelector("link")).toBe(editorLink);
      await act(async () => { fireEvent.load(editorRoot.querySelector("link")!); });
      expect(content).toHaveAttribute("aria-hidden", "true");
      await act(async () => { fireEvent.load(editorRoot.querySelectorAll("link")[1]); });
      expect(content).not.toHaveAttribute("aria-hidden");
      expect(editorRoot.querySelector('[role="status"]')).toBeNull();
      expect(fail).not.toHaveBeenCalled();
    } finally { pageStyles.dispose(); source.remove(); additions.forEach(element => element.remove()); }
  });
  it.each(["focus", "autoFocus"])("retains %s until both lazy editor and its service styles are ready", async route => {
    const source = document.createElement("link"); source.rel = "stylesheet"; source.href = "/focus-service.css"; document.head.append(source);
    let resolve!: () => void;
    editor.pending = new Promise<void>(done => { resolve = done; });
    const { target, bridge } = setup();
    try {
      await act(async () => {
        const handle = bridge.api.editor(target, { value: "Draft", autoFocus: route === "autoFocus", onChange() {} });
        if (route === "focus") handle.focus();
      });
      const shadow = widget(target), content = shadow.querySelector(".smart-ui-content")!;
      await act(async () => { editor.pending = null; resolve(); });
      expect(content).toHaveAttribute("aria-hidden", "true");
      expect(editor.focused).not.toHaveBeenCalled();
      await act(async () => { fireEvent.load(shadow.querySelector("link")!); });
      expect(content).not.toHaveAttribute("aria-hidden");
      expect(editor.focused).toHaveBeenCalledOnce();
    } finally { source.remove(); }
  });

  it("contains initial widget CSS errors and ignores late style events after disposal", async () => {
    const source = document.createElement("link"); source.rel = "stylesheet"; source.href = "/broken-service.css"; document.head.append(source);
    const { root, target, bridge } = setup(), pending = vi.fn(), fail = vi.fn();
    const pageStyles = observeSmartNoteStyles(root, pending, fail);
    try {
      let handle!: ReturnType<typeof bridge.api.editor>;
      await act(async () => { handle = bridge.api.editor(target, { value: "Draft", onChange() {} }); handle.focus(); });
      const shadow = widget(target), link = shadow.querySelector("link")!;
      await act(async () => { fireEvent.error(link); });
      expect(shadow.querySelector('[role="alert"]')).toHaveTextContent("broken-service.css");
      expect(shadow.querySelector("textarea")).toBeNull();
      expect(pending).toHaveBeenLastCalledWith(false); expect(fail).not.toHaveBeenCalled();
      expect(editor.focused).not.toHaveBeenCalled();
      act(() => handle.dispose());
      await act(async () => { fireEvent.load(link); fireEvent.error(link); });
      expect(target).toBeEmptyDOMElement(); expect(fail).not.toHaveBeenCalled(); expect(editor.focused).not.toHaveBeenCalled();
    } finally { pageStyles.dispose(); source.remove(); }
  });
  it("renders real Markdown, tasks and updates inside an isolated root without loading an editor", async () => {
    const { target, bridge } = setup(); const onChange = vi.fn();
    let handle!: ReturnType<typeof bridge.api.markdown>;
    act(() => { handle = bridge.api.markdown(target, { value: "# Heading\n\n**Bold** [Link](https://example.com)\n\n- [ ] Task\n\n| A | B |\n| - | - |\n| 1 | 2 |", onChange }); });
    const shadow = widget(target);
    expect(shadow.querySelector("h2")).toHaveTextContent("Heading");
    expect(shadow.querySelector("strong")).toHaveTextContent("Bold");
    expect(shadow.querySelectorAll("table")).toHaveLength(1);
    expect(target.querySelector("h2")).toBeNull(); expect(editor.mounted).not.toHaveBeenCalled();
    fireEvent.click(shadow.querySelector('input[type="checkbox"]')!);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("- [x] Task"));
    act(() => handle.update("## Updated"));
    expect(shadow.querySelector("h3")).toHaveTextContent("Updated"); expect(onChange).toHaveBeenCalledTimes(1);
    act(() => { handle.dispose(); handle.dispose(); }); expect(target).toBeEmptyDOMElement();
  });
  it("mirrors existing and dynamic service styles, excluding authored shadow styles", async () => {
    const style = document.createElement("style"); style.textContent = ".markdown { color: red }"; document.head.append(style);
    const { root, target, bridge } = setup();
    const authored = document.createElement("div"); const authoredShadow = authored.attachShadow({ mode: "open" }); authoredShadow.innerHTML = '<style>p { color: pink }</style>'; root.append(authored);
    act(() => { bridge.api.markdown(target, { value: "Text" }); });
    expect(widget(target).textContent).toContain(".markdown { color: red }");
    expect(widget(target).textContent).not.toContain("pink");
    style.textContent = ".markdown { color: blue }";
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/lazy-editor.css"; document.head.append(link);
    await waitFor(() => { expect(widget(target).textContent).toContain("blue"); expect(widget(target).querySelector('link[href$="lazy-editor.css"]')).not.toBeNull(); });
    style.remove(); link.remove();
  });
  it("requires mount ownership, accepts nested shadow targets, and rejects a closed scope", () => {
    const { root, target, controller, bridge } = setup();
    expect(() => bridge.api.markdown(document.body, { value: "Foreign" })).toThrow(/target/i);
    const nested = document.createElement("div"); root.append(nested); const inner = nested.attachShadow({ mode: "open" }); const owned = document.createElement("div"); inner.append(owned);
    let handle!: ReturnType<typeof bridge.api.markdown>;
    act(() => { handle = bridge.api.markdown(owned, { value: "Owned" }); });
    expect(widget(owned).querySelector("p")).toHaveTextContent("Owned");
    act(() => controller.abort()); expect(owned).toBeEmptyDOMElement();
    expect(() => handle.update("Late")).toThrow(/disposed/i);
    expect(() => bridge.api.editor(target, { value: "Late", onChange() {} })).toThrow(/disposed/i);
    expect(() => handle.dispose()).not.toThrow();
  });
  it("mounts the shared editor in host context, forwards events and cleans up on abort", () => {
    const { target, bridge, controller } = setup(); const onChange = vi.fn(), onBlur = vi.fn(), onSubmit = vi.fn(), onCancel = vi.fn();
    let handle!: ReturnType<typeof bridge.api.editor>;
    act(() => { handle = bridge.api.editor(target, { value: "Draft", onChange, onBlur, onSubmit, onCancel, autoFocus: true }); });
    const input = widget(target).querySelector("textarea")!;
    expect(input).toHaveAttribute("aria-label", "service context");
    expect(editor.mounted.mock.calls[0][0]).toMatchObject({ filesDisabled: true, autoFocus: true });
    const callbacks = editor.mounted.mock.calls[0][0] as MonacoNoteEditorProps;
    callbacks.onSubmit?.(); callbacks.onCancel?.();
    expect(onSubmit).toHaveBeenCalledOnce(); expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { value: "Typed" } }); expect(onChange).toHaveBeenCalledWith("Typed");
    fireEvent.blur(input); expect(onBlur).toHaveBeenCalledOnce();
    act(() => { handle.update("External"); handle.focus(); }); expect(input).toHaveValue("External"); expect(editor.focused).toHaveBeenCalledOnce();
    act(() => handle.update("External"));
    expect(onChange).toHaveBeenCalledTimes(1); expect(editor.mounted).toHaveBeenCalledOnce();
    act(() => controller.abort()); expect(editor.disposed).toHaveBeenCalledOnce(); expect(target).toBeEmptyDOMElement();
    callbacks.onBlur?.(); callbacks.onSubmit?.(); callbacks.onCancel?.(); callbacks.onChange("Late");
    expect(onBlur).toHaveBeenCalledOnce(); expect(onSubmit).toHaveBeenCalledOnce(); expect(onCancel).toHaveBeenCalledOnce(); expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("lets unhandled Escape reach the modal unless the editor has a local cancel action", () => {
    const { target, bridge } = setup(); const escape = vi.fn();
    document.addEventListener("keydown", escape);
    try {
      let handle!: ReturnType<typeof bridge.api.editor>;
      act(() => { handle = bridge.api.editor(target, { value: "Draft", onChange() {} }); });
      fireEvent.keyDown(widget(target).querySelector("textarea")!, { key: "Escape", composed: true, cancelable: true });
      expect(escape).toHaveBeenCalledOnce();
      act(() => { handle.dispose(); bridge.api.editor(target, { value: "Draft", onChange() {}, onCancel() {} }); });
      fireEvent.keyDown(widget(target).querySelector("textarea")!, { key: "Escape", composed: true, cancelable: true });
      expect(escape).toHaveBeenCalledOnce();
    } finally { document.removeEventListener("keydown", escape); }
  });

  it("retains focus requested before lazy loading and never mounts a disposed pending editor", async () => {
    let resolve!: () => void;
    editor.pending = new Promise<void>(done => { resolve = done; });
    const { target, bridge, controller } = setup();
    let handle!: ReturnType<typeof bridge.api.editor>;
    act(() => { handle = bridge.api.editor(target, { value: "Pending", onChange() {} }); handle.focus(); });
    expect(editor.mounted).not.toHaveBeenCalled();
    await act(async () => { editor.pending = null; resolve(); });
    expect(editor.mounted).toHaveBeenCalledOnce(); expect(editor.focused).toHaveBeenCalledOnce();
    act(() => handle.dispose()); editor.mounted.mockClear();
    editor.pending = new Promise<void>(done => { resolve = done; });
    act(() => { bridge.api.editor(target, { value: "Obsolete", onChange() {} }); });
    act(() => controller.abort());
    await act(async () => { editor.pending = null; resolve(); });
    expect(editor.mounted).not.toHaveBeenCalled(); expect(target).toBeEmptyDOMElement();
  });

});
