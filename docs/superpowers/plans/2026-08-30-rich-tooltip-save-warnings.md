# Rich Tooltip Save Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn on the first explicit save when rich-tooltip references and bodies are orphaned, then allow a second save of unchanged Markdown.

**Architecture:** A pure domain audit reports missing bodies and unreferenced bodies without turning them into blocking validation errors. Existing-note and new-game authoring flows share warning rendering and unchanged-draft confirmation semantics, while automatic checklist and structural persistence continue bypassing this explicit-save guard.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`

## Global Constraints

- Audit only canonical `[label][?]` references and `[?Plain label]:` definitions within one note.
- Report unique `missingBodyAnchors` and `unreferencedBodyAnchors` in first-source order.
- Missing/unreferenced linkage is warning-level and must not enter blocking domain validation.
- Duplicate, empty, malformed, nested, unsafe, or interrupted definitions remain blocking errors.
- The first explicit submit with a cleanly parsed orphan audit does not call persistence.
- The warning is yellow, lists concrete anchors, and tells the user to press the applicable save button again.
- A second submit saves only unchanged Markdown; any Markdown edit resets confirmation.
- Existing-note warning appears immediately above note actions; new-game warning appears above form save actions and aggregates all draft notes.
- Checklist/collapse interactions and structural operations do not use the confirmation guard.
- Permanent tests use synthetic fixtures; authored `data/` content is out of scope.
- This feature ends as one Jujutsu commit; do not create intermediate commits.

---

### Task 1: Warning-level orphan audit

**Files:**
- Modify: `src/domain/markdownRichTooltips.ts`
- Modify: `src/domain/validation.ts` only if composition needs an explicit change
- Modify: `tests/markdown-rich-tooltips.test.ts`
- Modify: `tests/domain-core.test.ts`
- Modify: `tests/source-note-document.test.ts`

**Interfaces:**
- Produces: `MarkdownRichTooltipLinkAudit` with readonly `missingBodyAnchors` and `unreferencedBodyAnchors`.
- Produces: `auditMarkdownRichTooltipLinks(source: string): MarkdownRichTooltipLinkAudit`.
- Preserves: `parseMarkdownRichTooltips(...).errors` for blocking syntax/safety errors only.
- Consumer rule: callers show orphan warnings only when the parser has no blocking errors.

- [ ] **Step 1: Write failing audit and validation tests**

Add real parser/validation fixtures equivalent to:

```ts
const source = [
  "Open [Missing][?] and [Shared][?] twice [Shared][?].",
  "",
  "[?Shared]:",
  "    Used body",
  "",
  "[?Unused]:",
  "    Unused body",
].join("\n");

expect(auditMarkdownRichTooltipLinks(source)).toEqual({
  missingBodyAnchors: ["Missing"],
  unreferencedBodyAnchors: ["Unused"],
});
expect(validateNoteMarkdown(source)).toEqual([]);
```

Cover unique first-source order, repeated references, all-paired empty audit, escaped/code/metadata exclusions, missing linkage removed from library/source validation, and a malformed/empty/duplicate definition remaining a blocking error.

- [ ] **Step 2: Run focused domain tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/domain-core.test.ts tests/source-note-document.test.ts
```

Expected: audit API is absent and missing definitions still appear as blocking validation errors.

- [ ] **Step 3: Implement the pure orphan audit**

Stop adding `definition не найдено` to parser errors. Build ordered unique reference and valid nonempty definition anchor lists from the existing source-aware parser output. Return missing anchors absent from definitions and definition anchors absent from references. Do not suppress the parser's existing blocking diagnostics; UI consumers will skip warning interception when those errors are nonempty.

- [ ] **Step 4: Run focused domain tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass with pristine output.

---

### Task 2: Double-submit warning UX for existing and new notes

**Files:**
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css` only if the existing yellow `.inline-alert` styling cannot satisfy placement without a focused class
- Modify: `tests/game-note-links.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx` only for an existing integration boundary not expressible in `game-note-links.test.tsx`
- Modify: `tests/note-layout-css.test.ts` only if production CSS changes

**Interfaces:**
- Consumes: `auditMarkdownRichTooltipLinks` and blocking parser errors from Task 1.
- Produces: one shared warning view/model that formats missing and unreferenced anchors plus the applicable repeat-submit instruction.
- Preserves: `onSave` payloads, attachment processing, Monaco keyboard submit, cancel behavior, checklist interaction saves, note reorder/delete, and new-game form validation.

- [ ] **Step 1: Write failing existing-note UX tests**

Exercise the real `GamePage` editor:

1. Enter a note containing one missing body and one unused body.
2. Click `Сохранить заметку` once.
3. Assert `onSave` was not called and a yellow `.inline-alert` with `role="alert"` appears before `.note-editor-actions`, naming both anchors and the repeat instruction.
4. Click again without editing and assert exactly one save with unchanged source.
5. In a separate case, edit after the first warning and assert the next click warns again rather than saving.
6. Assert paired content saves on the first click and a blocking parser error follows the ordinary error path without showing the orphan warning.

- [ ] **Step 2: Write failing new-game and bypass tests**

Use multiple synthetic draft notes and the real form submit. Assert the first page save aggregates unique missing/unreferenced anchors without calling `onSave`, the second unchanged submit saves once, and editing any note Markdown resets confirmation. Assert a checklist interaction on a rendered existing note still invokes its interaction persistence without an orphan-confirmation warning.

- [ ] **Step 3: Run focused UI tests and verify RED**

Run:

```bash
npx vitest run tests/game-note-links.test.tsx tests/ui-acceptance.test.tsx
```

Expected: first-click saves immediately because the warning guard/view do not exist.

- [ ] **Step 4: Implement the warning model and explicit-save guards**

Render the existing yellow `.inline-alert` visual with warning icon and text lines. In `PlainNoteEditor`, route both button and Monaco submit through one guarded submit function; store confirmation only for the current Markdown and clear it in the Markdown change path. Skip interception if `parseMarkdownRichTooltips(markdown).errors` is nonempty.

In `NewGamePage`, audit all draft note bodies before `onSave`, aggregate each category in draft/source order without duplicates, and use a confirmation fingerprint of the current note Markdown values. Clear confirmation when note Markdown changes; the second identical submit proceeds through the existing title/processing/domain save flow. Do not place the guard inside shared `persist`, task saves, reorder, delete, or collapse handlers.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run the Step 3 command. Expected: all selected tests pass without act warnings or uncaught errors.

---

### Task 3: Documentation consistency and feature verification

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-markdown-rich-tooltips.md`
- Verify: `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`
- Verify: all files changed by Tasks 1–2

**Interfaces:**
- Consumes: final audit names, warning copy, and explicit-save boundaries from Tasks 1–2.
- Produces: no stale requirement that missing definitions are blocking or unused definitions are silently accepted.

- [ ] **Step 1: Update stale validation/save-flow documentation**

Change the original implementation plan so missing/unreferenced linkage is documented as warning-level, with repeat-save semantics. Keep blocking parser errors, legacy syntax, portal UI, and source preservation requirements intact.

- [ ] **Step 2: Scan normative docs and executable code**

Run:

```bash
rg -n "definition не найдено|Неиспользуемое корректное definition разрешено|missingBodyAnchors|unreferencedBodyAnchors|Нажмите .*ещё раз" docs src tests
```

Expected: old phrases appear only in historical negative context or removed-test explanations; current spec, plan, implementation, and tests expose the approved warning contract.

- [ ] **Step 3: Run feature verification**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/domain-core.test.ts tests/source-note-document.test.ts tests/game-note-links.test.tsx tests/ui-acceptance.test.tsx
npx tsc -b --pretty false
```

Expected: all tests pass and TypeScript exits zero.

- [ ] **Step 4: Inspect and finalize one feature commit**

Run `jj status` and `jj diff`, verify only save-warning specification, plan, implementation, and tests are present, then finalize exactly once:

```bash
jj describe -m "Warn before saving orphaned tooltips"
jj new
```

