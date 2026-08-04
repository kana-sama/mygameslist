# Monaco Markdown List Editing

## Context

The compact Monaco foundation exists as the first change in the editor-migration stack, but it is not yet used by note cards. The current textarea adds application-specific Markdown list behavior on top of native text editing. Monaco 0.56 already owns ordinary typing, selection, undo/redo, multiple cursors, Tab/Shift+Tab indentation, and its standard indent/outdent commands. Its standalone Markdown language definition does not provide list-aware Enter rules.

This feature adds only the missing structural Enter behavior as a reusable Monaco extension. It does not port the textarea event system or replace Monaco commands that already exist.

## Goal

When a user presses an unmodified Enter in a supported Markdown list item, Monaco must perform the existing list-aware transformation as one native undoable edit. All other input remains Monaco-native.

## Scope

This feature includes:

- an editor-local Monaco list-editing extension;
- reuse of the existing pure, tested list-Enter resolver;
- conversion of the resolver result into a minimal Monaco edit and explicit caret state;
- one undo boundary around a successful structural edit;
- safe fallback to Monaco's native newline command;
- automated and real-browser verification.

This feature does not:

- replace the note textarea yet;
- override Tab, Shift+Tab, Cmd/Ctrl+[ or Cmd/Ctrl+];
- add game-link completion;
- format Markdown tables;
- add save, cancel, paste, drop, or attachment behavior;
- duplicate Monaco's selection, multi-cursor, IME, or suggestion handling.

## Product Behavior

The structural behavior remains the already established note behavior:

- continue bullet, ordered, and task-list markers;
- increment ordered markers and repair only a sequential same-level tail;
- split an item at the caret;
- remove or outdent empty items according to their nesting level;
- preserve CRLF documents;
- do nothing inside fenced code;
- leave selected ranges and unsupported positions to Monaco.

The extension handles exactly one collapsed cursor. Multiple cursors or a non-empty selection fall back to Monaco, because Monaco is the authority for those editing modes.

Monaco remains responsible for indentation and outdentation through its built-in Tab/Shift+Tab and standard commands. The textarea-specific Cmd/Ctrl+bracket translation is intentionally not ported.

Markdown editors use a stable two-space indentation policy (`tabSize: 2`, spaces, no indentation detection), so Monaco's native indentation commands produce conventional nested Markdown and useful indent guides consistently across notes.

## Command Priority

The extension installs one editor-local action for plain Enter plus a scoped context key that is enabled only for one collapsed cursor on a list-looking line. Its keybinding is active only while editable editor text has focus and no IME composition or suggestion widget is active. This allows Monaco's suggestion controller to accept or dismiss completions before list editing and leaves ordinary paragraphs, selections, and multiple cursors entirely on Monaco's native path.

Modified Enter combinations are not registered and remain available to Monaco or later application actions.

If the pure resolver declines the position, the action delegates to Monaco's native `type` command with a newline rather than editing the model directly.

## Edit and Undo Contract

The existing resolver returns the complete next document and caret offset. The adapter computes the smallest single replacement by trimming the common prefix and suffix, converts offsets through the model's public position/range APIs, and applies it with `editor.executeEdits`.

A successful structural Enter:

- emits one Monaco content-change transaction;
- uses explicit post-edit selection state;
- is surrounded by Monaco undo stops;
- is fully reverted by one Cmd+Z;
- never calls `model.setValue`.

The adapter is disposed with the component's existing `onReady` extension lifecycle.

## Errors and Recovery

If the editor has no model, the selection is unsupported, the resolver returns no edit, or the computed diff is empty, input falls back to Monaco's native newline behavior. The extension does not surface its own persistent UI or error state.

## Verification

Automated tests cover action registration and cleanup, command priority, structural list edits, caret restoration, one-change forwarding, native fallback, selected ranges, multiple cursors, and fenced code.

A disposable real-browser harness verifies bullet, ordered, task, and empty nested-list behavior, native Tab/Shift+Tab, one-step undo/redo, ordinary paragraphs, and the absence of console errors. The harness is removed before finalizing the feature change.

## Stacked-Change Boundary

The specification, plan, implementation, tests, smoke harness fixes, and detailed description belong to Jujutsu change `tzvqotrkowoomltuknuvzysloltvsozt`. Later game completion, table formatting, and note cutover remain separate descendants.
