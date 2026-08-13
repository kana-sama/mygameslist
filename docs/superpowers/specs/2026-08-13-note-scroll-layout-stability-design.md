# Stable page position while scrolling a note

## Problem

Scrolling a note updates the visual scroll-affordance classes on its
`.note-card__viewport-frame`: `is-scrollable`, `can-scroll-up`, and
`can-scroll-down`. `ShelfGrid` currently treats those descendant class changes
as possible geometry changes and runs a full shelf layout. The measurement pass
temporarily clears card placement and height styles. In Safari that transient
reflow can move the document scroll position, making the page jump as though
application code called `scrollTo`.

The rendered note path does not intentionally scroll the document. The bug is
the unnecessary shelf remeasurement triggered by visual-only state.

## Required behavior

- Changes limited to `is-scrollable`, `can-scroll-up`, and `can-scroll-down` on
  `.note-card__viewport-frame` must not schedule a shelf layout.
- The exception is exact and local. The same class names on another element, or
  any unrelated class change on the viewport frame, must still schedule layout.
- Real geometry changes continue to schedule layout, including card-level class
  changes, `aria-expanded`, child-list changes, and text changes outside the
  existing checklist-progress exception.
- No document scrolling, focus manipulation, scroll restoration, or
  `overflow-anchor` workaround is added. The false layout trigger is removed at
  its source.
- The behavior is generic and is not tied to a game id or a game's stylesheet.

## Verification

- A generic ShelfGrid regression test first proves that changing a viewport
  affordance class currently causes card measurement.
- After the fix, all three affordance-class transitions produce zero card
  measurements.
- The same test proves that an unrelated viewport-frame class and
  `aria-expanded` still cause measurement.
- Run the complete test suite and production build.
- In the browser, scroll a note from its top through an affordance transition
  and confirm that the outer page position remains stable.
