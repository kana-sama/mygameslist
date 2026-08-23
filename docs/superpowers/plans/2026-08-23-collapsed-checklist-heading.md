# Collapsed Checklist Heading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use Jujutsu exclusively for repository operations.

**Goal:** Implement the approved compact collapsed-heading rhythm and disclosure chevron for interactive Markdown checklist headings.

**Architecture:** Reuse the existing `Icon` component and `aria-expanded` state already emitted by `MarkdownView`. Add the icon only inside interactive progress-heading buttons, then scope stateful transform and compact group rhythm to existing heading classes; no parser or persistence changes are required.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-23-collapsed-checklist-heading-design.md`

## Global Constraints

- Match option B in `/Users/kana/.codex/visualizations/2026/08/22/01a02b9e-c447-7b32-9e2a-326d9f0da552/collapsed-heading-options.html` and the exact values in the specification.
- Preserve root/subsection hierarchy, group separator, progress alignment, completion color, focus, sticky duplicate, collapse persistence, source order, and authored data.
- Plain headings, non-interactive progress headings, and nested list-group controls receive no heading chevron.
- Add no text, ellipsis, preview, background, badge, or hierarchy color.
- Finalize exactly one Jujutsu feature commit containing this specification, plan, implementation, and permanent generic test, then create a fresh working-copy change.

---

### Task 1: Render and style the compact disclosure state

**Files:**
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-23-collapsed-checklist-heading-design.md`
- Include: `docs/superpowers/plans/2026-08-23-collapsed-checklist-heading.md`

**Interfaces:**
- Consumes: existing `Icon` name `chevron-down`, `collapsed` state, `aria-expanded`, `markdown-checklist-heading--collapsed`, and controlled collapse callback.
- Produces: one `.markdown-checklist-heading__chevron` inside each interactive progress-heading button; CSS rotation from `aria-expanded`; compact collapsed `h3` rhythm; no new runtime API.

- [x] **Step 1: Write the failing behavior and computed-style test**

  Inject `productionStyles`, render synthetic Markdown containing an interactive root, an interactive `## Group`, a nested checklist group, and a plain heading, and drive the controlled collapse callback. Assert that the heading button owns exactly one `.markdown-checklist-heading__chevron` whose SVG is `aria-hidden`, the accessible name is unchanged, nested list-group and plain-heading elements own no heading chevron, and the expanded group begins without the compact collapsed class.

- [x] **Step 2: Run the focused test and verify RED**

  Run `npm test -- tests/markdown-tasks.test.tsx`. Require the new test to fail because the heading chevron is absent before any production edit; fix test setup errors until the failure expresses that missing behavior.

- [x] **Step 3: Add the minimal renderer and CSS implementation**

  Render `<Icon className="markdown-checklist-heading__chevron" name="chevron-down" size={13} />` before `progressChildren` only in the interactive progress-heading button. Style it as a non-shrinking icon with a `120ms` transform; rotate it `-90deg` only under `[aria-expanded="false"]`. Add `.markdown h3.markdown-checklist-heading--collapsed { margin-block-start: .45em; padding-block: .45em; }` after the expanded `h3` rule.

- [x] **Step 4: Complete GREEN assertions and run automated verification**

  After collapsing the synthetic group, assert `aria-expanded="false"`, one rotated chevron, `.markdown-checklist-heading--collapsed`, smaller computed block-start margin and padding than the captured expanded values, and positive block-end padding. Run `npm test -- tests/markdown-tasks.test.tsx`, `npm test`, and `npm run build`; require clean exit codes.

- [x] **Step 5: Perform direct reference verification**

  Compare the real Xenoblade `Quests` checklist with the approved option B and cited screenshot at exactly `736px` and `360px`. Inspect complete/incomplete and expanded/collapsed rows in idle, hover, and focus states plus the sticky root duplicate. Confirm one right/down chevron, compact collapsed group rhythm, unchanged expanded hierarchy, at least `6px` between title and count, and no horizontal overflow.

- [x] **Step 6: Review and finalize**

  Inspect `jj status` and `jj diff`, include only the specification, plan, renderer, CSS, and generic test, complete the task review and final review with no open Critical or Important findings, run fresh verification, describe the working-copy change as `Indicate collapsed checklist headings`, and create a fresh change with `jj new`.
