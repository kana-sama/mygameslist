# Animated Completed-Checklist Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start completed-content filtering immediately when a pending note loses activity, while visually moving hidden rows and sections into their exact owner summaries and reversing that motion on reveal.

**Architecture:** Replace the game-page debounce with a synchronous per-note snapshot refresh. Add a DOM-layout motion hook around normal `MarkdownView` output: stable data attributes identify content, owner summaries, and hierarchy; the hook compares consecutive layouts, uses inert visual replicas for exiting content, and applies FLIP/Web Animations transitions to entering and surviving content. Logical React output always reflects the newest filter state immediately, so animation never owns application truth.

**Tech Stack:** React 19, TypeScript, DOM `getBoundingClientRect`, Web Animations API, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`

## Global Constraints

- The functional delay after note activity leaves is exactly 0 ms; do not schedule a debounce or refresh timeout.
- Visual motion lasts 280 ms and begins with the same interaction or successful-save update that refreshes the snapshot.
- Rows move at full inline width, vertically into their exact `Скрыто N пунктов` owner; sections move into their exact hierarchy-owned `Скрыто N секций` owner. There is no horizontal scale and no destination point or marker.
- Reveal motion is the inverse relationship and reveals only the minimum content owned by the clicked summary.
- Visual replicas are immediately inert, `aria-hidden`, pointer-transparent, and stripped of duplicate IDs.
- `prefers-reduced-motion: reduce` skips the visual handoff.
- Tables, note editors, diff/review rendering, drag previews, authored Markdown, persistence semantics, and `data/` remain unchanged. Add no dependency.
- Follow strict TDD: each behavioral test must be observed failing for the expected reason before production code is added.
- Work only in the current mutable Jujutsu change. Do not invoke Git and do not finalize or create an intermediate commit; the controller will finalize exactly one reviewed commit for this request.

---

### Task 1: Zero-delay refresh and owner-aware Markdown motion

**Files:**
- Create: `src/components/markdownCompletedChecklistMotion.ts`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Modify: `tests/ui-acceptance.test.tsx`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`
- Create: `docs/superpowers/plans/2026-08-27-animate-completed-checklist-filter.md`

**Interfaces:**
- Produce `COMPLETED_CHECKLIST_MOTION_DURATION_MS = 280` in `markdownCompletedChecklistMotion.ts`.
- Produce `useCompletedChecklistMotion(root: RefObject<HTMLDivElement | null>, state: CompletedChecklistMotionState): void`, where `CompletedChecklistMotionState` carries `enabled`, `revision`, and stable fingerprints for the effective revealed item and section ID sets.
- Consume markup attributes on normal Markdown list items, subsection wrappers, and summary elements: `data-completed-checklist-motion-key`, `data-completed-checklist-motion-target`, and `data-completed-checklist-motion-summary`.
- Keep the existing `MarkdownView` public filtering and reveal props unchanged.

- [ ] **Step 1: Write failing game-page tests for synchronous refresh**

  Update the existing five-second cases in `tests/ui-acceptance.test.tsx` so they prove these observable contracts with real `GamePage` rendering:

  ```tsx
  fireEvent.pointerDown(screen.getByRole("checkbox", { name: "Отметить: First" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Отметить: First" }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText("First")).toBeInTheDocument();

  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("checkbox", { name: "Отметить: First" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скрыто 1 пунктов" })).toBeInTheDocument();
  ```

  Cover an ordinary task save, a connected asynchronous save that settles after departure, and a summary reveal. Assert no functional timer is created for the snapshot refresh; do not count requestAnimationFrame/Web Animation activity as a debounce. Preserve tests proving that active notes do not refresh and disabling the filter clears pending work without clearing the active-note outline.

- [ ] **Step 2: Run the focused game-page tests and verify RED**

  Run:

  ```bash
  npm test -- tests/ui-acceptance.test.tsx
  ```

  Expected: the revised zero-delay assertions fail because `GamePage` still waits 5,000 ms and still owns timeout bookkeeping.

- [ ] **Step 3: Replace timer bookkeeping with synchronous per-note refresh**

  In `InlineGamePage`, remove `completedChecklistFilterTimeouts`, timeout cancellation, page-mounted timeout guards, and `scheduleCompletedChecklistFilterRefresh`. Add one callback that validates the filter generation, active-note identity, pending membership, and known-note membership, then synchronously removes the note from pending and increments only that note's revision. Call it when activity transfers away from a pending note and when a successful asynchronous checkbox save reports after the note is already inactive. Keep pending work untouched while the note is active. Disabling the filter clears pending IDs and temporary reveal epochs through the existing generation change; unmounting requires no scheduled cleanup.

- [ ] **Step 4: Run the focused game-page tests and verify GREEN**

  Run:

  ```bash
  npm test -- tests/ui-acceptance.test.tsx
  ```

  Expected: all UI acceptance tests pass with pristine output and no 5,000 ms refresh expectation remaining.

- [ ] **Step 5: Write failing Markdown motion tests**

  In `tests/markdown-tasks.test.tsx`, install a narrow Web Animations test double that records keyframes and completes/cancels on demand while the real Markdown tree and reveal callbacks remain in use. Stub literal rectangles for two visible rows, two completed rows, a child section, a root section, and their two different summary destinations. Add separate tests that prove:

  ```ts
  expect(exitReplica).toHaveAttribute("aria-hidden", "true");
  expect(exitReplica).toHaveAttribute("inert");
  expect(exitReplica.querySelector("[id]")).toBeNull();
  expect(exitKeyframes.at(-1)?.transform).toContain(`translateY(${sectionSummaryDelta}px)`);
  expect(exitKeyframes.at(-1)?.transform).toContain("scaleY(");
  expect(exitKeyframes.at(-1)?.transform).not.toContain("scaleX(");
  ```

  Verify list rows target only their list summary, nested sections target only the nested section summary, root sections target only the root summary, surviving rows receive a FLIP translation back to zero, clicking a summary produces entering keyframes from that summary, initial mount creates no animation, a second transition cancels/removes obsolete replicas, and reduced motion creates neither replicas nor animations. Keep the existing table test and assert no motion metadata is added below `.markdown-table`.

- [ ] **Step 6: Run the focused Markdown tests and verify RED**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  ```

  Expected: the new tests fail because the renderer has no owner metadata, motion hook, exit replicas, or keyframes.

- [ ] **Step 7: Implement the DOM-layout motion hook**

  In `markdownCompletedChecklistMotion.ts`, collect only elements bearing the three motion attributes under the provided root. Cache the prior committed layout after every render. When the filter state fingerprint changes:

  - cancel old `Animation` objects and remove old replicas;
  - compare prior and current keys, ignoring a disappeared/appeared descendant when its motion-marked ancestor also disappeared/appeared;
  - clone each top-level disappeared element, strip every descendant `id`, set `aria-hidden="true"`, `inert`, and `pointer-events: none`, and absolutely position it at its prior rectangle inside the Markdown root;
  - animate the replica for exactly 280 ms from its old full-width rectangle to the current rectangle of its `data-completed-checklist-motion-target` summary with vertical translation, `scaleY`, and opacity only, then remove it on finish/cancel;
  - animate each top-level appeared element from the matching prior summary rectangle to its final rectangle with the inverse vertical/opacity relationship;
  - animate persistent marked content from its prior vertical position to its current position using FLIP so surrounding rows visibly settle rather than jump;
  - skip all visual work when `matchMedia("(prefers-reduced-motion: reduce)").matches`, when there is no previous layout, or when Web Animations is unavailable; always cache the new logical layout;
  - clean up animations and replicas on unmount.

  Use an ease-out curve for entering/settling and an ease-in-out curve for exits. Do not use a timeout for refresh or animation cleanup.

- [ ] **Step 8: Add stable owner metadata to normal Markdown output**

  In `Markdown.tsx`, attach stable list-owner IDs derived from direct item structural IDs. Mark direct list items with their own structural key and list-summary target. Extend subsection assembly entries with the section collapse ID and its parent owner ID so each subsection wrapper targets the exact summary created by its parent hierarchy. Mark summary elements with that owner ID. Do not add these attributes inside tables.

  Add a root ref and call `useCompletedChecklistMotion` using a stable fingerprint of filter enabled state, revision/snapshot, and effective revealed ID sets. Keep logical hidden nodes absent from the React tree immediately; the hook alone owns inert visual replicas. Keep the summary text, count, nesting, click behavior, and public Markdown props unchanged.

- [ ] **Step 9: Add the minimal motion-layer CSS**

  In `src/styles.css`, make only the participating `.markdown` root a positioning context and add a high-enough, pointer-transparent class for temporary replicas. Preserve the existing summary visual treatment. Do not add a dot, marker, new background, horizontal compression, or persistent decoration. Add a reduced-motion safety rule that suppresses the replica layer even if JavaScript media-query detection is unavailable.

- [ ] **Step 10: Run the focused Markdown tests and verify GREEN**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  ```

  Expected: all Markdown task tests pass with pristine output.

- [ ] **Step 11: Refactor without changing behavior and run both focused suites**

  Remove duplicated rectangle/keyframe logic, keep motion lifecycle in the new module, and keep Markdown assembly limited to semantic owner metadata. Re-run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx tests/ui-acceptance.test.tsx
  ```

  Expected: both files pass with pristine output.

- [ ] **Step 12: Verify the complete project and leave one unfinalized change for review**

  Run:

  ```bash
  npm test
  npm run build
  jj status
  jj diff --stat
  ```

  Expected: the full suite and production build pass; only this task's source, tests, spec, and plan files are changed. Do not run `jj describe` or `jj new`; the controller performs the single final commit after task and whole-change review.
