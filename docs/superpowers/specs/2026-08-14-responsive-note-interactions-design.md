# Responsive Note Interactions Design

**Date:** 2026-08-14  
**Status:** Approved

## Goal

Make routine note interactions feel immediate without redrawing the application from the root:

- change checkboxes in Markdown lists and tables;
- collapse and expand lists, nested groups, tables, and subtables;
- keep the current scroll position and the rest of the page visually stable.

## Approved behavior

- Every click updates the affected control immediately.
- Every click is saved immediately as its own local change; there is no debounce or batching window.
- Saving does not block the rest of the interface.
- Only the affected note and the local-changes indicator may update. The application root, game page, and sibling notes must not redraw because of the interaction.
- The existing undo, local-diff, publication, recovery, and conflict behavior remains unchanged.
- If persistence fails, the interaction is rolled back and a clear error is shown.

## Design

### Stable application state boundary

Library state moves behind a stable external store. React components subscribe only to the smallest state slice they render. Updating one note therefore notifies that note and the local-changes indicator, while unrelated routes and notes retain their existing render output.

### Dedicated interactive-note update path

Checkbox and collapse changes use a specialized update path for `bodyMarkdown` and `collapsedChecklistSections`. It updates only the affected note and its local patch operation with structural sharing.

This path does not clone, compare, validate, or reconcile the entire library. The existing full-library pipeline remains the source of truth for structural operations such as editing game metadata, adding or removing entities, import, publication, recovery, and conflict resolution.

### Durability and compatibility

Each interaction remains a complete local transaction:

1. derive the new value for the affected note field;
2. construct or remove the corresponding patch operation;
3. validate the targeted operation and note value;
4. persist the updated local patch, including pending-publication journal state when present;
5. publish the new store snapshot to subscribed components.

If persistence fails, the new snapshot is not published. Locally created notes, returning a field to its base value, active conflicts, undo history, and publication journals retain their current semantics.

## Verification

Permanent tests use generic fixtures and verify:

- list and table checkbox changes;
- list, nested-group, table, and subtable collapse changes;
- one transaction and one immediate persistence attempt per click;
- rollback and visible error on persistence failure;
- unchanged undo, diff, conflict, and pending-publication behavior;
- render isolation: the affected note and local-changes indicator update, while the root, game page, and sibling notes do not redraw.

A temporary benchmark uses the heaviest real note to compare the old and new interaction paths. Because authored library data is not a stable code contract, this benchmark is removed before the feature is finalized.

## Out of scope

- rewriting the application in Rust;
- changing note syntax or visual design;
- batching or debouncing edits;
- optimizing unrelated structural edits or the initial page load;
- changing publication, synchronization, or recovery semantics.
