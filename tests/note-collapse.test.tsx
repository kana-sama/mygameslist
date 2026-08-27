import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

interface RecordedCollapseAnimation {
  animation: Animation & { finish: () => void };
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

function collapseMotionRect(top: number, height = 10, width = 280, left = 10): DOMRect {
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

function installProductionStyles(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = productionStyles;
  document.head.append(style);
  return style;
}

function resolveComputedValue(element: HTMLElement, property: string): string {
  const styles = getComputedStyle(element);
  const value = styles.getPropertyValue(property).trim();
  const variable = value.match(/^var\((--[^,)\s]+)\)$/)?.[1];
  return variable ? styles.getPropertyValue(variable).trim() : value;
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("scrollable long note cards", () => {
  it("keeps a focused note action panel above sticky headings in adjacent groups", () => {
    const style = installProductionStyles();
    const notes = [
      { ...makeNote("22222222-2222-4222-8222-222222222222", "Upper note", 1024), groupRank: 1024 },
      { ...makeNote("33333333-3333-4333-8333-333333333333", "# Lower note", 1024), groupRank: 2048 },
    ];

    try {
      render(<GamePage assets={{}} game={game} mode="game" notes={notes} onSave={vi.fn()} />);
      const upperCard = screen.getByText("Upper note").closest<HTMLElement>("article")!;
      const lowerCard = screen.getByRole("heading", { name: "Lower note" }).closest<HTMLElement>("article")!;
      const upperActions = upperCard.querySelector<HTMLElement>(".note-card__actions")!;
      const lowerHeading = lowerCard.querySelector<HTMLElement>(".note-card__page-heading")!;

      within(upperCard).getByRole("button", { name: "Редактировать заметку" }).focus();

      const competingNoteZIndex = Number(getComputedStyle(lowerHeading).zIndex);
      const activeCardRule = Array.from(style.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .find((rule) => rule.selectorText === ".note-card:not(.note-card--editing):hover, .note-card:not(.note-card--editing):focus-within");
      expect(upperCard.matches(":focus-within")).toBe(true);
      expect(Number(activeCardRule?.style.zIndex)).toBeGreaterThan(competingNoteZIndex);
      expect(Number(getComputedStyle(upperActions).zIndex)).toBeGreaterThan(competingNoteZIndex);
    } finally {
      style.remove();
    }
  });

  it("keeps Markdown table overflow horizontal only", () => {
    const style = installProductionStyles();

    try {
      const { container } = render(<MarkdownView markdown={[
        "| Level | Done |",
        "| --- | --- |",
        "| Long level name | [ ] |",
      ].join("\n")} />);
      const tableScroll = container.querySelector<HTMLElement>(".markdown-table-scroll");

      expect(tableScroll).not.toBeNull();
      expect(getComputedStyle(tableScroll!).overflowX).toBe("auto");
      expect(getComputedStyle(tableScroll!).overflowY).toBe("hidden");
    } finally {
      style.remove();
    }
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

  it("keeps attachments above and outside the scrolling text area", () => {
    const assetId = "a".repeat(64);
    const asset: Asset = { id: assetId, kind: "image", mime: "image/webp", width: 720, height: 1280, byteLength: 100, alt: "Tall map", originalName: "map.webp" };
    const note: Note = {
      ...makeNote("22222222-2222-4222-8222-222222222222", `Long text\n\n${"Tail\n\n".repeat(80)}`, 1024),
      attachments: [{ type: "image", assetId, alt: "Tall map" }],
    };

    render(<GamePage assets={{ [assetId]: asset }} game={game} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => "/media/map.webp"} />);

    const card = screen.getByText("Long text").closest<HTMLElement>("article")!;
    const surface = card.querySelector<HTMLElement>(".note-card__surface")!;
    const attachment = within(card).getByRole("link", { name: "Открыть изображение «Tall map» в новой вкладке" });
    expect(Array.from(surface.children).map((child) => child.className)).toEqual(["note-attachments", "note-card__text"]);
    expect(attachment.closest(".note-card__viewport")).toBeNull();
    expect(attachment).toHaveAttribute("href", "/media/map.webp");
    expect(attachment).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("renders only the first top-level heading as paired visual and semantic title layers", () => {
    const note = makeNote(
      "22222222-2222-4222-8222-222222222222",
      [
        "# Primary route",
        "- [ ] Root task",
        "## Nested progress",
        "- [ ] Nested task",
        "# Later route",
        "- [ ] Later task",
      ].join("\n"),
      1024,
    );

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

    const card = screen.getByRole("heading", { name: /^Primary route / }).closest<HTMLElement>("article")!;
    const primaryHeadings = Array.from(card.querySelectorAll<HTMLHeadingElement>("h2"))
      .filter((heading) => heading.textContent?.includes("Primary route"));
    const innerHeading = card.querySelector<HTMLHeadingElement>(".markdown-note-title--inner");
    const outerHeading = card.querySelector<HTMLHeadingElement>(".note-card__page-heading > .markdown-note-title--outer");
    const laterHeading = Array.from(card.querySelectorAll<HTMLHeadingElement>("h2"))
      .find((heading) => heading.textContent?.includes("Later route"));
    const nestedHeading = Array.from(card.querySelectorAll<HTMLHeadingElement>("h3"))
      .find((heading) => heading.textContent?.includes("Nested progress"));

    expect(primaryHeadings).toHaveLength(2);
    expect(screen.getAllByRole("heading", { name: /^Primary route / })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Primary route / })).toHaveLength(1);
    expect(innerHeading).toHaveAttribute("aria-hidden", "true");
    expect(outerHeading?.closest(".note-card__page-heading")?.closest("article")).toBe(card);
    expect(laterHeading).not.toHaveClass("markdown-note-title--inner", "markdown-note-title--outer");
    expect(nestedHeading).not.toHaveClass("markdown-note-title--inner", "markdown-note-title--outer");
  });

  it("renders a plain first title as two layers with one semantic heading and no controls", () => {
    const note = makeNote(
      "22222222-2222-4222-8222-222222222222",
      "# Plain title",
      1024,
    );

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

    const accessibleHeading = screen.getByRole("heading", { level: 2, name: "Plain title" });
    const card = accessibleHeading.closest<HTMLElement>("article")!;
    const titleHeadings = Array.from(card.querySelectorAll<HTMLHeadingElement>("h2"))
      .filter((heading) => heading.textContent === "Plain title");
    const innerHeading = card.querySelector<HTMLHeadingElement>(".markdown-note-title--inner");
    const outerHeading = card.querySelector<HTMLHeadingElement>(
      ".note-card__page-heading > .markdown-note-title--outer",
    );
    const controlSelector = "button, input, select, textarea, [role='button'], [aria-expanded], [tabindex]";
    const titleControls = titleHeadings.flatMap((heading) => [
      ...(heading.matches(controlSelector) ? [heading] : []),
      ...Array.from(heading.querySelectorAll(controlSelector)),
    ]);

    expect(titleHeadings).toHaveLength(2);
    expect(screen.getAllByRole("heading", { level: 2, name: "Plain title" })).toHaveLength(1);
    expect(titleControls).toHaveLength(0);
    expect(innerHeading).toBe(titleHeadings.find((heading) => heading.classList.contains("markdown-note-title--inner")));
    expect(innerHeading).toHaveClass("markdown-note-title--inner");
    expect(innerHeading).toHaveAttribute("aria-hidden", "true");
    expect(outerHeading).toBe(accessibleHeading);
    expect(outerHeading).toHaveClass("markdown-note-title--outer");
  });

  it("keeps a top-level heading after ordinary Markdown single-copy and outside the page title layer", () => {
    const note = makeNote(
      "22222222-2222-4222-8222-222222222222",
      "Intro paragraph\n\n# Later title\n\n- [ ] Later task",
      1024,
    );

    render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: /^Later title / });
    const card = heading.closest<HTMLElement>("article")!;
    const pageHost = card.querySelector<HTMLElement>(".note-card__page-heading")!;

    expect(Array.from(card.querySelectorAll("h2")).filter((item) => item.textContent?.includes("Later title"))).toHaveLength(1);
    expect(screen.getAllByRole("heading", { name: /^Later title / })).toHaveLength(1);
    expect(heading).not.toHaveClass("markdown-note-title--inner", "markdown-note-title--outer");
    expect(card.querySelectorAll(".markdown-note-title--inner, .markdown-note-title--outer")).toHaveLength(0);
    expect(pageHost).toBeEmptyDOMElement();
  });

  it("keeps detached Markdown single-copy when it has no note-card heading host", () => {
    render(<MarkdownView markdown="# Plain first heading" />);

    expect(screen.getAllByRole("heading", { name: "Plain first heading" })).toHaveLength(1);
    expect(document.querySelectorAll(".markdown-note-title--inner, .markdown-note-title--outer")).toHaveLength(0);
  });

  it("uses the accessible outer title control for collapse without scroll-time replacement", async () => {
    const style = installProductionStyles();
    try {
      const user = userEvent.setup();
      const onSave = vi.fn();
      const note = makeNote(
        "22222222-2222-4222-8222-222222222222",
        "# Primary route\n- [ ] Root task\n\nLong content\n\nLong content",
        1024,
      );

      render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);

      const card = screen.getByRole("heading", { name: /^Primary route / }).closest<HTMLElement>("article")!;
      const viewport = card.querySelector<HTMLElement>(".note-card__viewport")!;
      const innerHeading = card.querySelector<HTMLHeadingElement>(".markdown-note-title--inner")!;
      const outerHeading = card.querySelector<HTMLHeadingElement>(".markdown-note-title--outer")!;
      const pageHeading = card.querySelector<HTMLElement>(".note-card__page-heading")!;
      const outerButton = within(outerHeading).getByRole("button", { name: /^Primary route / });
      const innerButton = innerHeading.querySelector<HTMLButtonElement>("button")!;
      outerButton.focus();
      expect(outerButton).toHaveFocus();
      expect(innerButton.tabIndex).toBe(-1);
      expect(innerHeading).toHaveAttribute("aria-hidden", "true");
      expect(within(innerHeading).queryByRole("button")).toBeNull();
      await user.click(outerButton);
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0][0].notes[0].collapsedChecklistSections).toEqual([outerHeading.dataset.checklistSectionId]);

      const outerState = pageHeading.querySelector<HTMLElement>(".markdown-checklist-heading__collapsed-state")!;
      const innerState = innerHeading.nextElementSibling as HTMLElement;
      expect(outerState).toHaveTextContent("Свернуто · 1 пунктов внутри");
      expect(outerState).not.toHaveClass("markdown-checklist-heading__collapsed-state--placeholder");
      expect(outerState.previousElementSibling).toBe(outerHeading);
      expect(innerState).toHaveClass(
        "markdown-checklist-heading__collapsed-state",
        "markdown-checklist-heading__collapsed-state--placeholder",
      );
      expect(innerState.previousElementSibling).toBe(innerHeading);
      const stateBlocks = Array.from(card.querySelectorAll<HTMLElement>(".markdown-checklist-heading__collapsed-state"));
      expect(stateBlocks).toHaveLength(2);
      expect(getComputedStyle(outerState).visibility).toBe("visible");
      expect(getComputedStyle(innerState).visibility).toBe("hidden");
      expect(stateBlocks.filter((state) => getComputedStyle(state).visibility !== "hidden")).toEqual([outerState]);
      expect(screen.getAllByRole("heading", { name: /^Primary route / })).toHaveLength(1);

      const before = [innerHeading, outerHeading].map((heading) => ({ className: heading.className, style: heading.getAttribute("style") }));

      fireEvent.scroll(viewport);
      fireEvent.scroll(window);
      expect([innerHeading, outerHeading].every((heading) => heading.isConnected)).toBe(true);
      expect([innerHeading, outerHeading].map((heading) => ({ className: heading.className, style: heading.getAttribute("style") }))).toEqual(before);
      expect(screen.getAllByRole("heading", { name: /^Primary route / })).toHaveLength(1);
    } finally {
      style.remove();
    }
  });

  it("animates explicit checklist collapse through the production heading portal", async () => {
    const animations: RecordedCollapseAnimation[] = [];
    const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function animate(keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions): Animation {
        const animation = {
          oncancel: null as Animation["oncancel"],
          onfinish: null as Animation["onfinish"],
          cancel() {
            this.oncancel?.(new Event("cancel") as AnimationPlaybackEvent);
          },
          finish() {
            this.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
          },
        };
        animations.push({
          animation: animation as unknown as RecordedCollapseAnimation["animation"],
          element: this,
          keyframes: Array.isArray(keyframes) ? keyframes : [],
          options: typeof options === "number" ? { duration: options } : options ?? {},
        });
        return animation as unknown as Animation;
      },
      writable: true,
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
      if (this.classList.contains("note-card__page-heading")) return collapseMotionRect(10, 80, 300, 0);
      if (this.classList.contains("markdown") && !this.classList.contains("note-card__page-heading")) return collapseMotionRect(100, 240, 300, 0);
      if (this.closest(".markdown-note-title--outer") && this.hasAttribute("aria-expanded")) return collapseMotionRect(20, 20, 280, 10);
      if (this.closest(".markdown-note-title--inner") && this.hasAttribute("aria-expanded")) return collapseMotionRect(210, 20, 280, 10);
      if (this.classList.contains("markdown-checklist-heading__collapsed-state--placeholder")) return collapseMotionRect(220, 10, 280, 10);
      if (this.classList.contains("markdown-checklist-heading__collapsed-state")) return collapseMotionRect(50, 10, 280, 10);
      if (this.getAttribute("data-checklist-collapse-motion-owner") && this.tagName === "P") return collapseMotionRect(140, 10, 280, 10);
      if (this.getAttribute("data-checklist-collapse-motion-owner") && (this.tagName === "UL" || this.tagName === "OL")) return collapseMotionRect(170, 20, 280, 10);
      return collapseMotionRect(0);
    });
    const note = makeNote(
      "22222222-2222-4222-8222-222222222222",
      "# Primary route\nContext\n\n- [ ] Root task",
      1024,
    );

    try {
      render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);
      const card = screen.getByRole("heading", { name: /^Primary route / }).closest<HTMLElement>("article")!;
      const pageHeading = card.querySelector<HTMLElement>(".note-card__page-heading")!;
      const outerHeading = pageHeading.querySelector<HTMLElement>(".markdown-note-title--outer")!;
      const innerHeading = card.querySelector<HTMLElement>(".markdown-note-title--inner")!;
      const outerButton = within(outerHeading).getByRole("button", { name: /^Primary route / });
      const innerButton = innerHeading.querySelector<HTMLButtonElement>("button")!;

      fireEvent.click(outerButton);
      await waitFor(() => expect(outerButton).toHaveAttribute("aria-expanded", "false"));

      const outerState = pageHeading.querySelector<HTMLElement>(".markdown-checklist-heading__collapsed-state")!;
      const innerState = innerHeading.nextElementSibling as HTMLElement;
      expect(outerButton).toHaveAttribute("data-checklist-collapse-motion-trigger");
      expect(innerButton).not.toHaveAttribute("data-checklist-collapse-motion-trigger");
      expect(outerState).toHaveAttribute("data-checklist-collapse-motion-key");
      expect(innerState).not.toHaveAttribute("data-checklist-collapse-motion-key");
      expect(animations.some((entry) => entry.element === outerState)).toBe(true);
      expect(animations.some((entry) => entry.element === innerState)).toBe(false);
      const contextReplica = [...card.querySelectorAll<HTMLElement>(".markdown-checklist-collapse-motion-replica")]
        .find((replica) => replica.textContent === "Context")!;
      const contextTransform = animations.find((entry) => entry.element === contextReplica && entry.keyframes.some((frame) => frame.transform !== undefined))!;
      expect(contextTransform.keyframes.at(-1)?.transform).toBe("translateY(-150px)");

      animations
        .filter((entry) => entry.element.classList.contains("markdown-checklist-collapse-motion-replica"))
        .forEach((entry) => entry.animation.finish());
      fireEvent.click(outerButton);
      await waitFor(() => expect(outerButton).toHaveAttribute("aria-expanded", "true"));

      const stateReplica = [...pageHeading.querySelectorAll<HTMLElement>(".markdown-checklist-collapse-motion-replica")]
        .find((replica) => replica.textContent?.includes("Свернуто"))!;
      expect(stateReplica).toHaveAttribute("aria-hidden", "true");
      const stateExit = animations.find((entry) => entry.element === stateReplica && entry.keyframes.some((frame) => frame.transform !== undefined))!;
      expect(stateExit.keyframes.at(-1)?.transform).toBe("translateY(-25px)");
      expect(innerHeading.nextElementSibling).not.toHaveClass("markdown-checklist-collapse-motion-replica");
      expect(screen.getAllByRole("heading", { name: /^Primary route / })).toHaveLength(1);
    } finally {
      if (originalAnimateDescriptor) Object.defineProperty(Element.prototype, "animate", originalAnimateDescriptor);
      else delete (Element.prototype as { animate?: typeof Element.prototype.animate }).animate;
      vi.unstubAllGlobals();
    }
  });

  it("uses the CSS grid and sticky layer contract without reserving a second title row", () => {
    const style = installProductionStyles();
    const note = makeNote("22222222-2222-4222-8222-222222222222", "# Primary route\n- [ ] Root task\n# Later route", 1024);

    try {
      render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);
      const card = screen.getByRole("heading", { name: /^Primary route / }).closest<HTMLElement>("article")!;
      const surface = card.querySelector<HTMLElement>(".note-card__surface")!;
      const pageHost = card.querySelector<HTMLElement>(".note-card__page-heading")!;
      const frame = card.querySelector<HTMLElement>(".note-card__viewport-frame")!;
      const markdownContent = card.querySelector<HTMLElement>(".note-card__content > .markdown")!;
      const viewport = card.querySelector<HTMLElement>(".note-card__viewport")!;
      const innerHeading = card.querySelector<HTMLElement>(".markdown-note-title--inner")!;
      const outerHeading = card.querySelector<HTMLElement>(".markdown-note-title--outer")!;
      const laterHeading = Array.from(card.querySelectorAll<HTMLElement>("h2"))
        .find((heading) => heading.textContent?.includes("Later route"))!;

      expect(getComputedStyle(pageHost).position).toBe("sticky");
      expect(getComputedStyle(pageHost).top).toContain("--app-header-height");
      expect(getComputedStyle(innerHeading).position).toBe("sticky");
      expect(resolveComputedValue(innerHeading, "top")).toBe("6px");
      expect(getComputedStyle(laterHeading).position).not.toBe("sticky");
      expect(getComputedStyle(surface).overflow).toBe("clip");
      expect(getComputedStyle(viewport).overscrollBehavior).toBe("none");
      expect(getComputedStyle(innerHeading).pointerEvents).toBe("none");
      expect(getComputedStyle(outerHeading).marginBlockStart).toBe(getComputedStyle(innerHeading).marginBlockStart);
      expect(getComputedStyle(outerHeading).marginBlockEnd).toBe(getComputedStyle(innerHeading).marginBlockEnd);
      expect(getComputedStyle(outerHeading).backgroundColor).toBe(getComputedStyle(innerHeading).backgroundColor);
      expect(getComputedStyle(pageHost).getPropertyValue("--note-title-block-start").trim()).toBe("6px");
      expect(getComputedStyle(innerHeading).getPropertyValue("--note-title-block-start").trim()).toBe("6px");
      expect(getComputedStyle(pageHost).getPropertyValue("padding-top").trim()).toBe("var(--note-title-block-start)");
      expect(getComputedStyle(innerHeading).getPropertyValue("top").trim()).toBe("var(--note-title-block-start)");
      expect(resolveComputedValue(pageHost, "padding-top")).toBe("6px");
      expect(resolveComputedValue(innerHeading, "top")).toBe(resolveComputedValue(pageHost, "padding-top"));
      expect(getComputedStyle(pageHost).gridRow).toBe(getComputedStyle(frame).gridRow);
      expect(getComputedStyle(pageHost).gridColumn).toBe(getComputedStyle(frame).gridColumn);
    } finally {
      style.remove();
    }
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

    const editor = await screen.findByRole("textbox", { name: "Текст заметки" });
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
    const editorCard = (await screen.findByRole("textbox", { name: "Текст заметки" })).closest<HTMLElement>("article")!;
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
    card = (await screen.findByRole("textbox", { name: "Текст заметки" })).closest<HTMLElement>("article")!;
    expect(flowOrder(card)).toEqual(["attachments", "editor", "footer"]);
  });
});
