# Note scroll layout stability implementation plan

**Goal:** Prevent visual note-scroll state from causing a full ShelfGrid
remeasurement and moving the outer page.

**Architecture:** Keep the existing MutationObserver and layout behavior. Add a
narrow classification rule to `mutationRequiresShelfLayout`: class changes are
ignored only when the target itself is `.note-card__viewport-frame` and every
changed class is one of the three visual scroll-affordance classes. All other
mutations retain their current behavior.

## Task 1: Add the regression and fix the classifier

**Files:**

- Modify: `tests/shelf-grid.test.tsx`
- Modify: `src/components/ShelfGrid.tsx`

1. Extend the generic visual-mutations fixture with a note viewport frame.
2. Change the scroll-affordance classes and flush queued animation frames.
3. Assert card measurement occurs before the production fix (RED).
4. Add the exact target-and-class allowlist to
   `mutationRequiresShelfLayout`.
5. Assert affordance-only changes do not measure, while an unrelated class on
   the same frame does measure (GREEN).
6. Preserve and run existing card-class and `aria-expanded` assertions.
7. Run the focused ShelfGrid test file.

## Task 2: Verify the complete behavior

1. Run the complete test suite.
2. Run the production build.
3. Inspect the final diff for exact scope.
4. Verify in the browser that the first inner-scroll affordance transition does
   not change the page scroll position.
5. Review the implementation against the design specification.
