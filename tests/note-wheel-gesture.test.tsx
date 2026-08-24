import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamePage } from "../src/pages/GamePage";

vi.mock("../src/components/MonacoMarkdownEditor", async () => import("./mocks/MonacoMarkdownEditorMock"));

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-16T10:00:00.000Z";

function setDimension(element: HTMLElement, name: "scrollHeight" | "clientHeight" | "scrollTop", value: number): void {
  Object.defineProperty(element, name, { configurable: true, writable: true, value });
}

function dispatchVerticalWheel(viewport: HTMLElement, deltaY: number, options: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, ...options });
  viewport.dispatchEvent(event);
  return event;
}

describe("installNoteWheelGestureRouting", () => {
  let viewport: HTMLDivElement;
  let pageScrollBy: ReturnType<typeof vi.fn>;
  let scrollingElement: HTMLElement;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    const view = render(<GamePage assets={{}} game={{ id: GAME_ID, title: "Wheel test", coverAssetId: null, platforms: [], tags: [], status: "playing", placement: { tierId: "a", rank: 1024 }, reviewMarkdown: "", progressItems: [], createdAt: NOW, updatedAt: NOW }} mode="game" notes={[{ id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "Wheel test note", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW }]} onSave={vi.fn()} />);
    unmount = view.unmount;
    viewport = document.querySelector<HTMLDivElement>(".note-card__viewport")!;
    setDimension(viewport, "scrollHeight", 400);
    setDimension(viewport, "clientHeight", 200);
    setDimension(viewport, "scrollTop", 0);
    scrollingElement = document.createElement("main");
    pageScrollBy = vi.fn();
    scrollingElement.scrollBy = pageScrollBy;
    Object.defineProperty(document, "scrollingElement", { configurable: true, value: scrollingElement });
  });

  afterEach(() => {
    unmount?.();
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("routes a new downward gesture to the page when the note already starts at bottom", () => {
    setDimension(viewport, "scrollTop", 200);
    const event = dispatchVerticalWheel(viewport, 60);
    expect(event.defaultPrevented).toBe(true);
    expect(pageScrollBy).toHaveBeenCalledWith({ top: 60, behavior: "instant" });
  });

  it("keeps a gesture in the note after that gesture reaches bottom", () => {
    setDimension(viewport, "scrollTop", 120);
    dispatchVerticalWheel(viewport, 240);
    setDimension(viewport, "scrollTop", 200);
    dispatchVerticalWheel(viewport, 40);
    expect(pageScrollBy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(161);
    dispatchVerticalWheel(viewport, 40);
    expect(pageScrollBy).toHaveBeenCalledOnce();
  });

  it("mirrors boundary routing at the top", () => {
    setDimension(viewport, "scrollTop", 0);
    const event = dispatchVerticalWheel(viewport, -30);
    expect(event.defaultPrevented).toBe(true);
    expect(pageScrollBy).toHaveBeenCalledWith({ top: -30, behavior: "instant" });
  });

  it("keeps an upward gesture in the note after reaching the top", () => {
    setDimension(viewport, "scrollTop", 80);
    dispatchVerticalWheel(viewport, -100);
    setDimension(viewport, "scrollTop", 0);
    dispatchVerticalWheel(viewport, -20);
    expect(pageScrollBy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(161);
    dispatchVerticalWheel(viewport, -20);
    expect(pageScrollBy).toHaveBeenCalledOnce();
  });

  it("routes a non-scrollable note to the page", () => {
    setDimension(viewport, "scrollHeight", 200);
    const event = dispatchVerticalWheel(viewport, 25);
    expect(event.defaultPrevented).toBe(true);
    expect(pageScrollBy).toHaveBeenCalledWith({ top: 25, behavior: "instant" });
  });

  it.each([
    [WheelEvent.DOM_DELTA_PIXEL, 2, 2],
    [WheelEvent.DOM_DELTA_LINE, 2, 32],
    [WheelEvent.DOM_DELTA_PAGE, 2, 1280],
  ])("normalizes delta mode %s", (deltaMode, deltaY, expectedTop) => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ lineHeight: "16px" } as CSSStyleDeclaration);
    setDimension(viewport, "scrollTop", 200);
    dispatchVerticalWheel(viewport, deltaY, { deltaMode });
    expect(pageScrollBy).toHaveBeenCalledWith({ top: expectedTop, behavior: "instant" });
  });

  it("ignores pinch zoom, zero vertical delta, and horizontal-dominant input", () => {
    setDimension(viewport, "scrollTop", 200);
    const pinch = dispatchVerticalWheel(viewport, 20, { ctrlKey: true });
    const zero = dispatchVerticalWheel(viewport, 0);
    const horizontal = dispatchVerticalWheel(viewport, 20, { deltaX: 21 });
    expect(pinch.defaultPrevented).toBe(false);
    expect(zero.defaultPrevented).toBe(false);
    expect(horizontal.defaultPrevented).toBe(false);
    expect(pageScrollBy).not.toHaveBeenCalled();
  });

  it.each([
    ["pinch", { ctrlKey: true }],
    ["zero", { deltaY: 0 }],
    ["horizontal", { deltaX: 21 }],
  ])("does not let %s input extend a note-routed gesture", (_name, ignored) => {
    setDimension(viewport, "scrollTop", 100);
    dispatchVerticalWheel(viewport, 20);
    vi.advanceTimersByTime(100);
    dispatchVerticalWheel(viewport, 20, ignored);
    vi.advanceTimersByTime(61);
    setDimension(viewport, "scrollTop", 200);
    dispatchVerticalWheel(viewport, 20);
    expect(pageScrollBy).toHaveBeenCalledOnce();
  });

  it("treats equal-axis diagonal input as relevant vertical input", () => {
    setDimension(viewport, "scrollTop", 200);
    const event = dispatchVerticalWheel(viewport, 20, { deltaX: 20 });
    expect(event.defaultPrevented).toBe(true);
    expect(pageScrollBy).toHaveBeenCalledOnce();
  });

  it("applies the one-pixel bottom tolerance", () => {
    setDimension(viewport, "scrollTop", 199.5);
    const event = dispatchVerticalWheel(viewport, 20);
    expect(event.defaultPrevented).toBe(true);
    expect(pageScrollBy).toHaveBeenCalledOnce();
  });

  it("removes the listener and pending timer during cleanup", () => {
    const baseline = vi.getTimerCount();
    setDimension(viewport, "scrollTop", 100);
    dispatchVerticalWheel(viewport, 10);
    expect(vi.getTimerCount()).toBe(baseline + 1);
    unmount?.();
    unmount = undefined;
    expect(vi.getTimerCount()).toBe(baseline);
    const event = dispatchVerticalWheel(viewport, 10);
    expect(event.defaultPrevented).toBe(false);
    expect(pageScrollBy).not.toHaveBeenCalled();
  });
});
