import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../src/domain";
import {
  GamePage,
  getNoteDropPlacement,
  groupDraftNotes,
  moveDraftNoteToGroup,
  nextEmptyNoteGroupRank,
  prepareNoteGroupAfter,
  type EditableNote,
  type GameSaveInput,
} from "../src/pages/GamePage";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_A_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_B_ID = "33333333-3333-4333-8333-333333333333";
const NOTE_C_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-07-17T10:00:00.000Z";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
const scrollIntoViewMock = vi.fn();
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoViewMock });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  scrollIntoViewMock.mockClear();
});

function editable(clientId: string, rank: number, groupRank?: number): EditableNote {
  return { clientId, bodyMarkdown: clientId, attachments: [], ...(groupRank === undefined ? {} : { groupRank }), rank };
}

function note(id: string, rank: number, groupRank?: number): Note {
  return { id, gameId: GAME_ID, bodyMarkdown: id, attachments: [], ...(groupRank === undefined ? {} : { groupRank }), rank, createdAt: NOW, updatedAt: NOW };
}

function StatefulGamePage({ initialNotes, onSave = vi.fn() }: { initialNotes: Note[]; onSave?: (input: GameSaveInput) => void }) {
  const [notes, setNotes] = useState(initialNotes);
  return <GamePage assets={{}} game={game} mode="game" notes={notes} onSave={(input) => {
    onSave(input);
    setNotes(input.notes.map((draft) => ({
      id: draft.id ?? draft.clientId,
      gameId: GAME_ID,
      bodyMarkdown: draft.bodyMarkdown,
      attachments: draft.attachments as Note["attachments"],
      ...(draft.groupRank === undefined ? {} : { groupRank: draft.groupRank }),
      rank: draft.rank,
      createdAt: NOW,
      updatedAt: NOW,
    })));
  }} />;
}

const game = {
  id: GAME_ID,
  title: "Game",
  coverAssetId: null,
  platforms: [],
  tags: [],
  status: "playing" as const,
  placement: { tierId: "unranked" as const, rank: 1024 },
  reviewMarkdown: "",
  createdAt: NOW,
  updatedAt: NOW,
};

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({ left, top, width, height }) } as DOMRect;
}

function fileTransfer(files: File[] = [], types = ["Files"]): DataTransfer {
  return {
    dropEffect: "none",
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })) as unknown as DataTransferItemList,
    types,
  } as unknown as DataTransfer;
}

function fileDragEvent(type: "dragenter" | "dragleave" | "dragover" | "drop", transfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

describe("anonymous note groups", () => {
  it("allocates space for inserted note groups without shifting an available interval", () => {
    expect(prepareNoteGroupAfter([editable(NOTE_A_ID, 1024, 1024)], 1024).groupRank).toBe(3072);

    const midpointNotes = [editable(NOTE_A_ID, 1024, 1024), editable(NOTE_B_ID, 1024, 3072)];
    expect(prepareNoteGroupAfter(midpointNotes, 1024)).toEqual({ notes: midpointNotes, groupRank: 2048 });

    const crowded = [
      editable(NOTE_A_ID, 1024, 1024),
      editable(NOTE_B_ID, 1024, 1025),
      editable(NOTE_C_ID, 1024, 1026),
      editable("55555555-5555-4555-8555-555555555555", 1024, 9000),
    ];
    const prepared = prepareNoteGroupAfter(crowded, 1024);
    expect(prepared.groupRank).toBe(2048);
    expect(groupDraftNotes(prepared.notes).map((group) => group.groupRank)).toEqual([1024, 3073, 5122, 9000]);

    let intervalNotes = [editable(NOTE_A_ID, 1024, 1024), editable(NOTE_B_ID, 1024, 3072)];
    let leftRank = 1024;
    let insertedRank = 0;
    for (let index = 0; index < 10; index += 1) {
      const allocated = prepareNoteGroupAfter(intervalNotes, leftRank);
      insertedRank = allocated.groupRank;
      intervalNotes = [...allocated.notes, editable(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, 1024, insertedRank)];
      leftRank = insertedRank;
    }
    const existingRanks = groupDraftNotes(intervalNotes).map((group) => group.groupRank);
    const leftInterval = prepareNoteGroupAfter(intervalNotes, 1024);
    const rightInterval = prepareNoteGroupAfter(intervalNotes, insertedRank);
    expect(groupDraftNotes(leftInterval.notes).map((group) => group.groupRank)).toEqual(existingRanks);
    expect(groupDraftNotes(rightInterval.notes).map((group) => group.groupRank)).toEqual(existingRanks);
    expect(leftInterval.groupRank).toBeGreaterThan(1024);
    expect(leftInterval.groupRank).toBeLessThan(insertedRank);
    expect(rightInterval.groupRank).toBeGreaterThan(insertedRank);
    expect(rightInterval.groupRank).toBeLessThan(3072);
  });

  it("rejects appended note-group ranks beyond the safe integer domain", () => {
    const lastSafeGroup = [editable(NOTE_A_ID, 1024, Number.MAX_SAFE_INTEGER)];

    expect(() => nextEmptyNoteGroupRank(lastSafeGroup)).toThrow(RangeError);
    expect(() => prepareNoteGroupAfter(lastSafeGroup, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("groups legacy notes together and derives one trailing empty group", () => {
    const notes = [
      editable(NOTE_B_ID, 2048),
      editable(NOTE_A_ID, 1024),
      editable(NOTE_C_ID, 1024, 3072),
    ];

    expect(groupDraftNotes(notes)).toEqual([
      { groupRank: 1024, notes: [notes[1], notes[0]] },
      { groupRank: 3072, notes: [notes[2]] },
    ]);
    expect(nextEmptyNoteGroupRank([])).toBe(1024);
    expect(nextEmptyNoteGroupRank(notes)).toBe(5120);
  });

  it("reorders inside a group and moves notes between existing or empty groups", () => {
    const notes = [
      editable(NOTE_A_ID, 1024),
      editable(NOTE_B_ID, 2048),
      editable(NOTE_C_ID, 1024, 2048),
    ];

    expect(getNoteDropPlacement(notes, NOTE_A_ID, NOTE_B_ID)).toEqual({ groupRank: 1024, index: 1 });
    expect(getNoteDropPlacement(notes, NOTE_C_ID, NOTE_A_ID)).toEqual({ groupRank: 1024, index: 0 });
    expect(getNoteDropPlacement(notes, NOTE_A_ID, NOTE_B_ID, "before")).toEqual({ groupRank: 1024, index: 0 });
    expect(getNoteDropPlacement(notes, NOTE_A_ID, NOTE_B_ID, "after")).toEqual({ groupRank: 1024, index: 1 });
    expect(getNoteDropPlacement(notes, NOTE_C_ID, NOTE_A_ID, "after")).toEqual({ groupRank: 1024, index: 1 });
    const moved = moveDraftNoteToGroup(notes, NOTE_A_ID, 3072, 0);
    expect(groupDraftNotes(moved).map((group) => [group.groupRank, group.notes.map((item) => item.clientId)])).toEqual([
      [1024, [NOTE_B_ID]],
      [2048, [NOTE_C_ID]],
      [3072, [NOTE_A_ID]],
    ]);
    expect(moved.find((item) => item.clientId === NOTE_A_ID)).toMatchObject({ groupRank: 3072, rank: 1024 });
  });

  it("shows only one virtual empty group and creates the next one as a draft", async () => {
    const user = userEvent.setup();
    render(<GamePage assets={{}} game={game} mode="game" notes={[]} onSave={vi.fn()} />);

    const firstEmpty = screen.getByRole("button", { name: "Добавить заметку в новую группу" });
    expect(firstEmpty).toHaveAttribute("data-note-group-rank", "1024");
    expect(document.querySelectorAll(".notes-list")).toHaveLength(0);

    await user.click(firstEmpty);
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Новая группа заметок" })).toHaveAttribute("data-note-group-rank", "3072");

    await user.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toHaveAttribute("data-note-group-rank", "1024");
  });

  it("renders each persisted group as an independent shelf", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={vi.fn()} />);

    const groups = document.querySelectorAll(".note-group");
    expect(groups).toHaveLength(2);
    expect(document.querySelectorAll(".notes-list")).toHaveLength(2);
    expect(screen.getAllByRole("group", { name: /Группа заметок/ })).toHaveLength(2);
    expect(screen.queryAllByRole("button", { name: "Добавить заметку в новую группу" })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Добавить заметку в группу 1" })).toHaveClass("note-group-add-button");
    expect(screen.getByRole("button", { name: "Добавить заметку в группу 2" })).toHaveClass("note-group-add-button");
    expect(groups[0]).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("group", { name: "Новая группа заметок" })).toHaveAttribute("tabindex", "-1");
  });

  it("renders paired note and group actions after existing groups in both modes", async () => {
    const user = userEvent.setup();
    const saved = render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={vi.fn()} />);

    let actionRows = document.querySelectorAll(".note-group-actions");
    expect(actionRows).toHaveLength(2);
    expect(within(actionRows[0] as HTMLElement).getByRole("button", { name: "Добавить заметку в группу 1" })).toBeInTheDocument();
    expect(within(actionRows[0] as HTMLElement).getByRole("button", { name: "Добавить группу после группы 1" })).toBeInTheDocument();
    saved.unmount();

    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    await user.click(screen.getByRole("button", { name: "Добавить группу после группы 1" }));
    actionRows = document.querySelectorAll(".note-group-actions");
    expect(actionRows).toHaveLength(2);
    expect(within(actionRows[0] as HTMLElement).getByRole("button", { name: "Добавить заметку в группу 1" })).toBeInTheDocument();
    expect(within(actionRows[0] as HTMLElement).getByRole("button", { name: "Добавить группу после группы 1" })).toBeInTheDocument();
  });

  it("inserts a saved-game group prospectively and discards its shifts on cancellation", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 1025), note(NOTE_C_ID, 1024, 1026)]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Добавить группу после группы 1" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(editor.closest(".note-group")).toHaveAttribute("data-note-group-rank", "2048");
    expect([...document.querySelectorAll<HTMLElement>(".note-group")].map((group) => group.dataset.noteGroupRank)).toEqual(["1024", "2048", "3073", "5122"]);
    await user.type(editor, "Вставленная заметка");
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(groupDraftNotes(onSave.mock.calls[0][0].notes).map((group) => group.groupRank)).toEqual([1024, 2048, 3073, 5122]);

    await user.click(screen.getByRole("button", { name: "Добавить группу после группы 1" }));
    await user.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect([...document.querySelectorAll<HTMLElement>(".note-group")].map((group) => group.dataset.noteGroupRank)).toEqual(["1024", "1025", "1026"]);
  });

  it("inserts a new-game group between two local draft groups", async () => {
    const user = userEvent.setup();
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    await user.click(screen.getByRole("button", { name: "Добавить группу после группы 1" }));
    await user.click(screen.getByRole("button", { name: "Добавить группу после группы 1" }));

    const insertedGroup = document.querySelector<HTMLElement>('.note-group[data-note-group-rank="2048"]')!;
    expect(within(insertedGroup).getByRole("textbox", { name: "Текст заметки" })).toBeInTheDocument();
    expect([...document.querySelectorAll<HTMLElement>(".note-group")].map((group) => group.dataset.noteGroupRank)).toEqual(["1024", "2048", "3072"]);
  });

  it("creates a note directly inside an existing group", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Добавить заметку в группу 1" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(editor.closest(".note-group")).toHaveAttribute("data-note-group-rank", "1024");
    expect(editor).toHaveFocus();
    await user.type(editor, "Новая заметка");
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes.find((item) => item.bodyMarkdown === "Новая заметка")).toMatchObject({ groupRank: 1024, rank: 2048 });
  });

  it("reveals compact add buttons globally and marks only the file target group", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={vi.fn()} />);
    const notesArea = screen.getByRole("region", { name: "Заметки" });
    const firstGroup = screen.getByRole("group", { name: "Группа заметок 1" });
    const secondGroup = screen.getByRole("group", { name: "Группа заметок 2" });
    const transfer = fileTransfer();

    fireEvent(notesArea, fileDragEvent("dragenter", transfer));
    expect(notesArea).toHaveClass("is-file-dragging");
    expect(notesArea.querySelector(".note-groups")).toHaveClass("is-file-dragging");
    expect(notesArea.querySelectorAll(".note-group-add-button")).toHaveLength(4);

    fireEvent(secondGroup, fileDragEvent("dragenter", transfer));
    expect(firstGroup).not.toHaveClass("is-file-over");
    expect(secondGroup).toHaveClass("is-file-over");
    fireEvent(secondGroup, fileDragEvent("dragleave", transfer));
    expect(secondGroup).not.toHaveClass("is-file-over");

    fireEvent(notesArea, fileDragEvent("dragleave", transfer));
    expect(notesArea).not.toHaveClass("is-file-dragging");
  });

  it("keeps labelled add actions together at the end of an existing group", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Группа заметок 1" });
    const addButton = screen.getByRole("button", { name: "Добавить заметку в группу 1" });
    const addGroupButton = screen.getByRole("button", { name: "Добавить группу после группы 1" });

    expect(group.lastElementChild).toBe(addButton.parentElement?.parentElement);
    expect(addButton).toHaveTextContent("Добавить заметку");
    expect(addGroupButton).toHaveTextContent("Добавить группу");
  });

  it("focuses a newly added draft note before a new game is saved", async () => {
    const user = userEvent.setup();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frameId = ++nextFrameId;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => { frames.delete(frameId); });
    const flushFrame = () => act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    });
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const lowLevelEditor = editor.closest<HTMLElement>(".monaco-markdown-editor")!;

    expect(editor).toHaveFocus();
    expect(lowLevelEditor).toHaveAttribute("data-auto-focus", "true");
    flushFrame();
    flushFrame();

    await waitFor(() => {
      expect(lowLevelEditor).not.toHaveAttribute("data-auto-focus");
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto", block: "nearest", inline: "nearest" });
    });
  });

  it("preflights a mixed file drop as one batch before reading any file", async () => {
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const canAddBlob = vi.fn((byteLength: number) => byteLength > 5 ? "Файл не помещается в localStorage Safari" : null);
    render(<GamePage assets={{}} canAddBlob={canAddBlob} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={onSave} />);
    const group = screen.getByRole("group", { name: "Группа заметок 1" });
    const first = new File(["1234"], "run.MP4", { type: "" });
    const second = new File(["12"], "guide.pdf", { type: "application/pdf" });

    fireEvent(group, fileDragEvent("drop", fileTransfer([first, second])));

    expect(await screen.findByRole("alert")).toHaveTextContent("Файл не помещается в localStorage Safari");
    expect(screen.queryByLabelText("Видео «run.MP4»")).not.toBeInTheDocument();
    expect(canAddBlob.mock.calls.map(([byteLength]) => byteLength)).toEqual([6]);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("creates an attachment draft by dropping anywhere in the trailing empty group", async () => {
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
    const emptyGroup = screen.getByRole("group", { name: "Новая группа заметок" });

    fireEvent(emptyGroup, fileDragEvent("drop", fileTransfer([new File(["video"], "clip.mp4", { type: "video/mp4" })])));

    const video = await screen.findByLabelText("Видео «clip.mp4»");
    expect(video.closest(".note-group")).toHaveAttribute("data-note-group-rank", "1024");
    expect(screen.getByRole("group", { name: "Новая группа заметок" })).toHaveAttribute("data-note-group-rank", "3072");
  });

  it("creates a file note in the second group when its body receives the drop", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={onSave} />);
    const secondGroup = screen.getByRole("group", { name: "Группа заметок 2" });

    fireEvent(secondGroup, fileDragEvent("drop", fileTransfer([new File(["video"], "second.mp4", { type: "video/mp4" })])));

    const video = await screen.findByLabelText("Видео «second.mp4»");
    expect(video.closest(".note-group")).toHaveAttribute("data-note-group-rank", "2048");
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const created = onSave.mock.calls[0][0].notes.find((item) => item.clientId !== NOTE_A_ID && item.clientId !== NOTE_B_ID)!;
    expect(created).toMatchObject({ groupRank: 2048, rank: 2048 });
  });

  it("keeps an editor file drop in the current note after the group observes it as prevented", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={onSave} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const group = editor.closest(".note-group")!;
    const groupObservedDefaultPrevented = vi.fn<(prevented: boolean) => void>();
    group.addEventListener("drop", (event) => groupObservedDefaultPrevented(event.defaultPrevented));
    const drop = fileDragEvent("drop", fileTransfer([new File(["guide"], "guide.pdf", { type: "application/pdf" })]));

    fireEvent(editor, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(groupObservedDefaultPrevented).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("link", { name: /guide\.pdf/ })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Текст заметки" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes).toHaveLength(1);
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ clientId: NOTE_A_ID, attachments: [expect.objectContaining({ type: "pending-file", label: "guide.pdf" })] });
  });

  it("keeps portaled editor drops in their draft while free group drops create one new draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));

    const firstEditor = screen.getByRole("textbox", { name: "Текст заметки" });
    const firstGroup = firstEditor.closest(".note-group")!;
    const groupObservedDefaultPrevented = vi.fn<(prevented: boolean) => void>();
    firstGroup.addEventListener("drop", (event) => groupObservedDefaultPrevented(event.defaultPrevented));
    const editorDrop = fileDragEvent("drop", fileTransfer([new File(["guide"], "guide.pdf", { type: "application/pdf" })]));

    fireEvent(firstEditor, editorDrop);

    expect(editorDrop.defaultPrevented).toBe(true);
    expect(groupObservedDefaultPrevented).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("link", { name: /guide\.pdf/ })).toBeInTheDocument();
    expect(document.querySelectorAll(".note-editor-sortable")).toHaveLength(1);

    const titleInput = screen.getByPlaceholderText("Например, DuckTales");
    titleInput.focus();
    fireEvent(firstGroup, fileDragEvent("drop", fileTransfer([new File(["manual"], "manual.pdf", { type: "application/pdf" })])));

    const manualLink = await screen.findByRole("link", { name: /manual\.pdf/ });
    expect(manualLink.closest(".note-group")).toBe(firstGroup);
    expect(document.querySelectorAll(".note-editor-sortable")).toHaveLength(2);
    expect(titleInput).toHaveFocus();
    await user.type(titleInput, "Portal files");
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes).toHaveLength(2);
    const manualDraft = onSave.mock.calls[0][0].notes.find((note) => note.attachments.some((attachment) => attachment.type === "pending-file" && attachment.label === "manual.pdf"));
    expect(manualDraft).toMatchObject({ groupRank: 1024, rank: 2048 });
  });

  it("does not autofocus a draft created by dropping a file", async () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Группа заметок 1" });

    fireEvent(group, fileDragEvent("drop", fileTransfer([new File(["guide"], "guide.pdf", { type: "application/pdf" })])));

    const editor = await screen.findByRole("textbox", { name: "Текст заметки" });
    expect(editor).not.toHaveFocus();
  });

  it("removes persistent editor hosts on draft deletion and form unmount", async () => {
    const user = userEvent.setup();
    const view = render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    await user.click(screen.getByRole("button", { name: "Добавить заметку в группу 1" }));
    const deletedHost = document.querySelector<HTMLElement>(".note-editor-sortable")!;
    const deletedEditor = deletedHost.querySelector<HTMLElement>(".monaco-note-editor")!;
    const survivingHost = document.querySelectorAll<HTMLElement>(".note-editor-sortable")[1];
    const survivingEditor = survivingHost.querySelector<HTMLElement>(".monaco-note-editor")!;
    const survivingGrid = survivingHost.parentElement;

    await user.click(within(deletedHost).getByRole("button", { name: "Удалить заметку" }));

    await waitFor(() => expect(deletedHost.isConnected).toBe(false));
    expect(deletedEditor.isConnected).toBe(false);
    expect(survivingHost.isConnected).toBe(true);
    expect(survivingEditor.isConnected).toBe(true);
    expect(survivingHost.parentElement).toBe(survivingGrid);
    view.unmount();

    expect(survivingHost.isConnected).toBe(false);
    expect(survivingEditor.isConnected).toBe(false);
  });

  it("ignores non-file drags over a group", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Группа заметок 1" });
    const transfer = fileTransfer([], ["text/plain"]);
    const enter = fileDragEvent("dragenter", transfer);
    const drop = fileDragEvent("drop", transfer);

    fireEvent(group, enter);
    fireEvent(group, drop);

    expect(enter.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(group).not.toHaveClass("is-file-over");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("prevents Safari file navigation but does not create a draft when storage is locked", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={vi.fn()} storageLocked />);
    const group = screen.getByRole("group", { name: "Группа заметок 1" });
    const transfer = fileTransfer([new File(["guide"], "guide.pdf", { type: "application/pdf" })]);
    const dragOver = fileDragEvent("dragover", transfer);
    const drop = fileDragEvent("drop", transfer);

    fireEvent(group, dragOver);
    fireEvent(group, drop);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(group).not.toHaveClass("is-file-over");
    expect(screen.getByRole("button", { name: "Добавить заметку в группу 1" })).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("drops the last note into the virtual empty group", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.matches(".note-empty-group")) return rect(0, 220, 727, 40);
      if (this.matches(".notes-list")) return rect(0, 100, 727, 100);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={onSave} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    const handle = within(card).getByRole("button", { name: "Перетащить заметку" });
    const empty = screen.getByRole("group", { name: "Новая группа заметок" });

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 185 } },
      { target: handle, coords: { clientX: 40, clientY: 185 } },
      { target: empty, coords: { clientX: 20, clientY: 235 } },
      { keys: "[/MouseLeft]", target: empty, coords: { clientX: 20, clientY: 235 } },
    ]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ clientId: NOTE_A_ID, groupRank: 3072, rank: 1024 });
  });

  it("removes an emptied group after persistence and keeps one new trailing group", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.matches(".note-empty-group")) return rect(0, 220, 727, 40);
      if (this.matches(".notes-list")) return rect(0, 100, 727, 100);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<StatefulGamePage initialNotes={[note(NOTE_A_ID, 1024)]} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    const handle = within(card).getByRole("button", { name: "Перетащить заметку" });
    const empty = screen.getByRole("group", { name: "Новая группа заметок" });

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 185 } },
      { target: handle, coords: { clientX: 40, clientY: 185 } },
      { target: empty, coords: { clientX: 20, clientY: 235 } },
      { keys: "[/MouseLeft]", target: empty, coords: { clientX: 20, clientY: 235 } },
    ]);

    await waitFor(() => expect(screen.getByRole("group", { name: "Группа заметок 1" })).toHaveAttribute("data-note-group-rank", "3072"));
    expect(document.querySelectorAll(".note-group")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Новая группа заметок" })).toHaveAttribute("data-note-group-rank", "5120");
  });

  it("drags a note into an existing shelf group", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.dataset.noteId === NOTE_B_ID) return rect(0, 260, 360, 90);
      if (this.matches(".notes-list")) return this.parentElement?.getAttribute("aria-label") === "Группа заметок 1" ? rect(0, 100, 727, 100) : rect(0, 260, 727, 100);
      if (this.matches(".note-empty-group")) return rect(0, 420, 727, 40);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={onSave} />);
    const source = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    const handle = within(source).getByRole("button", { name: "Перетащить заметку" });
    const target = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_B_ID}"]`)!;

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 185 } },
      { target: handle, coords: { clientX: 40, clientY: 185 } },
      { target, coords: { clientX: 20, clientY: 280 } },
      { keys: "[/MouseLeft]", target, coords: { clientX: 20, clientY: 280 } },
    ]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const moved = onSave.mock.calls[0][0].notes.find((item) => item.clientId === NOTE_A_ID);
    expect(moved).toMatchObject({ groupRank: 2048, rank: 512 });
  });

  it("moves a note between shelf groups with the delayed touch sensor", async () => {
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.dataset.noteId === NOTE_B_ID) return rect(0, 260, 360, 90);
      if (this.matches(".notes-list")) return this.parentElement?.getAttribute("aria-label") === "Группа заметок 1" ? rect(0, 100, 727, 100) : rect(0, 260, 727, 100);
      if (this.matches(".note-empty-group")) return rect(0, 420, 727, 40);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={onSave} />);
    const source = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    const handle = within(source).getByRole("button", { name: "Перетащить заметку" });
    const target = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_B_ID}"]`)!;

    await act(async () => {
      fireEvent.touchStart(handle, { touches: [{ identifier: 1, clientX: 20, clientY: 185 }] });
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    await waitFor(() => expect(source).toHaveClass("is-dragging"));
    act(() => {
      fireEvent.touchMove(handle, { touches: [{ identifier: 1, clientX: 20, clientY: 280 }] });
    });
    await waitFor(() => expect(target).toHaveClass("is-drop-target"));
    act(() => {
      fireEvent.touchEnd(handle, { changedTouches: [{ identifier: 1, clientX: 20, clientY: 280 }], touches: [] });
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes.find((item) => item.clientId === NOTE_A_ID)).toMatchObject({ groupRank: 2048, rank: 512 });
  });

  it("appends a note by dropping into free space of an existing group", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.dataset.noteId === NOTE_B_ID) return rect(0, 260, 360, 90);
      if (this.matches('.note-group[data-note-group-rank="1024"]')) return rect(0, 100, 727, 100);
      if (this.matches('.note-group[data-note-group-rank="2048"]')) return rect(0, 260, 727, 120);
      if (this.matches(".notes-list")) return rect(0, 0, 727, 100);
      if (this.matches(".note-empty-group")) return rect(0, 420, 727, 40);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={onSave} />);
    const source = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    const handle = within(source).getByRole("button", { name: "Перетащить заметку" });
    const targetGroup = document.querySelector<HTMLElement>('.note-group[data-note-group-rank="2048"]')!;

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 185 } },
      { target: handle, coords: { clientX: 40, clientY: 185 } },
      { target: targetGroup, coords: { clientX: 600, clientY: 350 } },
      { keys: "[/MouseLeft]", target: targetGroup, coords: { clientX: 600, clientY: 350 } },
    ]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const targetNotes = onSave.mock.calls[0][0].notes.filter((item) => (item.groupRank ?? 1024) === 2048).sort((left, right) => left.rank - right.rank);
    expect(targetNotes.map((item) => item.clientId)).toEqual([NOTE_B_ID, NOTE_A_ID]);
  });

  it("moves a note into the empty group with the keyboard sensor", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.matches(".notes-list")) return rect(0, 100, 727, 100);
      if (this.matches(".note-empty-group")) return rect(0, 240, 727, 44);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={onSave} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    const handle = within(card).getByRole("button", { name: "Перетащить заметку" });
    handle.focus();

    await user.keyboard("[Space]");
    await waitFor(() => expect(card).toHaveClass("is-dragging"));
    await user.keyboard("[ArrowDown]");
    await user.keyboard("[Enter]");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ groupRank: 3072, rank: 1024 });
  });

  it("restores keyboard focus after moving a note between shelf groups", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId === NOTE_A_ID) return rect(0, 100, 360, 90);
      if (this.matches(".notes-list")) return rect(0, 100, 727, 100);
      if (this.matches(".note-empty-group")) return rect(0, 240, 727, 44);
      if (this.matches(".note-card__content")) return rect(0, 0, 360, 80);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<StatefulGamePage initialNotes={[note(NOTE_A_ID, 1024)]} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    within(card).getByRole("button", { name: "Перетащить заметку" }).focus();

    await user.keyboard("[Space][ArrowDown][Enter]");

    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("Перетащить заметку"));
    expect(document.activeElement?.closest(`[data-note-id="${NOTE_A_ID}"]`)).not.toBeNull();
    expect(document.activeElement?.closest('.note-group[data-note-group-rank="3072"]')).not.toBeNull();
  });

  it("groups draft notes with drag and drop before a new game is saved", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const rank = this.closest<HTMLElement>(".note-group")?.dataset.noteGroupRank;
      if (this.dataset.noteId) return rank === "3072" ? rect(0, 300, 360, 130) : rect(0, 100, 360, 130);
      if (this.matches('.note-group[data-note-group-rank="1024"]')) return rect(0, 100, 727, 160);
      if (this.matches('.note-group[data-note-group-rank="3072"]')) return rect(0, 300, 727, 160);
      if (this.matches(".note-editors-grid")) return rank === "3072" ? rect(0, 300, 727, 140) : rect(0, 100, 727, 140);
      if (this.matches(".note-empty-group")) return rect(0, 500, 727, 40);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    await user.click(screen.getByRole("button", { name: "Добавить группу после группы 1" }));
    const editors = [...document.querySelectorAll<HTMLElement>(".note-editor-sortable")];
    const modelKeys = editors.map((editor) => editor.querySelector<HTMLElement>(".monaco-note-editor")!.dataset.modelKey);
    expect(modelKeys).toEqual(editors.map((editor) => `note:${editor.dataset.noteId}`));
    expect(new Set(modelKeys).size).toBe(2);
    const movingEditor = editors[1];
    const movingNoteEditor = movingEditor.querySelector<HTMLElement>(".monaco-note-editor")!;
    const movingLowLevelEditor = movingNoteEditor.querySelector<HTMLElement>(".monaco-markdown-editor")!;
    const movingTextArea = movingLowLevelEditor.querySelector<HTMLTextAreaElement>("textarea")!;
    const firstTextArea = editors[0].querySelector<HTMLTextAreaElement>("textarea")!;
    const movingNoteId = movingEditor.dataset.noteId!;
    const secondHandle = movingEditor.querySelector<HTMLElement>('button[aria-label="Перетащить заметку"]')!;
    const firstGroup = document.querySelector<HTMLElement>('.note-group[data-note-group-rank="1024"]')!;
    const titleInput = screen.getByPlaceholderText("Например, DuckTales");

    await waitFor(() => expect(movingLowLevelEditor).not.toHaveAttribute("data-auto-focus"));
    fireEvent.change(firstTextArea, { target: { value: "Первая заметка" } });
    fireEvent.change(movingTextArea, { target: { value: "Вторая заметка" } });

    await user.pointer([
      { keys: "[MouseLeft>]", target: secondHandle, coords: { clientX: 20, clientY: 420 } },
      { target: secondHandle, coords: { clientX: 40, clientY: 420 } },
    ]);
    titleInput.focus();
    expect(titleInput).toHaveFocus();
    await user.pointer([
      { target: firstGroup, coords: { clientX: 600, clientY: 220 } },
      { keys: "[/MouseLeft]", target: firstGroup, coords: { clientX: 600, clientY: 220 } },
    ]);

    await waitFor(() => expect(document.querySelectorAll(".note-group")).toHaveLength(1));
    const movedEditor = [...firstGroup.querySelectorAll<HTMLElement>(".note-editor-sortable")]
      .find((editor) => editor.dataset.noteId === movingNoteId)!;
    expect(movedEditor).toBe(movingEditor);
    expect(movedEditor.querySelector(".monaco-note-editor")).toBe(movingNoteEditor);
    expect(movedEditor.querySelector(".monaco-markdown-editor")).toBe(movingLowLevelEditor);
    expect(movingEditor.isConnected).toBe(true);
    expect(movingNoteEditor.isConnected).toBe(true);
    expect(movingLowLevelEditor.isConnected).toBe(true);
    expect(movedEditor.parentElement).toHaveClass("note-editors-grid");
    expect(movedEditor.closest(".note-group")).toBe(firstGroup);
    expect(movingNoteEditor).toHaveAttribute("data-model-key", `note:${movingNoteId}`);
    expect(titleInput).toHaveFocus();
    expect(firstGroup.querySelectorAll(".note-editor-sortable")).toHaveLength(2);

    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 60)); });
    const moveUp = within(movingEditor).getByRole("button", { name: "Переместить заметку выше" });
    expect(moveUp).toBeEnabled();
    fireEvent.click(moveUp);
    await waitFor(() => expect(firstGroup.querySelector(".note-editors-grid")?.firstElementChild).toBe(movingEditor));
    expect(movingEditor.querySelector(".monaco-note-editor")).toBe(movingNoteEditor);
    expect(movingEditor.querySelector(".monaco-markdown-editor")).toBe(movingLowLevelEditor);

    await user.type(titleInput, "Portal game");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedNotes = [...onSave.mock.calls[0][0].notes].sort((left, right) => left.rank - right.rank);
    expect(savedNotes.map((note) => [note.bodyMarkdown, note.groupRank])).toEqual([
      ["Вторая заметка", 1024],
      ["Первая заметка", 1024],
    ]);
    expect(screen.getByRole("group", { name: "Новая группа заметок" })).toHaveAttribute("data-note-group-rank", "3072");
  });

  it("keeps four persistent hosts in ranked order after a non-adjacent move", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const host = this.matches(".note-editor-sortable") ? this : this.closest<HTMLElement>(".note-editor-sortable");
      const hostIndex = host?.parentElement ? [...host.parentElement.children].indexOf(host) : 0;
      const hostRect = rect(0, 100 + Math.max(0, hostIndex) * 140, 360, 130);
      if (this.matches(".note-editor-sortable, .note-card--editing")) return hostRect;
      if (this.matches(".note-drop-zone--before")) return rect(hostRect.left, hostRect.top, hostRect.width, 65);
      if (this.matches(".note-drop-zone--after")) return rect(hostRect.left, hostRect.top + 65, hostRect.width, 65);
      if (this.matches(".note-editors-grid, .note-group")) return rect(0, 100, 727, 560);
      if (this.matches(".note-empty-group")) return rect(0, 700, 727, 40);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 130);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    const addToFirstGroup = screen.getByRole("button", { name: "Добавить заметку в группу 1" });
    await user.click(addToFirstGroup);
    await user.click(addToFirstGroup);
    await user.click(addToFirstGroup);
    const [hostA, , hostC, hostD] = [...document.querySelectorAll<HTMLElement>(".note-editor-sortable")];
    const grid = hostA.parentElement!;
    const hostIds = (hosts: Element[]) => hosts.map((host) => (host as HTMLElement).dataset.noteId);

    fireEvent.click(within(hostC).getByRole("button", { name: "Переместить заметку выше" }));
    await waitFor(() => expect(grid.children.item(1)).toBe(hostC));
    fireEvent.click(within(hostC).getByRole("button", { name: "Переместить заметку выше" }));
    await waitFor(() => expect(grid.firstElementChild).toBe(hostC));
    const orderBeforeDrag = [...grid.children];
    const originalEditors = new Map(orderBeforeDrag.map((host) => [host, host.querySelector(".monaco-note-editor")]));

    const dragHandle = within(hostD).getByRole("button", { name: "Перетащить заметку" });
    const beforeFirst = hostC.querySelector<HTMLElement>(".note-drop-zone--before")!;
    await user.pointer([
      { keys: "[MouseLeft>]", target: dragHandle, coords: { clientX: 20, clientY: 585 } },
      { target: dragHandle, coords: { clientX: 40, clientY: 585 } },
      { target: beforeFirst, coords: { clientX: 20, clientY: 110 } },
      { keys: "[/MouseLeft]", target: beforeFirst, coords: { clientX: 20, clientY: 110 } },
    ]);

    const desiredOrder = [hostD, ...orderBeforeDrag.filter((host) => host !== hostD)];
    await waitFor(() => expect(hostIds([...grid.children])).toEqual(hostIds(desiredOrder)));
    desiredOrder.forEach((host, index) => {
      expect(grid.children.item(index)).toBe(host);
      expect(host.querySelector(".monaco-note-editor")).toBe(originalEditors.get(host));
    });
  });
});
