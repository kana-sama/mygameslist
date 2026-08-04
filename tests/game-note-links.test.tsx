import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Note } from "../src/domain";
import { GamePage, type EditableNote, type GameSaveInput } from "../src/pages/GamePage";
import { emitMonacoMarkdownChange } from "./mocks/MonacoMarkdownEditorMock";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

const CURRENT_GAME_ID = "11111111-1111-4111-8111-111111111111";
const ZELDA_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-21T10:00:00.000Z";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: CURRENT_GAME_ID,
    title: "DuckTales",
    coverAssetId: null,
    platforms: ["NES"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const currentGame = game();
const zelda = game({ id: ZELDA_ID, title: "Zelda", placement: { tierId: "s", rank: 1024 } });
const existingNote: Note = {
  id: NOTE_ID,
  gameId: CURRENT_GAME_ID,
  bodyMarkdown: "Сравнить",
  attachments: [],
  rank: 1024,
  createdAt: NOW,
  updatedAt: NOW,
};

function storedNote(draft: EditableNote): Note {
  return {
    id: draft.id ?? draft.clientId,
    gameId: CURRENT_GAME_ID,
    bodyMarkdown: draft.bodyMarkdown,
    attachments: draft.attachments as Note["attachments"],
    ...(draft.groupRank === undefined ? {} : { groupRank: draft.groupRank }),
    rank: draft.rank,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ExistingNoteHarness({ note = existingNote, onSave }: { note?: Note; onSave: (input: GameSaveInput) => void }) {
  const [notes, setNotes] = useState<Note[]>([note]);
  return (
    <GamePage
      assets={{}}
      game={currentGame}
      gameSuggestions={[currentGame, zelda]}
      mode="game"
      notes={notes}
      onSave={(input) => {
        onSave(input);
        setNotes(input.notes.map(storedNote));
      }}
    />
  );
}

describe("game links in notes", () => {
  it("renders an existing note with its stable Monaco model and persists a rendered game link", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<ExistingNoteHarness onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const root = editor.closest(".monaco-note-editor");
    expect(root).toHaveAttribute("data-model-key", `note:${NOTE_ID}`);

    const expectedMarkdown = `Сравнить [Zelda](#/games/${ZELDA_ID})`;
    act(() => {
      fireEvent.change(editor, { target: { value: expectedMarkdown } });
      fireEvent.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe(expectedMarkdown);

    const link = await screen.findByRole("link", { name: "Zelda" });
    expect(link).toHaveAttribute("href", `#/games/${ZELDA_ID}`);
  });

  it("keeps the latest body when file processing starts before the parent rerenders", async () => {
    const user = userEvent.setup();
    render(
      <GamePage
        assets={{}}
        canAddBlob={() => "Файл не помещается"}
        game={currentGame}
        mode="game"
        notes={[existingNote]}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const latestBody = "Последняя версия перед файлом";
    const file = new File(["guide"], "guide.pdf", { type: "application/pdf" });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [file], items: [], types: ["Files"] },
    });

    act(() => {
      emitMonacoMarkdownChange(`note:${NOTE_ID}`, latestBody);
      editor.dispatchEvent(drop);
    });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Файл не помещается"));
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue(latestBody);
  });

  it("keeps new-game note models distinct while persisting controlled Markdown", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} gameSuggestions={[zelda]} mode="new" notes={[]} onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "Название *" }), "Новая игра");
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    await user.click(screen.getByRole("button", { name: "Добавить заметку в группу 1" }));
    const editors = await screen.findAllByRole("textbox", { name: "Текст заметки" });
    const modelKeys = editors.map((editor) => editor.closest(".monaco-note-editor")?.getAttribute("data-model-key"));
    expect(new Set(modelKeys).size).toBe(2);
    expect(modelKeys.every((key) => key?.startsWith("note:"))).toBe(true);

    const expectedMarkdown = `[Zelda](#/games/${ZELDA_ID})`;
    fireEvent.change(editors[0], { target: { value: expectedMarkdown } });
    const firstCard = editors[0].closest("article")!;
    await user.click(within(firstCard).getByRole("button", { name: "Двойная высота заметки" }));
    fireEvent.drop(editors[0], { dataTransfer: { files: [new File(["guide"], "guide.pdf", { type: "application/pdf" })], items: [], types: ["Files"] } });
    expect(await within(firstCard).findByRole("link", { name: /guide\.pdf/ })).toBeInTheDocument();
    await user.click(within(firstCard).getByRole("button", { name: "Переместить заметку ниже" }));

    const updatedEditors = screen.getAllByRole("textbox", { name: "Текст заметки" });
    expect(updatedEditors.find((editor) => (editor as HTMLTextAreaElement).value === expectedMarkdown)?.closest(".monaco-note-editor")).toHaveAttribute("data-model-key", modelKeys[0]);
    expect(updatedEditors.find((editor) => (editor as HTMLTextAreaElement).value === "")?.closest(".monaco-note-editor")).toHaveAttribute("data-model-key", modelKeys[1]);
    expect(within(firstCard).queryByRole("button", { name: "Сохранить заметку" })).not.toBeInTheDocument();
    expect(within(firstCard).queryByRole("button", { name: "Отменить редактирование" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes).toHaveLength(2);
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe(expectedMarkdown);
  });
});
