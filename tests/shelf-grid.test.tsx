import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildShelfLayout,
  expandShelfLayout,
  shelfColumnSpanForWidth,
  ShelfGrid,
  type ShelfLayout,
} from "../src/components/ShelfGrid";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

class ShelfMeasurementDisconnectingCard extends HTMLElement {
  connectedCallback() {
    if (this.parentElement?.hasAttribute("data-shelf-measuring")) this.remove();
  }
}

if (!customElements.get("shelf-measurement-disconnecting-card")) {
  customElements.define("shelf-measurement-disconnecting-card", ShelfMeasurementDisconnectingCard);
}

const measurementAttachmentSnapshots: Array<{
  grid: HTMLElement;
  parent: HTMLElement | null;
  ids: number;
  resources: Array<{ src: string | null; srcset: string | null; poster: string | null }>;
}> = [];

class ShelfMeasurementProbe extends HTMLElement {
  connectedCallback() {
    const grid = this.parentElement;
    if (!grid?.hasAttribute("data-shelf-measuring")) return;
    measurementAttachmentSnapshots.push({
      grid,
      parent: grid.parentElement,
      ids: grid.querySelectorAll("[id]").length + Number(grid.hasAttribute("id")),
      resources: Array.from(grid.querySelectorAll("iframe, img, audio, video, source")).map((element) => ({
        src: element.getAttribute("src"),
        srcset: element.getAttribute("srcset"),
        poster: element.getAttribute("poster"),
      })),
    });
  }
}

if (!customElements.get("shelf-measurement-probe")) {
  customElements.define("shelf-measurement-probe", ShelfMeasurementProbe);
}

function expectNoPlacementOverlaps(layout: ShelfLayout): void {
  for (let leftIndex = 0; leftIndex < layout.placements.length; leftIndex += 1) {
    const left = layout.placements[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < layout.placements.length; rightIndex += 1) {
      const right = layout.placements[rightIndex];
      if (left.shelf !== right.shelf) continue;
      const columnsOverlap = left.column < right.column + right.columnSpan
        && right.column < left.column + left.columnSpan;
      const rowsOverlap = left.top < right.top + right.height
        && right.top < left.top + left.height;
      expect(columnsOverlap && rowsOverlap, `placements ${left.index} and ${right.index} overlap`).toBe(false);
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ordered shelf layout", () => {
  it("does not remeasure cards for note visual-state mutations but remeasures geometry mutations", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frame = nextFrame;
      nextFrame += 1;
      frames.set(frame, callback);
      return frame;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frame: number) => frames.delete(frame)));
    let measurements = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      if ((this as HTMLElement).matches(".notes-list > [data-card]")) measurements += 1;
      return { width: 360, height: 100 } as DOMRect;
    });
    const flushFrames = () => {
      while (frames.size) {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(0));
      }
    };

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="visual-mutations">
        <article data-card="one"><div className="note-card__viewport-frame" /><span className="markdown-checklist-progress">0/1</span><label className="markdown-task-item"><input className="markdown-task-checkbox" type="checkbox" /></label><button className="markdown-checklist-toggle" aria-expanded="true" type="button" /></article>
        <article data-card="two" />
      </ShelfGrid>,
    );
    const grid = container.querySelector<HTMLElement>(".notes-list")!;
    const firstCard = grid.children[0] as HTMLElement;
    const viewportFrame = firstCard.querySelector<HTMLElement>(".note-card__viewport-frame")!;
    const progress = firstCard.querySelector<HTMLElement>(".markdown-checklist-progress")!;
    const task = firstCard.querySelector<HTMLElement>(".markdown-task-item")!;
    const toggle = firstCard.querySelector<HTMLButtonElement>(".markdown-checklist-toggle")!;

    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    measurements = 0;

    progress.textContent = "1/1";
    task.classList.add("markdown-task-item--checked");
    task.querySelector("input")!.classList.add("markdown-task-checkbox--checked");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBe(0);

    viewportFrame.classList.add("is-scrollable", "can-scroll-down");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBe(0);

    viewportFrame.classList.remove("can-scroll-down");
    viewportFrame.classList.add("can-scroll-up");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBe(0);

    viewportFrame.classList.remove("is-scrollable", "can-scroll-up");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBe(0);

    viewportFrame.classList.add("markdown-task-item--checked");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBeGreaterThan(0);

    measurements = 0;
    progress.classList.add("can-scroll-up");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBeGreaterThan(0);

    measurements = 0;
    viewportFrame.classList.add("note-card__viewport-height-changed");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBeGreaterThan(0);

    measurements = 0;
    firstCard.classList.add("note-card__content-height-changed");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBeGreaterThan(0);

    measurements = 0;
    toggle.setAttribute("aria-expanded", "false");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });
    expect(measurements).toBeGreaterThan(0);
  });

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

  it("reserves two adjacent columns for a wide card", () => {
    const layout = buildShelfLayout([120, 90, 80], 3, { columnSpans: [2, 1, 1] });

    expect(layout.placements).toEqual([
      expect.objectContaining({ index: 0, shelf: 0, column: 0, columnSpan: 2, height: 120 }),
      expect.objectContaining({ index: 1, shelf: 0, column: 2, columnSpan: 1, height: 120 }),
      expect.objectContaining({ index: 2, shelf: 1, column: 0, columnSpan: 1, top: 132, height: 80 }),
    ]);
  });

  it("falls a wide card back to one column when only one is available", () => {
    const layout = buildShelfLayout([120, 90], 1, { columnSpans: [2, 1] });

    expect(layout.placements).toEqual([
      expect.objectContaining({ index: 0, shelf: 0, column: 0, columnSpan: 1 }),
      expect.objectContaining({ index: 1, shelf: 1, column: 0, columnSpan: 1 }),
    ]);
  });

  it("reserves arbitrary spans and converts pixel demand to the smallest span", () => {
    expect(shelfColumnSpanForWidth(360, 1464, 4, 8)).toBe(1);
    expect(shelfColumnSpanForWidth(361, 1464, 4, 8)).toBe(2);
    expect(shelfColumnSpanForWidth(1090, 1464, 4, 8)).toBe(3);
    expect(shelfColumnSpanForWidth(Number.POSITIVE_INFINITY, 1464, 4, 8)).toBe(4);
    expect(shelfColumnSpanForWidth(Number.NaN, 1464, 4, 8)).toBe(1);
    expect(shelfColumnSpanForWidth(720, 1464, Number.NaN, 8)).toBe(1);

    const layout = buildShelfLayout([100, 80], 4, { columnSpans: [3, 1] });
    expect(layout.placements).toEqual([
      expect.objectContaining({ index: 0, column: 0, columnSpan: 3 }),
      expect.objectContaining({ index: 1, column: 3, columnSpan: 1 }),
    ]);
  });

  it("grows in place, displaces right cards, and clamps at the boundary", () => {
    const initial = buildShelfLayout([100, 100, 100, 100, 100], 4);
    const snapshot = structuredClone(initial);
    const middle = expandShelfLayout([100, 100, 100, 100, 100], 4, initial, {
      columnSpans: [1, 1, 1, 1, 1],
      expansion: { index: 1, requestedSpan: 3 },
    });

    expect(initial).toEqual(snapshot);
    expect(middle.placements[1]).toMatchObject({ shelf: 0, column: 1, columnSpan: 3, top: 0 });
    expect(middle.placements[0]).toMatchObject({ shelf: 0, column: 0, top: 0 });
    expect(middle.placements[2].shelf).toBeGreaterThan(0);
    expect(middle.placements.map((placement) => placement.index).sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4]);
    expect(middle.placements.every((placement) => placement.column >= 0 && placement.column + placement.columnSpan <= 4)).toBe(true);
    expectNoPlacementOverlaps(middle);

    const rightEdgeInitial = buildShelfLayout([100, 100, 100, 100], 4);
    const rightEdge = expandShelfLayout([100, 100, 100, 100], 4, rightEdgeInitial, {
      columnSpans: [1, 1, 1, 1],
      expansion: { index: 3, requestedSpan: 4 },
    });
    expect(rightEdge.placements[3]).toMatchObject({ shelf: 0, column: 3, columnSpan: 1 });
  });

  it("displaces both members of a stack to the right of an expanding anchor in document order", () => {
    const initial = buildShelfLayout([150, 40, 40, 150, 100], 4);
    expect(initial.placements.slice(1, 3)).toEqual([
      expect.objectContaining({ index: 1, shelf: 0, column: 1, stackPosition: "top" }),
      expect.objectContaining({ index: 2, shelf: 0, column: 1, stackPosition: "bottom" }),
    ]);

    const expanded = expandShelfLayout([150, 40, 40, 150, 100], 4, initial, {
      columnSpans: [1, 1, 1, 1, 1],
      expansion: { index: 0, requestedSpan: 2 },
    });

    expect(expanded.placements.slice(1, 3)).toEqual([
      expect.objectContaining({ index: 1, column: 2, stackPosition: "top" }),
      expect.objectContaining({ index: 2, column: 2, stackPosition: "bottom" }),
    ]);
    expect(expanded.placements.map((placement) => placement.index)).toEqual([0, 1, 2, 3, 4]);
    expectNoPlacementOverlaps(expanded);
  });

  it("keeps displaced short cards stacked when only one right-side column remains", () => {
    const initial = buildShelfLayout([150, 40, 40, 150], 4);
    const expanded = expandShelfLayout([150, 40, 40, 150], 4, initial, {
      columnSpans: [1, 1, 1, 1],
      expansion: { index: 0, requestedSpan: 3 },
    });

    expect(expanded.placements.slice(1, 3)).toEqual([
      expect.objectContaining({ index: 1, shelf: 0, column: 3, stackPosition: "top" }),
      expect.objectContaining({ index: 2, shelf: 0, column: 3, stackPosition: "bottom" }),
    ]);
    expectNoPlacementOverlaps(expanded);
  });

  it("keeps a bottom stack member's absolute top while displacing its former partner exactly once", () => {
    const heights = [40, 40, 150, 100, 100];
    const initial = buildShelfLayout(heights, 4);
    const anchorBefore = initial.placements[1];
    expect(anchorBefore).toMatchObject({ shelf: 0, column: 0, stackPosition: "bottom" });

    const expanded = expandShelfLayout(heights, 4, initial, {
      columnSpans: [1, 1, 1, 1, 1],
      expansion: { index: 1, requestedSpan: 3 },
    });
    const anchorAfter = expanded.placements[1];

    expect(anchorAfter).toMatchObject({
      shelf: anchorBefore.shelf,
      column: anchorBefore.column,
      columnSpan: 3,
      top: anchorBefore.top,
      stackPosition: "single",
    });
    expect(expanded.placements.filter((placement) => placement.index === 0)).toHaveLength(1);
    expect(expanded.placements.map((placement) => placement.index).sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4]);
    expectNoPlacementOverlaps(expanded);
  });

  it("preserves a sole widened bottom anchor's offset through a later expansion", () => {
    const heights = [40, 40, 150, 100];
    const initial = buildShelfLayout(heights, 4);
    const first = expandShelfLayout(heights, 4, initial, {
      columnSpans: [1, 1, 1, 1],
      expansion: { index: 1, requestedSpan: 4 },
    });
    const firstAnchorBefore = first.placements[1];
    const secondAnchorBefore = first.placements[2];
    expect(firstAnchorBefore.top).toBeGreaterThan(0);

    const second = expandShelfLayout(heights, 4, first, {
      columnSpans: [1, 1, 1, 1],
      expansion: { index: 2, requestedSpan: 3 },
    });

    expect(second.placements[1]).toMatchObject({
      shelf: firstAnchorBefore.shelf,
      column: firstAnchorBefore.column,
      columnSpan: firstAnchorBefore.columnSpan,
      top: firstAnchorBefore.top,
    });
    expect(second.placements[2]).toMatchObject({
      shelf: secondAnchorBefore.shelf,
      column: secondAnchorBefore.column,
      top: secondAnchorBefore.top,
    });
    expectNoPlacementOverlaps(second);
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
        expect(this).not.toHaveAttribute("data-shelf-position");
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

  it("measures natural card heights without resetting the live shelf", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frame = nextFrame;
      nextFrame += 1;
      frames.set(frame, callback);
      return frame;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frame: number) => frames.delete(frame)));
    let liveCard: HTMLElement | null = null;
    let liveGrid: HTMLElement | null = null;
    let toggle: HTMLButtonElement | null = null;
    let initialShelfPosition = "";
    let initialGridColumnStart = "";
    let initialGridColumnEnd = "";
    let initialGridRowStart = "";
    let initialGridRowEnd = "";
    let initialHeight = "";
    let verifySecondMeasurement = false;
    let measuredCard: HTMLElement | null = null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      if (this.dataset.naturalHeight) {
        if (verifySecondMeasurement) {
          measuredCard = this;
          expect(measuredCard).not.toBe(liveCard);
          expect(this.parentElement).toHaveAttribute("data-shelf-measuring", "true");
          expect(liveGrid).not.toHaveAttribute("data-shelf-measuring");
          expect(liveCard?.dataset.shelfPosition).toBe(initialShelfPosition);
          expect(liveCard?.style.gridColumnStart).toBe(initialGridColumnStart);
          expect(liveCard?.style.gridColumnEnd).toBe(initialGridColumnEnd);
          expect(liveCard?.style.gridRowStart).toBe(initialGridRowStart);
          expect(liveCard?.style.gridRowEnd).toBe(initialGridRowEnd);
          expect(liveCard?.style.height).toBe(initialHeight);
          expect(document.activeElement).toBe(toggle);
        }
        return { width: 360, height: Number(this.dataset.naturalHeight) } as DOMRect;
      }
      return { width: 360, height: 300 } as DOMRect;
    });

    const flushFrames = () => {
      while (frames.size) {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(0));
      }
    };

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="natural-heights">
        <article className="note-card" data-natural-height="100" data-note-id="card" style={{ height: "100px" }}>
          <button className="markdown-checklist-toggle" aria-expanded="false" type="button" />
          <div className="note-card__surface" />
        </article>
      </ShelfGrid>,
    );

    liveGrid = container.querySelector<HTMLElement>(".notes-list")!;
    liveCard = liveGrid.children[0] as HTMLElement;
    toggle = liveCard.querySelector<HTMLButtonElement>(".markdown-checklist-toggle")!;
    initialShelfPosition = liveCard.dataset.shelfPosition!;
    initialGridColumnStart = liveCard.style.gridColumnStart;
    initialGridColumnEnd = liveCard.style.gridColumnEnd;
    initialGridRowStart = liveCard.style.gridRowStart;
    initialGridRowEnd = liveCard.style.gridRowEnd;
    initialHeight = liveCard.style.height;
    expect([
      initialShelfPosition,
      initialGridColumnStart,
      initialGridColumnEnd,
      initialGridRowStart,
      initialGridRowEnd,
      initialHeight,
    ]).toEqual([
      "single", "1", "auto", "1", "span 100", "100px",
    ]);

    toggle.focus();
    liveCard.dataset.naturalHeight = "275";
    verifySecondMeasurement = true;
    toggle.setAttribute("aria-expanded", "true");
    await act(async () => {
      await Promise.resolve();
      flushFrames();
    });

    expect(measuredCard).not.toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(liveCard.style.gridRowEnd).toBe("span 275");
  });

  it("rejects a measurement clone whose connected card sequence differs from the live shelf", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    expect(() => render(
      <ShelfGrid className="notes-list" layoutKey="measurement-cardinality">
        {createElement("shelf-measurement-disconnecting-card", { "data-note-id": "generic-card" })}
      </ShelfGrid>,
    )).toThrow("Shelf measurement card sequence changed after cloning");
    expect(document.querySelectorAll("[data-shelf-measuring]")).toHaveLength(0);
  });

  it("sanitizes the offscreen clone before attachment and removes it after measurement", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    measurementAttachmentSnapshots.length = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container } = render(
      <div className="measurement-parent">
        <ShelfGrid className="notes-list" layoutKey="measurement-sanitization">
          {createElement("shelf-measurement-probe", { "data-note-id": "generic-card", id: "live-card" },
            createElement("img", { id: "live-image", src: "/image.png", srcSet: "/image-2x.png 2x" }),
            createElement("video", { id: "live-video", src: "/video.mp4", poster: "/poster.png" }),
            createElement("source", { id: "live-source", src: "/audio.mp3", srcSet: "/audio-2x.mp3 2x" }),
            createElement("iframe", { id: "live-frame", src: "/frame.html" }),
          )}
        </ShelfGrid>
      </div>,
    );

    const liveGrid = container.querySelector<HTMLElement>(".notes-list")!;
    expect(measurementAttachmentSnapshots).toHaveLength(1);
    const [snapshot] = measurementAttachmentSnapshots;
    expect(snapshot.parent).toBe(liveGrid.parentElement);
    expect(snapshot.grid).not.toBe(liveGrid);
    expect(snapshot.grid).toHaveAttribute("data-shelf-measuring", "true");
    expect(snapshot.grid).toHaveAttribute("aria-hidden", "true");
    expect(snapshot.grid.inert).toBe(true);
    expect(snapshot.grid.style).toMatchObject({
      position: "fixed",
      left: "-100000px",
      width: "1100px",
      visibility: "hidden",
      pointerEvents: "none",
      gridAutoRows: "auto",
    });
    expect(snapshot.ids).toBe(0);
    expect(snapshot.resources).toEqual([
      { src: null, srcset: null, poster: null },
      { src: null, srcset: null, poster: null },
      { src: null, srcset: null, poster: null },
      { src: null, srcset: null, poster: null },
    ]);
    expect(document.querySelectorAll("[data-shelf-measuring]")).toHaveLength(0);
  });

  it("removes the offscreen clone when natural-height measurement throws", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      if (this.parentElement?.hasAttribute("data-shelf-measuring")) throw new Error("synthetic measurement failure");
      return { width: 360, height: 100 } as DOMRect;
    });

    expect(() => render(
      <ShelfGrid className="notes-list" layoutKey="measurement-throw-cleanup">
        <article data-note-id="generic-card" />
      </ShelfGrid>,
    )).toThrow("synthetic measurement failure");
    expect(document.querySelectorAll("[data-shelf-measuring]")).toHaveLength(0);
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

  it("repacks a changed column span immediately while ordinary packing is frozen", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container, rerender } = render(
      <ShelfGrid className="notes-list" layoutKey="sizes">
        <article data-note-id="first" key="first" />
        <article data-note-id="second" key="second" />
        <article data-note-id="third" key="third" />
      </ShelfGrid>,
    );
    const originalCards = Array.from(container.querySelectorAll("article"));
    expect(originalCards.map((card) => card.style.gridColumnStart)).toEqual(["1", "2", "3"]);

    rerender(
      <ShelfGrid className="notes-list" layoutKey="sizes" packingFrozen>
        <article data-note-id="first" data-shelf-column-span="2" key="first" />
        <article data-note-id="second" key="second" />
        <article data-note-id="third" key="third" />
      </ShelfGrid>,
    );

    const updatedCards = Array.from(container.querySelectorAll("article"));
    expect(updatedCards).toEqual(originalCards);
    expect(updatedCards.map((card) => [card.dataset.shelfIndex, card.style.gridColumnStart, card.style.gridColumnEnd])).toEqual([
      ["0", "1", "span 2"],
      ["0", "3", "auto"],
      ["1", "1", "auto"],
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

  it("grows a direct child from descendant demand monotonically until that editor unmounts", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const view = render(
      <ShelfGrid className="notes-list" layoutKey="auto-width" packingFrozen>
        <article data-note-id="before" />
        <div data-note-id="editor">
          <article className="note-card--editing" data-shelf-required-width="720" />
        </div>
        <article data-note-id="right-a" />
        <article data-note-id="right-b" />
      </ShelfGrid>,
    );
    const grid = view.container.querySelector<HTMLElement>(".notes-list")!;
    const originalChildren = Array.from(grid.children);
    const editorWrapper = grid.children[1] as HTMLElement;

    expect(editorWrapper.style.gridColumnStart).toBe("2");
    expect(editorWrapper.style.gridColumnEnd).toBe("span 2");
    expect((grid.children[2] as HTMLElement).style.gridColumnStart).toBe("4");
    expect((grid.children[3] as HTMLElement).dataset.shelfIndex).toBe("1");

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="auto-width" packingFrozen>
        <article data-note-id="before" />
        <div data-note-id="editor">
          <article className="note-card--editing" data-shelf-required-width="360" />
        </div>
        <article data-note-id="right-a" />
        <article data-note-id="right-b" />
      </ShelfGrid>,
    );
    await waitFor(() => expect(editorWrapper.style.gridColumnEnd).toBe("span 2"));
    expect(Array.from(grid.children)).toEqual(originalChildren);

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="auto-width" packingFrozen>
        <article data-note-id="before" />
        <div data-note-id="editor">
          <article className="note-card--editing" />
        </div>
        <article data-note-id="right-a" />
        <article data-note-id="right-b" />
      </ShelfGrid>,
    );
    await waitFor(() => expect(editorWrapper.style.gridColumnEnd).toBe("span 2"));

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="auto-width" packingFrozen>
        <article data-note-id="before" />
        <div data-note-id="editor">
          <article className="note-card" />
        </div>
        <article data-note-id="right-a" />
        <article data-note-id="right-b" />
      </ShelfGrid>,
    );
    await waitFor(() => expect(editorWrapper.style.gridColumnEnd).toBe("auto"));
    expect(Array.from(grid.children)).toEqual(originalChildren);
    expect(Array.from(grid.children).map((child) => (child as HTMLElement).style.gridColumnStart)).toEqual(["1", "2", "3", "4"]);
  });

  it("starts a fresh automatic-span session when the editing descendant node is replaced", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const view = render(
      <ShelfGrid className="notes-list" layoutKey="editor-identity" packingFrozen>
        <article />
        <div>
          <article key="first-editor" className="note-card--editing" data-shelf-required-width="720" />
        </div>
        <article />
        <article />
      </ShelfGrid>,
    );
    const grid = view.container.querySelector<HTMLElement>(".notes-list")!;
    const wrapper = grid.children[1] as HTMLElement;
    const firstEditor = wrapper.firstElementChild;
    expect(wrapper.style.gridColumnEnd).toBe("span 2");

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="editor-identity" packingFrozen>
        <article />
        <div>
          <article key="second-editor" className="note-card--editing" />
        </div>
        <article />
        <article />
      </ShelfGrid>,
    );

    await waitFor(() => expect(wrapper.style.gridColumnEnd).toBe("auto"));
    const secondEditor = wrapper.firstElementChild;
    expect(secondEditor).not.toBe(firstEditor);

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="editor-identity" packingFrozen>
        <article />
        <div>
          <article key="second-editor" className="note-card--editing" data-shelf-required-width="360" />
        </div>
        <article />
        <article />
      </ShelfGrid>,
    );

    await waitFor(() => expect(wrapper.style.gridColumnEnd).toBe("auto"));
    expect(wrapper.firstElementChild).toBe(secondEditor);
  });

  it("rebuilds frozen base packing when anonymous direct children reorder without remounting", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1100, height: 300 } as DOMRect;
      return { width: 360, height: Number((this as HTMLElement).dataset.height) } as DOMRect;
    });

    const renderGrid = (order: readonly string[]) => (
      <ShelfGrid className="notes-list" layoutKey="anonymous-order" packingFrozen>
        {order.map((key) => <article key={key} data-height={key === "tall" ? "140" : "40"} />)}
      </ShelfGrid>
    );
    const view = render(renderGrid(["short-a", "short-b", "tall"]));
    const grid = view.container.querySelector<HTMLElement>(".notes-list")!;
    const [shortA, shortB, tall] = Array.from(grid.children) as HTMLElement[];
    expect([shortA.dataset.shelfPosition, shortB.dataset.shelfPosition, tall.dataset.shelfPosition]).toEqual(["top", "bottom", "single"]);

    view.rerender(renderGrid(["tall", "short-a", "short-b"]));

    expect(Array.from(grid.children)).toEqual([tall, shortA, shortB]);
    await waitFor(() => {
      expect([tall.dataset.shelfPosition, shortA.dataset.shelfPosition, shortB.dataset.shelfPosition]).toEqual(["single", "top", "bottom"]);
      expect([tall.style.gridColumnStart, shortA.style.gridColumnStart, shortB.style.gridColumnStart]).toEqual(["1", "2", "2"]);
    });
  });

  it("reads arbitrary positive base spans from direct children", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="base-span-three">
        <article data-note-id="wide" data-shelf-column-span="3" />
        <article data-note-id="trailing" />
      </ShelfGrid>,
    );
    const cards = Array.from(container.querySelector<HTMLElement>(".notes-list")!.children) as HTMLElement[];

    expect(cards.map((card) => [card.style.gridColumnStart, card.style.gridColumnEnd])).toEqual([
      ["1", "span 3"],
      ["4", "auto"],
    ]);
  });

  it("cleans up one editor session while another keeps frozen automatic packing active", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const view = render(
      <ShelfGrid className="notes-list" layoutKey="session-cleanup" packingFrozen>
        <div data-note-id="editor-a"><article className="note-card--editing" data-shelf-required-width="720" /></div>
        <article data-note-id="middle" />
        <div data-note-id="editor-b"><article className="note-card--editing" data-shelf-required-width="720" /></div>
        <article data-note-id="after" />
        <article data-note-id="trailing" />
      </ShelfGrid>,
    );
    const grid = view.container.querySelector<HTMLElement>(".notes-list")!;
    const originalChildren = Array.from(grid.children);
    const editorA = grid.children[0] as HTMLElement;
    const editorB = grid.children[2] as HTMLElement;
    expect(editorA.style.gridColumnEnd).toBe("span 2");
    expect(editorB.style.gridColumnEnd).toBe("auto");

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="session-cleanup" packingFrozen>
        <div data-note-id="editor-a"><article className="note-card" /></div>
        <article data-note-id="middle" />
        <div data-note-id="editor-b"><article className="note-card--editing" data-shelf-required-width="720" /></div>
        <article data-note-id="after" />
        <article data-note-id="trailing" />
      </ShelfGrid>,
    );

    await waitFor(() => expect(editorA.style.gridColumnEnd).toBe("auto"));
    expect(editorA.style.gridColumnStart).toBe("1");
    expect(editorB.style.gridColumnStart).toBe("3");
    expect(editorB.style.gridColumnEnd).toBe("span 2");
    expect(Array.from(grid.children)).toEqual(originalChildren);
  });

  it("marks residual current-table overflow after keeping an oversized editor anchored in the last column", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const view = render(
      <ShelfGrid className="notes-list" layoutKey="right-edge" packingFrozen>
        <article data-note-id="first" />
        <article data-note-id="second" />
        <article data-note-id="third" />
        <article className="note-card--editing" data-note-id="editor" data-shelf-current-table-width="2000" data-shelf-required-width="2000" />
      </ShelfGrid>,
    );
    const editor = view.container.querySelector<HTMLElement>('[data-note-id="editor"]')!;

    expect(editor.style.gridColumnStart).toBe("4");
    expect(editor.style.gridColumnEnd).toBe("auto");
    expect(editor).toHaveAttribute("data-shelf-table-overflow", "true");

    view.rerender(
      <ShelfGrid className="notes-list" layoutKey="right-edge" packingFrozen>
        <article data-note-id="first" />
        <article data-note-id="second" />
        <article data-note-id="third" />
        <article className="note-card--editing" data-note-id="editor" data-shelf-current-table-width="360" data-shelf-required-width="2000" />
      </ShelfGrid>,
    );

    await waitFor(() => expect(editor).not.toHaveAttribute("data-shelf-table-overflow"));
    expect(editor.style.gridColumnStart).toBe("4");
    expect(editor.style.gridColumnEnd).toBe("auto");
  });

  it("does not mark a current table that fits an expanded card's final placement", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="fitting-expanded-editor" packingFrozen>
        <article className="note-card--editing" data-note-id="editor" data-shelf-current-table-width="720" data-shelf-required-width="720" />
      </ShelfGrid>,
    );
    const editor = container.querySelector<HTMLElement>('[data-note-id="editor"]')!;

    expect(editor.style.gridColumnEnd).toBe("span 2");
    expect(editor).not.toHaveAttribute("data-shelf-table-overflow");
  });

  it("clears stale overflow output when a card is no longer being edited", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="stale-overflow-output" packingFrozen>
        <article className="note-card" data-note-id="former-editor" data-shelf-table-overflow="true" />
      </ShelfGrid>,
    );

    expect(container.querySelector<HTMLElement>("[data-note-id='former-editor']"))
      .not.toHaveAttribute("data-shelf-table-overflow");
  });

  it("restores retained editor growth after a four-to-two-to-four responsive cycle", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    let gridWidth = 1464;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: gridWidth, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="responsive-editor" packingFrozen>
        <div data-note-id="editor">
          <article className="note-card--editing" data-shelf-required-width="1090" />
        </div>
        <article data-note-id="second" />
        <article data-note-id="third" />
        <article data-note-id="fourth" />
      </ShelfGrid>,
    );
    const grid = container.querySelector<HTMLElement>(".notes-list")!;
    const editor = grid.children[0] as HTMLElement;
    const originalChildren = Array.from(grid.children);
    expect(editor.style.gridColumnEnd).toBe("span 3");

    gridWidth = 728;
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(editor.style.gridColumnEnd).toBe("span 2"));

    gridWidth = 1464;
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(editor.style.gridColumnEnd).toBe("span 3"));
    expect(Array.from(grid.children)).toEqual(originalChildren);
  });

  it("applies simultaneous editor demands in direct-child order without rectangle overlap", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("notes-list")) return { width: 1464, height: 300 } as DOMRect;
      return { width: 360, height: 100 } as DOMRect;
    });

    const { container } = render(
      <ShelfGrid className="notes-list" layoutKey="two-editors" packingFrozen>
        <article data-note-id="before" />
        <div data-note-id="editor-a"><article className="note-card--editing" data-shelf-required-width="720" /></div>
        <article data-note-id="middle" />
        <div data-note-id="editor-b"><article className="note-card--editing" data-shelf-required-width="720" /></div>
        <article data-note-id="after" />
      </ShelfGrid>,
    );
    const cards = Array.from(container.querySelector<HTMLElement>(".notes-list")!.children) as HTMLElement[];

    expect(cards[1].style.gridColumnStart).toBe("2");
    expect(cards[1].style.gridColumnEnd).toBe("span 2");
    expect(cards[3].dataset.shelfIndex).toBe("1");
    expect(cards[3].style.gridColumnStart).toBe("1");
    expect(cards[3].style.gridColumnEnd).toBe("span 2");
    expect(cards[4].dataset.shelfIndex).toBe("1");
    expect(cards[4].style.gridColumnStart).toBe("3");

    const domLayout: ShelfLayout = {
      height: 0,
      placements: cards.map((card, index) => ({
        index,
        shelf: Number(card.dataset.shelfIndex),
        column: Number(card.style.gridColumnStart) - 1,
        columnSpan: card.style.gridColumnEnd.startsWith("span ") ? Number(card.style.gridColumnEnd.slice(5)) : 1,
        top: Number(card.style.gridRowStart) - 1,
        height: Number(card.style.gridRowEnd.slice(5)),
        shelfHeight: 0,
        stackPosition: "single",
      })),
    };
    expectNoPlacementOverlaps(domLayout);
  });
});
