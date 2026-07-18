import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-17T10:00:00.000Z";
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("scrollable long note cards", () => {
  it("caps the text viewport and removes every expand/collapse layout state", () => {
    const frame = /\.note-card__viewport-frame\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    const viewport = /\.note-card__viewport\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";

    expect(frame).toContain("position: relative");
    expect(frame).toContain("max-height: 300px");
    expect(viewport).toContain("max-height: 300px");
    expect(viewport).toContain("overflow-y: auto");
    expect(viewport).toContain("overscroll-behavior: contain");
    expect(viewport).toContain("scrollbar-width: thin");
    expect(styles).toMatch(/\.note-card__viewport-frame::after\s*\{[^}]*content:\s*"Прокрутить ↓"/);
    expect(styles).toMatch(/\.note-card__viewport-frame\.can-scroll-up::before, \.note-card__viewport-frame\.can-scroll-down::after\s*\{[^}]*opacity:\s*1/);
    expect(styles).not.toContain("note-card__collapse-toggle");
    expect(styles).not.toContain("note-card--collapsed");
    expect(styles).not.toContain("note-card--expanded");
  });

  it("renders long and short text through the same stable scroll viewport", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      if (!this.classList.contains("note-card__viewport")) return 0;
      return this.textContent?.includes("Long note") ? 420 : 120;
    });
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("note-card__viewport") ? 300 : 0;
    });
    const notes = [
      makeNote("22222222-2222-4222-8222-222222222222", `Long note\n\n${"Long line\n\n".repeat(80)}`, 1024),
      makeNote("33333333-3333-4333-8333-333333333333", "Short note", 2048),
    ];

    render(<GamePage assets={{}} game={game} mode="game" notes={notes} onSave={vi.fn()} />);

    const longCard = screen.getByText("Long note").closest<HTMLElement>("article")!;
    const shortCard = screen.getByText("Short note").closest<HTMLElement>("article")!;
    const longViewport = longCard.querySelector<HTMLElement>(".note-card__viewport")!;
    const longFrame = longViewport.parentElement!;
    const shortFrame = shortCard.querySelector<HTMLElement>(".note-card__viewport-frame")!;
    const originalClassName = longCard.className;
    const originalGridRows = longCard.style.gridRowEnd;
    expect(longFrame).toHaveClass("is-scrollable", "can-scroll-down");
    expect(longFrame).not.toHaveClass("can-scroll-up");
    expect(shortFrame).not.toHaveClass("is-scrollable", "can-scroll-up", "can-scroll-down");
    expect(longViewport).not.toHaveAttribute("inert");
    expect(shortCard.querySelector(".note-card__viewport")).not.toHaveAttribute("inert");
    expect(screen.queryByRole("button", { name: "Развернуть заметку" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Свернуть заметку" })).not.toBeInTheDocument();

    longViewport.scrollTop = 120;
    fireEvent.scroll(longViewport);
    expect(longFrame).toHaveClass("is-scrollable", "can-scroll-up");
    expect(longFrame).not.toHaveClass("can-scroll-down");
    await user.click(screen.getByText("Long note"));

    expect(screen.getByText("Long note").closest("article")).toBe(longCard);
    expect(longCard).toHaveClass(...originalClassName.split(" "));
    expect(longCard.style.gridRowEnd).toBe(originalGridRows);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("keeps attachments above and outside the scrolling text area", async () => {
    const user = userEvent.setup();
    const assetId = "a".repeat(64);
    const asset: Asset = { id: assetId, kind: "image", mime: "image/webp", width: 720, height: 1280, byteLength: 100, alt: "Tall map", originalName: "map.webp" };
    const note: Note = {
      ...makeNote("22222222-2222-4222-8222-222222222222", `Long text\n\n${"Tail\n\n".repeat(80)}`, 1024),
      attachments: [{ type: "image", assetId, alt: "Tall map" }],
    };

    render(<GamePage assets={{ [assetId]: asset }} game={game} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => "/media/map.webp"} />);

    const card = screen.getByText("Long text").closest<HTMLElement>("article")!;
    const surface = card.querySelector<HTMLElement>(".note-card__surface")!;
    const attachment = within(card).getByRole("button", { name: "Открыть изображение «Tall map»" });
    expect(Array.from(surface.children).map((child) => child.className)).toEqual(["note-attachments", "note-card__text"]);
    expect(attachment.closest(".note-card__viewport")).toBeNull();

    await user.click(attachment);
    expect(screen.getByRole("dialog", { name: "Просмотр изображения: Tall map" })).toBeInTheDocument();
  });

  it("keeps task controls focusable and clickable inside the scroll viewport", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const note = makeNote("22222222-2222-4222-8222-222222222222", `Long introduction\n\n${"Tail\n\n".repeat(80)}- [ ] Final task`, 1024);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    const card = screen.getByText("Long introduction").closest<HTMLElement>("article")!;
    const checkbox = within(card).getByRole("checkbox", { name: "Отметить: Final task" });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    expect(checkbox.closest(".note-card__viewport")).not.toBeNull();
    await user.click(checkbox);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toContain("- [x] Final task");
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("opens inline editing only from the note footer", async () => {
    const user = userEvent.setup();
    const note = makeNote("22222222-2222-4222-8222-222222222222", "Long note", 1024);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);
    await user.click(screen.getByText("Long note"));
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    const card = screen.getByText("Long note").closest<HTMLElement>("article")!;
    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));

    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(editor).toHaveValue("Long note");
    expect(editor.closest("article")).toHaveClass("note-card--editing");
    expect(screen.queryByRole("button", { name: "Развернуть заметку" })).not.toBeInTheDocument();
  });
});
