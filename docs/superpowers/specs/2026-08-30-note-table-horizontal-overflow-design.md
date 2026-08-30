# Note Table Horizontal Overflow

## Context

Rendered note content is layered inside `.note-card__text`, a CSS grid. The `.note-card__viewport-frame` grid item keeps its automatic minimum inline size, so a wide Markdown table can make that grid item wider than the note card. The outer `.note-card__surface` then clips the excess. On narrow viewports this cuts off both the table and the checklist total in the note heading instead of containing the table in its existing horizontal scroll area.

Visual reference: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_yBUJIl/Screenshot 2026-08-30 at 16.18.36.png`.

## Goal

Wide Markdown tables must scroll horizontally inside the note card. They must never widen the rendered note viewport or displace the note heading total outside the card.

## User-visible behavior

- A Markdown table wider than the note card remains at its intrinsic width and scrolls horizontally inside `.markdown-table-scroll`.
- The note card, rendered viewport, and heading remain constrained to the card width.
- The checklist total in the note heading remains fully visible; the title yields space first through its existing flexible, zero-minimum-width behavior.
- Tables that already fit, table group collapse behavior, stable table column sizing, note vertical scrolling, sticky headings, editing, attachments, and shelf layout do not change.

## Design

Reset the automatic inline minimum of the rendered viewport grid item by adding `min-width: 0` to `.note-card__viewport-frame`. This lets the grid item shrink to the note card width while preserving the existing nested overflow boundaries:

```text
note-card width
  -> viewport-frame shrinks to the grid track
  -> note viewport and Markdown content stay inside the card
  -> markdown-table-scroll owns horizontal overflow
  -> table keeps intrinsic column widths and scrolls internally
```

The heading already uses a title with `min-width: 0; flex: 1` and a total with `flex: 0 0 auto`. No heading markup or additional overflow rule is required once its ancestor is constrained.

## Verification

- A computed-style regression test uses the production stylesheet and a generic rendered-note fixture. It verifies that the viewport frame has a zero minimum inline size, the table wrapper owns horizontal overflow, the heading title may shrink, and the total may not shrink.
- The test must fail before the production change because `.note-card__viewport-frame` computes to `min-width: auto`.
- Chromium verification at a 360 CSS-pixel viewport confirms that the viewport frame stays within the card, the table wrapper has `scrollWidth > clientWidth` for a wide table, and the heading total is fully inside the card.
