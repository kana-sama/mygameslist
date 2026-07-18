import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShelfLayout, ShelfGrid } from "../src/components/ShelfGrid";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ordered shelf layout", () => {
  it("stretches ordinary cards to the tallest card in their row", () => {
    const layout = buildShelfLayout([100, 150, 120], 3);

    expect(layout.height).toBe(150);
    expect(layout.placements).toEqual([
      expect.objectContaining({ index: 0, shelf: 0, column: 0, top: 0, height: 150, stackPosition: "single" }),
      expect.objectContaining({ index: 1, shelf: 0, column: 1, top: 0, height: 150, stackPosition: "single" }),
      expect.objectContaining({ index: 2, shelf: 0, column: 2, top: 0, height: 150, stackPosition: "single" }),
    ]);
  });

  it("stacks only two adjacent cards and makes their combined height exact", () => {
    const layout = buildShelfLayout([40, 50, 140, 60], 3);
    const [top, bottom, tallest, trailing] = layout.placements;

    expect(top).toMatchObject({ index: 0, shelf: 0, column: 0, top: 0, height: 59, shelfHeight: 140, stackPosition: "top" });
    expect(bottom).toMatchObject({ index: 1, shelf: 0, column: 0, top: 65, height: 75, shelfHeight: 140, stackPosition: "bottom" });
    expect(top.height + 6 + bottom.height).toBe(140);
    expect(tallest).toMatchObject({ index: 2, column: 1, height: 140, stackPosition: "single" });
    expect(trailing).toMatchObject({ index: 3, column: 2, height: 140, stackPosition: "single" });
  });

  it("pulls another card into a freed column and repeats packing when it raises the row", () => {
    const layout = buildShelfLayout([40, 40, 100, 180, 50], 3);

    expect(layout.placements.slice(0, 4)).toEqual([
      expect.objectContaining({ index: 0, shelf: 0, column: 0, stackPosition: "top", shelfHeight: 180 }),
      expect.objectContaining({ index: 1, shelf: 0, column: 0, stackPosition: "bottom", shelfHeight: 180 }),
      expect.objectContaining({ index: 2, shelf: 0, column: 1, height: 180 }),
      expect.objectContaining({ index: 3, shelf: 0, column: 2, height: 180 }),
    ]);
    expect(layout.placements[4]).toMatchObject({ index: 4, shelf: 1, column: 0, top: 192, height: 50, stackPosition: "single" });
    expect(layout.height).toBe(242);
  });

  it("rejects an over-height pair and keeps the final incomplete row ordered", () => {
    const layout = buildShelfLayout([80, 80, 150, 90], 3);

    expect(layout.placements.slice(0, 3).map((placement) => placement.stackPosition)).toEqual(["single", "single", "single"]);
    expect(layout.placements.slice(0, 3).map((placement) => placement.height)).toEqual([150, 150, 150]);
    expect(layout.placements[3]).toMatchObject({ index: 3, shelf: 1, column: 0, top: 162, height: 90, stackPosition: "single" });
    expect(layout.height).toBe(252);
  });

  it("keeps a single column sequential and handles invalid measurements", () => {
    const layout = buildShelfLayout([40, Number.NaN, 50], 1);

    expect(layout.placements).toEqual([
      expect.objectContaining({ index: 0, shelf: 0, column: 0, top: 0, height: 40, stackPosition: "single" }),
      expect.objectContaining({ index: 1, shelf: 1, column: 0, top: 52, height: 1, stackPosition: "single" }),
      expect.objectContaining({ index: 2, shelf: 2, column: 0, top: 65, height: 50, stackPosition: "single" }),
    ]);
  });

  it("measures natural card heights without grid stretch before packing adjacent cards", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      if (this.dataset.naturalHeight) {
        const grid = this.parentElement!;
        const noteCard = this.matches(".note-card") ? this : this.querySelector<HTMLElement>(".note-card")!;
        const surface = noteCard.querySelector<HTMLElement>(".note-card__surface");
        expect(grid).toHaveAttribute("data-shelf-measuring", "true");
        expect(grid.style.alignItems).toBe("start");
        expect(this.style.alignSelf).toBe("start");
        expect(this.style.height).toBe("auto");
        expect(noteCard.style.height).toBe("auto");
        expect(surface?.style.height).toBe("auto");
        return { width: 360, height: Number(this.dataset.naturalHeight) } as DOMRect;
      }
      return { width: 360, height: 300 } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="natural-heights">
        <article className="note-card" data-natural-height="300" data-note-id="long">
          <div className="note-card__surface" />
        </article>
        <article className="note-card" data-natural-height="40" data-note-id="short-a">
          <div className="note-card__surface" />
        </article>
        <div className="note-editor-sortable" data-natural-height="40" data-note-id="short-b">
          <article className="note-card"><div className="note-card__surface" /></article>
        </div>
      </ShelfGrid>,
    );

    const cards = Array.from(container.querySelector<HTMLElement>(".notes-list")!.children) as HTMLElement[];
    expect(cards.map((card) => [card.dataset.shelfPosition, card.style.gridColumnStart, card.style.gridRowEnd])).toEqual([
      ["single", "1", "span 300"],
      ["top", "2", "span 147"],
      ["bottom", "2", "span 147"],
    ]);
    expect(container.querySelector<HTMLElement>(".notes-list")!.style.alignItems).toBe("");
    expect(cards.every((card) => card.style.height === "" && card.style.alignSelf === "")).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".note-card, .note-card__surface")).every((element) => element.style.height === "")).toBe(true);
  });

  it("keeps the same card nodes while a frozen composition changes height, then repacks once thawed", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      return { width: 360, height: Number((this as HTMLElement).dataset.height ?? 0) } as DOMRect;
    });

    const { container, rerender } = render(
      <ShelfGrid className="notes-list" layoutKey="initial">
        <article data-height="40" data-note-id="first" key="first" />
        <article data-height="50" data-note-id="second" key="second" />
        <article data-height="140" data-note-id="third" key="third" />
      </ShelfGrid>,
    );
    const originalCards = Array.from(container.querySelectorAll("article"));
    expect(originalCards.map((card) => [card.dataset.shelfPosition, card.style.gridColumnStart, card.style.gridRowEnd])).toEqual([
      ["top", "1", "span 59"],
      ["bottom", "1", "span 75"],
      ["single", "2", "span 140"],
    ]);

    rerender(
      <ShelfGrid className="notes-list" layoutKey="initial" packingFrozen>
        <article data-height="100" data-note-id="first" key="first" />
        <article data-height="100" data-note-id="second" key="second" />
        <article data-height="180" data-note-id="third" key="third" />
      </ShelfGrid>,
    );
    const updatedCards = Array.from(container.querySelectorAll("article"));
    expect(updatedCards).toEqual(originalCards);
    expect(updatedCards.map((card) => card.dataset.shelfPosition)).toEqual(["top", "bottom", "single"]);
    expect(updatedCards[0].getAttribute("style")).toContain("grid-row-end: span 100");
    expect(updatedCards[1].getAttribute("style")).toContain("grid-row-end: span 100");
    expect(updatedCards[2].getAttribute("style")).toContain("grid-row-end: span 206");

    rerender(
      <ShelfGrid className="notes-list" layoutKey="initial">
        <article data-height="100" data-note-id="first" key="first" />
        <article data-height="100" data-note-id="second" key="second" />
        <article data-height="180" data-note-id="third" key="third" />
      </ShelfGrid>,
    );
    expect(Array.from(container.querySelectorAll("article"))).toEqual(originalCards);
    expect(Array.from(container.querySelectorAll<HTMLElement>("article")).map((card) => [card.dataset.shelfPosition, card.style.gridColumnStart, card.style.gridRowEnd])).toEqual([
      ["single", "1", "span 180"],
      ["single", "2", "span 180"],
      ["single", "3", "span 180"],
    ]);
  });

  it("preserves DOM nodes while a resize changes the column count", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    let gridWidth = 1100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: gridWidth, height: 300 } as DOMRect;
      return { width: 360, height: Number((this as HTMLElement).dataset.height ?? 0) } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="stable">
        <article data-height="100" data-note-id="first" />
        <article data-height="120" data-note-id="second" />
        <article data-height="140" data-note-id="third" />
      </ShelfGrid>,
    );
    const originalCards = Array.from(container.querySelectorAll("article"));
    expect(originalCards.map((card) => card.style.gridColumnStart)).toEqual(["1", "2", "3"]);

    gridWidth = 500;
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => expect(Array.from(container.querySelectorAll<HTMLElement>("article")).map((card) => card.dataset.shelfIndex)).toEqual(["0", "1", "2"]));
    expect(Array.from(container.querySelectorAll("article"))).toEqual(originalCards);
  });
});
