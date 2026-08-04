# Game-grouped selective diff

**Date:** 2026-08-04  
**Status:** Approved design

## Summary

Replace the current type-grouped local changes list with a compact, game-grouped review surface. Each row describes one meaningful user change, shows its actual before/after evidence, and can be selected for partial GitHub synchronization together with every required dependency.

Text changes use a Markdown-aware diff. The default preview is rendered Markdown; each note has a small, transient `Исходник` button beside `Весь diff` to switch only that note to its source diff. Additions, removals, and modifications are communicated visually by color and a thin accent edge, without diff-marker glyphs such as `+`, `−`, or `~`.

If no changes are selected, synchronization publishes the complete local patch. After a partial commit, published changes disappear and unselected changes remain local.

## Goals

- Group changes by game instead of by operation type.
- Make the substance of every change visible without exposing raw JSON paths.
- Show a real multi-line diff for changed text.
- Show the content of created and deleted notes.
- Keep the list compact and vertically scannable.
- Allow selection of a whole game or one meaningful change.
- Automatically include referential, transaction, rank, and asset dependencies.
- Preserve unselected changes and edits made while synchronization is running.
- Use real library history as regression fixtures for diff quality.

## Non-goals

- Selecting individual lines inside a text diff.
- Editing or merging Markdown inside the diff panel.
- Persisting rendered/source view choices.
- Persisting the current partial-selection set after closing the dialog.
- Allowing publication while unresolved patch conflicts exist.
- Replacing the existing PAT, GitHub synchronization, or pending-publication flow.
- Adding a custom commit-message editor.
- Treating rendered Markdown as a replacement for the exact source diff.

## Chosen interaction model

### Review mode

The dialog opens in review mode with no checkboxes visible. Its top-level content is a list of game groups ordered by their newest pending change, newest first. Ties use the game title for stable ordering.

Each game group contains:

- cover thumbnail;
- game title;
- number of meaningful changes;
- compact change rows;
- an ephemeral collapse control.

Game groups are expanded by default so the substance of the changes is immediately visible.

The existing synchronization entry point remains. Its final action describes the scope:

- `Синхронизировать всё` when nothing is selected;
- `Синхронизировать выбранное · N` when one or more meaningful changes are selected.

### Selection mode

`Выбрать часть` enters selection mode and reveals checkboxes without changing the list layout.

- A game checkbox selects every meaningful change owned by that game.
- A change checkbox selects that change and its dependency closure.
- A partially selected game uses an indeterminate checkbox.
- A dependency selected through another change is visibly selected but cannot be removed independently while its parent selection requires it.
- Cross-game dependencies update the affected game groups and receive a concise `связано с …` explanation.
- Deselecting the final explicit selection restores the default `Синхронизировать всё` scope.

Selection state is transient and resets when the dialog closes.

### After synchronization

- A full synchronization behaves as it does today.
- A successful partial synchronization removes only the published subset from the local patch.
- Unselected changes remain local and continue to appear in the dialog.
- Changes made after synchronization starts are never added to the frozen publication subset; they remain local.
- A failure before a confirmed GitHub result removes nothing and keeps the selection available for retry while the dialog remains open.

## Information hierarchy

The visual hierarchy is:

1. publication and conflict state;
2. game;
3. meaningful change;
4. concise description of its substance;
5. before/after evidence;
6. expandable remaining diff and dependencies.

Operation types such as added, changed, moved, deleted, or asset are small row-level labels. They no longer define top-level sections.

### Compact row formats

Short scalar values use one line:

`Запланировано → Прохожу`

Lists such as tags show removed and added chips.

Moves show the user-facing placement:

`B · позиция 12 → A · позиция 4`

Files show a thumbnail or file icon, original name, dimensions when available, and byte size. Asset metadata does not become a separate top-level group; it appears with the game or note that references it.

Created notes show their derived title and a rendered preview of their content. Deleted notes show their former title and removed content. The preview uses the same line budget as a modified note and expands through `Весь diff`.

A note title is derived from its first Markdown heading. If no heading exists, use the first non-empty line, then `Заметка без заголовка` as the final fallback.

### Substance summaries

The one-sentence substance summary is deterministic and local; it does not call an AI or a network service.

- Scalar fields name the field and show the exact before/after values.
- Task-only edits report how many items were checked and unchecked.
- Added or removed Markdown headings name up to two affected sections, then use a remaining-count suffix.
- List and table edits report added, removed, and changed row counts; a unique affected row name can replace the generic count.
- Created and deleted entities use explicit creation/deletion templates.
- Mixed or ambiguous text edits fall back to `Изменено N фрагментов текста`.

The summary is orientation, not evidence. The visible diff remains authoritative.

## Meaningful changes and game ownership

The UI does not render raw patch operations directly. A pure view-model builder converts the base database, effective database, and patch into game groups and meaningful changes.

A meaningful change is normally the surviving operations for one `transactionId`, scoped to the affected entity. Operations without a transaction ID fall back to independent change units. Multiple fields of the same entity are combined only when they belong to the same transaction.

Examples:

- a note body and collapsed-checklist state saved together form one note change;
- a later independent edit to the same note forms another change;
- a game move can span rank operations in several games but remains one selection unit;
- creating a note with attachments includes the note, attachment references, asset metadata, and local blobs as one safe unit.

Ownership is resolved as follows:

- game operations belong to that game;
- note operations belong to the note's game, using effective state first and base state for deleted notes;
- asset operations belong to games or notes that reference the asset, using both effective and base state so deletions remain attributable;
- a valid but unreferenced asset uses a compact `Без привязки к игре` fallback group rather than reintroducing type-based groups.

A transaction that legitimately affects several games appears in each affected game group with the same selection identity. Selecting one occurrence selects the complete transaction and visibly updates the other occurrences.

Dialog-wide selection counts use unique selection identities, so a cross-game transaction is counted once even when it has visible rows in several game groups. A game-group count describes the rows visible inside that game.

## Markdown-aware diff

### Required output properties

- Identical source lines remain context when their structural location is unambiguous.
- An insertion before `- [ ] ...` shows the inserted lines before an unchanged context line. The `...` line must not be reported as removed.
- Context plus removed lines reconstructs the exact previous text.
- Context plus added lines reconstructs the exact next text.
- Whitespace and source punctuation are preserved in source mode.
- Ambiguous structural matching must fall back to an exact line diff rather than inventing semantic correspondence.

### Diff pipeline

Use a Markdown-aware hybrid rather than only a rendered-tree comparison or only a global line diff.

1. Parse both values as GFM Markdown and retain source ranges.
2. Match structural blocks within their parent section:
   - headings by hierarchy and text;
   - task/list items by unique content with the task marker excluded from the matching key;
   - table rows by a unique first meaningful cell;
   - paragraphs and other blocks by exact or low-occurrence source anchors.
3. Run exact line diff inside matched blocks and unmatched gaps.
4. Pair adjacent removed/added lines only when similarity is strong and structurally local.
5. Refine paired lines with word/whitespace diff or, for tables, cell-level diff.
6. If any specialized match is ambiguous, use the exact line-diff result for that block.

The mature `diff`/jsdiff algorithms are suitable for exact line, array, and intraline refinement. The existing remark/GFM ecosystem supplies Markdown structure. A standalone rendered-tree diff is not the source of truth because it can hide formatting changes.

### Rendered mode

Rendered mode is the default for every note each time the dialog opens.

- Headings, lists, task items, paragraphs, and GFM tables render with the existing safe Markdown pipeline.
- Added regions use the existing positive green family.
- Removed regions use the destructive red family.
- Modified cells or intraline spans use a restrained amber/change treatment.
- Unchanged context remains neutral.
- A thin colored edge reinforces the background.
- No diff-marker gutter or `+`, `−`, or `~` glyph is shown.
- Native Markdown characters and checkbox state remain content and are not stripped.

If a note cannot produce a trustworthy rendered diff, only that note falls back to source mode and receives a concise inline explanation.

### Source mode

Each text row has a small `Исходник` button beside `Весь diff`. It switches only that row for the lifetime of the open dialog. In source mode the button becomes `Как выглядит`.

Source mode shows exact Markdown lines:

- added lines use green treatment;
- removed lines use red treatment;
- changed intraline spans use the change treatment;
- context is neutral;
- no service glyphs are added to the source.

`Весь diff` expands the remaining hunks in the row's current mode.

### Preview budget

The compact row immediately shows:

- a one-sentence description of the substance;
- the complete first meaningful hunk where practical;
- at least several visible lines when the source contains them;
- up to 12 visual rows before folding;
- the number of remaining hunks when more exist.

The preview never reduces a text change to a single removed/added pair when a larger hunk is required to understand it.

## Dependency closure

Selection is resolved by a pure dependency function before any network request.

Starting from the explicitly selected meaningful changes, closure includes:

- every surviving operation in the selected transaction unit;
- root entity creation or deletion required by selected field operations;
- the parent game required by a new note;
- rank updates required to keep game or note ordering valid;
- new asset metadata and blobs referenced by selected covers or attachments;
- reference updates required for selected asset deletion;
- cross-game operations that are part of the same ordering transaction.

The resolver validates the selected subset by applying it to the base and running normal library validation. If it cannot produce a valid publication subset, synchronization does not start and the dialog identifies the change whose dependencies could not be resolved.

The resolver returns a selected patch and a deferred patch. Blob pruning runs independently on both so an unselected local attachment cannot be uploaded or discarded accidentally.

## Partial-publication data flow

At synchronization start:

1. Freeze the current base, effective state, patch, selection, and required local assets.
2. Resolve the selected dependency closure.
3. Partition the frozen patch into `publishPatch` and `deferredPatch`.
4. Publish only `publishPatch` through the existing GitHub client.

While the request runs, the user can continue editing. Those edits are measured relative to the frozen effective state and form a post-click patch.

After a successful GitHub result:

1. Merge `deferredPatch` with the post-click patch, with later edits winning on the same path.
2. Reconcile the merged remainder onto the returned published database.
3. Persist the reconciled remainder with the existing pending-publication receipt.
4. Mark only assets included in the published subset as awaiting verification.

The existing commit-message builder receives the database produced by the selected patch, so it describes only the committed subset.

Unresolved conflicts keep the existing behavior: they block synchronization until resolved.

## Error handling

- Diff-render failure: fall back to source mode for that row.
- Ambiguous semantic alignment: fall back to exact line diff for that block.
- Invalid dependency closure: block the action before network access and identify the affected meaningful change.
- Missing or corrupt selected local asset: block the action and name the cover or attachment.
- PAT, permission, validation, conflict, or network failure before accepted publication: keep the complete local patch unchanged.
- GitHub commit accepted but Pages still pending: use the existing pending-publication state while preserving the deferred patch.
- Concurrent edits: keep them local and reconcile them after the selected commit.

## Accessibility

Color is the only additional visible diff marker, as approved, but not the only accessible signal:

- added, removed, and modified regions have screen-reader labels;
- the rendered/source control exposes its current state and target mode;
- game and change checkboxes have complete labels;
- indeterminate and dependency-selected states are programmatically exposed;
- keyboard focus order follows game, change, preview controls, undo, and selection;
- color tokens retain sufficient contrast in both source and rendered modes.

## Testing

### Diff engine

- Use the real commit `98c11c1c` (`Update Lego Harry Potter: Years 1–4`) as a fixture.
- Assert that insertions before `- [ ] ...` keep that line as context.
- Cover checkbox toggles, repeated ellipses in different sections, duplicate list text, heading-level changes, Cyrillic text, long lines, GFM tables, created notes, and deleted notes.
- Property-test reconstruction of exact before and after strings from the line model.
- Verify that ambiguous list or table keys fall back to exact line diff.

### View model

- Group game, note, move, delete, and asset changes under the correct game.
- Resolve deleted notes and assets through base-state ownership.
- Derive note titles from headings and fallbacks.
- Keep a cross-game transaction as one selection identity.
- Order game groups and rows deterministically.

### Selection and publication

- Select one change, one whole game, and a cross-game move.
- Include required note, rank, asset, and blob dependencies.
- Keep unrelated operations and blobs deferred.
- Preserve edits made while synchronization runs.
- Preserve the full patch on pre-commit failure.
- Remove only the selected subset after success.
- Generate a commit message from only the selected result.

### UI

- Review mode has no checkboxes.
- Selection mode exposes game and change checkboxes with correct indeterminate states.
- Empty selection synchronizes everything.
- Rendered mode is the per-note default on every dialog open.
- `Исходник` changes only one note and does not persist.
- `Весь diff` respects the current row mode.
- No diff-marker glyphs are rendered.
- Render fallback and dependency errors are announced accessibly.

## References

- [jsdiff](https://github.com/kpdecker/jsdiff)
- [remark](https://github.com/remarkjs/remark)
- [Git diff algorithms](https://git-scm.com/docs/diff-options)
