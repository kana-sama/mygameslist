# Stable ShelfGrid Offscreen Measurement

## Problem

`ShelfGrid` currently measures natural card heights by temporarily resetting
the live grid, every live card placement, and the height of each note card and
surface. A checklist heading expansion changes `aria-expanded` and child
content, so the grid schedules this measurement while the activated heading
button still owns focus. In Safari, the focused button changes document
coordinates during the transient live reflow; the browser compensates the
document scroll position, then does not reverse that compensation after the
grid placement is restored. The screen recording at
`/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_Jn4Rbb/Screen Recording 2026-08-23 at 06.28.58.mov`
shows the outer page jumping from the active note row to an earlier shelf at
the expansion.

## Required behavior

- Natural-height measurement must not reset or otherwise mutate the live
  grid's placement, row sizing, alignment, card placement attributes, card
  heights, note-card heights, or note-surface heights.
- Measurement uses a temporary offscreen clone under the live grid's parent so
  the clone retains the same ancestor CSS context. The clone has the exact live
  grid width, is fixed outside the viewport, is invisible, inert,
  `aria-hidden`, non-interactive, and removed in a `finally` cleanup.
- Only the clone receives the existing `data-shelf-measuring` marker, natural
  row sizing, cleared shelf placement attributes, start alignment, and `auto`
  measurement heights.
- The measurement clone removes duplicate `id` attributes and disables cloned
  media resource loads (`src`, `srcset`, and `poster` where applicable) before
  it is attached. Measurement must not start duplicate iframe, image, audio, or
  video loads.
- The current natural-height values, shelf composition, column spans,
  expansion behavior, packing freeze behavior, card node identity, focused
  element, and final masonry placement remain unchanged.
- Checklist collapse and expansion still trigger geometry measurement. The fix
  must not ignore `aria-expanded`, bypass real height changes, replace focus,
  add `scrollTo`/`scrollIntoView`, restore captured scroll coordinates, or add
  an `overflow-anchor` workaround.
- No game-specific identifiers or authored database contents appear in
  permanent tests.

## Observable interaction contract

- Activating a checklist heading by pointer or keyboard keeps the activated
  button focused and at stable document coordinates throughout measurement.
- The outer page remains at the user's current scroll position while the
  section opens or closes. The note's inner scrolling, sticky heading layers,
  collapsed/expanded content, and final card height continue to work as before.
- Idle, hover, focus-visible, expanded, and collapsed visuals do not change.

## Verification

- A generic `ShelfGrid` regression must fail against the current implementation
  because it observes the live card being reset during an `aria-expanded`
  remeasurement.
- After the fix, the same regression proves that measurement occurs on an
  offscreen inert clone, the live grid and cards retain their established
  placement and height styles during the measurement callback, the focused
  button remains focused, and the final row span reflects the new natural
  height.
- Existing natural-height, visual-mutation, packing, resize, frozen-composition,
  editor-width, and cleanup tests remain green.
- Run `npm test -- tests/shelf-grid.test.tsx`, `npm test`, and `npm run build`.
- Compare the final local interaction directly with the cited recording at the
  same desktop layout: expand and collapse a heading in a scrolled tall note,
  including idle, hover, focus, active, expanded, and collapsed states. The
  final card packing must match the existing UI while the outer page no longer
  jumps.
