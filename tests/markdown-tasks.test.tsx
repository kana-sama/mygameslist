import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasMarkdownTasks, MarkdownView, setMarkdownTaskChecked } from "../src/components/Markdown";
import type { Game, Note } from "../src/domain/types";
import { GamePage, type GameSaveInput } from "../src/pages/GamePage";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-17T10:00:00.000Z";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
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

function makeNote(bodyMarkdown: string): Note {
  return {
    id: NOTE_ID,
    gameId: GAME_ID,
    bodyMarkdown,
    attachments: [{ type: "link", url: "https://example.com/guide", label: "Guide" }],
    rank: 2048,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Markdown task lists", () => {
  it("renders GFM-style tasks alongside ordinary list items and ignores lookalikes", async () => {
    const user = userEvent.setup();
    const onTaskChange = vi.fn();
    const markdown = [
      "- Ordinary item",
      "- [ ] Open **task**",
      "* [x] Done [guide](https://example.com/guide)",
      "+ [X] Uppercase marker",
      "- [y] Not a task",
      "- [ ]missing separator",
      "```",
      "- [ ] Inside code",
      "```",
    ].join("\n");

    render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
    expect(screen.getByText("task").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "guide" })).toHaveAttribute("href", "https://example.com/guide");
    expect(screen.getByText("[y] Not a task")).toBeInTheDocument();
    expect(screen.getByText("[ ]missing separator")).toBeInTheDocument();
    expect(screen.getByText("- [ ] Inside code").closest("pre")).toBeInTheDocument();
    expect(hasMarkdownTasks(markdown)).toBe(true);
    expect(hasMarkdownTasks("```\n- [ ] Inside code\n```")).toBe(false);

    await user.click(checkboxes[0].closest("label")!);
    expect(onTaskChange).toHaveBeenCalledWith(markdown.replace("- [ ] Open", "- [x] Open"));
  });

  it("changes only the selected physical line and preserves line endings", () => {
    const markdown = "Heading\r\n- [ ] Duplicate\r\n- [ ] Duplicate\n+ [X]\tThird\rLast";

    expect(setMarkdownTaskChecked(markdown, 2, true)).toBe(
      "Heading\r\n- [ ] Duplicate\r\n- [x] Duplicate\n+ [X]\tThird\rLast",
    );
    expect(setMarkdownTaskChecked(markdown, 3, false)).toBe(
      "Heading\r\n- [ ] Duplicate\r\n- [ ] Duplicate\n+ [ ]\tThird\rLast",
    );
    expect(setMarkdownTaskChecked(markdown, 0, true)).toBe(markdown);
    expect(setMarkdownTaskChecked(markdown, 99, true)).toBe(markdown);
  });

  it("preserves nested unordered and ordered list structure", () => {
    const markdown = [
      "- [x] **Yoshi's Island**",
      "  - [x] Yoshi's House",
      "  - [ ] Yellow Switch Palace",
      "- [ ] Donut Plains",
      "  1. Secret exit",
      "  2. Bonus room",
    ].join("\n");

    render(<MarkdownView markdown={markdown} onTaskChange={vi.fn()} />);

    const parentItem = screen.getByText("Yoshi's Island").closest("li");
    const nestedTaskItem = screen.getByText("Yellow Switch Palace").closest("li");
    const secondParentItem = screen.getByText("Donut Plains").closest("li");
    const nestedOrderedItem = screen.getByText("Secret exit").closest("li");

    expect(parentItem).not.toBeNull();
    expect(nestedTaskItem?.closest("ul")?.parentElement).toBe(parentItem);
    expect(nestedTaskItem?.closest("ul")).not.toBe(parentItem?.closest("ul"));
    expect(nestedOrderedItem?.closest("ol")?.parentElement).toBe(secondParentItem);
  });

  it("toggles the selected nested task without changing its parent or indentation", async () => {
    const user = userEvent.setup();
    const onTaskChange = vi.fn();
    const markdown = [
      "- [ ] Parent",
      "  - [ ] First child",
      "    - [ ] Grandchild",
      "  - [ ] Second child",
    ].join("\n");

    render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Grandchild" }));

    expect(onTaskChange).toHaveBeenCalledWith([
      "- [ ] Parent",
      "  - [ ] First child",
      "    - [x] Grandchild",
      "  - [ ] Second child",
    ].join("\n"));
  });

  it("saves a clicked task without opening the note editor or changing note metadata", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note = makeNote("- [ ] Duplicate\n- [ ] Duplicate");

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    await user.click(screen.getAllByRole("checkbox")[1]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const savedNote = onSave.mock.calls[0][0].notes[0];
    expect(savedNote).toEqual({
      id: NOTE_ID,
      clientId: NOTE_ID,
      bodyMarkdown: "- [ ] Duplicate\n- [x] Duplicate",
      attachments: note.attachments,
      rank: note.rank,
    });
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("keeps the controlled checkbox unchanged when saving fails", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>().mockRejectedValue(new Error("Storage failed"));

    render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote("- [ ] Retry later")]} onSave={onSave} />);

    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage failed");
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("does not start concurrent saves from rapid task clicks", async () => {
    const user = userEvent.setup();
    let finishSave: (() => void) | undefined;
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>(() => new Promise((resolve) => { finishSave = resolve; }));

    render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote("- [ ] First\n- [ ] Second")]} onSave={onSave} />);

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    expect(checkboxes[1]).toBeDisabled();
    await user.click(checkboxes[1]);
    expect(onSave).toHaveBeenCalledTimes(1);
    finishSave?.();
    await waitFor(() => expect(checkboxes[1]).not.toBeDisabled());
  });

  it("lets the storage layer decide whether a task toggle fits", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();

    render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote("- [ ] Existing task")]} onSave={onSave} storageLocked />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    await user.click(checkbox);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});
