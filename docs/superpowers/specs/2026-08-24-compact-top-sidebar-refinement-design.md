# Compact Top Sidebar Refinement Design

## Context

This specification supersedes the wide top-mode geometry in `2026-08-24-global-sidebar-layout-design.md` without changing its global browser persistence, control semantics, default side mode, or mobile activation behavior.

The normative visual references are:

`/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_t3hJyf/Screenshot 2026-08-24 at 03.04.14.png`

`/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_elXdzC/Screenshot 2026-08-24 at 03.15.14.png`

`/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_vzjXtZ/Screenshot 2026-08-24 at 03.24.10.png`

Together, the references establish the horizontal sequence cover → details → progress → unused space → far-right tools. It must not be reinterpreted as stretched content tracks.

## Goal

Make the top sidebar compact and convenient: keep cover, bounded details, and progress packed at the left; keep layout/delete controls vertical at the far right; and remove the unhelpful rendered `Изменено` metadata row.

## Layout

- The outer game page remains one column in top mode, with notes below the sidebar.
- The wide sidebar columns become `160px minmax(320px, 360px) minmax(0, 1fr) auto` with `12px` gaps.
- The center details column grows only to `360px`. It never absorbs all surplus page width.
- The progress column begins immediately after details and takes the remaining width, but its cells stay packed at its left edge. Its surplus space appears between the cells and the far-right tools, never between details and progress.
- The progress grid uses `repeat(auto-fit, minmax(88px, 96px))` with start justification so every row contains as many stable compact cells as fit before wrapping.
- The cover occupies column 1 across the title and metadata rows (`grid-row: 1 / span 2`).
- `.game-sidebar__tools` occupies the `auto` far-right column across rows 1–2 and stacks its existing layout/delete controls vertically.
- The title remains one visual line in top mode: its trigger clips with an ellipsis while retaining its full accessible name and edit control.
- The inline error occupies details column row 3. Progress stays in column 3 across the content rows.
- The rendered `Изменено` metadata row is absent in both sidebar modes.
- Under normal no-error wide content, the top panel is no taller than the cover.
- From `1020px` through `1100px`, top mode uses `160px 320px minmax(0, 1fr) 26px` with `10px` gaps so the normal five progress cells remain on one row.
- At `1019px` and narrower, top mode uses `112px minmax(0, 1fr) 26px`; the dedicated third `26px` tools column prevents action overlap, and progress becomes the full-width row below.
- At `500px` and narrower, the compact track becomes `96px minmax(0, 1fr) 26px`.

## Non-Goals

- Do not change persistence, button labels/icons/order, React props, side mode, note-grid layout, progress card dimensions, or shared interaction styles.
- Do not restore game-specific CSS or visual decoration from the reference; only its observable compact structure is normative.

## Acceptance Criteria

- Computed desktop styles expose the exact four compact tracks and non-stretched details maximum.
- The cover computes to column 1 across the title and metadata rows; the vertical tools compute to the far-right auto column across those rows.
- The top-mode title trigger computes to a single truncated line, without changing its accessible name.
- The game metadata does not render `Изменено`.
- Top-mode progress computes an auto-fit `88px`–`96px` grid with start justification.
- The existing persistent mode and control tests remain green.
- Focused CSS/UI tests, the root suite, and the production build pass.
