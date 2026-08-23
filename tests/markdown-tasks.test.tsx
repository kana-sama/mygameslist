import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasMarkdownTasks, insertMarkdownOpenChecklistItem, MarkdownView, setMarkdownTaskChecked, setMarkdownTaskItemText } from "../src/components/Markdown";
import { parseMarkdownBlocks } from "../src/domain/markdownChecklist";
import type { Game, Note } from "../src/domain/types";
import { GamePage, type GameSaveInput } from "../src/pages/GamePage";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));
vi.mock("../src/domain/markdownChecklist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/markdownChecklist")>();
  return { ...actual, parseMarkdownBlocks: vi.fn(actual.parseMarkdownBlocks) };
});

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-17T10:00:00.000Z";
const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

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
  it("renders a computed-style hierarchy for progress-bearing checklist headings", () => {
    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);

    try {
      render(
        <MarkdownView markdown={[
          "# Root",
          "- [ ] Root task",
          "## Group",
          "- [ ] Group task",
          "### Subsection",
          "- Nested group",
          "  - [ ] Nested task",
          "# Plain heading",
          "Plain content",
        ].join("\n")} />,
      );

      const root = screen.getByRole("heading", { name: /^Root / });
      const group = screen.getByRole("heading", { name: /^Group / });
      const subsection = screen.getByRole("heading", { name: /^Subsection / });
      const plain = screen.getByRole("heading", { name: "Plain heading" });
      const subsectionList = subsection.nextElementSibling;
      const rootSize = Number.parseFloat(getComputedStyle(root).fontSize);
      const groupSize = Number.parseFloat(getComputedStyle(group).fontSize);
      const subsectionSize = Number.parseFloat(getComputedStyle(subsection).fontSize);
      const groupStyle = getComputedStyle(group);
      const subsectionStyle = getComputedStyle(subsection);
      const listStyle = getComputedStyle(subsectionList!);
      const plainStyle = getComputedStyle(plain);

      expect(rootSize).toBeGreaterThan(groupSize);
      expect(groupSize).toBeGreaterThan(subsectionSize);
      expect(groupStyle.borderBlockStart).toContain("solid");
      expect(Number.parseFloat(groupStyle.paddingBlockStart)).toBeGreaterThan(0);
      expect(Number.parseFloat(groupStyle.marginBlockStart)).toBeGreaterThan(0);
      expect(subsectionStyle.borderInlineStart).toContain("solid");
      expect(Number.parseFloat(subsectionStyle.paddingLeft)).toBeGreaterThan(0);
      expect(listStyle.borderInlineStart).toContain("solid");
      expect(Number.parseFloat(listStyle.paddingInlineStart)).toBeGreaterThan(0);
      expect(plainStyle.borderInlineStart).not.toContain("solid");
    } finally {
      style.remove();
    }
  });

  it("keeps completed subsection paint and divider rules in the shared production stylesheet", () => {
    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);

    try {
      const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
      const ruleFor = (selector: string): CSSStyleRule => {
        const rule = rules.find((candidate) => candidate.selectorText === selector);
        expect(rule).toBeDefined();
        return rule!;
      };
      const subsection = ruleFor(".markdown-checklist-subsection");
      const dividerRules = rules.filter((rule) => rule.selectorText === ".markdown-checklist-subsection::before");
      const divider = ruleFor(".markdown-checklist-subsection::before");
      const heading = ruleFor(".markdown-checklist-subsection > h3.markdown-checklist-heading");
      const completed = ruleFor(".markdown-checklist-subsection--complete");
      const completedGap = ruleFor(".markdown-checklist-subsection--complete::after");
      const adjacentCompleted = ruleFor(".markdown-checklist-subsection--complete + .markdown-checklist-subsection--complete::before");
      const markdownContent = ruleFor(".note-card__content > .markdown");
      const fullBleed = ruleFor(".note-card__content > .markdown .markdown-checklist-subsection");

      expect(completed.style.background).toBe("var(--success-wash)");
      expect(markdownContent.style.getPropertyValue("--markdown-content-inline-padding").trim()).toBe("6px");
      expect(fullBleed.style.marginInline).toBe("calc(-1 * var(--markdown-content-inline-padding))");
      expect(fullBleed.style.paddingInline).toBe("var(--markdown-content-inline-padding)");
      expect(dividerRules).toHaveLength(1);
      expect(subsection.style.getPropertyValue("--markdown-checklist-subsection-line-width").trim()).toBe("1px");
      expect(subsection.style.getPropertyValue("--markdown-checklist-subsection-line").trim()).toBe("var(--line-soft)");
      expect(divider.style.borderBlockStart).toBe("var(--markdown-checklist-subsection-line-width) solid var(--markdown-checklist-subsection-line)");
      expect(heading.style.borderBlockStartColor).toBe("transparent");
      expect(completedGap.style.border).toBe("");
      expect(completedGap.style.borderBlockStart).toBe("");
      expect(subsection.style.getPropertyValue("--markdown-checklist-subsection-adjacent-complete-line").trim()).toBe("color-mix(in srgb,var(--line-soft) 92%,var(--text))");
      expect(adjacentCompleted.style.borderBlockStartColor).toBe("var(--markdown-checklist-subsection-adjacent-complete-line)");
    } finally {
      style.remove();
    }
  });

  it("renders collapsed heading state as a sibling without changing heading rhythm", async () => {
    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);

    const user = userEvent.setup();
    const markdown = [
      "# Quests",
      "## Chapter 2",
      "### MOMO",
      "- [x] Tora's Secret Stash",
      "## Chapter 4",
      "### Ursula",
      "#### Normal Quests",
      "- [ ] Bearing Her Soul",
      "### Vess",
      "- [x] Tranquility",
      "# Plain heading",
      "Plain content",
    ].join("\n");
    let collapsed: string[] = [];
    let view: ReturnType<typeof render>;
    const onCollapsedChecklistSectionsChange = vi.fn((next: string[]) => {
      collapsed = next;
      view.rerender(
        <MarkdownView
          collapsedChecklistSections={collapsed}
          markdown={markdown}
          onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
        />,
      );
    });

    try {
      view = render(
        <MarkdownView
          collapsedChecklistSections={collapsed}
          markdown={markdown}
          onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
        />,
      );

      const markdownRoot = view.container.querySelector<HTMLElement>(".markdown")!;
      const chapter4 = screen.getByRole("heading", { name: "Chapter 4 Выполнено 1 из 2" });
      const plain = screen.getByRole("heading", { name: "Plain heading" });
      const expandedGroupMargin = Number.parseFloat(getComputedStyle(chapter4).marginBlockStart);
      const expandedGroupPadding = Number.parseFloat(getComputedStyle(chapter4).paddingBlockStart);

      expect(view.container.querySelector(".markdown-checklist-heading__chevron")).toBeNull();
      expect(plain.querySelector(".markdown-checklist-heading__chevron")).toBeNull();
      expect(chapter4).not.toHaveClass("markdown-checklist-heading--collapsed");

      await user.click(screen.getByRole("button", { name: "Chapter 4 Выполнено 1 из 2" }));

      const collapsedGroup = screen.getByRole("heading", { name: "Chapter 4 Выполнено 1 из 2" });
      const collapsedButton = screen.getByRole("button", { name: "Chapter 4 Выполнено 1 из 2" });
      const collapsedState = collapsedGroup.nextElementSibling as HTMLElement;
      expect(collapsedState).not.toBeNull();
      const collapsedHeadingStyle = getComputedStyle(collapsedGroup);
      const collapsedStateStyle = getComputedStyle(collapsedState);
      expect(collapsedButton).toHaveAttribute("aria-expanded", "false");
      expect(collapsedButton).toHaveAccessibleName("Chapter 4 Выполнено 1 из 2");
      expect(collapsedGroup).toHaveClass("markdown-checklist-heading--collapsed");
      expect(collapsedState).toHaveClass("markdown-checklist-heading__collapsed-state");
      expect(collapsedState).toHaveAttribute("aria-hidden", "true");
      expect(collapsedState).toHaveTextContent("Свернуто · 2 пунктов внутри");
      expect(collapsedGroup).not.toContainElement(collapsedState);
      expect(collapsedState.previousElementSibling).toBe(collapsedGroup);
      expect(collapsedStateStyle.fontSize).toBe(getComputedStyle(markdownRoot).fontSize);
      expect(collapsedStateStyle.fontWeight).toBe(getComputedStyle(markdownRoot).fontWeight);
      expect(collapsedStateStyle.lineHeight).toBe(getComputedStyle(markdownRoot).lineHeight);
      expect(collapsedStateStyle.color).toBe("var(--muted)");
      expect(Number.parseFloat(collapsedStateStyle.marginBlockStart)).toBe(-0.25);
      expect(Number.parseFloat(collapsedStateStyle.marginBlockEnd)).toBe(0.5);
      expect(Number.parseFloat(collapsedHeadingStyle.marginBlockStart)).toBe(expandedGroupMargin);
      expect(Number.parseFloat(collapsedHeadingStyle.paddingBlockStart)).toBe(expandedGroupPadding);

      const collapsedStateMarginEnd = Number.parseFloat(collapsedStateStyle.marginBlockEnd);
      await user.click(collapsedButton);

      const vess = screen.getByRole("heading", { name: "Vess Выполнено 1 из 1" });
      const vessList = vess.nextElementSibling as HTMLElement;
      expect(Number.parseFloat(getComputedStyle(vessList).marginBlockEnd)).toBe(collapsedStateMarginEnd);

      await user.click(screen.getByRole("button", { name: "Ursula Выполнено 0 из 1" }));

      const collapsedUrsula = screen.getByRole("heading", { name: "Ursula Выполнено 0 из 1" });
      const nestedState = collapsedUrsula.nextElementSibling as HTMLElement;
      const nestedStateStyle = getComputedStyle(nestedState);
      expect(nestedState).toHaveTextContent("Свернуто · 1 пунктов внутри");
      expect(nestedState).toHaveClass("markdown-checklist-heading__collapsed-state--nested");
      expect(nestedStateStyle.borderInlineStart).toBe("1px solid var(--line-soft)");
      expect(Number.parseFloat(nestedStateStyle.marginInlineStart)).toBe(0.5);
      expect(Number.parseFloat(nestedStateStyle.paddingInlineStart)).toBe(0.95);

      await user.click(screen.getByRole("button", { name: "Ursula Выполнено 0 из 1" }));
      await user.click(screen.getByRole("button", { name: "Vess Выполнено 1 из 1" }));

      const collapsedVess = screen.getByRole("heading", { name: "Vess Выполнено 1 из 1" });
      expect(collapsedVess.nextElementSibling).toHaveTextContent("Свернуто · 1 пунктов внутри");
    } finally {
      style.remove();
    }
  });

  it("renders native hover hints without turning them into links", () => {
    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);

    try {
      const view = render(
        <div style={{ color: "rgb(18, 52, 86)" }}>
          <MarkdownView markdown={'Read [**details**]("Plain *text*") and [site](https://example.com)'} />
        </div>,
      );

      const hint = view.container.querySelector(".markdown-hover-hint");
      expect(hint).toBeInstanceOf(HTMLSpanElement);
      expect(hint).toHaveAttribute("title", "Plain *text*");
      expect(hint).toHaveTextContent("details");
      expect(hint?.querySelector("strong")).toHaveTextContent("details");
      expect(hint?.closest("a")).toBeNull();
      expect(getComputedStyle(hint!).color).toBe(getComputedStyle(hint!.parentElement!).color);
      expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("href", "https://example.com/");
    } finally {
      style.remove();
    }
  });

  it("reveals spoiler segments independently", async () => {
    const user = userEvent.setup();
    const markdown = "Before ||secret **detail**|| after and ||second||";
    const view = render(<MarkdownView markdown={markdown} />);

    const spoilers = screen.getAllByRole("button", { name: "Показать спойлер" });
    expect(spoilers).toHaveLength(2);
    expect(spoilers[0]).toHaveAttribute("data-revealed", "false");
    expect(spoilers[1]).toHaveAttribute("data-revealed", "false");

    await user.click(spoilers[0]);

    const revealed = view.container.querySelector(".markdown-spoiler[data-revealed=\"true\"]");
    expect(revealed).toHaveClass("markdown-spoiler");
    expect(revealed?.querySelector("strong")).toHaveTextContent("detail");
    expect(screen.queryByRole("button", { name: "Показать спойлер" })).toBe(spoilers[1]);
    expect(spoilers[1]).toHaveAttribute("data-revealed", "false");

    view.unmount();
    render(<MarkdownView markdown={markdown} />);
    expect(screen.getAllByRole("button", { name: "Показать спойлер" })).toHaveLength(2);

    const keyboardSpoiler = screen.getAllByRole("button", { name: "Показать спойлер" })[0];
    keyboardSpoiler.focus();
    await user.keyboard("{Enter}");
    expect(keyboardSpoiler).toHaveAttribute("data-revealed", "true");

    cleanup();
    render(<MarkdownView markdown="||space reveal||" />);
    const spaceSpoiler = screen.getByRole("button", { name: "Показать спойлер" });
    spaceSpoiler.focus();
    await user.keyboard(" ");
    expect(spaceSpoiler).toHaveAttribute("data-revealed", "true");
  });

  it("keeps closed spoiler links inert and restores them after reveal", async () => {
    const user = userEvent.setup();
    render(<MarkdownView markdown="||[guide](https://example.com)||" />);

    const spoiler = screen.getByRole("button", { name: "Показать спойлер" });
    expect(spoiler).toHaveTextContent("guide");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /guide/i })).not.toBeInTheDocument();

    await user.click(spoiler);

    expect(screen.getByRole("link", { name: "guide" })).toHaveAttribute("href", "https://example.com/");
  });

  it("keeps empty and unmatched spoiler delimiters literal", () => {
    render(<MarkdownView markdown={"||||\n\n||unmatched"} />);

    expect(screen.getByText("||||")).toBeInTheDocument();
    expect(screen.getByText("||unmatched")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать спойлер" })).not.toBeInTheDocument();
  });

  it("redacts hidden spoiler bodies from list and table task controls", () => {
    const markdown = [
      "- [ ] ||list secret||",
      "- [x] ||visible list||",
      "- [x] Prefix ||mixed list secret||",
      "",
      "| Stage | Task |",
      "| --- | --- |",
      "| Hidden | [ ] ||table secret|| |",
      "| Visible | [x] ||visible table|| |",
      "| Mixed | [x] Prefix ||mixed table secret|| |",
      "| Literal | [x] \\|\\|literal\\|\\| |",
    ].join("\n");

    render(<MarkdownView markdown={markdown} onTaskChange={vi.fn()} />);

    expect(screen.getAllByRole("checkbox", { name: "Отметить: скрытый спойлер" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Редактировать пункт: скрытый спойлер" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Снять отметку: visible list" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: "Снять отметку: Prefix скрытый спойлер" })).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Снять отметку: visible table" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Снять отметку: ||literal||" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /secret/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Редактировать пункт:.*secret/ })).not.toBeInTheDocument();
  });

  it("renders a table spoiler without adding a column", () => {
    const markdown = [
      "| Stage | Note |",
      "| --- | --- |",
      "| Start | ||secret|| |",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Показать спойлер" })).toHaveAttribute("data-revealed", "false");
  });

  it("keeps escaped table spoiler delimiters literal beside a real spoiler", async () => {
    const user = userEvent.setup();
    const onTaskChange = vi.fn();
    const markdown = [
      "| Stage | Note |",
      "| --- | --- |",
      "| Literal | \\|\\|literal\\|\\| |",
      "| Checked | [x] \\|\\|checked literal\\|\\| |",
      "| Real | ||real spoiler|| |",
    ].join("\n");

    const view = render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    const table = screen.getByRole("table");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect([...table.querySelectorAll("tbody tr")].every((row) => row.children.length === 2)).toBe(true);

    const literal = screen.getByText("||literal||");
    const checkedLiteral = screen.getByText("||checked literal||");
    expect(literal.closest(".markdown-spoiler")).toBeNull();
    expect(checkedLiteral.closest(".markdown-spoiler")).toBeNull();
    expect(view.container.querySelectorAll(".markdown-spoiler")).toHaveLength(1);
    expect(view.container.querySelector(".markdown-spoiler[data-revealed=\"true\"]")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Показать спойлер" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Показать спойлер" })).toHaveTextContent("real spoiler");

    await user.click(screen.getByRole("checkbox", { name: "Снять отметку: ||checked literal||" }));
    expect(onTaskChange).toHaveBeenCalledWith(markdown.replace("[x] \\|\\|checked literal", "[ ] \\|\\|checked literal"));
  });

  it("uses escaped source in table headers and groups without unescaping code or shifting decorations", () => {
    const markdown = [
      "| \\|\\|Header\\|\\| | Note |",
      "| --- | --- |",
      "| \\|\\|Group\\|\\| |",
      "| --- | --- |",
      "| Row | `x\\|y` |",
      "| Mark | A \\| B |",
    ].join("\n");

    const view = render(<MarkdownView decorations={[{
      endColumn: 13,
      endLine: 5,
      kind: "modified",
      label: "Изменено",
      startColumn: 12,
      startLine: 5,
    }]} markdown={markdown} />);

    expect(screen.getByRole("columnheader", { name: "||Header||" }).querySelector(".markdown-spoiler")).toBeNull();
    expect(screen.getByText("||Group||").closest(".markdown-spoiler")).toBeNull();
    expect(screen.getByText("x\\|y").closest("code")).toBeInTheDocument();
    expect(view.container.querySelector("[aria-label=\"Изменено: |\"]")).toHaveTextContent("|");
    expect(screen.queryByRole("button", { name: "Показать спойлер" })).not.toBeInTheDocument();
  });

  it("checkbox-bound spoilers reveal only while matching list tasks are checked", async () => {
    const user = userEvent.setup();
    let markdown = "- [ ] ||hidden list||";
    let view: ReturnType<typeof render>;
    const onTaskChange = vi.fn((nextMarkdown: string) => {
      markdown = nextMarkdown;
      view.rerender(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);
    });
    view = render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    await user.click(screen.getByRole("button", { name: "Показать спойлер" }));
    expect(view.container.querySelector(".markdown-spoiler[data-revealed=\"true\"]")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Отметить: скрытый спойлер" }));
    expect(onTaskChange).toHaveBeenCalledWith("- [x] ||hidden list||");
    expect(view.container.querySelector(".markdown-spoiler[data-revealed=\"true\"]")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Показать спойлер" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Снять отметку: hidden list" }));
    expect(view.container.querySelector(".markdown-spoiler[data-revealed=\"true\"]")).toBeInTheDocument();

    view.unmount();
    render(<MarkdownView markdown="- [x] ||already done||" />);
    expect(screen.queryByRole("button", { name: "Показать спойлер" })).not.toBeInTheDocument();
    expect(document.querySelector(".markdown-spoiler[data-revealed=\"true\"]")).toBeInTheDocument();

    cleanup();
    render(<MarkdownView markdown="- [x] Prefix ||ordinary||" />);
    expect(screen.getByRole("button", { name: "Показать спойлер" })).toHaveAttribute("data-revealed", "false");
  });

  it("checkbox-bound spoilers reveal only while matching table tasks are checked", async () => {
    const user = userEvent.setup();
    let markdown = [
      "| Stage | Secret |",
      "| --- | --- |",
      "| Start | [ ] ||hidden table|| |",
      "| Finish | [x] ||already done table|| |",
    ].join("\n");
    let view: ReturnType<typeof render>;
    const onTaskChange = vi.fn((nextMarkdown: string) => {
      markdown = nextMarkdown;
      view.rerender(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);
    });
    view = render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    expect(screen.getAllByRole("button", { name: "Показать спойлер" })).toHaveLength(1);
    expect(view.container.querySelectorAll(".markdown-spoiler[data-revealed=\"true\"]")).toHaveLength(1);
    await user.click(screen.getByRole("checkbox", { name: "Отметить: скрытый спойлер" }));
    expect(onTaskChange).toHaveBeenCalledWith([
      "| Stage | Secret |",
      "| --- | --- |",
      "| Start | [x] ||hidden table|| |",
      "| Finish | [x] ||already done table|| |",
    ].join("\n"));
    expect(view.container.querySelectorAll(".markdown-spoiler[data-revealed=\"true\"]")).toHaveLength(2);

    await user.click(screen.getByRole("checkbox", { name: "Снять отметку: hidden table" }));
    expect(screen.getAllByRole("button", { name: "Показать спойлер" })).toHaveLength(1);
  });

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

  it("renders framed one-cell rows as table groups", () => {
    const markdown = [
      "# Campaign",
      "| Stage | Main | Secret |",
      "| --- | :---: | :---: |",
      "| Philosopher's Stone |",
      "| --- | --- | --- |",
      "| Start | [x] | [ ] |",
      "| Finish | [x] | [x] |",
      "| --- | --- | --- |",
      "| Chamber of Secrets |",
      "| --- | --- | --- |",
      "| Dobby | [x] | [x] |",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const stoneHeading = screen.getByText("Philosopher's Stone").closest("th");
    const chamberHeading = screen.getByText("Chamber of Secrets").closest("th");
    expect(stoneHeading).toHaveAttribute("colspan", "3");
    expect(chamberHeading).toHaveAttribute("colspan", "3");
    expect(stoneHeading?.querySelector(".markdown-checklist-progress")).toHaveTextContent("3/4");
    expect(chamberHeading?.querySelector(".markdown-checklist-progress")).toHaveTextContent("2/2");
    expect(stoneHeading?.closest(".markdown-table-group")).not.toHaveClass("markdown-table-group--complete");
    expect(chamberHeading?.closest(".markdown-table-group")).toHaveClass("markdown-table-group--complete");
    expect(screen.getByRole("heading", { name: /^Campaign / }).querySelector(".markdown-checklist-progress")).toHaveTextContent("5/6");
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("collapses table groups independently", async () => {
    const user = userEvent.setup();
    const markdown = [
      "| Stage | Main | Secret |",
      "| --- | --- | --- |",
      "| Philosopher's Stone |",
      "| --- | --- | --- |",
      "| Start | [x] | [ ] |",
      "| --- | --- | --- |",
      "| Chamber of Secrets |",
      "| --- | --- | --- |",
      "| Dobby | [x] | [x] |",
    ].join("\n");
    let collapsed: string[] = [];
    let view: ReturnType<typeof render>;
    const onCollapsedChecklistSectionsChange = vi.fn((next: string[]) => {
      collapsed = next;
      view.rerender(
        <MarkdownView
          collapsedChecklistSections={collapsed}
          markdown={markdown}
          onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
        />,
      );
    });
    view = render(
      <MarkdownView
        collapsedChecklistSections={collapsed}
        markdown={markdown}
        onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Philosopher's Stone / }));

    const stone = screen.getByRole("button", { name: /^Philosopher's Stone / });
    expect(stone).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "Снять отметку: Start — Main" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Dobby — Main" })).toBeInTheDocument();
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatch(/^table-group:/);
  });

  it("keeps table-group ids stable when unrelated text is inserted", () => {
    const markdown = [
      "| Stage | Complete |",
      "| --- | --- |",
      "| Reference |",
      "| --- | --- |",
      "| Prologue | [ ] |",
    ].join("\n");
    const onChange = vi.fn();
    const view = render(<MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={onChange} />);
    const firstToggle = screen.getByRole("button", { name: /^Reference / });
    const firstId = firstToggle.closest(".markdown-table-group")?.getAttribute("data-checklist-section-id");

    view.rerender(<MarkdownView markdown={`Unrelated introduction.\n\n${markdown}`} onCollapsedChecklistSectionsChange={onChange} />);

    const stableToggle = screen.getByRole("button", { name: /^Reference / });
    expect(stableToggle.closest(".markdown-table-group")).toHaveAttribute("data-checklist-section-id", firstId);
  });

  it("lets table groups without tasks collapse without showing progress", async () => {
    const user = userEvent.setup();
    const markdown = [
      "| Stage | Notes |",
      "| --- | --- |",
      "| Reference |",
      "| --- | --- |",
      "| Prologue | Read later |",
    ].join("\n");
    const onChange = vi.fn();
    render(<MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={onChange} />);
    const toggle = screen.getByRole("button", { name: "Reference" });
    const collapseId = toggle.closest(".markdown-table-group")?.getAttribute("data-checklist-section-id");
    expect(toggle.querySelector(".markdown-checklist-progress")).toBeNull();

    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith([collapseId]);
  });

  it("updates only the selected grouped-table task and completes its group", async () => {
    const user = userEvent.setup();
    let currentMarkdown = [
      "# Route",
      "| Stage | Main | Secret |",
      "| --- | --- | --- |",
      "| Philosopher's Stone |",
      "| --- | --- | --- |",
      "| Start | [x] | [ ] |",
      "| --- | --- | --- |",
      "| Chamber of Secrets |",
      "| --- | --- | --- |",
      "| Dobby | [ ] | [ ] |",
    ].join("\r\n");
    const expectedMarkdown = currentMarkdown.replace("| Start | [x] | [ ] |", "| Start | [x] | [x] |");
    let view: ReturnType<typeof render>;
    const onTaskChange = vi.fn((nextMarkdown: string) => {
      currentMarkdown = nextMarkdown;
      view.rerender(<MarkdownView markdown={currentMarkdown} onTaskChange={onTaskChange} />);
    });
    view = render(<MarkdownView markdown={currentMarkdown} onTaskChange={onTaskChange} />);

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Start — Secret" }));

    expect(onTaskChange).toHaveBeenCalledWith(expectedMarkdown);
    expect(screen.getByText("Philosopher's Stone").closest(".markdown-table-group")).toHaveClass("markdown-table-group--complete");
    expect(screen.getByText("Chamber of Secrets").closest(".markdown-table-group")).not.toHaveClass("markdown-table-group--complete");
    expect(screen.getByRole("heading", { name: /^Route / }).querySelector(".markdown-checklist-progress")).toHaveTextContent("2/4");
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

  it("renders green backgrounds for checked cells, completed rows, and completed columns", () => {
    const markdown = [
      "| Stage | Main | Secret |",
      "| --- | --- | --- |",
      "| Start | [x] | [x] |",
      "| Finish | [x] | [ ] |",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const startRow = screen.getByText("Start").closest("tr")!;
    const finishRow = screen.getByText("Finish").closest("tr")!;
    const mainHeader = screen.getByRole("columnheader", { name: "Main" });
    const secretHeader = screen.getByRole("columnheader", { name: "Secret" });

    expect(startRow).toHaveClass("markdown-table-row--complete");
    expect(finishRow).not.toHaveClass("markdown-table-row--complete");
    expect(startRow.querySelectorAll('[data-checklist-checked="true"]')).toHaveLength(2);
    expect(finishRow.querySelectorAll('[data-checklist-checked="true"]')).toHaveLength(1);
    expect(mainHeader).toHaveAttribute("data-checklist-column-complete", "true");
    expect(secretHeader).not.toHaveAttribute("data-checklist-column-complete");
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Start — Main" }).closest("td")).toHaveAttribute("data-checklist-column-complete", "true");
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Finish — Main" }).closest("td")).toHaveAttribute("data-checklist-column-complete", "true");
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

  it("wraps completed and incomplete checklist subsections at their heading boundaries", () => {
    const markdown = [
      "# Root",
      "## Complete alpha",
      "Alpha detail.",
      "- [x] Alpha task",
      "## Complete beta",
      "Beta detail.",
      "- [x] Beta task",
      "## Incomplete parent",
      "Parent detail.",
      "- [ ] Parent task",
      "### Complete child",
      "Complete child detail.",
      "- [x] Child task",
      "### Incomplete child",
      "Incomplete child detail.",
      "- [ ] Other child task",
      "### Plain nested",
      "Plain nested detail.",
      "- Plain nested item",
      "## Plain sibling",
      "Plain sibling detail.",
      "- Plain sibling item",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const completeAlpha = screen.getByRole("heading", { name: "Complete alpha Выполнено 1 из 1" });
    const completeBeta = screen.getByRole("heading", { name: "Complete beta Выполнено 1 из 1" });
    const incompleteParent = screen.getByRole("heading", { name: "Incomplete parent Выполнено 1 из 3" });
    const completeChild = screen.getByRole("heading", { name: "Complete child Выполнено 1 из 1" });
    const incompleteChild = screen.getByRole("heading", { name: "Incomplete child Выполнено 0 из 1" });
    const plainNested = screen.getByRole("heading", { name: "Plain nested" });
    const plainSibling = screen.getByRole("heading", { name: "Plain sibling" });
    const completeAlphaWrapper = completeAlpha.closest<HTMLElement>(".markdown-checklist-subsection");
    const completeBetaWrapper = completeBeta.closest<HTMLElement>(".markdown-checklist-subsection");
    const incompleteParentWrapper = incompleteParent.closest<HTMLElement>(".markdown-checklist-subsection");
    const completeChildWrapper = completeChild.closest<HTMLElement>(".markdown-checklist-subsection");
    const incompleteChildWrapper = incompleteChild.closest<HTMLElement>(".markdown-checklist-subsection");

    expect(completeAlphaWrapper).toHaveClass("markdown-checklist-subsection--complete");
    expect(completeBetaWrapper).toHaveClass("markdown-checklist-subsection--complete");
    expect(incompleteParentWrapper).not.toHaveClass("markdown-checklist-subsection--complete");
    expect(completeChildWrapper).toHaveClass("markdown-checklist-subsection--complete");
    expect(incompleteChildWrapper).not.toHaveClass("markdown-checklist-subsection--complete");
    expect(plainNested.closest(".markdown-checklist-subsection")).toBe(incompleteParentWrapper);
    expect(plainNested.parentElement).toBe(incompleteParentWrapper);
    expect(plainSibling.closest(".markdown-checklist-subsection")).toBeNull();
    expect(completeAlphaWrapper?.parentElement).toBe(completeBetaWrapper?.parentElement);
    expect(completeBetaWrapper?.parentElement).toBe(incompleteParentWrapper?.parentElement);
    expect([...completeAlphaWrapper!.parentElement!.children].filter((child) => child.classList.contains("markdown-checklist-subsection"))).toEqual([
      completeAlphaWrapper,
      completeBetaWrapper,
      incompleteParentWrapper,
    ]);
    expect(completeChildWrapper?.parentElement).toBe(incompleteParentWrapper);
    expect(incompleteChildWrapper?.parentElement).toBe(incompleteParentWrapper);
    expect([...incompleteParentWrapper!.children].filter((child) => child.classList.contains("markdown-checklist-subsection"))).toEqual([
      completeChildWrapper,
      incompleteChildWrapper,
    ]);
    const alphaParagraph = screen.getByText("Alpha detail.").closest("p");
    const betaParagraph = screen.getByText("Beta detail.").closest("p");
    const parentParagraph = screen.getByText("Parent detail.").closest("p");
    const completeChildParagraph = screen.getByText("Complete child detail.").closest("p");
    const incompleteChildParagraph = screen.getByText("Incomplete child detail.").closest("p");
    const plainNestedParagraph = screen.getByText("Plain nested detail.").closest("p");
    const alphaList = screen.getByText("Alpha task").closest("ul");
    const betaList = screen.getByText("Beta task").closest("ul");
    const parentList = screen.getByText("Parent task").closest("ul");
    const completeChildList = screen.getByText("Child task").closest("ul");
    const incompleteChildList = screen.getByText("Other child task").closest("ul");
    const plainNestedList = screen.getByText("Plain nested item").closest("ul");
    for (const [content, owner] of [
      [alphaParagraph, completeAlphaWrapper],
      [alphaList, completeAlphaWrapper],
      [betaParagraph, completeBetaWrapper],
      [betaList, completeBetaWrapper],
      [parentParagraph, incompleteParentWrapper],
      [parentList, incompleteParentWrapper],
      [plainNestedParagraph, incompleteParentWrapper],
      [plainNestedList, incompleteParentWrapper],
      [completeChildParagraph, completeChildWrapper],
      [completeChildList, completeChildWrapper],
      [incompleteChildParagraph, incompleteChildWrapper],
      [incompleteChildList, incompleteChildWrapper],
    ]) expect(content?.parentElement).toBe(owner);
    expect(completeBetaWrapper).not.toContain(alphaParagraph);
    expect(completeAlphaWrapper).not.toContain(betaList);
    expect(completeChildWrapper).not.toContain(parentParagraph);
    expect(incompleteChildWrapper).not.toContain(plainNestedList);
  });

  it("updates a subsection completion wrapper when its last checkbox changes", async () => {
    const user = userEvent.setup();
    let markdown = "# Root\n## Route\n- [x] Done\n- [ ] Pending";
    let view: ReturnType<typeof render>;
    const onTaskChange = vi.fn((nextMarkdown: string) => {
      markdown = nextMarkdown;
      view.rerender(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);
    });
    view = render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    const initialRoute = screen.getByRole("heading", { name: "Route Выполнено 1 из 2" });
    expect(initialRoute.tagName).toBe("H3");
    expect(initialRoute.closest(".markdown-checklist-subsection")).not.toHaveClass("markdown-checklist-subsection--complete");

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Pending" }));

    expect(onTaskChange).toHaveBeenCalledWith("# Root\n## Route\n- [x] Done\n- [x] Pending");
    const completedRoute = screen.getByRole("heading", { name: "Route Выполнено 2 из 2" });
    const completedRouteWrapper = completedRoute.closest<HTMLElement>(".markdown-checklist-subsection");
    expect(completedRoute.tagName).toBe("H3");
    expect(completedRouteWrapper).toHaveClass("markdown-checklist-subsection--complete");
    expect(completedRouteWrapper?.parentElement).toHaveClass("markdown-section");
    expect(completedRouteWrapper?.querySelector(":scope > h3")).toBe(completedRoute);
  });

  it("keeps a collapsed subsection wrapper without creating wrappers for hidden descendants", async () => {
    const user = userEvent.setup();
    const markdown = [
      "# Root",
      "## Collapsed route",
      "### Hidden first",
      "- [x] First task",
      "### Hidden second",
      "- [x] Second task",
      "## Visible sibling",
      "- [ ] Pending task",
    ].join("\n");
    let collapsed: string[] = [];
    let view: ReturnType<typeof render>;
    const onCollapsedChecklistSectionsChange = vi.fn((next: string[]) => {
      collapsed = next;
      view.rerender(
        <MarkdownView
          collapsedChecklistSections={collapsed}
          markdown={markdown}
          onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
        />,
      );
    });
    view = render(
      <MarkdownView
        collapsedChecklistSections={collapsed}
        markdown={markdown}
        onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapsed route Выполнено 2 из 2" }));

    const collapsedRoute = screen.getByRole("heading", { name: "Collapsed route Выполнено 2 из 2" });
    const collapsedRouteWrapper = collapsedRoute.closest<HTMLElement>(".markdown-checklist-subsection");
    expect(collapsedRouteWrapper).toHaveClass("markdown-checklist-subsection--complete");
    expect(collapsedRouteWrapper?.querySelectorAll(".markdown-checklist-subsection")).toHaveLength(0);
    expect(view.container.querySelectorAll(".markdown-checklist-subsection")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: /Hidden first|Hidden second/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visible sibling Выполнено 0 из 1" }).closest(".markdown-checklist-subsection")).toBeInTheDocument();
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

  it("saves a collapsed table group as note state", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const bodyMarkdown = [
      "| Stage | Complete |",
      "| --- | --- |",
      "| Philosopher's Stone |",
      "| --- | --- |",
      "| Intro | [ ] |",
    ].join("\n");
    const note = makeNote(bodyMarkdown);

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /^Philosopher's Stone / }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const savedNote = onSave.mock.calls[0][0].notes[0];
    expect(savedNote.bodyMarkdown).toBe(bodyMarkdown);
    expect(savedNote.collapsedChecklistSections).toHaveLength(1);
    expect(savedNote.collapsedChecklistSections?.[0]).toMatch(/^table-group:/);
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
    const editor = await screen.findByRole("textbox", { name: "Текст заметки" });
    await user.type(editor, " More context");
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave.mock.calls[0][0].notes[0].collapsedChecklistSections).toEqual(note.collapsedChecklistSections);
  });

  it("keeps the controlled checkbox unchanged when saving fails", async () => {
    const user = userEvent.setup();
    let failSave: ((reason: Error) => void) | undefined;
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>(() => new Promise((_resolve, reject) => { failSave = reject; }));

    render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote("- [ ] Retry later")]} onSave={onSave} />);

    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    failSave?.(new Error("Storage failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage failed");
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("updates and locks only the optimistic task note without losing checkbox focus or moving its sibling or the page", async () => {
    const user = userEvent.setup();
    let finishSave: (() => void) | undefined;
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>(() => new Promise((resolve) => { finishSave = resolve; }));
    const first = makeNote("- [ ] First task\n- [ ] Editable task\n- [ ] ...");
    const second = { ...makeNote("- [ ] Second task"), id: "33333333-3333-4333-8333-333333333333" };
    Object.defineProperties(window, {
      scrollX: { configurable: true, value: 140 },
      scrollY: { configurable: true, value: 260 },
    });
    const view = render(<GamePage assets={{}} game={game} mode="game" notes={[first, second]} onSave={onSave} />);
    const firstCheckbox = screen.getByRole("checkbox", { name: "Отметить: First task" });
    const secondCheckbox = screen.getByRole("checkbox", { name: "Отметить: Second task" });
    const firstMarkdown = firstCheckbox.closest(".markdown")!;
    const editButtons = [...firstMarkdown.querySelectorAll<HTMLButtonElement>(".markdown-task-edit-button")];
    const addButton = firstMarkdown.querySelector<HTMLButtonElement>(".markdown-open-checklist-add")!;
    const secondMarkdown = secondCheckbox.closest(".markdown")!;
    const notesGrid = firstMarkdown.closest(".notes-list")!;
    const cardActions = [...notesGrid.querySelectorAll<HTMLElement>(".note-card__actions")];
    const dragButtons = [...notesGrid.querySelectorAll<HTMLButtonElement>(".note-card__drag")];
    const scrollBefore = [window.scrollX, window.scrollY];
    const childListMutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => childListMutations.push(...records.filter((record) => record.type === "childList")));
    observer.observe(notesGrid, { childList: true, subtree: true });
    vi.mocked(parseMarkdownBlocks).mockClear();

    await user.click(firstCheckbox);

    expect(firstCheckbox).toBeChecked();
    expect(firstCheckbox).toHaveFocus();
    expect(firstCheckbox).toHaveAttribute("aria-disabled", "true");
    expect(firstCheckbox).not.toBeDisabled();
    expect(firstMarkdown.querySelectorAll(".markdown-task-edit-button")).toHaveLength(editButtons.length);
    expect([...firstMarkdown.querySelectorAll(".markdown-task-edit-button")]).toEqual(editButtons);
    expect(addButton).toBeDisabled();
    expect(firstMarkdown.querySelector(".markdown-open-checklist-add")).toBe(addButton);
    expect([...notesGrid.querySelectorAll(".note-card__actions")]).toEqual(cardActions);
    expect([...notesGrid.querySelectorAll(".note-card__drag")]).toEqual(dragButtons);
    expect(secondCheckbox).not.toBeDisabled();
    expect(secondCheckbox).not.toHaveAttribute("aria-disabled");
    expect(secondCheckbox.closest(".markdown")).toBe(secondMarkdown);
    expect([window.scrollX, window.scrollY]).toEqual(scrollBefore);
    expect(onSave.mock.calls[0][0].notes.map((note) => note.clientId)).toEqual([first.id, second.id]);
    await Promise.resolve();
    expect(childListMutations).toEqual([]);
    expect(parseMarkdownBlocks).toHaveBeenCalledTimes(1);

    finishSave?.();
    view.rerender(<GamePage assets={{}} game={game} mode="game" notes={[{ ...first, bodyMarkdown: "- [x] First task\n- [ ] Editable task\n- [ ] ..." }, second]} onSave={onSave} />);
    await waitFor(() => expect(firstCheckbox).not.toHaveAttribute("aria-disabled"));
    expect(addButton).not.toBeDisabled();
    expect(secondCheckbox.closest(".markdown")).toBe(secondMarkdown);
    observer.disconnect();
  });

  it("blocks ordinary page actions until the task state is reconciled, then preserves it in the next save", async () => {
    const user = userEvent.setup();
    let finishSave: (() => void) | undefined;
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>(() => new Promise((resolve) => { finishSave = resolve; }));
    const first = makeNote("- [ ] Task");
    const second = { ...makeNote("- [ ] Sibling"), id: "33333333-3333-4333-8333-333333333333" };
    const view = render(<GamePage assets={{}} game={game} mode="game" notes={[first, second]} onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Отметить: Task" }));
    expect(screen.getByRole("button", { name: game.title })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Статус" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeDisabled();
    expect(screen.getAllByRole<HTMLButtonElement>("button", { name: "Редактировать заметку" }).every((button) => button.disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "Добавить заметку в группу 1" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Отметить: Sibling" })).not.toHaveAttribute("aria-disabled");

    finishSave?.();
    view.rerender(<GamePage assets={{}} game={game} mode="game" notes={[{ ...first, bodyMarkdown: "- [x] Task" }, second]} onSave={onSave} />);
    await waitFor(() => expect(screen.getByRole("button", { name: game.title })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: game.title }));
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "Changed title{Enter}");

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0].title).toBe("Changed title");
    expect(onSave.mock.calls[1][0].notes[0].bodyMarkdown).toBe("- [x] Task");
  });

  it("does not start concurrent saves from rapid task clicks", async () => {
    const user = userEvent.setup();
    let finishSave: (() => void) | undefined;
    const onSave = vi.fn<(input: GameSaveInput) => Promise<void>>(() => new Promise((resolve) => { finishSave = resolve; }));

    render(<GamePage assets={{}} game={game} mode="game" notes={[makeNote("- [ ] First\n- [ ] Second")]} onSave={onSave} />);

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    expect(checkboxes[1]).toHaveAttribute("aria-disabled", "true");
    await user.click(checkboxes[1]);
    expect(onSave).toHaveBeenCalledTimes(1);
    finishSave?.();
    await waitFor(() => expect(checkboxes[1]).not.toHaveAttribute("aria-disabled"));
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
