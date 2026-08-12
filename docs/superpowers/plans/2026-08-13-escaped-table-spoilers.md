# Escaped Table Spoilers Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep escaped `\|\|literal\|\|` text literal inside Markdown tables instead of activating spoiler behavior.

**Architecture:** Preserve each parsed table cell's raw inline source alongside its existing decoded value. Render from raw inline source using an escape token that displays `\|` as `|`; spoiler recognition therefore sees escaped delimiters as interrupted while all existing table logic can continue using decoded values.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, Jujutsu

## Global Constraints

- Use Jujutsu exclusively for repository status, diff, history, and commit operations.
- Escaped table `\|\|text\|\|` is literal and never a spoiler, including in a checked task cell.
- Unescaped `||text||` in table cells remains a spoiler.
- `\|` displays as `|` without becoming a cell boundary.
- Preserve source columns, table structure, checkbox updates, grouped tables, inline code, and diff rendering.
- Follow TDD and finish exactly one descendant Jujutsu commit containing this specification, plan, implementation, and tests.

---

### Task 1: Preserve escaped-pipe provenance through table rendering

**Files:**
- Modify: `src/domain/markdownChecklist.ts`
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Test: `tests/markdown-tasks.test.tsx`
- Test: `tests/markdown-table-syntax.test.ts` or `tests/markdown-table-structure.test.ts`
- Include: `docs/superpowers/specs/2026-08-13-escaped-table-spoilers-design.md`
- Include: `docs/superpowers/plans/2026-08-13-escaped-table-spoilers.md`

**Interfaces:**
- Add optional raw inline source to `MarkdownTableCell`, populated from `MarkdownTableSyntaxCell.sourceText` after removing the same task prefix as `value`.
- The renderer uses raw inline source for headers, group titles, ordinary cells, and task cells; decoded `value` remains available for progress, display labels, and diff evidence.
- The inline token grammar recognizes escaped `\|` as a literal-pipe token before spoiler syntax.

- [ ] **Step 1: Write failing regressions**

Render one two-column table containing an ordinary `\|\|literal\|\|` cell, a checked `[x] \|\|checked literal\|\|` cell, and an unescaped `||real spoiler||` cell. Assert the table retains two columns; both escaped values render as literal `||...||` with no enclosing `.markdown-spoiler`; only the real spoiler has the `Показать спойлер` reveal role. The checked escaped cell must not be force-revealed as a spoiler.

Add or extend a syntax/structure test to confirm `sourceText` keeps the backslashes while decoded `value` remains `||literal||` and the body has the original column count.

- [ ] **Step 2: Verify RED**

Run the new tests before production edits. Expected: FAIL because decoded table values currently reach spoiler matching without escape provenance.

- [ ] **Step 3: Preserve raw table inline source**

Add an optional `sourceValue` (or equivalently named raw-source field) to `MarkdownTableCell`. Populate it for headers, group titles, and row cells from `ParsedTableCell.sourceText`. For task cells, remove the task marker and separator from both decoded `value` and raw `sourceValue`, keeping `sourceColumn` unchanged from the existing post-marker calculation.

- [ ] **Step 4: Render escaped pipe tokens literally**

Add an escaped-pipe alternative before spoiler syntax in the shared inline token pattern. Its render branch outputs `|` while consuming both source characters, without enabling spoiler matching. Keep inline code on its current branch so code content is not unescaped. Preserve decoration/source offsets when rendering the two-character escape.

- [ ] **Step 5: Use raw inline source at table render boundaries**

Use `cell.sourceValue ?? cell.value` for inline rendering and `markdownIsSingleSpoiler` decisions in headers, group titles, ordinary cells, and task cells. Keep existing decoded `cell.value` uses for progress, row evidence, and non-rendering labels.

- [ ] **Step 6: Verify and finalize**

Run the focused table/Markdown tests and `npm run build`. Inspect `jj status` and `jj diff`, then run `jj describe -m "Preserve escaped spoiler text in tables"` and `jj new`.
