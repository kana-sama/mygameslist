# Closed Spoiler Accessibility Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent closed spoilers from exposing or activating hidden inline content through links and task-control accessible names.

**Architecture:** Render a text-only, accessibility-hidden snapshot in the closed spoiler branch and restore original React children only after reveal. Generate task-control labels from raw Markdown with unrevealed spoiler bodies replaced by a generic phrase.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, Jujutsu

## Global Constraints

- Use Jujutsu exclusively for repository status, diff, history, and commit operations.
- Closed spoilers contain no live interactive descendants and expose only `Показать спойлер` to assistive technology.
- Revealed spoilers restore original links and inline formatting.
- Click, Enter, and Space reveal one-way for the component lifetime.
- Closed task spoiler bodies never appear in checkbox/edit accessible names; use `скрытый спойлер`.
- Checked exact checkbox-bound spoilers are already visible, so their accessible labels may use visible text without delimiters.
- Mixed labels redact only spoiler bodies; escaped literal delimiters remain literal.
- Preserve local reveal/check/uncheck behavior, task source updates, diff rendering, and ordinary Markdown.
- Follow TDD and finish exactly one descendant Jujutsu commit containing this specification, plan, implementation, and tests.

---

### Task 1: Make closed spoiler content inert and redact task labels

**Files:**
- Modify: `src/components/Markdown.tsx`
- Test: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-13-closed-spoiler-accessibility-design.md`
- Include: `docs/superpowers/plans/2026-08-13-closed-spoiler-accessibility.md`

**Interfaces:**
- Add a private React-node-to-text helper for the closed visual snapshot.
- Add a private task-label helper accepting raw source and whether its spoiler-only content is currently force-revealed.

- [ ] **Step 1: Write failing hidden-content tests**

Render `||[guide](https://example.com)||`. While closed, assert the spoiler reveal role exists, contains no element with link role, and the hidden word is absent from accessible names. Reveal it and assert the external link with name `guide` exists and retains its href.

Render unchecked list and table task spoilers with editing/change enabled. Assert their checkbox and edit controls use `скрытый спойлер`, and no control accessible name contains the secret. Cover a checked exact bound spoiler (visible text allowed), checked mixed text (secret redacted), and checked escaped table literal (literal pipes/text, not generic spoiler).

- [ ] **Step 2: Write missing interaction regressions**

Extend spoiler coverage so Space reveals. Assert `||||` and an unmatched `||text` remain literal without reveal roles. In the controlled list-task test, explicitly reveal while unchecked, check and uncheck the task, and assert the spoiler remains revealed until unmount.

- [ ] **Step 3: Verify RED**

Run the new focused tests before production edits. Expected: failures show a live nested link and raw secret text in control names; added valid edge cases may already pass.

- [ ] **Step 4: Render only text while closed**

Add a small recursive helper using React `Children`/`isValidElement` (or an equivalent safe traversal) to concatenate string/number descendants. The closed `MarkdownSpoiler` branch renders only that text inside an `aria-hidden="true"` child of the focusable reveal span. It must not render original elements. The revealed/forced branch continues to render the original children unchanged.

- [ ] **Step 5: Generate spoiler-safe task labels**

Add a helper that replaces each real `||body||` with either `body` when explicitly allowed for a checked exact bound spoiler, or `скрытый спойлер` otherwise; then call `markdownLabel` and decode literal `\|` for readable labels. Because table callers pass `cell.sourceValue ?? cell.value`, escaped pairs do not match the real-spoiler expression.

For list items, compute the exact force-reveal boolean once and use the safe label for checkbox, editor input, and edit-button labels. For table task cells, compute force reveal from raw inline source and use safe labels for the task cell and any row/column fallback that could contain spoilers.

- [ ] **Step 6: Verify and finalize**

Run `npm test -- tests/markdown-tasks.test.tsx`, all relevant Markdown/table suites, and `npm run build`. Inspect `jj status`/`jj diff`, run `jj describe -m "Hide closed spoiler content from controls"`, then `jj new`.
