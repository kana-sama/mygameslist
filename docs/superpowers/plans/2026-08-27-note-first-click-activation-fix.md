# Note First-Click Activation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the first checkbox or hidden-content-summary click after leaving all notes activates the target note before the action's filtering logic runs.

**Architecture:** Extend the existing document-capture activity router with `click` as a fallback while retaining `pointerdown` and `focusin` for their current pointer, drag, and keyboard semantics. Exercise the real `GamePage` flow with click-only regression tests so removing the fallback recreates both reported failures.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-note-first-click-activation-fix-design.md`

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations; never invoke `git` directly.
- Keep this specification, implementation plan, implementation, and permanent generic tests in exactly one feature commit.
- The implementation subagent must leave the working-copy change unfinalized. The primary agent runs `jj describe` and `jj new` only after review and fresh verification.
- Follow strict TDD: add the regression tests first, run them against the pre-fix implementation, and record the expected behavioral failures before changing production code.
- The actionable regression click must be one `fireEvent.click(...)`; do not manually dispatch `pointerDown` or `focusIn` before that click.
- Preserve `pointerdown` activation, `focusin` activation, synchronous note-only refresh on departure, filtering semantics, persistence, motion, active-note styling, authored data, and dependencies.

---

### Task 1: Cover and fix first-click note activation

**Files:**
- Modify: `tests/ui-acceptance.test.tsx`
- Modify: `src/pages/GamePage.tsx`

**Interfaces:**
- Consume the existing `transferActivity(event: Event)` function inside `InlineGamePage`.
- Add no new exported API.
- Produce one additional document-capture event route: `click` invokes `transferActivity` and is removed during effect cleanup.

- [ ] **Step 1: Add the checkbox regression test**

  Add a `GamePage` test whose name contains `uses the first click after leaving notes`. Render one unchecked list item with the completed-checklist filter enabled and a real stateful connected `noteInteractionSource` harness; retain `onSave` only as the required component prop because checkbox persistence uses the connected interaction source. Activate its note, dispatch `pointerDown` on an outside button to clear activity, then dispatch only `fireEvent.click` on the checkbox. After the connected save settles, assert that the checked row remains visible and then that the note has `note-card--interaction-active`. This test catches removal of the fallback because the pre-fix pending refresh immediately hides the row.

- [ ] **Step 2: Add the hidden-summary regression test**

  In the same focused group, render one checked list item with the filter enabled. Activate its note, clear activity through an outside `pointerDown`, and dispatch only `fireEvent.click` on `Скрыто 1 пунктов`. Assert that the note becomes interaction-active and `Finished` is visible after the first click. This test catches removal of the fallback because the pre-fix refresh advances the note epoch and discards the reveal.

- [ ] **Step 3: Run the focused tests and verify RED**

  Run:

  ```bash
  npm test -- tests/ui-acceptance.test.tsx -t "uses the first click after leaving notes"
  ```

  Expected: both new tests fail for the behavior they name: the checkbox row is absent or the note is not active, and the summary reveal is absent or the note is not active. Test setup, selectors, or runtime errors do not count as RED.

- [ ] **Step 4: Add the minimum capture fallback**

  In the existing activity-transfer effect in `src/pages/GamePage.tsx`, register and clean up the same callback alongside the existing listeners:

  ```ts
  document.addEventListener("click", transferActivity, true);
  // existing pointerdown and focusin listeners remain

  return () => {
    document.removeEventListener("click", transferActivity, true);
    // existing pointerdown and focusin cleanup remains
  };
  ```

  Do not add timers, new state, per-control handlers, or filtering changes.

- [ ] **Step 5: Verify GREEN and regression safety**

  Run:

  ```bash
  npm test -- tests/ui-acceptance.test.tsx -t "uses the first click after leaving notes"
  npm test -- tests/ui-acceptance.test.tsx
  npm test
  npm run build
  ```

  Require every command to exit successfully with pristine output.

- [ ] **Step 6: Self-review without finalizing the change**

  Inspect `jj status` and `jj diff`. Confirm only the two planned code/test files plus this specification and plan changed, the actionable test clicks have no preparatory `pointerDown` or `focusIn`, both listeners are registered with capture and cleaned up symmetrically, and no authored data changed. Write the TDD evidence and self-review to the assigned report file; do not run `jj describe` or `jj new`.
