# Stable Columns for Collapsible Markdown Table Groups

## Context

Collapsing a Markdown table group currently sets its content `<tbody>` to `display: none`. The browser then excludes those cells from automatic table layout, so a column can become narrower when the hidden group contains its widest value. The same problem occurs on first render when the saved state already contains a collapsed group.

## Goal

Column widths must be identical to the widths produced with every group expanded. This must hold both when a user toggles a group and when the table initially renders with saved collapsed state.

Collapsed rows must still:

- consume no vertical space;
- remain unavailable for pointer and keyboard interaction;
- stay out of the accessibility tree;
- continue contributing their intrinsic cell widths to table layout.

Progress totals, completion styling, checkbox behavior, group headings, horizontal scrolling, and collapse-state persistence must not change.

## Design

Use the table-specific `visibility: collapse` behavior for collapsed group content instead of removing that row group from layout with `display: none`.

The collapsed content `<tbody>` remains a table row group and keeps the existing `hidden` state used by the component. Its collapsed styling overrides the default hidden display with `display: table-row-group` and applies `visibility: collapse`.

CSS defines collapsed table rows and row groups as taking no display space without otherwise changing table layout. Consequently, every cell continues to constrain its column, including cells inside groups that are already collapsed on first render. No JavaScript measurement, resize observer, duplicated sizing rows, or persisted pixel widths are needed.

References:

- [CSS 2.2: Dynamic row and column effects](https://drafts.csswg.org/css2/#dynamic-effects)
- [WebKit visibility-collapse implementation history](https://bugs.webkit.org/show_bug.cgi?id=8735)

## Accessibility and interaction

The group toggle retains its existing `aria-expanded` and `aria-controls` relationship. Collapsed checkboxes and links must not appear in the browser accessibility snapshot or receive focus. Expanding the group restores the same rows and controls without changing column widths.

## Verification

Automated regression coverage will verify that collapsed table content uses table-row-group layout plus collapsed visibility rather than `display: none`. Existing interaction tests continue to verify independent toggling and saved state.

A real-browser regression check will render a table whose widest first-column cell belongs to a collapsible group and compare column measurements in three states:

1. every group expanded;
2. the widest group collapsed by the user;
3. the page loaded with that group already collapsed.

Each corresponding column width may differ by at most 0.5 CSS pixels, while the collapsed row group has zero height and its controls are absent from the accessibility snapshot.

## Fallback

If the supported browser runtime does not honor the specified table-collapse behavior, the fallback is to measure the fully expanded table and apply those widths through a `<colgroup>`. That approach is intentionally deferred because it adds resize, font-loading, and zoom synchronization that the native table layout already provides.
