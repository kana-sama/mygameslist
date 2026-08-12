# Affected-Note Checklist Rendering

## Goal

Checking a note task updates and saves only the selected note. Unchanged sibling notes keep their Markdown render trees and are not parsed again.

## Design

Task changes use one optimistic note draft rather than the page-wide saving state. The complete displayed note list remains the save payload. The selected note's task controls remain temporarily disabled, persisted props reconcile the draft, and a failed save restores the prior note and existing error.

`MarkdownView` keeps its public interface but delegates to a memoized render body. The wrapper holds current task and collapse callbacks in refs and passes stable callbacks to that body; the comparator covers Markdown, collapsed sections, decorations, diff inputs, and disabled state.

## Verification

- A task-save regression proves optimistic state, reconciliation, rollback, and a stable sibling Markdown node.
- The regression counts Markdown parsing and proves that only the changed note is parsed again.

## Safari Shelf Layout

Sticky checklist heading source markers, checklist completion classes, and checklist progress text are visual-only mutations. `ShelfGrid` must ignore them so Safari does not transiently clear and remeasure every shelf card while preserving remeasurement for collapse, direct-card, sizing, editor, and other geometry-bearing mutations.

## Checklist Click Stability

While an optimistic task save is pending, task edit, open-marker Add, drag, edit, and card-action DOM stays mounted. Controls use disabled or guarded behavior without child-list churn, preserve focus and page position, and leave sibling task checkboxes available. Metadata, cover, progress, delete, note edit/add/reorder actions wait until the optimistic note reconciles so their save payload cannot overwrite it.

## Final Verification

- Whole-grid regressions prove zero child-list mutations, exact action-node identity, focus, scroll stability, task-save races, and rollback.
- UI acceptance coverage proves progress deletion keeps focus restoration safe without an intervening DOM churn frame.
