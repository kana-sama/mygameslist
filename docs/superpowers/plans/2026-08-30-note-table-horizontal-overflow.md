# Note Table Horizontal Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep rendered note headings inside their cards while wide Markdown tables scroll horizontally within the existing table scroll container.

**Architecture:** Reset the automatic minimum inline size of the viewport-frame grid item so the rendered viewport follows the note-card width. Preserve the existing intrinsic-width table and horizontal-scroll wrapper, plus the existing flexible heading title and non-shrinking total.

**Tech Stack:** React 19, TypeScript 7, CSS Grid, CSS overflow, Vitest 4, JSDOM, Vite, in-app Chromium browser, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-30-note-table-horizontal-overflow-design.md`

## Global Constraints

- Wide Markdown tables scroll horizontally inside `.markdown-table-scroll`; they do not widen the rendered note viewport or card.
- The checklist total in the note heading remains fully visible inside the card, and the title yields space first.
- Existing table intrinsic widths, stable collapsed-group column sizing, vertical scrolling, sticky headings, editing, attachments, and shelf layout remain unchanged.
- Do not add JavaScript measurement, new wrappers, new breakpoints, or new dependencies.
- Use generic test fixtures; permanent tests must not encode authored game or note content.
- Compare the final narrow layout directly with `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_yBUJIl/Screenshot 2026-08-30 at 16.18.36.png`: the table must remain horizontally scrollable inside the card and the heading total must fit fully inside the card.
- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Preserve unrelated working-copy changes and finalize only the specification, plan, test, and stylesheet files for this fix.

---

## File Structure

- Modify `tests/note-layout-css.test.ts`: add a computed-style regression test for the rendered viewport, table overflow owner, heading title, and total.
- Modify `src/styles.css`: allow the viewport-frame grid item to shrink within the note card.

### Task 1: Contain wide rendered tables without clipping heading totals

**Files:**

- Modify: `tests/note-layout-css.test.ts`
- Modify: `src/styles.css:740`

**Interfaces:**

- Consumes: `.note-card__text` as the rendered-note grid, `.note-card__viewport-frame` as its content grid item, `.markdown-table-scroll` as the horizontal overflow owner, and the existing `.markdown-checklist-heading__title` / `.markdown-checklist-progress` flex contract.
- Produces: a rendered viewport frame whose computed `min-width` is `0px`, leaving horizontal overflow on `.markdown-table-scroll` while the heading total remains non-shrinking.

- [ ] **Step 1: Write the failing computed-style regression test**

Add this test inside `describe("note column layout", ...)` in `tests/note-layout-css.test.ts`:

```ts
it("contains wide rendered tables while keeping heading totals visible", () => {
  const style = document.createElement("style");
  style.dataset.noteLayoutTest = "true";
  style.textContent = productionStyles;
  document.head.append(style);

  const text = document.createElement("div");
  text.className = "note-card__text";
  text.innerHTML = `
    <div class="note-card__viewport-frame">
      <div class="markdown-table-scroll"><table class="markdown-table"><tbody><tr><td>Wide table value</td></tr></tbody></table></div>
    </div>
    <h2 class="markdown-checklist-heading">
      <span class="markdown-checklist-heading__title">A title that yields inline space</span>
      <span class="markdown-checklist-progress">51/85</span>
    </h2>
  `;
  document.body.append(text);

  const frame = text.querySelector<HTMLElement>(".note-card__viewport-frame")!;
  const tableScroll = text.querySelector<HTMLElement>(".markdown-table-scroll")!;
  const title = text.querySelector<HTMLElement>(".markdown-checklist-heading__title")!;
  const total = text.querySelector<HTMLElement>(".markdown-checklist-progress")!;

  expect(getComputedStyle(frame).minWidth).toBe("0px");
  expect(getComputedStyle(tableScroll).overflowX).toBe("auto");
  expect(getComputedStyle(title).minWidth).toBe("0px");
  expect(getComputedStyle(total).flexShrink).toBe("0");
});
```

Production change caught: removing the viewport-frame minimum reset lets the grid item use the table's min-content width, expanding beyond the card and clipping the right side, including the heading total.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/note-layout-css.test.ts -t "contains wide rendered tables while keeping heading totals visible"
```

Expected: FAIL because the viewport frame computes to `min-width: auto` instead of `0px`; the other three assertions pass and characterize the existing overflow and heading contracts.

- [ ] **Step 3: Implement the minimal stylesheet fix**

Change the viewport-frame rule in `src/styles.css` to:

```css
.note-card__viewport-frame { position: relative; max-height: var(--note-text-height); min-width: 0; min-height: 0; }
```

Do not change table width, table overflow, heading flex, card clipping, or responsive breakpoint rules.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```bash
npm test -- tests/note-layout-css.test.ts
npm test -- tests/markdown-tasks.test.tsx -t "renders arbitrary GFM tables with inline content, alignment, and escaped pipes"
npm test -- tests/markdown-tasks.test.tsx -t "collapses table groups independently"
```

Expected: all three commands PASS without new warnings.

- [ ] **Step 5: Verify the narrow layout in Chromium**

At a 360 CSS-pixel viewport, open a rendered note containing a wide Markdown table and inspect the note card, viewport frame, table scroll wrapper, and heading total. Verify:

```text
viewportFrame.right <= noteCardSurface.right
tableScroll.clientWidth <= viewportFrame.clientWidth
tableScroll.scrollWidth > tableScroll.clientWidth
headingTotal.right <= noteCardSurface.right
```

Also confirm horizontal scrolling changes `tableScroll.scrollLeft` while the card and heading positions remain unchanged.

- [ ] **Step 6: Run repository verification**

Run:

```bash
npm test -- --exclude '.superpowers/workspaces/**'
npm run build
```

Expected: the full test suite and production build pass without new warnings.

- [ ] **Step 7: Inspect and finalize exactly one fix commit**

Run `jj status` and `jj diff`. Finalize only these files in the fix commit:

```text
docs/superpowers/specs/2026-08-30-note-table-horizontal-overflow-design.md
docs/superpowers/plans/2026-08-30-note-table-horizontal-overflow.md
tests/note-layout-css.test.ts
src/styles.css
```

Preserve every unrelated working-copy change. Describe the selected fix as `Keep note tables inside cards`, then leave a fresh working-copy change above it.
