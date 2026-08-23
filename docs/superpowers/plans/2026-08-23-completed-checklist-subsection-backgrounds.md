# Completed Checklist Subsection Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use Jujutsu exclusively for repository operations.

**Goal:** Finalize the approved full-section green treatment for fully completed nested Markdown checklist subsections.

**Architecture:** Group rendered depth-2-and-deeper headings with their owned content using a depth stack inside `MarkdownRenderBody`, and derive a completion modifier from the heading's existing aggregate progress. Keep all shared paint and divider behavior in the global stylesheet; extend the Xenoblade theme's existing heading selectors only to preserve its pre-existing appearance under the new wrapper.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-23-completed-checklist-subsection-backgrounds-design.md`

## Global Constraints

- The approved visual state in the specification is binding: whole-section `--success-wash`, full note width, unchanged vertical rhythm, one divider, and independent double/triple nesting.
- Ordinary dividers remain `1px solid var(--line-soft)`; only adjacent completed siblings use `color-mix(in srgb, var(--line-soft) 92%, var(--text))` at `1px`.
- Shared completion and divider styling stays in `src/styles.css`; game-specific CSS must not override divider color or thickness, though it may set the shared `--markdown-content-inline-padding` compatibility property to match its note padding.
- Preserve authored Markdown, progress aggregation, checkbox behavior, collapse identifiers and behavior, source order, nested guides, heading hierarchy, and sticky note titles.
- Permanent tests use synthetic Markdown and must not encode Xenoblade identifiers, titles, counts, hierarchy, or authored content.
- Finalize exactly one Jujutsu commit containing this specification, plan, implementation, and permanent generic tests, then create a fresh working-copy change.

---

### Task 1: Finalize subsection grouping, paint, and regression coverage

**Files:**
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Modify: `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-23-completed-checklist-subsection-backgrounds-design.md`
- Include: `docs/superpowers/plans/2026-08-23-completed-checklist-subsection-backgrounds.md`

**Interfaces:**
- Consumes: `MarkdownBlock.depth`, `MarkdownBlock.checklistProgress`, existing heading completion classes, `--success-wash`, `--line-soft`, and `--markdown-content-inline-padding` matching the note content's inline padding.
- Produces: nested `.markdown-checklist-subsection` containers with `--nested` and `--complete` modifiers; no new exported runtime API.

- [x] **Step 1: Add generic wrapper-boundary regression tests**

  Render a literal synthetic document containing two completed depth-2 siblings, one incomplete depth-2 sibling, and completed/incomplete depth-3 children under an incomplete parent. Assert that each progress heading's closest `.markdown-checklist-subsection` has the correct completion modifier, sibling wrappers are siblings, and depth-3 wrappers are nested under the owning depth-2 wrapper.

  The production mutation this test catches is removing the depth stack, closing it at the wrong depth, or applying completion to only the heading rather than the owned subsection.

- [x] **Step 2: Add a live completion-update regression test**

  Render `# Root\n## Route\n- [x] Done\n- [ ] Pending` with a controlled `onTaskChange`, click `Pending`, rerender with the emitted Markdown, and assert that the same logical subsection changes from incomplete to `.markdown-checklist-subsection--complete` without changing the authored heading hierarchy.

  Run: `npm test -- tests/markdown-tasks.test.tsx`

  Expected: PASS after exercising the real renderer and checkbox update path.

- [x] **Step 3: Review and minimally refine the renderer**

  Confirm the stack closes subsections at same-or-shallower depths, flushes every open subsection before a new root section and at end of input, appends nested wrappers to their parent, and derives completion only from a finite fully checked aggregate. Refactor only if the tests expose a boundary or readability defect; do not alter parsing or persistence.

- [x] **Step 4: Review and minimally refine shared CSS**

  Keep one absolutely positioned top divider on the subsection wrapper. Preserve the heading's original border geometry with a transparent border inside wrappers, let a completed wrapper's background-only `::after` fill its existing bottom gap, and strengthen only `.markdown-checklist-subsection--complete + .markdown-checklist-subsection--complete::before`. Keep note full bleed through `--markdown-content-inline-padding`, whose global default is `6px`.

  In the Xenoblade stylesheet, retain only the wrapper selector coverage, the `12px` gap needed by its existing heading rhythm, and `--markdown-content-inline-padding` values matching its `13px` default and `10px` responsive note padding; add no divider color or thickness.

- [x] **Step 5: Run automated verification**

  Run `npm test -- tests/markdown-tasks.test.tsx`, then `npm test`, then `npm run build`. Require zero failing tests and a successful production build; the existing Vite chunk-size advisory is non-blocking.

- [x] **Step 6: Perform direct visual verification**

  Compare the real checklist note with every reference named by the specification at the approved desktop layout. Inspect expanded and collapsed completed/incomplete siblings plus depth-2/depth-3 nesting. Confirm full-width continuous green paint, unchanged spacing, one subtle divider between adjacent completed siblings, ordinary divider appearance elsewhere, and no overflow or interaction regression.

- [x] **Step 7: Review and finalize**

  Inspect `jj status` and `jj diff`, obtain task-scoped and final independent reviews with no open Critical or Important findings, rerun fresh focused tests/full tests/build, describe the working-copy change as `Highlight completed checklist subsections`, and create a fresh working-copy change with `jj new`.
