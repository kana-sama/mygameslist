# Indent Hidden Section Summaries Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each `Скрыто N секций` summary visually occupy the heading depth of the hidden child sections it represents.

**Architecture:** Keep the existing stack-based section ownership and counts unchanged. Mark summaries emitted while closing a visible subsection as nested, then style that modifier with the same inline inset and guide geometry used by nested checklist headings; title-owned summaries retain the base style.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, existing Markdown renderer.

**Spec:** `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`

## Global Constraints

- A summary for hidden direct child sections is rendered inside its existing owning subsection and visually aligned with that subsection's child-heading level.
- A summary for hidden depth-two sections owned directly by the note title remains at the outer content level.
- The nested summary uses the established nested heading geometry: `.5em` inline-start margin, `.95em` inline-start padding, and a `1px solid var(--line-soft)` inline-start guide.
- Keep the exact text `Скрыто N секций`, counts, heading ownership, filtering decisions, list-item summaries, collapse behavior, snapshot timing, toolbar behavior, and persistence unchanged.
- Do not change authored files under `data/`, Markdown tables, or dependencies.
- Permanent tests use a generic fixture and do not encode Xenoblade 2 identifiers or authored-data counts.
- Use Jujutsu exclusively. Keep this specification correction, plan, implementation, and tests in one unfinalized change until all reviews and fresh verification pass.

---

### Task 1: Preserve hidden-section summary depth visually

**References:**
- User screenshot: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_8mhW6r/Screenshot 2026-08-26 at 16.06.32.png`
- Authored reproduction (read-only): `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/quests_b799c929-ef7f-4afb-accc-238a29fe44d6.md`
- Structural invariant: in `Quests`, the title-owned `Скрыто 6 секций` stays at the note level, while the `Скрыто 2 секций` owned by `Blade-Related Quests` aligns with its depth-three `Chapter …` child headings.

**Files:**
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Already modified by the controller: `docs/superpowers/specs/2026-08-26-hide-completed-checklists-design.md`
- Already created by the controller: `docs/superpowers/plans/2026-08-26-indent-hidden-section-summaries-fix.md`

**Interfaces:**
- Keep `CompletedChecklistFilterSnapshot`, every `MarkdownView` prop, summary copy, and section-counting data unchanged.
- Add the private presentation class `markdown-checklist-hidden-sections--nested` only to summaries appended by `closeSubsection`; summaries appended by `flushSection` keep only `markdown-checklist-hidden-sections`.

- [ ] **Step 1: Add generic regression coverage and verify RED**

  Add a focused test under `describe("completed checklist filter")` using this literal Markdown fixture:

  ```md
  # Root
  ## Finished root section
  - [x] Root finished
  ## Visible parent
  - [ ] Parent work
  ### Finished child one
  - [x] Child one finished
  ### Finished child two
  - [x] Child two finished
  ### Visible child
  - [ ] Child work
  ```

  Assert observable structure:

  - `Finished root section`, `Finished child one`, and `Finished child two` are absent.
  - `Visible parent` and `Visible child` remain.
  - The direct `Скрыто 1 секций` child of `.markdown-section` lacks `markdown-checklist-hidden-sections--nested` and is the section's last child.
  - The direct `Скрыто 2 секций` child of the `Visible parent` `.markdown-checklist-subsection` has `markdown-checklist-hidden-sections--nested` and is that subsection's last child.

  Name the production mutation the test catches: removing the nested modifier from subsection-owned summaries makes both ownership levels render with the same presentation class.

  Extend the existing production-stylesheet acceptance test to require `.markdown-checklist-hidden-sections--nested` with `box-sizing: border-box`, `margin-inline-start: .5em`, `padding-inline-start: .95em`, and `border-inline-start: 1px solid var(--line-soft)`.

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "nests hidden section summaries|completed subsection paint"
  ```

  Expected RED: the subsection-owned summary lacks the nested modifier and the stylesheet rule is absent.

- [ ] **Step 2: Add the minimal presentation distinction and verify GREEN**

  In `closeSubsection`, render the existing summary with both classes:

  ```tsx
  className="markdown-checklist-hidden-sections markdown-checklist-hidden-sections--nested"
  ```

  Do not alter the title-owned summary in `flushSection`. Immediately after the existing base summary rule in `src/styles.css`, add:

  ```css
  .markdown-checklist-hidden-sections--nested { box-sizing: border-box; margin-inline-start: .5em; padding-inline-start: .95em; border-inline-start: 1px solid var(--line-soft); }
  ```

  Run the named test until GREEN, then:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx
  ```

- [ ] **Step 3: Verify the affected surface and report**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx tests/ui-acceptance.test.tsx
  npm test
  npm run build
  ```

  On the actual Xenoblade 2 `Quests` note with the filter enabled, compare against the cited screenshot and inspect both DOM ancestry and rendered horizontal positions. Confirm `Скрыто 2 секций` is a direct child of the `Blade-Related Quests` subsection and is inset to the child-heading level, while `Скрыто 6 секций` is a direct child of the note-title `.markdown-section` and remains at the outer level. Also confirm the summary copy and counts are unchanged.

  Inspect `jj status` and `jj diff`. Write the report with RED/GREEN evidence, full verification results, files changed, actual-note DOM/layout evidence, and self-review. Do not run `jj describe`, `jj new`, or any git command; leave the fix unfinalized for controller reviews.
