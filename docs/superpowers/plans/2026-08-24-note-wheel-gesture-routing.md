# Note Wheel Gesture Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new wheel gesture scroll the page from anywhere over a note only when that note was already at the requested boundary before the gesture began.

**Architecture:** A small DOM-event helper owns per-note gesture state and installs a non-passive wheel listener. `ScrollableNoteCard` owns the helper lifecycle, while native scrolling continues to move the note for note-routed gestures.

**Tech Stack:** React 19, TypeScript 7, DOM WheelEvent APIs, Vitest, Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-08-24-note-wheel-gesture-routing-design.md`

## Global Constraints

- A relevant vertical wheel gesture ends after 160 ms without relevant vertical wheel input.
- Boundary comparisons use a 1 px tolerance.
- A gesture that starts away from the requested note boundary stays routed to the note for its entire lifetime.
- A gesture that starts at the requested note boundary routes to the page with `behavior: "instant"`.
- `ctrlKey`, zero vertical deltas, and horizontal-dominant input remain untouched.
- Existing `overscroll-behavior: none` remains unchanged.
- Follow TDD: reset the live-preview implementation to an inert exported installer, add the regression tests, observe the expected assertion failures, then implement the behavior afresh.
- Keep specification, plan, implementation, and permanent tests in one feature commit finalized only after review and browser verification.

---

### Task 1: Implement and integrate note wheel gesture routing

**Files:**
- Create: `src/components/noteWheelGesture.ts`
- Modify: `src/pages/GamePage.tsx:39,967-971`
- Create: `tests/note-wheel-gesture.test.tsx`

**Interfaces:**
- Consumes: an `HTMLElement` whose `scrollTop`, `scrollHeight`, and `clientHeight` describe the note viewport.
- Produces: `installNoteWheelGestureRouting(viewport: HTMLElement): () => void`, where the return value removes the listener and clears the pending timer.

- [ ] **Step 1: Reset the live-preview implementation without removing its public API**

Keep `src/components/noteWheelGesture.ts` importable, but temporarily make `installNoteWheelGestureRouting` return an inert cleanup callback. Leave the React installation effect in place so the red test exercises the production integration point.

```ts
export function installNoteWheelGestureRouting(_viewport: HTMLElement): () => void {
  return () => undefined;
}
```

- [ ] **Step 2: Write regression tests for the approved routing contract**

Create `tests/note-wheel-gesture.test.tsx` using the repository's real `GamePage`, the existing Monaco editor mock, fake timers, controlled `scrollHeight`/`clientHeight` getters, and a spy for `document.scrollingElement.scrollBy`. Dispatch real cancelable `WheelEvent` objects and cover these independent breaks:

```ts
it("routes a new downward gesture to the page when the note already starts at the bottom", () => {
  viewport.scrollTop = 200;
  const event = dispatchVerticalWheel(viewport, 60);
  expect(event.defaultPrevented).toBe(true);
  expect(pageScrollBy).toHaveBeenCalledWith({ top: 60, behavior: "instant" });
});

it("keeps a gesture in the note after that gesture reaches the bottom", () => {
  viewport.scrollTop = 120;
  dispatchVerticalWheel(viewport, 240);
  viewport.scrollTop = 200;
  dispatchVerticalWheel(viewport, 40);
  expect(pageScrollBy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(161);
  dispatchVerticalWheel(viewport, 40);
  expect(pageScrollBy).toHaveBeenCalledOnce();
});
```

Add the mirrored top case, non-scrollable note routing, line/page delta normalization, ignored `ctrlKey` and horizontal-dominant input, and cleanup after unmount. Expected values must be literal or hand-derived; do not call production helpers to compute them.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/note-wheel-gesture.test.tsx
```

Expected: assertion failures because the inert installer neither prevents page-routed wheel events nor calls the page scroller. Fix test setup errors until failures are behavioral.

- [ ] **Step 4: Implement the minimal gesture state machine**

Implement one destination lock and one reset timer per viewport. Normalize line deltas with the document root line height (fallback 16 px), page deltas with the viewport height, and pixel deltas unchanged. For page routing, prevent the default when cancelable and call the scrolling element or window fallback with an instant scroll:

```ts
const top = normalizeDelta(event);
const scrollingElement = document.scrollingElement;
if (scrollingElement) scrollingElement.scrollBy({ top, behavior: "instant" });
else window.scrollBy({ top, behavior: "instant" });
```

Install the handler with `{ passive: false }`; cleanup removes it and clears the pending timer.

- [ ] **Step 5: Run focused and full automated verification**

Run:

```bash
npm test -- tests/note-wheel-gesture.test.tsx
npm test
npm run build
```

Expected: all tests pass, the build exits successfully, and the only accepted build noise is the repository's existing Vite chunk-size warning.

- [ ] **Step 6: Self-review and hand off for independent review**

Inspect `jj status` and `jj diff`. Confirm only the spec, plan, helper, React integration, and regression test belong to this feature change; do not finalize the commit yet. Record RED/GREEN commands and outputs in the task report for the reviewer.

- [ ] **Step 7: Browser acceptance and final Jujutsu commit**

On the local Xenoblade Chronicles 2 page, use real wheel input over a long note to verify: reaching the bottom during a gesture leaves page Y unchanged; a new downward gesture at the bottom changes page Y immediately while note `scrollTop` remains fixed; repeat the mirror sequence at the top. After review findings are resolved, run fresh full tests and build, inspect `jj status` and `jj diff`, describe the feature change, and create a fresh working-copy change with `jj new`.
