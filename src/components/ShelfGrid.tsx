import { useLayoutEffect, useRef, type ReactNode } from "react";

const DEFAULT_COLUMN_WIDTH = 360;
const DEFAULT_COLUMN_GAP = 8;
const DEFAULT_ROW_GAP = 12;
const DEFAULT_STACK_GAP = 6;

export type ShelfStackPosition = "single" | "top" | "bottom";

export interface ShelfPlacement {
  index: number;
  shelf: number;
  column: number;
  top: number;
  height: number;
  shelfHeight: number;
  stackPosition: ShelfStackPosition;
}

export interface ShelfLayout {
  placements: ShelfPlacement[];
  height: number;
}

export interface ShelfLayoutOptions {
  rowGap?: number;
  stackGap?: number;
}

type ShelfSlot = number[];
type ShelfComposition = ShelfSlot[][];

function safePixels(value: number, fallback: number, minimum = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.ceil(value));
}

function cssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function placementComposition(placements: readonly ShelfPlacement[]): ShelfComposition {
  const composition: ShelfComposition = [];
  for (const placement of placements) {
    const shelf = composition[placement.shelf] ?? [];
    const slot = shelf[placement.column] ?? [];
    slot.push(placement.index);
    shelf[placement.column] = slot;
    composition[placement.shelf] = shelf;
  }
  return composition;
}

function layoutComposition(
  heights: readonly number[],
  composition: ShelfComposition,
  rowGap: number,
  stackGap: number,
): ShelfLayout {
  const placements: ShelfPlacement[] = [];
  let shelfTop = 0;

  composition.forEach((slots, shelf) => {
    const shelfHeight = Math.max(1, ...slots.map((slot) => slot.reduce((total, index) => total + heights[index], 0) + stackGap * Math.max(0, slot.length - 1)));
    slots.forEach((slot, column) => {
      if (slot.length === 1) {
        placements.push({ index: slot[0], shelf, column, top: shelfTop, height: shelfHeight, shelfHeight, stackPosition: "single" });
        return;
      }

      const topNaturalHeight = heights[slot[0]];
      const bottomNaturalHeight = heights[slot[1]];
      const extra = Math.max(0, shelfHeight - topNaturalHeight - bottomNaturalHeight - stackGap);
      const naturalTotal = topNaturalHeight + bottomNaturalHeight;
      const topExtra = naturalTotal > 0 ? Math.floor(extra * topNaturalHeight / naturalTotal) : Math.floor(extra / 2);
      const topHeight = topNaturalHeight + topExtra;
      const bottomHeight = shelfHeight - stackGap - topHeight;
      placements.push({ index: slot[0], shelf, column, top: shelfTop, height: topHeight, shelfHeight, stackPosition: "top" });
      placements.push({ index: slot[1], shelf, column, top: shelfTop + topHeight + stackGap, height: bottomHeight, shelfHeight, stackPosition: "bottom" });
    });
    shelfTop += shelfHeight + rowGap;
  });

  return { placements: placements.sort((left, right) => left.index - right.index), height: Math.max(0, shelfTop - (composition.length ? rowGap : 0)) };
}

export function buildShelfLayout(
  naturalHeights: readonly number[],
  columnCount: number,
  options: ShelfLayoutOptions = {},
): ShelfLayout {
  const heights = naturalHeights.map((height) => safePixels(height, 1, 1));
  const columns = Math.max(1, Math.floor(Number.isFinite(columnCount) ? columnCount : 1));
  const rowGap = safePixels(options.rowGap ?? DEFAULT_ROW_GAP, DEFAULT_ROW_GAP);
  const stackGap = safePixels(options.stackGap ?? DEFAULT_STACK_GAP, DEFAULT_STACK_GAP);
  const composition: ShelfComposition = [];
  let start = 0;

  while (start < heights.length) {
    const baselineEnd = Math.min(heights.length, start + columns);
    let shelfHeight = Math.max(...heights.slice(start, baselineEnd));
    let slots: ShelfSlot[] = [];

    while (true) {
      slots = [];
      let index = start;
      while (slots.length < columns && index < heights.length) {
        const canStack = columns > 1
          && index + 1 < heights.length
          && heights[index] + stackGap + heights[index + 1] <= shelfHeight;
        if (canStack) {
          slots.push([index, index + 1]);
          index += 2;
        } else {
          slots.push([index]);
          index += 1;
        }
      }

      const nextShelfHeight = Math.max(...slots.map((slot) => slot.reduce((total, itemIndex) => total + heights[itemIndex], 0) + stackGap * Math.max(0, slot.length - 1)));
      if (nextShelfHeight <= shelfHeight) break;
      shelfHeight = nextShelfHeight;
    }

    composition.push(slots);
    start = slots.flat().at(-1)! + 1;
  }

  return layoutComposition(heights, composition, rowGap, stackGap);
}

function resetCardLayout(card: HTMLElement): void {
  card.style.gridColumnStart = "auto";
  card.style.gridRowStart = "auto";
  card.style.gridRowEnd = "auto";
  card.removeAttribute("data-shelf-position");
  card.removeAttribute("data-shelf-index");
}

function measureNaturalHeights(grid: HTMLElement, cards: readonly HTMLElement[]): number[] {
  const gridAlignItems = grid.style.alignItems;
  const restoredStyles: Array<{ element: HTMLElement; alignSelf: string; height: string }> = [];
  const measurementElements = new Set<HTMLElement>();

  grid.style.alignItems = "start";
  for (const card of cards) {
    measurementElements.add(card);
    const noteCard = card.matches(".note-card") ? card : card.querySelector<HTMLElement>(".note-card");
    if (noteCard) measurementElements.add(noteCard);
    const surface = noteCard?.querySelector<HTMLElement>(".note-card__surface");
    if (surface) measurementElements.add(surface);
  }

  for (const element of measurementElements) {
    restoredStyles.push({ element, alignSelf: element.style.alignSelf, height: element.style.height });
    element.style.height = "auto";
    if (cards.includes(element)) element.style.alignSelf = "start";
  }

  try {
    return cards.map((card) => safePixels(card.getBoundingClientRect().height, 1, 1));
  } finally {
    grid.style.alignItems = gridAlignItems;
    for (const { element, alignSelf, height } of restoredStyles) {
      element.style.alignSelf = alignSelf;
      element.style.height = height;
    }
  }
}

function cardOrder(cards: readonly HTMLElement[]): string {
  return cards.map((card, index) => card.dataset.noteId ?? `index:${index}`).join("\u0000");
}

export function ShelfGrid({
  children,
  className,
  layoutKey,
  packingFrozen = false,
}: {
  children: ReactNode;
  className: string;
  layoutKey?: string;
  packingFrozen?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const compositionRef = useRef<ShelfComposition | null>(null);
  const columnCountRef = useRef(0);
  const orderRef = useRef("");
  const pendingRepackRef = useRef(true);
  const frozenRef = useRef(packingFrozen);
  const layoutDependency = layoutKey ?? children;
  frozenRef.current = packingFrozen;

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    let layingOut = false;

    const layout = (requestRepack: boolean) => {
      frame = 0;
      if (layingOut) return;
      layingOut = true;
      const cards = Array.from(grid.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      const nextOrder = cardOrder(cards);
      const previousOrder = orderRef.current;

      grid.setAttribute("data-shelf-measuring", "true");
      grid.style.gridAutoRows = "auto";
      grid.style.rowGap = `${DEFAULT_ROW_GAP}px`;
      cards.forEach(resetCardLayout);

      const styles = window.getComputedStyle(grid);
      const columnGap = cssPixels(styles.columnGap, DEFAULT_COLUMN_GAP);
      const minimumColumnWidth = cssPixels(styles.getPropertyValue("--note-column-min"), DEFAULT_COLUMN_WIDTH);
      const gridWidth = grid.getBoundingClientRect().width || grid.clientWidth || minimumColumnWidth;
      const columnCount = Math.max(1, Math.floor((gridWidth + columnGap) / (minimumColumnWidth + columnGap)));
      const heights = measureNaturalHeights(grid, cards);
      const compositionSize = compositionRef.current?.flat(2).length ?? 0;
      const structureChanged = previousOrder !== nextOrder || compositionSize !== cards.length;
      const shouldRepack = requestRepack || pendingRepackRef.current || !compositionRef.current || columnCountRef.current !== columnCount || structureChanged;
      const compositionUsable = Boolean(compositionRef.current && compositionSize === cards.length);
      const repackNow = !compositionUsable || shouldRepack && !frozenRef.current;
      let shelfLayout: ShelfLayout;

      if (repackNow) {
        shelfLayout = buildShelfLayout(heights, columnCount);
        compositionRef.current = placementComposition(shelfLayout.placements);
        pendingRepackRef.current = false;
        columnCountRef.current = columnCount;
      } else {
        if (shouldRepack) pendingRepackRef.current = true;
        shelfLayout = layoutComposition(heights, compositionRef.current!, DEFAULT_ROW_GAP, DEFAULT_STACK_GAP);
      }

      orderRef.current = nextOrder;
      grid.style.gridAutoRows = "1px";
      grid.style.rowGap = "0px";
      grid.removeAttribute("data-shelf-measuring");
      shelfLayout.placements.forEach((placement) => {
        const card = cards[placement.index];
        if (!card) return;
        card.style.gridColumnStart = String(placement.column + 1);
        card.style.gridRowStart = String(placement.top + 1);
        card.style.gridRowEnd = `span ${placement.height}`;
        card.dataset.shelfPosition = placement.stackPosition;
        card.dataset.shelfIndex = String(placement.shelf);
      });
      layingOut = false;
    };

    const scheduleLayout = (requestRepack = false) => {
      if (requestRepack) pendingRepackRef.current = true;
      if (!frame) frame = window.requestAnimationFrame(() => layout(requestRepack));
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleLayout(false));
    observer?.observe(grid);
    for (const card of grid.children) observer?.observe(card);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => scheduleLayout(false));
    mutationObserver?.observe(grid, { attributeFilter: ["aria-expanded", "class"], attributes: true, characterData: true, childList: true, subtree: true });
    const handleResize = () => scheduleLayout(true);
    window.addEventListener("resize", handleResize);
    layout(true);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [layoutDependency, packingFrozen]);

  return <div className={className} ref={gridRef}>{children}</div>;
}
