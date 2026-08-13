# Responsive Note Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make checklist changes and list/table collapse changes update and persist immediately while rerendering only the affected note and local-change indicator.

**Architecture:** Keep library data in a stable external store with selector subscriptions. Add a targeted patch transition for the two interactive note fields, expose it as a dedicated provider command, and connect individual note cards directly to their note snapshot. Keep the existing full-library mutation pipeline for structural edits.

**Tech Stack:** React 19, TypeScript 7, `useSyncExternalStore`, Vitest, Testing Library, Vite.

## Global constraints

- The approved design is `docs/superpowers/specs/2026-08-14-responsive-note-interactions-design.md`.
- Use test-driven development: add a focused failing test before each behavior change.
- Do not add a state-management dependency.
- Do not debounce or batch user interactions. Every click is one transaction and one immediate persistence attempt.
- Preserve the existing full mutation path for structural changes.
- Permanent tests must use purpose-built generic fixtures. Any benchmark against authored data is temporary and must be removed before finalization.
- Do not create intermediate commits. The specification, plan, implementation, and permanent tests finish as one feature commit.

---

## Task 1: Add a targeted note-field patch transition

**Files:**

- Modify: `src/domain/patch.ts`
- Modify: `src/domain/validation.ts` only if a focused field validator must be exported
- Test: `tests/patch.test.ts`

### 1. Write failing domain tests

Add generic fixtures for one base game and two notes. Cover `bodyMarkdown` and `collapsedChecklistSections` updates through a new exported transition.

The tests must prove:

- the affected note and notes map receive new identities, while the sibling note and unrelated maps retain their identities;
- the patch contains only the correct field operation and preserves unrelated operations and blobs;
- returning a field to its base value removes that field operation;
- a locally created note updates its existing root set operation instead of adding an invalid field operation;
- a same-note root or same-field conflict is rejected without changing the inputs;
- invalid Markdown or collapse values are rejected by targeted validation;
- each supplied `transactionId` and `changedAt` is retained for the changed operation.

Run:

```bash
npm test -- tests/patch.test.ts
```

Expected: the new tests fail because the transition does not exist.

### 2. Implement the minimal transition

In `src/domain/patch.ts`, add an API equivalent to:

```ts
export type InteractiveNoteFieldUpdate =
  | { noteId: string; field: "bodyMarkdown"; value: string }
  | { noteId: string; field: "collapsedChecklistSections"; value: string[] | undefined };

export function updateInteractiveNoteField(input: {
  base: LibraryDatabase;
  effective: LibraryDatabase;
  patch: PatchEnvelope;
  conflicts: readonly PatchConflict[];
  update: InteractiveNoteFieldUpdate;
  changedAt: string;
  transactionId: string;
}): { effective: LibraryDatabase; patch: PatchEnvelope };
```

Implementation requirements:

- validate only the requested field and the resulting patch operation;
- compare the new value with the base value using canonical equality;
- construct, replace, or remove the sparse operation without calling `diffLibrary`, `reconcilePatch`, `applyPatch`, full-library normalization, or full-library validation;
- for a base note, preserve the original base existence/hash contract;
- for a locally created note, replace the value in its root set operation;
- update the effective note and derived timestamps with structural sharing;
- never mutate any input object.

### 3. Run focused tests

```bash
npm test -- tests/patch.test.ts
```

Expected: all targeted transition tests pass.

---

## Task 2: Put provider state behind a selector store and add the dedicated command

**Files:**

- Create: `src/state/libraryStore.ts`
- Modify: `src/state/LibraryContext.tsx`
- Modify: `src/state/pendingPublication.ts` only if a reusable journal update helper is needed
- Test: `tests/library-store.test.tsx`
- Test: `tests/library-context.test.tsx`

### 1. Write failing store and provider tests

Create generic tests proving that:

- the store exposes stable `getSnapshot`, `subscribe`, and selector subscription behavior;
- a selector is not rerendered when its selected value is referentially unchanged;
- `useLibrary()` remains compatible for existing consumers;
- a new `saveNoteInteraction(update)` action persists one click immediately and records exactly one undo entry;
- a second click creates a distinct transaction and persistence attempt;
- a normal local patch and a durable pending-publication journal both receive the new remainder patch correctly;
- a persistence exception leaves the previous snapshot visible, leaves undo unchanged, and exposes the current persistence error;
- an active conflict blocks the targeted action;
- `undoLast()` restores the previous interaction.

Use spies on the storage boundary. Do not assert elapsed time in permanent tests.

Run:

```bash
npm test -- tests/library-store.test.tsx tests/library-context.test.tsx
```

Expected: the new tests fail before the store and command exist.

### 2. Implement the stable store

In `src/state/libraryStore.ts`, implement a small dependency-free store with:

- an authoritative snapshot;
- synchronous snapshot reads;
- subscribe/unsubscribe;
- snapshot replacement after successful persistence;
- a `useLibrarySelector` hook that memoizes equal selections and uses `useSyncExternalStore`.

The context value must contain the stable store and stable actions, not a spread of the current library snapshot. Preserve `useLibrary()` as an identity selector plus actions for compatibility with existing tests and non-optimized call sites.

### 3. Implement `saveNoteInteraction`

In `LibraryContext.tsx`:

- read the latest authoritative snapshot, never a render-captured copy;
- create a fresh transaction id and timestamp for every call;
- call `updateInteractiveNoteField`;
- persist the resulting patch through the correct authority: normal patch storage or pending-publication journal;
- add the previous patch to undo only after persistence succeeds;
- publish the new store snapshot only after persistence succeeds;
- clear a prior persistence error on success and surface a clear error on failure;
- do not run asset garbage collection, full validation, source projection, `diffLibrary`, or `reconcilePatch` in this command;
- do not set the global saving lock.

Keep all structural actions on their existing path and make them publish through the same authoritative store.

### 4. Run focused tests

```bash
npm test -- tests/library-store.test.tsx tests/library-context.test.tsx
```

Expected: store compatibility, immediate persistence, undo, conflict, journal, and rollback tests pass.

---

## Task 3: Connect each note card directly to its interactive snapshot

**Files:**

- Modify: `src/pages/GamePage.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/markdown-tasks.test.tsx`
- Modify: `tests/note-collapse.test.tsx`

### 1. Write failing interaction-boundary tests

Add a connected-game test harness with two generic notes and render counters around:

- the game-page body;
- the affected note card;
- a sibling note card.

Exercise:

- a list checkbox;
- a table checkbox;
- a list/nested-group collapse control;
- a table/subtable collapse control.

For each action, assert:

- the clicked control changes after one click;
- `saveNoteInteraction` receives only the note id, field, and new value;
- the game-page body render count does not increase;
- the sibling note render count does not increase;
- the affected note render count increases only as needed;
- page and note viewport scroll positions stay unchanged;
- controls outside the affected note remain enabled while saving.

Retain the existing presentational `GamePage` tests that use `onSave`; they protect standalone compatibility.

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx tests/note-collapse.test.tsx
```

Expected: connected isolation tests fail on the current parent-level optimistic save path.

### 2. Move interaction ownership to the note boundary

Add an optional connected interaction source to `GamePage` that provides:

- a stable subscription/read API for one note's current interactive fields;
- `saveNoteInteraction` for field writes.

At the note-card boundary:

- subscribe by stable note id;
- merge only current `bodyMarkdown` and `collapsedChecklistSections` into the card's structural note props;
- keep pending/error state local to the affected card;
- use stable callbacks for Markdown;
- do not update `InlineGamePage` state for connected checkbox/collapse writes;
- display a clear local error and restore the persisted snapshot when the command rejects.

Keep the current `onSave` fallback for standalone `GamePage` consumers, but route-backed pages must use the dedicated connected path.

### 3. Make the game route ignore interactive field-only snapshots

In `App.tsx`, subscribe `GameRoute` to game structure, note order/layout, assets, and stable actions without selecting note body/collapse values. Supply the interactive note source separately so a field-only store update reaches the affected note card without rerendering `GameRoute` or `InlineGamePage`.

Structural note changes must still invalidate the route selection normally.

### 4. Run focused tests

```bash
npm test -- tests/markdown-tasks.test.tsx tests/note-collapse.test.tsx
```

Expected: all list/table interaction, scroll, rollback, and note-isolation tests pass.

---

## Task 4: Isolate the application root from interaction-only updates

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx` if the local-change indicator needs a subscribed child boundary
- Modify: `tests/app-selective-diff.test.tsx`
- Create: `tests/note-interaction-render-isolation.test.tsx`

### 1. Write a failing application-level render test

Mount the real provider and route tree with generic library fixtures. Instrument the application root, active game route, affected note, sibling note, and local-change indicator.

After one checkbox action and one collapse action, assert:

- root and route render counts do not increase;
- only the affected note and local-change indicator observe the new snapshot;
- the local operation count and diff content are current when the diff is opened;
- sibling note DOM identity, page scroll, and note scroll are preserved.

Run:

```bash
npm test -- tests/note-interaction-render-isolation.test.tsx tests/app-selective-diff.test.tsx
```

Expected: the current monolithic `LibraryRoutes` subscription fails the root isolation assertions.

### 2. Split selectors at visible update boundaries

Refactor `LibraryRoutes` so that:

- route content subscribes only to route/layout state;
- the local-change indicator is a small subscribed child;
- diff/review computation subscribes to the full patch only inside its own boundary and remains current when opened;
- loading, fatal, storage, publication, conflict, asset, and structural changes keep their existing behavior;
- interactive note field changes do not invalidate `LibraryRoutes`, `GameRoute`, tier/catalog pages, or the game page.

Do not hide stale state behind memoization: every consumer that is allowed to update must read the latest store snapshot through a selector.

### 3. Run focused tests

```bash
npm test -- tests/note-interaction-render-isolation.test.tsx tests/app-selective-diff.test.tsx
```

Expected: root isolation and current diff behavior pass together.

---

## Task 5: Complete behavioral coverage and measure the real interaction path

**Files:**

- Modify: focused tests above as needed
- Temporary only: `tests/note-interaction-benchmark.test.tsx` or `scripts/benchmark-note-interaction.ts`

### 1. Add any missing generic regressions

Confirm permanent coverage for all approved behavior:

- list and table checkboxes;
- lists, nested groups, tables, and subtables;
- one immediate transaction per click;
- no global lock;
- affected-note/root/sibling render boundaries;
- scroll stability;
- persistence rollback and clear error;
- undo, diff, conflict, pending publication, and locally created notes.

### 2. Run a temporary authored-data benchmark

Create a temporary benchmark that loads the heaviest real note and measures repeated representative checkbox and collapse transitions after warm-up.

Record:

- old full `saveGame` mutation-path time;
- new targeted transition/persistence time;
- root, game-page, affected-note, and sibling-note render counts.

Acceptance criteria:

- the targeted path does not call `structuredClone` on the full library, `diffLibrary`, or `reconcilePatch`;
- root, game page, and sibling render deltas are zero;
- the new median interaction cost is materially below the previously measured roughly 58 ms full mutation pipeline and has no visible input delay.

Delete the temporary benchmark before finalization.

### 3. Run the complete verification suite

```bash
npm test
npm run build
```

Expected: the complete test suite and production build pass.

### 4. Inspect and finalize one feature commit

Use Jujutsu only:

```bash
jj status
jj diff
jj describe -m "Optimize note checklist interactions"
jj new
```

Before describing the change, verify that the diff contains only this specification, plan, implementation, and permanent generic tests, with no authored-data benchmark left behind.
