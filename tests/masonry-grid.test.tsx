import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MasonryGrid, masonryRowSpan } from "../src/components/MasonryGrid";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Safari-safe masonry grid", () => {
  it("calculates stable row spans from card height", () => {
    expect(masonryRowSpan(0)).toBe(1);
    expect(masonryRowSpan(100, 1, 7)).toBe(14);
    expect(masonryRowSpan(240, 1, 7)).toBe(31);
    expect(masonryRowSpan(Number.NaN)).toBe(1);
  });

  it("keeps the same card nodes while recalculating changed heights", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const height = Number((this as HTMLElement).dataset.height ?? 0);
      return { width: 360, height } as DOMRect;
    });

    const { container, rerender } = render(
      <MasonryGrid className="notes-list">
        <article data-height="100" key="first" />
        <article data-height="240" key="second" />
        <article data-height="80" key="third" />
      </MasonryGrid>,
    );
    const originalCards = Array.from(container.querySelectorAll("article"));
    expect(originalCards.map((card) => card.style.gridRowEnd)).toEqual(["span 14", "span 31", "span 11"]);

    rerender(
      <MasonryGrid className="notes-list">
        <article data-height="100" key="first" />
        <article data-height="320" key="second" />
        <article data-height="80" key="third" />
      </MasonryGrid>,
    );
    const updatedCards = Array.from(container.querySelectorAll("article"));
    expect(updatedCards).toEqual(originalCards);
    expect(updatedCards.map((card) => card.style.gridRowEnd)).toEqual(["span 14", "span 41", "span 11"]);
  });
});
