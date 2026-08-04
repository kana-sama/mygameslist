# Monaco Markdown Table Formatting Implementation Plan

> **Execution:** use test-driven development and Jujutsu only. Change `uxultnurvtoywymnzsnrssxoorurllkt` is immutable; the JetBrains parity correction and all of its documentation, tests, and implementation ship together in a new descendant commit.

**Goal:** Automatically align ordinary and grouped Markdown table source after every character typed inside a valid table cell, matching JetBrains Markdown table editing.

**Architecture:** Keep the shared scanner, strict pure formatter, and globally registered Monaco provider for structural `|`. Add an editor-local listener for all other single-line insertions because Monaco 0.56 has no wildcard on-type trigger; both paths reuse the same smallest per-line edits and public Monaco APIs.

**Tech stack:** React 19, TypeScript 7, Monaco Editor 0.56, Vitest 4, Testing Library, Vite 8, Jujutsu.

## Global Constraints

- Treat the matching design spec as the product contract.
- Reuse one shared structural pipe scanner; do not duplicate the renderer parser.
- Use Monaco's public on-type provider for `|`, public model-content/composition events for other characters, and `formatOnType: true`.
- Do not add keybindings, custom typing commands, direct model edits, manual cursor restoration, or a custom undo implementation. Use only Monaco's public history boundaries when grouping alignment with the insertion that caused it.
- Preserve escaped pipes, inline code, fences, colon markers, framing style, grouped-table grammar, and renderer source locations.
- Format strictly; never invent cells or normalize malformed/incomplete tables.
- Do not modify `GamePage`, note composition, completion, list editing, attachments, save/cancel, or note CSS.
- Follow RED/GREEN TDD and record exact evidence.
- Use `jj` exclusively. Never rewrite an existing or finalized commit; every correction is a new descendant.

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

## Task 3: Register the native provider and editor-local typing hook

**Create:**

- `src/components/monacoMarkdownTableFormatting.ts`
- `tests/monaco-markdown-table-formatting.test.ts`

**Modify:**

- `src/components/monacoEditorRuntime.ts`
- `src/components/monacoMarkdownEditorConfig.ts`
- `src/components/MonacoNoteEditor.tsx`
- `tests/monaco-editor-runtime.test.ts`
- `tests/monaco-markdown-editor-config.test.ts`
- `tests/monaco-note-editor.test.tsx`

### Step 1: Write failing provider/config/runtime tests

Assert:

- one `registerOnTypeFormattingEditProvider("markdown", ...)` call at runtime initialization;
- `autoFormatTriggerCharacters: ["|"]`;
- compact options include `formatOnType: true`;
- every other single-line character insertion inside a valid table schedules editor-local formatting;
- spare padding is consumed without moving separators, while overflow widens every row in the column;
- one Monaco history element contains both the inserted character and its alignment edits;
- framed border-adjacent text remains untouched when the insertion is outside a cell;
- non-whitespace after an unframed group-title closing pipe remains outside the table;
- IME-composed structural pipes use the companion path while ordinary pipes stay native;
- later IME replacements retain the first update's inside/outside-cell eligibility;
- canceled IME composition clears its pending table candidate;
- multi-change old ranges map to final model positions, while any line-breaking event is rejected atomically;
- cancelled, escaped, inline-code, fenced, non-pipe, and non-table triggers return no edits;
- valid tables return exact smallest `TextEdit` ranges for every changed line;
- the final-pipe case is a zero-width insertion before that pipe;
- the provider uses model line/value/offset APIs only and returns no custom action/cursor/undo behavior.

Observe RED before the provider/runtime registration and option exist.

### Step 2: Implement the adapter and runtime/editor wiring

At the just-typed position, prove the previous source character is a structural pipe using the shared scanner. Reject fenced code through the established pure fence helper. Pass model line contents to the formatter and convert changed line results through the minimal-edit helper into Monaco ranges.

Register the provider once from `monacoEditorRuntime.ts`. Install a companion disposable through each note editor's `onReady` callback. It maps old multi-change ranges into the final model, checks both final and pre-insertion borders to prove each inserted range is inside a table cell, retains the first IME update's eligibility across replacements, ignores undo/redo/model replacement/line-breaking events and fenced code, waits for IME composition to finish, clears canceled composition candidates, and applies one deduplicated minimal edit batch. Reopen and close the just-finished insertion's history element through Monaco's public `popStackElement`/`pushStackElement` APIs so Undo/Redo never exposes alignment without its typed character. Keep ordinary `|` input on Monaco's native provider path and route a pipe observed during IME through the companion.

### Step 3: Reach focused and full GREEN

Run:

```sh
npm test -- tests/markdown-table-syntax.test.ts tests/markdown-table-formatting.test.ts tests/monaco-markdown-table-formatting.test.ts tests/monaco-editor-runtime.test.ts tests/monaco-markdown-editor-config.test.ts tests/monaco-note-editor.test.tsx
npm test
npm run build
```

## Task 4: Real-application browser smoke when available

Start Vite on `127.0.0.1:4173`, use the Browser skill, and open an existing note in the real compact Monaco editor. Replace only the unsaved editor buffer with an ordinary table fixture, then cancel editing without saving any user data.

Verify:

1. Typing a non-pipe character into spare cell width keeps every separator in place.
2. Typing beyond the current cell width moves the column boundary in every table row.
3. Typing the final framed `|` still uses the native provider and aligns all outer pipes.
4. The caret remains after the typed character, and undo/redo introduces no cursor jump or malformed intermediate table.
5. Right/center markers remain unchanged and affect source padding.
6. A grouped table aligns title spans and only widens the final column for a long title.
7. Escaped, inline-code, fenced, malformed, and mixed-frame cases remain unchanged.
8. No console, worker, duplicate-provider, or cursor errors occur.

If no browser binding is available, record the exact environment failure and keep these cases in the final cross-stack gate. Always cancel the unsaved edit and stop Vite.

## Task 5: Review and finalize the stacked feature

Inspect `jj status` and the complete `jj diff`. Request an independent review against the spec and plan. Put any later review correction in another descendant commit; never edit, squash into, rebase, or otherwise rewrite a finalized change.

Run fresh full tests and production build. Describe the feature in detail:

```text
Match JetBrains table formatting on every typed character

Keep ordinary and grouped Markdown tables aligned throughout typing:
- share structural pipe parsing with the renderer
- preserve Monaco's native format-on-type provider for structural pipes
- reformat valid table cells after every other single-line insertion
- consume spare padding without moving a column boundary
- widen every affected row only after content exceeds the current width
- preserve text inserted outside framed borders
- preserve text beyond unframed group-title closing borders
- route IME-composed pipes through the editor-local path and ordinary pipes through Monaco's native provider
- retain initial cell eligibility across later IME replacement updates
- discard pending formatting when IME composition is canceled
- map multi-cursor changes into final model coordinates and reject line-breaking batches atomically
- preserve escaped pipes, inline code, framing, alignment markers, and grouped-table syntax
- format only structurally valid complete candidates
- align full-row group titles and widen only the final column when necessary
- return minimal per-line Monaco text edits and group them with typing through Monaco's public history boundaries
- clean up the editor-local typing listener with each note editor

Cover source scanning, renderer compatibility, ordinary/grouped framing and alignment, strict no-op boundaries, minimal edits, provider exclusions, sequential non-pipe input, width growth, framed/group-title cell borders, IME commit/cancel, multi-change mapping, history grouping, fenced code, cleanup, runtime registration, real-browser Undo/Redo, and production build compatibility.
```

Use `jj describe` on the feature change and then `jj new`. The final working copy must be a clean empty child.

## Task 6: Preserve compact delimiter gutters

**Modify:**

- `docs/superpowers/specs/2026-08-04-monaco-markdown-table-formatting-design.md`
- `docs/superpowers/plans/2026-08-04-monaco-markdown-table-formatting.md`
- `src/components/markdownTableFormatting.ts`
- `tests/markdown-table-formatting.test.ts`
- `tests/monaco-markdown-table-formatting.test.ts`

**Interfaces:**

- Consumes: `formatMarkdownTableAtLine`, `installMonacoMarkdownTableTyping`, the shared structural scanner, and existing minimal Monaco edits.
- Produces: delimiter-row-aware serialization that preserves either compact or spaced gutters while keeping all structural pipes aligned.

### Step 1: Add pure RED regressions

Add exact fixtures proving that an ordinary-spaced, delimiter-compact table remains mixed while consuming spare padding and while growing:

```md
abc | qwe
----|----
rx  | ty
```

The no-overflow result must keep `----|----`; the overflow result must grow the first token to `-----|----` without inserting spaces. Add framed and unframed cases covering `:---`, `---:`, and `:---:` markers plus a consistently indented framed table. Run:

```sh
npm test -- tests/markdown-table-formatting.test.ts
```

Observe RED because the formatter currently serializes every delimiter through `cells.join(" | ")`.

### Step 2: Preserve delimiter style in the pure formatter

Classify each parsed delimiter row as compact only when all of its structural delimiter pipes have zero whitespace gutters. Keep ordinary serialization unchanged. Translate each compact delimiter token's physical source width into its ordinary-cell width by subtracting two gutter positions for framed/interior cells and one for unframed edge cells. When serializing, add those positions back as hyphens, retaining each token's leading/trailing colon markers. A spaced delimiter continues through the established serializer.

Run the pure formatter suite and confirm GREEN.

### Step 3: Add Monaco RED/GREEN regressions

Use the existing typing harness to insert a non-pipe character into spare padding and then beyond the column width. Assert that the first edit only consumes padding, overflow grows compact hyphens, and one Undo/Redo history element still contains the user's input plus alignment. No Monaco adapter change is expected because both native and companion paths already reuse the pure formatter.

Run:

```sh
npm test -- tests/markdown-table-formatting.test.ts tests/monaco-markdown-table-formatting.test.ts
npm test
npm run build
```

### Step 4: Review and finalize the descendant

Inspect `jj status` and `jj diff`, request an independent review against this task and the matching design section, and fix any finding before finalization. Describe the current Jujutsu change in detail as compact-delimiter preservation, then create a clean child with `jj new`. Never rewrite `uxultnurvtoywymnzsnrssxoorurllkt` or `tuutvrvmrluunxokxkxrxtwulnynsypr`.

## Task 7: Contract columns after deletion

**Modify:**

- `docs/superpowers/specs/2026-08-04-monaco-markdown-table-formatting-design.md`
- `docs/superpowers/plans/2026-08-04-monaco-markdown-table-formatting.md`
- `src/components/markdownTableFormatting.ts`
- `src/components/monacoMarkdownTableFormatting.ts`
- `tests/markdown-table-formatting.test.ts`
- `tests/monaco-markdown-table-formatting.test.ts`

**Interfaces:**

- Consumes: per-delimiter-row compact detection/gutter translation, `formatMarkdownTableAtLine`, Monaco's public `onDidChangeContent`, and existing minimal edit/history batching.
- Produces: semantic delimiter minimum widths and one companion path for same-line insertion, replacement, and deletion changes.

### Step 1: Add pure RED contraction regressions

Start with formatted tables whose unique widest ordinary value is already shorter but whose old delimiter token is still long. Assert exact contraction for spaced delimiters and for compact framed/unframed delimiters with `---`, `:---`, `---:`, and `:---:`. A compact token contributes `3 + markerCount - compactGutter` to logical width; a spaced token contributes `3 + markerCount`. Minimal `|---|` and `---|---` guard fixtures must remain unchanged.

Run:

```sh
npm test -- tests/markdown-table-formatting.test.ts
```

Observe RED because current delimiter `sourceText.length` still pins each column.

### Step 2: Compute width from content and delimiter grammar

Keep ordinary header/data contribution as trimmed source UTF-16 length. Replace every delimiter's historical token-length contribution with its semantic physical minimum of three hyphens plus its colon markers, translated back through the compact row's framed/edge/interior gutter count. Keep compact/spaced serialization, alignment lookup, grouped title expansion, and minimal edit derivation unchanged.

Run the pure suite and confirm GREEN.

### Step 3: Add Monaco deletion RED regressions

Use real Monaco content-change shapes in the typing harness:

- `text === ""` and `rangeLength > 0` for Backspace, forward Delete, and selection deletion;
- a shorter non-empty selection replacement;
- multiple deletions whose old offsets map into the final model;
- deletion immediately before a structural pipe;
- deletion after a framed closing border, inside fenced code, or across lines;
- deletion of a structural pipe that leaves an invalid candidate;
- empty IME cancellation.

Assert exact table contraction and `open`, `edit`, `close` history calls only for eligible in-cell changes. One Undo restores the deletion plus the previous column width; one Redo reapplies both.

Run:

```sh
npm test -- tests/monaco-markdown-table-formatting.test.ts
```

Observe RED because the listener currently drops every empty-text change.

### Step 4: Generalize the Monaco changed-range path

Rename the insertion-only final-range helper to describe any changed range. Preserve old-to-final multi-change delta mapping, same-line atomic rejection, final frame-border checks, pre-insertion border reconstruction for zero-length insertions, fence exclusion, native non-IME `|` routing, composition eligibility, and public history grouping. Ignore only a true empty no-op (`text === ""` with `rangeLength === 0`) or an empty composition cancellation; route an ordinary deletion (`text === ""` with `rangeLength > 0`) through the shared formatter at its collapsed final position. Do not add Backspace/Delete keybindings, DOM handlers, cursor restoration, or custom history.

### Step 5: Verify, review, and finalize the descendant

Run:

```sh
npm test -- tests/markdown-table-formatting.test.ts tests/monaco-markdown-table-formatting.test.ts
npm test
npm run build
```

Inspect `jj status` and `jj diff`, request an independent review against Task 7 and the corrected specification, and resolve every load-bearing finding. Describe the current Jujutsu change in detail as deletion-triggered table contraction, then create a clean child with `jj new`. Never rewrite `uxultnurvtoywymnzsnrssxoorurllkt`, `tuutvrvmrluunxokxkxrxtwulnynsypr`, or `llsutstyorzqtuomzvnpvuzvrwpkxpop`.
