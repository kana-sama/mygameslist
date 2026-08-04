import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "../src/components/Markdown";
import type { Asset, Game, Note } from "../src/domain/types";
import { GamePage } from "../src/pages/GamePage";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-17T10:00:00.000Z";
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

  it("groups top-level checklist headings inside note viewports and keeps their controls focusable", () => {
    const note = makeNote(
      "22222222-2222-4222-8222-222222222222",
      [
        "# First sticky heading with a deliberately much longer title than the short second heading",
        "- [x] Root task",
        "## Nested progress heading",
        "- [ ] Nested task",
        "# Plain heading",
        "No checklist in this section.",
        "# Second sticky heading",
        "- [ ] Second task",
      ].join("\n"),
      1024,
    );

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

      const first = screen.getByRole("heading", { name: /^First sticky heading with a deliberately much longer title / });
      const nested = screen.getByRole("heading", { name: /^Nested progress heading / });
      const plain = screen.getByRole("heading", { name: "Plain heading" });
      const second = screen.getByRole("heading", { name: /^Second sticky heading / });
      const firstSection = first.closest<HTMLElement>(".markdown-section");
      const plainSection = plain.closest<HTMLElement>(".markdown-section");
      const secondSection = second.closest<HTMLElement>(".markdown-section");
      const markdown = first.closest<HTMLElement>(".markdown");
    expect(firstSection).not.toBeNull();
    expect(plainSection).not.toBeNull();
    expect(secondSection).not.toBeNull();
    expect(firstSection).not.toBe(plainSection);
    expect(plainSection).not.toBe(secondSection);
    expect(firstSection).toContainElement(nested);
    expect(firstSection).toContainElement(screen.getByText("Root task"));
    expect(firstSection).toContainElement(screen.getByText("Nested task"));
    expect(plainSection).toContainElement(screen.getByText("No checklist in this section."));
    expect(secondSection).toContainElement(screen.getByText("Second task"));
    expect(Array.from(markdown?.children ?? [])).toEqual([firstSection, plainSection, secondSection]);
    expect(first.tagName).toBe("H2");
    expect(nested.tagName).toBe("H3");

    const toggle = within(first).getByRole("button", { name: /^First sticky heading with a deliberately much longer title / });
    toggle.focus();
    expect(toggle).toHaveFocus();

  });

  it("renders top-level checklist headings outside note viewports", () => {
    render(<MarkdownView markdown={"# Detached progress heading\n- [ ] Detached task"} />);

    const heading = screen.getByRole("heading", { name: /^Detached progress heading / });
    expect(heading.closest(".note-card__viewport")).toBeNull();
    expect(heading.tagName).toBe("H2");
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

  it("toggles and saves double height and double width from the editor footer", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const note = makeNote("22222222-2222-4222-8222-222222222222", "Resizable note", 1024);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);
    const viewCard = screen.getByText("Resizable note").closest<HTMLElement>("article")!;
    await user.click(within(viewCard).getByRole("button", { name: "Редактировать заметку" }));

    const heightButton = screen.getByRole("button", { name: "Двойная высота заметки" });
    const widthButton = screen.getByRole("button", { name: "Двойная ширина заметки" });
    expect(heightButton).toHaveAttribute("aria-pressed", "false");
    expect(widthButton).toHaveAttribute("aria-pressed", "false");

    await user.click(heightButton);
    await user.click(widthButton);
    const editorCard = screen.getByRole("textbox", { name: "Текст заметки" }).closest<HTMLElement>("article")!;
    expect(heightButton).toHaveAttribute("aria-pressed", "true");
    expect(widthButton).toHaveAttribute("aria-pressed", "true");
    expect(editorCard).toHaveClass("note-card--double-height", "note-card--double-width");
    expect(editorCard).toHaveAttribute("data-shelf-column-span", "2");

    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0]).toMatchObject({ doubleHeight: true, doubleWidth: true });
  });

  it("restores saved note sizes in view and lets the editor turn them off", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const note: Note = { ...makeNote("22222222-2222-4222-8222-222222222222", "Saved size", 1024), doubleHeight: true, doubleWidth: true };

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);
    const viewCard = screen.getByText("Saved size").closest<HTMLElement>("article")!;
    expect(viewCard).toHaveClass("note-card--double-height", "note-card--double-width");
    expect(viewCard).toHaveAttribute("data-shelf-column-span", "2");

    await user.click(within(viewCard).getByRole("button", { name: "Редактировать заметку" }));
    const heightButton = screen.getByRole("button", { name: "Двойная высота заметки" });
    const widthButton = screen.getByRole("button", { name: "Двойная ширина заметки" });
    expect(heightButton).toHaveAttribute("aria-pressed", "true");
    expect(widthButton).toHaveAttribute("aria-pressed", "true");

    await user.click(heightButton);
    await user.click(widthButton);
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0]).not.toHaveProperty("doubleHeight");
    expect(onSave.mock.calls[0][0].notes[0]).not.toHaveProperty("doubleWidth");
  });

  it("keeps attachments, the Monaco editor, and the footer in flow order", async () => {
    const user = userEvent.setup();
    const note: Note = {
      ...makeNote("22222222-2222-4222-8222-222222222222", "Long note", 1024),
      attachments: [{ type: "link", url: "https://example.com/guide", label: "Guide" }],
    };
    const flowOrder = (card: HTMLElement) => Array.from(card.children)
      .filter((child) => child.matches(".note-attachments, .monaco-note-editor, .note-editor-actions"))
      .map((child) => child.classList.contains("note-attachments")
        ? "attachments"
        : child.classList.contains("note-editor-actions")
          ? "footer"
          : "editor");

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);
    let card = screen.getByText("Long note").closest<HTMLElement>("article")!;
    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    card = screen.getByRole("textbox", { name: "Текст заметки" }).closest<HTMLElement>("article")!;
    expect(flowOrder(card)).toEqual(["attachments", "editor", "footer"]);
  });
});
