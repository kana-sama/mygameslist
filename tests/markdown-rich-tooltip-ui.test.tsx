import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownView } from "../src/components/Markdown";
import { MarkdownRichTooltipProvider } from "../src/components/MarkdownRichTooltip";
import {
  MarkdownRichTooltipContext,
  type MarkdownRichTooltipController,
} from "../src/components/markdownRichTooltipContext";
import type { Game, Note } from "../src/domain";
import { GamePage, type GameSaveInput } from "../src/pages/GamePage";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  } as DOMRect;
}

let noteRect = rectangle(200, 100, 400, 500);
let sourceRects = new Map<string, DOMRect>();

beforeEach(() => {
  noteRect = rectangle(200, 100, 400, 500);
  sourceRects = new Map([
    ["Archive Entry", rectangle(350, 120, 90, 20)],
    ["Second", rectangle(350, 350, 60, 20)],
  ]);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList.contains("note-card__surface")) return noteRect;
    if (this.classList.contains("markdown-rich-tooltip")) return rectangle(0, 0, 344, 240);
    if (this instanceof HTMLButtonElement) return sourceRects.get(this.textContent ?? "") ?? rectangle(0, 0, 0, 0);
    return rectangle(0, 0, 0, 0);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function RichTooltipHarness({ markdown }: { markdown: string }) {
  return (
    <MarkdownRichTooltipProvider>
      <section className="note-card__surface" data-testid="note-surface">
        <div className="note-card__viewport" data-testid="note-viewport">
          <MarkdownView markdown={markdown} richTooltipsEnabled />
        </div>
      </section>
      <button type="button">Outside</button>
    </MarkdownRichTooltipProvider>
  );
}

const richMarkdown = [
  "Open [Archive Entry][?] and [Second][?]. Legacy [hint](\"Native text\").",
  "",
  "[?Archive Entry]:",
  "    Location",
  "    : **North Wing**",
  "",
  "    [Guide](https://example.com) and ||secret||.",
  "[?Second]:",
  "    Replacement body",
].join("\n");

function renderWithController(controller: MarkdownRichTooltipController, view: ReactElement) {
  return render(
    <MarkdownRichTooltipContext.Provider value={controller}>
      {view}
    </MarkdownRichTooltipContext.Provider>,
  );
}

function idleRichTooltipController(): MarkdownRichTooltipController {
  return {
    getActiveSource: () => null,
    open: vi.fn(),
    subscribeActiveSource: () => () => undefined,
  };
}

describe("Markdown rich tooltip rendering", () => {
  it("renders a single-backtick code span beginning at the second tick of a longer run", () => {
    const view = render(<MarkdownView markdown={"`` [Missing][?missing] `"} richTooltipsEnabled />);

    expect(view.container.querySelector("code")?.textContent).toBe(" [Missing][?missing] ");
    expect(view.container.querySelector(".markdown")?.textContent).toBe("` [Missing][?missing] ");
    expect(screen.queryByRole("button", { name: "Missing" })).not.toBeInTheDocument();
  });

  it("renders complete rich-reference source on an unrelated Markdown surface", () => {
    const view = render(<MarkdownView markdown="Before [**Archive Entry**][?archive-entry] after." />);

    expect(view.container.querySelector(".markdown")?.textContent).toBe("Before [**Archive Entry**][?archive-entry] after.");
    expect(view.container.querySelector("strong")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Entry" })).not.toBeInTheDocument();
  });

  it("degrades an enabled formatted rich reference to its formatted label when no tooltip controller exists", () => {
    const view = render(<MarkdownView
      markdown={"Before [**Archive Entry**][?] after.\n\n[?Archive Entry]:\n    Definition"}
      richTooltipsEnabled
    />);

    expect(view.container.querySelector(".markdown")?.textContent).toBe("Before Archive Entry after.");
    expect(view.container.querySelector("strong")?.textContent).toBe("Archive Entry");
    expect(screen.queryByRole("button", { name: "Archive Entry" })).not.toBeInTheDocument();
    expect(screen.queryByText("Definition")).not.toBeInTheDocument();
  });

  it("uses a rendered title anchor for active rich-tooltip triggers and leaves legacy slug syntax literal", () => {
    const controller = idleRichTooltipController();
    const markdown = [
      "Open [**Archive Entry**][?]. Legacy [Archive Entry][?archive-entry].",
      "",
      "[?Archive Entry]:",
      "    Synthetic body",
    ].join("\n");

    const view = renderWithController(controller, <MarkdownView markdown={markdown} richTooltipsEnabled />);

    const trigger = screen.getByRole("button", { name: "Archive Entry" });
    expect(trigger.querySelector("strong")).toHaveTextContent("Archive Entry");
    expect(view.container.querySelector(".markdown")?.textContent).toBe(
      "Open Archive Entry. Legacy [Archive Entry][?archive-entry].",
    );
    expect(screen.queryByText("[?Archive Entry]:")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(controller.open).toHaveBeenCalledWith(expect.objectContaining({
      anchor: "Archive Entry",
      bodyMarkdown: "Synthetic body",
      layer: "note",
      registry: expect.objectContaining({
        definitions: expect.any(Map),
        duplicateAnchors: expect.any(Set),
      }),
      sourceElement: trigger,
      title: "Archive Entry",
    }));
  });

  it("keeps escaped references literal and ignores rich-looking text in link metadata", () => {
    const controller = idleRichTooltipController();
    const markdown = [
      String.raw`\[Escaped][?] [Visible][?] [Hint]("see [Inner][?entry]") [Guide](https://example.test/[Path][?entry] "see [Title][?entry]")`,
      "",
      "[?Visible]:",
      "    Synthetic body",
    ].join("\n");

    const view = renderWithController(controller, <MarkdownView markdown={markdown} richTooltipsEnabled />);

    expect(view.container.querySelector(".markdown")?.textContent).toBe(
      '[Escaped][?] Visible Hint Guide',
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Visible" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Escaped" })).not.toBeInTheDocument();
  });

  it("activates a rich reference after an even backslash run", () => {
    const controller = idleRichTooltipController();
    const markdown = [
      String.raw`\\[Visible][?]`,
      "",
      "[?Visible]:",
      "    Synthetic body",
    ].join("\n");

    const view = renderWithController(controller, <MarkdownView markdown={markdown} richTooltipsEnabled />);

    expect(view.container.querySelector(".markdown")?.textContent).toBe("\\Visible");
    expect(screen.getByRole("button", { name: "Visible" })).toBeInTheDocument();
  });

  it("renders legacy slug syntax literally and activates the title-anchor form", () => {
    const controller = idleRichTooltipController();
    const markdown = [
      "[Leading][?-entry] [Trailing][?entry-] [Interior][?]",
      "",
      "[?Interior]:",
      "    Interior body",
    ].join("\n");

    const view = renderWithController(controller, <MarkdownView markdown={markdown} richTooltipsEnabled />);

    expect(view.container.querySelector(".markdown")?.textContent).toBe(
      "[Leading][?-entry] [Trailing][?entry-] Interior",
    );
    expect(screen.queryByRole("button", { name: "Leading" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trailing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Interior" })).toBeInTheDocument();
  });

  it("uses noninteractive rendered label text for trigger names and repeated dialog titles", async () => {
    const markdown = [
      "[save_slot][?] [`slot_id`][?] [*save*][?] [save\\|slot][?] [||secret||][?]",
      "",
      "[?save_slot]:",
      "    Literal body",
      "[?slot_id]:",
      "    Code body",
      "[?save]:",
      "    Emphasis body",
      "[?save|slot]:",
      "    Escape body",
      "[?secret]:",
      "    Spoiler body",
    ].join("\n");
    render(<RichTooltipHarness markdown={markdown} />);

    for (const name of ["save_slot", "slot_id", "save", "save|slot", "secret"]) {
      const trigger = screen.getByRole("button", { name });
      expect(trigger).toHaveAccessibleName(name);
      expect(trigger.querySelector("a, button, [role=button]")).toBeNull();
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.querySelector(".markdown-rich-tooltip__title")).toHaveTextContent(name);
      expect(dialog).toHaveAccessibleName(name);
      fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    }
  });

  it("keeps title anchors identical to rendered labels for unsupported escapes and literal spoiler delimiters", async () => {
    const markdown = [
      String.raw`[A\q][?] [||a|b||][?] [**Outer _inner_** \| ||secret||][?]`,
      "",
      String.raw`[?A\q]:`,
      "    Backslash body",
      "[?||a|b||]:",
      "    Literal spoiler body",
      "[?Outer inner | secret]:",
      "    Formatted body",
    ].join("\n");
    render(<RichTooltipHarness markdown={markdown} />);

    for (const name of [String.raw`A\q`, "||a|b||", "Outer inner | secret"]) {
      const trigger = screen.getByRole("button", { name });
      expect(trigger).toHaveAccessibleName(name);
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.querySelector(".markdown-rich-tooltip__title")).toHaveTextContent(name);
      expect(dialog).toHaveAccessibleName(name);
      fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    }
  });

  it("does not commit an unrelated sibling Markdown body when a tooltip opens or closes", async () => {
    const siblingCommits = vi.fn();
    render(
      <MarkdownRichTooltipProvider>
        <section className="note-card__surface">
          <div className="note-card__viewport">
            <MarkdownView markdown={"[Primary][?]\n\n[?Primary]:\n    Primary body"} richTooltipsEnabled />
          </div>
        </section>
        <section className="note-card__surface">
          <div className="note-card__viewport">
            <Profiler id="unrelated-markdown" onRender={siblingCommits}>
              <MarkdownView markdown={"[Sibling][?]\n\n[?Sibling]:\n    Sibling body"} richTooltipsEnabled />
            </Profiler>
          </div>
        </section>
      </MarkdownRichTooltipProvider>,
    );

    siblingCommits.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    const dialog = await screen.findByRole("dialog");
    expect(siblingCommits).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(siblingCommits).not.toHaveBeenCalled();
  });

  it("integrates one repositioning tooltip across rendered game-note cards without losing source definitions", async () => {
    const gameId = "11111111-1111-4111-8111-111111111111";
    const firstNoteId = "22222222-2222-4222-8222-222222222222";
    const secondNoteId = "33333333-3333-4333-8333-333333333333";
    const timestamp = "2026-08-30T00:00:00.000Z";
    const firstMarkdown = [
      "# Field Notes",
      "- [ ] Visit [Archive Entry][?]",
      "",
      "[?Archive Entry]:",
      "    **North Wing**",
    ].join("\n");
    const secondMarkdown = [
      "# Affinity",
      "Open [Second][?].",
      "",
      "[?Second]:",
      "    Replacement body",
    ].join("\n");
    const game: Game = {
      id: gameId,
      title: "Synthetic game",
      coverAssetId: null,
      platforms: [],
      tags: [],
      status: "playing",
      placement: { tierId: "unranked", rank: 1024 },
      reviewMarkdown: "Review [**Review reference**][?review].",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const initialNotes: Note[] = [
      { id: firstNoteId, gameId, bodyMarkdown: firstMarkdown, attachments: [], rank: 1024, createdAt: timestamp, updatedAt: timestamp },
      { id: secondNoteId, gameId, bodyMarkdown: secondMarkdown, attachments: [], rank: 2048, createdAt: timestamp, updatedAt: timestamp },
    ];
    const onSave = vi.fn<(input: GameSaveInput) => void>();

    render(<GamePage assets={{}} game={game} mode="game" notes={initialNotes} onSave={onSave} />);

    const firstCard = document.querySelector<HTMLElement>(`.note-card[data-note-id="${firstNoteId}"]`)!;
    const secondCard = document.querySelector<HTMLElement>(`.note-card[data-note-id="${secondNoteId}"]`)!;
    const reviewCard = document.querySelector<HTMLElement>(`.note-card[data-note-id="legacy-review:${gameId}"]`)!;
    expect(within(firstCard).getByRole("heading", { name: /^Field Notes/ }).parentElement).toHaveClass("note-card__page-heading");
    expect(within(firstCard).queryByText("North Wing")).not.toBeInTheDocument();
    expect(reviewCard.querySelector(".note-card__content")?.textContent).toBe("Review [**Review reference**][?review].");
    expect(reviewCard.querySelector("strong")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review reference" })).not.toBeInTheDocument();

    const firstTrigger = within(firstCard).getByRole("button", { name: "Archive Entry" });
    fireEvent.click(firstTrigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.closest(".note-card")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    const firstViewport = firstCard.querySelector<HTMLElement>(".note-card__viewport")!;
    const initialTop = dialog.style.top;
    sourceRects.set("Archive Entry", rectangle(350, 350, 90, 20));
    fireEvent.scroll(firstViewport);
    await waitFor(() => expect(dialog.style.top).not.toBe(initialTop));
    expect(screen.getByRole("dialog")).toBe(dialog);

    fireEvent.click(within(secondCard).getByRole("button", { name: "Second" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog).getByText("Replacement body")).toBeInTheDocument();
    expect(within(dialog).queryByText("North Wing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    fireEvent.click(within(firstCard).getByRole("checkbox", { name: "Отметить: Visit [Archive Entry][?]" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes.find((note) => note.clientId === firstNoteId)?.bodyMarkdown).toBe(firstMarkdown.replace("[ ]", "[x]"));

    fireEvent.click(within(firstCard).getByRole("button", { name: "Редактировать пункт: Visit [Archive Entry][?]" }));
    const taskEditor = within(firstCard).getByRole("textbox", { name: "Текст пункта: Visit [Archive Entry][?]" });
    fireEvent.change(taskEditor, { target: { value: "Revisit [Archive Entry][?]" } });
    fireEvent.keyDown(taskEditor, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].notes.find((note) => note.clientId === firstNoteId)?.bodyMarkdown).toBe(
      firstMarkdown.replace("[ ] Visit [Archive Entry][?]", "[x] Revisit [Archive Entry][?]"),
    );
  });

  it("opens a unique defined reference and preserves terminal definitions through both task callbacks", () => {
    const markdown = "# Note\n- [ ] [**Archive Entry**][?]\n\n[?Archive Entry]:\n    **Body**";
    const onTaskChange = vi.fn();
    const onTaskCheckboxChange = vi.fn();
    const controller = idleRichTooltipController();

    renderWithController(controller, <MarkdownView
      markdown={markdown}
      onTaskChange={onTaskChange}
      onTaskCheckboxChange={onTaskCheckboxChange}
      richTooltipsEnabled
    />);

    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Archive Entry" });
    fireEvent.click(trigger);
    expect(controller.open).toHaveBeenCalledWith(expect.objectContaining({
      anchor: "Archive Entry",
      bodyMarkdown: "**Body**",
      layer: "note",
      registry: expect.objectContaining({
        definitions: expect.any(Map),
        duplicateAnchors: expect.any(Set),
      }),
      sourceElement: trigger,
      title: "Archive Entry",
    }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: [Archive Entry][?]" }));
    expect(onTaskCheckboxChange).toHaveBeenCalledWith(markdown.replace("[ ]", "[x]"));
    expect(onTaskChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Редактировать пункт: [Archive Entry][?]" }));
    const editor = screen.getByRole("textbox", { name: "Текст пункта: [Archive Entry][?]" });
    fireEvent.change(editor, { target: { value: "Updated" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onTaskChange).toHaveBeenCalledWith(markdown.replace("[**Archive Entry**][?]", "Updated"));
  });

  it("renders missing, duplicate, and disabled references as noninteractive labels", () => {
    const controller = idleRichTooltipController();
    const missingAndDuplicate = [
      "[Missing][?] [Duplicate][?]",
      "",
      "[?Duplicate]:",
      "    First",
      "[?Duplicate]:",
      "    Second",
    ].join("\n");

    const view = renderWithController(controller, <MarkdownView markdown={missingAndDuplicate} richTooltipsEnabled />);
    expect(view.container).toHaveTextContent("Missing Duplicate");
    expect(screen.queryByRole("button", { name: "Missing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
    expect(controller.open).not.toHaveBeenCalled();
    view.unmount();

    renderWithController(controller, <MarkdownView
      markdown={"[Disabled][?]\n\n[?Disabled]:\n    Body"}
      richTooltipTriggersDisabled
      richTooltipsEnabled
    />);
    expect(document.body).toHaveTextContent("Disabled");
    expect(screen.queryByRole("button", { name: "Disabled" })).not.toBeInTheDocument();
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("resolves nested references from the source registry and replaces cyclic bodies in one dialog", async () => {
    const markdown = [
      "Open [Primary][?].",
      "",
      "[?Primary]:",
      "    Open [Nested][?], [Missing][?], and [Duplicate][?].",
      "[?Nested]:",
      "    Back to [Primary][?].",
      "[?Duplicate]:",
      "    First duplicate",
      "[?Duplicate]:",
      "    Second duplicate",
    ].join("\n");
    render(<RichTooltipHarness markdown={markdown} />);

    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    const dialog = await screen.findByRole("dialog", { name: "Primary" });
    const initialPlacement = {
      arrowTop: dialog.style.getPropertyValue("--markdown-rich-tooltip-arrow-top"),
      left: dialog.style.left,
      side: dialog.getAttribute("data-side"),
      top: dialog.style.top,
    };
    expect(initialPlacement).toEqual({
      arrowTop: expect.stringMatching(/\d+px/),
      left: expect.stringMatching(/\d+px/),
      side: "right",
      top: expect.stringMatching(/\d+px/),
    });
    expect(within(dialog).getByRole("button", { name: "Nested" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Missing" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Nested" }));
    expect(await screen.findByRole("dialog", { name: "Nested" })).toBe(dialog);
    expect({
      arrowTop: dialog.style.getPropertyValue("--markdown-rich-tooltip-arrow-top"),
      left: dialog.style.left,
      side: dialog.getAttribute("data-side"),
      top: dialog.style.top,
    }).toEqual(initialPlacement);
    expect(document.querySelectorAll(".markdown-rich-tooltip")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Primary" }));
    expect(await screen.findByRole("dialog", { name: "Primary" })).toBe(dialog);
    expect({
      arrowTop: dialog.style.getPropertyValue("--markdown-rich-tooltip-arrow-top"),
      left: dialog.style.left,
      side: dialog.getAttribute("data-side"),
      top: dialog.style.top,
    }).toEqual(initialPlacement);
    expect(document.querySelectorAll(".markdown-rich-tooltip")).toHaveLength(1);
  });

  it("renders an unresolved title anchor as a noninteractive label when a blank definition exists", () => {
    const controller = idleRichTooltipController();

    renderWithController(controller, <MarkdownView
      markdown={"[Invalid][?]\n\n[?]:\n    Body"}
      richTooltipsEnabled
    />);

    expect(document.body).toHaveTextContent("Invalid");
    expect(screen.queryByRole("button", { name: "Invalid" })).not.toBeInTheDocument();
  });

  it("renders a reference with an empty terminal definition as a noninteractive label", () => {
    const controller = idleRichTooltipController();

    renderWithController(controller, <MarkdownView
      markdown={"[Label][?]\n\n[?Label]:\n"}
      richTooltipsEnabled
    />);

    expect(document.body).toHaveTextContent("Label");
    expect(screen.queryByRole("button", { name: "Label" })).not.toBeInTheDocument();
  });

  it("keeps one body portal outside the note and dismisses desktop only through X or a true outside click", async () => {
    render(<RichTooltipHarness markdown={richMarkdown} />);

    const trigger = screen.getByRole("button", { name: "Archive Entry" });
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.closest(".note-card__surface")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText("Archive Entry")).toBeInTheDocument();
    expect(within(dialog).getByText("North Wing")).toBeInTheDocument();
    expect(within(dialog).getByText("Location").closest("dt")).toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseLeave(dialog);
    fireEvent.scroll(screen.getByTestId("note-viewport"));
    fireEvent.scroll(document);
    fireEvent(window, new Event("resize"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);

    fireEvent.click(within(dialog).getByText("North Wing"));
    expect(screen.getByRole("dialog")).toBe(dialog);

    const second = screen.getByRole("button", { name: "Second" });
    fireEvent.click(second);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog).getByText("Second")).toBeInTheDocument();
    expect(within(dialog).getByText("Replacement body")).toBeInTheDocument();
    expect(within(dialog).queryByText("North Wing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(second).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "Закрыть" });
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    const legacy = screen.getByText("hint");
    expect(legacy.tagName).toBe("SPAN");
    expect(legacy).toHaveClass("markdown-hover-hint");
    expect(legacy).toHaveAttribute("title", "Native text");
  });

  it("renders definition-like fenced tooltip content as code instead of a semantic definition list", async () => {
    const markdown = [
      "Open [Code sample][?].",
      "",
      "[?Code sample]:",
      "    ```md",
      "    Term",
      "    : Value",
      "    ```",
    ].join("\n");
    render(<RichTooltipHarness markdown={markdown} />);

    fireEvent.click(screen.getByRole("button", { name: "Code sample" }));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.querySelector(".markdown-rich-tooltip__definition-list")).not.toBeInTheDocument();
    expect(dialog.querySelector("code")?.textContent).toContain("Term\n: Value");
  });

  it("prefers right placement, falls back left, and clamps the card and arrow within note bounds", async () => {
    render(<RichTooltipHarness markdown={richMarkdown} />);
    const trigger = screen.getByRole("button", { name: "Archive Entry" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toHaveClass("markdown-rich-tooltip--desktop");
    expect(dialog).toHaveAttribute("data-side", "right");
    expect(dialog.style.left).toBe("614px");
    expect(dialog.style.maxHeight).toBe("500px");
    const arrow = dialog.querySelector<HTMLElement>(".markdown-rich-tooltip__arrow")!;
    const card = dialog.querySelector<HTMLElement>(".markdown-rich-tooltip__card")!;
    expect(arrow.parentElement).toBe(dialog);
    expect(card.parentElement).toBe(dialog);
    expect(card).toContainElement(within(dialog).getByRole("button", { name: "Закрыть" }));

    const verticalCases = [
      { source: rectangle(350, 70, 90, 20), expectedTop: 100, expectedArrow: 18 },
      { source: rectangle(350, 350, 90, 20), expectedTop: 329, expectedArrow: 31 },
      { source: rectangle(350, 580, 90, 20), expectedTop: 360, expectedArrow: 222 },
    ];
    for (const testCase of verticalCases) {
      sourceRects.set("Archive Entry", testCase.source);
      fireEvent(window, new Event("resize"));
      const top = Number.parseFloat(dialog.style.top);
      const arrow = Number.parseFloat(dialog.style.getPropertyValue("--markdown-rich-tooltip-arrow-top"));
      expect(top).toBe(testCase.expectedTop);
      expect(top).toBeGreaterThanOrEqual(noteRect.top);
      expect(top + 240).toBeLessThanOrEqual(noteRect.bottom);
      expect(arrow).toBe(testCase.expectedArrow);
      expect(arrow).toBeGreaterThanOrEqual(18);
      expect(arrow).toBeLessThanOrEqual(222);
    }

    noteRect = rectangle(600, 100, 400, 500);
    sourceRects.set("Archive Entry", rectangle(800, 350, 90, 20));
    fireEvent(window, new Event("resize"));
    expect(dialog).toHaveAttribute("data-side", "left");
    expect(dialog.style.left).toBe("242px");
  });

  it("keeps desktop placement in document coordinates without rereading geometry on page scroll", async () => {
    vi.stubGlobal("scrollX", 40);
    vi.stubGlobal("scrollY", 300);
    render(<RichTooltipHarness markdown={richMarkdown} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive Entry" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.style.left).toBe("654px");
    expect(dialog.style.top).toBe("400px");

    const geometryReadCount = vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;
    window.scrollX = 80;
    window.scrollY = 440;
    noteRect = rectangle(160, -40, 400, 500);
    sourceRects.set("Archive Entry", rectangle(310, -20, 90, 20));
    fireEvent.scroll(document);

    expect(dialog.style.left).toBe("654px");
    expect(dialog.style.top).toBe("400px");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(vi.mocked(Element.prototype.getBoundingClientRect).mock.calls).toHaveLength(geometryReadCount);
  });

  it("routes forward Tab from the active desktop trigger directly to X past intervening controls", async () => {
    render(<RichTooltipHarness markdown={richMarkdown} />);
    const trigger = screen.getByRole("button", { name: "Archive Entry" });
    const intervening = screen.getByRole("button", { name: "Outside" });
    trigger.focus();
    fireEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "Закрыть" });

    expect(trigger).toHaveFocus();
    expect(trigger.compareDocumentPosition(intervening) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(intervening.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    expect(fireEvent.keyDown(trigger, { key: "Tab", shiftKey: true })).toBe(true);
    expect(trigger).toHaveFocus();
    expect(fireEvent.keyDown(trigger, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();
    expect(intervening).not.toHaveFocus();
  });

  it("uses a fullscreen modal when neither side fits and traps focus until X restores the trigger", async () => {
    noteRect = rectangle(100, 100, 1000, 500);
    sourceRects.set("Archive Entry", rectangle(500, 300, 90, 20));
    render(<RichTooltipHarness markdown={richMarkdown} />);

    const trigger = screen.getByRole("button", { name: "Archive Entry" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Закрыть" });
    const lastFocusable = within(dialog).getByRole("button", { name: "Показать спойлер" });

    await waitFor(() => expect(dialog).toHaveClass("markdown-rich-tooltip--fullscreen"));
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.querySelector(".markdown-rich-tooltip__arrow")).not.toBeInTheDocument();
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(lastFocusable).toHaveFocus();
    fireEvent.keyDown(lastFocusable, { key: "Tab" });
    expect(close).toHaveFocus();

    const body = dialog.querySelector<HTMLElement>(".markdown-rich-tooltip__body")!;
    body.scrollTop = 80;
    fireEvent.scroll(body);
    fireEvent.click(document.body);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(body.scrollTop).toBe(80);

    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
