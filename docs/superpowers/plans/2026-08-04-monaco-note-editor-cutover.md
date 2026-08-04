# Monaco Note Editor Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both existing-game and new-game note text surfaces with the compact Monaco Markdown editor while preserving attachments, lifecycle, focus, sizing, and shortcuts and deleting the legacy textarea stack.

**Architecture:** Add one note-specific Monaco adapter that composes the completed list/completion/table capabilities and captures file transfer above the reusable editor. Keep the attachment queue and note chrome in `PlainNoteEditor`, use stable `note:${clientId}` models, and isolate real Monaco from broad JSDOM GamePage suites through a shared low-level test double.

**Tech Stack:** React 19, TypeScript 7, Monaco Editor 0.56, Vitest 4, Testing Library, Vite 8, Jujutsu.

## Global Constraints

- Monaco is the only production note text editor; no mobile or textarea fallback.
- Prefer existing Monaco behavior over custom behavior; do not recreate suggestions, Tab indentation, cursor tracking, or undo.
- Keep word wrap, indent guides, the compact 3px vertical scroll indicator, Markdown highlighting, list Enter, `[` game completion, and global table format-on-type.
- Keep attachments, YouTube, 300/600 height controls, double width, save/cancel, autofocus, and draft lifecycle behaviorally equivalent.
- Use public Monaco APIs only; no private controllers, hidden-textarea queries, direct model edits, manual caret restoration, or custom undo code.
- Use capture-phase file handling only at the note adapter boundary; ordinary text remains Monaco-native.
- Use Jujutsu exclusively. All tasks, tests, specs, review fixes, and cleanup stay in change `vkvtxuntyonklqzsptluvnslstkqlosn`; do not `jj describe` or `jj new` until the complete cutover passes review.
- Follow RED/GREEN TDD and record exact evidence in the ignored SDD ledger.

---

### Task 1: Extract and implement the note file-transfer boundary

**Files:**
- Create: `src/components/fileTransfer.ts`
- Create: `src/components/useNoteFileTransferCapture.ts`
- Create: `tests/note-file-transfer-capture.test.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/pages/GamePage.tsx`

**Interfaces:**
- Produces: `isImageFile(file)`, `snapshotFiles(transfer)`, `hasFilePayload(transfer)`, and `useNoteFileTransferCapture({ disabled, onFiles })`.
- Consumes later: `MonacoNoteEditor` spreads `captureHandlers` on its root and maps `kind` batches to note attachment callbacks.

- [ ] **Step 1: Write RED helper and capture tests**

Cover exact `DataTransfer.items` priority, fallback to `files`, empty-MIME image extensions, ordinary text passthrough, image/file batch order, capture-phase `defaultPrevented`, `dropEffect="copy"`, nested drag-depth behavior, window reset, and disabled consumption without callbacks or highlight.

Use this public contract in the tests:

```ts
const transfer = useNoteFileTransferCapture({
  disabled,
  onFiles(files, kind) {
    received.push({ files, kind });
  },
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```sh
npm test -- tests/note-file-transfer-capture.test.tsx
```

Expected: failure because `fileTransfer.ts` and `useNoteFileTransferCapture.ts` do not exist.

- [ ] **Step 3: Move the pure helpers without changing behavior**

Move the three functions out of `Markdown.tsx`. Import them from `fileTransfer.ts` in both the still-temporary legacy textarea and `GamePage.tsx`. Preserve item priority and Safari extension matching exactly.

- [ ] **Step 4: Implement the capture hook**

Use `onPasteCapture`, `onDragEnterCapture`, `onDragOverCapture`, `onDragLeaveCapture`, and `onDropCapture`. Do not call `stopPropagation`. Use a depth ref and reset it on captured drop plus window `drop`/`dragend`. Emit images first and generic files second.

- [ ] **Step 5: Reach focused GREEN and run affected legacy coverage**

Run:

```sh
npm test -- tests/note-file-transfer-capture.test.tsx tests/markdown-textarea.test.tsx tests/note-groups.test.tsx tests/ui-acceptance.test.tsx
```

Expected: all pass before the production text-surface cutover.

### Task 2: Add native note actions and the note-specific Monaco adapter

**Files:**
- Create: `src/components/monacoNoteActions.ts`
- Create: `src/components/MonacoNoteEditor.tsx`
- Create: `tests/monaco-note-actions.test.ts`
- Create: `tests/monaco-note-editor.test.tsx`
- Modify: `src/components/monacoGameLinkCompletion.ts` only if a live exclusion accessor is proven necessary by RED coverage; otherwise retain its current public options.

**Interfaces:**
- Consumes: `MonacoMarkdownEditor`, `installMonacoMarkdownListEditing`, `installMonacoGameLinkCompletion`, and `useNoteFileTransferCapture`.
- Produces: `MonacoNoteEditorProps` exactly as specified in the design and `installMonacoNoteActions(context, options)`.

- [ ] **Step 1: Write RED note-action tests**

With a fake editor, assert public `addAction` descriptors for:

```ts
KeyMod.CtrlCmd | KeyCode.Enter
KeyCode.Escape
```

Assert save/cancel are ineligible for suggestions, find, hover, snippets, rename, parameter hints, inline suggestions, and IME. Assert cancel also excludes `editorHasMultipleSelections`. Assert the hover action invokes `editor.action.hideHover`, callbacks read current state, disabled save is a no-op, and disposal releases every installed action.

- [ ] **Step 2: Run note-action tests and observe RED**

Run:

```sh
npm test -- tests/monaco-note-actions.test.ts
```

Expected: module-not-found RED.

- [ ] **Step 3: Implement the smallest public-API action installer**

Use `editor.addAction`, context expressions, `editor.inComposition`, and `editor.getAction("editor.action.hideHover")`. Add submit only when `submit` exists, cancel and hover only when `cancel` exists. Do not inspect or modify model text or selections.

- [ ] **Step 4: Write RED adapter composition tests**

Mock only the low-level `MonacoMarkdownEditor` and installers. Assert the adapter passes:

```ts
{
  ariaLabel: "Текст заметки",
  modelKey: "note:client-id",
  value: "# Draft",
  autoFocus: true,
}
```

Invoke its captured `onReady` and assert list, completion, and actions install in order; games/callbacks/submit-disabled values are live after rerender; current game exclusion is forwarded; capture handlers route files; cleanup is reverse-order and throw-safe; new-game props omit save/cancel actions.

- [ ] **Step 5: Implement `MonacoNoteEditor` and extension composition**

Keep live values in one ref. Compose the three installers without changing the base editor. Apply `useNoteFileTransferCapture` to the outer `.monaco-note-editor.note-file-transfer-boundary` and render the base editor inside it.

- [ ] **Step 6: Reach focused GREEN**

Run:

```sh
npm test -- tests/monaco-note-actions.test.ts tests/monaco-note-editor.test.tsx tests/monaco-markdown-editor.test.tsx tests/monaco-markdown-list-editing.test.ts tests/monaco-game-link-completion.test.ts
```

Expected: all adapter, base, list, and completion tests pass without loading real Monaco in the adapter suite.

### Task 3: Cut both GamePage modes over to Monaco

**Files:**
- Create: `tests/mocks/MonacoMarkdownEditorMock.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `tests/game-note-links.test.tsx`
- Modify: `tests/image-lightbox.test.tsx`
- Modify: `tests/library-context.test.tsx`
- Modify: `tests/local-assets-ui.test.tsx`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/note-collapse.test.tsx`
- Modify: `tests/note-groups.test.tsx`
- Modify: `tests/note-media-gallery.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- Consumes: real `MonacoNoteEditor` and a test-only mock of its low-level `MonacoMarkdownEditor` dependency.
- Produces: existing and new-game note cards with stable Monaco models and unchanged note chrome/lifecycle.

- [ ] **Step 1: Add the shared low-level JSDOM double**

Implement the `MonacoMarkdownEditorProps` contract as a controlled accessible textarea inside `.monaco-markdown-editor`, including `autoFocus`, `className`, and `data-model-key`. In each listed GamePage suite, hoist:

```ts
vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));
```

Do not mock `MonacoNoteEditor`; broad suites must exercise its real file-transfer boundary and GamePage integration.

- [ ] **Step 2: Write RED GamePage assertions for the cutover**

Assert:

- editor roots use `.monaco-note-editor` and `data-model-key="note:<clientId>"`;
- multiple new-game notes have distinct stable model keys across text, size, attachment, and reorder updates;
- existing-note save reads the latest body;
- Add Note autofocus plus nearest scroll remains;
- file-created notes do not autofocus;
- new-game editors do not perform note-level save/cancel;
- YouTube-input Escape closes only that input;
- file drop inside the editor remains in the current note and reaches the group handler already prevented;
- storage lock still permits text edits but consumes file gestures.

Run affected cases and observe selectors/behavior fail while `GameLinkMarkdownTextarea` remains.

- [ ] **Step 3: Replace only the note text surface**

Direct-import `MonacoNoteEditor`. Change the game-link context to `{ games, excludeGameId }`. Render:

```tsx
<MonacoNoteEditor
  autoFocus={autoFocus}
  excludeGameId={completion.excludeGameId}
  filesDisabled={storageLocked}
  gameSuggestions={completion.games}
  modelKey={`note:${note.clientId}`}
  onCancel={onCancel}
  onChange={updateBodyMarkdown}
  onFileFiles={addFileFiles}
  onImageFiles={addImageFiles}
  onSubmit={onSubmit ? () => onSubmit(noteRef.current) : undefined}
  submitDisabled={processingImages}
  value={note.bodyMarkdown}
/>
```

Every mutation must assign `noteRef.current` before `onChange`. Change `PlainNoteEditor.onSubmit` to receive the current draft and pass `onSave` directly from `InlineNoteCard`.

- [ ] **Step 4: Remove the textarea focus query and add definite Monaco sizing**

Keep the two requestAnimationFrame calls but only call the article's `scrollIntoView`. Replace textarea selectors with:

```css
.note-card--editing > .monaco-note-editor {
  min-height: var(--note-text-height);
  height: var(--note-text-height);
  flex: 1 0 var(--note-text-height);
}
.monaco-note-editor > .monaco-markdown-editor { height: 100%; }
.note-file-transfer-boundary.is-drag-over { box-shadow: inset 0 0 0 1px var(--accent); }
```

Retain default/double-height variables at 300px/600px and double-width shelf attributes.

- [ ] **Step 5: Migrate integration assertions without imitating Monaco UI**

Replace legacy `combobox`/custom-listbox assertions with controlled note body and provider-level coverage. Keep rendered Markdown-link persistence coverage. Update flow-order selectors to one `.monaco-note-editor` branch and rename textarea-specific drop test descriptions.

- [ ] **Step 6: Reach affected-suite GREEN**

Run:

```sh
npm test -- tests/game-note-links.test.tsx tests/image-lightbox.test.tsx tests/library-context.test.tsx tests/local-assets-ui.test.tsx tests/markdown-tasks.test.tsx tests/note-collapse.test.tsx tests/note-groups.test.tsx tests/note-media-gallery.test.tsx tests/ui-acceptance.test.tsx
```

Expected: all GamePage behavior passes through the low-level editor double, with no Monaco runtime initialization or unhandled browser-service errors.

### Task 4: Delete the legacy textarea implementation and dead logic

**Files:**
- Delete: `src/components/GameLinkMarkdownTextarea.tsx`
- Delete: `tests/game-link-markdown-textarea.test.tsx`
- Delete: `tests/markdown-textarea.test.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/components/markdownGameLinks.ts`
- Modify: `src/components/markdownListEditing.ts`
- Modify: `tests/markdown-game-links.test.ts`
- Modify: `tests/markdown-list-editing.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Retains: bracket completion scanning/formatting, list Enter/fence parsing, renderer, file-transfer helpers, and Monaco extensions.
- Removes: textarea UI, `#` query/insertion, custom result limiting/scoring, and textarea-only bracket indentation.

- [ ] **Step 1: Prove every production consumer is gone**

Run:

```sh
rg -n "GameLinkMarkdownTextarea|PlainMarkdownTextarea|findActiveGameLinkQuery|insertGameMarkdownLink|resolveMarkdownListIndent|game-link-markdown-textarea|plain-markdown-textarea" src tests
```

Before cleanup, matches should be limited to the legacy implementation/tests/styles and assertions being migrated.

- [ ] **Step 2: Delete the legacy UI and remove dead exports**

Delete both component/test files and remove `PlainMarkdownTextarea` from `Markdown.tsx`. Remove its barrel export and all custom popup/textarea CSS.

- [ ] **Step 3: Remove only dead pure logic**

Delete `ActiveGameLinkQuery`, `InsertedGameMarkdownLink`, `findActiveGameLinkQuery`, and `insertGameMarkdownLink`, retaining bracket scanning and link formatting. Delete `MarkdownListIndentDirection`, `MarkdownListIndentEdit`, the indentation-only helpers, and `resolveMarkdownListIndent`, retaining `findParentListLine` because list Enter uses it.

- [ ] **Step 4: Update pure tests and assert zero legacy matches**

Remove only legacy `#` and textarea-indent cases. Re-run the `rg` command and expect no matches except explicit negative cleanup assertions if any.

- [ ] **Step 5: Run focused and full GREEN**

Run:

```sh
npm test -- tests/note-file-transfer-capture.test.tsx tests/monaco-note-actions.test.ts tests/monaco-note-editor.test.tsx tests/markdown-game-links.test.ts tests/markdown-list-editing.test.ts tests/monaco-game-link-completion.test.ts tests/monaco-markdown-list-editing.test.ts
npm test
npm run build
```

### Task 5: Real-browser gate, independent review, and stacked finalization

**Temporary files only:**
- `monaco-note-smoke.html`
- `src/monacoNoteSmoke.tsx`

**Permanent files:**
- Modify only files required by review findings; fold every fix into change `vkvtxuntyonklqzsptluvnslstkqlosn`.

- [ ] **Step 1: Build the disposable real GamePage harness**

Mount an existing-game note plus two new-game notes using production `MonacoNoteEditor`. Include game suggestions, lists, ordinary/grouped tables, attachment callbacks, YouTube UI, and 300/600 controls. Typecheck/build before starting Vite on `127.0.0.1:4173`.

- [ ] **Step 2: Use the Browser skill when a binding is available**

Verify real focus, nearest scroll, separate models, `[` completion/current-game exclusion, list Enter, table formatting, Cmd/Ctrl+Enter, transient-UI then cancel Escape ordering, YouTube Escape isolation, file paste/drop, 300/600 size, one-step undo/redo, disposal, workers, and console cleanliness.

If the Browser runtime reports `No browser is available`, record that exact failure. Do not use standalone Playwright. Always stop Vite and delete the harness with `apply_patch`.

- [ ] **Step 3: Request whole-feature independent review**

Review the complete diff against the design and plan. Fix every Critical/Important finding in the same change and request scoped re-review until approved.

- [ ] **Step 4: Run fresh completion evidence**

Run:

```sh
npm test
npm run build
jj status
jj diff
```

Require zero failing tests, a successful production build, only cutover-related files, and no disposable harness residue.

- [ ] **Step 5: Describe the one stacked feature and create a clean child**

Use this detailed description:

```text
Switch game notes to the compact Monaco editor

Replace the legacy note textarea stack with one Monaco integration:
- compose native list editing, game-link completion, table formatting, and note actions
- preserve attachments, file paste/drop, storage-lock behavior, YouTube, focus, and 300/600 sizing
- give every existing and new-game note a stable independent model
- keep save/cancel callbacks current and let Monaco transient UI handle Escape first
- remove the custom # popup, textarea list shortcuts, and obsolete styles/tests
- isolate the runtime from broad JSDOM suites with a low-level editor double

Cover note actions, file transfer, extension cleanup, model identity, existing/new-game lifecycle, attachment queues, focus/layout, current-game exclusion, legacy cleanup, and production build compatibility.
```

Run `jj describe`, then `jj new`. The final working copy must be a clean empty child.
