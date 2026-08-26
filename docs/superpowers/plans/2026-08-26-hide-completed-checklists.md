# Hide Completed Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent game-page filter that hides completed Markdown list checklist items and checklist-only sections, then refreshes the filtered snapshot one minute after the last checkbox change.

**Architecture:** Keep global preference persistence in a focused state module beside the existing sidebar-layout preference. Let `InlineGamePage` own the 60-second debounce, filter generation, and monotonically increasing snapshot revision. Each normal note-card boundary owns its per-note snapshot cache across viewer/editor remounts, keyed by the generation and revision, and passes the resulting snapshot to `MarkdownView`. Put pure checklist/section snapshot analysis in a focused component helper so `Markdown.tsx` remains responsible for rendering rather than policy.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, project Markdown parser/renderer, CSS.

**Spec:** `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations; never invoke `git` directly.
- Keep specification, implementation plan, implementation, and permanent code tests in exactly one feature commit.
- Leave the working-copy change unfinalized during implementation and review. The primary agent runs `jj describe` and `jj new` only after task review, final review, and fresh verification pass.
- Follow strict TDD: add each behavioral test first, run it to observe the expected feature-missing failure, then add the minimum production code and rerun it to green.
- Store the enabled preference under exactly `mygameslist:hide-completed-checklists:v1`; disabling removes the key.
- Use exactly 60,000 ms from the last checkbox change before refreshing the filtered snapshot.
- Render the exact summary strings `Скрыто N пунктов` and `Скрыто N секций` with the approved quiet option A treatment.
- Filter Markdown list checklists only; Markdown tables remain unchanged.
- Do not change authored files under `data/`, note persistence schemas, or `collapsedChecklistSections`.
- Do not add dependencies.

---

### Task 1: Persistent completed-checklist filter

**Files:**
- Create: `src/state/completedChecklistFilterPreference.ts`
- Create: `src/components/markdownCompletedChecklistFilter.ts`
- Create: `tests/completed-checklist-filter-preference.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/Icon.tsx`
- Modify: `src/domain/markdownChecklist.ts`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- Produce `loadCompletedChecklistFilterEnabled(storage?: Pick<Storage, "getItem">): boolean` and `toggleCompletedChecklistFilterEnabled(current: boolean, storage?: Pick<Storage, "setItem" | "removeItem">): boolean`.
- Add `completedChecklistFilterEnabled?: boolean` and `onToggleCompletedChecklistFilter?: () => void` to `GamePageProps`.
- Add `completedChecklistFilterEnabled?: boolean`, `completedChecklistFilterRevision?: number`, and an optional externally owned snapshot to `MarkdownViewProps`.
- `InlineGamePage` owns a timeout ref, numeric revision, and generation invalidated by every enabled-state transition. Each normal note-card boundary caches its parsed snapshot across viewer/editor remounts; note editors, diff previews, and `NoteDragPreview` do not render with the filter.
- `markdownCompletedChecklistFilter.ts` consumes parsed `MarkdownBlock[]` and produces a stable snapshot containing parser-derived structural list-item identities safe to hide and heading `collapseId` identities for depth-two-or-greater checklist sections safe to hide. It also exposes small pure predicates/count helpers used by `Markdown.tsx`; tables are never included.

- [ ] **Step 1: Add preference tests and verify RED**

  Create `tests/completed-checklist-filter-preference.test.ts` following `tests/sidebar-layout-preference.test.ts`. Cover these hand-derived behaviors:

  ```ts
  expect(loadCompletedChecklistFilterEnabled(storageWith("enabled"))).toBe(true);
  expect(loadCompletedChecklistFilterEnabled(storageWith("unexpected"))).toBe(false);
  expect(toggleCompletedChecklistFilterEnabled(false, storage)).toBe(true);
  expect(storage.getItem("mygameslist:hide-completed-checklists:v1")).toBe("enabled");
  expect(toggleCompletedChecklistFilterEnabled(true, storage)).toBe(false);
  expect(storage.getItem("mygameslist:hide-completed-checklists:v1")).toBeNull();
  ```

  Also cover throwing reads and writes. Run:

  ```bash
  npm test -- tests/completed-checklist-filter-preference.test.ts
  ```

  Expected RED: the new state module/import does not exist.

- [ ] **Step 2: Implement the preference module and verify GREEN**

  Implement the exact storage key and `enabled` sentinel. Mirror the sidebar-layout preference's failure handling: a failed read returns `false`; failed writes still return the next in-memory boolean. Run the focused preference test and require all cases to pass with no warnings.

- [ ] **Step 3: Add Markdown rendering tests and verify RED**

  Extend `tests/markdown-tasks.test.tsx` with real `MarkdownView` fixtures that assert observable content and DOM structure:

  1. With `completedChecklistFilterEnabled`, checked flat-list items disappear; unchecked and indeterminate items stay; the list ends with `Скрыто 2 пунктов`.
  2. Rerendering the same `MarkdownView` with a newly checked source line and the same revision keeps that item visible. Incrementing `completedChecklistFilterRevision` hides it and updates the count.
  3. A checked parent with an unchecked nested task remains visible; a fully checked branch hides.
  4. Under one level-one title, two checklist-only completed depth-two sections disappear, a mixed section remains, and its parent sequence ends with `Скрыто 2 секций`.
  5. A completed section containing a paragraph stays visible while its completed list rows disappear and its item summary remains.
  6. A fully checked Markdown table remains rendered and has no filter summary.
  7. Turning the prop off renders every item and no hidden-content summaries.

  Run the narrow named tests, for example:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "completed checklist filter"
  ```

  Expected RED: completed rows and sections are still visible and the new props/summaries do not exist.

- [ ] **Step 4: Implement pure snapshot analysis and Markdown rendering, then verify GREEN**

  In `src/components/markdownCompletedChecklistFilter.ts`, implement recursive list analysis over existing `MarkdownBlock`/`MarkdownListItem` data. A checked item is hidden only when its descendant blocks contain no visible unchecked or indeterminate task and no ordinary list content that would be lost. Analyze heading ranges at depth two or greater; mark a checklist-bearing section hidden only when its snapshot has no visible checklist work and every body block is checklist structure or a nested hidden checklist section. Treat tables and every other ordinary block type as section-preserving content.

  Give parsed list items structural identities derived from their heading/list ancestry and normalized content, and use heading `collapseId`s for section identity, so insertions do not shift a stable snapshot onto unrelated source lines. At the normal note-card boundary, cache the per-note filter snapshot by filter generation and revision so replacing the viewer with the editor and cancelling does not refresh it. `MarkdownRenderBody` uses an externally owned snapshot when supplied and retains its local stable-snapshot fallback for standalone rendering. Use current blocks for displayed text and the stable structural/collapse identities from the snapshot for visibility. Append one non-interactive item-count row at the end of each affected rendered list. Extend the existing subsection stack with direct hidden-child counts and append one section-count row when each parent section closes or flushes. Preserve the level-one heading and all existing collapse/diff paths.

  Run the focused Markdown tests until green, then run all of `tests/markdown-tasks.test.tsx`.

- [ ] **Step 5: Add game-page toolbar and debounce tests and verify RED**

  Extend `tests/ui-acceptance.test.tsx`:

  - Update the existing tool-order test so an active filter button named `Показывать выполненные пункты` precedes layout and delete, has `aria-pressed="true"`, and invokes `onToggleCompletedChecklistFilter` with no arguments.
  - Add a fake-timer game-page test with a note containing two unchecked list tasks and `completedChecklistFilterEnabled`. Check the first task, assert the optimistic checked row remains visible, advance 59,999 ms, and assert it remains; advance 1 ms and assert it disappears with `Скрыто 1 пунктов`.
  - In the same behavioral test or a second focused test, check a second task before the first minute expires and prove the refresh occurs only 60,000 ms after the second checkbox change.
  - Rerender with the filter disabled before expiry and prove all rows show and advancing the old timer does not re-hide them.

  Use `fireEvent`/`act` with Vitest fake timers where appropriate so the test does not assert on timer mocks. Run:

  ```bash
  npm test -- tests/ui-acceptance.test.tsx -t "completed checklist"
  ```

  Expected RED: the toolbar control/props and delayed refresh behavior do not exist.

- [ ] **Step 6: Wire global state, toolbar, and debounce; add the icon and approved styling; verify GREEN**

  Initialize the preference once in `LibraryRoutes`, pass it through `GameRoute` to `GamePage`, and toggle it through the new state helper. In `InlineGamePage`, clear the pending timeout on disable and unmount; schedule or restart `window.setTimeout(..., 60_000)` only from successful user checkbox-state changes routed through `saveTaskNote`. Capture the current filter generation when each checkbox save starts and reject deferred completions or timer callbacks from an older generation. Increment the revision when the timer fires. Enabling is immediate because the enabled transition starts a fresh generation and rebuilds each normal card's snapshot.

  Add an `eye-off` `IconName` and path. Render the filter button before layout with exact accessible actions and `aria-pressed`. Extend the active toolbar selector to both toggles. Style `.markdown-checklist-hidden-count` and `.markdown-checklist-hidden-sections` as small muted option-A text: no border, background, icon, pill, or interactive cursor; align item counts with list text and separate section counts using the existing soft rhythm.

  Run the focused UI tests until green, then run `tests/ui-acceptance.test.tsx` completely.

- [ ] **Step 7: Refactor while green and verify the feature surface**

  Remove duplication between list/section filtering helpers without changing behavior. Confirm every new production helper is exercised by the rendering or preference tests. Run:

  ```bash
  npm test -- tests/completed-checklist-filter-preference.test.ts tests/markdown-tasks.test.tsx tests/ui-acceptance.test.tsx
  npm test
  npm run build
  ```

  Require zero failing tests, zero warnings attributable to this change, and a successful TypeScript/site build. Inspect `jj status` and `jj diff`; the change must contain only this specification, plan, implementation, styles, and permanent generic tests, with no `data/` edits and no `.superpowers/` scratch artifacts.

- [ ] **Step 8: Leave the feature unfinalized for controller reviews**

  Write the implementer report with RED/GREEN evidence for the three TDD cycles, the full test/build results, files changed, and self-review findings. Do not run `jj describe`, `jj new`, or any `git` command. The primary agent will perform task review, final review, fresh verification, and then create the single immutable feature commit.
