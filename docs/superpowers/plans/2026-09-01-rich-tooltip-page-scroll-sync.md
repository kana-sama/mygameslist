# Rich Tooltip Page Scroll Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an open desktop rich tooltip move in lockstep with document scrolling without a JavaScript repositioning pass for each page-scroll event.

**Architecture:** Keep the tooltip portal in `document.body`, but express desktop placement in document coordinates and render it with `position: absolute`. Continue using live viewport geometry for side selection and vertical clamping, translating the final `left` and `top` through `window.scrollX` and `window.scrollY`; internal note scrolling, resize, and resize observers still request placement updates, while document scrolling becomes browser-native.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`

## Global Constraints

- Preserve the portal as a direct child of `document.body`, outside every note clipping and layout container.
- Preserve the exact right/left/fullscreen selection, `344px` desktop width, `14px` note gap, note-bound vertical clamping, arrow clamping, dismissal, focus, and scrolling behavior.
- Desktop `left` and `top` are document coordinates: viewport placement plus current `window.scrollX` and `window.scrollY`.
- Document scrolling must not invoke tooltip geometry reads, React placement updates, or close the tooltip.
- Internal `.note-card__viewport` scrolling, viewport resize, note-surface resize, and tooltip resize must continue to recalculate placement.
- Fullscreen mode remains `position: fixed` and viewport-sized.
- Do not add dependencies or unrelated refactors.
- Use Jujutsu exclusively for repository operations and finalize the whole fix as exactly one commit containing this plan, the spec update, tests, and implementation.

---

### Task 1: Anchor Desktop Tooltip Placement To Document Coordinates

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`
- Create: `docs/superpowers/plans/2026-09-01-rich-tooltip-page-scroll-sync.md`
- Modify: `tests/markdown-rich-tooltip-ui.test.tsx`
- Modify: `tests/note-layout-css.test.ts`
- Modify: `src/components/MarkdownRichTooltip.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: existing `MarkdownRichTooltipPlacement`, `updatePlacement()`, `tooltipStyle`, and `.markdown-rich-tooltip--desktop` contract.
- Produces: the same public component behavior with absolute document-coordinate desktop placement and no captured document-scroll subscription.

- [ ] **Step 1: Write the failing page-scroll regression test**

In `tests/markdown-rich-tooltip-ui.test.tsx`, add one focused test near the existing placement coverage. Set writable `window.scrollX = 40` and `window.scrollY = 300`, open `Archive Entry`, and assert literal document coordinates `left: 654px` and `top: 400px` for the existing `noteRect = (200, 100, 400, 500)` fixture. Record the existing `Element.prototype.getBoundingClientRect` spy call count, then simulate a document scroll by changing the offsets to `80` and `440`, shifting `noteRect` and the active source rectangle by `(-40, -140)`, and firing `scroll` on `document`. Assert that the inline document coordinates stay exactly `654px` and `400px`, the dialog stays open, and the geometry-read count does not increase.

The production mutation this test catches is either omitting the document-coordinate offsets or reinstalling JavaScript document-scroll repositioning.

- [ ] **Step 2: Change the structural CSS assertion to require document positioning**

In `tests/note-layout-css.test.ts`, change only the desktop rich-tooltip positioning expectation from `position: fixed` to `position: absolute`. Preserve the separate fullscreen assertion that requires `position: fixed`.

The production mutation this test catches is returning desktop placement to viewport-fixed coordinates.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts
```

Expected: FAIL because desktop placement still emits viewport coordinates, responds to captured document scroll, and uses `position: fixed`.

- [ ] **Step 4: Implement the minimal document-coordinate placement**

In `src/components/MarkdownRichTooltip.tsx`:

```ts
const next: MarkdownRichTooltipPlacement = {
  arrowTop,
  left: (side === "right" ? noteRect.right + TOOLTIP_GAP : noteRect.left - TOOLTIP_GAP - TOOLTIP_WIDTH) + window.scrollX,
  maxHeight: noteRect.height,
  mode: "desktop",
  side,
  top: top + window.scrollY,
};
```

Remove only the captured `document` scroll listener registration and cleanup from the placement effect. Keep the direct passive `.note-card__viewport` scroll listener, window resize listener, and both `ResizeObserver` targets unchanged.

In `src/styles.css`, change `.markdown-rich-tooltip--desktop` from `position: fixed` to `position: absolute`. Do not change fullscreen positioning or any visual property.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts
```

Expected: PASS with zero failures, React act warnings, or uncaught errors.

- [ ] **Step 6: Run regression verification**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts tests/note-wheel-gesture.test.tsx
npm run build
```

Expected: all tests pass and the build exits `0` without errors.

- [ ] **Step 7: Inspect and finalize exactly one Jujutsu commit**

Run `jj status` and `jj diff`; verify that the commit contains only the spec update, this plan, the two focused tests, the tooltip component, and tooltip CSS. Then run:

```bash
jj describe -m "Keep rich tooltips synced with page scroll"
jj new
```

Do not use Git commands and do not create intermediate commits.
