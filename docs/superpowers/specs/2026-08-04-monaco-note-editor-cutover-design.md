# Monaco Note Editor Cutover

## Context

The application now has a compact Monaco Markdown foundation, native list continuation, native `[` game-link completion, and global Markdown table format-on-type. Game notes still render their editable text through `GameLinkMarkdownTextarea`, which duplicates list and completion behavior and owns file paste/drop through a plain textarea.

The approved direction is Monaco everywhere on the desktop application. Application size and mobile fallback are out of scope. The final cutover must replace the text surface for both existing-game notes and every simultaneously edited new-game note, while preserving the surrounding note product behavior.

## Goal

Every editable game note uses the compact Monaco editor with word wrap, indent guides, the compact scroll indicator, Markdown highlighting, native hotkeys, native `[` game links, list continuation, and table formatting. Attachments, YouTube links, note sizing, save/cancel behavior, focus, drag/drop, and draft lifecycle remain behaviorally equivalent.

There is no textarea fallback, no custom suggestion popup, and no second implementation of a behavior already owned by Monaco.

## Note-Specific Editor Boundary

Add a direct-import-only `MonacoNoteEditor` above the reusable `MonacoMarkdownEditor`. It is the note integration boundary, not a second editor implementation.

```ts
export interface MonacoNoteEditorProps {
  modelKey: string;
  value: string;
  gameSuggestions: readonly Game[];
  excludeGameId?: string;
  autoFocus?: boolean;
  filesDisabled?: boolean;
  submitDisabled?: boolean;
  onChange(value: string): void;
  onSubmit?(): void | Promise<void>;
  onCancel?(): void;
  onImageFiles(files: File[]): void;
  onFileFiles(files: File[]): void;
}
```

The wrapper hardcodes the accessible label `Текст заметки`, owns the note file-transfer surface, and composes editor extensions. It does not expose textarea rows, arbitrary keyboard handlers, or a placeholder. It remains outside `src/components/index.ts`, so importing generic components never initializes Monaco.

The base `MonacoMarkdownEditor` continues to own model creation, controlled echoes, external replacements, focus, failure UI, and disposal. The note wrapper never calls `setValue`, restores a cursor, or manages undo itself.

## Stable Models and Extension Composition

Every note model key is exactly `note:${note.clientId}`. Body text, rank, group, attachments, height, and width never participate in model identity. This preserves undo across ordinary note rerenders and gives simultaneous new-game notes independent models.

When a note is saved, cancelled, or deleted, its wrapper unmounts. The base editor then disposes the editor, model, completion provider, list action, and note actions. Reopening a note creates a fresh editing session from saved state.

The note wrapper composes, in order:

1. `installMonacoMarkdownListEditing` for structural list Enter;
2. `installMonacoGameLinkCompletion`, reading the latest game array from a ref and applying `excludeGameId` as defense in depth;
3. editor-local note actions when note-level save/cancel callbacks exist.

The global table provider remains registered once by `monacoEditorRuntime`; it is never installed per note. Disposables are released in reverse order. If an installer throws, already-created resources are disposed before the error reaches the base editor boundary.

Callback, game-list, and disabled-state values are read through live refs because `onReady` runs only when the stable model is created.

## Native Save, Cancel, and Escape Ordering

Existing-game note editors keep:

- `Cmd+Enter` on macOS and `Ctrl+Enter` elsewhere to save;
- `Escape` to cancel editing;
- disabled save while attachment preparation is in progress.

New-game notes do not install note-level save or cancel. Their lifecycle remains owned by the surrounding new-game form.

Actions use public `editor.addAction`, `KeyMod`, `KeyCode`, context expressions, `getAction`, and `inComposition` only. They do not use wrapper DOM key handlers, private controllers, or manual selection/model edits.

The save/cancel actions are inactive during IME composition and while Monaco transient UI is visible:

- suggestions;
- find;
- hover;
- snippets;
- rename input;
- parameter hints;
- inline suggestions.

Cancel is also inactive while Monaco has multiple selections, so native Escape removes secondary cursors first. Built-in widgets receive their normal Escape before note cancellation. Hover is the one Monaco UI without its own Escape binding in 0.56, so a small editor-local Escape action invokes the public `editor.action.hideHover`; a later Escape may cancel the note.

The YouTube URL input is a sibling of Monaco. Escape in that input closes only the input and leaves the note editor mounted.

## Game-Link Completion

The wrapper installs the existing Monaco completion provider. Typing `[` opens Monaco's built-in suggestion UI and accepting a game inserts `[Title](#/games/id)`. Games are read live, without the legacy eight-result cap or custom scoring popup. Existing-game editors exclude the current game both in the page context and at the provider boundary; new-game editors use the full supplied list.

The legacy `#` query, custom combobox/listbox, manual selection restoration, and custom suggestion keyboard handling are removed.

## File Paste and Drop

Pure transfer helpers move out of the Markdown renderer into `src/components/fileTransfer.ts`:

```ts
export function isImageFile(file: File): boolean;
export function snapshotFiles(transfer: DataTransfer): File[];
export function hasFilePayload(transfer: DataTransfer): boolean;
```

A note-specific `useNoteFileTransferCapture` hook attaches capture-phase paste and drag handlers to the outer `MonacoNoteEditor` element. It never depends on Monaco's hidden textarea or private DOM.

The contract is:

- ordinary text paste and non-file drag/drop remain native and are not prevented;
- `DataTransfer.items` file entries take priority over `files`, avoiding duplicates;
- Safari files with an empty MIME type are recognized as images by extension;
- image files are emitted first as one batch, followed by generic files as one batch;
- file paste/drop is prevented before reaching Monaco or the note-group drop handler;
- propagation is not stopped, so group handlers can observe `defaultPrevented` and clear their own state;
- dragover requests `dropEffect = "copy"`;
- a drag-depth counter prevents highlight flicker across Monaco's nested DOM;
- drop, window drop, and dragend reset drag state;
- locked storage still consumes file gestures and prevents navigation, but emits no files and shows no highlight.

The hook only recognizes and routes files. `PlainNoteEditor` retains the sequential attachment queue, quota preflight, pending-byte accounting, image/file preparation, errors, processing state, active/unmount guard, and consume-once initial file batches.

## GamePage Integration

`PlainNoteEditor` keeps ownership of attachments, YouTube UI, size controls, footer actions, errors, and async queueing. It replaces only `GameLinkMarkdownTextarea` with `MonacoNoteEditor`.

Every note mutation updates `noteRef.current` before publishing the new draft. Save buttons and Monaco save actions pass `noteRef.current`, preventing a model change followed immediately by `Cmd+Enter` from persisting stale text.

The game-link context carries both the supplied games and the current game ID. Existing-game notes receive that ID as `excludeGameId`; new-game notes receive no exclusion.

Existing-game editing continues to mount at most one draft. New-game mode continues to mount every draft concurrently, with form-level Save/Cancel and no note-level shortcut interception. Text editing remains available when asset storage is locked.

## Focus and Layout

The base Monaco editor receives `autoFocus`. `PlainNoteEditor` no longer queries or focuses a textarea. Its existing two-animation-frame layout step only scrolls the note card into the nearest visible area after Monaco mounts.

The current focus rules remain:

- editing an existing note focuses Monaco;
- a note created by the Add Note button in new-game mode focuses Monaco;
- a note created by a file drop does not steal focus.

The note wrapper has a definite `height`, `min-height`, and flex basis of `var(--note-text-height)`. Default height remains 300px; double height remains 600px. Double width and shelf packing remain unchanged. The inner generic Monaco editor fills the wrapper. Native textarea resize is intentionally removed; the existing 300/600 controls are the only note height controls.

## Test Boundary

Real Monaco remains covered by the foundation, list, completion, table, runtime, and note-action suites. The real `MonacoNoteEditor` is tested with the low-level editor mocked so extension composition, current refs, file routing, shortcut installation, and cleanup are deterministic.

GamePage JSDOM suites mock only `MonacoMarkdownEditor` with one shared controlled textarea double. They continue to exercise the real note wrapper, capture hook, attachment queue, page lifecycle, sizing classes, and form behavior without initializing Monaco's browser services. Native suggestion UI is not reproduced in the double.

The browser gate mounts the real GamePage and checks focus, 300/600 sizing, multiple models, `[` completion, current-game exclusion, list Enter, table formatting, save/cancel ordering, YouTube Escape isolation, file paste/drop, disposal, undo, workers, and console cleanliness. If no browser binding is available, the exact environment failure is recorded rather than substituting standalone Playwright.

## Cleanup

The cutover removes:

- `GameLinkMarkdownTextarea.tsx` and its barrel export;
- `PlainMarkdownTextarea` and its UI suite;
- legacy `#` game-link query/insertion helpers and tests;
- legacy textarea-only `Cmd/Ctrl+[` and `Cmd/Ctrl+]` list indentation resolver and tests;
- custom textarea/autocomplete popup CSS and selectors.

Shared renderer code, Monaco list Enter, native Tab/Shift+Tab, native completion, global table formatting, and pure transfer helpers remain.

## Success Criteria

- Existing and new-game notes render Monaco, never the legacy textarea component.
- All agreed editing, attachment, lifecycle, focus, and sizing behavior is preserved.
- Monaco built-ins own suggestions, word wrap, Tab indentation, cursor movement, and undo.
- No custom `#` popup or duplicated list-editing implementation remains.
- Generic component imports still do not initialize Monaco.
- Focused tests, the complete suite, production build, independent review, and the available browser gate are clean before the stacked feature commit is described.
