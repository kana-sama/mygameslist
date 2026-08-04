# Monaco Markdown Table Formatting

## Context

The note-editor stack now has a compact Monaco foundation, list-aware Enter, and native game-link completion. The Markdown renderer already understands ordinary GFM-style tables plus an application-specific grouped-table grammar, but authoring those tables still requires manually aligning every structural `|`.

This feature adds JetBrains-style automatic source alignment. The original implementation used only Monaco's built-in on-type formatting pipeline, whose trigger list was limited to `|`. JetBrains instead reformats after every character typed inside a table cell, so a later immutable descendant adds an editor-local typing hook for characters that Monaco's trigger list cannot express while preserving the native `|` path.

## Goal

After the user types or deletes content inside a valid Markdown table cell, Monaco reformats that table so its source columns and outer borders remain aligned. Consuming existing cell padding does not move a column boundary. When content exceeds the current width, every row in that column expands together; when the unique widest content becomes shorter, every row contracts together.

## Native Monaco Plumbing

Register one application-lifetime `OnTypeFormattingEditProvider` for Markdown with:

```ts
autoFormatTriggerCharacters: ["|"]
```

The compact editor enables `formatOnType: true`. The provider is installed once from the modular Monaco runtime and remains the native path for a typed structural `|`. It uses public model, position, range, cancellation, language-registration, and text-edit APIs only.

The provider returns ordinary Monaco `TextEdit[]`. It does not call `setValue`, `executeEdits`, restore the caret itself, create an undo group, or register a keybinding. Monaco's formatting controller applies the edits and preserves its native typing/undo transaction.

Monaco 0.56 requires an explicit finite list of on-type trigger characters; it has no wildcard for arbitrary Unicode input. Each note editor therefore installs a companion listener through Monaco's public model-content and composition events. A single-line insertion, replacement, or deletion whose final range lies inside a table cell schedules formatting after Monaco finishes the current input operation. The listener maps Monaco's old event ranges into the final model for multi-cursor changes and, for insertions, also checks the line with the inserted span removed so text beyond a pre-existing closing border cannot be reclassified as a new cell. During IME it retains that initial inside/outside decision for every later replacement on the same line and treats an empty composition update as cancellation rather than a user deletion. It reuses the same pure formatter and minimal per-line edits, applies all affected rows through one public `editor.executeEdits` call, and uses Monaco's public `popStackElement`/`pushStackElement` history APIs to keep that batch in the same undo element as the input change. It never calls `setValue`, maintains its own history, or restores cursor coordinates manually. The listener is disposed with the note editor.

## Shared Structural Pipe Scanner

The renderer's existing table-line scanner becomes a shared pure module rather than being copied. It recognizes structural pipes while respecting:

- odd/even backslash escaping;
- matching inline backtick runs;
- optional structural leading and trailing pipes;
- trimmed source-cell text and exact UTF-16 source columns.

The renderer continues to receive its decoded cell values and source locations from that shared scanner, preserving all current rendering, checklist, diff, and grouped-table behavior. The formatter uses the preserved source cell text so escaped pipes and inline code are never rewritten.

For framed rows the scanner also preserves the whitespace prefix before the leading pipe. A table with one consistent prefix keeps that indentation; differing framed prefixes are treated as mixed structure and left unchanged. Insignificant whitespace after a final framed pipe is normalized away.

## Trigger Eligibility

The native provider acts only when the just-typed character is a structural `|` on the current line. The companion listener covers every other single-line insertion, replacement, or non-empty-range deletion whose final changed range is inside a cell belonging to a structurally valid table. Backspace, forward Delete, Cut, and selection deletion therefore share one public model-content path instead of custom keybindings. A pipe observed while IME composition is active remains pending for the companion path because Monaco's native typed-character event is not emitted for composition updates. Together the paths return no edits for:

- `\|` escaped by an odd backslash run;
- a pipe inside a matching inline-code span;
- a pipe inside a backtick or tilde fenced code block;
- cancellation;
- a position that is not the just-typed pipe;
- an empty no-op, undo, redo, model replacement, or a line-breaking insertion/deletion;
- an insertion before a framed opening border or after a framed/group-title closing border;
- an event containing any multi-line replacement or inserted line break, even when another change in that event is single-line;
- a document region without a valid table header and delimiter.

Typing incomplete table syntax remains untouched. Formatting begins only once the containing candidate block is structurally valid. IME composition is allowed to finish before the pending table is formatted; each interim update replaces that line's pending candidacy, the first update's cell eligibility survives later replacements, and an empty cancellation removes the candidate so a net-empty composition cannot reformat the table.

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

Column widths are computed from header cells, ordinary rows, and every delimiter row using source UTF-16 length. Delimiter token spans are translated into the equivalent ordinary-cell width before comparison, so separator gutters are not mistaken for content width. Escaped source characters therefore keep their real source columns. No display-width dependency is introduced.

The header delimiter controls normal-cell padding:

- no marker or leading `:`: left-aligned;
- trailing `:`: right-aligned;
- both colons: centered with deterministic extra padding on the right.

Every delimiter row preserves its own leading/trailing colon markers and its own separator-gutter style:

- a spaced delimiter keeps the established `| --- | --- |` or `--- | ---` spelling;
- a compact delimiter keeps `|---|---|` or `---|---`, with no whitespace between delimiter tokens and structural pipes.

Ordinary-row spacing is independent from delimiter-row spacing. A table such as `abc | qwe` followed by `----|----` therefore remains mixed in exactly that way. Compact delimiter tokens absorb the gutter width as additional hyphens so their structural pipes still coincide with ordinary rows; framed tokens add two gutter positions, unframed edge tokens add one, and unframed interior tokens add two. Delimiter contribution to logical column width is semantic rather than historical: three required hyphens plus the leading/trailing colon markers, with the compact gutter positions subtracted before comparison with ordinary content. Old extra hyphens therefore cannot pin a column after content shrinks. Serialization adds compact gutters back only as hyphens, never as spaces, and keeps colon markers at their original token edges.

Ordinary output uses one source space around cell content and internal separators. Framed ordinary output follows `indent + | cell | cell |`, preserving the table's consistent indentation prefix; unframed ordinary output follows `cell | cell`. Delimiter output follows the delimiter row's own spaced or compact gutter style. All structural column separators consequently land on the same source columns without normalizing compact delimiters into spaced ones.

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

For the common closing-border trigger, formatting is normally a zero-width insertion immediately before the typed final `|`. Monaco therefore keeps the caret logically after that pipe. For other changes, minimal edits use moving markers. The listener reopens the history element for the just-finished insertion, replacement, or deletion, applies the multi-line alignment as one edit batch, and closes the combined element through Monaco's public history boundaries. Monaco consequently moves the caret with the edited text, while one Undo reverses both the user's change and alignment without exposing a malformed intermediate table.

The adapter never emits edits for unchanged lines, EOL characters, or text outside the detected table.

## No-Op and Recovery Boundaries

Return no edits for:

- no valid header/delimiter pair containing the trigger line;
- fewer than the required delimiter hyphens;
- missing or wrong-count structural cells where the grammar is incomplete (explicit empty cells at the exact count remain valid);
- dangling group delimiter/title sequences;
- mixed framing;
- escaped, inline-code, or fenced trigger pipes;
- fenced non-pipe changes;
- a normal blank or Markdown block boundary;
- cancellation.

Ordinary Markdown text outside the candidate remains untouched. The provider exposes no persistent UI or error state.

## Verification

Pure tests cover shared pipe scanning, renderer compatibility, framed and unframed tables, spaced and compact delimiters, mixed ordinary/delimiter spacing, compact colon markers, alignment markers, grouped-table triples, long titles, escaped pipes, backticks, strict malformed no-ops, framing preservation, and minimal line edits.

Provider/runtime tests cover one Markdown registration, the native `|` trigger, `formatOnType`, cancellation and code exclusions, exact Monaco ranges, current-line table selection, no-op contexts, and modular runtime compatibility. Editor-local tests additionally cover compact-delimiter padding consumption and overflow without a gutter-style change, Backspace/forward Delete/selection deletion contraction, shorter replacements, deletion Undo/Redo grouping, deletion multi-cursor coordinate mapping, structural and outside-border deletion no-ops, sequential spare-padding consumption and overflow, framed and unframed group-title border eligibility, ordinary versus IME pipe routing, multi-update and canceled IME composition, final-coordinate mapping for multi-cursor changes, atomic rejection of line-breaking events, Monaco history grouping with Undo/Redo state, fenced-code exclusion, disposal with queued composition work, installation order, and cleanup.

A real-application browser smoke verifies sequential non-pipe typing through spare padding into overflow, Backspace and forward Delete contraction for compact delimiters, caret continuity, exact one-step Undo/Redo without a malformed intermediate table, and console/worker cleanliness when a browser binding is available. The native final-pipe, grouped-table, marker, and exclusion paths remain covered by provider and pure-formatter suites. If the environment exposes no browser, the exact failure is recorded and the scenario remains in the final cross-stack gate.

## Stacked-Change Boundary

The original specification, plan, shared scanner extraction, pure formatter, Monaco provider/runtime wiring, and tests belong to immutable Jujutsu change `uxultnurvtoywymnzsnrssxoorurllkt`. JetBrains per-character parity belongs to immutable descendant `tuutvrvmrluunxokxkxrxtwulnynsypr`. Compact-delimiter preservation belongs to immutable descendant `llsutstyorzqtuomzvnpvuzvrwpkxpop`. Deletion-triggered contraction, its specification correction, tests, and Monaco companion change belong to a new descendant rather than rewriting any finalized change.
