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
const RICH_NOTE_ID = "66666666-6666-4666-8666-666666666666";
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
const richPreviewMarkdown = [
  "# Rich note",
  "- [ ] Inspect [Primary details][?]",
  "- [ ] Palette peer target",
  "",
  "[?Primary details]:",
  "    - [ ] Direct preview control",
  "",
  "    Open [Nested details][?].",
  "[?Nested details]:",
  "    - [ ] Nested preview control",
].join("\n");
const richDirectCheckedMarkdown = [
  "# Rich note",
  "- [ ] Inspect [Primary details][?]",
  "- [ ] Palette peer target",
  "",
  "[?Primary details]:",
  "    - [x] Direct preview control",
  "",
  "    Open [Nested details][?].",
  "[?Nested details]:",
  "    - [ ] Nested preview control",
].join("\n");
const richDirectPartialMarkdown = [
  "# Rich note",
  "- [ ] Inspect [Primary details][?]",
  "- [ ] Palette peer target",
  "",
  "[?Primary details]:",
  "    - [-] Direct preview control",
  "",
  "    Open [Nested details][?].",
  "[?Nested details]:",
  "    - [ ] Nested preview control",
].join("\n");
const richNestedPartialMarkdown = [
  "# Rich note",
  "- [ ] Inspect [Primary details][?]",
  "- [ ] Palette peer target",
  "",
  "[?Primary details]:",
  "    - [ ] Direct preview control",
  "",
  "    Open [Nested details][?].",
  "[?Nested details]:",
  "    - [-] Nested preview control",
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

function renderGamePage(options: { checklistSearchBlocked?: boolean; completedFilter?: boolean; richBodyMarkdown?: string; tableBodyMarkdown?: string } = {}): SourceHarness {
  const currentTableMarkdown = options.tableBodyMarkdown ?? tableMarkdown;
  const snapshots = new Map<string, NoteInteractionSnapshot>([
    [LIST_NOTE_ID, { bodyMarkdown: authoritativeListMarkdown }],
    [FILTERED_NOTE_ID, { bodyMarkdown: filteredMarkdown }],
    [COLLAPSED_NOTE_ID, { bodyMarkdown: collapsedMarkdown, collapsedChecklistSections: [collapsedStageId, collapsedGroupId] }],
    [TABLE_NOTE_ID, { bodyMarkdown: currentTableMarkdown }],
    ...(options.richBodyMarkdown === undefined
      ? []
      : [[RICH_NOTE_ID, { bodyMarkdown: options.richBodyMarkdown }] as const]),
  ]);
  let forceRender: (() => void) | null = null;
  let currentNotes = [
    ...fixtureNotes.map((currentNote) => currentNote.id === TABLE_NOTE_ID
      ? { ...currentNote, bodyMarkdown: currentTableMarkdown }
      : currentNote),
    ...(options.richBodyMarkdown === undefined
      ? []
      : [note(RICH_NOTE_ID, options.richBodyMarkdown, 5120)]),
  ];
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

  it.each([
    { intent: "regular", click: {}, expectedMarkdown: richDirectCheckedMarkdown, expectedState: "checked" },
    { intent: "Shift partial", click: { shiftKey: true }, expectedMarkdown: richDirectPartialMarkdown, expectedState: "mixed" },
    { intent: "Command partial", click: { metaKey: true }, expectedMarkdown: richDirectPartialMarkdown, expectedState: "mixed" },
  ])("saves a $intent preview transition through the exact authoritative rich definition without recording history", async ({ click, expectedMarkdown, expectedState }) => {
    const source = renderGamePage({ richBodyMarkdown: richPreviewMarkdown });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "inspect" } });
    const palette = screen.getByRole("dialog", { name: "Поиск по чеклистам" });
    const preview = palette.querySelector<HTMLElement>(".page-checklist-search__preview")!;
    const control = within(preview).getByRole("checkbox", { name: /Direct preview control/ });

    fireEvent.click(control, click);

    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: RICH_NOTE_ID,
      field: "bodyMarkdown",
      value: expectedMarkdown,
    }));
    const refreshedControl = within(preview).getByRole("checkbox", { name: /Direct preview control/ });
    if (expectedState === "checked") expect(refreshedControl).toBeChecked();
    else expect(refreshedControl).toBePartiallyChecked();
    expect(source.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(within(screen.getByRole("grid", { name: "Результаты поиска" })).queryAllByRole("row")).toHaveLength(0);
  });

  it("saves an interactive nested-tooltip checklist change to the nested definition rather than its parent", async () => {
    const source = renderGamePage({ richBodyMarkdown: richPreviewMarkdown });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "inspect" } });
    const palette = screen.getByRole("dialog", { name: "Поиск по чеклистам" });
    const preview = palette.querySelector<HTMLElement>(".page-checklist-search__preview")!;

    fireEvent.click(within(preview).getByRole("button", { name: "Nested details" }));
    const tooltip = await screen.findByRole("dialog", { name: "Nested details" });
    fireEvent.click(within(tooltip).getByRole("checkbox", { name: /Nested preview control/ }), { metaKey: true });

    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: RICH_NOTE_ID,
      field: "bodyMarkdown",
      value: richNestedPartialMarkdown,
    }));
    expect(within(tooltip).getByRole("checkbox", { name: /Nested preview control/ })).toBePartiallyChecked();
    expect(source.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it.each([
    {
      authority: [
        "# Rich note",
        "- [ ] Replaced [Primary details][?]",
        "- [ ] Palette peer target",
        "",
        "[?Primary details]:",
        "    - [ ] Direct preview control",
        "",
        "    Open [Nested details][?].",
        "[?Nested details]:",
        "    - [ ] Nested preview control",
      ].join("\n"),
      caseName: "same-coordinate checklist replacement",
      error: /Пункт чеклиста/,
    },
    {
      authority: [
        "# Rich note",
        "- [ ] Inspect [Primary details][?]",
        "- [ ] Palette peer target",
        "",
        "[?Nested details]:",
        "    - [ ] Nested preview control",
      ].join("\n"),
      caseName: "missing definition",
      error: /аннотац/i,
    },
    {
      authority: [
        "# Rich note",
        "- [ ] Inspect [Primary details][?]",
        "- [ ] Palette peer target",
        "",
        "[?Primary details]:",
        "    - [ ] Direct preview control",
        "",
        "    Open [Nested details][?].",
        "[?Nested details]:",
        "    - [ ] Nested preview control",
        "[?Primary details]:",
        "    Duplicate body",
      ].join("\n"),
      caseName: "duplicate definition",
      error: /аннотац/i,
    },
    {
      authority: [
        "# Rich note",
        "- [ ] Inspect [Primary details][?]",
        "- [ ] Palette peer target",
        "",
        "[?Primary details]:",
        "    - [-] Authoritative direct preview control",
        "",
        "    Open [Nested details][?].",
        "[?Nested details]:",
        "    - [ ] Nested preview control",
      ].join("\n"),
      caseName: "stale expected body",
      error: /содержимое аннотации/i,
    },
  ])("rejects a $caseName before any rich-preview write and refreshes palette authority", async ({ authority, error }) => {
    const source = renderGamePage({ richBodyMarkdown: richPreviewMarkdown });
    const input = openPalette();
    fireEvent.change(input, { target: { value: "inspect" } });
    const palette = screen.getByRole("dialog", { name: "Поиск по чеклистам" });
    const preview = palette.querySelector<HTMLElement>(".page-checklist-search__preview")!;
    const staleControl = within(preview).getByRole("checkbox", { name: /Direct preview control/ });
    source.replaceSnapshotWithoutRender(RICH_NOTE_ID, { bodyMarkdown: authority });

    fireEvent.click(staleControl);

    expect(await within(palette).findByRole("status")).toHaveTextContent(error);
    expect(within(palette).getAllByRole("status")).toHaveLength(1);
    expect(source.saveNoteInteraction).not.toHaveBeenCalled();
    expect(source.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("rolls back rich-preview optimism to authoritative Markdown and retains one footer error after a durable failure", async () => {
    const source = renderGamePage({ richBodyMarkdown: richPreviewMarkdown });
    source.failNextSave(new Error("Хранилище аннотации недоступно"));
    const input = openPalette();
    fireEvent.change(input, { target: { value: "inspect" } });
    const palette = screen.getByRole("dialog", { name: "Поиск по чеклистам" });
    const preview = palette.querySelector<HTMLElement>(".page-checklist-search__preview")!;
    const control = within(preview).getByRole("checkbox", { name: /Direct preview control/ });

    fireEvent.click(control);
    expect(control).toBeChecked();

    await waitFor(() => expect(within(preview).getByRole("checkbox", { name: /Direct preview control/ })).not.toBeChecked());
    expect(within(palette).getAllByRole("status")).toHaveLength(1);
    expect(within(palette).getByRole("status")).toHaveTextContent("Хранилище аннотации недоступно");
    expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: RICH_NOTE_ID,
      field: "bodyMarkdown",
      value: richDirectCheckedMarkdown,
    });
    expect(source.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Поиск по чеклистам" })).toBeInTheDocument();
  });

  it("keeps GamePage as the durable rich-preview owner across palette dismissal and blocks every overlapping note write", async () => {
    const source = renderGamePage({ richBodyMarkdown: richPreviewMarkdown });
    const pendingSave = source.deferNextSave();
    const input = openPalette();
    fireEvent.change(input, { target: { value: "inspect" } });
    const palette = screen.getByRole("dialog", { name: "Поиск по чеклистам" });
    const preview = palette.querySelector<HTMLElement>(".page-checklist-search__preview")!;

    fireEvent.click(within(preview).getByRole("checkbox", { name: /Direct preview control/ }));
    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByRole("grid", { name: "Результаты поиска" })).getByRole("checkbox"));
    expect(source.saveNoteInteraction).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Escape" });
    shiftCycle();
    shiftCycle();
    expect(screen.queryByRole("dialog", { name: "Поиск по чеклистам" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Inspect [Primary details][?]" }));
    await act(async () => { await Promise.resolve(); });
    expect(source.saveNoteInteraction).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSave.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(source.saveNoteInteraction).toHaveBeenCalledWith({
      noteId: RICH_NOTE_ID,
      field: "bodyMarkdown",
      value: richDirectCheckedMarkdown,
    }));

    const reopenedInput = openPalette();
    fireEvent.change(reopenedInput, { target: { value: "inspect" } });
    const reopenedPreview = screen.getByRole("dialog", { name: "Поиск по чеклистам" }).querySelector<HTMLElement>(".page-checklist-search__preview")!;
    expect(within(reopenedPreview).getByRole("checkbox", { name: /Direct preview control/ })).toBeChecked();
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
  it.each([
    {
      kind: "ungrouped",
      markdown: [
        "# Table note",
        "| Stage | Complete |",
        "| --- | --- |",
        "| Filtered table target | [x] Search focus target |",
        "| Visible row | [ ] Keep table visible |",
      ].join("\n"),
    },
    {
      kind: "grouped",
      markdown: [
        "# Table note",
        "| Stage | Complete |",
        "| --- | --- |",
        "| Filtered group |",
        "| --- | --- |",
        "| Filtered table target | [x] Search focus target |",
        "| --- | --- |",
        "| Visible group |",
        "| --- | --- |",
        "| Visible row | [ ] Keep table visible |",
      ].join("\n"),
    },
  ])("waits for the normal table replica to settle before focusing a filtered $kind search result", async ({ markdown }) => {
    let completedAnimationFrames = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => {
      completedAnimationFrames += 1;
      callback(performance.now());
    }, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const animations: Array<Animation & { finish: () => void }> = [];
    const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function animate(): Animation {
        const animation = {
          oncancel: null as Animation["oncancel"],
          onfinish: null as Animation["onfinish"],
          cancel() { this.oncancel?.(new Event("cancel") as AnimationPlaybackEvent); },
          finish() { this.onfinish?.(new Event("finish") as AnimationPlaybackEvent); },
        } as unknown as Animation & { finish: () => void };
        animations.push(animation);
        return animation;
      },
    });
    const nativeFocus = HTMLElement.prototype.focus;
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function focusWhenVisible(options?: FocusOptions) {
      const liveTableRow = this.closest<HTMLElement>(".markdown-table-row");
      const motionKey = liveTableRow?.dataset.completedChecklistMotionKey;
      const markdownRoot = liveTableRow?.closest(".markdown");
      const activeReplica = motionKey && markdownRoot
        ? [...markdownRoot.querySelectorAll<HTMLElement>(".markdown-completed-checklist-motion-replica [data-completed-checklist-motion-key]")]
          .some((entry) => entry.dataset.completedChecklistMotionKey === motionKey)
        : false;
      if (this.closest("[hidden]") || liveTableRow?.style.visibility === "hidden" || activeReplica) return;
      nativeFocus.call(this, options);
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      renderGamePage({ completedFilter: true, tableBodyMarkdown: markdown });

      const result = queryPalette("search focus target");
      const framesBeforeNavigation = completedAnimationFrames;
      fireEvent.click(within(result).getByText("Search focus target"));
      await waitFor(() => expect(document.querySelector(".markdown-completed-checklist-motion-replica")).toBeInTheDocument());
      const target = document.querySelector<HTMLInputElement>(`.markdown-table-scroll [data-checklist-search-target-id] input[aria-label="Снять отметку: Search focus target"]`)!;
      await waitFor(() => expect(completedAnimationFrames).toBeGreaterThanOrEqual(framesBeforeNavigation + 2));

      act(() => {
        for (const animation of [...animations]) animation.finish();
      });

      await waitFor(() => expect(document.activeElement).toBe(target));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    } finally {
      focus.mockRestore();
      if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
      else delete (Element.prototype as { animate?: typeof Element.prototype.animate }).animate;
    }
  });

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
