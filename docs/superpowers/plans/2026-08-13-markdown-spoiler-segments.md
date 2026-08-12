# Markdown Spoiler Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render non-empty `||text||` inline segments as independently revealable, non-persistent blurred spoilers, including inside Markdown table cells.

**Architecture:** Extend the shared inline token grammar with spoiler tokens and render them through a local-state component. Teach the shared Markdown table line scanner to skip balanced spoiler ranges so the same syntax remains inside a cell instead of becoming column delimiters.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, CSS, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Only non-empty, paired, single-line `||text||` is a spoiler; unmatched and empty pairs stay literal.
- Closed spoilers are blurred until intentionally activated by click, Enter, or Space; activation is one-way for the lifetime of that component instance.
- Each segment has independent local state, with no persistence outside React component state and a reset after unmount/remount.
- Existing inline Markdown continues to render inside spoiler content.
- Balanced spoiler pipes inside a table cell do not affect table structure.
- Existing table pipes, escaped pipes, inline code, formatting, links, diff decorations, and source positions remain compatible.
- Follow test-driven development and finish this feature as exactly one Jujutsu commit containing specification, plan, implementation, and tests.

---

### Task 1: Parse and reveal ordinary spoiler segments

**Files:**
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/markdownTableSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Test: `tests/markdown-tasks.test.tsx`
- Test: `tests/markdown-table-structure.test.ts`
- Include: `docs/superpowers/specs/2026-08-13-markdown-spoiler-segments-design.md`
- Include: `docs/superpowers/plans/2026-08-13-markdown-spoiler-segments.md`

**Interfaces:**
- Produces: an internal spoiler token in `markdownInlineTokenPattern()` and `.markdown-spoiler[data-revealed]` render states.
- Preserves: `markdownVisibleSourceRanges()` includes spoiler content but excludes its delimiters, and `scanMarkdownTableLine()` returns the same cell boundaries around a spoiler.

- [ ] **Step 1: Write failing interaction and lifecycle tests**

Add a test named with `reveals spoiler segments independently` that renders:

```tsx
const markdown = "Before ||secret **detail**|| after and ||second||";
const view = render(<MarkdownView markdown={markdown} />);
```

Assert two elements with role `button` and accessible name `Показать спойлер`, both with `data-revealed="false"`. Click the first and assert it becomes `.markdown-spoiler[data-revealed="true"]`, retains a nested `strong` containing `detail`, is no longer a reveal button, and the second remains closed. Unmount, render the same view again, and assert both spoilers are closed. Add a separate keyboard assertion that Enter reveals a closed spoiler.

The production break caught is rendering delimiters/plain text, sharing state between segments, lacking intentional keyboard activation, or persisting reveal state after unmount.

- [ ] **Step 2: Write the failing table-structure test**

In `tests/markdown-table-structure.test.ts`, parse this table and assert three source lines with two cells on the body row:

```ts
const lines = [
  "| Stage | Note |",
  "| --- | --- |",
  "| Start | ||secret|| |",
];
const table = parseMarkdownTableAtLine(lines, 2);
expect(table?.lines).toHaveLength(3);
expect(table?.lines[2].syntax.cells).toHaveLength(2);
expect(table?.lines[2].syntax.cells[1].value).toBe("||secret||");
```

Also include the same table in the component test and assert it remains one two-column table containing one closed spoiler.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx tests/markdown-table-structure.test.ts -t "spoiler"
```

Expected: FAIL because spoiler tokens and table-aware spoiler scanning do not exist.

- [ ] **Step 4: Extend the inline grammar and visible ranges**

Add a spoiler alternative matching a non-empty single-line body without `|` to `INLINE_TOKEN_SOURCE`, before emphasis alternatives. In `collectVisibleRanges`, treat `||...||` like a two-character delimiter and recursively collect only `raw.slice(2, -2)` at offset `start + 2`.

- [ ] **Step 5: Add the local-state spoiler renderer**

Create a top-level `MarkdownSpoiler` component in `Markdown.tsx` with `useState(false)`. While closed, render a focusable `<span role="button" aria-label="Показать спойлер" data-revealed="false">`; click, Enter, and Space set the state to true. Once true, render a plain `.markdown-spoiler[data-revealed="true"]` span. Stop click propagation. In `renderInline`, recognize raw `||` tokens before other two-character delimiters, recursively render their inner inline content, and preserve source-column offsets.

- [ ] **Step 6: Keep spoiler pipes inside table cells**

In `scanMarkdownTableLine`, when outside inline code and positioned at an unescaped opening `||`, find the next unescaped closing `||` with at least one non-pipe character between them. Skip that whole range before collecting table pipe indices. Leave unmatched/empty pairs to the existing pipe logic.

- [ ] **Step 7: Style closed spoilers as blur only**

Add a compact `.markdown-spoiler` rule with inherited text/font and no persistent border or background. Closed state uses `filter: blur(.25em)`, `user-select: none`, and a pointer cursor. Revealed state has no filter.

- [ ] **Step 8: Run focused tests and build**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx tests/markdown-table-structure.test.ts
npm run build
```

Expected: all tests and build pass; only the existing Vite chunk-size advisory is allowed.

- [ ] **Step 9: Finalize the feature commit**

Inspect `jj status` and `jj diff`; only this feature's docs, implementation, and tests may be present. Run `jj describe -m "Add revealable Markdown spoiler segments"`, then `jj new`.
