# Table overflow word-wrap design

## Context

The note editor already measures valid Markdown tables and asks `ShelfGrid` to widen the editing card. Growth is transient, monotonic for the mounted editing session, and anchored to the card's current position. When the requested table width still exceeds the realized card width after rightward growth is exhausted, Monaco currently keeps `wordWrap: "on"`, which makes the table source difficult to read.

This design supersedes only the right-edge wrapping fallback in `2026-08-07-table-aware-note-editor-width-design.md`. All existing measurement, anchored-growth, persistence, and interaction requirements remain unchanged.

## Goal

Keep ordinary Monaco word wrapping while a table fits. After `ShelfGrid` has applied all available rightward expansion, switch Monaco to `wordWrap: "off"` only when the current valid table still exceeds the editing card's realized width. Restore `wordWrap: "on"` when the current table fits again or disappears.

## User-visible behavior

- The note first expands through the existing automatic table-width behavior.
- A table that fits after expansion continues to use the default `wordWrap: "on"` editor configuration.
- If the table is still wider than the final card span, Monaco switches to `wordWrap: "off"` without remounting the editor.
- If table editing makes the current table fit again, or removes every valid table, Monaco switches back to `wordWrap: "on"`.
- The card keeps the greatest automatic width reached during the mounted session; restoring wrap does not shrink the card.
- Prose-only notes, read mode, persisted `doubleWidth`, manual size controls, and non-table lines retain their existing behavior.

## Architecture and data flow

The table-width observer continues to publish the current required width. The editing card retains two transient values:

1. the existing session maximum, exposed as `data-shelf-required-width` for monotonic card growth;
2. the current measured width, exposed separately for the overflow decision, including zero when no valid table exists.

`ShelfGrid` remains the authority for the overflow decision because it knows the final anchored placement, column width, gap, and realized span. After every layout it compares the current table width with the pixel capacity of the final placement. It marks only a still-overflowing editing card with a transient data attribute and removes that marker when the current table fits.

An editor-local Monaco extension observes that marker on its owning editing card. It calls `editor.updateOptions({ wordWrap: "off" })` when the marker appears and `editor.updateOptions({ wordWrap: "on" })` when it disappears. It deduplicates unchanged states and disconnects its observer with the editor.

```text
current valid table width
  -> editing card publishes current width and retains session maximum
  -> ShelfGrid expands from the session maximum
  -> ShelfGrid compares current width with final realized span
  -> overflow marker appears or disappears
  -> mounted Monaco updates wordWrap without losing editor state
```

## Edge behavior

- A card anchored at the right edge can switch wrapping off even when the grid has unused columns to its left; it must not move left merely to gain width.
- Responsive relayout recomputes the marker from the new realized span and current table width.
- No valid table means a current width of zero, no overflow marker, and `wordWrap: "on"`.
- Unavailable or invalid numeric measurements do not create an overflow marker.
- The overflow marker is transient DOM state and is never persisted in note data.
- The new marker must not trigger a shelf-layout observer loop.
- Horizontal scrollbar styling is unchanged; this feature changes only Monaco word wrapping.

## Testing

- Shelf integration proves that a fitting expanded table is not marked, an oversized right-edge table is marked after final placement, and the marker clears when the current width fits while the retained growth demand remains.
- Monaco extension tests prove initial overflow handling, off/on transitions, duplicate suppression, and observer disposal.
- Note editor integration proves the extension is installed and disposed with the existing editor-local extensions.
- Existing auto-width, Monaco configuration, table measurement, formatting, save, cancel, and shelf-layout tests remain green.

## Acceptance criteria

- Word wrapping turns off only when a valid Markdown table still exceeds the note editor's realized width after all available rightward expansion.
- Word wrapping remains on for fitting tables, prose-only notes, and tables made narrow enough to fit again.
- The note never moves left or to another shelf to avoid overflow.
- Automatic note width remains monotonic for the mounted editing session and remains non-persistent.
- Monaco is updated in place; focus, selection, undo history, IME state, and scroll state are preserved.
- No unrelated layout, persistence, or editor behavior changes.
