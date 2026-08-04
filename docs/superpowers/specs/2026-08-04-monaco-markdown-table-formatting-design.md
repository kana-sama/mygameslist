# Monaco Markdown Table Formatting

## Context

The note-editor stack now has a compact Monaco foundation, list-aware Enter, and native game-link completion. The Markdown renderer already understands ordinary GFM-style tables plus an application-specific grouped-table grammar, but authoring those tables still requires manually aligning every structural `|`.

This feature adds JetBrains-style automatic source alignment through Monaco's built-in on-type formatting pipeline. It does not add a custom keybinding or edit the model directly.

## Goal

After the user types a structural `|` that completes a valid Markdown table shape, Monaco reformats that table so its source columns and outer borders align. The typed character, formatting edits, caret tracking, and undo/redo remain owned by Monaco.

## Native Monaco Plumbing

Register one application-lifetime `OnTypeFormattingEditProvider` for Markdown with:

```ts
autoFormatTriggerCharacters: ["|"]
```

The compact editor enables `formatOnType: true`. The provider is installed once from the modular Monaco runtime, not once per note editor. It uses public model, position, range, cancellation, language-registration, and text-edit APIs only.

The provider returns ordinary Monaco `TextEdit[]`. It does not call `setValue`, `executeEdits`, restore the caret itself, create an undo group, or register a keybinding. Monaco's formatting controller applies the edits and preserves its native typing/undo transaction.

## Shared Structural Pipe Scanner

The renderer's existing table-line scanner becomes a shared pure module rather than being copied. It recognizes structural pipes while respecting:

- odd/even backslash escaping;
- matching inline backtick runs;
- optional structural leading and trailing pipes;
- trimmed source-cell text and exact UTF-16 source columns.

The renderer continues to receive its decoded cell values and source locations from that shared scanner, preserving all current rendering, checklist, diff, and grouped-table behavior. The formatter uses the preserved source cell text so escaped pipes and inline code are never rewritten.

For framed rows the scanner also preserves the whitespace prefix before the leading pipe. A table with one consistent prefix keeps that indentation; differing framed prefixes are treated as mixed structure and left unchanged. Insignificant whitespace after a final framed pipe is normalized away.

## Trigger Eligibility

The provider acts only when the just-typed character is a structural `|` on the current line. It returns no edits for:

- `\|` escaped by an odd backslash run;
- a pipe inside a matching inline-code span;
- a pipe inside a backtick or tilde fenced code block;
- cancellation;
- a position that is not the just-typed pipe;
- a document region without a valid table header and delimiter.

Typing incomplete table syntax remains untouched. Formatting begins only once the containing candidate block is structurally valid.

## Supported Table Grammar

A candidate table starts with a header row followed by an exact `N`-cell delimiter row. Every delimiter cell matches `^:?-{3,}:?$`.

The remaining structural-pipe lines up to the next renderer-style Markdown block boundary must parse strictly as:

- an exact `N`-cell ordinary row;
- an exact `N`-cell delimiter row; or
- a grouped-table header represented by `N`-cell delimiter → non-empty one-cell title → `N`-cell delimiter.

For the first group, the header delimiter may serve as the triple's first delimiter, so this shape is valid:

```md
| Header | Done |
| ------ | ---- |
| First group   |
| ------ | ---- |
| Item   | [ ]  |
```

Later groups use a delimiter/title/delimiter triple between rows. A one-cell row is a group title only in that complete structural context.

Block boundaries include headings, list items, quotes, thematic rules, and both backtick and tilde fences even when their source contains a pipe. Adjacent Markdown such as `## After | the table` is not a table row and cannot poison or join the candidate.

Plain framed one-column tables remain formatable as ordinary tables; grouped interpretation is unnecessary when `N` is one. An unframed one-column shape has no structural pipe and therefore is not a pipe-triggered table candidate.

The formatter never invents missing cells or silently converts renderer-tolerated short rows. A candidate with a wrong cell count, an incomplete group triple, or another structural but unrecognized line is left unchanged.

An explicit empty header or data cell is valid when the row still contains exactly `N` structural cells, for example `| A | |` or unframed `A | `. Empty and missing are therefore distinct: formatter padding may make an explicit empty cell visible, but no absent cell is invented. Group titles remain non-empty and delimiter cells must match the delimiter grammar.

## Framing Contract

The header establishes one framing style:

- **framed:** all ordinary and delimiter rows have both leading and trailing structural pipes;
- **unframed:** ordinary and delimiter rows have neither outer pipe.

Framed grouped titles also have both outer pipes. An unframed grouped title uses the renderer-compatible one-cell spelling `Title |`: no leading pipe and one trailing pipe. Mixed or half-framed candidates are left unchanged rather than converted.

The formatter preserves the author's framed or unframed choice.

## Alignment and Widths

Column widths are computed from header cells, ordinary rows, and every delimiter row using source UTF-16 length. Escaped source characters therefore keep their real source columns. No display-width dependency is introduced.

The header delimiter controls normal-cell padding:

- no marker or leading `:`: left-aligned;
- trailing `:`: right-aligned;
- both colons: centered with deterministic extra padding on the right.

Every delimiter row preserves its own leading/trailing colon markers. Hyphens expand to the column width, with minimum source widths of three for `---`, four for `:---` or `---:`, and five for `:---:`.

Output uses one source space around cell content and internal separators. Framed output follows `indent + | cell | cell |`, preserving the table's consistent indentation prefix; unframed output follows `cell | cell`. All structural column separators consequently land on the same source columns.

## Group Titles

A grouped title is left-aligned across the table's full usable row width. Let `S = sum(columnWidths) + 3 * (N - 1)`, the exact source length of an ordinary unframed formatted row. A framed title has capacity `S` and renders as `indent + | title.padEnd(S) |`. An unframed title has capacity `S - 2` and renders as `title.padEnd(S - 2) |`, placing its trailing pipe at the ordinary row's final source column.

If any group title is wider than its style-specific capacity, only the final column grows by the exact deficit. All rows and delimiters are then recomputed, leaving earlier internal column boundaries stable while aligning the title and right edge.

Example:

```md
| Stage | Main | Secret |
| ----- | ---- | ------ |
| First                 |
| ----- | ---- | ------ |
| Start | [x]  | [ ]    |
| ----- | ---- | ------ |
| Chamber of Secrets    |
| ----- | ---- | ------ |
| Dobby | [ ]  | [x]    |
```

## Minimal Edits and Cursor Contract

The pure formatter produces target text per changed source line. The Monaco adapter trims each line's unchanged prefix and suffix and returns the smallest non-overlapping `TextEdit` for that line.

For the common closing-border trigger, formatting is normally a zero-width insertion immediately before the typed final `|`. Monaco therefore keeps the caret logically after that pipe. Multi-line width changes remain one provider response and one native formatting action.

The adapter never emits edits for unchanged lines, EOL characters, or text outside the detected table.

## No-Op and Recovery Boundaries

Return no edits for:

- no valid header/delimiter pair containing the trigger line;
- fewer than the required delimiter hyphens;
- missing or wrong-count structural cells where the grammar is incomplete (explicit empty cells at the exact count remain valid);
- dangling group delimiter/title sequences;
- mixed framing;
- escaped, inline-code, or fenced trigger pipes;
- a normal blank or Markdown block boundary;
- cancellation.

Ordinary Markdown text outside the candidate remains untouched. The provider exposes no persistent UI or error state.

## Verification

Pure tests cover shared pipe scanning, renderer compatibility, framed and unframed tables, alignment markers, grouped-table triples, long titles, escaped pipes, backticks, strict malformed no-ops, framing preservation, and minimal line edits.

Provider/runtime tests cover one Markdown registration, the `|` trigger, `formatOnType`, cancellation and code exclusions, exact Monaco ranges, current-line table selection, no-op contexts, and modular runtime compatibility.

A disposable browser harness verifies formatting after the final pipe, caret position, one-step undo/redo, grouped tables, and console/worker cleanliness when a browser binding is available. If the environment exposes no browser, the exact failure is recorded and the scenario remains in the final cross-stack gate.

## Stacked-Change Boundary

The specification, plan, shared scanner extraction, pure formatter, Monaco provider/runtime wiring, tests, review fixes, and verification evidence belong to Jujutsu change `uxultnurvtoywymnzsnrssxoorurllkt`. Note cutover remains a separate descendant.
