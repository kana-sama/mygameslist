# Stable ShelfGrid Offscreen Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure ShelfGrid natural heights outside the live layout so checklist expansion cannot move the focused control or the outer page during measurement.

**Architecture:** Deep-clone the grid into an inert, resource-sanitized, fixed offscreen measurement surface under the same parent and measure the clone at the live grid width. Keep every live placement untouched until the existing final placement write, preserving all current packing algorithms and public interfaces.

**Tech Stack:** React 19, TypeScript 7, CSS Grid, DOM cloning and measurement APIs, Vitest 4, Testing Library, JSDOM, Vite, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-23-shelfgrid-offscreen-measurement-design.md`

## Global Constraints

- Natural-height measurement must not reset or otherwise mutate the live grid or live card measurement styles.
- Only a temporary offscreen clone may receive natural measurement styles and `data-shelf-measuring`.
- The clone must preserve the live grid width and ancestor CSS context, be inert and `aria-hidden`, disable duplicate media resource loads, and always be removed.
- Existing packing, column-span, frozen-composition, focus, node-identity, and final-layout behavior must remain unchanged.
- Do not add scroll restoration, programmatic page scrolling, focus replacement, `overflow-anchor`, game-specific logic, or authored-data assertions.
- The attached recording is the behavioral reference; the final interaction must preserve its layout and controls while removing the outer-page jump.

---

### Task 1: Move natural-height measurement off the live grid

**Files:**
- Modify: `src/components/ShelfGrid.tsx:336-374,444-564`
- Modify: `tests/shelf-grid.test.tsx:352-395`
- Verify: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_Jn4Rbb/Screen Recording 2026-08-23 at 06.28.58.mov`

**Interfaces:**
- Consumes: the existing `resetCardLayout(card: HTMLElement): void`, `safePixels`, live grid width, direct child cards, and the existing shelf composition and placement pipeline.
- Produces: an internal offscreen measurement helper used by `measureNaturalHeights`; no exported or component-prop changes.

- [ ] **Step 1: Write the failing live-layout stability regression**

  Extend the generic natural-height coverage with a focused toggle and a second remeasurement. Establish the live card's initial `data-shelf-position`, grid row/column styles, height styles, and focused button. Change its synthetic natural height, update `aria-expanded`, and use the `getBoundingClientRect` spy to require that the measured card is not the live card and that the live values remain unchanged during the measurement callback. After the callback, require the focus to remain and the final row span to reflect the changed literal natural height.

  The production mutation that must make this test fail is measuring the live card after `resetCardLayout` and `height = "auto"` have changed its established placement.

  ```tsx
  expect(measuredCard).not.toBe(liveCard);
  expect(liveGrid).not.toHaveAttribute("data-shelf-measuring");
  expect(liveCard.dataset.shelfPosition).toBe(initialShelfPosition);
  expect(liveCard.style.gridRowStart).toBe(initialGridRowStart);
  expect(liveCard.style.gridRowEnd).toBe(initialGridRowEnd);
  expect(liveCard.style.height).toBe(initialHeight);
  expect(document.activeElement).toBe(toggle);
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  npm test -- tests/shelf-grid.test.tsx -t "measures natural card heights without resetting the live shelf"
  ```

  Expected: FAIL because the current measurement calls `getBoundingClientRect` on the live card after removing its shelf placement and setting its height to `auto`.

- [ ] **Step 3: Implement the offscreen measurement surface**

  In `ShelfGrid.tsx`, replace live measurement mutation with internal helpers equivalent to:

  ```ts
  interface ShelfMeasurement {
    cards: HTMLElement[];
    dispose: () => void;
  }

  function prepareMeasurementCard(card: HTMLElement): void {
    resetCardLayout(card);
    const noteCard = card.matches(".note-card")
      ? card
      : card.querySelector<HTMLElement>(".note-card");
    const surface = noteCard?.querySelector<HTMLElement>(".note-card__surface");
    card.style.alignSelf = "start";
    card.style.height = "auto";
    if (noteCard) noteCard.style.height = "auto";
    if (surface) surface.style.height = "auto";
  }

  function createShelfMeasurement(grid: HTMLElement, width: number): ShelfMeasurement {
    const measurementGrid = grid.cloneNode(true) as HTMLElement;
    measurementGrid.setAttribute("data-shelf-measuring", "true");
    measurementGrid.setAttribute("aria-hidden", "true");
    measurementGrid.inert = true;
    Object.assign(measurementGrid.style, {
      position: "fixed",
      top: "0px",
      left: "-100000px",
      width: `${width}px`,
      height: "auto",
      visibility: "hidden",
      pointerEvents: "none",
      gridAutoRows: "auto",
      rowGap: `${DEFAULT_ROW_GAP}px`,
      alignItems: "start",
    });
    measurementGrid.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    measurementGrid.querySelectorAll("iframe, img, audio, video, source").forEach((element) => {
      element.removeAttribute("src");
      element.removeAttribute("srcset");
      element.removeAttribute("poster");
    });
    const cards = Array.from(measurementGrid.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    cards.forEach(prepareMeasurementCard);
    (grid.parentElement ?? document.body).appendChild(measurementGrid);
    return { cards, dispose: () => measurementGrid.remove() };
  }
  ```

  `measureNaturalHeights(grid, cards, gridWidth)` must measure only the clone cards and dispose the clone in `finally`. Move the existing computed-style and grid-width reads before natural-height measurement. Delete the live grid's measuring marker, temporary natural row sizing, `resetCardLayout` pass, and live height/alignment mutations; retain the existing final placement writes without changing packing algorithms.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run:

  ```bash
  npm test -- tests/shelf-grid.test.tsx -t "measures natural card heights without resetting the live shelf"
  ```

  Expected: PASS. Confirm the test still observes a changed final row span rather than merely proving that no measurement happened.

- [ ] **Step 5: Verify existing ShelfGrid contracts**

  Run:

  ```bash
  npm test -- tests/shelf-grid.test.tsx
  ```

  Expected: PASS with natural heights, visual mutation filtering, `aria-expanded` remeasurement, column changes, packing freeze, card identity, automatic editor spans, and cleanup preserved.

- [ ] **Step 6: Verify the full application**

  Run:

  ```bash
  npm test
  npm run build
  ```

  Expected: both commands exit 0 without new warnings or errors.

- [ ] **Step 7: Compare with the behavioral reference**

  Open the local Xenoblade Chronicles 2 page at the same desktop layout as the recording. Scroll the outer page to a tall note, then expand and collapse an internal checklist heading using both pointer and keyboard. Directly compare idle, hover, focus-visible, active, expanded, and collapsed states with the recording. Require unchanged final masonry placement, unchanged controls and sticky layers, stable focus, and no outer-page jump.

- [ ] **Step 8: Inspect and finalize exactly one Jujutsu commit**

  Run `jj status` and `jj diff` in the isolated workspace. The change must contain only the approved specification, this plan, `ShelfGrid.tsx`, and the generic ShelfGrid regression. Describe it with:

  ```bash
  jj describe -m "Measure shelf cards without live reflow"
  jj new
  ```

  Do not use Git commands and do not include database-specific tests or unrelated files.
