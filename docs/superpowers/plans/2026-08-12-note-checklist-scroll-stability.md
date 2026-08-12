# Affected-Note Checklist Rendering Implementation Plan

**Goal:** Save checkbox changes locally without reparsing or rerendering unchanged sibling notes.

## Task 1: Add local optimistic task rendering

- [x] Keep an optimistic task note and one in-flight note id in `GamePage`.
- [x] Persist task saves without page-wide saving, reconcile matching props, and roll back on failure.
- [x] Memoize the Markdown render body behind callback-stable public props.
- [x] Add affected-note, reconciliation, and rollback regressions in `tests/markdown-tasks.test.tsx`.
