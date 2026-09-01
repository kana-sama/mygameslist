# Table Completed-Checklist Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the completed-checklist snapshot, renderer, search routing, and 280 ms motion system to hide completed Markdown table rows and wholly completed row groups while preserving column widths and Safari behavior.

**Architecture:** Give tables, row owners, and rows stable structural identities during Markdown annotation. Extend the immutable filter snapshot with row and group IDs, then render logically hidden semantic rows/groups as collapsed visibility sizing participants plus owner-specific summary rows. Extend the existing completed-filter motion hook with the semantic fixed-column table-replica handoff already proven by explicit table-group collapse, while reusing the completed filter's current duration, keyframes, and FLIP behavior.

**Tech Stack:** React 19, TypeScript, semantic HTML tables, CSS `visibility: collapse`, DOM geometry, Web Animations API, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-09-01-table-completed-checklist-filter-design.md`

## Global Constraints

- The approved companion screen is `.superpowers/brainstorm/17637-1788275631/content/table-completed-filter-summaries-v3.html`; the permanent observable contract is the spec above.
- A row is complete only when it has at least one checkbox and all its checkbox cells are checked. A group is complete only when it has at least one row and every row satisfies that rule.
- Render no per-group replacement line. Use exact copy `Скрыто N строк` for each row owner and one exact `Скрыто N групп` footer per table.
- The two summary rows have identical geometry, typography, weight, padding, and left alignment. Only the group-summary background differs: ordinary-row background versus group-heading `--surface-2`.
- Hiding, revealing, and manual group collapse must never change column widths. Hidden `tr`/`tbody` remain sizing participants through `visibility: collapse`, never `display: none`.
- Table motion lasts exactly 280 ms and retains the completed-filter transform, opacity, easing, and FLIP language. Never animate a live `tr` or `tbody` for table entry/exit; use aligned semantic `table > colgroup > tbody > tr` replicas.
- Logical hidden/accessibility state updates immediately. Replicas are inert, `aria-hidden`, pointer-transparent, and ID-free; every cancellation path restores real rows and removes temporary DOM.
- Preserve snapshot timing, note activity, manual collapse state, checklist search, reduced motion, editors, diff/review output, drag previews, authored Markdown, `data/`, persistence, and save semantics. Add no dependency.
- Follow strict TDD: observe every new behavior test fail for the expected reason before production changes, and record RED/GREEN commands in the implementation report.
- Work only in the current mutable Jujutsu change. Use `jj` exclusively for repository inspection. Do not finalize, describe, commit, or create a new change; the controller will finalize exactly one reviewed commit for this feature.

---

### Task 1: Stable table filtering, summaries, reveal routing, and Safari-safe motion

**Files:**
- Modify: `src/domain/markdownChecklist.ts`
- Modify: `src/domain/checklistSearch.ts`
- Modify: `src/components/markdownCompletedChecklistFilter.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/markdownCompletedChecklistMotion.ts`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/checklist-search.test.ts`
- Modify: `tests/notes-masonry-css.test.ts`
- Test only if an existing integration assertion needs extension: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- Extend `MarkdownTableRow` with `structuralId?: string` and give each table/section enough annotated structural identity to form stable owner and motion IDs without using rendered array indexes.
- Extend `CompletedChecklistFilterSnapshot` with `hiddenTableRowStructuralIds: ReadonlySet<string>` and `hiddenTableGroupCollapseIds: ReadonlySet<string>`; include both empty sets in `emptyCompletedChecklistFilterSnapshot()`.
- Produce generic table helpers in `markdownCompletedChecklistFilter.ts` for renderer queries: row hidden, group hidden, and owner-specific hidden row counts/IDs. Keep list and heading helpers unchanged.
- Reuse `completedChecklistRevealedItemIds` and `onRevealCompletedChecklistItems` for table row structural IDs.
- Reuse `completedChecklistRevealedSectionIds` and `onRevealCompletedChecklistSections` for table group collapse IDs.
- Extend `completedChecklistSnapshotFingerprint()` and both effective reveal fingerprints so table snapshot/reveal transitions reach `useCompletedChecklistMotion`.
- Preserve `COMPLETED_CHECKLIST_MOTION_DURATION_MS = 280` and the public `useCompletedChecklistMotion(...)` signature.

- [ ] **Step 1: Add RED parser, snapshot, rendering, and search tests**

  Add purpose-built Markdown fixtures and assertions that prove all of these contracts before production edits:

  ```ts
  const markdown = [
    "| Задача | Один | Два |",
    "| --- | --- | --- |",
    "| Complete | [x] | [x] |",
    "| Mixed | [x] | [ ] |",
    "| Partial | [-] | text |",
    "| Ordinary | text | text |",
  ].join("\n");
  ```

  With filtering enabled, assert `Complete` is logically hidden; the other three data rows remain visible; one button named exactly `Скрыто 1 строк` follows that owner; clicking it reveals only `Complete`. Add a checked single-checkbox row so both one-cell and multi-cell eligibility are covered.

  Add grouped fixtures proving a wholly checked named group hides as one unit, a group containing an ordinary row does not, and individually checked rows inside a visible mixed group hide behind that group's own row summary. Assert exactly one table-level `Скрыто N групп`, no text matching `Скрыта группа`, and this reveal sequence:

  ```ts
  fireEvent.click(screen.getByRole("button", { name: "Скрыто 2 групп" }));
  expect(screen.getByText("Completed group A")).toBeInTheDocument();
  expect(screen.getByText("Completed group B")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Скрыто \d+ строк/ })).toHaveLength(2);
  fireEvent.click(within(groupA).getByRole("button", { name: "Скрыто 2 строк" }));
  expect(within(groupA).getByText("A1")).toBeInTheDocument();
  expect(within(groupB).queryByText("B1")).not.toBeInTheDocument();
  ```

  Verify manual collapse remains independent after revealing a filtered group. Verify a fully completed table makes an otherwise checklist-only depth-two heading section hide, while a table with an ordinary/unchecked/indeterminate row keeps the heading visible.

  Parse the same target table at one revision before and after inserting unrelated prose above and an unrelated sibling row before the target. Assert the target row keeps the same `structuralId` and that the existing item-reveal channel still reveals it. In `tests/checklist-search.test.ts`, assert every table-cell search entry receives its row's `structuralItemId` while grouped entries retain their group `ancestorCollapseIds`.

- [ ] **Step 2: Run focused behavior tests and verify RED**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "completed Markdown table"
  npm test -- tests/checklist-search.test.ts -t "table"
  ```

  Expected: the new assertions fail because parsed table rows have no stable structural IDs, the snapshot excludes tables, table search entries lack row reveal IDs, and the renderer produces neither hidden table rows/groups nor summaries.

- [ ] **Step 3: Implement stable table identity and snapshot analysis**

  In `markdownChecklist.ts`, extend table annotation using the same normalized-label plus duplicate-occurrence strategy already used for lists and group collapse IDs. Build a stable table path from normalized header source values and occurrence, a stable owner path for every ungrouped section or named group, and each row path from normalized cell source values plus duplicate occurrence. Do not use source line or array index as the stable identity.

  In `markdownCompletedChecklistFilter.ts`, implement one row analysis:

  ```ts
  function tableRowCanHide(row: MarkdownTableRow): boolean {
    const taskCells = row.cells.filter((cell) => cell.taskState !== undefined);
    return taskCells.length > 0 && taskCells.every((cell) => cell.taskState === "checked");
  }
  ```

  Record every eligible row structural ID. Record a named group's existing `collapseId` only when it has rows and every row is eligible. Treat a table block as checklist-bearing and hideable for enclosing heading analysis only when it has data rows and every data row is eligible. Return ordinary/mixed tables as `canHide: false`, preserving visible section behavior.

  In `checklistSearch.ts`, pass `row.structuralId` as `structuralItemId` for every table task-cell search entry. Preserve group `ancestorCollapseIds` and existing entry IDs/guards.

- [ ] **Step 4: Render hidden table structure and owner summaries**

  In `Markdown.tsx`, derive effective table-row and table-group hidden state by subtracting the existing revealed item/section sets from the new snapshot sets. Keep hidden semantic elements mounted:

  ```tsx
  <tr className="markdown-table-row ..." hidden={rowHidden}>...</tr>
  <tbody className="markdown-table-group ..." hidden={groupHidden}>...</tbody>
  <tbody className="markdown-table-group__content" hidden={groupHidden || collapsed}>...</tbody>
  ```

  A visible ungrouped section or visible group appends a common summary-row component spanning `table.headers.length` columns. The component receives only `kind: "rows" | "groups"`, count, owner motion ID, and reveal callback. Both kinds share the same `<tr><td><button>` structure and common classes; the `groups` modifier only selects the group-heading background. Do not indent or center either kind.

  The row summary calls `onRevealCompletedChecklistItems` with exactly its owner's hidden row IDs. A single table `<tfoot>` group summary calls `onRevealCompletedChecklistSections` with exactly the direct hidden group collapse IDs. Once groups are revealed, render their row summaries while their completed rows remain logically hidden. Apply motion metadata to individual group-heading and data `tr` elements, never to `tbody`; group-owned rows target the group summary while a wholly hidden group targets the table-level group summary.

  Extend snapshot/reveal fingerprints with both table sets. Reuse the existing channels so GamePage snapshot activity and checklist-search navigation need no new state shape.

- [ ] **Step 5: Add RED CSS and animation regressions**

  In `tests/notes-masonry-css.test.ts`, load production CSS and assert filtered elements retain semantic display and collapsed visibility:

  ```ts
  expect(getComputedStyle(hiddenRow).display).toBe("table-row");
  expect(getComputedStyle(hiddenRow).visibility).toBe("collapse");
  expect(getComputedStyle(hiddenGroup).display).toBe("table-row-group");
  expect(getComputedStyle(hiddenGroup).visibility).toBe("collapse");
  ```

  Assert both summary cells/buttons have the same padding, height/min-height, text alignment, and font weight; assert the row summary has the ordinary row background and the group summary has the same background as `.markdown-table-group__heading`. Assert the manual `.markdown-table-group__content[hidden]` rule remains unchanged.

  Extend the current Web Animations harness in `tests/markdown-tasks.test.tsx` with literal table/cell rectangles. On filter hide and summary reveal, assert:

  - every animated table row is represented by an inert, ID-free `table > colgroup > tbody > tr` replica with measured `<col>` widths;
  - `Element.prototype.animate` is not called on the live entry/exit `tr` or any `tbody`;
  - the replica row's final left, top, width, and height equal the live row after insertion-time alignment, including collapsed-border half pixels;
  - the live revealed row stays a sizing participant with `visibility: hidden` until all replica tracks settle, then is restored in the same turn;
  - keyframes keep the completed filter's current vertical `translateY`, `scaleY`, opacity, easing, zero horizontal scaling, and duration `280`;
  - finish, cancel, a superseding transition, content change, and unmount restore live-row visibility and remove all replicas;
  - reduced motion and absent Web Animations create no replicas or animations and still expose the newest logical state immediately.

- [ ] **Step 6: Run focused visual/motion tests and verify RED**

  Run:

  ```bash
  npm test -- tests/notes-masonry-css.test.ts -t "completed table summary"
  npm test -- tests/markdown-tasks.test.tsx -t "completed Markdown table motion"
  ```

  Expected: the tests fail because filtered table selectors, summary styling, semantic completed-filter replicas, real-row handoff, and cleanup do not yet exist.

- [ ] **Step 7: Implement width-stable CSS and semantic table replicas**

  In `src/styles.css`, preserve the existing manual-collapse rule and add completed-filter equivalents:

  ```css
  .markdown-table-row[hidden] { display: table-row!important; visibility: collapse; }
  .markdown-table-group[hidden] { display: table-row-group!important; visibility: collapse; }
  ```

  Style a shared summary cell/button with ordinary row metrics and normal left-aligned text. Give only `.markdown-table-hidden-summary--groups` the existing group-heading `var(--surface-2)` background. Add `table-layout: fixed` to completed-filter replica tables while keeping their measured `<colgroup>` widths authoritative.

  In `markdownCompletedChecklistMotion.ts`, extend layout entries to detect a motion-marked `TR` and record its owning live table plus measured cell widths. Extract or reproduce the semantic replica-shell logic from `markdownChecklistCollapseMotion.ts` without changing explicit-collapse behavior. For table exits, animate only the replica. For table entries, leave the real row in table layout with `visibility: hidden`, insert and measure the replica, offset the temporary shell so the replica's final rectangle exactly matches the real row, animate the replica with the existing completed-filter entry keyframes, then atomically restore/remove on settlement. Central cleanup must be idempotent and run for finish, cancel, new transition, Markdown content change, filter disable, and unmount.

  Persistent surviving table rows may keep the existing completed-filter FLIP translation, but no entry/exit transform or opacity animation may run on a live `tr`/`tbody`.

- [ ] **Step 8: Run focused suites and verify GREEN**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  npm test -- tests/checklist-search.test.ts
  npm test -- tests/notes-masonry-css.test.ts
  ```

  Expected: every focused suite passes with no console errors, rejected promises, leaked animations, or stale replica DOM.

- [ ] **Step 9: Compare the implementation to the approved observable contract**

  Render fixtures at the companion's authored viewport and inspect idle, hover, focus, hide, reveal, manually collapsed, and reduced-motion states. Confirm structurally that every table has exactly one header, one table-level group summary at most, one row summary per visible owner at most, no group-name replacement, and no column-width delta before/after each transition. Compare summary alignment, typography, padding, and backgrounds directly with the approved screen and record measurements in the implementation report.

- [ ] **Step 10: Run complete verification and leave one reviewable change**

  Run:

  ```bash
  npm test
  npm run build
  jj status
  jj diff
  ```

  Expected: all tests pass, the production build succeeds, and the Jujutsu diff contains only this spec, this plan, implementation, and permanent generic tests. Leave the working-copy change unfinalized for task and final review; the controller will run verification again, use `jj describe -m "Hide completed Markdown table rows"`, and then `jj new` only after every review is clean.
