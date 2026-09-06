# Checkbox-only table centering implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. One implementation task; the coordinator performs review and finalizes one commit using Jujutsu.

**Goal:** Remove the empty description element that offsets a table checkbox when checklist search is enabled.

**Architecture:** Keep search identity on the existing table-task container. Render a text span and its `aria-describedby` reference only when the cell has text. Preserve the existing accessible name and CSS centering.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Vite.

**Spec:** `docs/superpowers/specs/2026-09-06-checkbox-only-table-centering-design.md`

## Global constraints

- Jujutsu only; do not commit from the implementer. Do not touch unrelated working-copy changes.
- No CSS compensation, new dependencies, authored-data edits, or data-specific permanent tests.
- Search target identity, structural guard, highlight and checkbox state interactions remain intact.

### Task 1: Remove empty table-task descriptions

**Files:**
- Modify: `src/components/Markdown.tsx`
- Test: `tests/markdown-tasks.test.tsx`

**Interfaces:** `MarkdownView` already receives `checklistSearchNoteIdentity`, `highlightedChecklistSearchTargetId`, and `onTaskCheckboxChange`. The table-task wrapper owns `data-checklist-search-target-id`; its checkbox uses `aria-label` for its accessible name.

- [x] Add a parameterized synthetic-table regression for `[ ]`, `[x]`, `[-]` with search identity present and absent. Find the `.markdown-table-task--only` container and check:

```tsx
expect(target.children).toHaveLength(1);
expect(target.firstElementChild?.tagName).toBe("LABEL");
expect(target.querySelector("span")).toBeNull();
expect(within(target).getByRole("checkbox")).not.toHaveAttribute("aria-describedby");
```

- [x] Update the existing marker-only search markup assertion to require no `aria-describedby`, and verify its accessible row/column name. Keep text-bearing list and table descriptions valid; assert the table description element contains `Table target`. Verify marker-only identity, guard, highlight and a checkbox callback survive.
- [x] Run `npm test -- tests/markdown-tasks.test.tsx -t 'checklist search target markup'` and record the expected regression failure before editing production code.
- [x] In the table checkbox only, change `aria-describedby={checklistSearchTargetId}` to `aria-describedby={cell.value ? checklistSearchTargetId : undefined}`. Change the cell-content conditional's empty branch from `checklistSearchTargetId ? <span id={checklistSearchTargetId} /> : null` to `null`. Do not modify list behavior or CSS.
- [x] Run the focused markup tests, then `npm test -- tests/markdown-tasks.test.tsx tests/markdown-diff-preview.test.tsx tests/page-checklist-search.test.tsx` (resolve the actual existing search test filename if different), and `npm run build`.
- [x] Coordinator checks browser DOM and actual center coordinates using a temporary synthetic fixture and existing production CSS, then removes the fixture. Compare unchecked, checked and indeterminate states, with/without search identity and hover/focus. Request independent review of the scoped diff against the spec.
- [x] Inspect `jj status` and `jj diff`; finalize only this fix's spec, plan, implementation and permanent tests as one commit. In a shared working copy containing unrelated live work, use a path-scoped `jj split` to create the completed commit and retain the unrelated changes in its fresh working-copy descendant; avoid finalizing another task's work.

## Verification results

- Regression observed before production edits: 4 focused failures (extra child and empty description reference).
- Focused search markup tests pass; 4 related suites, 256 tests pass.
- `npm run build` passes (TypeScript and production build); existing bundle-size advisory remains.
- Browser: all 12 synthetic combinations (three states, with/without search, 560/300 px containers) have one child and center error below 0.004 CSS px. Mouse/Space toggles, hover and focus preserve centering. Temporary fixture removed.
- Independent review: approved, no actionable findings.
