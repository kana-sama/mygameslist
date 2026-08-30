# Rich Tooltip Title Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace slug-based rich-tooltip references with title-derived plain-text anchors using `[label][?]` and `[?Plain label]:`.

**Architecture:** A shared pure anchor extractor converts supported inline Markdown labels into the same plain text used by the rendered dialog title. The domain parser, inline tokenizer, source-range projection, and React renderer all consume that extractor and use anchor-keyed maps; no slug grammar or canonical-id branch remains.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`

## Global Constraints

- Canonical inline syntax is exactly `[label][?]`.
- Canonical definition opener is exactly `[?Plain-text anchor]:` in column one.
- The anchor is the trimmed rendered plain text of the inline label; internal whitespace and case are preserved.
- Unicode, spaces, and punctuation are allowed except `]` and line breaks reserved by the opener grammar.
- Old `[label][?slug]` references are not recognized or migrated.
- Legacy `[text]("description")` and ordinary links keep their behavior.
- Definitions remain terminal, four-space-indented, source-preserving blocks.
- Authored `data/` content is out of scope.
- All permanent tests use synthetic fixtures.
- This feature ends as one Jujutsu commit; do not create intermediate commits.

---

### Task 1: Anchor-keyed parser and validation

**Files:**
- Modify: `src/domain/markdownRichTooltips.ts`
- Modify: `src/domain/validation.ts`
- Modify: `src/domain/index.ts`
- Modify: `tests/markdown-rich-tooltips.test.ts`
- Modify: `tests/domain-core.test.ts`
- Modify: `tests/source-note-document.test.ts`

**Interfaces:**
- Produces: `markdownRichTooltipAnchor(labelMarkdown: string): string`.
- Produces: `parseMarkdownRichTooltipReference(source: string): { anchor: string; label: string } | null`.
- Produces: anchor-keyed `definitions`, `duplicateAnchors`, and references whose public field is `anchor`.
- Preserves: terminal-section extraction, source offsets, CRLF/LF round-trip, fenced-code boundaries, nested-reference rejection, and Markdown safety diagnostics.

- [ ] **Step 1: Write failing parser tests**

Add tests proving:

```ts
expect(parseMarkdownRichTooltipReference("[**Archive Entry**][?]")).toEqual({
  anchor: "Archive Entry",
  label: "**Archive Entry**",
});

const parsed = parseMarkdownRichTooltips([
  "Open [**Archive Entry**][?].",
  "",
  "[?Archive Entry]:",
  "    Synthetic body",
].join("\n"));

expect(parsed.references).toEqual([{ anchor: "Archive Entry", sourceStart: 5, sourceEnd: 27 }]);
expect(parsed.definitions.get("Archive Entry")?.bodyMarkdown).toBe("Synthetic body");
expect(parsed.errors).toEqual([]);
```

Cover exact case sensitivity, Unicode/punctuation, repeated references sharing one body, duplicate anchors, empty anchors, escaped references, code/link metadata boundaries, and literal preservation of `[Label][?old-slug]`.

- [ ] **Step 2: Run the focused domain tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/domain-core.test.ts tests/source-note-document.test.ts
```

Expected: assertions fail because the parser still expects and exposes slug ids.

- [ ] **Step 3: Implement the shared anchor contract**

Replace the rich-reference grammar with a complete-match `[label][?]` token. Extract supported inline label text in a pure helper shared by domain and components. Rename identifier-facing fields and diagnostics to anchors, key definitions by the trimmed anchor, remove canonical slug validation, and keep exact source offsets and escape parity.

Definition openers continue to capture text between `[?` and `]:`; trim only the outer anchor whitespace before key lookup. Reject an empty computed reference or definition anchor. Duplicate definitions compare exact trimmed anchors without case folding or Unicode normalization.

- [ ] **Step 4: Run the focused domain tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass with no warnings.

---

### Task 2: Tokenizer and renderer consume title anchors

**Files:**
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/MarkdownRichTooltip.tsx` only if renamed public fields require it
- Modify: `src/components/markdownRichTooltipContext.ts` only if renamed public fields require it
- Modify: `tests/markdown-rich-tooltip-ui.test.tsx`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/markdown-diff-preview.test.tsx`

**Interfaces:**
- Consumes: `markdownRichTooltipAnchor` and anchor-keyed parser output from Task 1.
- Preserves: noninteractive formatted trigger children, dialog title parity, source decorations, disabled drag previews, one active portal, and placement/dismissal behavior.

- [ ] **Step 1: Write failing tokenizer and UI tests**

Add component assertions equivalent to:

```tsx
const markdown = [
  "Open [**Archive Entry**][?].",
  "",
  "[?Archive Entry]:",
  "    Synthetic body",
].join("\n");

renderWithController(controller, <MarkdownView markdown={markdown} richTooltipsEnabled />);
expect(screen.getByRole("button", { name: "Archive Entry" })).toBeInTheDocument();
expect(screen.queryByText("[?Archive Entry]:")).not.toBeInTheDocument();
```

Assert dialog title/body lookup, formatted/escaped/spoiler labels, exact source ranges, old slug syntax rendered literally, and unchanged ordinary links plus legacy hover hints.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
npx vitest run tests/markdown-rich-tooltip-ui.test.tsx tests/markdown-tasks.test.tsx tests/markdown-diff-preview.test.tsx
```

Expected: new syntax is not tokenized as an active rich-tooltip trigger.

- [ ] **Step 3: Implement anchor lookup in tokenization and rendering**

Update the shared token sources to recognize only `[label][?]`, including full leading-backslash runs. Make visible-source projection expose only the label when rich tooltips are enabled. In `MarkdownView`, render the label with interactions disabled, compute the same shared plain-text anchor, find the matching definition, and use the anchor as the repeated dialog title. Remove canonical-id conditionals and keep unresolved references as formatted, noninteractive labels.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass without React act warnings or uncaught errors.

---

### Task 3: Documentation consistency and feature verification

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-markdown-rich-tooltips.md`
- Verify: `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`
- Verify: all files changed by Tasks 1–2

**Interfaces:**
- Consumes: the final syntax and public names from Tasks 1–2.
- Produces: no stale slug-based normative examples or requirements.

- [ ] **Step 1: Replace stale syntax and terminology in the original implementation plan**

Update examples from `[label][?slug]` / `[?slug]:` to `[label][?]` / `[?Plain label]:`. Replace canonical-id requirements with the shared plain-text-anchor contract. Keep historical task structure and unrelated UI requirements intact.

- [ ] **Step 2: Scan for stale requirements**

Run:

```bash
rg -n "\[label\]\[\?id\]|canonical[- ]id|kebab-case|Некорректный rich tooltip id|\?archive-entry|\?eternal-rest" docs src tests
```

Expected: no normative or executable slug-based rich-tooltip contract remains.

- [ ] **Step 3: Run feature verification**

Run:

```bash
npx vitest run tests/markdown-rich-tooltips.test.ts tests/markdown-rich-tooltip-ui.test.tsx tests/domain-core.test.ts tests/source-note-document.test.ts tests/markdown-tasks.test.tsx tests/markdown-diff-preview.test.tsx
npx tsc -b --pretty false
```

Expected: all tests pass and TypeScript exits zero.

- [ ] **Step 4: Inspect and finalize one feature commit**

Run `jj status` and `jj diff`, verify only title-anchor specification, plan, implementation, and tests are present, then finalize exactly once:

```bash
jj describe -m "Use tooltip titles as Markdown anchors"
jj new
```

