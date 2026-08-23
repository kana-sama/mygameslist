# Collapsed Checklist Heading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chevron treatment with the approved option D state text and identical expanded/collapsed heading rhythm.

**Architecture:** Derive the visible inside count from the existing parsed block sequence without changing the parser. Render the state as a sibling of the semantic heading, then scope layout parity to Markdown heading/list CSS and preserve the sticky-title duplicate with an invisible inner placeholder.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-23-collapsed-checklist-heading-state-design.md`

## Global Constraints

- Match option D and the cited desired screenshots exactly: separate sibling state text, inherited body typography, no chevron, no state-specific `h3` margin change.
- Preserve existing hierarchy, progress, completion colors, focus, sticky title behavior, collapse persistence, and authored data.
- Use Jujutsu exclusively and finalize exactly one descendant feature commit.
- The user's explicit fast-path request permits inline execution; all verification and audit requirements still apply.

---

### Task 1: Render and verify the collapsed state treatment

**Files:**
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/note-collapse.test.tsx`
- Create: `docs/superpowers/specs/2026-08-23-collapsed-checklist-heading-state-design.md`
- Create: `docs/superpowers/plans/2026-08-23-collapsed-checklist-heading-state.md`

**Interfaces:**
- Consumes: `MarkdownBlock.depth`, `ChecklistProgress.total`, controlled collapsed section IDs, and the existing sticky first-heading portal.
- Produces: `.markdown-checklist-heading__collapsed-state` as a sibling of the heading; no new runtime API or persisted state.

- [x] **Step 1: Implement the approved renderer structure**

  Count immediate child progress headings until the next heading at the same or shallower depth, falling back to `progress.total`. Render the interactive heading button without an icon, then render the muted state block after the semantic heading only while collapsed. Render an invisible inner placeholder for the sticky duplicate.

- [x] **Step 2: Match the approved CSS rhythm**

  Remove the option B compact `h3` override and chevron rules. Let the state inherit Markdown typography with `margin: -.25em 0 .5em`; continue nested inset/guide geometry and give expanded `h4 + ul/ol` content `.5em` block-end margin.

- [x] **Step 3: Replace obsolete tests with the regression contract**

  Use real `MarkdownView`, controlled collapse state, synthetic headings at three depths, and injected production CSS. Assert sibling placement and text, direct-child and fallback counts, unchanged accessible names, no icon, invariant heading margin, nested guide/inset, and equal trailing margins.

- [x] **Step 4: Prove the test detects the regression**

  Run the focused test with the implementation present, temporarily remove state rendering, require the focused test to fail because the state sibling is absent, restore production code, and require the focused test to pass.

- [x] **Step 5: Verify and audit**

  Run the focused Markdown/note-collapse tests, `npm test -- --exclude '.superpowers/**'`, and `npm run build`. Inspect `jj status` and `jj diff`; audit the renderer, CSS, test, spec, and plan against option D and all user corrections. Resolve all Critical and Important findings. The explicit exclusion prevents Vitest from discovering unrelated stale repository copies under `.superpowers/workspaces`.

- [x] **Step 6: Finalize**

  Mark the plan complete, run fresh focused/full/build verification, describe the change as `Show collapsed checklist heading state`, create a new empty working-copy change with `jj new`, and confirm the working copy is clean.
