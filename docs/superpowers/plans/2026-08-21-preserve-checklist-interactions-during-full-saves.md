# Preserve Checklist Interactions During Full Saves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep durable inline checklist and collapse interactions authoritative across later full game saves.

**Architecture:** Add a stable synchronous note-interaction reader to the provider actions and route-backed interaction source. At the game page boundary, merge its latest two interactive fields into stale structural note drafts before full saves, except for the one note explicitly authored by the active editor.

**Tech Stack:** React 19, TypeScript 7, `useSyncExternalStore`, Vitest, Testing Library, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-21-preserve-checklist-interactions-during-full-saves-design.md`

## Global Constraints

- Inline checkbox and collapse interactions keep their existing immediate, isolated persistence path.
- A full save must use the latest `bodyMarkdown` and `collapsedChecklistSections` for every existing note not explicitly authored by that save.
- The active editor draft remains authoritative for the existing note it saves.
- Opening an existing note editor must start from the latest interactive fields.
- Interaction-only updates must not rerender the application root, game route, game page, or sibling notes.
- Use only generic fixtures; do not encode authored `data/` content in permanent tests.
- Use Jujutsu exclusively and finish this fix as exactly one commit containing this spec, this plan, implementation, and tests.

---

### Task 1: Preserve current interactive note fields across full saves

**Files:**

- Modify: `src/state/LibraryContext.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `tests/note-interaction-render-isolation.test.tsx`
- Include: `docs/superpowers/specs/2026-08-21-preserve-checklist-interactions-during-full-saves-design.md`
- Include: `docs/superpowers/plans/2026-08-21-preserve-checklist-interactions-during-full-saves.md`

**Interfaces:**

- Extend `NoteInteractionSource` with `readNoteInteractionSnapshot(noteId: string): NoteInteractionSnapshot | undefined`.
- Add a stable provider action with the same synchronous return contract, backed by `libraryStore.getSnapshot().effective.notes[noteId]`.
- The returned snapshot contains only `bodyMarkdown` and optional `collapsedChecklistSections`.

- [ ] **Step 1: Write failing integration regressions**

In `tests/note-interaction-render-isolation.test.tsx`, use the existing generic two-note route fixture and real provider. Add tests equivalent to:

```tsx
it("preserves inline checklist and collapse interactions when another note is fully saved", async () => {
  // Check the affected task and collapse its group.
  // Edit and fully save the sibling note.
  // Assert the affected task remains checked and the group remains collapsed.
});

it("opens the note editor from the latest checked Markdown and preserves its draft", async () => {
  // Check the affected task.
  // Open that note's ordinary editor and assert its value contains `- [x] Affected task`.
  // Append ordinary text, save, and assert both the checked task and new text remain.
});
```

Assert consumer-visible DOM state and persisted behavior rather than only action mock calls.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/note-interaction-render-isolation.test.tsx
```

Expected: the new regression fails because the later full save or editor opening sees route-captured Markdown/collapse state.

- [ ] **Step 3: Add the latest-snapshot read boundary**

In `LibraryContext.tsx`, add a stable action equivalent to:

```ts
readNoteInteractionSnapshot: (noteId) => {
  const note = libraryStore.getSnapshot().effective.notes[noteId];
  return note ? {
    bodyMarkdown: note.bodyMarkdown,
    collapsedChecklistSections: note.collapsedChecklistSections,
  } : undefined;
}
```

Expose it through `LibraryActions`, `actionsRef`, and `useLibrarySelector` consumers without subscribing the route to interactive field changes.

In `App.tsx`, carry the stable action through `GameRouteSelection` and the memoized `NoteInteractionSource`.

- [ ] **Step 4: Merge current interactive fields only at full-save boundaries**

In `GamePage.tsx`, add a focused helper that merges the latest interactive snapshot into an `EditableNote` while preserving all structural fields. Removing `collapsedChecklistSections` from the snapshot must remove it from the merged note rather than leave a stale array.

Before `onSave`, merge current snapshots into all submitted existing notes except ids explicitly authored by the current editor save. Structural saves such as progress changes and note moves pass no authored ids. `saveNote` passes its existing stable note id as authored. New notes have no stored snapshot and remain unchanged.

When `beginNoteEdit` opens an existing note, merge its latest snapshot first so the editor draft contains every prior inline interaction.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/note-interaction-render-isolation.test.tsx tests/markdown-tasks.test.tsx tests/note-collapse.test.tsx tests/library-context.test.tsx
```

Expected: all focused tests pass with no new warnings attributable to the change.

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm test
npm run build
```

Expected: the complete test suite and production build pass.

- [ ] **Step 7: Inspect and finalize exactly one Jujutsu commit**

Run:

```bash
jj status
jj diff
jj describe -m "Preserve checklist progress during full saves"
jj new
```

The finalized commit must contain only this spec, plan, implementation, and generic permanent tests.

