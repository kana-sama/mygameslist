# Page-Sticky Note Checklist Heading

## Context

Rendered note cards have an internal scroll viewport. A progress-bearing top-level Markdown `#` heading is already sticky inside that viewport and is bounded by its top-level Markdown section. When the page itself scrolls, the whole card viewport can move above the visible content boundary, taking the internally sticky heading with it even though part of the card remains visible.

The application header is itself sticky. In this specification, the visible content boundary is the bottom edge of `.app-header`, or the browser viewport's top edge when no application header is present.

## Goal

Keep the applicable top-level checklist heading fully visible at the visible content boundary whenever its note card crosses that boundary and any part of the card remains below it.

The heading remains fully visible even when the remaining visible part of the card is shorter than the heading. It disappears only when the card has completely crossed the visible content boundary.

## Scope

The behavior applies only to rendered note cards and only to top-level Markdown `#` headings with checklist progress.

It does not apply to:

- a `#` heading without checklist progress;
- headings `##` through `####`, even when they display progress;
- the raw Markdown editor;
- note drag previews;
- Markdown rendered outside a rendered note card.

The existing section-bounded sticky behavior inside `.note-card__viewport` remains unchanged while the card has not crossed the visible content boundary.

## Page-Sticky Behavior

When a card's top edge is at or below the visible content boundary, the original heading renders exactly as it does today and no page-level mirror exists.

When the card's top edge crosses above the boundary and its bottom edge remains below the boundary, the card renders one page-level mirror of the applicable progress-bearing top-level heading. The mirror is fixed immediately below the application header and is horizontally aligned to the original heading's rendered left edge and width.

The mirror is rendered through a document-body portal so note-surface clipping, the internal scroll viewport, masonry stacking contexts, and drag-and-drop containers cannot crop it. Each card manages its own mirror, so cards intersecting the boundary in different masonry columns can show their headings simultaneously.

The mirror remains fully visible until the card's bottom edge crosses the visible content boundary. It is not pushed out or clipped when less than one heading-height of the card remains visible.

## Heading Selection

The current heading is selected from direct top-level checklist headings in `.markdown-section` elements.

Selection uses live section geometry, which already incorporates both document scrolling and `.note-card__viewport` scrolling:

1. Choose the last qualifying section whose top edge is at or above the visible content boundary.
2. If no qualifying section has reached the boundary yet, choose the first qualifying heading in the note.
3. A later qualifying top-level heading replaces the earlier mirror when its section reaches the boundary.
4. Plain top-level headings do not replace a checklist-total mirror because they cannot provide the required total.

This keeps one progress-bearing heading visible for the full crossed-card interval when the note has at least one such heading.

## Content, Interaction, and Accessibility

The mirror reproduces the original heading's:

- inline title markup;
- known or open checklist total;
- completed and collapsed classes;
- `aria-expanded` and disabled state;
- compact width, wrapping, color, and opaque note-surface background.

Clicking the mirror's collapse control delegates to the original React-managed control. React remains the source of truth for Markdown, totals, completed state, collapse persistence, and save behavior.

While a mirror is present, its original heading receives a source-hidden class. `visibility: hidden` preserves the original layout geometry and internal scroll behavior while removing the duplicate control from visual rendering, pointer interaction, focus navigation, and the accessibility tree. If the original control held focus when page-sticky mode begins, focus moves to the mirror. Mirror focus is preserved across state synchronization and heading replacement when possible.

When page-sticky mode ends, the source-hidden class is removed. If focus was inside the disappearing mirror and the source control is visible again, focus returns to the original control.

## Geometry and Updates

Each rendered card measures only its own card, viewport, qualifying sections, and active source heading. Measurements run:

- once after layout;
- on captured scroll events, covering both page and internal note scrolling;
- on window resize;
- after note Markdown or collapsed-section state changes;
- after `ResizeObserver` reports card or viewport geometry changes;
- after masonry changes the card's placement attributes without changing its size.

Scroll, resize, and placement measurements are coalesced through one `requestAnimationFrame` per card. State updates occur only when the selected source, mirrored content/state, or rounded geometry changes.

All listeners, animation frames, observers, and source-hidden classes are removed on cleanup.

## Error Handling and Fallbacks

If the card, viewport, or a qualifying heading cannot be measured, the page-level mirror is omitted and the existing internal sticky behavior remains available. If the application header is absent, the browser viewport's top edge is used as specified above.

If `ResizeObserver` is unavailable, scroll, resize, and React layout updates still keep the mirror functional.

If no qualifying top-level heading exists, no scroll, resize, resize-observer, or placement-observer listeners are installed and no mirror is rendered. A later Markdown change re-evaluates the note and installs them if a qualifying heading appears.

## Verification

Automated integration coverage must verify that:

- no mirror exists before the card crosses the visible content boundary;
- a fully visible fixed mirror exists when the card top is above the boundary and its bottom is still one pixel below it;
- the mirror disappears when the card bottom reaches the boundary;
- a later qualifying top-level section replaces an earlier one after either page or internal scrolling;
- a plain top-level heading does not replace the most recent checklist-total heading;
- clicking and focusing the mirror preserve collapse behavior, saved state, and a single accessible control;
- two cards in different columns can expose independently aligned mirrors;
- nested checklist headings and detached Markdown remain unchanged.

Related Markdown-task, note-collapse, shelf-layout, and production-build checks must remain green. A real-browser check must confirm alignment below the sticky application header, multi-column behavior, section replacement, full visibility at the card's trailing boundary, interaction, focus, and cleanup when scrolling back.
