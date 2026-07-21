import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Note } from "../src/domain";
import { GamePage, type EditableNote, type GameSaveInput } from "../src/pages/GamePage";

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

function ExistingNoteHarness({ onSave }: { onSave: (input: GameSaveInput) => void }) {
  const [notes, setNotes] = useState<Note[]>([existingNote]);
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
  it("links another game while editing an existing note and excludes the current game", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<ExistingNoteHarness onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("combobox", { name: "Текст заметки" });
    await user.type(editor, " #Zel");

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /Zelda/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: /DuckTales/ })).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    const expectedMarkdown = `Сравнить [Zelda](#/games/${ZELDA_ID})`;
    expect(editor).toHaveValue(expectedMarkdown);

    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe(expectedMarkdown);

    const link = await screen.findByRole("link", { name: "Zelda" });
    expect(link).toHaveAttribute("href", `#/games/${ZELDA_ID}`);
  });

  it("offers a game after # and inserts its link into a new-game note", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    render(<GamePage assets={{}} gameSuggestions={[zelda]} mode="new" notes={[]} onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "Название *" }), "Новая игра");
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
    const editor = await screen.findByRole("combobox", { name: "Текст заметки" });
    await user.type(editor, "#");

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /Zelda/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");

    const expectedMarkdown = `[Zelda](#/games/${ZELDA_ID})`;
    expect(editor).toHaveValue(expectedMarkdown);

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes).toHaveLength(1);
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe(expectedMarkdown);
  });
});
