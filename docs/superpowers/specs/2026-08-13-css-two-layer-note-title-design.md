# CSS Two-Layer Sticky Note Title

## Context and Root Cause

Rendered note cards have their own vertical scroll viewport and also move with the document. The current page-sticky heading implementation measures live geometry during both kinds of scrolling, clones a selected checklist heading into a fixed React portal, hides the source, and repeatedly synchronizes focus and markup.

The Safari failures shown in:

- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_IXk9lL/Screen Recording 2026-08-13 at 19.10.04.mov`
- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_2MYM8C/Screen Recording 2026-08-13 at 19.12.35.mov`

show the fixed clone detaching from the card and the page position jumping while the inner note scrolls. The implementation depends on two independently changing scroll coordinate systems and mutates the rendered source during scrolling, so further geometry corrections would preserve the unstable architecture.

## Goal

Replace the runtime scroll-driven clone with two copies rendered once by React and positioned entirely by native CSS sticky layout:

1. an inner visual copy in the note scroll viewport;
2. an outer page copy in a non-scrolling layer at the same visual location.

No JavaScript runs in response to page or note scrolling for sticky-title behavior. Scrolling must not add or remove title elements, classes, inline geometry, focus, or heading React state.

## Qualifying Heading

Only a top-level Markdown `#` heading that is the note's first nonblank parsed block qualifies. It qualifies whether or not it has checklist progress.

If prose, a list, a table, media Markdown, or any other rendered block precedes the first `#`, that heading remains ordinary single-copy, non-sticky content. This is the CSS-only interpretation of “the first line with h1”: the page layer never leaves its note-text block start, so it is created only for a title that originates there.

All later headings are ordinary non-sticky content, including:

- any top-level `#` heading after the first rendered block;
- `##`, `###`, and `####` headings;
- later headings that display checklist progress.

Markdown outside a rendered note card, raw Markdown editors, and drag previews keep their existing single-copy behavior.

## Rendering and Layers

`MarkdownView` checks whether parsed block zero is a top-level `#`. When a rendered note supplies a local page-heading host, that title block is rendered twice from the same React state and event handlers:

- the in-flow copy remains inside `.note-card__viewport` and is marked as a visual duplicate;
- the semantic page copy is rendered into the local host inside the same note card, outside the scrolling viewport.

The local host is part of the note-card DOM. It is not attached to `document.body` or the application shell and does not use measured `left`, `top`, or `width` values.

The note text area overlays the local host and scroll viewport in the same CSS grid cell. This gives both copies the same width and initial visual origin without reserving a second heading-height or changing masonry measurements. The note surface uses non-scrolling clipping that does not become the sticky containing block.

## Sticky Behavior

The inner visual copy uses `position: sticky; top: 0` relative to `.note-card__viewport`.

The note viewport uses `overscroll-behavior: none`, not `contain`, as the separately requested boundary behavior. Reaching either end of the inner note must neither rubber-band the note contents nor chain the gesture into document scrolling. This CSS rule is not treated as the cause or repair of the separate unexpected page-jump defect.

The outer page copy uses `position: sticky; top: var(--app-header-height)` and remains bounded by its own note text/card. It therefore follows the page until it reaches the application header, stays below that header while the note remains present, and leaves with the note at the trailing boundary.

In the base theme, the semantic outer heading must share the inner heading's content-block inset as well as its width. The outer layer must fully cover the inner layer from the first rendered pixel; no second baseline or clipped duplicate may be visible before scrolling. Per-game CSS may set that inset to zero when its title art deliberately extends to the viewport edge.

Because the outer layer is outside `.note-card__viewport`, inner scrolling cannot change its page position. Because both layers are native sticky elements, Safari rubber-band or container scrolling cannot trigger React layout work or document scroll anchoring through heading replacement.

## Interaction and Accessibility

The outer page copy is the sole semantic and interactive copy. It keeps the heading role, title, checklist progress, completed/collapsed state, collapse button, disabled state, and existing save behavior.

The inner copy is visual only:

- its heading subtree is `aria-hidden`;
- its controls are removed from sequential focus navigation;
- it cannot receive pointer events.

Both copies are produced from the same parsed block and React state. There is no HTML snapshot, delegated DOM click, duplicated progress state, or focus transfer.

## Removed Runtime Behavior

Delete `PageStickyChecklistHeading` and all behavior specific to it:

- document/application-shell portal selection;
- `getBoundingClientRect` heading selection and geometry snapshots;
- page, capture-scroll, note-scroll, and resize listeners;
- `requestAnimationFrame`, `ResizeObserver`, and `MutationObserver` synchronization;
- source-hidden classes;
- copied `innerHTML` and delegated DOM clicks;
- focus handoff between source and mirror;
- shelf-layout exceptions that existed only for the source-hidden class.

The existing note scroll affordance state may continue to use its current React `onScroll`; this change removes only heading-related scroll JavaScript.

## Styling Compatibility

Base styles define the layer contract generically. Per-game styles continue to decorate the rendered headings through descendant selectors and may style the new outer host without any game-specific JavaScript.

The Xenoblade Chronicles 2 stylesheet must preserve the approved title art, shadows, clipped corners, progress indicator, responsive sizing, completed state, and focus treatment on both copies. It must stop treating later top-level headings as sticky.

No dependency is added.

## Verification

Generic automated coverage must prove:

- a rendered note whose first nonblank block is `#` has two DOM copies but only one accessible heading/control;
- a `#` preceded by ordinary content remains single-copy and non-sticky, so the page layer never overlays the preamble;
- the outer control changes the same collapse/save state as the previous source control;
- a later `#` and nested headings are rendered exactly once and are not sticky;
- a plain first `#` also receives the two-layer treatment;
- Markdown outside note cards remains single-copy;
- the outer host is CSS sticky below `var(--app-header-height)`, the inner copy is sticky at `0`, the two layers overlap without adding a row, and the note surface no longer creates a hidden-overflow sticky container;
- the base-theme inner and outer heading boxes start at the same vertical coordinate and the opaque outer box fully covers the inner copy;
- the note viewport computes `overscroll-behavior: none` so neither bounce nor scroll chaining can separate the layers;
- page and inner scroll events do not create, remove, replace, hide, or geometrically restyle the heading copies;
- obsolete source-class shelf-layout behavior is removed without changing checklist completion layout behavior.

The full test suite and production build must pass. Real-browser validation at desktop and narrow widths must scroll the inner note and the document separately, confirm the title remains attached at both boundaries, confirm later headings scroll normally, activate the outer collapse control by keyboard and pointer, and confirm no page jump or horizontal overflow.
