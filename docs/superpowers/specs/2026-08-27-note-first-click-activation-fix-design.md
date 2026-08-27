# Note First-Click Activation Fix

## Problem

After note activity has been cleared by interacting outside all notes, the first actionable click inside a note can run before that note is recorded as active. A checklist checkbox therefore refreshes the completed-content snapshot and disappears immediately, while a `Скрыто N пунктов` or `Скрыто N секций` button loses its temporary reveal. The note receives its active border only afterward. Existing tests hide this ordering gap by dispatching `pointerDown` manually before `click`.

## Goal

Make the first checkbox or hidden-content-summary click after leaving all notes both activate the target note and complete its intended action in that same interaction.

## Design

- Keep the existing document-capture `pointerdown` listener for early pointer activation and drag-compatible behavior.
- Keep the existing document-capture `focusin` listener for keyboard focus transfer.
- Register the same activity-transfer function for document-capture `click` as a fallback. Capture ordering updates the synchronous active-note ref before descendant checkbox `onChange` or summary `onClick` handlers run.
- Preserve the current no-op path when the target note is already active, so the additional listener does not duplicate state changes or refresh work.
- Remove the `click` listener with the existing effect cleanup.

## Scope

- Change only note activity event routing in `src/pages/GamePage.tsx` and its generic UI regression coverage in `tests/ui-acceptance.test.tsx`.
- Do not change completed-checklist filtering rules, refresh timing, persistence, motion, focus styling, authored data, or dependencies.

## Validation

- From an explicitly inactive state, a click-only checkbox interaction activates its note and leaves the newly checked row visible until activity later leaves the note.
- From an explicitly inactive state, a click-only hidden-content summary activates its note and reveals its owned content on the first click.
- Each regression test must fail against the pre-fix implementation without manually dispatching `pointerDown` or `focusIn` for the actionable click.
- Run the focused UI tests, the full test suite, and the production build with pristine output.
