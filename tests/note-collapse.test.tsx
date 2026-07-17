import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-17T10:00:00.000Z";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function makeNote(id: string, bodyMarkdown: string, rank: number): Note {
  return { id, gameId: GAME_ID, bodyMarkdown, attachments: [], rank, createdAt: NOW, updatedAt: NOW };
}

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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("long note cards", () => {
  it("collapses only content taller than 300px and toggles without opening the editor", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      if (!this.classList.contains("note-card__content")) return 0;
      if (this.textContent?.includes("Long note")) return 420;
      if (this.textContent?.includes("Threshold note")) return 300;
      return 120;
    });
    const notes = [
      makeNote("22222222-2222-4222-8222-222222222222", "Long note", 1024),
      makeNote("33333333-3333-4333-8333-333333333333", "Threshold note", 2048),
      makeNote("44444444-4444-4444-8444-444444444444", "Short note", 3072),
    ];

    render(<GamePage assets={{}} game={game} mode="game" notes={notes} onSave={vi.fn()} />);

    const longCard = screen.getByText("Long note").closest("article")!;
    const thresholdCard = screen.getByText("Threshold note").closest("article")!;
    const shortCard = screen.getByText("Short note").closest("article")!;
    expect(longCard).toHaveClass("note-card--collapsed");
    const expandButton = within(longCard).getByRole("button", { name: "Развернуть заметку" });
    const viewport = longCard.querySelector(".note-card__viewport")!;
    expect(expandButton).toHaveAttribute("aria-expanded", "false");
    expect(expandButton).toHaveAttribute("aria-controls", viewport.id);
    expect(viewport).toHaveAttribute("inert");
    expect(thresholdCard).not.toHaveClass("note-card--collapsed");
    expect(shortCard).not.toHaveClass("note-card--collapsed");
    expect(within(thresholdCard).queryByRole("button", { name: "Развернуть заметку" })).not.toBeInTheDocument();
    expect(within(shortCard).queryByRole("button", { name: "Развернуть заметку" })).not.toBeInTheDocument();

    await user.click(within(longCard).getByRole("button", { name: "Развернуть заметку" }));
    expect(longCard).toHaveClass("note-card--expanded");
    expect(longCard).not.toHaveClass("note-card--collapsed");
    expect(viewport).not.toHaveAttribute("inert");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();

    await user.click(within(longCard).getByRole("button", { name: "Свернуть заметку" }));
    expect(longCard).toHaveClass("note-card--collapsed");
    expect(viewport).toHaveAttribute("inert");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("keeps direct inline editing unchanged", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(420);
    const note = makeNote("22222222-2222-4222-8222-222222222222", "Long note", 1024);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);
    await user.click(screen.getByText("Long note"));

    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(editor).toHaveValue("Long note");
    expect(editor.closest("article")).toHaveClass("note-card--editing");
    expect(screen.queryByRole("button", { name: "Развернуть заметку" })).not.toBeInTheDocument();
  });

  it("keeps visible task controls clickable while a long note is collapsed", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(420);
    const note = makeNote("22222222-2222-4222-8222-222222222222", "- [ ] Visible task\n\nLong tail", 1024);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    const card = screen.getByText("Visible task").closest("article")!;
    expect(card).toHaveClass("note-card--collapsed");
    expect(card.querySelector(".note-card__viewport")).not.toHaveAttribute("inert");
    await user.click(within(card).getByRole("checkbox"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe("- [x] Visible task\n\nLong tail");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("expands for keyboard focus below the clipped viewport and toggles with Space", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(420);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("note-card__viewport")) return new DOMRect(0, 0, 360, 300);
      if (this.classList.contains("markdown-task-checkbox")) return new DOMRect(10, 340, 14, 14);
      return new DOMRect(0, 0, 360, this.classList.contains("note-card__content") ? 420 : 20);
    });
    const note = makeNote("22222222-2222-4222-8222-222222222222", "Long introduction\n\n- [ ] Hidden task", 1024);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    const card = screen.getByText("Long introduction").closest("article")!;
    const checkbox = within(card).getByRole("checkbox");
    card.focus();
    await user.tab();

    expect(checkbox).toHaveFocus();
    expect(card).toHaveClass("note-card--expanded");
    await user.keyboard("[Space]");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe("Long introduction\n\n- [x] Hidden task");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });
});
