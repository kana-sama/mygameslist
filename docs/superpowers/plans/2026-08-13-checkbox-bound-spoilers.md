# Checkbox-Bound Spoilers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically reveal spoiler-only Markdown task labels while their list or table checkbox is checked, without persisting reveal state.

**Architecture:** Add one shared predicate for spoiler-only source and thread a `forceRevealed` flag through the existing inline renderer. List and table task renderers enable the flag only for checked tasks whose complete label matches the predicate; `MarkdownSpoiler` combines it with its existing local click state.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Automatic reveal applies only when the complete trimmed task label is one non-empty `||text||` segment.
- Support both list tasks `- [ ] ||text||` and table cells `[ ] ||text||`.
- A checked matching task is never blurred; an unchecked matching task remains click-revealable.
- A force-revealed spoiler that was not explicitly clicked becomes closed again if its checkbox becomes unchecked.
- Explicit local reveal remains until component unmount; no spoiler reveal state is persisted.
- Mixed labels such as `Prefix ||text||` keep ordinary spoiler behavior even when the task is checked.
- Preserve existing checkbox source updates, inline formatting, table structure, task editing, diff rendering, and ordinary spoiler behavior.
- Follow test-driven development and finish this feature as exactly one Jujutsu commit containing specification, plan, implementation, and tests.

---

### Task 1: Bind spoiler visibility to list and table task state

**Files:**
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Test: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-13-checkbox-bound-spoilers-design.md`
- Include: `docs/superpowers/plans/2026-08-13-checkbox-bound-spoilers.md`

**Interfaces:**
- Produces: `markdownIsSingleSpoiler(source: string): boolean` and internal `forceRevealed` propagation through `renderInline`/`locatedInline`/`locatedLines` to `MarkdownSpoiler`.
- Consumes: existing `MarkdownListItem.taskChecked`, `MarkdownTableCell.taskChecked`, and source updates through `onTaskChange`.

- [ ] **Step 1: Write the failing list-task test**

Render an initially unchecked `- [ ] ||hidden list||` with an `onTaskChange` callback that rerenders using the returned Markdown. Assert its spoiler is closed, click the checkbox, and assert the callback receives `- [x] ||hidden list||` and the spoiler becomes `data-revealed="true"` with no reveal-button role. Click the checkbox again and assert the rerendered spoiler is closed because it had not been explicitly clicked.

Separately click the closed spoiler before checking and assert it reveals while its checkbox remains unchecked. Render `- [x] ||already done||` and assert it starts revealed. Render `- [x] Prefix ||ordinary||` and assert `ordinary` remains a closed reveal button.

- [ ] **Step 2: Write the failing table-task test**

Render:

```tsx
let markdown = [
  "| Stage | Secret |",
  "| --- | --- |",
  "| Start | [ ] ||hidden table|| |",
  "| Finish | [x] ||already done table|| |",
].join("\n");
```

Use the same controlled rerender callback. Assert the first spoiler starts closed and the second starts revealed. Click the first row's checkbox, assert the exact source changes to `[x]`, and assert both become revealed. Uncheck it and assert the first becomes closed again.

The production break caught by these tests is failing either supported Markdown form, revealing mixed text, persisting a force-only reveal after uncheck, or mutating checkbox source incorrectly.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "checkbox-bound spoilers"
```

Expected: FAIL because checked task state is not passed to spoiler rendering.

- [ ] **Step 4: Add the shared spoiler-only predicate**

Export from `markdownInlineSyntax.ts`:

```ts
export function markdownIsSingleSpoiler(source: string): boolean {
  return /^\|\|[^|\n]+\|\|$/.test(source.trim());
}
```

- [ ] **Step 5: Add forced reveal without changing local state**

Give `MarkdownSpoiler` a boolean `forceRevealed` prop defaulting to false. Its visible branch becomes `if (revealed || forceRevealed)`, but the `revealed` state is never set merely because the prop is true.

Add an optional `forceRevealSpoilers = false` argument to `renderInline`; pass it through recursive strong/emphasis/link/spoiler calls. Add the equivalent final argument to `locatedInline` and `locatedLines`.

- [ ] **Step 6: Enable the flag only for matching checked tasks**

For list task content, call `locatedLines` with `Boolean(item.taskChecked && markdownIsSingleSpoiler(item.value))`. For table task cell content, call `locatedInline` with `Boolean(cell.taskChecked && markdownIsSingleSpoiler(cell.value))`. Do not enable it for ordinary paragraphs, headings, non-task cells, or mixed task labels.

- [ ] **Step 7: Run focused tests and build**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx
npm run build
```

Expected: all tests and build pass; only the existing Vite chunk-size advisory is allowed.

- [ ] **Step 8: Finalize the feature commit**

Inspect `jj status` and `jj diff`; only this feature's docs, implementation, and tests may be present. Run `jj describe -m "Reveal checked task spoilers automatically"`, then `jj new`.
