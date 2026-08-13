import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Note } from "../src/domain/types";
import { GamePage, type GameSaveInput } from "../src/pages/GamePage";

const { widthReports } = vi.hoisted(() => ({
  widthReports: new Map<string, (width: number) => void>(),
}));

vi.mock("../src/components/MonacoNoteEditor", () => ({
  MonacoNoteEditor: (props: {
    modelKey: string;
    onRequiredTableWidthChange?(width: number): void;
  }) => {
    useEffect(() => {
      if (props.onRequiredTableWidthChange) {
        widthReports.set(props.modelKey, props.onRequiredTableWidthChange);
      }
      return () => { widthReports.delete(props.modelKey); };
    }, [props.modelKey, props.onRequiredTableWidthChange]);
    return <textarea aria-label="Текст заметки" />;
  },
}));

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-17T10:00:00.000Z";

const game: Game = {
  id: GAME_ID,
  title: "Synthetic game",
  coverAssetId: null,
  platforms: [],
  tags: [],
  status: "playing",
  placement: { tierId: "unranked", rank: 1024 },
  reviewMarkdown: "",
  createdAt: NOW,
  updatedAt: NOW,
};

function makeNote(id: string, bodyMarkdown: string, rank: number, overrides: Partial<Note> = {}): Note {
  return { id, gameId: GAME_ID, bodyMarkdown, attachments: [], rank, createdAt: NOW, updatedAt: NOW, ...overrides };
}

beforeEach(() => {
  widthReports.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("note editor automatic table width", () => {
  it("publishes a monotonic transient width without changing saved doubleWidth", async () => {
    const user = userEvent.setup();
    const note = makeNote(NOTE_ID, "| A | B |\n| --- | --- |\n| x | y |", 1024);
    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

    const readCard = screen.getByText("x").closest<HTMLElement>("article")!;
    await user.click(within(readCard).getByRole("button", { name: "Редактировать заметку" }));
    const editingCard = (await screen.findByRole("textbox", { name: "Текст заметки" }))
      .closest<HTMLElement>("article")!;
    act(() => widthReports.get(`note:${NOTE_ID}`)?.(730));
    act(() => widthReports.get(`note:${NOTE_ID}`)?.(360));

    expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
    expect(editingCard).toHaveAttribute("data-shelf-column-span", "1");
    const widthButton = within(editingCard).getByRole("button", { name: "Двойная ширина заметки" });
    expect(widthButton).toHaveAttribute("aria-pressed", "false");
    await user.click(widthButton);
    expect(editingCard).toHaveAttribute("data-shelf-column-span", "2");
    expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
    await user.click(widthButton);
    expect(editingCard).toHaveAttribute("data-shelf-column-span", "1");
    expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");

    await user.click(within(editingCard).getByRole("button", { name: "Отменить редактирование" }));
    expect(document.querySelector("[data-shelf-required-width]")).toBeNull();

    const restoredReadCard = screen.getByText("x").closest<HTMLElement>("article")!;
    await user.click(within(restoredReadCard).getByRole("button", { name: "Редактировать заметку" }));
    const freshEditingCard = (await screen.findByRole("textbox", { name: "Текст заметки" }))
      .closest<HTMLElement>("article")!;
    expect(freshEditingCard).not.toHaveAttribute("data-shelf-required-width");
  });

  it("keeps a prose-only note at its saved span after a zero report", async () => {
    const user = userEvent.setup();
    const note = makeNote(NOTE_ID, "Prose only", 1024, { doubleWidth: true });
    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

    const readCard = screen.getByText("Prose only").closest<HTMLElement>("article")!;
    await user.click(within(readCard).getByRole("button", { name: "Редактировать заметку" }));
    const editingCard = (await screen.findByRole("textbox", { name: "Текст заметки" }))
      .closest<HTMLElement>("article")!;
    act(() => widthReports.get(`note:${NOTE_ID}`)?.(0));

    expect(editingCard).not.toHaveAttribute("data-shelf-required-width");
    expect(editingCard).toHaveAttribute("data-shelf-column-span", "2");
    expect(within(editingCard).getByRole("button", { name: "Двойная ширина заметки" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("publishes demand inside a persistent draft host without replacing editor nodes", async () => {
    const user = userEvent.setup();
    render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));

    const textbox = await screen.findByRole("textbox", { name: "Текст заметки" });
    const editingCard = textbox.closest<HTMLElement>("article")!;
    const host = editingCard.closest<HTMLElement>(".note-editor-sortable")!;
    const modelKey = [...widthReports.keys()].find((key) => key.startsWith("note:"))!;
    act(() => widthReports.get(modelKey)?.(730));

    expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
    expect(editingCard.closest(".note-editor-sortable")).toBe(host);
    expect(await screen.findByRole("textbox", { name: "Текст заметки" })).toBe(textbox);
  });

  it("clears automatic demand on save without persisting it as manual width", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note = makeNote(NOTE_ID, "Save me", 1024);
    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    const readCard = screen.getByText("Save me").closest<HTMLElement>("article")!;
    await user.click(within(readCard).getByRole("button", { name: "Редактировать заметку" }));
    const editingCard = (await screen.findByRole("textbox", { name: "Текст заметки" }))
      .closest<HTMLElement>("article")!;
    act(() => widthReports.get(`note:${NOTE_ID}`)?.(730));
    expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");

    await user.click(within(editingCard).getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0]).not.toHaveProperty("doubleWidth");
    const savedReadCard = screen.getByText("Save me").closest<HTMLElement>("article")!;
    expect(savedReadCard).not.toBe(readCard);
    expect(savedReadCard).toBeInTheDocument();
    expect(savedReadCard).not.toHaveAttribute("data-shelf-required-width");
    expect(savedReadCard).toHaveAttribute("data-shelf-column-span", "1");
  });
});
