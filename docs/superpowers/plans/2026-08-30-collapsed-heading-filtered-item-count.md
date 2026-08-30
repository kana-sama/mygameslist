# Filter-Aware Collapsed Heading Item Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make collapsed checklist headings report only non-checked checklist rows while the completed-item filter is enabled.

**Architecture:** Keep the existing heading progress model and renderer structure. Add a filter-mode branch at the source of the collapsed-caption count, using the already-aggregated `ChecklistProgress` values, while preserving the current child-heading/fallback calculation when the filter is off.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-30-collapsed-heading-filtered-item-count-design.md`

## Global Constraints

- `N = progress.total - progress.checked` only when `completedChecklistFilterEnabled` is true.
- Both `[ ]` and `[-]` count as remaining; only `[x]` is excluded.
- Progress text, filtering snapshots, reveal behavior, collapse persistence, motion, styles, and authored data remain unchanged.
- The filter-disabled calculation remains exactly as it is today.
- The completed feature is finalized as exactly one Jujutsu commit containing this specification, this plan, implementation, and regression test; do not create intermediate commits.

---

### Task 1: Make the collapsed caption filter-aware

**Files:**
- Modify: `tests/markdown-tasks.test.tsx:1746-1863`
- Modify: `src/components/Markdown.tsx:699-709`
- Verify: `docs/superpowers/specs/2026-08-30-collapsed-heading-filtered-item-count-design.md`
- Verify: `docs/superpowers/plans/2026-08-30-collapsed-heading-filtered-item-count.md`

**Interfaces:**
- Consumes: `completedChecklistFilterEnabled: boolean` and `ChecklistProgress { checked: number; open: boolean; total: number }` already available inside `MarkdownRenderBody`.
- Produces: the existing `collapsedHeadingItemCount(headingIndex, headingDepth, progress): number`, with a filter-aware result and no public API changes.

- [ ] **Step 1: Write the failing component regression**

Add a focused test beside `renders collapsed heading state as a sibling without changing heading rhythm`. Use a controlled `collapsedChecklistSections` rerender and this Markdown:

```tsx
const markdown = [
  "# Root",
  "## Hello",
  "- [ ] a",
  "- [-] b",
  "- [x] c",
].join("\n");
```

Collapse `Hello`, assert its accessible heading name remains `Hello Выполнено 1 из 3`, and assert the sibling caption is `Свернуто · 3 пунктов внутри`. Rerender the same collapsed section with `completedChecklistFilterEnabled`, assert `c` is filtered while `a` and `b` remain, assert the heading still says `Hello Выполнено 1 из 3`, and assert the caption becomes `Свернуто · 2 пунктов внутри`.

- [ ] **Step 2: Run the regression to prove the current behavior fails**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "counts only non-checked rows inside a collapsed heading when completed items are hidden"
```

Expected: FAIL because the filtered rerender still reports `Свернуто · 3 пунктов внутри`.

- [ ] **Step 3: Implement the minimal source fix**

At the beginning of `collapsedHeadingItemCount`, branch on the existing render prop:

```ts
if (completedChecklistFilterEnabled) return progress.total - progress.checked;
```

Leave the existing immediate-child-heading loop and `childHeadingCount || progress.total` return unchanged for filter-disabled rendering.

- [ ] **Step 4: Run focused and file-level verification**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "counts only non-checked rows inside a collapsed heading when completed items are hidden"
npm test -- tests/markdown-tasks.test.tsx
```

Expected: both commands PASS.

- [ ] **Step 5: Run repository verification**

Run:

```bash
npm test
npm run build
```

Expected: the full suite and production build PASS with no new warnings or errors.

- [ ] **Step 6: Review and finalize one feature commit**

Inspect only task-related changes with:

```bash
jj status
jj diff
```

After implementer and reviewer approval, the coordinating agent runs:

```bash
jj describe -m "Count remaining items in collapsed filtered checklists"
jj new
```

Do not amend, squash, rebase, abandon, or otherwise rewrite any existing commit.
