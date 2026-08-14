# Markdown Hover Hint Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow persisted Markdown hover hints while preserving unsafe-link rejection.

**Architecture:** Update `validateMarkdown` to remove exact no-URL hover-hint tokens before scanning the remaining Markdown for link destinations. Cover the public `validateLibrary` boundary with one focused regression test.

**Tech Stack:** TypeScript 7, Vitest 4, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- `[text]("description")` must pass Markdown validation without being interpreted as a URL.
- Real Markdown links must retain the existing `isSafeLink` validation and unsafe schemes must remain rejected.
- Do not change rendering, UI state, persistence formats, or unrelated validation rules.
- Follow TDD and finalize exactly one descendant Jujutsu commit containing this specification, plan, implementation, and regression test.

---

### Task 1: Exclude hover hints from URL validation

**Files:**
- Modify: `src/domain/validation.ts`
- Test: `tests/domain-core.test.ts`
- Include: `docs/superpowers/specs/2026-08-14-markdown-hover-hint-validation-design.md`
- Include: `docs/superpowers/plans/2026-08-14-markdown-hover-hint-validation.md`

**Interfaces:**
- Consumes: `validateMarkdown(value: string): string[]` and `validateLibrary(value: unknown)`.
- Produces: hover-hint-aware Markdown validation without changing the function signatures.

- [ ] **Step 1: Add the failing regression test**

In the existing `library validation` describe block, add one test that builds a valid game and note whose `bodyMarkdown` is `[hello]("Plain *description*")`, asserts `validateLibrary(database).ok` is `true`, then changes the body to `[hello](javascript:alert(1))` and asserts a `bodyMarkdown` issue remains.

- [ ] **Step 2: Verify RED**

Run `npm test -- tests/domain-core.test.ts -t "accepts Markdown hover hints"` and confirm failure because the quoted description is reported as an unsafe link.

- [ ] **Step 3: Implement the minimal validator fix**

In `validateMarkdown`, strip exact one-line hover-hint tokens from `withoutCode` before applying the existing HTML/autolink/link checks. Match the same grammar as the renderer: a non-empty label without `]` or newline and a quoted description without quote or newline. Do not alter `linkPattern` or `isSafeLink`.

- [ ] **Step 4: Verify GREEN**

Run the focused test, then `npm test -- tests/domain-core.test.ts tests/markdown-tasks.test.tsx`. Both commands must pass.

- [ ] **Step 5: Finalize**

Inspect `jj status` and `jj diff`, describe the change as `Allow Markdown hover hints in validation`, then run `jj new`.
