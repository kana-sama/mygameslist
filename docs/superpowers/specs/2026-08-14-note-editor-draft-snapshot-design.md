# Note Editor Draft Snapshot Isolation Design

## Problem

The route-backed note interaction optimization subscribes each rendered note to a live interaction snapshot. `ConnectedInlineNoteCard` currently overlays that snapshot onto the note even while the ordinary editor is open. Each editor change updates the local draft, then the snapshot overlay immediately replaces the new `bodyMarkdown` with the last persisted value, so saving closes the editor without changing the note.

## Approved behavior

- While an existing note is being edited through the ordinary editor, the editor draft is the authority for the note body and collapsed-section fields.
- While a note is displayed, the interaction snapshot remains authoritative for checklist toggles and collapsed checklist sections.
- Saving an ordinary edit persists the edited body and renders it after the editor closes.
- The checklist interaction render-isolation behavior remains unchanged.

## Design

Keep the existing connected wrapper, but select its input by mode. When `props.editing` is true, pass the draft note through unchanged. Otherwise, build the displayed note by overlaying the live interaction snapshot as today. Add the regression at the actual `App` route boundary so it exercises `noteInteractionSource`, the ordinary editor, persistence, and the rendered result together.

## Verification

Run the focused route-backed regression before the source change and require it to fail because the typed value is restored to the old snapshot. After the minimal conditional overlay, rerun the same test and the complete `note-interaction-render-isolation.test.tsx` file.
