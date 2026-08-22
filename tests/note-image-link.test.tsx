import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Asset, Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "a".repeat(64);
const NOW = "2026-07-17T06:00:00.000Z";
const IMAGE_URL = "https://example.com/map.webp";

const game: Game = { id: GAME_ID, title: "DuckTales", coverAssetId: null, platforms: ["NES"], tags: [], status: "playing", placement: { tierId: "a", rank: 1024 }, reviewMarkdown: "", createdAt: NOW, updatedAt: NOW };
const note: Note = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "", attachments: [{ type: "image", assetId: ASSET_ID, alt: "Карта уровня" }], rank: 1024, createdAt: NOW, updatedAt: NOW };
const asset: Asset = { id: ASSET_ID, kind: "image", mime: "image/webp", width: 1280, height: 720, byteLength: 100, alt: "Карта уровня", originalName: "map.webp" };

describe("note image links", () => {
  it("opens the original image in a new tab without activating a note or dialog", () => {
    const onSave = vi.fn();
    render(<GamePage assets={{ [ASSET_ID]: asset }} game={game} mode="game" notes={[note]} onSave={onSave} resolveAssetUrl={() => IMAGE_URL} />);

    const link = screen.getByRole("link", { name: "Открыть изображение «Карта уровня» в новой вкладке" });
    const card = link.closest("article")!;
    expect(link).toHaveAttribute("href", IMAGE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(link).not.toHaveAttribute("aria-haspopup");
    expect(within(link).getByRole("img", { name: "Карта уровня" })).toHaveAttribute("width", "1280");
    expect(card).toHaveClass("note-card--media-only");

    link.setAttribute("href", "#image-link-test");
    link.removeAttribute("target");
    fireEvent.click(link);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps image editing and removal available without restoring a lightbox", async () => {
    const user = userEvent.setup();
    render(<GamePage assets={{ [ASSET_ID]: asset }} game={game} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => IMAGE_URL} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;

    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));

    expect(await screen.findByRole("textbox", { name: "Текст заметки" })).toBeInTheDocument();
    const editingCard = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    expect(within(editingCard).getByRole("link", { name: "Открыть изображение «Карта уровня» в новой вкладке" })).toHaveAttribute("href", IMAGE_URL);
    await user.click(within(editingCard).getByRole("button", { name: "Удалить изображение" }));
    expect(within(editingCard).queryByRole("link", { name: "Открыть изображение «Карта уровня» в новой вкладке" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
