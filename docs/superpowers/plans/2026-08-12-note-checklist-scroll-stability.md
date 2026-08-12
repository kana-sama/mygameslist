# Affected-Note Checklist Rendering Implementation Plan

**Goal:** Save checkbox changes locally without reparsing or rerendering unchanged sibling notes.

## Task 1: Add local optimistic task rendering

- [x] Keep an optimistic task note and one in-flight note id in `GamePage`.
- [x] Persist task saves without page-wide saving, reconcile matching props, and roll back on failure.
- [x] Memoize the Markdown render body behind callback-stable public props.
- [x] Add affected-note, reconciliation, and rollback regressions in `tests/markdown-tasks.test.tsx`.

## Task 2: Filter non-geometric shelf mutations

- [x] Classify observed mutations in `ShelfGrid` before scheduling layout.
- [x] Ignore sticky-source, checklist completion, and progress counter mutations.
- [x] Retain remeasurement for collapse and genuine height-changing mutations with shelf regressions.

## Task 3: Keep checklist-click DOM and saves stable

- [x] Keep checklist edit/Add, drag, edit, and card actions mounted during the task lock.
- [x] Guard non-task metadata, cover, progress, delete, note edit/add/reorder actions until reconciliation while sibling checkboxes remain available.
- [x] Add whole-grid DOM identity, focus/scroll, rollback, race, and UI focus regressions.
