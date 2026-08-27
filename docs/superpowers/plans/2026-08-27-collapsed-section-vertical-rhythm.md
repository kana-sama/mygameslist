# Collapsed Section Vertical Rhythm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hidden-section summary spacing independent of section paint state and balance collapsed root subsection height without changing expanded or nested rhythm.

**Architecture:** Keep the current Markdown DOM and express geometry through structural CSS. Adjacency selectors reserve the hierarchy-specific full-area gap before hidden-section summaries; a collapsed-root-only rule shortens the root reserve and offsets the pre-existing inter-section margin by the same amount.

**Tech Stack:** CSS, existing React rendered fixtures, Vitest, Vite, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-27-collapsed-section-vertical-rhythm-design.md`

## Global Constraints

- Do not change Markdown DOM, hide/reveal logic, focus, animation, text, counts, tables, checklist-item summaries, or `data/`.
- Summary spacing is structural and paint-state independent.
- The neutral gap after a complete section area is exactly 8 px.
- Root collapsed reserve becomes `1em`; nested reserve remains `.5em`; expanded root reserve remains `1.674em`.
- No summary top padding, background mask, transform, relative offset, or increased upper inset.
- Keep verification proportional to this small CSS fix and finalize exactly one Jujutsu commit.

---

### Task 1: Structural summary spacing and balanced collapsed root rhythm

**Files:**
- Modify: `src/styles.css`
- Modify: `tests/markdown-tasks.test.tsx`
- Create: `docs/superpowers/specs/2026-08-27-collapsed-section-vertical-rhythm-design.md`
- Create: `docs/superpowers/plans/2026-08-27-collapsed-section-vertical-rhythm.md`

**Interfaces:**
- Preserve the existing `.markdown-checklist-subsection`, `.markdown-checklist-heading--collapsed`, `.markdown-checklist-hidden-sections`, and `.markdown-checklist-hidden-sections--nested` markup contracts.
- Preserve `--markdown-checklist-subsection-gap` as the paint-reserve input used by complete and indeterminate `::after` washes.

- [x] **Step 1: Implement the structural CSS correction**

  In `src/styles.css`, remove the four selectors that combine `--complete` or `--indeterminate` with hidden-section summaries.

  Add a root structural adjacency rule equivalent to:

  ```css
  .markdown-checklist-subsection + .markdown-checklist-hidden-sections {
    margin-top: calc(20.088px + 8px);
  }
  ```

  Use the absolute 20.088 px reserve because `em` in this declaration would resolve against the summary's 10 px font, while the subsection reserve is `1.674em` at the Markdown content's 12 px font.

  Add a later, more specific nested adjacency rule equivalent to:

  ```css
  .markdown-checklist-subsection > .markdown-checklist-subsection + .markdown-checklist-hidden-sections--nested {
    margin-top: calc(6px + 8px);
  }
  ```

  Keep the existing base `.markdown-checklist-hidden-sections { margin: 8px 0 0; }` so all-hidden sequences do not gain a phantom reserve.

  Add a collapsed-root rule scoped to a direct collapsed `h3`:

  ```css
  .markdown-checklist-subsection:has(> h3.markdown-checklist-heading--collapsed) {
    --markdown-checklist-subsection-gap: 1em;
    margin-block-end: calc(1em - 1.674em);
  }
  ```

  This shortens the complete/indeterminate wash through the existing custom property and subtracts the same `.674em` from the following collapsed margin. Do not add a nested override: nested sections already use `.5em` and do not match the direct `h3` selector.

- [x] **Step 2: Update the existing regressions to the structural behavior**

  In `tests/markdown-tasks.test.tsx`, replace `separates root and nested hidden-section summaries from painted subsections` with fixtures that render the production stylesheet and inspect the actual summary elements. For root and nested summaries preceded by unpainted, complete, and indeterminate visible subsections, assert identical computed `margin-top`: `28.088px` for root and `14px` for nested. Assert `padding-top: 0px`. Add all-hidden-at-level fixtures whose summary has no preceding subsection and therefore retains `8px`.

  The production mutation these expectations catch is removal of the structural adjacency rule or reintroduction of a paint-state branch.

  Extend the rendered collapsed-heading regression with unpainted, complete, and indeterminate root subsections. After collapsing them, assert each subsection computes `--markdown-checklist-subsection-gap: 1em` and the same negative block-end compensation `calc(1em - 1.674em)`. Assert the heading's pre-collapse and post-collapse `margin-block-start` and `padding-block-start` are unchanged.

  Assert an expanded root subsection still computes reserve `1.674em` with no negative block-end compensation. Assert a nested collapsed subsection still computes reserve `.5em` and no root compensation. These expectations catch accidental movement of the upper inset, changes to expanded sections, and application of the root correction at the nested level.

- [x] **Step 3: Run focused and complete Markdown verification**

  Run:

  ```bash
  npm test -- tests/markdown-tasks.test.tsx -t "spaces hidden-section summaries structurally|balances collapsed root subsection rhythm"
  npm test -- tests/markdown-tasks.test.tsx
  ```

  Expected: all selected and complete Markdown tests pass.

- [x] **Step 4: Verify real browser geometry against the normative reference**

  On Xenoblade Chronicles 2 with the completed-item filter enabled, inspect Shop Deeds and Quests at the current desktop viewport:

  - every collapsed Shop Deeds root subsection has the same height regardless of unpainted or indeterminate wash;
  - the root lower reserve is 12 px and the existing upper inset is unchanged;
  - nested collapsed Quests subsections retain a 6 px lower reserve;
  - root and nested `Скрыто N секций` rows begin 8 px after the full potential paint boundary;
  - green/yellow `::after` paint ends at that boundary;
  - click reveal and the existing collapse/filter motion still target the same summaries.

- [x] **Step 5: Run the requested build and inspect the Jujutsu diff**

  Run:

  ```bash
  npm run build
  jj status
  jj diff
  ```

  Expected: tests and build pass; the diff contains only the approved spec, plan, stylesheet, and Markdown regression tests. Leave the working-copy change uncommitted for independent review and controller finalization.
