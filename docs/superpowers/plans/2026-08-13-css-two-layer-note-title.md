# CSS Two-Layer Sticky Note Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scroll-measured fixed heading clone with a React-rendered, CSS-positioned two-layer title only when the note's first nonblank parsed block is a top-level Markdown `#`.

**Architecture:** `MarkdownView` renders parsed block zero twice only when it is a top-level heading and `ScrollableNoteCard` supplies a local portal host: an aria-hidden inner visual copy and the sole semantic outer copy. The host and viewport overlap in the note text grid; native sticky positioning handles note and page scrolling with no heading-related scroll listeners, measurements, DOM snapshots, or focus transfer.

**Tech Stack:** React 19, React DOM local portals, TypeScript 7, CSS Grid, CSS sticky positioning, Vitest 4, Testing Library, JSDOM, Vite, Jujutsu.

## Global Constraints

- Only a top-level Markdown `#` that is the note's first nonblank parsed block is duplicated and sticky; a `#` after any preamble and every later heading of every level is single-copy and non-sticky.
- The first `#` qualifies with or without checklist progress.
- The outer copy is the sole semantic, focusable, pointer-interactive copy; the inner copy is `aria-hidden`, absent from sequential focus navigation, and pointer-inert.
- Both copies render from the same parsed Markdown block, checklist state, progress, and React callbacks; do not snapshot HTML or delegate clicks through DOM queries.
- The outer host is local to its note card, outside `.note-card__viewport`, and must not portal to `document.body` or `.app-shell`.
- The title must use no heading-related scroll/resize listeners, animation frames, observers, geometry reads, source-hidden classes, inline position, or focus handoff.
- The inner copy is sticky at the note viewport top; the outer host is sticky at `var(--app-header-height)` and bounded by its note.
- The note viewport uses `overscroll-behavior: none` to suppress both inner rubber-band and scroll chaining into the page.
- Overlay the host and viewport without adding a second heading-height or changing card/masonry measurements.
- In the base theme, align the outer heading's block inset to the inner heading so the opaque outer layer fully covers it; per-game CSS may override that inset when its title art reaches the viewport edge.
- Preserve current Markdown parsing, checklist totals, collapse persistence, note saves, editors, drag previews, scroll affordances, card actions, and per-game CSS scoping.
- Preserve the Xenoblade title art and responsive states on both copies while leaving later headings non-sticky.
- Permanent tests use generic fixture notes and contain no real game identifiers or authored database content.
- Do not add dependencies.
- Use Jujutsu exclusively. The controller produces one final fix commit containing this specification, plan, tests, implementation, and style compatibility changes.

---

## File Structure

- Modify `src/components/Markdown.tsx`: qualify a top-level heading only at parsed block zero and render its inner/outer variants through a local host while sharing normal heading state and handlers.
- Modify `src/pages/GamePage.tsx`: mount the note-local page-heading host and pass it to `MarkdownView`; remove the runtime sticky component and its refs/layout key.
- Delete `src/components/PageStickyChecklistHeading.tsx`: remove all scroll-driven clone behavior.
- Modify `src/styles.css`: define the grid overlay, non-scrolling clipping, first-heading inner sticky, page-layer sticky, inert visual copy, and remove fixed/source-hidden rules.
- Modify `src/components/ShelfGrid.tsx`: remove the obsolete source-hidden mutation exception.
- Modify `tests/note-collapse.test.tsx`: replace fixed-clone geometry/listener tests with generic two-layer rendering, accessibility, interaction, scroll stability, and CSS contract tests.
- Modify `tests/shelf-grid.test.tsx`: remove the obsolete source-class fixture while retaining completion-mutation and collapse-layout coverage.
- Modify `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`: adapt the existing approved title selectors to the local outer layer and first-heading classes without adding activation logic.
- Create `docs/superpowers/specs/2026-08-13-css-two-layer-note-title-design.md` and `docs/superpowers/plans/2026-08-13-css-two-layer-note-title.md` in the final fix commit.

### Task 1: Replace the runtime clone with two CSS sticky layers

**Files:**

- Modify: `tests/note-collapse.test.tsx`
- Modify: `tests/shelf-grid.test.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/pages/GamePage.tsx`
- Delete: `src/components/PageStickyChecklistHeading.tsx`
- Modify: `src/styles.css`
- Modify: `src/components/ShelfGrid.tsx`
- Modify: `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`

**Interfaces:**

- Consumes: `MarkdownViewProps`, parsed `MarkdownBlock` headings, existing checklist progress/collapse callbacks, `.note-card__text`, `.note-card__viewport`, `--app-header-height`, and the existing per-game title selectors.
- Produces: optional `firstHeadingPortalTarget: Element | null` on `MarkdownViewProps`; `.markdown-note-title--inner`, `.markdown-note-title--outer`, and `.note-card__page-heading`; no `PageStickyChecklistHeading` runtime component.

- [ ] **Step 1: Write generic failing tests for first-heading duplication and later-heading exclusion**

  In `tests/note-collapse.test.tsx`, replace the geometry-driven portal tests with rendered-card assertions using a generic note such as:

  ```tsx
  const note = makeNote(id, [
    "# Primary route",
    "- [ ] Root task",
    "## Nested progress",
    "- [ ] Nested task",
    "# Later route",
    "- [ ] Later task",
  ].join("\n"), 1024);
  ```

  Assert that `Primary route` exists as exactly two DOM `h2` elements, but Testing Library exposes exactly one accessible heading and one accessible collapse button. Assert the inner copy has `.markdown-note-title--inner` and `aria-hidden="true"`; assert the outer copy has `.markdown-note-title--outer` inside the same article's `.note-card__page-heading`. Assert `Later route` and `Nested progress` each have one DOM heading and lack both title-layer classes.

  Add a separate plain-first-heading fixture to prove progress is not required. Add a preamble fixture such as `Intro paragraph\n\n# Later title` and assert the heading remains one-copy and non-sticky. Render `MarkdownView` directly without a host and assert it still produces one accessible heading, preserving detached Markdown behavior.

  Review correction: render a generic `GamePage` note whose sole body is `# Plain title`; assert exactly two matching DOM `h2` elements, exactly one accessible heading, zero button/control semantics across those copies, and the `.markdown-note-title--inner` / `.markdown-note-title--outer` classes on their respective layers.

- [ ] **Step 2: Write a failing interaction and scroll-stability test**

  Click and keyboard-focus the accessible outer collapse button and assert the existing save payload records the first heading's collapse id. Assert the inner button cannot be reached through role queries, has `tabIndex === -1`, and its heading subtree is aria-hidden.

  Capture the two title elements, their class names, and absence of inline `top/left/width`; dispatch both `scroll` on `.note-card__viewport` and captured `scroll` on `window`; assert the same nodes remain connected with unchanged class/style values and one accessible heading. This test must fail against the current conditional fixed clone/source-hiding implementation.

- [ ] **Step 3: Write failing production-style assertions for the CSS layer contract**

  Install the real `src/styles.css` with the existing helper and assert:

  ```tsx
  expect(getComputedStyle(pageHost).position).toBe("sticky");
  expect(getComputedStyle(pageHost).top).toContain("--app-header-height");
  expect(getComputedStyle(innerHeading).position).toBe("sticky");
  expect(getComputedStyle(innerHeading).top).toBe("0px");
  expect(getComputedStyle(laterHeading).position).not.toBe("sticky");
  expect(getComputedStyle(surface).overflow).toBe("clip");
  expect(getComputedStyle(innerHeading).pointerEvents).toBe("none");
  ```

  Also assert the host and viewport frame share the same computed grid row/column placement so the second copy reserves no independent row. If JSDOM preserves the custom-property expression rather than resolving it, assert the literal computed expression returned by the environment.

- [ ] **Step 4: Run the focused tests and verify RED**

  Run:

  ```bash
  npm test -- tests/note-collapse.test.tsx tests/shelf-grid.test.tsx
  ```

  Expected: the new two-layer tests fail because the outer clone is conditional/fixed, later top-level checklist headings still qualify, the source is not a permanent inert visual copy, and the old runtime component/listeners remain.

- [ ] **Step 5: Extract shared first-heading rendering in `MarkdownView`**

  Add `firstHeadingPortalTarget?: Element | null` to `MarkdownViewProps` and include it in the memo comparator. Qualify index `0` only when `blocks[0]` has type `heading` and depth `1`; do not search past a preamble.

  Refactor only the existing heading branch into a small local renderer that accepts the block, key, and variant. For the qualifying first heading with a target:

  - render the normal in-flow `h2` with `.markdown-note-title--inner`, `aria-hidden="true"`, and any nested collapse button at `tabIndex={-1}`;
  - create a React portal into the supplied target containing the same heading rendered with `.markdown-note-title--outer`, normal accessibility, and the same `toggleChecklistSection` callback;
  - keep later headings and target-less Markdown on the existing single-render path;
  - keep collapsed-section content suppression driven by the same first heading block once, not once per copy.

  Do not introduce HTML serialization, element queries, new state, effects, or scroll code.

- [ ] **Step 6: Mount the local host and remove the runtime component**

  In `ScrollableNoteCard`, replace the card/viewport refs used only by `PageStickyChecklistHeading` with a local host callback ref/state:

  ```tsx
  const [firstHeadingPortalTarget, setFirstHeadingPortalTarget] = useState<HTMLDivElement | null>(null);
  ```

  Render `<div aria-live="off" className="markdown note-card__page-heading" ref={setFirstHeadingPortalTarget} />` as a child of `.note-card__text` and sibling of `.note-card__viewport-frame`, then pass the target to the note's `MarkdownView`. The host itself must not add a second landmark or accessible label.

  Remove the `PageStickyChecklistHeading` import, fragment sibling, layout key, card ref used only for measurements, and delete `src/components/PageStickyChecklistHeading.tsx`.

- [ ] **Step 7: Replace fixed geometry with the CSS grid/sticky contract**

  In `src/styles.css`:

  - change `.note-card__surface` from `overflow: hidden` to `overflow: clip` so it clips decoration without becoming a sticky scroll ancestor;
  - make `.note-card__text` a one-cell grid and preserve its existing flex sizing/min-height behavior;
  - place `.note-card__viewport-frame` and `.note-card__page-heading` in grid area `1 / 1`;
  - make `.note-card__page-heading` `position: sticky`, `top: var(--app-header-height)`, `align-self: start`, and a suitable z-index below `.app-header` but above note content;
  - make `.note-card__page-heading:empty` non-rendering;
  - make `.note-card__viewport .markdown-note-title--inner` sticky at `top: 0`;
  - make `.markdown-note-title--inner` pointer-inert;
  - change `.note-card__viewport` from `overscroll-behavior: contain` to `overscroll-behavior: none`;
  - share a base-theme title block inset between the inner content origin and outer host so their heading rectangles align and the outer opaque background covers every inner pixel; let the Xenoblade stylesheet override the inset to `0` for its edge-to-edge title art;
  - remove fixed positioning, inline-geometry assumptions, broad all-`h2` sticky selector, and `.note-card__page-heading-source`.

  Keep scroll fades, note sizing, actions, drag/drop, and responsive behavior unchanged.

- [ ] **Step 8: Remove the obsolete shelf mutation exception and adapt Xenoblade selectors**

  Remove `note-card__page-heading-source` from `mutationRequiresShelfLayout` and its fixture mutations in `tests/shelf-grid.test.tsx`; retain the progress/completion mutations that must not remeasure and `aria-expanded` changes that must remeasure.

  In the Xenoblade game stylesheet, keep the existing approved header gradients, diamonds, clipped corners, shadows, progress, complete state, focus, and responsive width/font rules on both `.markdown-note-title--inner` and `.note-card__page-heading > .markdown-note-title--outer`. Remove fixed-only host declarations and ensure the mobile negative margin applies only to the inner source where needed. Do not add game-specific IDs to permanent tests.

- [ ] **Step 9: Run focused tests and verify GREEN**

  Run:

  ```bash
  npm test -- tests/note-collapse.test.tsx tests/shelf-grid.test.tsx tests/markdown-tasks.test.tsx
  ```

  Expected: all selected tests pass with no unhandled errors or warnings.

- [ ] **Step 10: Run the full verification and inspect scope**

  Run:

  ```bash
  npm test
  npm run build
  jj status
  jj diff
  ```

  Expected: the full suite and build exit `0`; the diff contains only the specification, plan, generic implementation/tests, obsolete runtime deletion, and per-game compatibility selectors for this fix.

- [ ] **Step 11: Perform real-browser regression validation**

  At desktop and narrow widths, use a rendered note with a first checklist `#`, enough content to inner-scroll, a nested heading, and a later top-level heading. Verify separately:

  1. inner scrolling keeps the first title aligned with the note viewport while later headings pass underneath without becoming sticky;
  2. document scrolling moves the same visible title to immediately below `.app-header` and releases it at the note boundary;
  3. pointer and keyboard activation of the visible title collapse control update the note without focus duplication;
  4. repeated inner/page scrolling causes no detached clone, vertical page jump, horizontal overflow, or action-panel regression;
  5. forced end-of-note scroll gestures do not bounce or chain into the document;
  6. the base-theme title shows one visual baseline at rest and while sticky;
  7. the Xenoblade title visuals match before/after scroll at the approved desktop and mobile layouts.

  Record viewport dimensions and observed heading/header/card rectangles in the task report. The controller performs the final independent verification and Jujutsu commit.
