# Note Editor Draft Snapshot Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve ordinary note-editor drafts while retaining isolated live updates for displayed checklist interactions.

**Architecture:** `ConnectedInlineNoteCard` continues to subscribe to live note-interaction state, but overlays that state only in display mode. A route-level regression exercises the actual connected `App` path instead of the unconnected `GamePage` test harness.

**Tech Stack:** TypeScript, React 19, Vitest 4, Testing Library, Jujutsu.

## Global Constraints

- In ordinary editing mode, the local editor draft is authoritative.
- In display mode, the interaction snapshot remains authoritative for note body and collapsed checklist sections.
- Preserve checklist interaction render isolation.
- Finalize exactly one Jujutsu commit containing the specification, plan, test, and implementation.

---

### Task 1: Keep the connected editor draft authoritative

**Files:**
- Modify: `tests/note-interaction-render-isolation.test.tsx:174-243`
- Modify: `src/pages/GamePage.tsx:854-889`
- Test: `tests/note-interaction-render-isolation.test.tsx`

**Interfaces:**
- Consumes: `InlineNoteCardProps.editing`, `NoteInteractionSource.useNoteInteractionSnapshot(noteId)`.
- Produces: `ConnectedInlineNoteCard` passes the unmodified draft to `InlineNoteCard` while editing and the snapshot-backed note while displaying.

- [ ] **Step 1: Write the failing route-level regression**

Add a test in the existing `route-backed note interaction render isolation` describe block. Render `<App />`, locate the affected note card, open `Редактировать заметку`, replace `Текст заметки` with the literal `Edited through normal editor`, assert the textbox retains that literal, click `Сохранить заметку`, and assert the rendered heading `Edited through normal editor` appears. This test must use the existing real `App` and LibraryProvider setup; keep only the existing Monaco boundary mock.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm test -- tests/note-interaction-render-isolation.test.tsx -t "keeps an ordinary editor draft authoritative" --reporter=verbose`

Expected: FAIL before the source change because the textbox or rendered note reverts to the original snapshot body.

- [ ] **Step 3: Implement the minimal mode-aware overlay**

In `ConnectedInlineNoteCard`, make `currentNote` equal the incoming `note` when `props.editing` is true. Only overlay `snapshot.bodyMarkdown` and snapshot collapsed sections when `props.editing` is false. Keep `saveInteraction` and display-mode behavior otherwise unchanged.

- [ ] **Step 4: Run focused and file-level verification**

Run: `npm test -- tests/note-interaction-render-isolation.test.tsx -t "keeps an ordinary editor draft authoritative" --reporter=verbose`

Expected: the focused regression passes.

Run: `npm test -- tests/note-interaction-render-isolation.test.tsx`

Expected: the complete file passes with zero failures.

- [ ] **Step 5: Inspect and finalize one Jujutsu commit**

Run `jj status` and `jj diff`, confirm only this fix's specification, plan, source, and regression test are present, then describe the working-copy change as `Preserve ordinary note editor drafts` and create a fresh working-copy change with `jj new`.
