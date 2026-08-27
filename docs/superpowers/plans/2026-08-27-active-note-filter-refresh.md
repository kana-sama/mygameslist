# Active Note Filter Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make note activity explicit and always visible, let each hidden-content summary reveal only its own content, and refresh that note's completed-checklist snapshot five seconds after activity leaves it.

**Architecture:** `InlineGamePage` owns an active interaction-note identity plus per-note pending sets, debounce handles, and snapshot revisions. Normal note cards keep their existing snapshot cache and add epoch-scoped temporary reveal sets; `MarkdownView` reports the exact structural item or direct section identities owned by the clicked summary. The same note-level pending/refresh function handles successful checkbox saves and summary reveals, while active-note styling remains independent of the filter.

**Tech Stack:** React 19, TypeScript, Vitest fake timers, Testing Library, the project Markdown parser/renderer, CSS.

**Spec:** `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations; never invoke `git` directly.
- Keep this specification amendment, implementation plan, implementation, and permanent generic tests in exactly one feature commit.
- Leave the working-copy change unfinalized during implementation and review. The primary agent runs `jj describe` and `jj new` only after task review, final review, visual QA, and a fresh verification pass.
- Follow strict TDD: add each behavioral test first, run it to observe the expected feature-missing failure, then add the minimum production code and rerun it to green.
- The active-note identity and one-pixel accent border exist whether the completed-checklist filter is enabled or disabled.
- A note becomes active on pointer action or keyboard focus inside it and stays active until a pointer action or keyboard focus occurs outside it. Pointer movement and pointer exit alone never change activity.
- A successful checkbox save and a hidden-summary reveal use the same per-note pending refresh mechanism.
- Never start a pending note's timer while that note is active. Start or restart exactly 5,000 ms after activity leaves; cancel it when activity returns; refresh only that note when it expires.
- `Скрыто N пунктов` reveals only the direct hidden items counted by its rendered list. `Скрыто N секций` reveals only the direct hidden sibling sections counted by its owner, leaving hidden checklist items inside behind their own item summaries.
- Summary controls retain the approved quiet option A appearance and add only interaction affordances. Tables remain unchanged.
- Disabling the filter cancels filter timers and temporary reveals but does not clear active-note identity as a state transition. A click on the filter control may still clear activity because it is an ordinary pointer action outside the note.
- Do not change authored files under `data/`, note persistence schemas, or `collapsedChecklistSections`; do not add dependencies.

---

### Task 1: Active note and scoped hidden-content refresh

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`
- Create: `docs/superpowers/plans/2026-08-27-active-note-filter-refresh.md`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- Add optional `completedChecklistRevealedItemIds?: ReadonlySet<string>`, `completedChecklistRevealedSectionIds?: ReadonlySet<string>`, `onRevealCompletedChecklistItems?: (structuralIds: readonly string[]) => void`, and `onRevealCompletedChecklistSections?: (collapseIds: readonly string[]) => void` fields to `MarkdownViewProps`.
- A list summary derives its callback payload from the direct hidden `MarkdownListItem.structuralId` values in that exact rendered list. A section owner stores direct hidden heading `collapseId` values rather than only a number and passes only that owner's array.
- `InlineNoteCard` owns epoch-scoped revealed item/section sets. Its effective snapshot ignores only those identities while the current `generation:revision` epoch matches; a new epoch or disabled filter clears the visible effect without persisting anything.
- Add `interactionActive: boolean` through `InlineNoteCard`, `SortableNoteCard`, `ScrollableNoteCard`, and `PlainNoteEditor`; render `note-card--interaction-active` on the corresponding article.
- `InlineGamePage` owns `activeInteractionNoteId`, a matching ref, `Set<string>` pending note IDs, `Map<string, number>` timeout handles, and per-note numeric revisions. Its document-capture `pointerdown` and `focusin` listeners resolve `closest(".note-card[data-note-id]")` and transfer activity.
- `markCompletedChecklistFilterPending(noteId)` records both successful checkbox saves and summary reveals. `scheduleCompletedChecklistFilterRefresh(noteId)` owns the exact 5,000 ms callback and increments only that note's revision.

- [ ] **Step 1: Add scoped summary interaction tests and verify RED**

  Extend `tests/markdown-tasks.test.tsx` with behavior-level harnesses around real `MarkdownView` rendering:

  1. Render two separate lists with one hidden checked item each. Click the first `Скрыто 1 пунктов` control and assert only the first checked item appears; the second remains hidden behind its own summary.
  2. Render a visible parent with two hidden depth-three child sections plus a separate root-owned hidden depth-two section. Click the nested `Скрыто 2 секций` control and assert only those two child headings appear. Their checked rows remain hidden and are represented by their own `Скрыто 1 пунктов` controls; the root-owned section remains hidden.
  3. Assert both summary types are buttons with their exact existing visible strings and can be activated by keyboard-facing button semantics.

  Use React state in the test harness to feed the callback identities back through `completedChecklistRevealedItemIds` or `completedChecklistRevealedSectionIds`; do not assert on a callback mock. Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "reveals only"
  ```

  Expected RED: the summaries are non-interactive elements and `MarkdownViewProps` has no reveal interface.

- [ ] **Step 2: Implement minimum scoped reveal rendering and verify GREEN**

  In `MarkdownRenderBody`, treat an identity as hidden only when it exists in the stable snapshot and not in the corresponding revealed set. Replace each item summary row's text with a borderless text `<button type="button">` that calls `onRevealCompletedChecklistItems` with the direct hidden-and-not-yet-revealed structural IDs counted by that summary.

  Change each section owner accumulator from `hiddenSectionCount` to `hiddenSectionCollapseIds`. When a directly owned hidden heading is encountered, append its non-empty `collapseId`. Render the owner's summary as a text button that calls `onRevealCompletedChecklistSections` with that exact array. Revealing a parent section must not remove its list-item IDs or descendant section IDs from filtering.

  Preserve `aria-live="off"` on the quiet summary containers, exact strings, nested modifier placement, table behavior, and disabled-filter rendering. Run the focused tests from Step 1 and then:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  ```

  Require green output without warnings.

- [ ] **Step 3: Add active-note and five-second refresh tests and verify RED**

  Replace the obsolete one-minute assertions in `tests/ui-acceptance.test.tsx` with focused fake-timer tests that exercise real rendered notes:

  1. With the filter disabled, `pointerDown` inside note A gives only its article `note-card--interaction-active`; pointer movement or `pointerOut` leaves it active; `pointerDown` inside note B transfers the class; `pointerDown` outside all notes clears it.
  2. Focusing a checkbox in note A activates it, and focusing a control outside transfers activity away.
  3. With the filter enabled, check a row and successfully settle the save. Advancing beyond 5,000 ms while its note remains active keeps it visible and leaves no refresh timer running.
  4. Act outside the note, advance 4,999 ms, and assert the checked row remains. Advance 1 ms and assert it disappears. A second note's stable snapshot and hidden-summary state remain unchanged.
  5. Leave a pending note, act inside it before expiry, and assert the timer is cancelled. Leave again and prove a fresh full 5,000 ms is required.
  6. Resolve an asynchronous connected checkbox save only after leaving the note and prove its 5,000 ms timer begins on successful resolution.
  7. Click an item or section summary, assert the minimum reveal is immediate and the note active, act outside it, then prove the same 5,000 ms refresh hides the revealed scope again.
  8. Disable the filter while a timer is pending, advance time, and prove all content remains visible; active-note state is governed only by the ordinary outside interaction, not by the enabled-state change itself.

  Run:

  ```bash
  npm test -- tests/ui-acceptance.test.tsx -t "active note|completed-checklist snapshot|hidden summary"
  ```

  Expected RED: notes have no persistent activity class, checkbox saves schedule a global 60,000 ms refresh immediately, and summary text cannot reveal content.

- [ ] **Step 4: Implement active-note ownership and the shared per-note refresh mechanism; verify GREEN**

  In `InlineGamePage`, replace the single timeout and global revision with per-note timeout and revision collections. Install document-level capture listeners for `pointerdown` and `focusin`; resolve the nearest `.note-card[data-note-id]`, cancel that next note's pending timer, and schedule the previous pending note when activity transfers away. Never react to hover, pointer movement, `pointerout`, or blur without a new outside action.

  `markCompletedChecklistFilterPending(noteId)` must no-op when the filter is disabled, add the note ID when enabled, wait while the note is active, and schedule immediately when an asynchronous successful save reports after activity already left. Timer callbacks verify page mount, enabled generation, note inactivity, and note existence before incrementing only that note's revision and clearing its pending marker.

  Wire successful local and connected checkbox saves to `markCompletedChecklistFilterPending(draft.clientId)`. Wire both reveal callbacks from `InlineNoteCard` to merge epoch-scoped IDs and call that same marker. Pass the note-specific revision to each note card. On disable or page unmount clear every filter timer and pending marker; filter generation invalidates cached snapshots and temporary reveal epochs but does not mutate active-note identity.

  Pass `interactionActive` through view and editor paths. Add `note-card--interaction-active` to the article while preserving drag `activeNoteId` as a separate concept. Run the focused tests from Step 3, then all of `tests/ui-acceptance.test.tsx`.

- [ ] **Step 5: Add the approved interaction styling and verify its observable contract**

  In `src/styles.css`:

  ```css
  .note-card--interaction-active .note-card__surface { border-color: var(--accent); }
  ```

  Apply the same one-pixel accent border to the editing article without changing size, background, radius, or layout. Reset summary buttons with transparent background and no persistent border, inherit the existing 10 px muted typography, use `cursor: pointer`, and add quiet hover plus `:focus-visible` treatment without a pill or icon. Add or update a generic CSSOM assertion in `tests/ui-acceptance.test.tsx` only if the existing suite already tests production CSS rules; otherwise rely on browser visual QA rather than a source-text change detector.

  Run the Markdown and UI acceptance files together and require pristine output.

- [ ] **Step 6: Refactor while green and perform complete verification**

  Remove obsolete `60_000` timing paths, the single global timeout/revision state, and non-interactive summary assumptions. Keep the controller functions small and named by behavior; do not extract unrelated `GamePage.tsx` code.

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx tests/ui-acceptance.test.tsx
  npm test
  npm run build
  ```

  Require zero failing tests, zero warnings attributable to this change, and a successful TypeScript/site build. Inspect `jj status` and `jj diff`; the change must contain only this spec amendment, plan, implementation, CSS, and permanent generic tests, with no `data/` edits and no `.superpowers/` scratch artifacts.

- [ ] **Step 7: Leave the feature unfinalized for controller reviews**

  Write the implementer report with RED/GREEN evidence for both TDD cycles, focused/full test and build results, files changed, and self-review findings. Do not run `jj describe`, `jj new`, or any `git` command. The primary agent will perform task review, final review, real-browser visual QA against Xenoblade 2, fresh verification, and then create the single immutable Jujutsu feature commit.
