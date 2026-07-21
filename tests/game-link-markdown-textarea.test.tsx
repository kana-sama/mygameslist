import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findActiveGameLinkQuery,
  GameLinkMarkdownTextarea,
  getGameLinkSuggestions,
  insertGameMarkdownLink,
} from "../src/components/GameLinkMarkdownTextarea";
import type { Game } from "../src/domain/types";

const NOW = "2026-07-21T10:00:00.000Z";

function game(id: string, title: string, platforms = ["PC"], tags: string[] = []): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms,
    tags,
    status: "playing",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const marioKart = game("11111111-1111-4111-8111-111111111111", "Mario Kart", ["Switch"]);
const marioWorld = game("22222222-2222-4222-8222-222222222222", "Super Mario World", ["SNES"]);
const zelda = game("33333333-3333-4333-8333-333333333333", "The Legend of Zelda", ["NES"]);

function Harness({
  games = [marioKart, marioWorld, zelda],
  initialValue = "",
  onKeyDown,
}: {
  games?: Game[];
  initialValue?: string;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return <>
    <GameLinkMarkdownTextarea
      aria-label="Текст заметки"
      gameSuggestions={games}
      onChange={setValue}
      onKeyDown={onKeyDown}
      value={value}
    />
    <output data-testid="markdown-value">{value}</output>
  </>;
}

function placeCaret(textarea: HTMLTextAreaElement, position: number): void {
  textarea.focus();
  textarea.setSelectionRange(position, position);
  fireEvent.select(textarea);
}

afterEach(cleanup);

describe("game link Markdown helpers", () => {
  it("finds only a boundary trigger outside Markdown code and existing link destinations", () => {
    const fenced = "До\n```md\n#zel\n```\nПосле";
    const inline = "До `#zel` после";
    const existingLink = `[Zelda](#/games/${zelda.id})`;
    const afterFence = "````\ncode\n````\n#zel";
    const cases: Array<[string, number, ReturnType<typeof findActiveGameLinkQuery>]> = [
      ["#", 0, null],
      ["#", 1, { start: 0, end: 1, query: "" }],
      ["До #zel", 7, { start: 3, end: 7, query: "zel" }],
      ["До #super mario", 15, { start: 3, end: 15, query: "super mario" }],
      ["До\t#zel", 7, { start: 3, end: 7, query: "zel" }],
      ["foo#zel", 7, null],
      ["# zelda", 7, null],
      ["\\#zel", 5, null],
      [inline, inline.indexOf("#zel") + 4, null],
      [fenced, fenced.indexOf("#zel") + 4, null],
      [existingLink, existingLink.indexOf(")"), null],
      [afterFence, afterFence.length, { start: afterFence.lastIndexOf("#"), end: afterFence.length, query: "zel" }],
    ];

    for (const [markdown, caret, expected] of cases) {
      expect(findActiveGameLinkQuery(markdown, caret), `${JSON.stringify(markdown)} at ${caret}`).toEqual(expected);
    }
  });

  it("replaces only the active query with an exact encoded local Markdown link", () => {
    const source = "До #zel после";
    const target = { id: "game/id with spaces", title: "The Legend of Zelda" };

    const inserted = insertGameMarkdownLink(source, { start: 3, end: 7 }, target);

    const link = "[The Legend of Zelda](#/games/game%2Fid%20with%20spaces)";
    expect(inserted).toEqual({ markdown: `До ${link} после`, caret: 3 + link.length });
  });

  it("ranks and limits matches by title without searching platforms or tags", () => {
    const titleMatches = Array.from({ length: 10 }, (_, index) => game(`mario-${index}`, `Mario ${index + 1}`));
    const metadataOnly = game("metadata", "Zelda", ["Mario"], ["mario"]);

    const suggestions = getGameLinkSuggestions([...titleMatches, metadataOnly], "mario");

    expect(suggestions).toHaveLength(8);
    expect(suggestions.map((item) => item.title)).toEqual([
      "Mario 1", "Mario 2", "Mario 3", "Mario 4", "Mario 5", "Mario 6", "Mario 7", "Mario 8",
    ]);
    expect(suggestions).not.toContain(metadataOnly);
  });
});

describe("GameLinkMarkdownTextarea", () => {
  it("opens on #, supports a spaced query and selects a keyboard-highlighted game with Enter", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="См. " />);
    const textarea = screen.getByRole("combobox", { name: "Текст заметки" }) as HTMLTextAreaElement;
    placeCaret(textarea, textarea.value.length);

    await user.type(textarea, "#");
    expect(screen.getByRole("listbox", { name: "Подсказки игр" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);

    await user.type(textarea, "mario");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /Mario Kart/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Super Mario World/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");

    const expected = `См. [Super Mario World](#/games/${marioWorld.id})`;
    expect(screen.getByTestId("markdown-value")).toHaveTextContent(expected);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(textarea.selectionStart).toBe(expected.length);
      expect(textarea.selectionEnd).toBe(expected.length);
    });
  });

  it("selects the current suggestion with Tab without moving focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", { name: "Текст заметки" }) as HTMLTextAreaElement;
    placeCaret(textarea, 0);

    await user.type(textarea, "#zel");
    const reverseTab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true });
    fireEvent(textarea, reverseTab);
    expect(reverseTab.defaultPrevented).toBe(false);
    expect(textarea).toHaveValue("#zel");
    await user.keyboard("{Tab}");

    const expected = `[The Legend of Zelda](#/games/${zelda.id})`;
    expect(textarea).toHaveValue(expected);
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it("closes with Escape while delegating ordinary Escape, modified Enter and IME key events", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    const textarea = screen.getByRole("combobox", { name: "Текст заметки" }) as HTMLTextAreaElement;
    placeCaret(textarea, 0);
    await user.type(textarea, "#m");
    onKeyDown.mockClear();

    const close = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
    fireEvent(textarea, close);
    expect(close.defaultPrevented).toBe(true);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onKeyDown).not.toHaveBeenCalled();

    const delegatedEscape = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
    fireEvent(textarea, delegatedEscape);
    expect(delegatedEscape.defaultPrevented).toBe(false);
    expect(onKeyDown).toHaveBeenCalledOnce();

    await user.type(textarea, "a");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    onKeyDown.mockClear();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const modifiedEnter = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ...modifier });
      fireEvent(textarea, modifiedEnter);
      expect(modifiedEnter.defaultPrevented).toBe(false);
    }
    expect(onKeyDown).toHaveBeenCalledTimes(2);

    fireEvent.compositionStart(textarea);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    onKeyDown.mockClear();
    const composingArrow = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowDown" });
    Object.defineProperty(composingArrow, "isComposing", { value: true });
    fireEvent(textarea, composingArrow);
    expect(composingArrow.defaultPrevented).toBe(false);
    expect(onKeyDown).toHaveBeenCalledOnce();
    fireEvent.compositionEnd(textarea);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("keeps textarea focus when a suggestion is clicked and restores its caret", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="Играть: " />);
    const textarea = screen.getByRole("combobox", { name: "Текст заметки" }) as HTMLTextAreaElement;
    placeCaret(textarea, textarea.value.length);
    await user.type(textarea, "#zel");
    const option = screen.getByRole("option", { name: /The Legend of Zelda/ });

    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    fireEvent(option, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(textarea).toHaveFocus();
    fireEvent.click(option);

    const expected = `Играть: [The Legend of Zelda](#/games/${zelda.id})`;
    expect(textarea).toHaveValue(expected);
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(textarea.selectionStart).toBe(expected.length);
    });
  });
});
