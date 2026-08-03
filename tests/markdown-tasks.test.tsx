import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasMarkdownTasks, insertMarkdownOpenChecklistItem, MarkdownView, setMarkdownTaskChecked, setMarkdownTaskItemText } from "../src/components/Markdown";
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

describe("Markdown tasks", () => {
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

  it("renders and toggles ordered checklist items", async () => {
    const user = userEvent.setup();
    const onTaskChange = vi.fn();
    const markdown = "1. [ ] First step\n2. [x] Finished step";

    render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    await user.click(screen.getByRole("checkbox", { name: "Отметить: First step" }));
    expect(onTaskChange).toHaveBeenCalledWith("1. [x] First step\n2. [x] Finished step");
    expect(hasMarkdownTasks(markdown)).toBe(true);
  });

  it("keeps loose and continued child lists under their parent item", () => {
    const markdown = [
      "- Loose parent",
      "",
      "  - Child after a blank line",
      "- Continued parent",
      "  continuation text",
      "  1. Ordered child",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const looseParent = screen.getByText("Loose parent").closest("li");
    const looseChild = screen.getByText("Child after a blank line").closest("li");
    const continuedParent = screen.getByText(/Continued parent/).closest("li");
    const orderedChild = screen.getByText("Ordered child").closest("li");

    expect(looseChild?.closest("ul")?.parentElement).toBe(looseParent);
    expect(continuedParent).toHaveTextContent("Continued parent continuation text");
    expect(orderedChild?.closest("ol")?.parentElement).toBe(continuedParent);
  });

  it("treats a one-space list marker as a sibling rather than a child", () => {
    render(<MarkdownView markdown={"- First\n - Second"} />);

    const first = screen.getByText("First").closest("li");
    const second = screen.getByText("Second").closest("li");

    expect(first?.parentElement).toBe(second?.parentElement);
    expect(second?.closest("ul")?.parentElement).toHaveClass("markdown");
  });

  it("renders arbitrary GFM tables with inline content, alignment, and escaped pipes", () => {
    const markdown = [
      "Introduction without a separating blank line.",
      "**Name** | [ ] Reference | Code",
      ":--- | :---: | ---:",
      "A \\| B | [Guide](https://example.com/guide) | `x|y`",
      "## After | the table",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const table = screen.getByRole("table");
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    const referenceHeader = screen.getByRole("columnheader", { name: "[ ] Reference" });
    const codeHeader = screen.getByRole("columnheader", { name: "Code" });

    expect(nameHeader.querySelector("strong")).toHaveTextContent("Name");
    expect(referenceHeader).not.toHaveClass("markdown-table-cell--center");
    expect(codeHeader).not.toHaveClass("markdown-table-cell--right");
    expect(screen.getByText("A | B").closest("table")).toBe(table);
    expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute("href", "https://example.com/guide");
    expect(screen.getByRole("link", { name: "Guide" }).closest("td")).toHaveClass("markdown-table-cell--center");
    expect(screen.getByText("x|y").closest("code")?.closest("td")).toHaveClass("markdown-table-cell--right");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After | the table" })).toBeInTheDocument();
  });

  it("toggles table tasks, includes them in heading progress, and completes fully checked rows", async () => {
    const user = userEvent.setup();
    const onTaskChange = vi.fn();
    const markdown = [
      "# Campaign",
      "## Route",
      "- [x] Route unlocked",
      "Context before the table.",
      "| Stage | Main | Secret |",
      "| --- | :---: | :---: |",
      "| Start | [x] Main start | [x] Secret start |",
      "| Finish \\| End | [x] Main finish | [ ] Secret finish |",
      "| Notes | plain | text |",
    ].join("\r\n");
    const completedMarkdown = markdown.replace(
      "| Finish \\| End | [x] Main finish | [ ] Secret finish |",
      "| Finish \\| End | [x] Main finish | [x] Secret finish |",
    );
    const view = render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Main start" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Secret start" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Main finish" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Отметить: Secret finish" })).not.toBeChecked();
    expect(screen.getByText("Start").closest("tr")).toHaveClass("markdown-table-row--complete");
    expect(screen.getByText("Finish | End").closest("tr")).not.toHaveClass("markdown-table-row--complete");
    expect(screen.getByText("Notes").closest("tr")).not.toHaveClass("markdown-table-row--complete");
    const campaign = screen.getByRole("heading", { name: /^Campaign / });
    const route = screen.getByRole("heading", { name: /^Route / });
    for (const heading of [campaign, route]) {
      expect(heading.querySelector(".markdown-checklist-progress")).toHaveTextContent("4/5");
      expect(heading).not.toHaveClass("markdown-checklist-heading--complete");
    }
    expect(hasMarkdownTasks(markdown)).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Secret finish" }));

    expect(onTaskChange).toHaveBeenCalledWith(completedMarkdown);
    view.rerender(<MarkdownView markdown={completedMarkdown} onTaskChange={onTaskChange} />);
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Secret finish" })).toBeChecked();
    expect(screen.getByText("Finish | End").closest("tr")).toHaveClass("markdown-table-row--complete");
    const completedCampaign = screen.getByRole("heading", { name: /^Campaign / });
    const completedRoute = screen.getByRole("heading", { name: /^Route / });
    for (const heading of [completedCampaign, completedRoute]) {
      expect(heading.querySelector(".markdown-checklist-progress")).toHaveTextContent("5/5");
      expect(heading).toHaveClass("markdown-checklist-heading--complete");
    }
  });

  it("aggregates every checklist in a heading section without crossing sibling boundaries", () => {
    const markdown = [
      "- [x] Unscoped task",
      "# Root",
      "Introduction before the first list.",
      "- [x] Root task",
      "Context between lists.",
      "1. [ ] Preparation",
      "## A",
      "- [ ] Parent task",
      "  1. [x] Nested task",
      "### A.1",
      "Context before the deep list.",
      "- [x] Deep task",
      "## B",
      "- [ ] B task",
      "# Other",
      "Context before the other list.",
      "- [x] Other task",
      "## Empty",
      "- Ordinary item",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const root = screen.getByRole("heading", { name: /^Root / });
    const sectionA = screen.getByRole("heading", { name: /^A Выполнено/ });
    const sectionA1 = screen.getByRole("heading", { name: /^A\.1 / });
    const sectionB = screen.getByRole("heading", { name: /^B / });
    const other = screen.getByRole("heading", { name: /^Other / });
    const empty = screen.getByRole("heading", { name: "Empty" });
    const rootProgress = root.querySelector(".markdown-checklist-progress");

    expect(rootProgress).toHaveTextContent("3/6");
    expect(rootProgress).toHaveAttribute("aria-label", "Выполнено 3 из 6");
    expect(root).toHaveAccessibleName("Root Выполнено 3 из 6");
    expect(root).not.toHaveClass("markdown-checklist-heading--complete");
    expect(sectionA.querySelector(".markdown-checklist-progress")).toHaveTextContent("2/3");
    expect(sectionA).not.toHaveClass("markdown-checklist-heading--complete");
    expect(sectionA1.querySelector(".markdown-checklist-progress")).toHaveTextContent("1/1");
    expect(sectionA1).toHaveClass("markdown-checklist-heading--complete");
    expect(sectionB.querySelector(".markdown-checklist-progress")).toHaveTextContent("0/1");
    expect(other.querySelector(".markdown-checklist-progress")).toHaveTextContent("1/1");
    expect(other).toHaveClass("markdown-checklist-heading--complete");
    expect(empty.querySelector(".markdown-checklist-progress")).toBeNull();
  });

  it("shows independent totals for checklist groups at every nested list depth", () => {
    const markdown = [
      "## DK Challenge",
      "- Nintendo Classics",
      "  - [x] Rumble in the Jungle!",
      "  - [ ] High-Flying Mine Cart!",
      "- Donkey Kong Bananza",
      "  - Bananza Transformations!",
      "    - [x] Kong Charge Punch!",
      "    - [x] Zebra Water Dash!",
      "  - Against the Clock",
      "    - [ ] Kong and Destroy!",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const challenge = screen.getByRole("heading", { name: /^DK Challenge / });
    const nintendo = screen.getByText("Nintendo Classics").closest(".markdown-checklist-group");
    const bananza = screen.getByText("Donkey Kong Bananza").closest(".markdown-checklist-group");
    const transformations = screen.getByText("Bananza Transformations!").closest(".markdown-checklist-group");
    const clock = screen.getByText("Against the Clock").closest(".markdown-checklist-group");

    expect(challenge.querySelector(".markdown-checklist-progress")).toHaveTextContent("3/5");
    expect(nintendo?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("1/2");
    expect(bananza?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("2/3");
    expect(transformations?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("2/2");
    expect(transformations).toHaveClass("markdown-checklist-group--complete");
    expect(clock?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("0/1");
    expect(nintendo).toHaveAttribute("data-markdown-source-line", "1");

    const topLevelList = nintendo?.parentElement;
    expect(topLevelList?.parentElement).toHaveClass("markdown");
    expect(screen.getByText("Rumble in the Jungle!").closest(".markdown-checklist-group")).toBe(nintendo);
  });

  it("updates list-group totals and completion styles when a descendant task changes", async () => {
    const user = userEvent.setup();
    let currentMarkdown = "# Route\n- Nintendo Classics\n  - [x] Finished\n  - [ ] Pending";
    const view = render(<MarkdownView markdown={currentMarkdown} onTaskChange={(nextMarkdown) => {
      currentMarkdown = nextMarkdown;
      view.rerender(<MarkdownView markdown={currentMarkdown} onTaskChange={() => undefined} />);
    }} />);

    const getGroup = () => screen.getByText("Nintendo Classics").closest(".markdown-checklist-group");
    expect(getGroup()?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("1/2");
    expect(getGroup()).not.toHaveClass("markdown-checklist-group--complete");

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Pending" }));

    expect(getGroup()?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("2/2");
    expect(getGroup()).toHaveClass("markdown-checklist-group--complete");
    expect(screen.getByRole("heading", { name: /^Route / })).toHaveClass("markdown-checklist-heading--complete");
  });

  it("collapses checklist headings and groups while retaining nested collapse state", async () => {
    const user = userEvent.setup();
    const markdown = [
      "# Root",
      "## DK Challenge",
      "- Nintendo Classics",
      "  - [x] Finished",
      "  - [ ] Pending",
      "- Other group",
      "  - [ ] Other task",
      "## Sibling",
      "- [x] Sibling task",
      "# Next",
      "- [ ] Next task",
    ].join("\n");
    let collapsed: string[] = [];
    let view: ReturnType<typeof render>;
    const onCollapsedChecklistSectionsChange = vi.fn((next: string[]) => {
      collapsed = next;
      view.rerender(
        <MarkdownView collapsedChecklistSections={collapsed} markdown={markdown} onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange} />,
      );
    });
    view = render(
      <MarkdownView collapsedChecklistSections={collapsed} markdown={markdown} onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange} />,
    );

    const challenge = screen.getByRole("button", { name: /^DK Challenge / });
    const nintendo = screen.getByRole("button", { name: /^Nintendo Classics / });
    expect(challenge).toHaveAttribute("aria-expanded", "true");
    expect(nintendo).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".markdown-checklist-toggle__indicator")).toBeNull();

    await user.click(challenge);
    expect(screen.getByRole("button", { name: /^DK Challenge / })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Nintendo Classics / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sibling / })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Next / })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^DK Challenge / }));
    await user.click(screen.getByRole("button", { name: /^Nintendo Classics / }));
    expect(screen.getByRole("button", { name: /^Nintendo Classics / })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "Снять отметку: Finished" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Отметить: Other task" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Root / }));
    expect(screen.queryByRole("button", { name: /^DK Challenge / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Sibling / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Next / })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Root / }));
    expect(screen.getByRole("button", { name: /^Nintendo Classics / })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "Снять отметку: Finished" })).not.toBeInTheDocument();
    expect(onCollapsedChecklistSectionsChange).toHaveBeenCalledTimes(5);
  });

  it("keeps semantic collapse ids stable when unrelated lines are inserted", () => {
    const markdown = "# Route\n- Nintendo Classics\n  - [ ] Task";
    const view = render(<MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={vi.fn()} />);
    const headingId = screen.getByRole("heading", { name: /^Route / }).getAttribute("data-checklist-section-id");
    const groupId = screen.getByText("Nintendo Classics").closest(".markdown-checklist-group")?.getAttribute("data-checklist-section-id");

    view.rerender(<MarkdownView markdown={`Unrelated introduction.\n\n${markdown}`} onCollapsedChecklistSectionsChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /^Route / })).toHaveAttribute("data-checklist-section-id", headingId);
    expect(screen.getByText("Nintendo Classics").closest(".markdown-checklist-group")).toHaveAttribute("data-checklist-section-id", groupId);
  });

  it("uses unique DOM ids for identical checklist groups in separate notes", () => {
    const markdown = "# Route\n- Nintendo Classics\n  - [ ] Task";
    const onChange = vi.fn();

    render(<>
      <MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={onChange} />
      <MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={onChange} />
    </>);

    const toggles = screen.getAllByRole("button", { name: /^Nintendo Classics / });
    const contentIds = toggles.map((toggle) => toggle.getAttribute("aria-controls"));
    expect(contentIds[0]).toBeTruthy();
    expect(contentIds[1]).toBeTruthy();
    expect(contentIds[0]).not.toBe(contentIds[1]);
    for (const contentId of contentIds) {
      expect(document.getElementById(contentId!)).toBeInTheDocument();
    }
  });

  it("propagates progress through every supported and skipped heading depth", () => {
    const markdown = [
      "# Full depth",
      "## Level 2",
      "### Level 3",
      "#### Level 4",
      "- [x] Done",
      "- [ ] Pending",
      "# Skipped root",
      "### Skipped child",
      "- [x] Complete",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const fullDepth = screen.getByRole("heading", { name: /^Full depth / });
    const level2 = screen.getByRole("heading", { name: /^Level 2 / });
    const level3 = screen.getByRole("heading", { name: /^Level 3 / });
    const level4 = screen.getByRole("heading", { name: /^Level 4 / });
    const skippedRoot = screen.getByRole("heading", { name: /^Skipped root / });
    const skippedChild = screen.getByRole("heading", { name: /^Skipped child / });

    for (const heading of [fullDepth, level2, level3, level4]) {
      expect(heading.querySelector(".markdown-checklist-progress")).toHaveTextContent("1/2");
      expect(heading).not.toHaveClass("markdown-checklist-heading--complete");
    }
    for (const heading of [skippedRoot, skippedChild]) {
      expect(heading.querySelector(".markdown-checklist-progress")).toHaveTextContent("1/1");
      expect(heading).toHaveClass("markdown-checklist-heading--complete");
    }
  });

  it("updates every heading ancestor when the last deep task is checked", async () => {
    const user = userEvent.setup();
    const initialMarkdown = [
      "# Route",
      "## Stage",
      "### Finale",
      "#### Tasks",
      "Context before the checklist.",
      "- [x] Start",
      "- [ ] Finish",
    ].join("\n");
    let currentMarkdown = initialMarkdown;
    const view = render(<MarkdownView markdown={currentMarkdown} onTaskChange={(nextMarkdown) => {
      currentMarkdown = nextMarkdown;
      view.rerender(<MarkdownView markdown={currentMarkdown} onTaskChange={() => undefined} />);
    }} />);

    const getHeadings = () => [
      screen.getByRole("heading", { name: /^Route / }),
      screen.getByRole("heading", { name: /^Stage / }),
      screen.getByRole("heading", { name: /^Finale / }),
      screen.getByRole("heading", { name: /^Tasks / }),
    ];
    for (const heading of getHeadings()) {
      expect(heading.querySelector(".markdown-checklist-progress")).toHaveTextContent("1/2");
      expect(heading).not.toHaveClass("markdown-checklist-heading--complete");
    }

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Finish" }));

    for (const heading of getHeadings()) {
      expect(heading.querySelector(".markdown-checklist-progress")).toHaveTextContent("2/2");
      expect(heading).toHaveClass("markdown-checklist-heading--complete");
    }
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

  it("saves a clicked table task without opening the note editor", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const bodyMarkdown = "| Stage | Complete |\n| --- | :---: |\n| Intro | [ ] |";
    const note = makeNote(bodyMarkdown);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Intro — Complete" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe(bodyMarkdown.replace("[ ]", "[x]"));
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("saves collapsed checklist sections as note state without editing Markdown", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note = makeNote("# DK Challenge\n- Nintendo Classics\n  - [x] Finished\n  - [ ] Pending");
    const view = render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /^Nintendo Classics / }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const savedNote = onSave.mock.calls[0][0].notes[0];
    expect(savedNote.bodyMarkdown).toBe(note.bodyMarkdown);
    expect(savedNote.collapsedChecklistSections).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();

    view.rerender(
      <GamePage
        assets={{}}
        game={game}
        mode="game"
        notes={[{ ...note, collapsedChecklistSections: savedNote.collapsedChecklistSections }]}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("button", { name: /^Nintendo Classics / })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "Снять отметку: Finished" })).not.toBeInTheDocument();
  });

  it("keeps a checklist section expanded when saving its collapse state fails", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>().mockRejectedValue(new Error("Storage failed"));
    const note = makeNote("# Route\n- Nintendo Classics\n  - [ ] Task");
    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /^Nintendo Classics / }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage failed");
    expect(screen.getByRole("button", { name: /^Nintendo Classics / })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "Отметить: Task" })).toBeInTheDocument();
  });

  it("preserves committed checklist collapse state when the note text is edited", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note = { ...makeNote("# Route\n- [ ] Task"), collapsedChecklistSections: ["heading:stored-state"] };
    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    await user.type(editor, " More context");
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave.mock.calls[0][0].notes[0].collapsedChecklistSections).toEqual(note.collapsedChecklistSections);
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

  describe("open checklists and focused item editing", () => {
    it("hides only a final unchecked ellipsis marker and replaces it with Add", () => {
      const editable = render(<MarkdownView markdown={"- [x] First\n- [ ] Second\n- [ ] ..."} onTaskChange={vi.fn()} />);

      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      expect(screen.queryByText("...")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Добавить пункт чеклиста" })).toHaveTextContent("Добавить");

      editable.rerender(<MarkdownView markdown={"- [ ] ...\n- [ ] Later"} onTaskChange={vi.fn()} />);
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      expect(screen.getByText("...")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Добавить пункт чеклиста" })).not.toBeInTheDocument();
    });

    it("keeps checked and non-exact ellipses as ordinary tasks", () => {
      render(<MarkdownView markdown={"- [ ] ... позже\n- [x] ..."} onTaskChange={vi.fn()} />);

      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      expect(screen.getByText("... позже")).toBeInTheDocument();
      expect(screen.getByText("...")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Добавить пункт чеклиста" })).not.toBeInTheDocument();
    });

    it("excludes the marker from totals and propagates an unknown denominator through ancestors", () => {
      const markdown = [
        "# Root",
        "- Open group",
        "  - [x] Done",
        "  - [ ] Pending",
        "  - [ ] ...",
        "- Closed group",
        "  - [x] Complete",
        "  - [ ] Remaining",
      ].join("\n");
      render(<MarkdownView markdown={markdown} onTaskChange={vi.fn()} />);

      const root = screen.getByRole("heading", { name: /^Root / });
      const open = screen.getByText("Open group").closest(".markdown-checklist-group");
      const closed = screen.getByText("Closed group").closest(".markdown-checklist-group");
      expect(root.querySelector(".markdown-checklist-progress")).toHaveTextContent("2/?");
      expect(root.querySelector(".markdown-checklist-progress")).toHaveAttribute("aria-label", "Выполнено 2, общее количество неизвестно");
      expect(open?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("1/?");
      expect(open).not.toHaveClass("markdown-checklist-group--complete");
      expect(closed?.querySelector(":scope > .markdown-checklist-group__header > .markdown-checklist-progress")).toHaveTextContent("1/2");
      expect(screen.getAllByRole("checkbox")).toHaveLength(4);
      expect(hasMarkdownTasks("- [ ] ...")).toBe(true);
    });

    it("inserts immediately before the marker while preserving nesting, bullet style, and CRLF", async () => {
      const user = userEvent.setup();
      const onTaskChange = vi.fn();
      const markdown = "- Parent\r\n\t* [x] Existing\r\n\t* [ ] ...\r\n- Sibling";
      render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

      await user.click(screen.getByRole("button", { name: "Добавить пункт чеклиста" }));
      const input = screen.getByRole("textbox", { name: "Новый пункт чеклиста" });
      expect(input).toHaveFocus();
      await user.type(input, "Новый пункт{Enter}");

      expect(onTaskChange).toHaveBeenCalledWith(
        "- Parent\r\n\t* [x] Existing\r\n\t* [ ] Новый пункт\r\n\t* [ ] ...\r\n- Sibling",
      );
      expect(screen.queryByRole("textbox", { name: "Новый пункт чеклиста" })).not.toBeInTheDocument();
    });

    it("cancels Add with Escape and ignores whitespace-only input", async () => {
      const user = userEvent.setup();
      const onTaskChange = vi.fn();
      render(<MarkdownView markdown={"- [ ] Existing\n- [ ] ..."} onTaskChange={onTaskChange} />);

      await user.click(screen.getByRole("button", { name: "Добавить пункт чеклиста" }));
      await user.keyboard("{Escape}");
      expect(onTaskChange).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Добавить пункт чеклиста" }));
      await user.type(screen.getByRole("textbox", { name: "Новый пункт чеклиста" }), "   {Enter}");
      expect(onTaskChange).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Добавить пункт чеклиста" })).toBeInTheDocument();
    });

    it("flattens multiline pasted text without touching adjacent source", async () => {
      const user = userEvent.setup();
      const onTaskChange = vi.fn();
      const markdown = "+ [ ] Before\n+ [ ] ...\nAfter";
      render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

      await user.click(screen.getByRole("button", { name: "Добавить пункт чеклиста" }));
      const input = screen.getByRole("textbox", { name: "Новый пункт чеклиста" });
      fireEvent.paste(input, { clipboardData: { getData: () => "First\r\nSecond\nThird" } });
      expect(input).toHaveValue("First Second Third");
      await user.keyboard("{Enter}");
      expect(onTaskChange).toHaveBeenCalledWith("+ [ ] Before\n+ [ ] First Second Third\n+ [ ] ...\nAfter");

      expect(insertMarkdownOpenChecklistItem("* [ ] ...\r\nNeighbor", 0, "One\nTwo")).toBe(
        "* [ ] One Two\r\n* [ ] ...\r\nNeighbor",
      );
    });

    it("edits only the selected first-line text range and preserves prefix, state, children, and continuations", () => {
      const markdown = [
        "  + [x]\tParent",
        "    continued detail",
        "    - [ ] Child",
        "  + [ ] Neighbor",
        "  + [ ] ...",
      ].join("\n");

      expect(setMarkdownTaskItemText(markdown, 0, "Renamed\nparent")).toBe([
        "  + [x]\tRenamed parent",
        "    continued detail",
        "    - [ ] Child",
        "  + [ ] Neighbor",
        "  + [ ] ...",
      ].join("\n"));
      expect(setMarkdownTaskItemText(markdown, 2, "Renamed child")).toBe([
        "  + [x]\tParent",
        "    continued detail",
        "    - [ ] Renamed child",
        "  + [ ] Neighbor",
        "  + [ ] ...",
      ].join("\n"));
      expect(setMarkdownTaskItemText("- [ ]", 0, "Started")).toBe("- [ ] Started");
    });

    it("edits the chosen duplicate, supports empty text safely, and cancels with Escape", async () => {
      const user = userEvent.setup();
      const onTaskChange = vi.fn();
      const markdown = "- [ ] Duplicate\n- [ ] Duplicate\n- [ ] ...";
      render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

      const editButtons = screen.getAllByRole("button", { name: "Редактировать пункт: Duplicate" });
      await user.click(editButtons[1]);
      const input = screen.getByRole("textbox", { name: "Текст пункта: Duplicate" });
      expect(input).toHaveFocus();
      await user.clear(input);
      await user.keyboard("{Escape}");
      expect(onTaskChange).not.toHaveBeenCalled();
      expect(screen.getAllByText("Duplicate")).toHaveLength(2);

      await user.click(screen.getAllByRole("button", { name: "Редактировать пункт: Duplicate" })[1]);
      await user.clear(screen.getByRole("textbox", { name: "Текст пункта: Duplicate" }));
      await user.keyboard("{Enter}");
      expect(onTaskChange).toHaveBeenCalledWith("- [ ] Duplicate\n- [ ] \n- [ ] ...");
      expect(setMarkdownTaskItemText(markdown, 1, "Second only")).toBe("- [ ] Duplicate\n- [ ] Second only\n- [ ] ...");
    });

    it("does not expose Add or edit controls in read-only mode", () => {
      render(<MarkdownView markdown={"- [ ] Visible\n- [ ] ..."} />);

      expect(screen.getByRole("checkbox", { name: "Отметить: Visible" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Добавить пункт чеклиста" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Редактировать пункт/ })).not.toBeInTheDocument();
      expect(screen.queryByText("...")).not.toBeInTheDocument();
    });

    it("cancels a source-range editor when the controlled Markdown version changes", async () => {
      const user = userEvent.setup();
      const onTaskChange = vi.fn();
      const view = render(<MarkdownView markdown={"- [ ] Original\n- [ ] ..."} onTaskChange={onTaskChange} />);

      await user.click(screen.getByRole("button", { name: "Редактировать пункт: Original" }));
      expect(screen.getByRole("textbox", { name: "Текст пункта: Original" })).toBeInTheDocument();
      view.rerender(<MarkdownView markdown={"Intro\n- [ ] Original\n- [ ] ..."} onTaskChange={onTaskChange} />);

      await waitFor(() => expect(screen.queryByRole("textbox", { name: "Текст пункта: Original" })).not.toBeInTheDocument());
      expect(onTaskChange).not.toHaveBeenCalled();
    });

    it("persists Add and item edits through the existing note save path", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn<(input: GameSaveInput) => void>();
      const original = makeNote("- [ ] ...");
      const view = render(<GamePage assets={{}} game={game} mode="game" notes={[original]} onSave={onSave} />);

      await user.click(screen.getByRole("button", { name: "Добавить пункт чеклиста" }));
      await user.type(screen.getByRole("textbox", { name: "Новый пункт чеклиста" }), "Added{Enter}");
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const addedMarkdown = "- [ ] Added\n- [ ] ...";
      expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe(addedMarkdown);

      onSave.mockClear();
      view.rerender(<GamePage assets={{}} game={game} mode="game" notes={[{ ...original, bodyMarkdown: addedMarkdown }]} onSave={onSave} />);
      await user.click(screen.getByRole("button", { name: "Редактировать пункт: Added" }));
      const input = screen.getByRole("textbox", { name: "Текст пункта: Added" });
      await user.clear(input);
      await user.type(input, "Edited{Enter}");
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0].notes[0].bodyMarkdown).toBe("- [ ] Edited\n- [ ] ...");
    });
  });
});
