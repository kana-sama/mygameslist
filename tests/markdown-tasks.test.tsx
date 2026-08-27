import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasMarkdownTasks, insertMarkdownOpenChecklistItem, MarkdownView, setMarkdownTaskChecked, setMarkdownTaskItemText, setMarkdownTaskState } from "../src/components/Markdown";
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

function motionRect(top: number, height = 10, width = 240, left = 0): DOMRect {
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

interface RecordedMarkdownAnimation {
  animation: Animation & { cancelled: boolean; finish: () => void };
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
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
  describe("completed checklist filter", () => {
    describe("motion", () => {
      let animations: RecordedMarkdownAnimation[];
      let originalAnimateDescriptor: PropertyDescriptor | undefined;

      beforeEach(() => {
        animations = [];
        originalAnimateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
        Object.defineProperty(Element.prototype, "animate", {
          configurable: true,
          value: function animate(keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions): Animation {
            const animation = {
              cancelled: false,
              oncancel: null as Animation["oncancel"],
              onfinish: null as Animation["onfinish"],
              cancel() {
                this.cancelled = true;
                this.oncancel?.(new Event("cancel") as AnimationPlaybackEvent);
              },
              finish() {
                this.onfinish?.(new Event("finish") as AnimationPlaybackEvent);
              },
            };
            animations.push({
              animation: animation as unknown as RecordedMarkdownAnimation["animation"],
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
      });

      afterEach(() => {
        if (originalAnimateDescriptor) Object.defineProperty(Element.prototype, "animate", originalAnimateDescriptor);
        else delete (Element.prototype as { animate?: typeof Element.prototype.animate }).animate;
      });

      it("moves completed list rows into their exact list summary with inert full-width exit replicas and FLIP settling", () => {
        let phase: "initial" | "filtered" = "initial";
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 300, 300);
          const text = this.textContent ?? "";
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(90);
          if (text.includes("Visible one")) return motionRect(10);
          if (text.includes("Completed one")) return motionRect(30);
          if (text.includes("Visible two")) return motionRect(phase === "initial" ? 50 : 30);
          if (text.includes("Completed group")) return motionRect(70, 16);
          return motionRect(0);
        });
        const initial = [
          "- [ ] Visible one",
          "- [ ] Completed one",
          "- [ ] Visible two",
          "- Completed group",
          "  - [ ] Completed nested",
        ].join("\n");
        const completed = initial.replace("[ ] Completed one", "[x] Completed one").replace("[ ] Completed nested", "[x] Completed nested");
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={initial} onCollapsedChecklistSectionsChange={vi.fn()} />);

        expect(animations).toHaveLength(0);
        phase = "filtered";
        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown={completed} onCollapsedChecklistSectionsChange={vi.fn()} />);

        const replicas = [...view.container.querySelectorAll<HTMLElement>(".markdown-completed-checklist-motion-replica")];
        expect(replicas).toHaveLength(2);
        const exitReplica = replicas.find((replica) => replica.textContent?.includes("Completed group"))!;
        expect(exitReplica).toHaveAttribute("aria-hidden", "true");
        expect(exitReplica).toHaveAttribute("inert");
        expect(exitReplica.querySelector("[id]")).toBeNull();
        const summary = view.container.querySelector<HTMLElement>("[data-completed-checklist-motion-summary]")!;
        expect(summary.dataset.completedChecklistMotionSummary).toBe(exitReplica.dataset.completedChecklistMotionTarget);
        const exit = animations.find((entry) => entry.element === exitReplica)!;
        expect(exit.options.duration).toBe(280);
        expect(exit.keyframes.at(-1)?.transform).toContain("translateY(20px)");
        expect(exit.keyframes.at(-1)?.transform).toContain("scaleY(");
        expect(exit.keyframes.at(-1)?.transform).not.toContain("scaleX(");
        const survivingRow = screen.getByText("Visible two").closest("li")!;
        const settling = animations.find((entry) => entry.element === survivingRow)!;
        expect(settling.keyframes[0]?.transform).toContain("translateY(20px)");
        expect(settling.keyframes.at(-1)?.transform).toBe("translateY(0px)");
        exit.animation.finish();
        expect(exitReplica).not.toBeInTheDocument();
      });

      it("animates a caller-provided snapshot change even when its numeric revision is unchanged", () => {
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 180, 300);
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(70);
          if ((this.textContent ?? "").includes("Finished")) return motionRect(20);
          return motionRect(40);
        });
        const markdown = "- [x] Finished\n- [ ] Visible";
        const finishedId = parseMarkdownBlocks(markdown)[0].items![0].structuralId!;
        const emptySnapshot = { hiddenListItemStructuralIds: new Set<string>(), hiddenSectionCollapseIds: new Set<string>() };
        const filteredSnapshot = { hiddenListItemStructuralIds: new Set([finishedId]), hiddenSectionCollapseIds: new Set<string>() };
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} completedChecklistFilterSnapshot={emptySnapshot} markdown={markdown} />);

        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} completedChecklistFilterSnapshot={filteredSnapshot} markdown={markdown} />);

        expect(view.container.querySelectorAll(".markdown-completed-checklist-motion-replica")).toHaveLength(1);
      });

      it("normalizes exit and FLIP deltas when the Markdown root moves in the viewport", () => {
        let phase: "initial" | "filtered" = "initial";
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          const rootTop = phase === "initial" ? 100 : 40;
          if (this.classList.contains("markdown")) return motionRect(rootTop, 180, 300);
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(rootTop + 70);
          const text = this.textContent ?? "";
          if (text.includes("Finished")) return motionRect(rootTop + 20);
          if (text.includes("Visible")) return motionRect(rootTop + (phase === "initial" ? 50 : 30));
          return motionRect(rootTop);
        });
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={"- [ ] Finished\n- [ ] Visible"} />);

        phase = "filtered";
        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown={"- [x] Finished\n- [ ] Visible"} />);

        const exitReplica = view.container.querySelector<HTMLElement>(".markdown-completed-checklist-motion-replica")!;
        const exit = animations.find((entry) => entry.element === exitReplica)!;
        expect(exit.keyframes.at(-1)?.transform).toContain("translateY(50px)");
        const visibleRow = screen.getByText("Visible").closest("li")!;
        const settling = animations.find((entry) => entry.element === visibleRow)!;
        expect(settling.keyframes[0]?.transform).toContain("translateY(20px)");
      });

      it("targets nested and root checklist sections only at their hierarchy-owned summaries", () => {
        let phase: "initial" | "filtered" = "initial";
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 360, 300);
          const text = this.textContent ?? "";
          if (this.hasAttribute("data-completed-checklist-motion-summary")) {
            return motionRect(this.classList.contains("markdown-checklist-hidden-sections--nested") ? 120 : 190);
          }
          if (text.includes("Root completed")) return motionRect(20, 30);
          if (text.includes("Visible parent")) return motionRect(phase === "initial" ? 60 : 20, 100);
          if (text.includes("Child completed")) return motionRect(80, 24);
          if (text.includes("Visible child")) return motionRect(phase === "initial" ? 120 : 60, 30);
          return motionRect(0);
        });
        const initial = [
          "# Root",
          "## Root completed",
          "- [ ] Root row",
          "## Visible parent",
          "- [ ] Parent row",
          "### Child completed",
          "- [ ] Child row",
          "### Visible child",
          "- [ ] Child open",
        ].join("\n");
        const completed = initial.replace("[ ] Root row", "[x] Root row").replace("[ ] Child row", "[x] Child row");
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={initial} />);

        phase = "filtered";
        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown={completed} />);

        const replicas = [...view.container.querySelectorAll<HTMLElement>(".markdown-completed-checklist-motion-replica")];
        const rootReplica = replicas.find((replica) => replica.textContent?.includes("Root completed"))!;
        const childReplica = replicas.find((replica) => replica.textContent?.includes("Child completed"))!;
        expect(rootReplica.dataset.completedChecklistMotionTarget).not.toBe(childReplica.dataset.completedChecklistMotionTarget);
        const rootSummary = view.container.querySelector<HTMLElement>(`.markdown-checklist-hidden-sections:not(.markdown-checklist-hidden-sections--nested)[data-completed-checklist-motion-summary="${rootReplica.dataset.completedChecklistMotionTarget}"]`);
        const childSummary = view.container.querySelector<HTMLElement>(`.markdown-checklist-hidden-sections--nested[data-completed-checklist-motion-summary="${childReplica.dataset.completedChecklistMotionTarget}"]`);
        expect(rootSummary).not.toBeNull();
        expect(childSummary).not.toBeNull();
        expect(animations.find((entry) => entry.element === rootReplica)!.keyframes.at(-1)?.transform).toContain("translateY(170px)");
        expect(animations.find((entry) => entry.element === childReplica)!.keyframes.at(-1)?.transform).toContain("translateY(40px)");
      });

      it("reverses from the owning summary and cancels obsolete exit replicas on interruption", () => {
        let phase: "initial" | "filtered" | "revealed" = "initial";
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 240, 300);
          const text = this.textContent ?? "";
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(80);
          if (text.includes("Visible")) return motionRect(phase === "filtered" ? 20 : 40);
          if (text.includes("Finished")) return motionRect(20);
          return motionRect(0);
        });
        function Harness({ markdown, revision }: { markdown: string; revision: number }) {
          const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
          return <MarkdownView
            completedChecklistFilterEnabled
            completedChecklistFilterRevision={revision}
            completedChecklistRevealedItemIds={revealed}
            markdown={markdown}
            onRevealCompletedChecklistItems={(ids) => setRevealed(new Set(ids))}
          />;
        }
        const initial = "- [ ] Finished\n- [ ] Visible";
        const completed = "- [x] Finished\n- [ ] Visible";
        const view = render(<Harness markdown={initial} revision={0} />);
        phase = "filtered";
        view.rerender(<Harness markdown={completed} revision={1} />);
        const exitReplica = view.container.querySelector<HTMLElement>(".markdown-completed-checklist-motion-replica")!;
        const exitAnimation = animations.find((entry) => entry.element === exitReplica)!.animation;

        phase = "revealed";
        fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 пунктов" }));

        expect(exitAnimation.cancelled).toBe(true);
        expect(view.container.querySelector(".markdown-completed-checklist-motion-replica")).toBeNull();
        const enteredRow = screen.getByText("Finished").closest("li")!;
        const entering = animations.findLast((entry) => entry.element === enteredRow)!;
        expect(entering.options.duration).toBe(280);
        expect(entering.keyframes[0]?.transform).toContain("translateY(60px)");
        expect(entering.keyframes.at(-1)?.transform).toContain("translateY(0px)");
      });

      it("preserves logical boxes across an unrelated render during an unfinished exit", () => {
        let phase: "initial" | "filtered" | "interrupted" | "revealed" = "initial";
        let filteredSettlingAnimation: RecordedMarkdownAnimation["animation"] | undefined;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 240, 300);
          const text = this.textContent ?? "";
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(80);
          if (text.includes("Finished")) return motionRect(20);
          if (text.includes("Visible")) {
            if (phase === "initial" || phase === "revealed" && filteredSettlingAnimation?.cancelled) return motionRect(40);
            if (phase === "filtered") return motionRect(20);
            return motionRect(30);
          }
          return motionRect(0);
        });
        function Harness({ className, markdown, revision }: { className: string; markdown: string; revision: number }) {
          const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
          return <MarkdownView
            className={className}
            completedChecklistFilterEnabled
            completedChecklistFilterRevision={revision}
            completedChecklistRevealedItemIds={revealed}
            markdown={markdown}
            onRevealCompletedChecklistItems={(ids) => setRevealed(new Set(ids))}
          />;
        }
        const initial = "- [ ] Finished\n- [ ] Visible";
        const completed = "- [x] Finished\n- [ ] Visible";
        const view = render(<Harness className="before" markdown={initial} revision={0} />);
        phase = "filtered";
        view.rerender(<Harness className="filtered" markdown={completed} revision={1} />);
        const visibleRow = screen.getByText("Visible").closest("li")!;
        filteredSettlingAnimation = animations.find((entry) => entry.element === visibleRow)!.animation;
        const exitReplica = view.container.querySelector<HTMLElement>(".markdown-completed-checklist-motion-replica")!;

        phase = "interrupted";
        view.rerender(<Harness className="unrelated-render" markdown={completed} revision={1} />);
        expect(exitReplica).toBeInTheDocument();
        phase = "revealed";
        fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 пунктов" }));

        expect(filteredSettlingAnimation.cancelled).toBe(true);
        expect(exitReplica).not.toBeInTheDocument();
        const enteredRow = screen.getByText("Finished").closest("li")!;
        const entering = animations.findLast((entry) => entry.element === enteredRow);
        expect(entering?.keyframes[0]?.transform).toContain("translateY(60px)");
        const revealedSettling = animations.findLast((entry) => entry.element === visibleRow);
        expect(revealedSettling?.keyframes[0]?.transform).toContain("translateY(-20px)");
      });

      it("reveals a tall completed section from the top-left edge of its owning summary", () => {
        let phase: "initial" | "filtered" | "revealed" = "initial";
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 320, 300);
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(160, 12);
          const text = this.textContent ?? "";
          if (this.classList.contains("markdown-checklist-subsection") && text.includes("Tall finished section")) {
            return motionRect(20, 120);
          }
          if (text.includes("Visible section")) return motionRect(phase === "filtered" ? 20 : 150, 60);
          if (text.includes("Finished row")) return motionRect(50);
          return motionRect(0);
        });
        function Harness({ markdown, revision }: { markdown: string; revision: number }) {
          const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
          return <MarkdownView
            completedChecklistFilterEnabled
            completedChecklistFilterRevision={revision}
            completedChecklistRevealedSectionIds={revealed}
            markdown={markdown}
            onRevealCompletedChecklistSections={(ids) => setRevealed(new Set(ids))}
          />;
        }
        const initial = "# Root\n## Tall finished section\n- [ ] Finished row\n## Visible section\n- [ ] Open row";
        const completed = initial.replace("[ ] Finished row", "[x] Finished row");
        const view = render(<Harness markdown={initial} revision={0} />);
        phase = "filtered";
        view.rerender(<Harness markdown={completed} revision={1} />);

        phase = "revealed";
        fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 секций" }));

        const section = screen.getByRole("heading", { name: /Tall finished section/ }).closest<HTMLElement>(".markdown-checklist-subsection")!;
        const entering = animations.findLast((entry) => entry.element === section)!;
        expect(entering.keyframes).toHaveLength(2);
        expect(entering.keyframes.every((keyframe) => keyframe.transformOrigin === "top left")).toBe(true);
        expect(entering.keyframes[0]?.transform).toContain("scaleY(0.1)");
      });

      it("composes a surviving row's local FLIP delta with its moving section ancestor", () => {
        let phase: "initial" | "filtered" = "initial";
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(0, 320, 300);
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(220);
          const text = this.textContent ?? "";
          if (this.classList.contains("markdown-checklist-subsection") && text.includes("Earlier")) return motionRect(20, 50);
          if (this.classList.contains("markdown-checklist-subsection") && text.includes("Later")) {
            return motionRect(phase === "initial" ? 100 : 40, 100);
          }
          if (text.includes("Internal row")) return motionRect(120);
          if (text.includes("Surviving row")) return motionRect(phase === "initial" ? 140 : 70);
          if (text.includes("Earlier row")) return motionRect(40);
          return motionRect(0);
        });
        const initial = "# Root\n## Earlier\n- [ ] Earlier row\n## Later\n- [ ] Internal row\n- [ ] Surviving row";
        const completed = initial.replace("[ ] Earlier row", "[x] Earlier row").replace("[ ] Internal row", "[x] Internal row");
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={initial} />);

        phase = "filtered";
        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown={completed} />);

        const laterSection = screen.getByRole("heading", { name: /Later/ }).closest<HTMLElement>(".markdown-checklist-subsection")!;
        const survivingRow = screen.getByText("Surviving row").closest<HTMLElement>("li")!;
        const sectionSettling = animations.find((entry) => entry.element === laterSection)!;
        const rowSettling = animations.find((entry) => entry.element === survivingRow)!;
        expect(sectionSettling.keyframes[0]?.transform).toBe("translateY(60px)");
        expect(rowSettling.keyframes[0]?.transform).toBe("translateY(10px)");
        expect(rowSettling.keyframes.at(-1)?.transform).toBe("translateY(0px)");
      });

      it("keeps a nested completed list row replica inside an inert exact-geometry list shell", () => {
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rectangle(this: Element) {
          if (this.classList.contains("markdown")) return motionRect(50, 300, 300, 100);
          if (this.hasAttribute("data-completed-checklist-motion-summary")) return motionRect(230, 10, 240, 120);
          const text = this.textContent ?? "";
          if (text.includes("Completed parent")) return motionRect(120, 70, 210, 130);
          if (text.includes("Visible")) return motionRect(80, 20, 240, 120);
          return motionRect(0);
        });
        const initial = "- [ ] Visible\n- [ ] Completed parent\n  - [ ] Completed child";
        const completed = initial.replace("[ ] Completed parent", "[x] Completed parent").replace("[ ] Completed child", "[x] Completed child");
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={initial} />);
        const originalRow = screen.getByText("Completed parent").closest<HTMLElement>("li")!;
        const originalListTag = originalRow.parentElement!.tagName;

        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown={completed} />);

        const replicaShell = view.container.querySelector<HTMLElement>(".markdown-completed-checklist-motion-replica")!;
        expect(replicaShell.tagName).toBe(originalListTag);
        expect(replicaShell).toHaveAttribute("aria-hidden", "true");
        expect(replicaShell).toHaveAttribute("inert");
        expect(replicaShell.style.pointerEvents).toBe("none");
        expect(replicaShell.style.top).toBe("70px");
        expect(replicaShell.style.left).toBe("30px");
        expect(replicaShell.style.width).toBe("210px");
        expect(replicaShell.style.height).toBe("70px");
        const clonedRow = replicaShell.querySelector<HTMLElement>(":scope > li");
        const clonedNestedList = replicaShell.querySelector<HTMLElement>(":scope > li > ul");
        expect(clonedRow).not.toBeNull();
        expect(clonedNestedList).not.toBeNull();
        expect(clonedRow?.parentElement).toBe(replicaShell);
        expect(clonedNestedList?.parentElement?.closest("ul")).toBe(replicaShell);
        expect(replicaShell.querySelector("[id]")).toBeNull();
      });

      it("performs no layout read for Markdown without checklist motion participants", () => {
        const rectangle = vi.spyOn(Element.prototype, "getBoundingClientRect");

        render(<MarkdownView markdown="Plain Markdown without a checklist" />);

        expect(rectangle).not.toHaveBeenCalled();
      });

      it("does not rerender the memoized Markdown body when only reveal callback identities change", () => {
        const rectangle = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(motionRect(0));
        const markdown = "- [x] Finished\n- [ ] Visible";
        const view = render(<MarkdownView
          completedChecklistFilterEnabled
          markdown={markdown}
          onRevealCompletedChecklistItems={vi.fn()}
          onRevealCompletedChecklistSections={vi.fn()}
        />);
        rectangle.mockClear();

        view.rerender(<MarkdownView
          completedChecklistFilterEnabled
          markdown={markdown}
          onRevealCompletedChecklistItems={vi.fn()}
          onRevealCompletedChecklistSections={vi.fn()}
        />);

        expect(rectangle).not.toHaveBeenCalled();
      });

      it("creates no transition on initial mount and skips replicas and animations for reduced motion", () => {
        const initialView = render(<MarkdownView completedChecklistFilterEnabled markdown={"- [x] Finished\n- [ ] Visible"} />);
        expect(animations).toHaveLength(0);
        expect(initialView.container.querySelector(".markdown-completed-checklist-motion-replica")).toBeNull();
        initialView.unmount();
        vi.mocked(window.matchMedia).mockReturnValue({
          matches: true,
          media: "(prefers-reduced-motion: reduce)",
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        });
        const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown="- [ ] Finished" />);
        view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown="- [x] Finished" />);

        expect(animations).toHaveLength(0);
        expect(view.container.querySelector(".markdown-completed-checklist-motion-replica")).toBeNull();
      });
    });

    it("hides checked flat-list items and reports their count", () => {
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "- [x] Done one",
        "- [ ] Open",
        "- [-] Mixed",
        "- [x] Done two",
      ].join("\n")} />);

      expect(screen.queryByText("Done one")).not.toBeInTheDocument();
      expect(screen.queryByText("Done two")).not.toBeInTheDocument();
      expect(screen.getByText("Open")).toBeInTheDocument();
      expect(screen.getByText("Mixed")).toBeInTheDocument();
      expect(screen.getByText("Скрыто 2 пунктов")).toBeInTheDocument();
    });

    it("reveals only the direct hidden items from the selected list", async () => {
      const user = userEvent.setup();
      function Harness() {
        const [revealedItemIds, setRevealedItemIds] = useState<ReadonlySet<string>>(new Set());
        return <MarkdownView
          completedChecklistFilterEnabled
          completedChecklistRevealedItemIds={revealedItemIds}
          markdown={[
            "- [x] First finished",
            "- [ ] First open",
            "",
            "Separate checklist",
            "",
            "- [x] Second finished",
            "- [ ] Second open",
          ].join("\n")}
          onRevealCompletedChecklistItems={(structuralIds) => setRevealedItemIds((current) => new Set([...current, ...structuralIds]))}
        />;
      }
      render(<Harness />);

      const summaries = screen.getAllByRole("button", { name: "Скрыто 1 пунктов" });
      expect(summaries).toHaveLength(2);
      expect(screen.queryByText("First finished")).not.toBeInTheDocument();
      expect(screen.queryByText("Second finished")).not.toBeInTheDocument();

      summaries[0].focus();
      await user.keyboard("{Enter}");

      expect(screen.getByText("First finished")).toBeInTheDocument();
      expect(screen.queryByText("Second finished")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Скрыто 1 пунктов" })).toBeInTheDocument();
    });

    it("reveals only the direct hidden sections from the selected owner", () => {
      function Harness() {
        const [revealedSectionIds, setRevealedSectionIds] = useState<ReadonlySet<string>>(new Set());
        return <MarkdownView
          completedChecklistFilterEnabled
          completedChecklistRevealedSectionIds={revealedSectionIds}
          markdown={[
            "# Root",
            "## Root hidden",
            "- [x] Root finished row",
            "## Visible parent",
            "- [ ] Parent open row",
            "### Child hidden one",
            "- [x] Child one finished row",
            "### Child hidden two",
            "- [x] Child two finished row",
          ].join("\n")}
          onRevealCompletedChecklistSections={(collapseIds) => setRevealedSectionIds((current) => new Set([...current, ...collapseIds]))}
        />;
      }
      render(<Harness />);

      const summary = screen.getByRole("button", { name: "Скрыто 2 секций" });
      expect(screen.queryByRole("heading", { name: /Child hidden one/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Child hidden two/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Root hidden/ })).not.toBeInTheDocument();

      fireEvent.click(summary);

      expect(screen.getByRole("heading", { name: /Child hidden one/ })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /Child hidden two/ })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Root hidden/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Скрыто 1 пунктов" })).toHaveLength(2);
      expect(screen.queryByText("Child one finished row")).not.toBeInTheDocument();
      expect(screen.queryByText("Child two finished row")).not.toBeInTheDocument();
    });

    it("reveals only the root-owned sections from the selected root summary", () => {
      function Harness() {
        const [revealedSectionIds, setRevealedSectionIds] = useState<ReadonlySet<string>>(new Set());
        return <MarkdownView
          completedChecklistFilterEnabled
          completedChecklistRevealedSectionIds={revealedSectionIds}
          markdown={[
            "# First root",
            "## First root hidden",
            "- [x] First finished row",
            "# Second root",
            "## Second root hidden",
            "- [x] Second finished row",
          ].join("\n")}
          onRevealCompletedChecklistSections={(collapseIds) => setRevealedSectionIds((current) => new Set([...current, ...collapseIds]))}
        />;
      }
      render(<Harness />);

      const summaries = screen.getAllByRole("button", { name: "Скрыто 1 секций" });
      fireEvent.click(summaries[0]);

      expect(screen.getByRole("heading", { name: /First root hidden/ })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Second root hidden/ })).not.toBeInTheDocument();
    });

    it("hides completed structural checklist groups", () => {
      // Restoring `item.taskState === "checked"` as the only hideable-item
      // condition makes Complete city and its completed structural groups reappear.
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "# Shop checklist",
        "## Complete city",
        "- Store one",
        "  - [x] Deed one",
        "  - [x] Deed two",
        "- Store two",
        "  - [x] Deed three",
        "## Mixed city",
        "- Complete store",
        "  - [x] Finished",
        "- Open store",
        "  - [x] Finished prerequisite",
        "  - [ ] Remaining",
        "## Reference city",
        "- Ordinary reference",
        "- [x] Finished row",
      ].join("\n")} />);

      expect(screen.queryByRole("heading", { name: /Complete city/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Store one")).not.toBeInTheDocument();
      expect(screen.queryByText("Store two")).not.toBeInTheDocument();
      expect(screen.queryByText("Deed one")).not.toBeInTheDocument();
      expect(screen.queryByText("Deed two")).not.toBeInTheDocument();
      expect(screen.queryByText("Deed three")).not.toBeInTheDocument();
      const titleSection = screen.getByRole("heading", { name: /Shop checklist/ }).closest(".markdown-section");
      expect(titleSection).not.toBeNull();
      expect(titleSection!.querySelectorAll(":scope > .markdown-checklist-hidden-sections")).toHaveLength(1);
      expect(titleSection!.lastElementChild).toHaveClass("markdown-checklist-hidden-sections");
      expect(titleSection!.lastElementChild).toHaveTextContent("Скрыто 1 секций");

      const mixedHeading = screen.getByRole("heading", { name: /Mixed city/ });
      expect(mixedHeading).toBeInTheDocument();
      expect(screen.queryByText("Complete store")).not.toBeInTheDocument();
      expect(screen.getByText("Open store")).toBeInTheDocument();
      expect(screen.getByText("Remaining")).toBeInTheDocument();
      const mixedSection = mixedHeading.closest(".markdown-checklist-subsection");
      expect(mixedSection).not.toBeNull();
      const directHiddenItemSummaries = mixedSection!.querySelectorAll(":scope > ul > li.markdown-checklist-hidden-count");
      expect(directHiddenItemSummaries).toHaveLength(1);
      expect(directHiddenItemSummaries[0]).toHaveTextContent("Скрыто 1 пунктов");

      expect(screen.getByRole("heading", { name: /Reference city/ })).toBeInTheDocument();
      expect(screen.getByText("Ordinary reference")).toBeInTheDocument();
      expect(screen.queryByText("Finished row")).not.toBeInTheDocument();
    });

    it("keeps non-checked task parents and their sections visible", () => {
      // Treating every non-checked item as a structural label hides unchecked
      // and indeterminate task parents whose children happen to be complete.
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "# Task boundary checklist",
        "## Unchecked parent city",
        "- [ ] Unchecked parent",
        "  - [x] Checked child",
        "## Indeterminate parent city",
        "- [-] Indeterminate parent",
        "  - [x] Checked child",
        "## Checked incomplete city",
        "- [x] Checked ancestor",
        "  - [ ] Remaining descendant",
      ].join("\n")} />);

      expect(screen.getByRole("heading", { name: /Unchecked parent city/ })).toBeInTheDocument();
      expect(screen.getByText("Unchecked parent")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /Indeterminate parent city/ })).toBeInTheDocument();
      expect(screen.getByText("Indeterminate parent")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /Checked incomplete city/ })).toBeInTheDocument();
      expect(screen.getByText("Checked ancestor")).toBeInTheDocument();
      expect(screen.getByText("Remaining descendant")).toBeInTheDocument();
    });

    it("holds the snapshot until its revision changes", () => {
      const initial = "- [ ] First\n- [ ] Second";
      const checked = "- [x] First\n- [ ] Second";
      const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={initial} />);

      view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={checked} />);
      expect(screen.getByText("First")).toBeInTheDocument();
      expect(screen.queryByText(/Скрыто/)).not.toBeInTheDocument();

      view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={1} markdown={checked} />);
      expect(screen.queryByText("First")).not.toBeInTheDocument();
      expect(screen.getByText("Скрыто 1 пунктов")).toBeInTheDocument();
    });

    it("keeps hidden items and sections mapped after inserting an item before them at the same revision", () => {
      const initial = [
        "# Root",
        "- [ ] ...",
        "## Mixed",
        "Context stays",
        "- [x] Hidden row",
        "## Finished section",
        "- [x] Finished row",
      ].join("\n");
      const view = render(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={initial} onTaskChange={vi.fn()} />);
      const inserted = insertMarkdownOpenChecklistItem(initial, 1, "Inserted row");

      view.rerender(<MarkdownView completedChecklistFilterEnabled completedChecklistFilterRevision={0} markdown={inserted} onTaskChange={vi.fn()} />);

      expect(screen.getByText("Inserted row")).toBeInTheDocument();
      expect(screen.queryByText("Hidden row")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Finished section/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Finished row")).not.toBeInTheDocument();
    });

    it("keeps a checked parent with visible nested work and hides a completed branch", () => {
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "- [x] Keep parent",
        "  - [ ] Nested open",
        "  - [x] Nested done beside open work",
        "- [x] Hide parent",
        "  - [x] Nested done",
      ].join("\n")} />);

      expect(screen.getByText("Keep parent")).toBeInTheDocument();
      expect(screen.getByText("Nested open")).toBeInTheDocument();
      expect(screen.queryByText("Nested done beside open work")).not.toBeInTheDocument();
      expect(screen.queryByText("Hide parent")).not.toBeInTheDocument();
      expect(screen.queryByText("Nested done")).not.toBeInTheDocument();
    });

    it("hides completed depth-two checklist sections and reports them to their level-one parent", () => {
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "# Root",
        "## Done one",
        "- [x] Finish one",
        "## Done two",
        "- [x] Finish two",
        "## Mixed",
        "- [ ] Continue",
      ].join("\n")} />);

      expect(screen.queryByRole("heading", { name: /Done one/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Done two/ })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /Mixed/ })).toBeInTheDocument();
      expect(screen.getByText("Скрыто 2 секций")).toBeInTheDocument();
    });

    it("nests hidden section summaries with their visible subsection owner", () => {
      // Removing the nested modifier from subsection-owned summaries makes
      // title-owned and subsection-owned summaries share one presentation class.
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "# Root",
        "## Finished root section",
        "- [x] Root finished",
        "## Visible parent",
        "- [ ] Parent work",
        "### Finished child one",
        "- [x] Child one finished",
        "### Finished child two",
        "- [x] Child two finished",
        "### Visible child",
        "- [ ] Child work",
      ].join("\n")} />);

      expect(screen.queryByRole("heading", { name: /Finished root section/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Finished child one/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Finished child two/ })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /Visible parent/ })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /Visible child/ })).toBeInTheDocument();

      const rootSection = screen.getByRole("heading", { name: /^Root/ }).closest(".markdown-section");
      expect(rootSection).not.toBeNull();
      const rootSummary = rootSection!.querySelector(":scope > .markdown-checklist-hidden-sections");
      expect(rootSummary).not.toBeNull();
      expect(rootSummary).toHaveTextContent("Скрыто 1 секций");
      expect(rootSummary).not.toHaveClass("markdown-checklist-hidden-sections--nested");
      expect(rootSection!.lastElementChild).toBe(rootSummary);

      const parentSubsection = screen.getByRole("heading", { name: /Visible parent/ }).closest(".markdown-checklist-subsection");
      expect(parentSubsection).not.toBeNull();
      const nestedSummary = parentSubsection!.querySelector(":scope > .markdown-checklist-hidden-sections");
      expect(nestedSummary).not.toBeNull();
      expect(nestedSummary).toHaveTextContent("Скрыто 2 секций");
      expect(nestedSummary).toHaveClass("markdown-checklist-hidden-sections--nested");
      expect(parentSubsection!.lastElementChild).toBe(nestedSummary);
    });

    it("separates root and nested hidden-section summaries from painted subsections", () => {
      const style = document.createElement("style");
      style.textContent = productionStyles;
      document.head.append(style);

      try {
        const completeView = render(<MarkdownView completedChecklistFilterEnabled markdown={[
          "# Complete root",
          "## Complete visible",
          "Context keeps this section visible",
          "- [x] Finished",
          "### Hidden child",
          "- [x] Child finished",
          "## Hidden root sibling",
          "- [x] Root finished",
        ].join("\n")} />);
        const completeRootSummary = completeView.container.querySelector<HTMLElement>(".markdown-checklist-hidden-sections:not(.markdown-checklist-hidden-sections--nested)");
        const completeNestedSummary = completeView.container.querySelector<HTMLElement>(".markdown-checklist-hidden-sections--nested");
        expect(completeRootSummary).not.toBeNull();
        expect(completeNestedSummary).not.toBeNull();
        expect(getComputedStyle(completeRootSummary!).paddingTop).toBe("0");
        expect(getComputedStyle(completeNestedSummary!).paddingTop).toBe("0");
        const completeRootOffset = [...style.sheet!.cssRules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".markdown-checklist-subsection--complete + .markdown-checklist-hidden-sections");
        const completeNestedOffset = [...style.sheet!.cssRules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".markdown-checklist-subsection--complete > .markdown-checklist-hidden-sections--nested");
        expect(completeRootOffset?.style.marginTop).toBe("calc(1.674em + 8px)");
        expect(completeNestedOffset?.style.marginTop).toBe("calc(0.5em + 8px)");

        cleanup();
        const indeterminateView = render(<MarkdownView completedChecklistFilterEnabled markdown={[
          "# Indeterminate root",
          "## Indeterminate visible",
          "Context keeps this section visible",
          "- [-] Partial",
          "### Hidden child",
          "- [x] Child finished",
          "## Hidden root sibling",
          "- [x] Root finished",
        ].join("\n")} />);
        const indeterminateRootSummary = indeterminateView.container.querySelector<HTMLElement>(".markdown-checklist-hidden-sections:not(.markdown-checklist-hidden-sections--nested)");
        const indeterminateNestedSummary = indeterminateView.container.querySelector<HTMLElement>(".markdown-checklist-hidden-sections--nested");
        expect(indeterminateRootSummary).not.toBeNull();
        expect(indeterminateNestedSummary).not.toBeNull();
        expect(getComputedStyle(indeterminateRootSummary!).paddingTop).toBe("0");
        expect(getComputedStyle(indeterminateNestedSummary!).paddingTop).toBe("0");
        const indeterminateRootOffset = [...style.sheet!.cssRules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".markdown-checklist-subsection--indeterminate + .markdown-checklist-hidden-sections");
        const indeterminateNestedOffset = [...style.sheet!.cssRules].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".markdown-checklist-subsection--indeterminate > .markdown-checklist-hidden-sections--nested");
        expect(indeterminateRootOffset?.style.marginTop).toBe("calc(1.674em + 8px)");
        expect(indeterminateNestedOffset?.style.marginTop).toBe("calc(0.5em + 8px)");

        cleanup();
        const unpaintedView = render(<MarkdownView completedChecklistFilterEnabled markdown={[
          "# Unpainted root",
          "## Visible",
          "- [ ] Open",
          "### Hidden child",
          "- [x] Child finished",
        ].join("\n")} />);
        const unpaintedSummary = unpaintedView.container.querySelector<HTMLElement>(".markdown-checklist-hidden-sections--nested");
        expect(unpaintedSummary).not.toBeNull();
        expect(getComputedStyle(unpaintedSummary!).marginTop).toBe("8px");
      } finally {
        style.remove();
      }
    });

    it("counts only the topmost hidden completed section", () => {
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "# Root",
        "## Finished parent",
        "- [x] Parent work",
        "### Finished child",
        "- [x] Child work",
      ].join("\n")} />);

      expect(screen.queryByRole("heading", { name: /Finished parent/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /Finished child/ })).not.toBeInTheDocument();
      expect(screen.getByText("Скрыто 1 секций")).toBeInTheDocument();
      expect(screen.queryByText("Скрыто 2 секций")).not.toBeInTheDocument();
    });

    it("keeps a completed section with a paragraph while hiding its completed rows", () => {
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "# Root",
        "## Complete context",
        "Context stays",
        "- [x] Finished",
      ].join("\n")} />);

      expect(screen.getByRole("heading", { name: /Complete context/ })).toBeInTheDocument();
      expect(screen.getByText("Context stays")).toBeInTheDocument();
      expect(screen.queryByText("Finished")).not.toBeInTheDocument();
      expect(screen.getByText("Скрыто 1 пунктов")).toBeInTheDocument();
    });

    it("keeps completed Markdown tables without filter summaries", () => {
      render(<MarkdownView completedChecklistFilterEnabled markdown={[
        "| Stage | Task |",
        "| --- | --- |",
        "| End | [x] Finished |",
      ].join("\n")} />);

      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getByText("Finished")).toBeInTheDocument();
      expect(screen.queryByText(/Скрыто/)).not.toBeInTheDocument();
      expect(screen.getByRole("table").querySelector("[data-completed-checklist-motion-key], [data-completed-checklist-motion-target], [data-completed-checklist-motion-summary]")).toBeNull();
    });

    it("renders every item and no summaries when disabled", () => {
      render(<MarkdownView completedChecklistFilterEnabled={false} markdown={"- [x] Finished\n- [ ] Open"} />);

      expect(screen.getByText("Finished")).toBeInTheDocument();
      expect(screen.getByText("Open")).toBeInTheDocument();
      expect(screen.queryByText(/Скрыто/)).not.toBeInTheDocument();
    });
  });

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
      const nestedHiddenSections = ruleFor(".markdown-checklist-hidden-sections--nested");
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
      expect(nestedHiddenSections.style.boxSizing).toBe("border-box");
      expect(nestedHiddenSections.style.marginInlineStart).toBe("0.5em");
      expect(nestedHiddenSections.style.paddingInlineStart).toBe("0.95em");
      expect(nestedHiddenSections.style.borderInlineStart).toBe("1px solid var(--line-soft)");
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

  it("parses indeterminate list and table tasks as counted non-complete work", () => {
    const markdown = [
      "- [-] List task",
      "| Name | Done |",
      "| --- | --- |",
      "| Table task | [-] |",
    ].join("\n");
    const blocks = parseMarkdownBlocks(markdown);

    expect(blocks[0]?.items?.[0]).toMatchObject({ taskState: "indeterminate" });
    expect(blocks[1]?.table?.sections[0].rows[0]?.cells[1]).toMatchObject({ taskState: "indeterminate" });
    expect(blocks[0]?.checklistProgress).toEqual({ checked: 0, open: false, total: 1 });
    expect(blocks[1]?.checklistProgress).toEqual({ checked: 0, open: false, total: 1 });
  });

  it("does not mistake an indeterminate ellipsis task for the unchecked add-item marker", () => {
    const item = parseMarkdownBlocks("- [-] ...")[0]?.items?.[0];

    expect(item).toMatchObject({ openMarker: false, taskState: "indeterminate" });
    expect(item?.checklistProgress).toEqual({ checked: 0, open: false, total: 1 });
  });

  it("renders indeterminate list and table tasks as accessible mixed controls", () => {
    const view = render(<MarkdownView markdown={[
      "- [-] List task",
      "| Name | Done |",
      "| --- | --- |",
      "| Table task | [-] |",
    ].join("\n")} onTaskChange={vi.fn()} />);

    const listControl = screen.getByRole("checkbox", { name: "Отметить: List task" });
    const tableControl = screen.getByRole("checkbox", { name: "Отметить: Table task — Done" });
    expect(listControl).toHaveAttribute("aria-checked", "mixed");
    expect(listControl).toHaveClass("markdown-task-checkbox--indeterminate");
    expect(listControl.closest("li")).toHaveClass("markdown-task-item--indeterminate");
    expect(tableControl).toHaveAttribute("aria-checked", "mixed");
    expect(tableControl.closest("td")).toHaveAttribute("data-checklist-indeterminate", "true");
    expect(view.container.querySelectorAll(".markdown-task-checkbox--indeterminate")).toHaveLength(2);
  });

  it("uses Command-click for indeterminate persistence while ordinary clicks keep binary transitions", async () => {
    const user = userEvent.setup();
    const onTaskChange = vi.fn();
    const markdown = "- [ ] Open\n- [x] Done\n- [-] Mixed";
    render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Open" }), { metaKey: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Снять отметку: Done" }), { metaKey: true });
    await user.click(screen.getByRole("checkbox", { name: "Отметить: Mixed" }));

    expect(onTaskChange).toHaveBeenNthCalledWith(1, "- [-] Open\n- [x] Done\n- [-] Mixed");
    expect(onTaskChange).toHaveBeenNthCalledWith(2, "- [ ] Open\n- [-] Done\n- [-] Mixed");
    expect(onTaskChange).toHaveBeenNthCalledWith(3, "- [ ] Open\n- [x] Done\n- [x] Mixed");
    expect(setMarkdownTaskState("Heading\r\n- [ ] First\r\n- [x] Second", 2, "indeterminate")).toBe(
      "Heading\r\n- [ ] First\r\n- [-] Second",
    );
  });

  it("uses Command-click to persist indeterminate table cells without toggling adjacent source", () => {
    const onTaskChange = vi.fn();
    const markdown = [
      "| Name | First | Second |",
      "| --- | --- | --- |",
      "| Tower | [ ] | [x] |",
    ].join("\n");
    render(<MarkdownView markdown={markdown} onTaskChange={onTaskChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: Tower — First" }), { metaKey: true });

    expect(onTaskChange).toHaveBeenCalledWith([
      "| Name | First | Second |",
      "| --- | --- | --- |",
      "| Tower | [-] | [x] |",
    ].join("\n"));
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

  it("marks a mixed table row yellow while preserving a checked cell's green over the row aggregate", () => {
    const markdown = [
      "| Stage | Own | Mixed | Note |",
      "| --- | --- | --- | --- |",
      "| Mixed | [x] | [-] | Local note |",
      "| Other | [x] | [ ] | [x] |",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const ownCheckedCell = screen.getByRole("checkbox", { name: "Снять отметку: Mixed — Own" }).closest("td")!;
    const completedColumnCell = screen.getByText("Local note").closest("td")!;
    const mixedCell = screen.getByRole("checkbox", { name: "Отметить: Mixed — Mixed" }).closest("td")!;
    const mixedRow = completedColumnCell.closest("tr")!;

    expect(mixedRow).toHaveClass("markdown-table-row--indeterminate");
    expect(ownCheckedCell).toHaveAttribute("data-checklist-checked", "true");
    expect(ownCheckedCell).toHaveAttribute("data-checklist-column-complete", "true");
    expect(completedColumnCell).toHaveAttribute("data-checklist-column-complete", "true");
    expect(completedColumnCell).not.toHaveAttribute("data-checklist-checked");
    expect(mixedCell).toHaveAttribute("data-checklist-indeterminate", "true");

    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);
    try {
      const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
      const warningRow = rules.find((rule) => rule.selectorText === ".markdown-table .markdown-table-row--indeterminate > td");
      const checkedOverride = rules.find((rule) => rule.selectorText === ".markdown-table .markdown-table-row--indeterminate > td[data-checklist-checked=\"true\"]");
      const completedColumn = rules.find((rule) => rule.selectorText.includes('td[data-checklist-column-complete="true"]'));

      expect(warningRow).toBeDefined();
      expect(warningRow!.style.background).toBe("rgba(214, 167, 43, 0.14)");
      expect(warningRow!.style.color).toBe("rgb(214, 167, 43)");
      expect(checkedOverride).toBeDefined();
      expect(checkedOverride!.style.background).toBe("var(--success-wash)");
      expect(rules.indexOf(completedColumn!)).toBeLessThan(rules.indexOf(warningRow!));
      expect(rules.indexOf(warningRow!)).toBeLessThan(rules.indexOf(checkedOverride!));
      expect(getComputedStyle(ownCheckedCell).background).toBe("var(--success-wash)");
      expect(getComputedStyle(completedColumnCell).background).toBe("rgba(214, 167, 43, 0.14)");
      expect(getComputedStyle(mixedCell).background).toBe("rgba(214, 167, 43, 0.14)");
    } finally {
      style.remove();
    }
  });

  it("keeps inline links and code warning yellow in indeterminate rows and headings without recoloring subsection body content", () => {
    const markdown = [
      "# Root",
      "## [Mixed heading](https://example.com/heading) `Heading code`",
      "Body [body link](https://example.com/body) `Body code`",
      "- [-] Direct mixed task",
      "| Stage | Detail |",
      "| --- | --- |",
      "| Mixed row | [-] [Row link](https://example.com/row) `Row code` |",
    ].join("\n");

    render(<MarkdownView markdown={markdown} />);

    const heading = screen.getByRole("heading", { name: /Mixed heading Heading code/ });
    const row = screen.getByText("Mixed row").closest("tr")!;
    const headingLink = screen.getByRole("link", { name: "Mixed heading" });
    const rowLink = screen.getByRole("link", { name: "Row link" });
    const bodyLink = screen.getByRole("link", { name: "body link" });
    const headingCode = screen.getByText("Heading code");
    const rowCode = screen.getByText("Row code");
    const bodyCode = screen.getByText("Body code");

    expect(row).toHaveClass("markdown-table-row--indeterminate");
    expect(heading.closest(".markdown-checklist-subsection")).toHaveClass("markdown-checklist-subsection--indeterminate");

    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);
    try {
      for (const element of [headingLink, rowLink, headingCode, rowCode]) {
        expect(getComputedStyle(element).color).toBe("rgb(214, 167, 43)");
      }
      expect(getComputedStyle(bodyLink).color).toBe("var(--accent-strong)");
      expect(getComputedStyle(bodyCode).color).toBe("rgb(203, 217, 227)");
    } finally {
      style.remove();
    }
  });

  it("keeps a mixed child local until a direct parent task becomes indeterminate", () => {
    const initialMarkdown = [
      "# Root",
      "## Parent",
      "- [ ] Parent task",
      "### Complete child",
      "- [x] Complete task",
      "### Mixed child",
      "- [-] Mixed task",
    ].join("\n");
    const directParentMixedMarkdown = initialMarkdown.replace("- [ ] Parent task", "- [-] Parent task");
    const view = render(<MarkdownView markdown={initialMarkdown} />);

    const parent = screen.getByRole("heading", { name: "Parent Выполнено 1 из 3" }).closest<HTMLElement>(".markdown-checklist-subsection")!;
    const completeChild = screen.getByRole("heading", { name: "Complete child Выполнено 1 из 1" }).closest<HTMLElement>(".markdown-checklist-subsection")!;
    const mixedChild = screen.getByRole("heading", { name: "Mixed child Выполнено 0 из 1" }).closest<HTMLElement>(".markdown-checklist-subsection")!;

    expect(parent).not.toHaveClass("markdown-checklist-subsection--indeterminate");
    expect(completeChild).toHaveClass("markdown-checklist-subsection--complete");
    expect(completeChild).not.toHaveClass("markdown-checklist-subsection--indeterminate");
    expect(mixedChild).toHaveClass("markdown-checklist-subsection--indeterminate");
    expect(mixedChild).not.toHaveClass("markdown-checklist-subsection--complete");

    const style = document.createElement("style");
    style.textContent = productionStyles;
    document.head.append(style);
    try {
      const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
      const warningSubsection = rules.find((rule) => rule.selectorText === ".markdown-checklist-subsection--indeterminate");
      const warningGap = rules.find((rule) => rule.selectorText === ".markdown-checklist-subsection--indeterminate::after");
      const warningHeading = rules.find((rule) => rule.selectorText === ".markdown-checklist-subsection--indeterminate > .markdown-checklist-heading");
      const warningProgress = rules.find((rule) => rule.selectorText === ".markdown-checklist-subsection--indeterminate > .markdown-checklist-heading .markdown-checklist-progress");

      expect(warningSubsection).toBeDefined();
      expect(warningSubsection!.style.background).toBe("rgba(214, 167, 43, 0.14)");
      expect(warningSubsection!.style.color).toBe("");
      expect(warningGap).toBeDefined();
      expect(warningGap!.style.height).toBe("var(--markdown-checklist-subsection-gap)");
      expect(warningGap!.style.background).toBe("rgba(214, 167, 43, 0.14)");
      expect(warningHeading).toBeDefined();
      expect(warningHeading!.style.color).toBe("rgb(214, 167, 43)");
      expect(warningProgress).toBeDefined();
      expect(warningProgress!.style.color).toBe("inherit");
    } finally {
      style.remove();
    }

    view.rerender(<MarkdownView markdown={directParentMixedMarkdown} />);

    expect(screen.getByRole("heading", { name: "Parent Выполнено 1 из 3" }).closest(".markdown-checklist-subsection")).toHaveClass("markdown-checklist-subsection--indeterminate");
    expect(screen.getByRole("heading", { name: "Complete child Выполнено 1 из 1" }).closest(".markdown-checklist-subsection")).toHaveClass("markdown-checklist-subsection--complete");
    expect(screen.getByRole("heading", { name: "Mixed child Выполнено 0 из 1" }).closest(".markdown-checklist-subsection")).toHaveClass("markdown-checklist-subsection--indeterminate");
  });

  it("keeps a collapsed subsection yellow when its hidden source block is indeterminate", async () => {
    const user = userEvent.setup();
    const markdown = [
      "# Root",
      "## Collapsed mixed route",
      "- [-] Local mixed task",
      "### Hidden child",
      "- [x] Hidden complete task",
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

    await user.click(screen.getByRole("button", { name: "Collapsed mixed route Выполнено 1 из 2" }));

    const route = screen.getByRole("heading", { name: "Collapsed mixed route Выполнено 1 из 2" });
    const subsection = route.closest<HTMLElement>(".markdown-checklist-subsection")!;
    expect(subsection).toHaveClass("markdown-checklist-subsection--indeterminate");
    expect(subsection.querySelectorAll(".markdown-checklist-subsection")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: /Hidden child/ })).not.toBeInTheDocument();
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
