# Interactive Checklist Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every rendered Markdown interaction in checklist-search preview live, including source-backed checkboxes and nested rich tooltips.

**Architecture:** Reuse the shared Markdown renderer with an explicit note-level rich-tooltip context, extend rich annotations with stable source identity, and route definition-body task changes through GamePage's authoritative snapshot and existing per-note interaction lock. Keep the palette's presentation unchanged.

**Tech Stack:** TypeScript, React 19, Vitest 4, Testing Library, existing Markdown/rich-tooltip/checklist domain helpers, CSS, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-09-02-interactive-checklist-preview-design.md`

## Global constraints

- Jujutsu only; one descendant fix commit containing spec, plan, implementation, and generic permanent tests.
- Work test-first and record the expected RED before production changes.
- Reuse shared Markdown parsing/rendering; do not create a palette-only Markdown parser.
- Preserve safe URL handling, authoritative note revalidation, and per-note save ownership.
- Preserve the approved palette geometry and visual styling.
- No authored-data fixtures or generated-artifact assertions.

---

### Task 1: Make rich definitions source-replaceable and nested references valid

**Files:**
- Modify: `src/domain/markdownRichTooltips.ts`
- Modify: `src/domain/checklistSearch.ts`
- Modify: `tests/markdown-rich-tooltips.test.ts`
- Modify: `tests/checklist-search.test.ts`

**Interfaces:**
- Extend rich checklist annotations with the anchor needed for authoritative identity.
- Add a domain operation that replaces one unique, expected rich definition body in full note Markdown and returns unchanged source when validation fails.

- [ ] **Step 1: Write failing parser and mutation tests**

Cover nested references no longer producing the forbidden diagnostic; missing/duplicate definitions remaining invalid; CRLF/LF indentation-preserving body replacement; expected-body mismatch returning unchanged source; and checklist indexing retaining a direct annotation whose body contains a nested reference.

- [ ] **Step 2: Run the focused domain tests and confirm RED**

Run: `npm test -- tests/markdown-rich-tooltips.test.ts tests/checklist-search.test.ts`

Expected: failures caused by the forbidden nested-reference diagnostic, rich-annotation exclusion, missing anchor identity, and missing source replacement helper.

- [ ] **Step 3: Implement the minimal domain changes**

Remove eager nested-reference invalidation, preserve duplicate/missing validation, expose the exact source information required for replacement, and implement a source-safe body replacement that keeps line endings and four-space indentation. Do not recursively inline nested definition bodies into search text.

- [ ] **Step 4: Run focused domain tests and confirm GREEN**

Run: `npm test -- tests/markdown-rich-tooltips.test.ts tests/checklist-search.test.ts tests/markdown-inline-annotations.test.ts`

Expected: all pass.

### Task 2: Render live interactive bodies and nested tooltips

**Files:**
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/MarkdownRichTooltip.tsx`
- Modify: `src/components/markdownRichTooltipContext.ts`
- Modify: `src/components/PageChecklistSearch.tsx`
- Modify: `src/styles.css` only if an above-palette tooltip modifier is required
- Modify: `tests/markdown-rich-tooltip-ui.test.tsx`
- Modify: `tests/page-checklist-search.test.tsx`
- Modify: `tests/note-layout-css.test.ts`

**Interfaces:**
- Allow a body view to render against a supplied note-level rich-definition registry.
- Carry definition identity and optional body-change routing through nested tooltip open requests.
- Add a palette callback for saving a changed rich annotation body.

- [ ] **Step 1: Write failing interaction tests**

Assert preview links are anchors with the standard safe target/rel behavior; hints have their tooltip text; spoilers are interactive; direct and nested-body checklist controls emit regular/partial body changes; a nested rich trigger opens a dialog above the palette; focus can enter preview controls; preview clicks do not navigate or close the palette; cycles remain finite.

- [ ] **Step 2: Run component tests and confirm RED**

Run: `npm test -- tests/page-checklist-search.test.tsx tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts`

Expected: failures because preview passes `interactionsDisabled`, body views lack note-level definitions/save routing, nested references are not triggers, and tooltip layering is below the palette.

- [ ] **Step 3: Implement shared interactive rendering**

Use the existing renderer for links, hints, spoilers, and tasks. Inject the original note's parsed rich definitions into isolated body rendering. Propagate definition identity and save callbacks through nested tooltip requests. Keep nested tooltip rendering lazy and replacement-based so cycles do not recurse. Add only a scoped above-palette z-index modifier if required; do not change palette layout CSS.

- [ ] **Step 4: Run component tests and confirm GREEN**

Run: `npm test -- tests/page-checklist-search.test.tsx tests/markdown-rich-tooltip-ui.test.tsx tests/note-layout-css.test.ts tests/markdown-tasks.test.tsx`

Expected: all pass.

### Task 3: Persist preview checklist changes through GamePage authority

**Files:**
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/components/PageChecklistSearch.tsx`
- Modify: `tests/game-page-checklist-search.test.tsx`
- Modify: `tests/page-checklist-search.test.tsx`

**Interfaces:**
- GamePage consumes the palette's `{ entry, annotationId, expectedBodyMarkdown, nextBodyMarkdown }` request and returns a promise.
- Palette refreshes its index after settlement and uses the existing footer error/rollback path.

- [ ] **Step 1: Write failing integration tests**

Cover exact definition mutation, Shift/Cmd partial transitions, stale entry/annotation/body rejection, failed-save authoritative rollback, close/reopen ownership, overlap with direct note interaction, and a checkbox inside a nested tooltip saving the referenced definition rather than the parent body.

- [ ] **Step 2: Run integration tests and confirm RED**

Run: `npm test -- tests/game-page-checklist-search.test.tsx tests/page-checklist-search.test.tsx`

Expected: failures because no annotation-body save callback or authoritative definition mutation exists.

- [ ] **Step 3: Implement authoritative persistence**

Acquire the existing persistent-note owner token, reread the note snapshot, rebuild/revalidate the entry and rich annotation, replace only the expected definition body, save through `noteInteractionSource`, and release token in `finally`. Refresh palette authority on success or failure; never write history for a failed preview-content change.

- [ ] **Step 4: Run integration and neighboring suites**

Run: `npm test -- tests/game-page-checklist-search.test.tsx tests/page-checklist-search.test.tsx tests/markdown-tasks.test.tsx tests/markdown-rich-tooltip-ui.test.tsx`

Expected: all pass.

### Task 4: Documentation, visual verification, review, and finalization

**Files:**
- Modify: `docs/superpowers/specs/2026-09-01-page-checklist-search-design.md`
- Modify: `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Correct prior normative documentation**

Remove the invented noninteractive-preview rule, document live source-backed interactions, and replace the nested-reference prohibition with lazy nested-tooltip behavior and cycle safety.

- [ ] **Step 2: Run focused and full verification**

Run the affected domain/component/GamePage suites, then `npm test` and `npm run build`.

- [ ] **Step 3: Verify in the browser**

At `1280×800`, use a generic note fixture with a preview link, spoiler, direct checkbox, and nested tooltip checkbox. Confirm actions work, saves reach the exact definitions, nested tooltip paints above the palette, focus returns correctly, and the palette remains `690×366px` with unchanged rows and footer.

- [ ] **Step 4: Request code review and apply scoped findings**

Review against both the new spec and the approved original visual reference. Require explicit checks for authoritative source safety, nested-cycle finiteness, accessibility, and visual invariants.

- [ ] **Step 5: Finalize one Jujutsu commit**

Inspect `jj status` and `jj diff`, describe the completed descendant change as `Make checklist preview interactive`, and run `jj new`. Do not rewrite the finalized parent feature commit.
