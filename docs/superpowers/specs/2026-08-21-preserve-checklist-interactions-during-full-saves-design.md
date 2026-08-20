# Preserve Checklist Interactions During Full Saves Design

**Date:** 2026-08-21  
**Status:** Approved

## Goal

Prevent a later full game save from restoring stale Markdown or checklist-collapse state after one or more successful inline note interactions.

## Root cause

Route-level render isolation intentionally ignores `bodyMarkdown` and `collapsedChecklistSections`. Each connected note card subscribes to those fields directly, but `InlineGamePage` retains the older route-provided note objects. Structural actions later submit that stale full note list through `saveGame`, overwriting already-durable inline changes.

## Approved behavior

- Inline checkbox and collapse interactions keep their existing immediate, isolated persistence path.
- Before a full save, every existing note that is not being explicitly authored by that save receives the latest `bodyMarkdown` and `collapsedChecklistSections` from the authoritative library store.
- Opening an existing note editor starts from the latest interactive fields, not the route-captured copy.
- When an existing note is explicitly saved from its editor, the editor draft remains authoritative for that note while concurrent interactions in other notes are preserved.
- New notes, deleted notes, note ordering, note grouping, attachments, game metadata, progress items, publication, recovery, conflicts, and undo retain their existing semantics.
- The fix must not make interaction-only updates rerender the application root, game route, game page, or sibling notes.

## Design

Expose a stable synchronous read action for one note's interactive snapshot from `LibraryProvider`, and include it in the route-backed `NoteInteractionSource` beside the existing selector hook and save command.

`InlineGamePage` uses that action in two places:

1. when opening an existing note editor, merge the latest interactive fields into the structural note object;
2. immediately before a full save, merge the latest interactive fields into every submitted existing note except a note explicitly authored by the current editor save.

The merge changes only `bodyMarkdown` and `collapsedChecklistSections`; every structural field continues to come from the pending full-save draft.

## Verification

Permanent generic integration tests must prove:

- multiple successful inline interactions survive a later full save of another note;
- collapse state survives the same boundary;
- opening and saving the affected note editor starts from the latest checked Markdown and preserves the intentional editor draft;
- the existing render-isolation assertions remain green;
- the focused provider/page tests, complete test suite, and production build pass.

