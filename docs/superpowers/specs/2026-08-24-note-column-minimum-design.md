# Note Column Minimum Design

## Goal

Let ordinary note columns become slightly narrower by changing their shared minimum width from `360px` to `350px`.

## Scope

- Change the shared `--note-column-min` used by rendered note lists and note editor grids to `350px`.
- Keep the existing auto-fill grid behavior, gaps, shelf packing, double-width spans, drag preview size, and responsive one-column rules unchanged.
- Update the canonical layout description in `DESIGN.md`.

## Acceptance Criteria

- Both `.notes-list` and `.note-editors-grid` compute `--note-column-min` as `350px`.
- No other `360px` measurement is changed by this feature.
- Focused CSS behavior tests, the complete repository test suite, and the production build pass.

