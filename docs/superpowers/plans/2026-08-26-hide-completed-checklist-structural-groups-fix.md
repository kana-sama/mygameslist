# Hide Completed Checklist Structural Groups Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide completed checklist sections whose task rows are nested under ordinary list-item group labels, while preserving genuine ordinary list content.

**Architecture:** Extend the pure recursive checklist analysis in `markdownCompletedChecklistFilter.ts`. A non-task list item becomes hideable only when it owns at least one checklist descendant and every child block is a recursively hideable list; rendering and persistence interfaces remain unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing Markdown parser and renderer.

**Spec:** `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`

## Global Constraints

- A non-task list item is a structural checklist-group label only when it has at least one checklist descendant and every child block is recursively checklist-only.
- A fully completed structural group hides as one direct list item; existing direct hidden-item count semantics remain unchanged.
- An ordinary leaf list item, a non-task item without checklist descendants, and a list item with any ordinary descendant content remain visible and keep their section visible.
- Completed depth-two-or-greater sections containing only hideable checklist structures, including structural group labels, hide and contribute to the existing direct hidden-section summary.
- Checked ancestors with incomplete or indeterminate descendants remain visible.
- Markdown tables, authored files under `data/`, persistence, collapse state, snapshot timing, toolbar behavior, and styling remain unchanged.
- Permanent tests use generic fixtures and do not encode Xenoblade 2 identifiers or authored-data counts.
- Use Jujutsu exclusively. Keep this specification correction, plan, implementation, and tests in one unfinalized change until all reviews and fresh verification pass.

---

### Task 1: Recognize structural checklist-group labels

**References:**
- User screenshot: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_4G1Ds2/Screenshot 2026-08-26 at 15.52.00.png`
- Authored reproduction (read-only): `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/shop-deeds_6ce41b9c-4587-4748-bbe7-3cdf28feceeb.md`
- Structural invariant: completed heading aggregates such as `Torigoth 52/52` use ordinary store-label list items whose children are checked tasks; the completed heading and its entire checklist-only section must disappear when the filter is active.

**Files:**
- Modify: `src/components/markdownCompletedChecklistFilter.ts`
- Modify: `tests/markdown-tasks.test.tsx`
- Already modified by the controller: `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`
- Already created by the controller: `docs/superpowers/plans/2026-08-26-hide-completed-checklist-structural-groups-fix.md`

**Interfaces:**
- Keep the existing `CompletedChecklistFilterSnapshot` interface and renderer props unchanged.
- Refine the internal recursive result so analysis can distinguish “fully hideable checklist structure” from “ordinary content” and know whether a branch contains a checklist.

- [ ] **Step 1: Add a generic regression test and verify RED**

  Add one focused `MarkdownView` test under `describe("completed checklist filter")`. Use a hand-authored generic fixture with:

  ```md
  # Shop checklist
  ## Complete city
  - Store one
    - [x] Deed one
    - [x] Deed two
  - Store two
    - [x] Deed three
  ## Mixed city
  - Complete store
    - [x] Finished
  - Open store
    - [x] Finished prerequisite
    - [ ] Remaining
  ## Reference city
  - Ordinary reference
  - [x] Finished row
  ```

  Assert observable rendering:

  - `Complete city`, both store labels, and their completed descendants are absent.
  - The note-title section ends with exactly `Скрыто 1 секций`.
  - `Mixed city` stays visible; `Complete store` is absent; `Open store` and `Remaining` stay visible.
  - `Reference city` and `Ordinary reference` stay visible while `Finished row` is hidden.

  Name the production mutation the test catches: restoring `item.taskState === "checked"` as the only hideable-item condition makes `Complete city` and completed structural groups reappear.

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "hides completed structural checklist groups"
  ```

  Expected RED: `Complete city` and its ordinary group labels remain rendered because the current analyzer treats every non-task list item as ordinary content.

- [ ] **Step 2: Implement the minimal recursive classification and verify GREEN**

  Refactor the private list-analysis helpers to return both:

  ```ts
  interface ChecklistHideAnalysis {
    canHide: boolean;
    containsChecklist: boolean;
  }
  ```

  For a task item, `canHide` remains true only for a checked item whose child blocks are all hideable checklist structure. For a non-task item, `canHide` is true only when every child block is hideable and the descendants contain at least one checklist. Add the structural ID of every hideable task item or structural group label to the snapshot. Non-list blocks, empty child collections, ordinary leaf items, and mixed-content descendants return `canHide: false`.

  Reuse the same analysis from section classification; do not add renderer special cases or change count semantics.

  Run the named test until GREEN, then:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  ```

- [ ] **Step 3: Verify the affected surface and report**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx tests/ui-acceptance.test.tsx
  npm test
  npm run build
  ```

  Use a one-off read-only diagnostic against `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/shop-deeds_6ce41b9c-4587-4748-bbe7-3cdf28feceeb.md` to confirm the parsed completed sections `Torigoth`, `Garfont Village`, and `Fonsa Myma` are in `hiddenSectionCollapseIds`; do not add or modify any `data/` file and do not commit a data-specific test or script.

  Inspect `jj status` and `jj diff`. Write the report with RED/GREEN evidence, full verification results, files changed, the diagnostic result, and self-review. Do not run `jj describe`, `jj new`, or any git command; leave the fix unfinalized for controller reviews.
