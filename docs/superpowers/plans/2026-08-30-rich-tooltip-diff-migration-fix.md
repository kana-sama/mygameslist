# Rich Tooltip Diff Migration Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a legacy hover-tooltip converted to the title-anchored rich-tooltip syntax as one yellow modified row without exposing `[?]` in rendered diff mode.

**Architecture:** Keep the exact source diff unchanged, but let structural line pairing trust a unique list item's equal rendered-text identity when hidden tooltip metadata changes. The rendered diff recognizes the legacy-to-rich transition as a safe visually equivalent modification, renders the rich reference label with triggers disabled, and leaves the exact legacy/rich syntax available in source mode.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`

## Global Constraints

- A same-label legacy `[Label]("description")` to rich `[Label][?]` checklist migration is one yellow `Изменено` row in rendered mode.
- A simultaneous checkbox-state transition stays in that yellow row and renders both disabled before/after states.
- Rendered mode shows only the rendered label and never literal `[?]` service syntax.
- Rich-tooltip triggers in diff preview are disabled; the diff must not open a tooltip.
- Source mode remains exact red/green source evidence, including terminal definitions.
- Ordinary link-target-only changes keep their existing red/green rendered fallback.
- Pairing must remain ambiguity-safe: only unique list items with equal structural visible identity bypass raw-source similarity.
- Permanent tests use synthetic labels and bodies, never authored `data/` records.
- This fix ends as exactly one Jujutsu commit containing the specification, this plan, implementation, and tests.

---

### Task 1: Pair and render tooltip syntax migration semantically

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`
- Modify: `src/domain/markdownDiff.ts`
- Modify: `src/components/markdownInlineSyntax.ts` only if a shared visible-text or migration predicate is required
- Modify: `src/components/markdownDiffRenderModel.ts`
- Modify: `src/components/MarkdownDiffPreview.tsx`
- Modify: `tests/markdown-diff.test.ts`
- Modify: `tests/markdown-diff-preview.test.tsx`

**Interfaces:**
- Preserves: `createMarkdownDiff(before, after): MarkdownDiffModel` exact source lines and source-mode evidence.
- Produces: a paired `modified` list-item fragment when unique equal rendered labels differ only through legacy/rich tooltip metadata.
- Produces: one rendered `modified` side whose Markdown hides `[?]` and whose rich-tooltip interactions are disabled.

- [ ] **Step 1: Write the failing domain pairing test**

Use the synthetic fixture:

```ts
const before = '- [x] [Archive Entry]("Old plain tooltip body")';
const after = '- [x] [Archive Entry][?]';
const model = createMarkdownDiff(before, after);
```

Assert that the removed and added physical lines share one `pairId`, and that the hunk contains one `modified` list-item fragment rather than separate removed/added fragments. The production mutation this catches is restoring the raw-source `0.72` threshold as the only pairing route for a unique same-label list item.

- [ ] **Step 2: Write the failing rendered-preview test**

Render the fixture through `MarkdownDiffPreview`. Assert exactly one group named `Изменено`, no `Удалено` or `Добавлено` rendered groups, visible `Archive Entry`, no literal `[?]`, and no rich-tooltip button. Toggle to source mode and assert the exact legacy line is removed and the exact rich line is added. Keep the existing ordinary-link-target fallback test green.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-diff.test.ts tests/markdown-diff-preview.test.tsx
```

Expected: the new domain test lacks a pair or modified fragment, and the preview test finds separate red/green rows with literal rich-tooltip syntax.

- [ ] **Step 4: Implement the smallest semantic pairing change**

In `safeToPair`, keep all parent/type/ambiguity checks. For `listItem`, allow a raw-similarity bypass only when both structural keys are non-null and equal and both occurrence counts are unique; do not relax headings, tables, ambiguous duplicates, or unrelated source lines.

- [ ] **Step 5: Implement the visually equivalent migration path**

Project legacy and rich tooltip tokens to their rendered labels when deciding whether the paired list-item content is visually equivalent. For this exact transition, allow `mergedFragmentSide` to emit a modified row even with no inline text or task-state delta; when the checkbox state also changes, preserve its paired disabled before/after controls inside the same yellow row. Enable rich-tooltip label rendering in `MarkdownDiffPreview`, disable its triggers, and ensure hidden syntax does not become an inline decoration. Do not generalize the yellow single-row path to ordinary link URL changes.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all selected tests pass with no React warnings.

- [ ] **Step 7: Run feature verification**

Run:

```bash
npx vitest run tests/markdown-diff.test.ts tests/markdown-diff-preview.test.tsx tests/markdown-rich-tooltip-ui.test.tsx tests/ui-acceptance.test.tsx
npx tsc -b --pretty false
```

Expected: all tests pass and TypeScript exits zero.

- [ ] **Step 8: Review and finalize one fix commit**

Inspect `jj status` and `jj diff`; include only this specification, plan, implementation, and generic tests. Finalize with:

```bash
jj describe -m "Render tooltip migrations as one diff row"
jj new
```
