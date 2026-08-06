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
  columnSpan: number;
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
  columnSpans?: readonly number[];
}

export interface ShelfExpansion {
  index: number;
  requestedSpan: number;
}

interface ShelfSlot {
  column: number;
  columnSpan: number;
  indexes: number[];
  topOffset?: number;
}
type ShelfComposition = ShelfSlot[][];

interface ShelfTailItem {
  index: number;
  columnSpan: number;
}

function safePixels(value: number, fallback: number, minimum = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.ceil(value));
}

function cssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeColumnSpan(value: number | undefined, columns: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(columns, Math.max(1, Math.floor(value!)));
}

export function shelfColumnSpanForWidth(
  requiredWidth: number,
  gridWidth: number,
  columnCount: number,
  columnGap: number,
): number {
  const columns = Math.max(1, Math.floor(Number.isFinite(columnCount) ? columnCount : 1));
  const gap = safePixels(columnGap, DEFAULT_COLUMN_GAP);
  const width = Math.max(0, Number.isFinite(gridWidth) ? gridWidth : 0);
  const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
  const demand = requiredWidth === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(requiredWidth) ? Math.max(0, requiredWidth) : 0;
  for (let span = 1; span <= columns; span += 1) {
    if (columnWidth * span + gap * (span - 1) >= demand) return span;
  }
  return columns;
}

function placementShelfTops(placements: readonly ShelfPlacement[], rowGap: number): Map<number, number> {
  const shelfTops = new Map<number, number>();
  const highestShelf = Math.max(-1, ...placements.map((placement) => placement.shelf));
  let shelfTop = 0;
  for (let shelf = 0; shelf <= highestShelf; shelf += 1) {
    shelfTops.set(shelf, shelfTop);
    const shelfHeight = placements.find((placement) => placement.shelf === shelf)?.shelfHeight ?? 0;
    shelfTop += shelfHeight + rowGap;
  }
  return shelfTops;
}

function placementComposition(
  placements: readonly ShelfPlacement[],
  rowGap = DEFAULT_ROW_GAP,
): ShelfComposition {
  const composition: ShelfComposition = [];
  const shelfTops = placementShelfTops(placements, rowGap);
  for (const placement of placements) {
    const shelf = composition[placement.shelf] ?? [];
    let slot = shelf.find((candidate) => candidate.column === placement.column);
    if (!slot) {
      slot = { column: placement.column, columnSpan: placement.columnSpan, indexes: [] };
      shelf.push(slot);
      shelf.sort((left, right) => left.column - right.column);
    }
    slot.indexes.push(placement.index);
    composition[placement.shelf] = shelf;
  }
  composition.forEach((shelf, shelfIndex) => {
    for (const slot of shelf) {
      if (slot.indexes.length !== 1) continue;
      const placement = placements.find((candidate) => candidate.index === slot.indexes[0]);
      const topOffset = placement ? placement.top - (shelfTops.get(shelfIndex) ?? placement.top) : 0;
      if (topOffset > 0) slot.topOffset = topOffset;
    }
  });
  return composition;
}

function compositionSize(composition: ShelfComposition | null): number {
  return composition?.reduce((total, shelf) => total + shelf.reduce((shelfTotal, slot) => shelfTotal + slot.indexes.length, 0), 0) ?? 0;
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
    const slotNaturalHeight = (slot: ShelfSlot) => (
      slot.indexes.reduce((total, index) => total + heights[index], 0)
      + stackGap * Math.max(0, slot.indexes.length - 1)
    );
    const shelfHeight = Math.max(
      1,
      ...slots.map((slot) => (slot.topOffset ?? 0) + slotNaturalHeight(slot)),
    );
    slots.forEach((slot) => {
      if (slot.indexes.length === 1) {
        const topOffset = slot.topOffset ?? 0;
        placements.push({ index: slot.indexes[0], shelf, column: slot.column, columnSpan: slot.columnSpan, top: shelfTop + topOffset, height: shelfHeight - topOffset, shelfHeight, stackPosition: "single" });
        return;
      }

      const topNaturalHeight = heights[slot.indexes[0]];
      const bottomNaturalHeight = heights[slot.indexes[1]];
      const extra = Math.max(0, shelfHeight - topNaturalHeight - bottomNaturalHeight - stackGap);
      const naturalTotal = topNaturalHeight + bottomNaturalHeight;
      const topExtra = naturalTotal > 0 ? Math.floor(extra * topNaturalHeight / naturalTotal) : Math.floor(extra / 2);
      const topHeight = topNaturalHeight + topExtra;
      const bottomHeight = shelfHeight - stackGap - topHeight;
      placements.push({ index: slot.indexes[0], shelf, column: slot.column, columnSpan: slot.columnSpan, top: shelfTop, height: topHeight, shelfHeight, stackPosition: "top" });
      placements.push({ index: slot.indexes[1], shelf, column: slot.column, columnSpan: slot.columnSpan, top: shelfTop + topHeight + stackGap, height: bottomHeight, shelfHeight, stackPosition: "bottom" });
    });
    shelfTop += shelfHeight + rowGap;
  });

  return { placements: placements.sort((left, right) => left.index - right.index), height: Math.max(0, shelfTop - (composition.length ? rowGap : 0)) };
}

function packShelfItems(
  items: readonly ShelfTailItem[],
  heights: readonly number[],
  capacity: number,
  stackGap: number,
  columnOffset = 0,
  minimumShelfHeight = 0,
  totalColumns = capacity,
): { slots: ShelfSlot[]; consumed: number } {
  if (items.length === 0 || capacity < 1) return { slots: [], consumed: 0 };

  let baselineEnd = 0;
  let baselineColumns = 0;
  while (baselineEnd < items.length && baselineColumns + items[baselineEnd].columnSpan <= capacity) {
    baselineColumns += items[baselineEnd].columnSpan;
    baselineEnd += 1;
  }
  if (baselineEnd === 0) return { slots: [], consumed: 0 };

  let shelfHeight = Math.max(minimumShelfHeight, ...items.slice(0, baselineEnd).map((item) => heights[item.index]));
  let slots: ShelfSlot[] = [];
  let consumed = 0;
  while (true) {
    slots = [];
    let itemOffset = 0;
    let column = 0;
    while (column < capacity && itemOffset < items.length) {
      const item = items[itemOffset];
      if (column + item.columnSpan > capacity) break;
      const nextItem = items[itemOffset + 1];
      const canStack = item.columnSpan === 1
        && totalColumns > 1
        && nextItem !== undefined
        && nextItem.columnSpan === 1
        && heights[item.index] + stackGap + heights[nextItem.index] <= shelfHeight;
      if (canStack) {
        slots.push({ column: columnOffset + column, columnSpan: 1, indexes: [item.index, nextItem.index] });
        itemOffset += 2;
      } else {
        slots.push({ column: columnOffset + column, columnSpan: item.columnSpan, indexes: [item.index] });
        itemOffset += 1;
      }
      column += item.columnSpan;
    }

    consumed = itemOffset;
    const nextShelfHeight = Math.max(
      minimumShelfHeight,
      ...slots.map((slot) => slot.indexes.reduce((total, index) => total + heights[index], 0) + stackGap * Math.max(0, slot.indexes.length - 1)),
    );
    if (nextShelfHeight <= shelfHeight) break;
    shelfHeight = nextShelfHeight;
  }
  return { slots, consumed };
}

function appendTailToComposition(
  composition: ShelfComposition,
  tail: readonly ShelfTailItem[],
  heights: readonly number[],
  columns: number,
  stackGap: number,
): void {
  const remaining = [...tail].sort((left, right) => left.index - right.index);
  const lastShelf = composition.at(-1);
  if (lastShelf && remaining.length > 0) {
    const occupiedUntil = Math.max(0, ...lastShelf.map((slot) => slot.column + slot.columnSpan));
    const freeColumns = columns - occupiedUntil;
    const minimumShelfHeight = Math.max(
      1,
      ...lastShelf.map((slot) => (slot.topOffset ?? 0)
        + slot.indexes.reduce((total, index) => total + heights[index], 0)
        + stackGap * Math.max(0, slot.indexes.length - 1)),
    );
    const packed = packShelfItems(remaining, heights, freeColumns, stackGap, occupiedUntil, minimumShelfHeight, columns);
    lastShelf.push(...packed.slots);
    remaining.splice(0, packed.consumed);
  }

  while (remaining.length > 0) {
    const packed = packShelfItems(remaining, heights, columns, stackGap);
    if (packed.consumed === 0) break;
    composition.push(packed.slots);
    remaining.splice(0, packed.consumed);
  }
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
  const columnSpans = heights.map((_, index) => normalizeColumnSpan(options.columnSpans?.[index], columns));
  const composition: ShelfComposition = [];
  let start = 0;

  while (start < heights.length) {
    const items = heights.slice(start).map((_, offset) => ({ index: start + offset, columnSpan: columnSpans[start + offset] }));
    const packed = packShelfItems(items, heights, columns, stackGap);
    composition.push(packed.slots);
    start += packed.consumed;
  }

  return layoutComposition(heights, composition, rowGap, stackGap);
}

export function expandShelfLayout(
  naturalHeights: readonly number[],
  columnCount: number,
  previousLayout: ShelfLayout,
  options: ShelfLayoutOptions & { expansion: ShelfExpansion },
): ShelfLayout {
  const columns = Math.max(1, Math.floor(Number.isFinite(columnCount) ? columnCount : 1));
  const anchor = previousLayout.placements[options.expansion.index];
  if (!anchor) return buildShelfLayout(naturalHeights, columns, options);

  const requestedSpan = normalizeColumnSpan(options.expansion.requestedSpan, columns);
  const anchoredSpan = Math.max(
    anchor.columnSpan,
    Math.min(requestedSpan, columns - anchor.column),
  );
  if (anchoredSpan === anchor.columnSpan) return previousLayout;

  const rowGap = safePixels(options.rowGap ?? DEFAULT_ROW_GAP, DEFAULT_ROW_GAP);
  const previousComposition = placementComposition(previousLayout.placements, rowGap);
  const anchorShelfTop = placementShelfTops(previousLayout.placements, rowGap).get(anchor.shelf) ?? anchor.top;
  const fixedComposition = previousComposition
    .slice(0, anchor.shelf)
    .map((shelf) => shelf.map((slot) => ({ ...slot, indexes: [...slot.indexes] })));
  const anchorShelf = previousComposition[anchor.shelf] ?? [];
  const fixedAnchorShelf = anchorShelf
    .filter((slot) => slot.column + slot.columnSpan <= anchor.column)
    .map((slot) => ({ ...slot, indexes: [...slot.indexes] }));
  fixedAnchorShelf.push({
    column: anchor.column,
    columnSpan: anchoredSpan,
    indexes: [anchor.index],
    topOffset: anchor.top - anchorShelfTop,
  });
  fixedAnchorShelf.sort((left, right) => left.column - right.column);
  fixedComposition.push(fixedAnchorShelf);

  const fixedIndexes = new Set(
    fixedComposition.flatMap((shelf) => shelf.flatMap((slot) => slot.indexes)),
  );
  const normalizedSpans = naturalHeights.map((_, index) => (
    normalizeColumnSpan(options.columnSpans?.[index], columns)
  ));
  const tail = naturalHeights
    .map((_, index) => ({ index, columnSpan: normalizedSpans[index] }))
    .filter(({ index }) => !fixedIndexes.has(index));
  const heights = naturalHeights.map((height) => safePixels(height, 1, 1));
  const stackGap = safePixels(options.stackGap ?? DEFAULT_STACK_GAP, DEFAULT_STACK_GAP);
  appendTailToComposition(fixedComposition, tail, heights, columns, stackGap);

  return layoutComposition(
    heights,
    fixedComposition,
    rowGap,
    stackGap,
  );
}

function resetCardLayout(card: HTMLElement): void {
  card.style.gridColumnStart = "auto";
  card.style.gridColumnEnd = "auto";
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

function cardBaseColumnSpan(card: HTMLElement): number {
  const value = Number(card.dataset.shelfColumnSpan);
  return Number.isInteger(value) && value > 0 ? value : 1;
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
  const cardsRef = useRef<HTMLElement[]>([]);
  const columnSpanSignatureRef = useRef("");
  const automaticSpansRef = useRef(new WeakMap<HTMLElement, { editor: HTMLElement; span: number }>());
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
      const previousCards = cardsRef.current;
      const columnSpans = cards.map(cardBaseColumnSpan);
      const columnSpanSignature = columnSpans.join(",");
      const spanChanged = columnSpanSignatureRef.current !== columnSpanSignature;

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
      const packedCardCount = compositionSize(compositionRef.current);
      const childOrderChanged = previousCards.length !== cards.length
        || cards.some((card, index) => card !== previousCards[index]);
      const structureChanged = childOrderChanged || packedCardCount !== cards.length;
      const columnCountChanged = columnCountRef.current !== columnCount;
      const shouldRepack = requestRepack || pendingRepackRef.current || !compositionRef.current || columnCountChanged || structureChanged;
      const compositionUsable = Boolean(compositionRef.current && packedCardCount === cards.length);
      const repackNow = !compositionUsable
        || spanChanged
        || structureChanged
        || columnCountChanged
        || shouldRepack && !frozenRef.current;
      let baseLayout: ShelfLayout;

      if (repackNow) {
        baseLayout = buildShelfLayout(heights, columnCount, { columnSpans });
        compositionRef.current = placementComposition(baseLayout.placements);
        pendingRepackRef.current = false;
        columnCountRef.current = columnCount;
      } else {
        if (shouldRepack) pendingRepackRef.current = true;
        baseLayout = layoutComposition(heights, compositionRef.current!, DEFAULT_ROW_GAP, DEFAULT_STACK_GAP);
      }

      const activeExpansions: ShelfExpansion[] = [];
      cards.forEach((card, index) => {
        const editingCard = card.matches(".note-card--editing")
          ? card
          : card.querySelector<HTMLElement>(".note-card--editing");
        if (!editingCard) {
          automaticSpansRef.current.delete(card);
          return;
        }

        let automaticSession = automaticSpansRef.current.get(card);
        if (automaticSession?.editor !== editingCard) {
          automaticSession = { editor: editingCard, span: 1 };
          automaticSpansRef.current.set(card, automaticSession);
        }

        const requiredWidthValue = card.dataset.shelfRequiredWidth
          ?? editingCard.dataset.shelfRequiredWidth;
        const requiredWidth = requiredWidthValue === undefined ? Number.NaN : Number(requiredWidthValue);
        if (requiredWidth > 0) {
          const demandedSpan = shelfColumnSpanForWidth(requiredWidth, gridWidth, columnCount, columnGap);
          automaticSession = {
            editor: editingCard,
            span: Math.max(automaticSession.span, demandedSpan),
          };
          automaticSpansRef.current.set(card, automaticSession);
        }
        if (automaticSession.span > normalizeColumnSpan(columnSpans[index], columnCount)) {
          activeExpansions.push({ index, requestedSpan: automaticSession.span });
        }
      });

      let shelfLayout = baseLayout;
      for (const expansion of activeExpansions) {
        shelfLayout = expandShelfLayout(heights, columnCount, shelfLayout, { columnSpans, expansion });
      }

      cardsRef.current = cards;
      columnSpanSignatureRef.current = columnSpanSignature;
      grid.style.gridAutoRows = "1px";
      grid.style.rowGap = "0px";
      grid.removeAttribute("data-shelf-measuring");
      shelfLayout.placements.forEach((placement) => {
        const card = cards[placement.index];
        if (!card) return;
        card.style.gridColumnStart = String(placement.column + 1);
        card.style.gridColumnEnd = placement.columnSpan > 1 ? `span ${placement.columnSpan}` : "auto";
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
    mutationObserver?.observe(grid, { attributeFilter: ["aria-expanded", "class", "data-shelf-column-span", "data-shelf-required-width"], attributes: true, characterData: true, childList: true, subtree: true });
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
