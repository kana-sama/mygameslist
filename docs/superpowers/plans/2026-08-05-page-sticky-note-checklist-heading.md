# Page-Sticky Note Checklist Heading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a note's applicable top-level checklist-total heading fully visible below the sticky application header while any part of the crossed note card remains in the visible content area.

**Architecture:** Add one focused React component that measures a rendered note card and its top-level checklist sections, renders an interactive mirror through a document-body portal, and delegates collapse actions to the original React control. Keep the existing internal CSS sticky behavior intact; `ScrollableNoteCard` only supplies stable card/viewport refs and a content layout key.

**Tech Stack:** React 19, React DOM portals, TypeScript 7, CSS fixed positioning, ResizeObserver, requestAnimationFrame, Vitest 4, Testing Library, JSDOM, Vite, Jujutsu.

## Global Constraints

- The visible content boundary is the bottom edge of `.app-header`, falling back to browser viewport top `0`.
- Show a mirror only while `cardRect.top < boundary && cardRect.bottom > boundary`.
- The mirror must remain fully visible when only one CSS pixel of the card remains below the boundary.
- Only direct `.markdown-section > h2.markdown-checklist-heading` elements qualify.
- Select the last qualifying section whose top reached the boundary, or the first qualifying heading when none has reached it yet.
- A plain top-level heading must not replace the last checklist-total heading.
- Each crossed card owns an independent mirror aligned to its original heading's left edge and width.
- The original React heading remains the source of truth; mirror clicks delegate to its existing button.
- Hide the source with `visibility: hidden` only while mirrored so layout geometry remains stable and only one accessible control is exposed.
- Keep existing internal sticky behavior, Markdown parsing, totals, collapse persistence, task saves, masonry placement, editors, and drag previews unchanged.
- Coalesce scroll, resize, and masonry-placement measurements with one `requestAnimationFrame` per qualifying card and clean up every listener, observer, frame, and source class.
- Do not add dependencies.
- Use Jujutsu exclusively. Produce one feature commit containing the specification, plan, tests, implementation, and `AGENTS.md` workflow clarification.

---

## File Structure

- Create `src/components/PageStickyChecklistHeading.tsx`: own card-local geometry measurement, heading selection, snapshot synchronization, focus transfer, delegated interaction, cleanup, and the document-body portal.
- Modify `src/pages/GamePage.tsx`: merge the sortable article ref with a local card ref and mount `PageStickyChecklistHeading` for rendered note cards.
- Modify `src/styles.css`: style the fixed mirror, keep it below the application header's stacking layer, and hide only the mirrored source while preserving layout.
- Modify `tests/note-collapse.test.tsx`: cover the crossed-card lifecycle, one-pixel trailing edge, section replacement, plain sections, interaction, accessibility, and independent multi-card alignment.
- Modify `AGENTS.md`: record the approved one-feature/one-commit stack policy.
- Create the design and plan documents in `docs/superpowers/specs` and `docs/superpowers/plans` as part of the same feature commit.

### Task 1: Lock the page-sticky behavior with failing rendered-card tests

**Files:**

- Modify: `tests/note-collapse.test.tsx`

**Interfaces:**

- Consumes: `GamePage`, production `src/styles.css`, `.app-header`, rendered note-card articles, `.markdown-section`, and `h2.markdown-checklist-heading`.
- Produces: failing acceptance coverage for `.note-card__page-heading` and `.note-card__page-heading-source` before production code exists.

- [x] **Step 1: Add deterministic geometry and production-style test helpers**

Import `readFileSync` and `resolve`, load `src/styles.css`, and add a DOMRect factory:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function rect({ top = 0, right = 0, bottom = 0, left = 0, width = right - left, height = bottom - top }: Partial<DOMRect> = {}): DOMRect {
  return { x: left, y: top, top, right, bottom, left, width, height, toJSON: () => ({}) };
}
```

Each test appends a `<style>` containing `productionStyles`, stubs `requestAnimationFrame` synchronously, and restores both through the existing `afterEach` cleanup.

- [x] **Step 2: Add the crossed-card lifecycle and one-pixel trailing-edge test**

Render one note with a qualifying top-level checklist heading. Stub geometry so the application-header boundary is `48`, then move the card through these states by mutating the rect fixture and dispatching `scroll`:

```tsx
expect(document.querySelector(".note-card__page-heading")).toBeNull();

cardTop = 47;
cardBottom = 49;
fireEvent.scroll(window);

const mirror = await screen.findByTestId("note-page-sticky-heading");
expect(mirror).toHaveStyle({ left: "16px", top: "48px", width: "320px" });
expect(getComputedStyle(mirror).position).toBe("fixed");
expect(screen.getAllByRole("heading", { name: /^First checklist / })).toHaveLength(1);

cardBottom = 48;
fireEvent.scroll(window);
await waitFor(() => expect(screen.queryByTestId("note-page-sticky-heading")).toBeNull());
```

Also assert that the source heading gains and then loses `.note-card__page-heading-source` without changing the card's grid-row styles.

- [x] **Step 3: Add section selection, delegated collapse, and multi-card alignment coverage**

Use two notes whose article rects cross the boundary in different columns. The first fixture contains a checklist heading, a plain `#` section, and a later checklist heading. Assert:

```tsx
expect(screen.getAllByTestId("note-page-sticky-heading")).toHaveLength(2);
expect(mirrors[0]).toHaveStyle({ left: "16px", width: "320px" });
expect(mirrors[1]).toHaveStyle({ left: "344px", width: "420px" });
expect(within(mirrors[0]).getByRole("heading", { name: /^First checklist / })).toBeVisible();

plainSectionTop = 40;
secondChecklistSectionTop = 180;
fireEvent.scroll(window);
expect(within(mirrors[0]).getByRole("heading", { name: /^First checklist / })).toBeVisible();

secondChecklistSectionTop = 47;
fireEvent.scroll(firstViewport);
expect(await within(mirrors[0]).findByRole("heading", { name: /^Second checklist / })).toBeVisible();
```

Click the first mirror's collapse button, verify the existing `onSave` payload contains the collapsed section id, and verify only the mirror control is keyboard-focusable while its source is hidden.

- [x] **Step 4: Run the targeted tests and verify RED**

Run:

```bash
npm test -- tests/note-collapse.test.tsx -t "page-sticky checklist heading"
```

Expected: FAIL because `.note-card__page-heading` and its portal do not exist.

### Task 2: Implement the card-local page-sticky mirror

**Files:**

- Create: `src/components/PageStickyChecklistHeading.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `RefObject<HTMLElement | null>` for the card and viewport plus a string `layoutKey`; live `.app-header`, `.markdown-section`, and source-heading geometry.
- Produces: `PageStickyChecklistHeading({ cardRef, viewportRef, layoutKey }): ReactPortal | null`, `.note-card__page-heading`, `.note-card__page-heading-source`, and the `note-page-sticky-heading` test id.

- [x] **Step 1: Create the snapshot and deterministic selection model**

Define a snapshot containing the source element, source classes and inner markup, collapse-button state, and rounded portal geometry:

```tsx
interface HeadingSnapshot {
  source: HTMLHeadingElement;
  className: string;
  contentHtml: string;
  buttonClassName: string | null;
  ariaExpanded: boolean | undefined;
  disabled: boolean;
  left: number;
  top: number;
  width: number;
}

function visibleContentBoundary(): number {
  return Math.max(0, document.querySelector<HTMLElement>(".app-header")?.getBoundingClientRect().bottom ?? 0);
}

function selectHeading(viewport: HTMLElement, boundary: number): HTMLHeadingElement | null {
  const headings = Array.from(viewport.querySelectorAll<HTMLHeadingElement>(
    ".markdown-section > h2.markdown-checklist-heading",
  ));
  let selected = headings[0] ?? null;
  for (const heading of headings) {
    const section = heading.closest<HTMLElement>(".markdown-section");
    if (section && section.getBoundingClientRect().top <= boundary) selected = heading;
  }
  return selected;
}
```

Strip `.note-card__page-heading-source` from the mirrored class list. Round left, top, and width to hundredths of a CSS pixel and compare snapshots before updating React state.

- [x] **Step 2: Add measured lifecycle and cleanup**

Inside `PageStickyChecklistHeading`, measure immediately after layout and schedule later measurements through one animation frame:

```tsx
useLayoutEffect(() => {
  let frame = 0;
  const measure = () => {
    frame = 0;
    const card = cardRef.current;
    const viewport = viewportRef.current;
    if (!card || !viewport) return commit(null);
    const boundary = visibleContentBoundary();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.top >= boundary || cardRect.bottom <= boundary) return commit(null);
    commit(snapshotFor(selectHeading(viewport, boundary), boundary));
  };
  const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
  if (cardRef.current) observer?.observe(cardRef.current);
  if (viewportRef.current) observer?.observe(viewportRef.current);
  if (cardRef.current) mutationObserver?.observe(cardRef.current, {
    attributeFilter: ["class", "data-shelf-position", "style"],
    attributes: true,
  });
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  measure();
  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    mutationObserver?.disconnect();
    observer?.disconnect();
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    commit(null);
  };
}, [cardRef, layoutKey, viewportRef]);
```

The real implementation keeps the current snapshot in a ref so cleanup and focus restoration do not depend on a stale render closure.

- [x] **Step 3: Render and synchronize the interactive portal**

Render to `document.body` with stable React nodes. Mirror the original button's inner markup and state, delegate clicks to the source button, and transfer focus when activating, updating content, or returning to the source:

```tsx
return snapshot ? createPortal(
  <div
    className="markdown note-card__page-heading"
    data-testid="note-page-sticky-heading"
    style={{ left: snapshot.left, top: snapshot.top, width: snapshot.width }}
  >
    <h2 className={snapshot.className}>
      {snapshot.buttonClassName ? (
        <button
          aria-expanded={snapshot.ariaExpanded}
          className={snapshot.buttonClassName}
          disabled={snapshot.disabled}
          onClick={() => snapshot.source.querySelector<HTMLButtonElement>(":scope > button")?.click()}
          ref={mirrorButtonRef}
          type="button"
          dangerouslySetInnerHTML={{ __html: snapshot.contentHtml }}
        />
      ) : <span dangerouslySetInnerHTML={{ __html: snapshot.contentHtml }} />}
    </h2>
  </div>,
  document.body,
) : null;
```

Add and remove `.note-card__page-heading-source` in a layout effect keyed by `snapshot?.source`. Before hiding a focused source, focus the mirror after its portal commit. Before removing a focused mirror, record and restore its source button after the next commit.

- [x] **Step 4: Mount the component from rendered note cards**

In `ScrollableNoteCard`, create `cardRef`, merge it with the optional sortable `nodeRef`, and render the article plus portal component in a fragment:

```tsx
const cardRef = useRef<HTMLElement>(null);
const setCardRef = useCallback((element: HTMLElement | null) => {
  cardRef.current = element;
  nodeRef?.(element);
}, [nodeRef]);

return <>
  <article ref={setCardRef}>{/* existing card markup */}</article>
  <PageStickyChecklistHeading
    cardRef={cardRef}
    layoutKey={`${note.bodyMarkdown}\u0000${(note.collapsedChecklistSections ?? []).join("\u0000")}`}
    viewportRef={viewportRef}
  />
</>;
```

Do not mount it in editors or drag previews.

- [x] **Step 5: Add the fixed visual and source-hidden CSS contract**

Add next to the existing internal sticky rule:

```css
.note-card__page-heading { position: fixed; z-index: 49; box-sizing: border-box; margin: 0; background: #141518; }
.note-card__page-heading > h2 { box-sizing: border-box; width: 100%; margin: 0; padding-inline: 6px; background: #141518; }
.note-card__page-heading-source { visibility: hidden; }
```

The application header remains above the mirror at `z-index: 50`; the measured `top` places the mirror immediately below it.

- [x] **Step 6: Run the targeted tests and verify GREEN**

Run:

```bash
npm test -- tests/note-collapse.test.tsx -t "page-sticky checklist heading"
```

Expected: PASS with the portal visible at one remaining pixel, hidden at zero, switching sections, delegating collapse, exposing one accessible control, and aligning two cards independently.

### Task 3: Verify regressions, browser geometry, and the single feature commit

**Files:**

- Verify: `tests/note-collapse.test.tsx`
- Verify: `tests/markdown-tasks.test.tsx`
- Verify: `tests/note-groups.test.tsx`
- Verify: `tests/shelf-grid.test.tsx`
- Verify: `src/components/PageStickyChecklistHeading.tsx`
- Verify: `src/pages/GamePage.tsx`
- Verify: `src/styles.css`
- Verify: `AGENTS.md`
- Verify: `docs/superpowers/specs/2026-08-05-page-sticky-note-checklist-heading-design.md`
- Verify: `docs/superpowers/plans/2026-08-05-page-sticky-note-checklist-heading.md`

**Interfaces:**

- Consumes: the completed feature and its verification commands.
- Produces: one immutable Jujutsu feature commit and a fresh empty working-copy change.

- [x] **Step 1: Run related regression tests**

Run:

```bash
npm test -- tests/note-collapse.test.tsx tests/markdown-tasks.test.tsx tests/note-groups.test.tsx tests/shelf-grid.test.tsx
```

Expected: all files PASS without errors or warnings.

- [x] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite complete successfully. The pre-existing Vite chunk-size advisory may still be printed.

- [x] **Step 3: Verify real-browser geometry and interaction**

Start the Vite application and inspect a game with two note columns. Use one note containing two progress-bearing top-level sections separated by a plain top-level section and enough content for internal scrolling.

Verify:

1. No mirror exists before the card crosses below `.app-header`.
2. Once crossed, the mirror top equals the header bottom within one CSS pixel, and its left/width equal the source heading within one CSS pixel.
3. A second crossed card in another column shows an independently aligned mirror.
4. Internal and document scrolling replace the first mirror only when the second checklist section reaches the boundary; the plain section does not replace it.
5. The mirror stays fully visible with less than its height of the card remaining, then disappears when the card bottom crosses the boundary.
6. Clicking and keyboard-focusing the mirror collapse control updates the original note and preserves focus indication.
7. Scrolling back removes the mirror and restores the original heading without a layout jump.

- [x] **Step 4: Inspect the exact working-copy change**

Run:

```bash
jj status
jj diff
```

Expected: only the workflow clarification, specification, plan, component, card integration, styles, and tests for this feature are present.

- [x] **Step 5: Finalize exactly one feature commit and open a fresh change**

Run:

```bash
jj describe -m "Keep checklist headings visible across page scroll"
jj new
```

Expected: the described parent commit contains the complete feature, and the new working-copy change is empty.
