# Monaco Markdown Table Formatting Implementation Plan

> **Execution:** use subagent-driven development, test-driven development, Jujutsu only, and fold all fixes into change `uxultnurvtoywymnzsnrssxoorurllkt`.

**Goal:** Automatically align ordinary and grouped Markdown table source through Monaco's native format-on-type provider whenever a structural `|` completes a valid table.

**Architecture:** Extract the renderer's structural-pipe scanner into a shared pure module, build a strict pure table formatter on that representation, and adapt its smallest per-line changes into one globally registered Monaco on-type provider. Monaco owns typing, applying edits, cursor tracking, and undo/redo.

**Tech stack:** React 19, TypeScript 7, Monaco Editor 0.56, Vitest 4, Testing Library, Vite 8, Jujutsu.

## Global Constraints

- Treat the matching design spec as the product contract.
- Reuse one shared structural pipe scanner; do not duplicate the renderer parser.
- Use Monaco's public on-type formatting API and `formatOnType: true`.
- Do not add keybindings, editor actions, direct model edits, manual cursor restoration, or undo code.
- Preserve escaped pipes, inline code, fences, colon markers, framing style, grouped-table grammar, and renderer source locations.
- Format strictly; never invent cells or normalize malformed/incomplete tables.
- Do not modify `GamePage`, note composition, completion, list editing, attachments, save/cancel, or note CSS.
- Follow RED/GREEN TDD and record exact evidence.
- Use `jj` exclusively. Review and verify the complete feature before `jj describe` and `jj new`.

## Task 1: Extract the shared structural table-line scanner

**Create:**

- `src/components/markdownTableSyntax.ts`
- `tests/markdown-table-syntax.test.ts`

**Modify:**

- `src/components/Markdown.tsx`

### Step 1: Write failing scanner tests

Cover:

- framed and unframed rows;
- structural pipe indices, frame flags, and framed outer indentation prefixes;
- trimmed source text, decoded renderer value, and exact source columns;
- odd/even escaped-pipe parity;
- single and matching multi-backtick inline code;
- leading/trailing whitespace around framed pipes;
- no structural pipe.

Observe RED because the shared module does not exist.

### Step 2: Extract without renderer behavior changes

Move the current `isEscapedCharacter` and `splitTableLine` behavior into the shared module. Preserve the renderer-facing cell contract while adding the source text and frame metadata needed by formatting. Import the shared function in `Markdown.tsx`; remove the private duplicate.

Run the new scanner suite plus existing Markdown renderer/diff/checklist suites. The extraction must remain behavior-neutral.

## Task 2: Implement the strict pure formatter

**Create:**

- `src/components/markdownTableFormatting.ts`
- `tests/markdown-table-formatting.test.ts`

### Step 1: Write RED examples for ordinary tables

Assert exact formatted lines for:

- framed left/default, right, and centered columns;
- unframed tables that remain unframed;
- header and data widths;
- individual delimiter colon-marker preservation and minimum widths for `---`, `:---`, `---:`, and `:---:`;
- odd centered padding with the extra source space on the right;
- escaped `\|` and backticked `` `a|b` `` source cells with source/decoded location assertions;
- non-BMP/emoji source-unit widths and explicit empty header/data cells at the exact structural count;
- one-column framed tables.

### Step 2: Write RED examples for grouped tables

Cover:

- the header delimiter serving as the first group's leading delimiter;
- later delimiter/title/delimiter triples;
- multiple group titles sharing one full-row width;
- a long title growing only the final column;
- framed titles with aligned outer pipes;
- unframed `Title |` titles with their final pipe aligned to the normal row edge.
- exact `S`/`S - 2` title capacities and off-by-two widening boundaries.

### Step 3: Write RED no-op boundaries

Return `null`/no changes for:

- no header/delimiter pair;
- fewer than three delimiter hyphens;
- missing or wrong-count/short rows while preserving explicit empty cells at the exact count;
- incomplete or dangling group triples;
- mixed/half framing;
- inconsistent framed indentation prefixes;
- structural-looking unrecognized lines in the candidate;
- a trigger line outside the candidate table.
- headings, lists, quotes, thematic rules, and backtick/tilde fences containing pipes as hard block boundaries.

### Step 4: Implement the formatter

Locate the structural-pipe block containing the trigger without crossing renderer-style Markdown boundaries, find its valid header/delimiter start, and parse the remainder with the spec's strict grammar. Compute source-unit widths and header alignment. Preserve every delimiter's colons and a consistent framed indentation prefix. Expand only the final column for an overlong group title using the exact style-specific capacity. Serialize in the established frame style.

Export a pure result containing changed line indices and target text. Keep parsing and serialization independent of Monaco.

### Step 5: Add minimal per-line edit derivation

Export a pure helper that trims common prefix/suffix for one original/target line and returns zero-based start/end source columns plus replacement text, or `null` when unchanged. Cover insertion before a closing `|`, replacement, deletion, identical lines, and conversion to Monaco's one-based range columns.

## Task 3: Register the Monaco on-type provider once

**Create:**

- `src/components/monacoMarkdownTableFormatting.ts`
- `tests/monaco-markdown-table-formatting.test.ts`

**Modify:**

- `src/components/monacoEditorRuntime.ts`
- `src/components/monacoMarkdownEditorConfig.ts`
- `tests/monaco-editor-runtime.test.ts`
- `tests/monaco-markdown-editor-config.test.ts`

### Step 1: Write failing provider/config/runtime tests

Assert:

- one `registerOnTypeFormattingEditProvider("markdown", ...)` call at runtime initialization;
- `autoFormatTriggerCharacters: ["|"]`;
- compact options include `formatOnType: true`;
- cancelled, escaped, inline-code, fenced, non-pipe, and non-table triggers return no edits;
- valid tables return exact smallest `TextEdit` ranges for every changed line;
- the final-pipe case is a zero-width insertion before that pipe;
- the provider uses model line/value/offset APIs only and returns no custom action/cursor/undo behavior.

Observe RED before the provider/runtime registration and option exist.

### Step 2: Implement the adapter and runtime wiring

At the just-typed position, prove the previous source character is a structural pipe using the shared scanner. Reject fenced code through the established pure fence helper. Pass model line contents to the formatter and convert changed line results through the minimal-edit helper into Monaco ranges.

Register the provider once from `monacoEditorRuntime.ts`. Keep the application-lifetime registration; do not install it through each editor's `onReady` callback.

### Step 3: Reach focused and full GREEN

Run:

```sh
npm test -- tests/markdown-table-syntax.test.ts tests/markdown-table-formatting.test.ts tests/monaco-markdown-table-formatting.test.ts tests/monaco-editor-runtime.test.ts tests/monaco-markdown-editor-config.test.ts
npm test
npm run build
```

## Task 4: Disposable browser smoke when available

**Temporary only:**

- `monaco-smoke.html`
- `src/monacoSmoke.tsx`

Mount the real compact Monaco editor with ordinary and grouped table examples. Start Vite on `127.0.0.1:4173` and use the Browser skill.

Verify:

1. Typing the final framed `|` aligns all column and outer pipes.
2. The caret remains after the typed pipe.
3. One undo returns to the unformatted text with the typed `|` still present; redo reapplies formatting.
4. Right/center markers remain unchanged and affect source padding.
5. A grouped table aligns title spans and only widens the final column for a long title.
6. Escaped, inline-code, fenced, malformed, and mixed-frame cases remain unchanged.
7. No console, worker, duplicate-provider, or cursor errors occur.

If no browser binding is available, record the exact environment failure and keep these cases in the final cross-stack gate. Always stop Vite and delete the harness through `apply_patch`.

## Task 5: Review and finalize the stacked feature

Inspect `jj status` and the complete `jj diff`. Request an independent review against the spec and plan. Fix Critical/Important findings, fold them into `uxultnurvtoywymnzsnrssxoorurllkt`, and request scoped re-review.

Run fresh full tests and production build. Describe the feature in detail:

```text
Add native Monaco Markdown table formatting

Align ordinary and grouped Markdown tables through Monaco format-on-type:
- share structural pipe parsing with the renderer
- preserve escaped pipes, inline code, framing, alignment markers, and grouped-table syntax
- format only structurally valid complete candidates
- align full-row group titles and widen only the final column when necessary
- return minimal per-line Monaco text edits while leaving caret and undo behavior native
- register one Markdown provider for the application lifetime

Cover source scanning, renderer compatibility, ordinary/grouped framing and alignment, strict no-op boundaries, minimal edits, provider exclusions, runtime registration, and production build compatibility.
```

Use `jj describe` on the feature change and then `jj new`. The final working copy must be a clean empty child.
