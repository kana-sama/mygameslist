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
  type EditableNote,
  type GameSaveInput,
} from "../src/pages/GamePage";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    expect(nextEmptyNoteGroupRank(notes)).toBe(4096);
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
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toHaveAttribute("data-note-group-rank", "2048");

    await user.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toHaveAttribute("data-note-group-rank", "1024");
  });

  it("renders each persisted group as an independent shelf", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={vi.fn()} />);

    const groups = document.querySelectorAll(".note-group");
    expect(groups).toHaveLength(2);
    expect(document.querySelectorAll(".notes-list")).toHaveLength(2);
    expect(screen.getAllByRole("group", { name: /Группа заметок/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Добавить заметку в новую группу" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Добавить заметку в группу 1" })).toHaveClass("note-group-add-button");
    expect(screen.getByRole("button", { name: "Добавить заметку в группу 2" })).toHaveClass("note-group-add-button");
    expect(groups[0]).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("group", { name: "Новая группа заметок" })).toHaveAttribute("tabindex", "-1");
  });

  it("creates a note directly inside an existing group", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024), note(NOTE_B_ID, 1024, 2048)]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Добавить заметку в группу 1" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(editor.closest(".note-group")).toHaveAttribute("data-note-group-rank", "1024");
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
    expect(notesArea.querySelectorAll(".note-group-add-button")).toHaveLength(3);

    fireEvent(secondGroup, fileDragEvent("dragenter", transfer));
    expect(firstGroup).not.toHaveClass("is-file-over");
    expect(secondGroup).toHaveClass("is-file-over");
    fireEvent(secondGroup, fileDragEvent("dragleave", transfer));
    expect(secondGroup).not.toHaveClass("is-file-over");

    fireEvent(notesArea, fileDragEvent("dragleave", transfer));
    expect(notesArea).not.toHaveClass("is-file-dragging");
  });

  it("focuses a group from touch so its absolute add button can be revealed", () => {
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Группа заметок 1" });

    fireEvent.pointerDown(group, { pointerType: "touch" });

    expect(group).toHaveFocus();
    expect(group).toHaveAttribute("tabindex", "-1");
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
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toHaveAttribute("data-note-group-rank", "2048");
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

  it("keeps a textarea file drop in the edited note instead of creating another note", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} game={game} mode="game" notes={[note(NOTE_A_ID, 1024)]} onSave={onSave} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_A_ID}"]`)!;
    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const drop = fileDragEvent("drop", fileTransfer([new File(["guide"], "guide.pdf", { type: "application/pdf" })]));

    fireEvent(editor, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(await screen.findByRole("link", { name: /guide\.pdf/ })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Текст заметки" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes).toHaveLength(1);
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ clientId: NOTE_A_ID, attachments: [expect.objectContaining({ type: "pending-file", label: "guide.pdf" })] });
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
    const empty = screen.getByRole("button", { name: "Добавить заметку в новую группу" });

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 185 } },
      { target: handle, coords: { clientX: 40, clientY: 185 } },
      { target: empty, coords: { clientX: 20, clientY: 235 } },
      { keys: "[/MouseLeft]", target: empty, coords: { clientX: 20, clientY: 235 } },
    ]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ clientId: NOTE_A_ID, groupRank: 2048, rank: 1024 });
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
    const empty = screen.getByRole("button", { name: "Добавить заметку в новую группу" });

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 185 } },
      { target: handle, coords: { clientX: 40, clientY: 185 } },
      { target: empty, coords: { clientX: 20, clientY: 235 } },
      { keys: "[/MouseLeft]", target: empty, coords: { clientX: 20, clientY: 235 } },
    ]);

    await waitFor(() => expect(screen.getByRole("group", { name: "Группа заметок 1" })).toHaveAttribute("data-note-group-rank", "2048"));
    expect(document.querySelectorAll(".note-group")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toHaveAttribute("data-note-group-rank", "3072");
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
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ groupRank: 2048, rank: 1024 });
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
    expect(document.activeElement?.closest('.note-group[data-note-group-rank="2048"]')).not.toBeNull();
  });

  it("groups draft notes with drag and drop before a new game is saved", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const rank = this.closest<HTMLElement>(".note-group")?.dataset.noteGroupRank;
      if (this.dataset.noteId) return rank === "2048" ? rect(0, 300, 360, 130) : rect(0, 100, 360, 130);
      if (this.matches('.note-group[data-note-group-rank="1024"]')) return rect(0, 100, 727, 160);
      if (this.matches('.note-group[data-note-group-rank="2048"]')) return rect(0, 300, 727, 160);
      if (this.matches(".note-editors-grid")) return rank === "2048" ? rect(0, 300, 727, 140) : rect(0, 100, 727, 140);
      if (this.matches(".note-empty-group")) return rect(0, 500, 727, 40);
      if (this.matches(".note-drag-preview")) return rect(0, 0, 360, 90);
      return rect(0, 0, 1024, 768);
    });
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    const editors = [...document.querySelectorAll<HTMLElement>(".note-editor-sortable")];
    const secondHandle = editors[1].querySelector<HTMLElement>('button[aria-label="Перетащить заметку"]')!;
    const firstGroup = document.querySelector<HTMLElement>('.note-group[data-note-group-rank="1024"]')!;

    await user.pointer([
      { keys: "[MouseLeft>]", target: secondHandle, coords: { clientX: 20, clientY: 420 } },
      { target: secondHandle, coords: { clientX: 40, clientY: 420 } },
      { target: firstGroup, coords: { clientX: 600, clientY: 220 } },
      { keys: "[/MouseLeft]", target: firstGroup, coords: { clientX: 600, clientY: 220 } },
    ]);

    await waitFor(() => expect(document.querySelectorAll(".note-group")).toHaveLength(1));
    expect(firstGroup.querySelectorAll(".note-editor-sortable")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toHaveAttribute("data-note-group-rank", "2048");
  });
});
