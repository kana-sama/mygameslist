# Monaco Markdown List Editing Implementation Plan

> **Execution:** use subagent-driven development, test-driven development, Jujutsu only, and fold all fixes into change `tzvqotrkowoomltuknuvzysloltvsozt`.

**Goal:** Add the missing list-aware Enter behavior to the reusable Monaco editor while leaving all editing modes already supplied by Monaco untouched.

**Architecture:** A pure adapter converts the existing `resolveMarkdownListEnter` result into a minimal Monaco `executeEdits` transaction. An editor-local action owns the plain-Enter keybinding and delegates unsupported cases to Monaco's native `type` command. The generic `MonacoMarkdownEditor` remains unchanged.

**Tech stack:** React 19, TypeScript 7, Monaco Editor 0.56, Vitest 4, Testing Library, Vite 8, Jujutsu.

## Global Constraints

- Treat the matching design spec as the product contract.
- Reuse `resolveMarkdownListEnter`; do not rewrite list parsing in the Monaco adapter.
- Use only public Monaco editor/model/range/selection/action APIs.
- Never call `model.setValue` for a user command.
- Keep Monaco-native Tab/Shift+Tab, Cmd/Ctrl+bracket commands, multi-cursor, selections, suggestions, and IME behavior.
- Do not modify `GamePage`, `PlainNoteEditor`, textarea components, completion, attachments, or tables.
- Follow RED/GREEN TDD and record exact commands/results.
- Use `jj` exclusively. Inspect `jj status` and `jj diff`; fold the completed feature into `tzvqotrkowoomltuknuvzysloltvsozt`, then create one clean empty child.

## Task 1: Add the Monaco list-editing adapter with focused tests

**Create:**

- `src/components/monacoMarkdownListEditing.ts`
- `tests/monaco-markdown-list-editing.test.ts`
- `tests/monaco-markdown-editor-config.test.ts`

### Step 1: Write failing registration and behavior tests

Build a narrow fake editor/model that exposes the public methods used by the adapter:

- `addAction`
- `getModel`
- `getSelections`
- `executeEdits`
- `pushUndoStop`
- `trigger`
- `createContextKey`
- cursor/model/composition events used to refresh the scoped context;
- model `getValue`, `getOffsetAt`, `getPositionAt`, and `getValueInRange` as needed.

Assert that installation registers one plain-Enter action with an application-scoped context key and an editable-text-focus keybinding context that excludes the suggestion widget and IME composition, refreshes the scoped key after cursor/content changes, and returns a disposable.

Invoke the captured action and assert:

- `- AlphaBeta` split at the caret becomes `- Alpha\n- Beta` with the caret after the new marker;
- an ordered list edit and renumbering is one `executeEdits` call;
- a task item continues as an unchecked task;
- one successful command adds undo stops and never triggers the native `type` command;
- ordinary text, a selected range, and multiple cursors keep the scoped context disabled so Monaco receives Enter directly;
- a conservative list-looking candidate that the full resolver rejects, no model, and an empty diff safely delegate to `editor.trigger(source, "type", { text: "\n" })`;
- disposing the returned value disposes the registered action.

Add a RED configuration assertion for `tabSize: 2`, `insertSpaces: true`, and `detectIndentation: false`.

Run:

```sh
npm test -- tests/monaco-markdown-list-editing.test.ts
```

Expected RED: the module does not exist.

### Step 2: Implement minimal edit derivation

Export a pure helper that compares the old and next text, trims the longest common prefix and suffix without overlapping, and returns:

- the replacement start/end offsets;
- replacement text;
- the resolver's final caret offset.

Return `null` for identical values. Convert offsets to Monaco positions only in the editor adapter.

### Step 3: Implement and export the extension

Export:

```ts
export function installMonacoMarkdownListEditing(
  context: MonacoMarkdownEditorReadyContext,
): Monaco.IDisposable
```

Register one action with a stable application-prefixed ID and label. The keybinding is plain `KeyCode.Enter`; its context requires editable editor text focus and excludes `suggestWidgetVisible` and `isComposing`.

Create one editor-scoped boolean context key. Refresh it from the current model/selection on installation, cursor-selection changes, and model-content changes. It is true only for one collapsed cursor on a line prefix that can contain a Markdown list marker; the pure resolver remains the authority for the actual transformation. Reset the context on disposal.

The action must:

1. read one collapsed selection and current model text;
2. call `resolveMarkdownListEnter` with model offsets;
3. delegate to Monaco `type` when unsupported;
4. derive and apply one minimal edit with an explicit collapsed `Selection` at the returned caret;
5. surround a successful structural edit with undo stops.

### Step 4: Reach GREEN

Run the focused test until all cases pass, then run the existing pure list suite:

```sh
npm test -- tests/monaco-markdown-list-editing.test.ts tests/markdown-list-editing.test.ts
```

## Task 2: Public export and integration contract

**Modify:**

- `src/components/index.ts`
- `tests/monaco-markdown-list-editing.test.ts`

### Step 1: Add an export regression

Import the extension through the component barrel and prove it is the same public function. Observe RED before adding the export.

### Step 2: Export the extension

Add only the new adapter to the barrel. Do not modify `MonacoMarkdownEditor` or install the behavior globally; later note editors will opt in through `onReady`.

Update `createCompactMarkdownEditorOptions` to use two-space, inserted-space Markdown indentation with indentation detection disabled. These options deliberately feed Monaco's native Tab/Shift+Tab and indent/outdent commands; do not add custom keybindings for them.

### Step 3: Run focused and full automated verification

```sh
npm test -- tests/monaco-markdown-list-editing.test.ts tests/markdown-list-editing.test.ts
npm test
npm run build
```

## Task 3: Disposable real-browser smoke check

**Temporary only:**

- `monaco-smoke.html`
- `src/monacoSmoke.tsx`

Create a compact harness using `MonacoMarkdownEditor` with `onReady={installMonacoMarkdownListEditing}`. Run Vite on `127.0.0.1:4173` and verify in the Codex in-app browser:

1. Enter continues a bullet item and one Cmd+Z/Cmd+Shift+Z round-trip is exact.
2. Ordered-list Enter inserts the next marker and repairs a sequential tail.
3. A checked task continues as an unchecked task.
4. Repeated Enter on an empty nested item outdents and exits according to the established behavior.
5. Enter in an ordinary paragraph remains a native newline.
6. Enter in fenced code remains native.
7. Tab/Shift+Tab and standard indent/outdent commands remain Monaco-native.
8. Multiple cursors and a selected range remain Monaco-native.
9. No browser console or worker errors occur.

Stop Vite and delete both temporary files with `apply_patch`.

## Task 4: Review, fold, and clean state

Inspect:

```sh
jj status
jj diff
```

Request an independent task review against this spec and plan. Fix Critical/Important findings in one descendant fix change and fold them into the same feature change; use a scoped re-review.

Run fresh final verification, then describe the feature in detail:

```text
Add Monaco Markdown list editing

Extend the compact Monaco editor with list-aware Enter behavior:
- reuse the established Markdown list resolver instead of duplicating parsing
- apply structural changes as minimal native Monaco edits with explicit caret state
- keep each successful edit in one undoable transaction
- delegate unsupported selections, multiple cursors, ordinary text, and fenced code to Monaco
- retain Monaco-native indentation, suggestions, IME, selection, and multi-cursor commands

Cover registration, cleanup, bullet/ordered/task behavior, caret restoration, native fallbacks, browser interaction, and production build compatibility.
```

Use `jj describe -r tzvqotrkowoomltuknuvzysloltvsozt`, fold the working change into it if necessary, then `jj new tzvqotrkowoomltuknuvzysloltvsozt`. Final `jj status` and `jj diff` must be clean.
