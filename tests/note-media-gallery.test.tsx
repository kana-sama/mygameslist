import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-18T09:00:00.000Z";
const ASSET_IDS = ["a", "b", "c", "d"].map((value) => value.repeat(64));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function game(): Game {
  return { id: GAME_ID, title: "Metroid", coverAssetId: null, platforms: ["NES"], tags: [], status: "playing", placement: { tierId: "a", rank: 1024 }, reviewMarkdown: "", createdAt: NOW, updatedAt: NOW };
}

function assets(): Record<string, Asset> {
  return Object.fromEntries(ASSET_IDS.map((id, index) => [id, { id, kind: "image", mime: "image/webp", width: index === 0 ? 1200 : 800, height: index === 0 ? 900 : 1200, byteLength: 100 + index, alt: `Фото ${index + 1}`, originalName: `photo-${index + 1}.webp` }]));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("note media gallery", () => {
  it("groups consecutive media in the same four-item collage in view and editor", async () => {
    const user = userEvent.setup();
    const note: Note = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Комплект игры",
      attachments: ASSET_IDS.map((assetId, index) => ({ type: "image" as const, assetId, alt: `Фото ${index + 1}` })),
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(<GamePage assets={assets()} game={game()} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={(id) => `https://example.com/${id}.webp`} />);

    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const gallery = within(card).getByRole("group", { name: "Галерея из 4 медиа" });
    expect(gallery).toHaveClass("note-media-gallery--count-4");
    expect(gallery.querySelectorAll(":scope > .note-attachment-shell--image")).toHaveLength(4);
    expect(Array.from(card.querySelector<HTMLElement>(".note-card__surface")!.children).map((child) => child.className)).toEqual(["note-attachments", "note-card__text"]);

    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));

    const editor = screen.getByRole("textbox", { name: "Текст заметки" }).closest<HTMLElement>("article")!;
    const editorGallery = within(editor).getByRole("group", { name: "Галерея из 4 медиа" });
    expect(editorGallery).toHaveClass("note-media-gallery--count-4");
    expect(within(editorGallery).getAllByRole("button", { name: /Удалить изображение/ })).toHaveLength(4);
  });

  it("defines compact templates for three, four, and larger media runs", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toMatch(/\.note-media-gallery--count-3 > \.note-attachment-shell:first-child \{ grid-row: 1 \/ -1; \}/);
    expect(styles).toMatch(/\.note-media-gallery--count-4 > \.note-attachment-shell:first-child \{ grid-column: 1 \/ -1; \}/);
    expect(styles).toMatch(/\.note-media-gallery--count-5 \{ height: auto; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); grid-auto-rows: 128px; \}/);
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.note-media-gallery \{ height: 220px; \}/);
  });
});
