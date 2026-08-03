# Sticky Top Checklist Heading in Notes

## Context

Rendered note cards have their own vertical scroll container. A top-level Markdown heading (`#`) can display aggregate checklist progress for its section and can also act as the section's collapse control. In a long note, that heading currently scrolls out of view together with the content, so the section title, progress, and collapse action are lost while reading lower rows.

## Goal

Every top-level Markdown `#` heading that displays checklist progress must remain visible at the top of its note card's internal scroll viewport while its section is being read.

The sticky heading must retain its existing:

- title and progress display, including known totals such as `3/8` and open totals such as `24/?`;
- completed-state color;
- collapse and expand interaction;
- keyboard focus behavior and accessible name.

## Scope

The behavior applies only to rendered note cards and only to top-level `#` headings with checklist progress.

It does not apply to:

- a `#` heading without checklist progress;
- headings `##` through `####`, even when they display progress;
- the raw Markdown editor;
- note drag previews;
- Markdown rendered outside a note card's internal viewport.

## Scrolling Behavior

The heading sticks to the top edge of `.note-card__viewport`, not to the browser window or the page header.

When a note contains multiple qualifying `#` headings, each heading becomes sticky when its section reaches the top. The later heading visually replaces the earlier one instead of stacking below it.

The original heading element remains in use; the interface must not create a duplicate floating header. Consequently, progress, completed state, focus, and collapse state have a single source of truth.

## Visual Treatment

The sticky heading uses an opaque background matching the note card surface so scrolled content cannot show through it. It is layered above note content and the existing top scroll-fade overlay.

The heading keeps the card's horizontal content inset and its existing compact typography. Entering or leaving the sticky state must not cause a horizontal or vertical layout jump. Its focus outline must remain visible.

## Implementation Boundary

Prefer the existing rendered heading and native CSS sticky positioning inside the note viewport. No cloned header, scroll listener, intersection observer, or duplicated progress state is needed.

The existing Markdown parsing, checklist aggregation, collapse persistence, and note scroll-state calculations remain unchanged.

## Verification

Automated coverage must distinguish qualifying top-level checklist headings from plain `#` headings and progress-bearing nested headings. It must verify the applied sticky layout behavior without asserting literal CSS source text.

A real-browser regression check uses a scrollable note with:

1. a qualifying `#` heading with progress and enough content to scroll;
2. a `##` heading with progress;
3. a second qualifying `#` heading with progress.

The check verifies that:

- the first qualifying heading remains aligned with the note viewport's top edge while its section scrolls;
- the nested progress heading scrolls normally;
- the second qualifying heading replaces the first at the top;
- the sticky heading remains opaque, clickable, keyboard-focusable, and able to collapse or expand its section;
- a note without a qualifying heading is unchanged.
