import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartNote, type SmartNoteModule, type SmartNoteModuleLoader, type SmartNoteScopeFactory } from "../src/components/smart/SmartNote";
import type { JsonValue, Note } from "../src/domain/types";
import type { SmartNoteApi, SmartNoteStateSnapshot } from "../src/state/smartNoteRuntime";

const note: Pick<Note, "id" | "smart"> = { id: "11111111-1111-4111-8111-111111111111", smart: { version: 1, apiVersion: 1, title: "Synthetic counter", entrypoints: { preview: "preview.js", page: "page.js" }, program: { hash: "a".repeat(64), files: [] } } };
const observers: IntersectionObserverCallback[] = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { observers.push(callback); } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function visible() { act(() => observers.forEach((callback) => callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function harness() {
  let value: JsonValue = { count: 0 };
  let revision = 0;
  const listeners = new Set<(snapshot: SmartNoteStateSnapshot) => void>();
  const apis: SmartNoteApi[] = [];
  const cleanups: ReturnType<typeof vi.fn>[] = [];
  const update = vi.fn(async (reducer: (value: JsonValue) => JsonValue) => { value = reducer(structuredClone(value)); revision++; listeners.forEach((listener) => listener({ value: structuredClone(value), revision: String(revision) })); });
  const factory: SmartNoteScopeFactory = vi.fn((_id, mode, page) => {
    const controller = new AbortController();
    const subscriptions = new Set<(snapshot: SmartNoteStateSnapshot) => void>();
    const api: SmartNoteApi = { version: 1, mode, page, signal: controller.signal, state: {
      get: () => ({ value: structuredClone(value), revision: String(revision) }),
      subscribe: (listener) => { listeners.add(listener); subscriptions.add(listener); return () => listeners.delete(listener); }, update,
      set: async (next) => update(() => next),
    }, assets: { list: () => [], read: vi.fn(), url: vi.fn(), upload: vi.fn(), release: vi.fn() } };
    apis.push(api);
    const dispose = vi.fn(() => { controller.abort(); subscriptions.forEach((listener) => listeners.delete(listener)); });
    cleanups.push(dispose);
    return { api, dispose };
  });
  return { factory, apis, cleanups, update };
}
function counterModule(label: string, cleanupMount = vi.fn()): SmartNoteModule {
  return { mount(root, api) {
    const button = document.createElement("button");
    button.textContent = label;
    const output = document.createElement("output");
    const show = ({ value }: SmartNoteStateSnapshot) => { output.textContent = String((value as { count: number }).count); };
    show(api.state.get());
    const unsubscribe = api.state.subscribe(show);
    const click = () => { void api.state.update((value) => ({ count: (value as { count: number }).count + 1 })).catch(() => undefined); };
    button.addEventListener("click", click); root.append(button, output);
    return () => { unsubscribe(); button.removeEventListener("click", click); cleanupMount(); };
  } };
}
function shadow(container: HTMLElement, mode = "preview") { return container.querySelector(`[data-smart-mount="${mode}"]`)!.shadowRoot!; }

describe("generic smart note host", () => {
  it("renders one title above one lazy isolated preview and supports preview-only modules", async () => {
    const h = harness(); const loader = vi.fn(async () => counterModule("Count"));
    const previewOnly = { ...note, smart: { ...note.smart!, entrypoints: { preview: "small.js" } } };
    const { container } = render(<SmartNote note={previewOnly} createScope={h.factory} loader={loader} />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll('[data-smart-mount="preview"]')).toHaveLength(1);
    expect(container.querySelector("h1")!.compareDocumentPosition(container.querySelector('[data-smart-mount="preview"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Synthetic counter" })).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    visible(); await waitFor(() => expect(shadow(container).querySelector("button")).not.toBeNull());
    expect(loader).toHaveBeenCalledOnce();
    expect(container.querySelector("output")).toBeNull();
    fireEvent.click(shadow(container).querySelector("button")!);
    await waitFor(() => expect(shadow(container).querySelector("output")).toHaveTextContent("1"));
    fireEvent.click(container.querySelector("h1")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("loads page only on open, shares saved state without remount, and disposes representations independently", async () => {
    const h = harness(); const previewCleanup = vi.fn(); const pageCleanup = vi.fn();
    const loader = vi.fn(async (url: string) => url.endsWith("preview.js") ? counterModule("Increment preview", previewCleanup) : counterModule("Increment page", pageCleanup));
    const { container, unmount } = render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    visible(); await waitFor(() => expect(shadow(container).querySelector("button")).not.toBeNull());
    const previewRoot = shadow(container).firstElementChild;
    expect(loader.mock.calls.some(([url]) => url.endsWith("page.js"))).toBe(false);
    fireEvent.click(shadow(container).querySelector("button")!);
    expect(screen.queryByRole("dialog")).toBeNull();
    const title = screen.getByRole("button", { name: "Synthetic counter" }); title.focus(); fireEvent.click(title);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(shadow(dialog, "page").querySelector("button")).not.toBeNull());
    expect(shadow(dialog, "page").querySelector("output")).toHaveTextContent("1");
    fireEvent.click(shadow(dialog, "page").querySelector("button")!);
    await waitFor(() => expect(shadow(container).querySelector("output")).toHaveTextContent("2"));
    expect(shadow(container).firstElementChild).toBe(previewRoot);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть заметку" }));
    expect(pageCleanup).toHaveBeenCalledOnce(); expect(previewCleanup).not.toHaveBeenCalled();
    expect(h.apis[1].signal.aborted).toBe(true); expect(h.apis[0].signal.aborted).toBe(false);
    expect(title).toHaveFocus(); expect(document.body.style.overflow).toBe("");
    fireEvent.click(title); await screen.findByRole("dialog");
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
    unmount(); expect(previewCleanup).toHaveBeenCalledOnce();
  });

  it("does not open on interactive composed paths, opt-out, prevented clicks, selection or pointer dragging", async () => {
    const h = harness();
    const loader: SmartNoteModuleLoader = async () => ({ mount(root) {
      const nested = document.createElement("div"); const inner = nested.attachShadow({ mode: "open" });
      inner.innerHTML = '<button>Control</button><span data-smart-no-open>Ignore</span><span id="prevent">Prevent</span><p>Open</p>';
      inner.querySelector("#prevent")!.addEventListener("click", (event) => event.preventDefault()); root.append(nested);
    } });
    const { container } = render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    visible(); await waitFor(() => expect(shadow(container).querySelector("div div")).not.toBeNull());
    const inner = shadow(container).querySelector("div div")!.shadowRoot!;
    for (const element of [inner.querySelector("button"), inner.querySelector("span"), inner.querySelector("#prevent")]) fireEvent.click(element!, { composed: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    const paragraph = inner.querySelector("p")!;
    const selection = vi.spyOn(document, "getSelection").mockReturnValue({ toString: () => "Selected" } as Selection);
    fireEvent.click(paragraph, { composed: true }); expect(screen.queryByRole("dialog")).toBeNull(); selection.mockRestore();
    fireEvent.pointerDown(paragraph, { clientX: 0, clientY: 0, composed: true });
    fireEvent.pointerMove(paragraph, { clientX: 30, clientY: 0, composed: true });
    // JSDOM has no PointerEvent coordinates; use a real event with those fields.
    const down = new MouseEvent("pointerdown", { bubbles: true, composed: true, clientX: 0 }); paragraph.dispatchEvent(down);
    paragraph.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, composed: true, clientX: 30 }));
    fireEvent.click(paragraph, { composed: true }); expect(screen.queryByRole("dialog")).toBeNull();
    paragraph.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true, clientX: 0 }));
    fireEvent.click(paragraph, { composed: true }); expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("traps focus through nested shadow roots, honors consumed Escape, ignores backdrop, and restores background", async () => {
    const h = harness(); const background = document.createElement("main"); document.body.append(background);
    const loader: SmartNoteModuleLoader = async () => ({ mount(root) {
      const nested = document.createElement("div"); root.append(nested);
      const inner = nested.attachShadow({ mode: "open" }); inner.innerHTML = '<button>First</button><input aria-label="Last">';
      inner.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Escape") event.preventDefault(); });
    } });
    const { container } = render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    const title = screen.getByRole("button", { name: "Synthetic counter" }); title.focus(); fireEvent.click(title);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(shadow(dialog, "page").querySelector("div div")).not.toBeNull());
    expect(background.inert).toBe(true); expect(document.body.style.overflow).toBe("hidden");
    const close = screen.getByRole("button", { name: "Закрыть заметку" });
    const inner = shadow(dialog, "page").querySelector("div div")!.shadowRoot!;
    const first = inner.querySelector("button")!; const last = inner.querySelector("input")!;
    fireEvent.keyDown(close, { key: "Tab" }); expect(inner.activeElement).toBe(first);
    last.focus(); fireEvent.keyDown(last, { key: "Tab", composed: true }); expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true }); expect(inner.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Escape", composed: true, cancelable: true }); expect(dialog).toBeInTheDocument();
    close.focus();
    // Browsers otherwise blur the current control to BODY on an unfocusable backdrop.
    expect(fireEvent(dialog.parentElement!, new MouseEvent("pointerdown", { bubbles: true, cancelable: true }))).toBe(false);
    expect(close).toHaveFocus();
    close.blur();
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.click(dialog.parentElement!); expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(close, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull();
    expect(title).toHaveFocus(); expect(background.inert).toBeFalsy(); expect(container.inert).toBeFalsy(); background.remove();
  });

  it.each(["control", "host", "unknown"])("does not steal focus during a browser transition with %s destination", async (destination) => {
    const h = harness();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const loader: SmartNoteModuleLoader = async () => ({ mount(root) { root.innerHTML = '<textarea aria-label="Synthetic text"></textarea>'; } });
    render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Synthetic counter" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(shadow(dialog, "page").querySelector("textarea")).not.toBeNull());
    const close = screen.getByRole<HTMLButtonElement>("button", { name: "Закрыть заметку" });
    const editor = shadow(dialog, "page").querySelector("textarea")!;
    const target = destination === "unknown" ? null : destination === "host" ? shadow(dialog, "page").host : editor;

    // Replace JSDOM's synchronous blur with the browser event sequence: the
    // old control blurs to BODY, then a microtask runs before the new focus.
    close.addEventListener("focusout", (event) => event.stopPropagation(), { once: true });
    close.blur();
    fireEvent.focusOut(close, { relatedTarget: target });
    await act(async () => { await Promise.resolve(); });
    expect(close).not.toHaveFocus();

    editor.focus();
    act(() => frames.forEach((callback) => callback(0)));
    expect(shadow(dialog, "page").activeElement).toBe(editor);
  });

  it("honors an internal composed focusin target before the active element settles", async () => {
    const h = harness();
    const loader: SmartNoteModuleLoader = async () => ({ mount(root) { root.innerHTML = '<textarea aria-label="Synthetic text"></textarea>'; } });
    render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Synthetic counter" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(shadow(dialog, "page").querySelector("textarea")).not.toBeNull());
    const close = screen.getByRole<HTMLButtonElement>("button", { name: "Закрыть заметку" });
    const editor = shadow(dialog, "page").querySelector("textarea")!;

    close.addEventListener("focusout", (event) => event.stopPropagation(), { once: true });
    close.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.focusIn(editor, { composed: true });
    expect(close).not.toHaveFocus();

    editor.focus();
    expect(shadow(dialog, "page").activeElement).toBe(editor);
  });

  it("aborts closed imports and calls cleanup returned by a late asynchronous mount", async () => {
    const h = harness(); const importing = deferred<SmartNoteModule>(); const mounting = deferred<void | (() => void)>(); const lateCleanup = vi.fn();
    let pageRoot: HTMLElement | undefined;
    const loader: SmartNoteModuleLoader = (url) => url.endsWith("page.js") ? importing.promise : Promise.resolve(counterModule("Preview"));
    const { container } = render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    fireEvent.click(screen.getByRole("button", { name: "Synthetic counter" }));
    await screen.findByRole("dialog"); const mount = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть заметку" }));
    await act(async () => importing.resolve({ mount })); expect(mount).not.toHaveBeenCalled(); expect(h.apis[0].signal.aborted).toBe(true);
    const asyncLoader: SmartNoteModuleLoader = async () => ({ mount(root) { pageRoot = root; return mounting.promise; } });
    cleanup();
    render(<SmartNote note={note} createScope={h.factory} loader={asyncLoader} />);
    fireEvent.click(screen.getByRole("button", { name: "Synthetic counter" })); await waitFor(() => expect(pageRoot).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Закрыть заметку" }));
    await act(async () => { pageRoot!.textContent = "Late content"; mounting.resolve(lateCleanup); });
    expect(lateCleanup).toHaveBeenCalledOnce(); expect(pageRoot!.isConnected).toBe(false); expect(container).not.toHaveTextContent("Late content");
  });

  it("notifies shelf measurements for shadow mutations, image loads and natural-root resize without remount", async () => {
    const h = harness();
    const observed: Array<{ callback: ResizeObserverCallback; target?: Element; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("ResizeObserver", class {
      record: typeof observed[number];
      constructor(callback: ResizeObserverCallback) { this.record = { callback, disconnect: vi.fn() }; observed.push(this.record); }
      observe(target: Element) { this.record.target = target; }
      disconnect() { this.record.disconnect(); }
    });
    const loader = vi.fn(async () => ({ mount(root: HTMLElement) { root.innerHTML = '<p>Small</p><img alt="Synthetic">'; } }));
    const { container, unmount } = render(<SmartNote note={note} createScope={h.factory} loader={loader} />);
    const resized = vi.fn(); container.addEventListener("shelf-content-resize", resized);
    visible(); await waitFor(() => expect(shadow(container).querySelector("img")).not.toBeNull());
    await waitFor(() => expect(resized).toHaveBeenCalled());
    const host = container.querySelector<HTMLElement>('[data-smart-mount="preview"]')!;
    expect(host).toHaveAttribute("data-shelf-shadow-content", "");
    const root = host.shadowRoot!.firstElementChild!;
    expect(observed[0].target).toBe(root);
    let previous = resized.mock.calls.length;
    root.querySelector("p")!.textContent = "Larger content after a state change";
    await waitFor(() => expect(resized.mock.calls.length).toBeGreaterThan(previous));
    previous = resized.mock.calls.length;
    root.querySelector("img")!.dispatchEvent(new Event("load"));
    await waitFor(() => expect(resized.mock.calls.length).toBeGreaterThan(previous));
    previous = resized.mock.calls.length;
    act(() => observed[0].callback([], {} as ResizeObserver));
    await waitFor(() => expect(resized.mock.calls.length).toBeGreaterThan(previous));
    expect(loader).toHaveBeenCalledOnce();
    unmount(); expect(observed[0].disconnect).toHaveBeenCalledOnce();
  });

  it("contains import, missing mount, mount and save failures and refuses conflict execution", async () => {
    const h = harness(); const loader = vi.fn<SmartNoteModuleLoader>().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValueOnce(counterModule("Retry"));
    const { container, rerender } = render(<SmartNote note={note} createScope={h.factory} loader={loader} />); visible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    await waitFor(() => expect(shadow(container).querySelector("button")).not.toBeNull());
    h.update.mockRejectedValueOnce(new Error("Storage is full")); fireEvent.click(shadow(container).querySelector("button")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Изменение не сохранено: Storage is full");
    rerender(<SmartNote note={note} conflict createScope={h.factory} loader={loader} />);
    expect(screen.getByRole("alert")).toHaveTextContent("конфликтуют"); expect(loader).toHaveBeenCalledTimes(2);
    cleanup();
    const noMount = vi.fn(async () => ({} as SmartNoteModule)); render(<SmartNote note={note} createScope={h.factory} loader={noMount} />); visible();
    expect(await screen.findByRole("alert")).toHaveTextContent("не экспортирует mount"); cleanup();
    render(<SmartNote note={note} createScope={h.factory} loader={async () => ({ mount() { throw new Error("Broken program"); } })} />); visible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Broken program");
  });
});
