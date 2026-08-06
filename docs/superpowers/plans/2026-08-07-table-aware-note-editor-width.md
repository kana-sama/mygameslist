# Table-aware Note Editor Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically widen an editing note to fit valid Markdown table source lines when shelf columns are available to its right, while keeping the editor anchored and falling back to Monaco wrapping at the right boundary.

**Architecture:** Extract the existing table parser into a shared pure structure module, then add an editor-local observer that measures full table source lines independently of rendered wrapping. The editing card publishes a monotonic pixel demand through `data-shelf-required-width`; `ShelfGrid` converts that demand into a monotonic integer span and applies each growth request against the card's current placement, preserving its left anchor while repacking displaced cards.

**Tech Stack:** React 19, TypeScript 7, Monaco Editor 0.56, CSS Grid, Vitest 4, Testing Library, JSDOM, Jujutsu.

## Global Constraints

- Keep Monaco `wordWrap: "on"`; do not add selective wrapping, horizontal scrolling, or Monaco internal patches.
- Measure only valid supported Markdown tables and share the exact parser used by table formatting.
- Automatic width is editing-session-only and must never mutate the persisted `doubleWidth` field.
- An editing card grows only to the right from its current shelf and column; it is never moved merely to gain space.
- Once reached, automatic pixel demand and automatic span never decrease while that editor DOM node remains mounted.
- If the right boundary prevents further growth, leave the card in place and let Monaco wrap the table.
- Preserve editor DOM identity, focus, selection, undo history, IME state, and scroll state.
- Preserve ordinary read-mode layout, manual width controls, drag behavior, attachments, save, and cancel behavior.
- Add no dependencies.
- Use Jujutsu (`jj`) exclusively for repository inspection and finalization; never invoke `git`.
- This feature, including its specification, plan, tests, and implementation, ends as exactly one commit. Do not create per-task commits.
- Execute every implementation task through a fresh subagent and complete its review gate before dispatching the next task.

---

## File Structure

### New files

- `src/components/markdownTableStructure.ts` — pure parsing and discovery of valid ordinary/grouped Markdown table blocks.
- `src/components/monacoMarkdownTableWidth.ts` — pure required-width calculation plus lifecycle-managed Monaco table-width observer.
- `tests/markdown-table-structure.test.ts` — parser/discovery coverage independent of formatting output.
- `tests/monaco-markdown-table-width.test.ts` — source measurement, scheduling, deduplication, and disposal coverage.
- `tests/note-editor-auto-width.test.tsx` — note-card integration coverage with a controllable Monaco note-editor mock.
- `docs/superpowers/specs/2026-08-07-table-aware-note-editor-width-design.md` — approved design already present in the working copy.
- `docs/superpowers/plans/2026-08-07-table-aware-note-editor-width.md` — this plan.

### Modified files

- `src/components/markdownTableFormatting.ts` — consume shared parsed table structure instead of owning a private parser.
- `src/components/MonacoNoteEditor.tsx` — install the width observer after table typing and expose its reports through a live optional callback.
- `src/components/ShelfGrid.tsx` — support arbitrary base spans, monotonic pixel-derived spans, and anchored expansion.
- `src/pages/GamePage.tsx` — retain the session maximum table width and publish it on the editing article.
- `tests/monaco-note-editor.test.tsx` — verify width-observer installation order, live callback routing, and cleanup.
- `tests/shelf-grid.test.tsx` — arbitrary spans, width conversion, anchored displacement, edge clamping, monotonicity, descendants, and resize behavior.

---

### Task 1: Extract shared Markdown table structure discovery

**Files:**
- Create: `src/components/markdownTableStructure.ts`
- Create: `tests/markdown-table-structure.test.ts`
- Modify: `src/components/markdownTableFormatting.ts`
- Verify: `tests/markdown-table-formatting.test.ts`
- Verify: `tests/monaco-markdown-table-formatting.test.ts`

**Interfaces:**
- Consumes: `scanMarkdownTableLine(line: string): MarkdownTableLineSyntax | null` from `src/components/markdownTableSyntax.ts`.
- Consumes: the existing pure `isInsideFencedMarkdownCode(value, position)` from `src/components/markdownListEditing.ts`, so discovery inherits the application's fenced-code rules rather than inventing a second fence grammar.
- Produces:

```ts
export type ParsedMarkdownTableLine =
  | { kind: "ordinary" | "delimiter"; lineIndex: number; syntax: MarkdownTableLineSyntax }
  | { kind: "title"; lineIndex: number; syntax: MarkdownTableLineSyntax };

export interface ParsedMarkdownTableBlock {
  columnCount: number;
  delimiterCells: readonly MarkdownTableSyntaxCell[];
  framed: boolean;
  lines: readonly ParsedMarkdownTableLine[];
  prefix: string;
}

export interface MarkdownTableSourceLine {
  lineIndex: number;
  text: string;
}

export function parseMarkdownTableAtLine(
  lines: readonly string[],
  triggerLine: number,
): ParsedMarkdownTableBlock | null;

export function findMarkdownTableSourceLines(
  lines: readonly string[],
): MarkdownTableSourceLine[];
```

- `formatMarkdownTableAtLine` must consume `parseMarkdownTableAtLine`; it must not retain a second table-block grammar.

- [ ] **Step 1: Write discovery tests for valid ordinary and grouped tables**

Create `tests/markdown-table-structure.test.ts` with concrete source-line expectations:

```ts
import { describe, expect, it } from "vitest";
import {
  findMarkdownTableSourceLines,
  parseMarkdownTableAtLine,
} from "../src/components/markdownTableStructure";

describe("Markdown table structure", () => {
  it("returns every source line in ordinary and grouped tables", () => {
    const lines = [
      "Intro | prose",
      "",
      "| Name | Done |",
      "| --- | --- |",
      "| First group |",
      "| --- | --- |",
      "| Start | [ ] |",
      "",
      "```md",
      "| Fake | Table |",
      "| --- | --- |",
      "```",
    ];

    expect(findMarkdownTableSourceLines(lines)).toEqual(
      [2, 3, 4, 5, 6].map((lineIndex) => ({
        lineIndex,
        text: lines[lineIndex],
      })),
    );
  });

  it("parses the same block from its header, delimiter, or body", () => {
    const lines = ["| A | B |", "| --- | --- |", "| x | y |"]; 
    expect([0, 1, 2].map((line) => parseMarkdownTableAtLine(lines, line)?.lines.map((item) => item.lineIndex)))
      .toEqual([[0, 1, 2], [0, 1, 2], [0, 1, 2]]);
  });
});
```

- [ ] **Step 2: Write rejection tests for code fences and incomplete pipe input**

Add exact negative fixtures:

```ts
it.each([
  [["text | value"]],
  [["| header | only |"]],
  [["```", "| A | B |", "| --- | --- |", "```"]],
])("ignores non-table fixture %j", (lines) => {
  expect(findMarkdownTableSourceLines(lines)).toEqual([]);
});
```

- [ ] **Step 3: Run the new tests to verify the module is missing**

Run:

```bash
npm test -- tests/markdown-table-structure.test.ts
```

Expected: FAIL because `../src/components/markdownTableStructure` does not exist.

- [ ] **Step 4: Move the parser types and structural helpers into the pure module**

Move the existing `OrdinaryRow`, `GroupTitle`, `TableLine`, `isTableBoundary`, `isDelimiter`, `hasMatchingFrame`, `normalizeOrdinarySyntax`, `isGroupTitle`, and table-block parsing loop out of `markdownTableFormatting.ts`. Build the public parser around that exact logic:

```ts
export function parseMarkdownTableAtLine(
  lines: readonly string[],
  triggerLine: number,
): ParsedMarkdownTableBlock | null {
  const bounds = tableBlockAt(lines, triggerLine);
  if (!bounds) return null;

  const source = lines.join("\n");
  const triggerOffset = lines
    .slice(0, triggerLine)
    .reduce((offset, line) => offset + line.length + 1, 0);
  if (isInsideFencedMarkdownCode(source, triggerOffset)) return null;

  const parsed = parseTableLines(lines, triggerLine, bounds);
  if (!parsed) return null;
  return {
    columnCount: parsed.columnCount,
    delimiterCells: parsed.delimiterCells,
    framed: parsed.framed,
    lines: parsed.lines,
    prefix: parsed.prefix,
  };
}

export function findMarkdownTableSourceLines(
  lines: readonly string[],
): MarkdownTableSourceLine[] {
  const found = new Map<number, MarkdownTableSourceLine>();
  for (let triggerLine = 0; triggerLine < lines.length; triggerLine += 1) {
    const block = parseMarkdownTableAtLine(lines, triggerLine);
    if (!block) continue;
    for (const line of block.lines) {
      found.set(line.lineIndex, {
        lineIndex: line.lineIndex,
        text: lines[line.lineIndex],
      });
    }
    triggerLine = Math.max(triggerLine, block.lines.at(-1)!.lineIndex);
  }
  return [...found.values()].sort((left, right) => left.lineIndex - right.lineIndex);
}
```

`parseTableLines` is the moved body of the current `formatMarkdownTableAtLine` from `tableBlockAt(...)` through the final `delimiterCells` guard. Give it the private return type below, and move that code without changing its branch order or syntax predicates:

```ts
interface ParsedTableLines {
  columnCount: number;
  delimiterCells: readonly MarkdownTableSyntaxCell[];
  framed: boolean;
  lines: readonly ParsedMarkdownTableLine[];
  prefix: string;
}
```

The only translations inside the moved body are the fence guard above, `return null` for every existing rejection, and this terminal return after `delimiterCells` is found:

```ts
return {
  columnCount,
  delimiterCells,
  framed,
  lines: parsed,
  prefix,
};
```

Do not import React, Monaco, or DOM APIs in this file.

- [ ] **Step 5: Make table formatting consume the shared parsed block**

Replace its private parsing section with:

```ts
const parsedBlock = parseMarkdownTableAtLine(lines, triggerLine);
if (!parsedBlock) return null;
const {
  columnCount,
  delimiterCells,
  framed,
  lines: parsed,
  prefix,
} = parsedBlock;
```

Keep `alignmentForDelimiter`, width calculation, cell padding, delimiter serialization, minimal edit derivation, and all output strings unchanged.

- [ ] **Step 6: Run parser and formatter tests**

Run:

```bash
npm test -- tests/markdown-table-structure.test.ts tests/markdown-table-formatting.test.ts tests/monaco-markdown-table-formatting.test.ts
```

Expected: PASS; existing aligned, grouped, compact, escaped-pipe, code-fence, IME, and undo behavior remains unchanged.

- [ ] **Step 7: Review Task 1 before continuing**

Use a fresh review subagent to check that formatting and width discovery share one grammar, that no formatter output changed, and that the new pure module has no editor or DOM dependency. Apply corrections in the same working-copy change and rerun Step 6.

---

### Task 2: Measure full table source lines in Monaco

**Files:**
- Create: `src/components/monacoMarkdownTableWidth.ts`
- Create: `tests/monaco-markdown-table-width.test.ts`

**Interfaces:**
- Consumes: `findMarkdownTableSourceLines(lines)` from Task 1 and `MonacoMarkdownEditorReadyContext`.
- Produces:

```ts
export interface MonacoMarkdownTableWidthOptions {
  onRequiredWidthChange(width: number): void;
}

export function requiredMarkdownTableWidth(
  lines: readonly string[],
  measureLine: (line: string) => number,
  editorChromeWidth: number,
  safetyWidth: number,
): number;

export function installMonacoMarkdownTableWidth(
  context: MonacoMarkdownEditorReadyContext,
  options: MonacoMarkdownTableWidthOptions,
): Monaco.IDisposable;
```

- A width of `0` means no valid table. The observer reports current values; monotonic retention belongs to the editing card and shelf.

- [ ] **Step 1: Write pure required-width tests**

Create the test file with exact source and measurement expectations:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  requiredMarkdownTableWidth,
} from "../src/components/monacoMarkdownTableWidth";

describe("requiredMarkdownTableWidth", () => {
  it("uses the widest valid table source line plus editor chrome and safety", () => {
    const lines = [
      "prose | only",
      "| A | B |",
      "| --- | --- |",
      "| Длинная строка | [ ] |",
    ];
    const measure = vi.fn((line: string) => line.length * 8);

    expect(requiredMarkdownTableWidth(lines, measure, 12, 8))
      .toBe(lines[3].length * 8 + 20);
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it("returns zero without a valid table", () => {
    expect(requiredMarkdownTableWidth(["text | value"], () => 999, 12, 8)).toBe(0);
  });

  it("sanitizes unavailable numeric measurements", () => {
    const lines = ["| A | B |", "| --- | --- |", "| x | y |"];
    expect(requiredMarkdownTableWidth(lines, () => Number.NaN, Number.NaN, Number.NaN))
      .toBe(0);
  });
});
```

- [ ] **Step 2: Write lifecycle tests for scheduling, deduplication, and disposal**

Build a fake context with model-content and layout listeners. Mock animation frames and probe measurement:

```ts
it("measures initially, batches edits, publishes changes once, and disposes", () => {
  const harness = createWidthHarness([
    "| A | B |",
    "| --- | --- |",
    "| x | y |",
  ]);
  const onRequiredWidthChange = vi.fn();
  const disposable = installMonacoMarkdownTableWidth(harness.context, {
    onRequiredWidthChange,
  });

  harness.flushFrame();
  expect(onRequiredWidthChange).toHaveBeenCalledTimes(1);

  harness.replaceLines([
    "| A much wider value | B |",
    "| --- | --- |",
    "| x | y |",
  ]);
  harness.emitContentChange();
  harness.emitContentChange();
  harness.flushFrame();
  expect(onRequiredWidthChange).toHaveBeenCalledTimes(2);

  harness.replaceLines(["plain prose"]);
  harness.emitContentChange();
  harness.flushFrame();
  expect(onRequiredWidthChange).toHaveBeenLastCalledWith(0);

  disposable.dispose();
  expect(harness.probe.isConnected).toBe(false);
  expect(harness.contentSubscription.dispose).toHaveBeenCalledOnce();
  expect(harness.layoutSubscription.dispose).toHaveBeenCalledOnce();
});
```

The harness must make `HTMLElement.getBoundingClientRect()` return widths that distinguish tabs, Cyrillic, emoji/full-width fixtures, and ordinary ASCII. Add one test proving the complete offscreen model line is measured without calling `editor.getOffsetForColumn()` or `editor.getWidthOfLine()`.

- [ ] **Step 3: Run the width tests to verify failure**

Run:

```bash
npm test -- tests/monaco-markdown-table-width.test.ts
```

Expected: FAIL because the module and exported functions do not exist.

- [ ] **Step 4: Implement the pure maximum calculation**

Use the shared discovery output and sanitize every numeric contribution:

```ts
export function requiredMarkdownTableWidth(
  lines: readonly string[],
  measureLine: (line: string) => number,
  editorChromeWidth: number,
  safetyWidth: number,
): number {
  const tableLines = findMarkdownTableSourceLines(lines);
  if (!tableLines.length) return 0;
  const finitePixels = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const textWidth = Math.max(0, ...tableLines.map(({ text }) => finitePixels(measureLine(text))));
  return Math.ceil(textWidth + finitePixels(editorChromeWidth) + finitePixels(safetyWidth));
}
```

- [ ] **Step 5: Implement an offscreen Monaco-font probe**

Create one probe per installed observer, never one per line:

```ts
const probe = document.createElement("span");
probe.setAttribute("aria-hidden", "true");
Object.assign(probe.style, {
  contain: "layout style",
  left: "-100000px",
  position: "absolute",
  visibility: "hidden",
  whiteSpace: "pre",
});
editor.applyFontInfo(probe);
probe.style.tabSize = String(model.getOptions().tabSize);
document.body.append(probe);

const measureLine = (line: string) => {
  probe.textContent = line;
  return probe.getBoundingClientRect().width;
};
```

This measures model strings directly, including offscreen and currently wrapped lines. Do not use visible-line-only Monaco APIs.
Keeping the probe outside the editor's shelf subtree is required: changing its text during measurement must not wake `ShelfGrid`'s subtree mutation observer and create a resize/measurement feedback loop.

- [ ] **Step 6: Implement observer scheduling and width publication**

Use one animation-frame slot, run after table-formatting microtasks, and deduplicate equal widths:

```ts
let frame = 0;
let lastPublishedWidth: number | undefined;

const measure = () => {
  frame = 0;
  const layout = editor.getLayoutInfo();
  const font = editor.getOption(context.monaco.editor.EditorOption.fontInfo);
  editor.applyFontInfo(probe);
  probe.style.tabSize = String(model.getOptions().tabSize);
  probe.textContent = "M";
  const metricWidth = probe.getBoundingClientRect().width;
  if (!(layout.width > 0 && font.typicalHalfwidthCharacterWidth > 0 && metricWidth > 0)) return;
  const width = requiredMarkdownTableWidth(
    model.getLinesContent(),
    measureLine,
    layout.contentLeft + layout.verticalScrollbarWidth + 2,
    font.typicalHalfwidthCharacterWidth,
  );
  if (width === lastPublishedWidth) return;
  lastPublishedWidth = width;
  options.onRequiredWidthChange(width);
};

const schedule = () => {
  if (!frame) frame = window.requestAnimationFrame(measure);
};
```

Subscribe to `model.onDidChangeContent(schedule)` and `editor.onDidLayoutChange(schedule)`, call `schedule()` initially, and dispose both subscriptions, the pending frame, and the probe in reverse ownership order. If metrics or DOM measurement are unavailable, keep editing functional and wait for the next scheduled attempt rather than publishing `NaN`.

- [ ] **Step 7: Run width and table tests**

Run:

```bash
npm test -- tests/monaco-markdown-table-width.test.ts tests/markdown-table-structure.test.ts tests/monaco-markdown-table-formatting.test.ts
```

Expected: PASS with one initial publication, batched updates, zero for no table, and complete disposal.

- [ ] **Step 8: Review Task 2 before continuing**

Use a fresh review subagent to verify source-line measurement, full-width/tab handling, observer ordering assumptions, equality deduplication, and leak-free disposal. Apply corrections and rerun Step 7.

---

### Task 3: Add arbitrary spans and anchored growth to ShelfGrid

**Files:**
- Modify: `src/components/ShelfGrid.tsx`
- Modify: `tests/shelf-grid.test.tsx`

**Interfaces:**
- Consumes direct grid-child base span from `data-shelf-column-span` and transient pixel demand from either the direct child or its editing-card descendant `data-shelf-required-width`.
- Produces:

```ts
export interface ShelfExpansion {
  index: number;
  requestedSpan: number;
}

export function shelfColumnSpanForWidth(
  requiredWidth: number,
  gridWidth: number,
  columnCount: number,
  columnGap: number,
): number;

export function expandShelfLayout(
  naturalHeights: readonly number[],
  columnCount: number,
  previousLayout: ShelfLayout,
  options: ShelfLayoutOptions & { expansion: ShelfExpansion },
): ShelfLayout;
```

- `buildShelfLayout` continues to produce the ordinary initial/base layout but accepts any positive integer `columnSpans` value, clamped to `columnCount`.
- `expandShelfLayout` pins the expansion target's previous shelf, column, and top; clamps its span to `columnCount - previous.column`; preserves earlier/left placements; and repacks displaced/following indexes in document order. If the editing card belonged to a two-card vertical stack, the other stack member enters the displaced tail so the editing card can own the widened slot without overlap.

- [ ] **Step 1: Write pure arbitrary-span and pixel-conversion tests**

Add:

```ts
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
```

Use the actual formula:

```text
columnWidth = (gridWidth - columnGap * (columnCount - 1)) / columnCount
spanWidth(n) = columnWidth * n + columnGap * (n - 1)
```

- [ ] **Step 2: Write anchored expansion tests**

Construct a previous four-column layout and prove pinning, displacement, and right-edge fallback:

```ts
it("grows in place, displaces right cards, and clamps at the boundary", () => {
  const initial = buildShelfLayout([100, 100, 100, 100, 100], 4);
  const middle = expandShelfLayout([100, 100, 100, 100, 100], 4, initial, {
    columnSpans: [1, 1, 1, 1, 1],
    expansion: { index: 1, requestedSpan: 3 },
  });
  expect(middle.placements[1]).toMatchObject({ shelf: 0, column: 1, columnSpan: 3, top: 0 });
  expect(middle.placements[0]).toMatchObject({ shelf: 0, column: 0, top: 0 });
  expect(middle.placements[2].shelf).toBeGreaterThan(0);
  expect(new Set(middle.placements.map((placement) => `${placement.shelf}:${placement.column}`)).size)
    .toBe(middle.placements.length);

  const rightEdgeInitial = buildShelfLayout([100, 100, 100, 100], 4);
  const rightEdge = expandShelfLayout([100, 100, 100, 100], 4, rightEdgeInitial, {
    columnSpans: [1, 1, 1, 1],
    expansion: { index: 3, requestedSpan: 4 },
  });
  expect(rightEdge.placements[3]).toMatchObject({ shelf: 0, column: 3, columnSpan: 1 });
});
```

Add a stacked-slot fixture: if a two-card stack is to the right of the anchor, both indexes are displaced together and remain in stable document order.
Add a second stacked fixture with the editing target as the bottom member; after growth it must retain its previous absolute `top`, its former stack partner must occur once in the tail, and the two rectangles must not overlap.

- [ ] **Step 3: Run the new shelf tests to verify failure**

Run:

```bash
npm test -- tests/shelf-grid.test.tsx
```

Expected: FAIL because arbitrary spans, width conversion, and anchored expansion do not exist.

- [ ] **Step 4: Generalize base span normalization**

Replace the two-only condition with finite integer normalization:

```ts
function normalizeColumnSpan(value: number | undefined, columns: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(columns, Math.max(1, Math.floor(value!)));
}

const columnSpans = heights.map((_, index) => (
  normalizeColumnSpan(options.columnSpans?.[index], columns)
));
```

When reading the DOM attribute, parse all positive integer values rather than only the string `"2"`.

- [ ] **Step 5: Implement pixel-to-span conversion**

Implement a total function that always returns `1...columnCount`:

```ts
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
```

- [ ] **Step 6: Implement pure anchored composition expansion**

Refactor the existing composition packer only as far as needed to support a fixed prefix plus a tail. Add `topOffset?: number` to the private `ShelfSlot`; `layoutComposition` must include it in shelf-height calculation and apply it to a single placement's `top`. This preserves the exact top when an editing card was the bottom member of a stack and its former stack partner is displaced.

Add this private work-item type and helper:

```ts
interface ShelfTailItem {
  index: number;
  columnSpan: number;
}

function appendTailToComposition(
  composition: ShelfComposition,
  tail: readonly ShelfTailItem[],
  heights: readonly number[],
  columns: number,
  stackGap: number,
): void;
```

`appendTailToComposition` processes `tail` in ascending `index` order. It first fills free contiguous columns on the composition's last shelf, then appends ordinary shelves. Extract and reuse the current iterative shelf-packing loop from `buildShelfLayout`, passing `heights` and `stackGap` so the two-item stack predicate and shelf-height convergence remain identical. Never add an item to a slot already containing the pinned anchor. Every item must appear exactly once.

Update `placementComposition` to reconstruct `topOffset` for any singleton slot whose placement begins below its shelf's minimum top; otherwise a second automatic expansion could erase the first pinned editor's vertical offset. Update `layoutComposition` with these exact rules:

```ts
const slotNaturalHeight = (slot: ShelfSlot) => (
  slot.indexes.reduce((total, index) => total + heights[index], 0)
  + stackGap * Math.max(0, slot.indexes.length - 1)
);
const shelfHeight = Math.max(
  1,
  ...slots.map((slot) => (slot.topOffset ?? 0) + slotNaturalHeight(slot)),
);
```

For a singleton, set `top` to `shelfTop + (slot.topOffset ?? 0)` and `height` to `shelfHeight - (slot.topOffset ?? 0)`. Existing two-card stacks retain their current proportional height distribution and always have zero offset.

The public function must follow this concrete control flow:

```ts
export function expandShelfLayout(
  naturalHeights: readonly number[],
  columnCount: number,
  previousLayout: ShelfLayout,
  options: ShelfLayoutOptions & { expansion: ShelfExpansion },
): ShelfLayout {
  const columns = Math.max(1, Math.floor(columnCount));
  const anchor = previousLayout.placements[options.expansion.index];
  if (!anchor) return buildShelfLayout(naturalHeights, columns, options);

  const requestedSpan = normalizeColumnSpan(options.expansion.requestedSpan, columns);
  const anchoredSpan = Math.max(
    anchor.columnSpan,
    Math.min(requestedSpan, columns - anchor.column),
  );
  if (anchoredSpan === anchor.columnSpan) return previousLayout;

  const previousComposition = placementComposition(previousLayout.placements);
  const anchorShelfTop = Math.min(
    ...previousLayout.placements
      .filter((placement) => placement.shelf === anchor.shelf)
      .map((placement) => placement.top),
  );
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
    safePixels(options.rowGap ?? DEFAULT_ROW_GAP, DEFAULT_ROW_GAP),
    stackGap,
  );
}
```

Before accepting the helper, assert in tests that the input layout is unchanged, every index occurs once, each slot remains within `0...columns`, no same-shelf horizontal rectangles overlap, and the anchor's `shelf`, `column`, and absolute `top` equal the previous values.

- [ ] **Step 7: Write ShelfGrid DOM tests for monotonic descendant demand**

Use a four-column mocked grid and a wrapper matching the new-game portal shape:

```tsx
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
```

With a `1464px` grid and `8px` gaps, assert the editor starts at the same `gridColumnStart`, grows to `span 2`, and shifts right cards. Rerender with `data-shelf-required-width="360"` and assert it stays `span 2`. Then replace the nested `.note-card--editing` article with a read-mode article while keeping the direct wrapper mounted; assert the wrapper returns to its base span. This proves cleanup is tied to editor DOM lifetime without contradicting monotonicity while the editor remains mounted or keying state only by note id.

Add a last-column fixture whose demand exceeds the viewport and assert `gridColumnEnd` remains `auto` instead of moving the card.

Add two further fixtures required by the design:

- resize a four-column grid down to two columns and back while the same editing descendant remains mounted; assert physical placement is clamped at two columns, then the retained pixel/span demand is reapplied when four columns return;
- mount two editing descendants with demands in the same batch; assert their requests are applied in direct-child DOM order, the second anchor is taken from the placement produced after the first expansion, and no placements overlap.

- [ ] **Step 8: Wire monotonic requests into ShelfGrid layout**

Store desired automatic spans per direct child node so React rerenders and note ids cannot accidentally reset or leak a session:

```ts
const automaticSpansRef = useRef(new WeakMap<HTMLElement, number>());
```

For each direct child:

1. read its positive base span;
2. locate an editing card on the child itself or as a `.note-card--editing` descendant;
3. if no editing card exists, delete that direct child's WeakMap entry because the session ended;
4. if the editor exists but has no positive `data-shelf-required-width` yet, retain any previous entry unchanged;
5. if a positive demand exists, calculate its span and store `Math.max(previousAutoSpan, demandedSpan)`;
6. keep `compositionRef` as the ordinary/base composition only—never overwrite it with an automatically expanded composition;
7. rebuild that base composition after order, base-span, thawed repack, or column-count changes, including responsive shrink/growth;
8. derive a base layout from that composition for every layout batch, then apply active growing automatic spans in stable DOM order with `expandShelfLayout`, feeding each result into the next request so each later anchor comes from the placement produced by earlier requests;
9. after a session ends, derive the next result from the retained base composition, so the ended session returns to its base span even if another editor keeps ordinary packing frozen.

Add `data-shelf-required-width` to the mutation observer's `attributeFilter`. Do not replace or remount child nodes.

- [ ] **Step 9: Run all shelf tests**

Run:

```bash
npm test -- tests/shelf-grid.test.tsx tests/note-groups.test.tsx
```

Expected: PASS; existing natural-height stacking, frozen packing, span-two behavior, node preservation, and responsive column tests remain green alongside anchored auto-width tests.

- [ ] **Step 10: Review Task 3 before continuing**

Use a fresh review subagent to audit overlap safety, stable ordering, stacked slots, right-edge clamping, monotonic WeakMap lifecycle, responsive repacking, and DOM identity. Apply corrections and rerun Step 9.

---

### Task 4: Connect Monaco width demand to editing note cards

**Files:**
- Modify: `src/components/MonacoNoteEditor.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `tests/monaco-note-editor.test.tsx`
- Create: `tests/note-editor-auto-width.test.tsx`

**Interfaces:**
- Consumes: `installMonacoMarkdownTableWidth` from Task 2 and ShelfGrid's descendant `data-shelf-required-width` support from Task 3.
- Adds to `MonacoNoteEditorProps`:

```ts
onRequiredTableWidthChange?(width: number): void;
```

- `PlainNoteEditor` retains the maximum report in React state and renders it on the editing article as `data-shelf-required-width` only when positive.

- [ ] **Step 1: Write MonacoNoteEditor installation and live-callback tests**

Extend the hoisted test boundary:

```ts
width: vi.fn(),
widthOptions: undefined as unknown,
```

Mock `monacoMarkdownTableWidth`, make it return `disposable("width")`, and assert order and routing:

```ts
it("installs width measurement after table typing and routes live reports", () => {
  const firstWidth = vi.fn();
  const view = render(<MonacoNoteEditor {...props({ onRequiredTableWidthChange: firstWidth })} />);
  const extension = boundary.props?.onReady?.(context);

  expect(boundary.table.mock.invocationCallOrder[0])
    .toBeLessThan(boundary.width.mock.invocationCallOrder[0]);
  const options = boundary.widthOptions as { onRequiredWidthChange(width: number): void };
  options.onRequiredWidthChange(720);
  expect(firstWidth).toHaveBeenCalledWith(720);

  const nextWidth = vi.fn();
  view.rerender(<MonacoNoteEditor {...props({ onRequiredTableWidthChange: nextWidth })} />);
  options.onRequiredWidthChange(880);
  expect(nextWidth).toHaveBeenCalledWith(880);

  extension?.dispose();
  expect(boundary.disposals).toEqual(["actions", "completion", "list", "width", "table"]);
});
```

Update existing partial-install expectations so a failure after width installation disposes `width` and `table` in reverse order.

- [ ] **Step 2: Run the MonacoNoteEditor test to verify failure**

Run:

```bash
npm test -- tests/monaco-note-editor.test.tsx
```

Expected: FAIL because the prop and width extension are not wired.

- [ ] **Step 3: Install the width observer with live callback access**

Add the callback to `LiveValues` and install immediately after table typing:

```ts
extensions.push(installMonacoMarkdownTableTyping(context));
extensions.push(installMonacoMarkdownTableWidth(context, {
  onRequiredWidthChange: (width) => {
    live.current.onRequiredTableWidthChange?.(width);
  },
}));
extensions.push(installMonacoMarkdownListEditing(context));
```

Keep the existing reverse-order disposer and partial-install cleanup behavior.

- [ ] **Step 4: Write page-level tests with a controllable MonacoNoteEditor mock**

Create `tests/note-editor-auto-width.test.tsx`. Mock `MonacoNoteEditor` and retain callbacks by `modelKey`; clear the map in `beforeEach` and remove the entry in a mock-component cleanup effect so one editor session cannot leak into another:

```tsx
const { widthReports } = vi.hoisted(() => ({
  widthReports: new Map<string, (width: number) => void>(),
}));

beforeEach(() => { widthReports.clear(); });

vi.mock("../src/components/MonacoNoteEditor", () => ({
  MonacoNoteEditor: (props: {
    modelKey: string;
    onRequiredTableWidthChange?(width: number): void;
  }) => {
    useEffect(() => {
      if (props.onRequiredTableWidthChange) {
        widthReports.set(props.modelKey, props.onRequiredTableWidthChange);
      }
      return () => { widthReports.delete(props.modelKey); };
    }, [props.modelKey, props.onRequiredTableWidthChange]);
    return <textarea aria-label="Текст заметки" />;
  },
}));
```

Cover both direct inline cards and new-game portal hosts:

```ts
it("publishes a monotonic transient width without changing saved doubleWidth", async () => {
  const user = userEvent.setup();
  const note = makeNote(NOTE_ID, "| A | B |\n| --- | --- |\n| x | y |", 1024);
  render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={vi.fn()} />);

  const readCard = screen.getByText("x").closest<HTMLElement>("article")!;
  await user.click(within(readCard).getByRole("button", { name: "Редактировать заметку" }));
  const editingCard = screen.getByRole("textbox", { name: "Текст заметки" })
    .closest<HTMLElement>("article")!;
  act(() => widthReports.get(`note:${NOTE_ID}`)?.(730));
  act(() => widthReports.get(`note:${NOTE_ID}`)?.(360));

  expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
  expect(editingCard).toHaveAttribute("data-shelf-column-span", "1");
  const widthButton = within(editingCard).getByRole("button", { name: "Двойная ширина заметки" });
  expect(widthButton).toHaveAttribute("aria-pressed", "false");
  await user.click(widthButton);
  expect(editingCard).toHaveAttribute("data-shelf-column-span", "2");
  expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
  await user.click(widthButton);
  expect(editingCard).toHaveAttribute("data-shelf-column-span", "1");
  expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");

  await user.click(within(editingCard).getByRole("button", { name: "Отменить редактирование" }));
  expect(document.querySelector("[data-shelf-required-width]")).toBeNull();
});

it("publishes demand inside a persistent draft host", async () => {
  const user = userEvent.setup();
  render(<GamePage assets={{}} mode="new" notes={[]} onSave={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));

  const textbox = screen.getByRole("textbox", { name: "Текст заметки" });
  const editingCard = textbox.closest<HTMLElement>("article")!;
  const host = editingCard.closest<HTMLElement>(".note-editor-sortable")!;
  const modelKey = [...widthReports.keys()].find((key) => key.startsWith("note:"))!;
  act(() => widthReports.get(modelKey)?.(730));

  expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
  expect(editingCard.closest(".note-editor-sortable")).toBe(host);
  expect(screen.getByRole("textbox", { name: "Текст заметки" })).toBe(textbox);
});
```

Import `useEffect`, `act`, `within`, and the existing minimal `GamePage` fixture helpers directly into the new test. Add:

- a prose-only existing-note case that receives the observer's `0` report and stays at its saved span;
- a save case with an `onSave` spy: report a positive automatic width, save without touching the manual width control, wait for the save input, and assert the saved note has no `doubleWidth` while the read card has no `data-shelf-required-width` and has `data-shelf-column-span="1"`.

Do not save real application data.

- [ ] **Step 5: Run the page-level test to verify failure**

Run:

```bash
npm test -- tests/note-editor-auto-width.test.tsx
```

Expected: FAIL because `PlainNoteEditor` does not pass or retain the width report.

- [ ] **Step 6: Retain and render the session maximum in PlainNoteEditor**

Add state and a monotonic callback:

```ts
const [requiredTableWidth, setRequiredTableWidth] = useState(0);
const growRequiredTableWidth = useCallback((width: number) => {
  if (!Number.isFinite(width) || width <= 0) return;
  setRequiredTableWidth((previous) => Math.max(previous, Math.ceil(width)));
}, []);
```

Pass it to `MonacoNoteEditor` and render the transient data separately from the persisted span:

```tsx
<article
  data-note-id={note.clientId}
  data-shelf-column-span={note.doubleWidth ? 2 : 1}
  data-shelf-required-width={requiredTableWidth || undefined}
  ref={editorRef}
>
```

Do not copy the automatic width into `noteRef`, `publishNote`, `doubleWidth`, save payloads, or manual button state. React unmount naturally resets the session maximum.

- [ ] **Step 7: Run focused integration tests**

Run:

```bash
npm test -- tests/monaco-note-editor.test.tsx tests/note-editor-auto-width.test.tsx tests/note-collapse.test.tsx tests/note-groups.test.tsx
```

Expected: PASS; callback installation and disposal are correct, width is monotonic and transient, manual sizing persists independently, and draft editor DOM nodes survive moves.

- [ ] **Step 8: Review Task 4 before continuing**

Use a fresh review subagent to verify no transient value reaches persisted notes, the callback remains live across rerenders, unmount resets state, portal descendants are discoverable by ShelfGrid, and Monaco is never recreated. Apply corrections and rerun Step 7.

---

### Task 5: Verify the complete behavior and finalize one feature commit

**Files:**
- Verify all files listed above.
- Modify only directly related tests or implementation if verification finds a defect.

**Interfaces:**
- Consumes every interface produced by Tasks 1–4.
- Produces one verified immutable Jujutsu feature commit containing the approved spec, this plan, tests, and implementation, followed by a fresh empty working-copy change.

- [ ] **Step 1: Run the complete focused suite**

Run:

```bash
npm test -- \
  tests/markdown-table-structure.test.ts \
  tests/markdown-table-formatting.test.ts \
  tests/monaco-markdown-table-formatting.test.ts \
  tests/monaco-markdown-table-width.test.ts \
  tests/monaco-note-editor.test.tsx \
  tests/shelf-grid.test.tsx \
  tests/note-editor-auto-width.test.tsx \
  tests/note-collapse.test.tsx \
  tests/note-groups.test.tsx
```

Expected: all focused tests PASS with no unhandled observer, timer, or React `act` warnings.

- [ ] **Step 2: Run the complete project tests**

Run:

```bash
npm test
```

Expected: all Vitest files PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript build and Vite production bundle both succeed.

- [ ] **Step 4: Perform real-browser verification**

Start the local Vite app on an available loopback port, then use the Browser skill against the existing local library without saving fixture content. Verify:

1. a left/middle-column note with a valid table grows only enough to fit;
2. the editing note's left/top position and Monaco focus remain stable;
3. right-side cards are displaced without overlap;
4. widening a cell grows the note but shortening/deleting it does not shrink the open editor;
5. a last-column editor stays in place and wraps the table;
6. save/cancel returns read mode to the persisted manual width;
7. resizing across column breakpoints does not remount Monaco or produce overlap.

Cancel unsaved edits before ending the smoke test.

- [ ] **Step 5: Request final code review**

Invoke `superpowers:requesting-code-review` with the approved design, this plan, and the complete working-copy diff. Address findings in the same working-copy change. If corrections are made, repeat Steps 1–4 in proportion to the affected scope.

- [ ] **Step 6: Inspect the exact Jujutsu change**

Run:

```bash
jj status
jj diff
```

Expected: the change contains only:

- the approved design and implementation plan;
- the shared table structure utility;
- Monaco table-width measurement;
- anchored ShelfGrid changes;
- note-editor integration;
- directly related tests.

Preserve and exclude unrelated parallel work. Do not rewrite any existing or finalized commit.

- [ ] **Step 7: Finalize the single feature commit and open a fresh change**

Run:

```bash
jj describe -m "Auto-expand note editors for Markdown tables"
jj new
```

Expected: exactly one new immutable feature commit contains specification, plan, tests, and implementation, and the working copy moves to a fresh empty descendant change.
