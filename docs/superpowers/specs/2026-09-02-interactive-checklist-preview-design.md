# Interactive Checklist Preview Design

**Date:** 2026-09-02

## Status and precedence

Approved correction to the page checklist search feature. This specification supersedes only the earlier statements that rich-preview content is noninteractive and that rich-tooltip references inside definition bodies are invalid. All other requirements in `2026-09-01-page-checklist-search-design.md` and `2026-08-30-markdown-rich-tooltips-design.md` remain in force.

## Goal

The annotation preview in page checklist search is a live, source-backed rendering of the annotation, not a read-only facsimile. Every interaction already supported by rendered note Markdown must work from the preview while the palette remains open.

## Observable behavior

- Safe Markdown links are real links. External links follow the same target and `rel` rules as links in notes.
- Simple hover annotations retain their normal hover behavior.
- Spoilers can be revealed and hidden.
- Checklist controls in rich definition bodies can be toggled with the same regular and partial transitions as note checklists, including `Shift+Click` and `Cmd+Click`.
- Rich-tooltip references inside a rich definition body are valid. Activating one opens the referenced tooltip above the checklist palette.
- Content inside a nested tooltip keeps the same interactions, including source-backed checklist controls.
- A nested tooltip replaces the currently open tooltip rather than recursively embedding its body. Cyclic references therefore do not cause recursive rendering.
- Missing, empty, or duplicate referenced definitions degrade to non-trigger text as elsewhere in Markdown.
- Clicking preview content does not navigate to the selected checklist item and does not close the palette. Row-body click and `Enter` remain the only navigation actions.
- Keyboard focus can reach interactive preview content through the existing palette focus trap.
- The approved `690×366px` palette, `44% / 56%` split, typography, row density, footer, and preview styling do not change.
- Inline authoring chrome such as add-item and edit-item buttons is not added to preview. The requirement covers interactions of rendered content, not the note editor UI.

## Source-backed mutation

Checklist changes in a rich definition body update that exact definition in the original note Markdown.

This mutation contract applies only while the body is rendered in checklist-search preview, including a nested tooltip opened from that preview. Checklist controls in an ordinary rich tooltip opened from the note remain read-only, preserving the pre-correction note-tooltip behavior.

- The palette carries a stable annotation identity, including its rich anchor, alongside the selected checklist entry.
- Before saving, GamePage rereads the authoritative note snapshot, rebuilds the checklist index, and revalidates the checklist entry, annotation identity, anchor, and current definition body.
- A domain helper replaces only the validated definition body and preserves the source document's line ending and four-space definition indentation conventions.
- The existing per-note interaction ownership prevents preview saves from overlapping palette item toggles or direct note saves.
- The palette may render an optimistic body while the save is pending. On success it refreshes from the authoritative index; on failure it discards optimism, rereads authority, and shows the existing single-line footer error.
- A failed or stale save never records recent-item history and never writes another definition with the same label or coordinates.

## Shared Markdown behavior

- The shared Markdown renderer remains the single implementation of links, hints, spoilers, checklists, and rich-tooltip triggers.
- Rich definition bodies receive the note-level definition registry so nested references resolve against the original note rather than against the isolated body substring.
- Allowing nested references is a shared rich-tooltip syntax improvement, available in ordinary note tooltips as well as checklist preview.
- Source-backed checklist persistence is not a shared ordinary-tooltip change: it is scoped to checklist-search preview and nested tooltips opened from that preview.
- Nested bodies are resolved lazily when the user activates a trigger. Search indexing includes the direct definition body and its visible nested-reference labels; it does not recursively inline every referenced body into the parent search field.
- Unsafe URLs remain filtered by the existing `safeUrl` path.

## Accessibility and layering

- Links and buttons retain their native roles and focusability.
- The palette focus trap includes interactive descendants in the preview.
- A rich tooltip opened from the preview is painted above the palette overlay and exposes the existing dialog semantics and close control.
- Closing a nested tooltip restores focus to its trigger in the preview. Closing the palette restores focus to the original palette opener.

## Verification

Permanent generic tests must cover:

- links, simple hints, and spoilers remaining interactive in preview;
- regular and partial checklist transitions saving the exact rich definition body;
- authoritative stale-target rejection, rollback, and per-note overlap protection;
- nested rich references becoming valid and opening above the palette;
- interactive checklist content inside a nested tooltip saving its referenced definition;
- missing/duplicate definitions and cyclic references remaining finite and safe;
- preview interaction not invoking row navigation or closing the palette;
- keyboard focus reaching preview controls;
- unchanged palette geometry and visual styling.

Browser verification must exercise the real GamePage at `1280×800` and confirm links, spoilers, a direct preview checkbox, and a nested tooltip without palette geometry shift.
