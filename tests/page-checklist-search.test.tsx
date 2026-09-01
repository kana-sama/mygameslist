import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PageChecklistSearch,
  type ChecklistSearchNavigationTarget,
  type PageChecklistSearchProps,
} from "../src/components/PageChecklistSearch";
import type { ChecklistSearchAnnotation, ChecklistSearchEntry, MarkdownTaskState } from "../src/domain";
import {
  createChecklistSearchHistoryStore,
  type ChecklistSearchHistoryStore,
} from "../src/state/checklistSearchHistory";

const GAME_ID = "game-page";

function annotation(
  id: string,
  kind: "simple" | "rich",
  plainText: string,
  sourceOrder: number,
  extra: Partial<ChecklistSearchAnnotation> = {},
): ChecklistSearchAnnotation {
  const shared = {
    id,
    labelMarkdown: id,
    labelText: id,
    plainText,
    sourceOrder,
    ...extra,
  };
  return kind === "rich"
    ? {
      ...shared,
      bodyMarkdown: "bodyMarkdown" in extra && typeof extra.bodyMarkdown === "string"
        ? extra.bodyMarkdown
        : "Rich body",
      kind,
    }
    : { ...shared, kind };
}

function entry(id: string, text: string, overrides: Partial<ChecklistSearchEntry> = {}): ChecklistSearchEntry {
  return {
    ancestorCollapseIds: [`collapse-${id}`],
    annotations: [],
    id,
    noteClientId: `client-${id}`,
    noteId: `note-${id}`,
    noteOrder: 0,
    path: `Synthetic note › ${id}`,
    sourceColumn: 4,
    sourceLine: 2,
    state: "unchecked",
    structuralGuard: `guard-${id}`,
    structuralItemId: `structural-${id}`,
    text,
    textMarkdown: text,
    ...overrides,
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

function recentHistory(entries: readonly ChecklistSearchEntry[]): ChecklistSearchHistoryStore {
  const history = createChecklistSearchHistoryStore(memoryStorage());
  for (const item of [...entries].reverse()) {
    history.record({
      gameId: GAME_ID,
      itemId: item.id,
      noteId: item.noteId ?? item.noteClientId,
      touchedAt: Date.now(),
    });
  }
  return history;
}

function emptyHistory(): ChecklistSearchHistoryStore {
  return createChecklistSearchHistoryStore(memoryStorage());
}

interface PaletteHarness {
  getEntries: ReturnType<typeof vi.fn<() => readonly ChecklistSearchEntry[]>>;
  onNavigate: ReturnType<typeof vi.fn<(target: ChecklistSearchNavigationTarget) => void>>;
  onToggle: ReturnType<typeof vi.fn<(entry: ChecklistSearchEntry, state: MarkdownTaskState) => Promise<void>>>;
  opener: HTMLButtonElement;
  rerender: (props: PageChecklistSearchProps) => void;
}

function renderPalette(options: {
  blocked?: boolean;
  entries?: readonly ChecklistSearchEntry[];
  getEntries?: () => readonly ChecklistSearchEntry[];
  history?: ChecklistSearchHistoryStore;
  onNavigate?: (target: ChecklistSearchNavigationTarget) => void;
  onToggle?: (entry: ChecklistSearchEntry, state: MarkdownTaskState) => Promise<void>;
} = {}): PaletteHarness {
  const entries = options.entries ?? [];
  const getEntries = vi.fn(options.getEntries ?? (() => entries));
  const onNavigate = vi.fn(options.onNavigate ?? (() => undefined));
  const onToggle = vi.fn(options.onToggle ?? (async () => undefined));
  const history = options.history ?? emptyHistory();
  const props: PageChecklistSearchProps = {
    blocked: options.blocked ?? false,
    gameId: GAME_ID,
    getEntries,
    history,
    onNavigate,
    onToggle,
  };
  const view = render(
    <>
      <button type="button">Opener</button>
      <PageChecklistSearch {...props} />
    </>,
  );
  const opener = screen.getByRole("button", { name: "Opener" });
  opener.focus();
  return {
    getEntries,
    onNavigate,
    onToggle,
    opener,
    rerender: (nextProps) => view.rerender(
      <>
        <button type="button">Opener</button>
        <PageChecklistSearch {...nextProps} />
      </>,
    ),
  };
}

function shiftCycle(init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(document, { key: "Shift", ...init });
  fireEvent.keyUp(document, { key: "Shift", ...init });
}

function openPalette(): HTMLInputElement {
  shiftCycle();
  shiftCycle();
  return screen.getByRole("combobox", { name: "Поиск по чеклистам" });
}

function resultRows(): HTMLElement[] {
  return screen.queryAllByRole("row");
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PageChecklistSearch shortcut and dismissal", () => {
  it("opens only after two complete Shift cycles inside the 400ms window", () => {
    vi.useFakeTimers();
    renderPalette();

    shiftCycle();
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    vi.advanceTimersByTime(399);
    fireEvent.keyDown(document, { key: "Shift" });
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    fireEvent.keyUp(document, { key: "Shift" });

    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("accepts a second complete Shift cycle exactly at the inclusive 400ms boundary", () => {
    vi.useFakeTimers();
    renderPalette();

    shiftCycle();
    vi.advanceTimersByTime(400);
    shiftCycle();

    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("expires, cancels on another key, and rejects repeat, IME, and modifier-contaminated cycles", () => {
    vi.useFakeTimers();
    renderPalette();

    shiftCycle();
    vi.advanceTimersByTime(401);
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyUp(document, { key: "a" });
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    shiftCycle({ repeat: true });
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    shiftCycle({ isComposing: true });
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    shiftCycle({ metaKey: true });
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    shiftCycle();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("does not accumulate shortcut progress while blocked", () => {
    const item = entry("recent", "Recent task");
    const history = recentHistory([item]);
    const harness = renderPalette({ blocked: true, entries: [item], history });
    const blockedProps: PageChecklistSearchProps = {
      blocked: true,
      gameId: GAME_ID,
      getEntries: harness.getEntries,
      history,
      onNavigate: harness.onNavigate,
      onToggle: harness.onToggle,
    };

    shiftCycle();
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    harness.rerender({ ...blockedProps, blocked: false });
    shiftCycle();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    shiftCycle();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("closes with Escape or a true outside click, traps focus, and restores the opener", () => {
    const item = entry("recent", "Recent task");
    const harness = renderPalette({ entries: [item], history: recentHistory([item]) });
    const input = openPalette();
    const checkbox = screen.getByRole("checkbox", { name: "Отметить: Recent task" });

    expect(input).toHaveFocus();
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: "Tab" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(checkbox).toHaveFocus();

    fireEvent.keyDown(checkbox, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(harness.opener).toHaveFocus();

    openPalette();
    const dialog = screen.getByRole("dialog", { name: "Поиск по чеклистам" });
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(harness.opener).toHaveFocus();
  });
});

describe("PageChecklistSearch keyboard modes", () => {
  it("projects valid empty-query recents and routes input arrows without turning Space into an action", () => {
    const first = entry("first", "Alpha task");
    const second = entry("second", "Beta task");
    const history = recentHistory([second, first]);
    history.record({ gameId: GAME_ID, itemId: "stale", noteId: "stale-note", touchedAt: Date.now() + 1 });
    const harness = renderPalette({ entries: [first, second], history });
    const input = openPalette();

    expect(resultRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Beta task"),
      expect.stringContaining("Alpha task"),
    ]);
    expect(input).toHaveAttribute("aria-activedescendant", resultRows()[0].id);
    expect(input).toHaveAttribute("aria-haspopup", "grid");

    fireEvent.change(input, { target: { value: "two words" } });
    fireEvent.change(input, { target: { value: "two words " } });
    expect(input).toHaveValue("two words ");
    expect(harness.onToggle).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "task" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(resultRows()[0]).toHaveFocus();
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(resultRows().at(-1)).toHaveFocus();
  });

  it("moves result focus without bottom wrap and returns first-row Up to input", () => {
    const entries = [entry("one", "Task one"), entry("two", "Task two")];
    renderPalette({ entries });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "task" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const [first, second] = resultRows();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(input).toHaveFocus();
  });

  it("edits the query from result mode, returns focus to input, and visually selects replacements", () => {
    const apple = entry("apple", "Apple objective");
    const zebra = entry("zebra", "Zebra objective");
    renderPalette({ entries: [apple, zebra], history: recentHistory([apple]) });
    const input = openPalette();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const appleRow = resultRows()[0];

    fireEvent.keyDown(appleRow, { key: "z" });
    expect(input).toHaveValue("z");
    expect(resultRows()).toHaveLength(1);
    expect(resultRows()[0]).toHaveTextContent("Zebra objective");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-activedescendant", resultRows()[0].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(resultRows()[0], { key: "Backspace" });
    expect(input).toHaveValue("");
    expect(resultRows()[0]).toHaveTextContent("Apple objective");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-activedescendant", resultRows()[0].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(resultRows()[0], { key: "q" });
    expect(input).toHaveValue("q");
    expect(resultRows()).toHaveLength(0);
    expect(input).toHaveFocus();
  });

  it("uses row Space for regular state, Shift+Space for partial state, and Enter for navigation", async () => {
    let authoritative = [entry("route", "Route task")];
    const onToggle = vi.fn(async (target: ChecklistSearchEntry, state: MarkdownTaskState) => {
      authoritative = authoritative.map((item) => item.id === target.id ? { ...item, state } : item);
    });
    const harness = renderPalette({ getEntries: () => authoritative, onToggle });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "route" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.keyDown(resultRows()[0], { key: " " });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Снять отметку: Route task" })).toBeChecked());
    expect(onToggle).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "route" }), "checked");

    fireEvent.keyDown(resultRows()[0], { key: " ", shiftKey: true });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Частично отмечено: Route task" })).toBePartiallyChecked());
    expect(onToggle).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "route" }), "indeterminate");

    fireEvent.keyDown(resultRows()[0], { key: "Enter" });
    expect(harness.onNavigate).toHaveBeenCalledWith({
      ancestorCollapseIds: ["collapse-route"],
      id: "route",
      noteClientId: "client-route",
      noteId: "note-route",
      sourceColumn: 4,
      sourceLine: 2,
      structuralGuard: "guard-route",
      structuralItemId: "structural-route",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps result mode and transfers row focus when an authoritative refresh replaces the selected identity", async () => {
    const first = entry("first-refresh", "Refresh task one");
    const second = entry("second-refresh", "Refresh task two", { sourceLine: 3 });
    let authoritative = [first, second];
    let resolveSave: (() => void) | undefined;
    const save = new Promise<void>((resolve) => { resolveSave = resolve; });
    renderPalette({ getEntries: () => authoritative, onToggle: () => save });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "refresh task" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(resultRows()[0]).toHaveFocus();

    fireEvent.keyDown(resultRows()[0], { key: " " });
    authoritative = [second];
    resolveSave?.();

    await waitFor(() => expect(resultRows()).toHaveLength(1));
    expect(resultRows()[0]).toHaveTextContent("Refresh task two");
    await waitFor(() => expect(resultRows()[0]).toHaveFocus());
  });

  it("transfers result-mode focus on hover so Space and Enter act on the hovered row", async () => {
    let authoritative = [
      entry("hover-a", "Hover task A"),
      entry("hover-b", "Hover task B", { sourceLine: 3 }),
    ];
    const onToggle = vi.fn(async (target: ChecklistSearchEntry, state: MarkdownTaskState) => {
      authoritative = authoritative.map((item) => item.id === target.id ? { ...item, state } : item);
    });
    const harness = renderPalette({ getEntries: () => authoritative, onToggle });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "hover task" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const [firstRow, secondRow] = resultRows();
    expect(firstRow).toHaveFocus();

    fireEvent.mouseEnter(secondRow);
    expect(secondRow).toHaveFocus();
    expect(secondRow).toHaveAttribute("tabindex", "0");
    expect(firstRow).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(document.activeElement!, { key: " " });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Снять отметку: Hover task B" })).toBeChecked());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: "hover-b" }), "checked");

    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(harness.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "hover-b" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("PageChecklistSearch preview and actions", () => {
  it("keeps rows to checkbox, item text, and path while rendering annotations in source order", () => {
    const mixed = entry("mixed", "Inspect objective", {
      annotations: [
        annotation("Simple label", "simple", "**plain** [Guide](https://example.test)", 0),
        annotation("Rich label", "rich", "Northern vault", 1, {
          bodyMarkdown: "Rendered **body** and [Guide](https://example.test).\n\nRegion\n: **North Wing**",
        }),
      ],
    });
    renderPalette({ entries: [mixed] });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "inspect" } });

    expect(document.querySelectorAll(".page-checklist-search-layer")).toHaveLength(1);
    expect(document.querySelectorAll(".page-checklist-search")).toHaveLength(1);
    const body = document.querySelector<HTMLElement>(".page-checklist-search__body")!;
    expect(body.children).toHaveLength(2);
    expect(body.children[0]).toHaveClass("page-checklist-search__results");
    expect(body.children[1]).toHaveClass("page-checklist-search__preview");

    const row = resultRows()[0];
    expect(within(row).getAllByRole("checkbox")).toHaveLength(1);
    expect(row.querySelectorAll(".page-checklist-search__item-text")).toHaveLength(1);
    expect(row.querySelectorAll(".page-checklist-search__path")).toHaveLength(1);
    expect(row).not.toHaveTextContent(/count|match|score/i);
    expect(within(screen.getByRole("grid")).queryByRole("heading")).not.toBeInTheDocument();

    const preview = document.querySelector<HTMLElement>(".page-checklist-search__preview")!;
    const headings = within(preview).getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual(["Simple label", "Rich label"]);
    const plain = within(preview).getByText("**plain** [Guide](https://example.test)");
    expect(plain.querySelector("strong, a")).toBeNull();
    expect(within(preview).getByText("body").tagName).toBe("STRONG");
    expect(within(preview).getByText("Region").closest("dt")).toBeInTheDocument();
    expect(within(preview).getByText("North Wing").closest("dd")).toBeInTheDocument();
    expect(preview).not.toHaveAttribute("inert");
    expect(preview).toHaveTextContent("Guide");
    expect(preview.querySelector("a")).toBeNull();
  });

  it("renders rich preview content accessibly without nested tooltip, link, spoiler, or control interactions", () => {
    const rich = entry("noninteractive", "Inspect interactions", {
      annotations: [annotation("Interaction details", "rich", "Nested interaction content", 0, {
        bodyMarkdown: [
          "Nested [hint](\"native description\"), [**Guide**](https://example.test), and ||secret||.",
          "",
          "- [ ] Nested control",
        ].join("\n"),
      })],
    });
    renderPalette({ entries: [rich] });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "interactions" } });
    const preview = document.querySelector<HTMLElement>(".page-checklist-search__preview")!;

    const hint = within(preview).getByText("hint");
    expect(hint).toHaveClass("markdown-hover-hint");
    expect(hint).not.toHaveAttribute("title");
    expect(within(preview).getByText("Guide").closest("a")).toBeNull();
    expect(within(preview).getByText("secret").closest(".markdown-spoiler")).not.toHaveAttribute("role");
    expect(within(preview).getByRole("checkbox", { name: /Nested control/ })).toBeDisabled();
    expect(preview.querySelector('a[href], [role="button"], button:not([disabled]), input:not([disabled])')).toBeNull();
    expect(preview).toHaveTextContent("Nested hint, Guide, and secret.");
  });

  it("promotes matched annotations, leaves an annotation-free preview empty, and follows hover without blurring input", () => {
    const mixed = entry("mixed", "Inspect relic", {
      annotations: [
        annotation("First simple", "simple", "Southern vault", 0),
        annotation("Matched rich", "rich", "Northern vault", 1, { bodyMarkdown: "North body" }),
        annotation("Last simple", "simple", "Eastern vault", 2),
      ],
    });
    const empty = entry("empty", "Vacant objective");
    renderPalette({ entries: [mixed, empty] });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "northern" } });
    const preview = document.querySelector<HTMLElement>(".page-checklist-search__preview")!;

    expect(within(preview).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Matched rich",
      "First simple",
      "Last simple",
    ]);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "objective" } });
    fireEvent.mouseEnter(resultRows().find((row) => row.textContent?.includes("Vacant objective"))!);
    expect(input).toHaveFocus();
    expect(preview).toBeEmptyDOMElement();
  });

  it("navigates on row-body click but checkbox clicks stay open and honor regular, Shift, and Command transitions", async () => {
    let authoritative = [entry("mouse", "Mouse task")];
    const onToggle = vi.fn(async (target: ChecklistSearchEntry, state: MarkdownTaskState) => {
      authoritative = authoritative.map((item) => item.id === target.id ? { ...item, state } : item);
    });
    const first = renderPalette({ getEntries: () => authoritative, onToggle });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "mouse" } });
    const checkbox = screen.getByRole("checkbox", { name: "Отметить: Mouse task" });

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(checkbox, { shiftKey: true });
    await waitFor(() => expect(checkbox).toBePartiallyChecked());
    fireEvent.click(checkbox, { metaKey: true });
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(onToggle.mock.calls.map((call) => call[1])).toEqual(["checked", "indeterminate", "unchecked"]);
    expect(first.onNavigate).not.toHaveBeenCalled();

    fireEvent.click(resultRows()[0].querySelector(".page-checklist-search__item-text")!);
    expect(first.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: "mouse" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("updates one item optimistically, guards the pending note, refreshes authority, and records history only after success", async () => {
    const first = entry("first", "Pending task one", { noteClientId: "shared-note", noteId: "shared-note-id" });
    const second = entry("second", "Pending task two", { noteClientId: "shared-note", noteId: "shared-note-id", sourceLine: 3 });
    let authoritative = [first, second];
    let resolveSave: (() => void) | undefined;
    const save = new Promise<void>((resolve) => { resolveSave = resolve; });
    const history = emptyHistory();
    const onToggle = vi.fn(() => save);
    const harness = renderPalette({ getEntries: () => authoritative, history, onToggle });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "pending task" } });
    const [firstCheckbox, secondCheckbox] = screen.getAllByRole("checkbox");

    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).toBeChecked();
    expect(secondCheckbox).not.toBeChecked();
    fireEvent.click(secondCheckbox);
    expect(secondCheckbox).not.toBeChecked();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(history.list(GAME_ID, new Set([first.id, second.id]))).toEqual([]);

    authoritative = [{ ...first, state: "checked" }, second];
    resolveSave?.();
    await waitFor(() => expect(harness.getEntries).toHaveBeenCalledTimes(2));
    expect(firstCheckbox).toBeChecked();
    expect(history.list(GAME_ID, new Set([first.id, second.id]))).toEqual([
      expect.objectContaining({ gameId: GAME_ID, itemId: first.id, noteId: "shared-note-id" }),
    ]);

    fireEvent.change(input, { target: { value: "" } });
    expect(resultRows()).toHaveLength(1);
    expect(resultRows()[0]).toHaveTextContent("Pending task one");
  });

  it("rolls back a failed save, announces one footer error, and clears it after a later success", async () => {
    const task = entry("failure", "Failure task");
    let authoritative = [task];
    const history = emptyHistory();
    const onToggle = vi.fn<(_entry: ChecklistSearchEntry, state: MarkdownTaskState) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockImplementationOnce(async (_target, state) => {
        authoritative = [{ ...task, state }];
      });
    renderPalette({ getEntries: () => authoritative, history, onToggle });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "failure" } });
    const checkbox = screen.getByRole("checkbox", { name: "Отметить: Failure task" });

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("disk unavailable");
    expect(history.list(GAME_ID, new Set([task.id]))).toEqual([]);

    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(history.list(GAME_ID, new Set([task.id]))).toEqual([
      expect.objectContaining({ itemId: task.id }),
    ]);
  });

  it.each([
    { reason: new Error(""), label: "empty Error.message" },
    { reason: { failure: "unknown" }, label: "an unknown rejection" },
  ])("uses the generic save fallback for $label", async ({ reason }) => {
    const task = entry("fallback", "Fallback task");
    renderPalette({ entries: [task], onToggle: () => Promise.reject(reason) });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "fallback" } });

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Fallback task" }));

    expect(await screen.findByText("Не удалось сохранить", { selector: ".page-checklist-search__error" })).toHaveAttribute("role", "status");
  });

  it("keeps a long Russian save error in the existing single-line footer without changing palette structure", async () => {
    const message = "Не удалось сохранить изменение заметки: удалённое хранилище временно недоступно, повторите попытку позднее";
    const task = entry("long-error", "Long error task");
    renderPalette({ entries: [task], onToggle: () => Promise.reject(new Error(message)) });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "long error" } });
    const palette = document.querySelector<HTMLElement>(".page-checklist-search")!;
    const body = document.querySelector<HTMLElement>(".page-checklist-search__body")!;
    const footer = document.querySelector<HTMLElement>(".page-checklist-search__footer")!;

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Long error task" }));

    const status = await screen.findByText(message, { selector: ".page-checklist-search__error" });
    expect(document.querySelector(".page-checklist-search")).toBe(palette);
    expect(document.querySelector(".page-checklist-search__body")).toBe(body);
    expect(palette.children).toHaveLength(3);
    expect(status.parentElement).toBe(footer);
    expect(footer.children).toHaveLength(5);
  });

  it("rereads authoritative entries on rejection while preserving a surviving result selection and focus", async () => {
    const task = entry("rollback-refresh", "Rollback original task");
    let authoritative = [task];
    let rejectSave: ((reason: Error) => void) | undefined;
    const save = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    const harness = renderPalette({ getEntries: () => authoritative, onToggle: () => save });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "rollback" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(resultRows()[0]).toHaveFocus();

    fireEvent.click(within(resultRows()[0]).getByRole("checkbox"));
    authoritative = [entry("rollback-refresh", "Rollback refreshed task", {
      state: "indeterminate",
      textMarkdown: "Rollback refreshed task",
    })];
    rejectSave?.(new Error("authoritative conflict"));

    await waitFor(() => expect(harness.getEntries).toHaveBeenCalledTimes(2));
    expect(resultRows()).toHaveLength(1);
    expect(resultRows()[0]).toHaveTextContent("Rollback refreshed task");
    expect(resultRows()[0]).toHaveAttribute("aria-selected", "true");
    expect(resultRows()[0]).toHaveFocus();
    expect(screen.getByRole("checkbox", { name: "Частично отмечено: Rollback refreshed task" })).toBePartiallyChecked();
  });

  it("removes a selected stale row and returns focus to the query when authority deletes it during a failed save", async () => {
    const task = entry("rollback-removed", "Rollback removed task");
    let authoritative: ChecklistSearchEntry[] = [task];
    let rejectSave: ((reason: Error) => void) | undefined;
    const save = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    renderPalette({ getEntries: () => authoritative, onToggle: () => save });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "rollback" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.click(within(resultRows()[0]).getByRole("checkbox"));
    authoritative = [];
    rejectSave?.(new Error("authoritative deletion"));

    await waitFor(() => expect(resultRows()).toHaveLength(0));
    expect(input).toHaveFocus();
  });
});
