# Insertable Note Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create an anonymous note group after any existing group while changing the fewest possible persisted note groups.

**Architecture:** Add one pure rank-allocation helper beside the existing note-group helpers in `GamePage.tsx`. It returns the prospective right-group rank changes and the new group's rank; both saved-game and new-game flows consume that result, while a shared horizontal action row renders add-note and add-group actions after each group.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, CSS, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Keep `DEFAULT_NOTE_GROUP_RANK` at `1024` for existing data compatibility; use a separate insertion step of exactly `2048`.
- Append with `lastGroupRank + 2048`; insert with `left + Math.floor((right - left) / 2)` whenever `right - left > 1`.
- When no integer midpoint exists, change only the minimum necessary prefix of groups to the right: add `2048 * 1` to the first affected group's old rank, `2048 * 2` to the second, and so on, stopping as soon as the last shifted rank is below the next untouched old rank.
- Creating a group opens its first note editor; empty groups are never persisted.
- Cancelling a new saved-game note must discard prospective rank shifts. The new-game form keeps all changes local until the game is saved.
- Render «Добавить заметку» and «Добавить группу» in one horizontal row after every existing group, including the final group; do not retain a separate vertical trailing action.
- Preserve existing file-drop and note-drag creation of a new trailing group.
- Follow test-driven development: add behavioral tests, observe the expected failures, then add the minimum production changes.
- Finish this feature as exactly one Jujutsu commit containing this specification, plan, implementation, and permanent tests.

---

### Task 1: Allocate and render insertable note groups

**Files:**
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Test: `tests/note-groups.test.tsx`
- Include: `docs/superpowers/specs/2026-08-13-insertable-note-groups-design.md`
- Include: `docs/superpowers/plans/2026-08-13-insertable-note-groups.md`

**Interfaces:**
- Consumes: `EditableNote`, `EditableNoteGroup`, `noteGroupRank`, `groupDraftNotes`, `DEFAULT_NOTE_GROUP_RANK`, and the existing saved-game/new-game note creation flows.
- Produces: `NOTE_GROUP_RANK_STEP = 2048` and `prepareNoteGroupAfter(notes: EditableNote[], leftGroupRank?: number): { notes: EditableNote[]; groupRank: number }`.
- Produces: a shared horizontal action-row rendering path used by existing groups in both game modes.

- [ ] **Step 1: Write failing pure allocation tests**

Extend the imports in `tests/note-groups.test.tsx` with `prepareNoteGroupAfter`. Add literal behavioral cases that catch an incorrect append gap, premature exhaustion, a leftward shift, an unnecessarily large shifted suffix, or loss of notes within a shifted group:

```tsx
expect(prepareNoteGroupAfter([editable(NOTE_A_ID, 1024, 1024)], 1024).groupRank).toBe(3072);

const midpointNotes = [editable(NOTE_A_ID, 1024, 1024), editable(NOTE_B_ID, 1024, 3072)];
expect(prepareNoteGroupAfter(midpointNotes, 1024)).toEqual({ notes: midpointNotes, groupRank: 2048 });

const crowded = [
  editable(NOTE_A_ID, 1024, 1024),
  editable(NOTE_B_ID, 1024, 1025),
  editable(NOTE_C_ID, 1024, 1026),
  editable("55555555-5555-4555-8555-555555555555", 1024, 9000),
];
const prepared = prepareNoteGroupAfter(crowded, 1024);
expect(prepared.groupRank).toBe(2048);
expect(groupDraftNotes(prepared.notes).map((group) => group.groupRank)).toEqual([1024, 3073, 5122, 9000]);
```

Build a fixture with endpoint group ranks `1024` and `3072`, insert ten groups successively into the leftmost remaining interval, and add each returned rank to the fixture. After the tenth insertion, call the helper on both intervals adjacent to the most recently inserted group and assert that both calls return an unchanged set of existing group ranks and a strict integer midpoint. This catches reducing the step to `1024`, which would force a shift at that point.

Run:

```bash
npm test -- tests/note-groups.test.tsx -t "allocates space for inserted note groups"
```

Expected: FAIL because `prepareNoteGroupAfter` does not exist and appending still uses the old gap.

- [ ] **Step 2: Implement the minimum pure rank allocator**

Add the public constant and result helper beside `nextEmptyNoteGroupRank`:

```ts
export const NOTE_GROUP_RANK_STEP = 2048;
export interface PreparedNoteGroup { notes: EditableNote[]; groupRank: number }

export function prepareNoteGroupAfter(notes: EditableNote[], leftGroupRank?: number): PreparedNoteGroup {
  // Empty list: preserve DEFAULT_NOTE_GROUP_RANK.
  // Last group: append NOTE_GROUP_RANK_STEP.
  // Available integer gap: return its floor midpoint without cloning notes.
  // Exhausted gap: build old-rank -> shifted-rank mappings for only the
  // necessary right prefix, update every note in each mapped group, and
  // return the midpoint between the left rank and first shifted rank.
}
```

Change `nextEmptyNoteGroupRank` to use `NOTE_GROUP_RANK_STEP`, preserving `DEFAULT_NOTE_GROUP_RANK` for an empty list. Keep all ranks nonnegative safe integers under the existing domain contract; do not renumber unrelated legacy groups.

- [ ] **Step 3: Verify allocator GREEN**

Run:

```bash
npm test -- tests/note-groups.test.tsx -t "allocates space for inserted note groups"
```

Expected: PASS with no warnings or errors.

- [ ] **Step 4: Write failing interaction and layout tests**

Add component tests for both `mode="game"` and `mode="new"`:

```tsx
const actionRows = document.querySelectorAll(".note-group-actions");
expect(actionRows).toHaveLength(2);
expect(within(actionRows[0] as HTMLElement).getByRole("button", { name: "Добавить заметку в группу 1" })).toBeInTheDocument();
expect(within(actionRows[0] as HTMLElement).getByRole("button", { name: "Добавить группу после группы 1" })).toBeInTheDocument();
```

On a saved page with groups `1024`, `1025`, and `1026`, click «Добавить группу после группы 1», assert the new editor is rendered between the first and shifted right groups, enter text, save it, and assert the submitted group ranks are the literals `1024`, `2048`, `3073`, and `5122`. Start the same action again and cancel; assert `onSave` was not called and the original groups still have their original rank attributes.

In the new-game form, create at least two groups, use the first group's «Добавить группу» action, and assert the new editor's containing group is between the original groups. Preserve the existing checks for adding files or dragging a note to a new trailing group.

Run:

```bash
npm test -- tests/note-groups.test.tsx
```

Expected: FAIL because add-group actions do not exist after persisted groups and the trailing actions are still vertical.

- [ ] **Step 5: Wire allocation into both editing modes**

For the saved-game page, keep prospective shifted notes in explicit local state only while editing the first note of an inserted group. Derive rendered groups and `saveNote` input from those prospective notes. Clear them on cancellation or successful save; do not call `persist` merely to make space.

For the new-game form, use a functional `setDraftNotes` update that calls `prepareNoteGroupAfter(values, leftGroupRank)` and appends the first draft note to `prepared.notes` at `prepared.groupRank`. Existing-group note creation continues using that group's rank.

Refactor the group rendering in both modes so every existing group is followed by:

```tsx
<div className="note-group-actions">
  <NoteGroupAddButton text="Добавить заметку" ... />
  <NoteGroupAddButton text="Добавить группу" ... />
</div>
```

Use accessible labels `Добавить группу после группы ${groupIndex + 1}`. For an empty list, keep one labelled first-group action. At the final action row, retain the current `EmptyNoteGroup` drop/file target behavior while presenting its create button beside the last group's add-note action; avoid nesting that target inside `DroppableNoteGroup`, because both have independent drop handling.

- [ ] **Step 6: Add the horizontal action layout**

Add `.note-group-actions` as a centered flex row with the existing compact vertical spacing and button styling. Remove the old layout rule that forces the trailing empty-group action below the final add-note action. Keep focus, hover, disabled, file-over, and drag-over states unchanged.

- [ ] **Step 7: Verify the complete feature**

Run:

```bash
npm test -- tests/note-groups.test.tsx
npm run build
```

Expected: the focused suite passes without test warnings or errors, and the production build exits successfully. The existing Vite large-chunk advisory is non-blocking.

- [ ] **Step 8: Finalize the single feature commit**

Inspect only this feature with `jj status` and `jj diff`. Run `jj describe -m "Insert note groups between existing groups"`, then `jj new` so the finalized commit remains immutable.
