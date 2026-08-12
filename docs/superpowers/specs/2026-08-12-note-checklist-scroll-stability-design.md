# Affected-Note Checklist Rendering

## Goal

Checking a note task updates and saves only the selected note. Unchanged sibling notes keep their Markdown render trees and are not parsed again.

## Design

Task changes use one optimistic note draft rather than the page-wide saving state. The complete displayed note list remains the save payload. The selected note's task controls remain temporarily disabled, persisted props reconcile the draft, and a failed save restores the prior note and existing error.

`MarkdownView` keeps its public interface but delegates to a memoized render body. The wrapper holds current task and collapse callbacks in refs and passes stable callbacks to that body; the comparator covers Markdown, collapsed sections, decorations, diff inputs, and disabled state.

## Verification

- A task-save regression proves optimistic state, reconciliation, rollback, and a stable sibling Markdown node.
- The regression counts Markdown parsing and proves that only the changed note is parsed again.
