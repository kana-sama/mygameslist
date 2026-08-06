# Table-aware note editor width design

## Context

The Monaco note editor uses viewport word wrapping. That behavior is useful for prose but makes an aligned Markdown table difficult to read when a table row is wider than the editing card. Monaco exposes wrapping as an editor-wide option, not as a per-line or per-range option, so the application cannot disable wrapping only for table blocks through the supported Monaco API.

The note shelf already lays cards out in equal-width columns. A persisted `doubleWidth` flag gives a card a base span of two columns, while ordinary cards span one column. `ShelfGrid` observes span changes and can repack cards, but its current span model accepts only one or two columns and a changed span can trigger a full repack. The desired editing behavior is more constrained: a note should grow only to the right from its current position, displace cards to its right, and never move itself left or to another shelf merely to gain width.

## Goal

While a Markdown note is being edited, automatically widen its card enough to fit the widest recognized table row whenever contiguous shelf columns exist to the card's right. Growth is temporary, anchored to the card's current left edge, and monotonic for the lifetime of that editing session. When no more columns exist to the right, the card stops growing and Monaco continues to wrap the table normally.

## Non-goals

- Do not add selective per-line wrapping to Monaco or patch Monaco internals.
- Do not disable word wrapping globally.
- Do not add horizontal scrolling to the editor.
- Do not change the saved Markdown or compact/reformat tables to make them fit.
- Do not persist automatic width in the note's `doubleWidth` field.
- Do not move an editing card to a different shelf or column merely to make more room available.
- Do not shrink an automatically widened card while its editor remains mounted.
- Do not redesign ordinary read-mode card sizing or shelf packing outside the targeted anchored expansion behavior.

## User-visible behavior

### Initial width

An editor starts from the note's saved width: one column normally or two columns when `doubleWidth` is true. Automatic width is an additional transient editing-session constraint and does not alter the saved flag.

After Monaco is ready, the application finds valid Markdown table blocks and determines the width required by their widest source line. If the current card is already wide enough, its layout does not change.

### Anchored growth

When more width is required, the card requests the smallest whole-column span that can contain the widest table row. Its current shelf and starting column form the expansion anchor:

- the starting column and top position of the editing card remain unchanged;
- the card can consume only columns to the right of that starting column;
- slots overlapped by the larger span are displaced;
- displaced cards and subsequent cards are repacked in stable document order;
- cards before the editor and non-overlapping cards to its left retain their placements.

The card may jump directly to the required span; it does not need to animate through intermediate spans. Monaco's existing `automaticLayout` support responds to the card resize and recalculates its wrapping without recreating the model or editor.

### Right-edge fallback

For an editing card starting at zero-based column `startColumn` in a shelf with `columnCount` columns, the largest permitted span is:

```text
maxRightwardSpan = columnCount - startColumn
```

The effective automatic span is clamped to that value. A card in the last column therefore cannot grow. If the widest table row still exceeds the editor viewport at the clamped span, no alternate placement is attempted: Monaco keeps `wordWrap: "on"`, and the table wraps.

### Monotonic session width

Each mounted editor session retains the greatest automatic width demand it has observed. Deleting a table, shortening a cell, or making the container wider does not request a smaller span. This prevents table formatting and ordinary typing from making the card oscillate between widths.

Monotonicity is retained at two related levels: the editing card keeps the greatest requested pixel width, preserving the content demand, and `ShelfGrid` keeps the greatest derived automatic span, preserving the visible column footprint when grid geometry changes. Neither value is persisted after the editor unmounts.

Responsive layout can physically clamp the span when the container loses columns. The session nevertheless retains its maximum width demand. If columns become available again before the editor unmounts, the card may expand again, subject to its fixed left anchor and the new right boundary.

### Ending editing

Saving, cancelling, deleting, or otherwise unmounting the editor discards the transient width demand. Read mode uses only the saved `doubleWidth` value. If the user changes the manual double-width control during editing, that value remains the saved base width, while the visible editor cannot shrink below its already reached automatic width until the editing session ends.

## Table recognition and measurement

### Recognition

Width measurement uses the application's existing Markdown table syntax rules rather than treating every line containing a pipe as a table. A measured block must have a valid header and delimiter and must respect the same fenced-code and table-boundary behavior as table formatting. Ordinary rows, delimiter rows, and supported grouped-table title rows all contribute candidate source lines.

Pipe-looking content inside fenced code, incomplete table-like input without a valid table structure, and unrelated prose are ignored. When an incomplete table becomes valid during typing, it begins contributing a width demand on the next scheduled measurement.

The implementation should extract or expose shared pure table-block discovery instead of creating a second, subtly different table grammar.

### Measurement

Measurement must predict the space Monaco's simple wrapping strategy needs for the complete source line. It uses the editor's computed font information and Monaco-compatible visible-column accounting, including tabs and full-width characters, rather than assuming that JavaScript string length always equals rendered width.

The requested outer card width includes:

- the widest table line's text width;
- Monaco's content-left inset and vertical scrollbar reservation;
- a small one-column safety allowance for rounding and the cursor boundary;
- the card border without unrelated page spacing.

Measurement operates on model text, so it remains valid when the widest table line is offscreen or currently split into wrapped view lines. APIs that only measure a rendered visible line are not sufficient.

The editor reports a required width in pixels. Shelf layout owns the conversion from pixels to a column span because only the shelf knows its current column width, gap, column count, and the card's anchored placement.

## Component responsibilities

### Markdown table block utility

A pure Markdown utility returns the line ranges belonging to valid supported tables. Table formatting and width measurement share this utility so both features agree on which lines form a table. The utility has no React, Monaco, or DOM dependency.

### Monaco table-width observer

An editor-local observer:

- runs once after editor creation;
- subscribes to model-content changes;
- schedules at most one measurement per animation frame or equivalent batch;
- reads valid table source lines and computed Monaco font/layout metrics;
- reports the current required table width to the owning note editor;
- reports zero when there is no valid table, without forcing session width to shrink;
- disposes every subscription and scheduled callback with the editor.

The observer measures after on-type table formatting has settled for the current input batch so the width request represents the final aligned row text. Repeated identical measurements do not publish redundant updates.

### Editing note card

The editing card stores the greatest required pixel width reported during its mounted lifetime and exposes that transient demand to `ShelfGrid` separately from the persisted base span. It does not calculate grid columns itself.

### ShelfGrid

`ShelfGrid` extends its span model from the current special case of one or two columns to positive integer spans clamped by the current column count. For an editing card with a transient pixel-width demand, it:

1. derives the smallest span whose rendered grid width satisfies that demand;
2. never lowers the card's session automatic span;
3. clamps growth to the columns available rightward from the anchor;
4. pins the card's shelf, starting column, and top position during expansion;
5. repacks only placements invalidated by the larger pinned slot and the placements following them;
6. keeps unaffected earlier and left-side placements stable.

The shelf continues to observe relevant card attributes or receives an equivalent explicit layout signal. Width growth must work while ordinary packing is frozen during editing. The editor DOM node is resized in place and is never remounted as part of shelf layout.

When multiple editor cards exist, width-growth requests are resolved in stable DOM order within a layout batch. An earlier pinned expansion may displace a later editor; the later editor's retained width demand is then applied from its resulting valid placement. No two cards retain conflicting anchors.

## Data flow

```text
model content changes
  -> table formatting settles
  -> table-width observer finds valid table lines
  -> observer measures widest full source line
  -> editing card raises its session maximum required width
  -> ShelfGrid maps pixels to a requested integer span
  -> anchored span is clamped at the right boundary
  -> overlapping/right-side cards are repacked
  -> Monaco automaticLayout observes the new editor width
  -> Monaco wraps only if the table still exceeds the available width
```

This is a one-way flow. Monaco resizing does not create a new width demand from rendered wrapped lines, which avoids a resize feedback loop.

## Failure and edge behavior

- If font or layout metrics are temporarily unavailable, retain the existing span and retry on the next scheduled content/layout observation; editing remains usable with normal wrapping.
- Invalid or incomplete Markdown contributes no automatic width until it becomes a valid supported table.
- A required width larger than the entire rightward capacity is clamped without error or horizontal page overflow.
- A shelf resize can trigger span recomputation from the retained pixel demand, but it cannot erase the session maximum.
- If an editing card's previous anchor is no longer valid because responsive layout removed columns, clamp it to a valid placement through ordinary responsive layout, then treat that placement as the current anchor for subsequent rightward growth.
- Measurement and packing updates must be idempotent so observers cannot create an infinite mutation/resize cycle.

## Accessibility and interaction stability

- Expanding the card must preserve Monaco focus, selection, undo history, composition state, and scroll position.
- The editing card's left edge and top position remain visually stable during width growth, limiting disruptive page movement to cards on its right and below.
- No new control or announcement is required because expansion is an automatic layout response and does not change document content.
- Existing save, cancel, manual size controls, drag restrictions, attachment editing, and keyboard shortcuts retain their behavior.

## Testing

### Pure table and width tests

- find ordinary and grouped valid table blocks;
- ignore fenced code, prose pipes, and incomplete table-like content;
- include every supported table source line when choosing the maximum;
- account for tabs, Cyrillic text, full-width characters, and the safety allowance;
- return no width demand when no valid table exists.

### Shelf layout tests

- accept arbitrary positive spans and clamp them to the column count;
- grow an anchored card from one to two and three columns without changing its start column or top;
- displace overlapping cards on the right in stable order;
- retain earlier and non-overlapping left-side placements;
- clamp a card at the right edge without moving it to another shelf;
- never lower the retained automatic span during a mounted session;
- restore a retained width demand when responsive columns return;
- resolve multiple editor demands deterministically without overlapping cards;
- continue to process width growth while ordinary repacking is frozen.

### Editor and note integration tests

- publish an initial width demand when a note opens with a valid table;
- raise the demand when table editing produces a wider formatted row;
- do not lower it after shortening or deleting the table;
- leave prose-only notes at their saved span;
- resize Monaco in place without recreating its model;
- preserve saved `doubleWidth` independently from transient auto-width;
- discard transient width after save or cancel;
- retain normal Monaco wrapping when the anchored card reaches its right boundary.

### Browser verification

In a real multi-column note shelf:

1. edit a note with a table from a left or middle column;
2. confirm that it grows only as far as needed and shifts cards to its right;
3. continue widening a cell and confirm that width grows but never shrinks;
4. edit a note at the right edge and confirm that it stays in place and the table wraps;
5. save and cancel separate sessions and confirm that read-mode width returns to the saved setting;
6. resize the window across column-count breakpoints and confirm stable focus and non-overlapping layout.

## Acceptance criteria

- A valid table that fits within columns available to the right is shown without wrapping after the note automatically widens.
- The editing note never changes its left edge or shelf solely to obtain more width.
- Cards occupying newly consumed columns are displaced and repacked without overlap.
- Automatic width never decreases during one mounted editing session.
- At the right boundary, growth stops and Monaco wrapping remains the fallback.
- Automatic width is transient and does not mutate persisted note size.
- Prose-only notes and read-mode shelf behavior remain unchanged.
- Existing editor focus, selection, undo, IME, formatting, save, and cancel behavior does not regress.
