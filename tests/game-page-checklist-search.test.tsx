import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChecklistSearchIndex, type Game, type InteractiveNoteFieldUpdate, type Note } from "../src/domain";
import { GamePage, type NoteInteractionSnapshot, type NoteInteractionSource } from "../src/pages/GamePage";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const LIST_NOTE_ID = "22222222-2222-4222-8222-222222222222";
const FILTERED_NOTE_ID = "33333333-3333-4333-8333-333333333333";
const COLLAPSED_NOTE_ID = "44444444-4444-4444-8444-444444444444";
const TABLE_NOTE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-09-01T10:00:00.000Z";

const game: Game = {
  id: GAME_ID,
  title: "Controlled checklist fixture",
  coverAssetId: null,
  platforms: ["Test"],
  tags: [],
  status: "playing",
  placement: { tierId: "a", rank: 1024 },
  reviewMarkdown: "",
  progressItems: [],
  createdAt: NOW,
  updatedAt: NOW,
};

function note(id: string, bodyMarkdown: string, rank: number, collapsedChecklistSections?: readonly string[]): Note {
  return {
    id,
    gameId: GAME_ID,
    bodyMarkdown,
    attachments: [],
    ...(collapsedChecklistSections ? { collapsedChecklistSections: [...collapsedChecklistSections] } : {}),
    rank,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const authoritativeListMarkdown = "# Visible note\n- [ ] Authoritative list target";
const filteredMarkdown = [
  "# Filtered note",
  "- Parent group",
  "  - [x] Completed hidden nested target",
].join("\n");
const collapsedMarkdown = [
  "# Collapsed note",
  "## Hidden stage",
  "- [ ] Collapsed heading target",
  "## Visible stage",
  "- Folded group",
  "  - [ ] Collapsed group target",
].join("\n");
const tableMarkdown = [
  "# Table note",
  "| Stage | Complete |",
  "| --- | --- |",
  "| Synthetic row | [ ] Table navigation target |",
].join("\n");
const collapsedEntry = buildChecklistSearchIndex([{ bodyMarkdown: collapsedMarkdown, clientId: COLLAPSED_NOTE_ID, id: COLLAPSED_NOTE_ID }])
  .find((entry) => entry.text === "Collapsed heading target")!;
const collapsedStageId = collapsedEntry.ancestorCollapseIds.at(-1)!;
const collapsedGroupEntry = buildChecklistSearchIndex([{ bodyMarkdown: collapsedMarkdown, clientId: COLLAPSED_NOTE_ID, id: COLLAPSED_NOTE_ID }])
  .find((entry) => entry.text === "Collapsed group target")!;
const collapsedGroupId = collapsedGroupEntry.ancestorCollapseIds.at(-1)!;

const fixtureNotes = [
  note(LIST_NOTE_ID, "# Visible note\n- [ ] Stale prop target", 1024),
  note(FILTERED_NOTE_ID, filteredMarkdown, 2048),
  note(COLLAPSED_NOTE_ID, collapsedMarkdown, 3072, [collapsedStageId, collapsedGroupId]),
  note(TABLE_NOTE_ID, tableMarkdown, 4096),
];

interface SourceHarness {
  onSave: ReturnType<typeof vi.fn>;
  readNoteInteractionSnapshot: ReturnType<typeof vi.fn<(noteId: string) => NoteInteractionSnapshot | undefined>>;
  saveNoteInteraction: ReturnType<typeof vi.fn<(update: InteractiveNoteFieldUpdate) => Promise<void>>>;
  replaceSnapshotWithoutRender: (noteId: string, snapshot: NoteInteractionSnapshot) => void;
  failNextSave: (reason: Error) => void;
  deferNextSave: (onStart?: () => void) => { resolve: () => void };
  removeNote: (noteId: string) => void;
}

function renderGamePage(options: { checklistSearchBlocked?: boolean; completedFilter?: boolean } = {}): SourceHarness {
  const snapshots = new Map<string, NoteInteractionSnapshot>([
    [LIST_NOTE_ID, { bodyMarkdown: authoritativeListMarkdown }],
    [FILTERED_NOTE_ID, { bodyMarkdown: filteredMarkdown }],
    [COLLAPSED_NOTE_ID, { bodyMarkdown: collapsedMarkdown, collapsedChecklistSections: [collapsedStageId, collapsedGroupId] }],
    [TABLE_NOTE_ID, { bodyMarkdown: tableMarkdown }],
  ]);
  let forceRender: (() => void) | null = null;
  let currentNotes = fixtureNotes;
  let nextFailure: Error | null = null;
  let nextSaveGate: { onStart?: () => void; promise: Promise<void>; resolve: () => void } | null = null;
  const onSave = vi.fn();
  const readNoteInteractionSnapshot = vi.fn((noteId: string) => snapshots.get(noteId));
  const saveNoteInteraction = vi.fn(async (update: InteractiveNoteFieldUpdate) => {
    const saveGate = nextSaveGate;
    nextSaveGate = null;
    if (saveGate) {
      saveGate.onStart?.();
      await saveGate.promise;
    }
    if (nextFailure) {
      const failure = nextFailure;
      nextFailure = null;
      throw failure;
    }
    const current = snapshots.get(update.noteId);
    if (!current) throw new Error("Не удалось найти заметку");
    snapshots.set(update.noteId, update.field === "bodyMarkdown"
      ? { ...current, bodyMarkdown: update.value }
      : { ...current, collapsedChecklistSections: update.value });
    forceRender?.();
  });

  function Harness() {
    const [, setRevision] = useState(0);
    forceRender = () => setRevision((revision) => revision + 1);
    const noteInteractionSource: NoteInteractionSource = {
      useNoteInteractionSnapshot: (noteId) => snapshots.get(noteId),
      readNoteInteractionSnapshot,
      saveNoteInteraction,
    };
    return <GamePage assets={{}} checklistSearchBlocked={options.checklistSearchBlocked} completedChecklistFilterEnabled={options.completedFilter} game={game} mode="game" noteInteractionSource={noteInteractionSource} notes={currentNotes} onSave={onSave} />;
  }

  render(<Harness />);
  return {
    onSave,
    readNoteInteractionSnapshot,
    saveNoteInteraction,
    replaceSnapshotWithoutRender: (noteId, snapshot) => { snapshots.set(noteId, snapshot); },
    failNextSave: (reason) => { nextFailure = reason; },
    deferNextSave: (onStart) => {
      let resolve = () => {};
      const promise = new Promise<void>((settle) => { resolve = settle; });
      nextSaveGate = { onStart, promise, resolve };
      return { resolve };
    },
    removeNote: (noteId) => {
      currentNotes = currentNotes.filter((currentNote) => currentNote.id !== noteId);
      forceRender?.();
    },
  };
}

function shiftCycle(): void {
  fireEvent.keyDown(document, { key: "Shift" });
  fireEvent.keyUp(document, { key: "Shift" });
}

function openPalette(): HTMLInputElement {
  shiftCycle();
  shiftCycle();
  return screen.getByRole("combobox", { name: "Поиск по чеклистам" });
}

function queryPalette(value: string): HTMLElement {
  fireEvent.change(openPalette(), { target: { value } });
  return within(screen.getByRole("grid", { name: "Результаты поиска" })).getByRole("row");
}

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery(false)));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GamePage checklist search integration", () => {
  it("indexes current authoritative snapshots on demand, saves body Markdown through note interactions, and never invokes full save", async () => {
    const source = renderGamePage({ completedFilter: true });
    const row = queryPalette("authoritative list target");

    expect(row).toHaveTextContent("Authoritative list target");
    expect(row).not.toHaveTextContent("Stale prop target");
    expect(source.readNoteInteractionSnapshot.mock.calls.slice(0, 4).map(([noteId]) => noteId)).toEqual([
      LIST_NOTE_ID,
      FILTERED_NOTE_ID,
      COLLAPSED_NOTE_ID,
      TABLE_NOTE_ID,
    ]);
    expect(source.readNoteInteractionSnapshot).toHaveBeenCalledWith(LIST_NOTE_ID);
    fireEvent.click(within(row).getByRole("checkbox"));

    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: LIST_NOTE_ID,
      field: "bodyMarkdown",
      value: "# Visible note\n- [x] Authoritative list target",
    }));
    expect(source.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
    expect(within(screen.getByRole("grid", { name: "Результаты поиска" })).getByRole("checkbox")).toBeChecked();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    openPalette();
    expect(within(screen.getByRole("grid", { name: "Результаты поиска" })).getByRole("row")).toHaveTextContent("Authoritative list target");
  });

  it("rolls back a failed authoritative save without using the full game save path", async () => {
    const source = renderGamePage();
    source.failNextSave(new Error("Не удалось сохранить изменение заметки"));
    const row = queryPalette("table navigation target");
    const checkbox = within(row).getByRole("checkbox");

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: TABLE_NOTE_ID,
      field: "bodyMarkdown",
      value: tableMarkdown.replace("[ ] Table navigation target", "[x] Table navigation target"),
    });
    expect(within(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).getByRole("status")).toHaveTextContent("Не удалось сохранить");
    expect(source.onSave).not.toHaveBeenCalled();
  });

  it("blocks opening during a connected-note interaction save and opens after it settles", async () => {
    const source = renderGamePage();
    const pendingSave = source.deferNextSave(() => {
      shiftCycle();
      shiftCycle();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Authoritative list target" }));
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: LIST_NOTE_ID,
      field: "bodyMarkdown",
      value: "# Visible note\n- [x] Authoritative list target",
    });

    await act(async () => {
      pendingSave.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Снять отметку: Authoritative list target" })).toBeChecked());

    openPalette();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("retains palette save ownership after dismissal and blocks reopen and direct note changes until settlement", async () => {
    const source = renderGamePage();
    const pendingSave = source.deferNextSave();
    const row = queryPalette("authoritative list target");

    fireEvent.click(within(row).getByRole("checkbox"));
    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Поиск по чеклистам" }), { key: "Escape" });

    shiftCycle();
    shiftCycle();
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Authoritative list target" }));
    await act(async () => { await Promise.resolve(); });
    expect(source.saveNoteInteraction).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSave.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Снять отметку: Authoritative list target" })).toBeChecked());

    openPalette();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("clears a connected-note pending blocker when its card unmounts", async () => {
    const source = renderGamePage();
    const pendingSave = source.deferNextSave();
    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Authoritative list target" }));
    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalled());

    act(() => { source.removeNote(LIST_NOTE_ID); });
    openPalette();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();

    await act(async () => {
      pendingSave.resolve();
      await Promise.resolve();
    });
  });

  it.each([
    {
      intent: "regular",
      click: {},
      freshMarkdown: "# Visible note\n- [x] Authoritative list target",
    },
    {
      intent: "partial",
      click: { shiftKey: true },
      freshMarkdown: "# Visible note\n- [-] Authoritative list target",
    },
  ])("applies a $intent palette intent to the fresh authoritative marker", async ({ click, freshMarkdown }) => {
    const source = renderGamePage();
    const row = queryPalette("authoritative list target");
    source.replaceSnapshotWithoutRender(LIST_NOTE_ID, { bodyMarkdown: freshMarkdown });

    fireEvent.click(within(row).getByRole("checkbox"), click);

    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: LIST_NOTE_ID,
      field: "bodyMarkdown",
      value: "# Visible note\n- [ ] Authoritative list target",
    }));
  });

  it("keeps a table target valid when only its authoritative task marker changes", async () => {
    const source = renderGamePage();
    const row = queryPalette("table navigation target");
    source.replaceSnapshotWithoutRender(TABLE_NOTE_ID, {
      bodyMarkdown: tableMarkdown.replace("[ ] Table navigation target", "[x] Table navigation target"),
    });

    fireEvent.click(within(row).getByRole("checkbox"));

    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: TABLE_NOTE_ID,
      field: "bodyMarkdown",
      value: tableMarkdown,
    }));
  });

  it.each([
    {
      kind: "list",
      noteId: LIST_NOTE_ID,
      query: "authoritative list target",
      replacement: "# Visible note\n- [ ] Same-coordinate list replacement",
    },
    {
      kind: "table",
      noteId: TABLE_NOTE_ID,
      query: "table navigation target",
      replacement: tableMarkdown.replace("Table navigation target", "Same-coordinate table replacement"),
    },
  ])("rejects a same-coordinate $kind replacement before a palette mutation", async ({ noteId, query, replacement }) => {
    const source = renderGamePage();
    const row = queryPalette(query);
    source.replaceSnapshotWithoutRender(noteId, { bodyMarkdown: replacement });

    fireEvent.click(within(row).getByRole("checkbox"));

    await waitFor(() => expect(document.querySelector(".page-checklist-search__error")).toBeInTheDocument());
    expect(source.saveNoteInteraction).not.toHaveBeenCalled();
  });

  it("blocks opening while a note editor, inline page setting, or progress dialog is active", () => {
    renderGamePage();

    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать заметку" })[0]);
    shiftCycle();
    shiftCycle();
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить редактирование" }));

    fireEvent.click(screen.getByRole("button", { name: "Controlled checklist fixture" }));
    shiftCycle();
    shiftCycle();
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Название" }), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Добавить элемент прогресса" }));
    expect(screen.getByRole("dialog", { name: "Элемент прогресса" })).toBeInTheDocument();
    shiftCycle();
    shiftCycle();
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
  });

  it("blocks opening while an app-level settings or diff modal owns the page", () => {
    renderGamePage({ checklistSearchBlocked: true });

    shiftCycle();
    shiftCycle();

    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
  });

  it("blocks opening while focus is owned by another semantic modal tool", () => {
    renderGamePage();
    const modal = document.createElement("section");
    const modalButton = document.createElement("button");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("role", "dialog");
    modal.append(modalButton);
    document.body.append(modal);
    modalButton.focus();

    try {
      shiftCycle();
      shiftCycle();
      expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });
});

describe("GamePage checklist search navigation", () => {
  it("reveals a completed nested target, focuses and centers its exact row, then clears highlight", async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    renderGamePage({ completedFilter: true });
    expect(screen.queryByRole("checkbox", { name: "Снять отметку: Completed hidden nested target" })).not.toBeInTheDocument();
    const row = queryPalette("completed hidden nested target");

    fireEvent.click(within(row).getByText("Completed hidden nested target"));
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    for (let turn = 0; turn < 10 && !scrollIntoView.mock.calls.length; turn += 1) {
      await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
    }

    const checkbox = screen.getByRole("checkbox", { name: "Снять отметку: Completed hidden nested target" });
    const target = checkbox.closest<HTMLElement>(".markdown-task-row")!;
    expect(checkbox).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(target).toHaveClass("markdown-checklist-search-target--highlighted");

    act(() => { vi.advanceTimersByTime(1599); });
    expect(target).toHaveClass("markdown-checklist-search-target--highlighted");
    act(() => { vi.advanceTimersByTime(1); });
    expect(target).not.toHaveClass("markdown-checklist-search-target--highlighted");
  });

  it("persists collapsed-heading reveal before focusing the requested target", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const source = renderGamePage();
    expect(screen.queryByRole("checkbox", { name: "Отметить: Collapsed heading target" })).not.toBeInTheDocument();
    const row = queryPalette("collapsed heading target");

    fireEvent.keyDown(row, { key: "Enter" });

    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: COLLAPSED_NOTE_ID,
      field: "collapsedChecklistSections",
      value: [collapsedGroupId],
    }));
    const checkbox = await screen.findByRole("checkbox", { name: "Отметить: Collapsed heading target" });
    await waitFor(() => expect(checkbox).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("aborts reveal and focus when collapsed-ancestor persistence fails", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const source = renderGamePage();
    source.failNextSave(new Error("Не удалось сохранить изменение заметки"));
    const exactTarget = document.querySelector<HTMLElement>(`[data-checklist-search-target-id="${collapsedGroupEntry.id}"]`)!;
    const exactCheckbox = exactTarget.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const row = queryPalette("collapsed group target");

    fireEvent.keyDown(row, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить изменение заметки");
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)); });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(exactCheckbox).not.toHaveFocus();

    openPalette();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("navigates to the exact table target repeatedly with a counter-based request", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    renderGamePage();

    fireEvent.click(within(queryPalette("table navigation target")).getByText("Table navigation target"));
    const checkbox = await screen.findByRole("checkbox", { name: "Отметить: Table navigation target" });
    await waitFor(() => expect(checkbox).toHaveFocus());
    fireEvent.click(within(queryPalette("table navigation target")).getByText("Table navigation target"));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
    expect(checkbox).toHaveFocus();
  });

  it.each([
    {
      kind: "list",
      noteId: LIST_NOTE_ID,
      query: "authoritative list target",
      replacement: "# Visible note\n- [ ] Same-coordinate list replacement",
    },
    {
      kind: "table",
      noteId: TABLE_NOTE_ID,
      query: "table navigation target",
      replacement: tableMarkdown.replace("Table navigation target", "Same-coordinate table replacement"),
    },
  ])("cancels a same-coordinate $kind navigation replacement after both render frames", async ({ noteId, query, replacement }) => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const source = renderGamePage();
    const row = queryPalette(query);
    source.replaceSnapshotWithoutRender(noteId, { bodyMarkdown: replacement });

    fireEvent.click(within(row).getByText(new RegExp(query, "i")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
      await vi.advanceTimersByTimeAsync(16);
      await Promise.resolve();
    });

    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement?.matches('input[type="checkbox"]')).toBe(false);
  });

  it("uses instant centered scrolling and retains a short static highlight when reduced motion is requested", async () => {
    vi.useFakeTimers();
    vi.mocked(window.matchMedia).mockReturnValue(mediaQuery(true));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    renderGamePage();

    fireEvent.click(within(queryPalette("authoritative list target")).getByText("Authoritative list target"));

    for (let turn = 0; turn < 10 && !scrollIntoView.mock.calls.length; turn += 1) {
      await act(async () => { await vi.advanceTimersToNextTimerAsync(); });
    }

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    const target = screen.getByRole("checkbox", { name: "Отметить: Authoritative list target" }).closest(".markdown-task-row");
    expect(target).toHaveClass("markdown-checklist-search-target--highlighted");
    act(() => { vi.advanceTimersByTime(1600); });
    expect(target).not.toHaveClass("markdown-checklist-search-target--highlighted");
  });
});
