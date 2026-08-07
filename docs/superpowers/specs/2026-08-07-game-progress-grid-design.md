# Game progress grid design

## Context

The game page has a sticky 220 px information sidebar containing the cover, title, status, tier, platforms, tags, modification date, and destructive game action. Notes fill the flexible content column and already render Markdown checklist progress such as `2/200` for lists and task-bearing tables.

Some games have several collectible or completion categories that should remain visible without opening their notes. Each category needs an authentic in-game icon and a live `checked/total` value derived from one linked note. The sidebar must stay compact and must not introduce labels that compete with the cover or notes.

## Goal

Add an editable `Прогресс` section to the game information sidebar. It renders progress items in a fixed three-column grid. Every normal item contains only a static 64×64 in-game icon and a large `A/B` value beneath it. Clicking any item opens one editor for its icon and linked note. A grid `+` button creates an item through the same editor, and an existing item can be deleted from that editor.

## Non-goals

- Do not animate icons or preserve animation from source files.
- Do not show visible item names, note names, percentages, subtitles, progress bars, rings, or completed underlines in the grid.
- Do not add a checklist-selection window or let an item select one checklist among several candidates inside a note.
- Do not explain checklist topology in the grid error state.
- Do not add item drag-and-drop or manual reordering in this feature; display order is array/creation order.
- Do not change note rendering, checklist editing, note grouping, or the existing sidebar metadata layout beyond inserting the new section.
- Do not fetch game icons from external services.

## User-visible layout

The section appears after the existing metadata definition list and before the sidebar tools. A small categorical heading reads `Прогресс`.

The item area is exactly three equal columns at every game-page width. At the current 220 px sidebar width, each cell receives roughly 70 px. On the narrow responsive game page, the sidebar may become wider, but the grid still keeps three columns.

Each saved item is a button with two fixed rows:

- a 64 px icon row containing one already-normalized 64×64 WebP;
- a fixed-height value row containing `checked/total` in tabular monospaced numerals.

The fixed rows keep every value on the same baseline. Icon source proportions cannot move the value because normalization happens before persistence rather than through per-item CSS sizing.

The complete state uses the existing quiet success green on the value only. It has no underline, progress strip, glow, card fill, or completion animation.

The final grid cell is an add button with a centered `+`, dashed quiet border, hover state, and accessible name `Добавить элемент прогресса`. It participates in normal grid flow and moves to the next row as items are added.

Grid items have no visible labels. Their buttons still expose an accessible edit label and state. Hover and keyboard focus use a subtle border/surface change to communicate that the whole cell is interactive.

## Persisted model

Progress configuration belongs to the game because it controls the game sidebar:

```ts
export interface GameProgressItem {
  id: string;
  iconAssetId: string;
  noteId: string;
}

export interface Game {
  // existing fields
  progressItems?: GameProgressItem[];
}
```

`id` is a stable UUID used for React identity and editing. Array order is display order. Existing games omit `progressItems`; an empty array is canonicalized back to omission to avoid noise in published data.

`iconAssetId` is a hard image-asset reference. Its asset must be `image/webp` with metadata width and height exactly 64. Progress icon assets participate in the same local blob persistence, publication, integrity checks, reference collection, diff review, and unreferenced-asset garbage collection as covers and note attachments.

`noteId` is intentionally a soft UUID reference. The editor only offers notes belonging to the current game, but a previously linked note may later be deleted or become unsuitable. That does not delete the progress item: the item becomes broken and remains available for immediate repair. Validation checks the UUID shape and checks same-game ownership when the note exists, but it does not reject an otherwise valid library solely because the referenced note is missing.

The existing schema version remains valid because the new game field is optional and backward-compatible. The game field lists, local patch allowlist, canonical comparison, grouped diff rendering, and asset-reference traversal must include `progressItems`.

## Checklist progress resolution

Progress resolution is a pure operation over the linked note Markdown and returns either `{ checked, total }` or `error`. Rendering and the editor use the same resolver.

The resolver shares the application's existing Markdown checklist grammar and progress semantics, including task list items, nested task lists, supported task-bearing tables, table groups, checked markers, and the open-ended `- [ ] ...` marker. The parsing/progress logic currently embedded in `Markdown.tsx` must be factored into a pure shared module rather than reimplemented with a second grammar.

A checklist-bearing list or table block is a checklist root. Nested tasks belong to their containing root, and table groups belong to their table root.

Resolution rules are deterministic:

1. A missing linked note or a note belonging to another game resolves to `error`.
2. A note with no checklist root resolves to `error`.
3. A note with exactly one checklist root uses that root's aggregate checked and total counts.
4. A note with multiple checklist roots uses the aggregate of their lowest shared Markdown heading ancestor.
5. The document root is not accepted as a shared ancestor. Multiple roots under separate top-level headings or with no shared heading resolve to `error`.
6. Any selected aggregate containing an open-ended checklist marker has unknown total and resolves to `error`.
7. A finite aggregate with `total > 0` resolves to `checked/total`.

The lowest shared heading rule permits, for example, several lists or tables inside one `# Gold Bricks` section while refusing to guess between unrelated top-level checklist sections. The feature never asks the user to choose among checklist candidates.

Resolution is recomputed from the current note body in memory. A note task toggle updates the sidebar value through the existing save/state flow without persisting a duplicate count.

## Broken state

A broken item keeps the same size and position as a valid item. Its icon remains visible when available, and the value row renders the lowercase word `ошибка` in the destructive pink instead of `A/B`. It does not render a full-width diagnostic, tooltip with checklist candidates, or separate repair workflow.

The entire broken cell remains the same edit button as every other item. Its accessible label states that progress has an error and that activating the cell edits the item. The detailed resolver result is used only to validate the editor; it does not become persistent data.

## Icon normalization

Both file selection and clipboard insertion feed one pure preparation pipeline. The saved output is always one static, lossless WebP image with a 64×64 transparent canvas.

Normalization steps:

1. Decode one static frame from the source image. Animation is never preserved.
2. Render the decoded image to a source canvas and find the bounding box of pixels whose alpha is greater than zero.
3. Reject an image with no non-transparent pixels.
4. Trim the source to that non-transparent bounding box.
5. If either trimmed dimension exceeds 64 px, scale the trimmed content down proportionally so both dimensions fit within 64 px. Never upscale content whose trimmed dimensions are already at most 64 px.
6. Center the resulting content on a transparent 64×64 canvas. Odd leftover pixels are distributed deterministically so repeated preparation produces identical bytes.
7. Encode with the existing lossless WebP encoder and persist metadata width and height as 64.

For a source without alpha, every source pixel is non-transparent, so the whole image is the trimmed content and is proportionally fit into the canvas. The original filename remains asset metadata; visible alt text is not shown in the grid.

Preparation must reject unsupported/undecodable data and surface the existing inline image-picker error. Storage-quota preflight occurs before the prepared icon is accepted, matching covers and attachments.

## Item editor

Clicking a saved, complete, incomplete, or broken grid item opens the same modal editor. Clicking `+` opens it with empty fields.

The editor contains two fields:

### Icon

The icon field reuses the established `ImagePicker` interaction vocabulary:

- preview;
- `Выбрать файл`;
- an explicit clipboard-icon button labelled `Вставить`;
- `Убрать` when an image exists;
- inline busy and error states.

While the modal is open, pasting an image with `Cmd+V` or `Ctrl+V` invokes the same preparation pipeline. The explicit button remains available and uses the existing async clipboard-read behavior. A text-only clipboard paste is ignored by the paste-event path. The accepted preview identifies the normalized result as `64×64 WebP`.

### Note

The note select lists only current-game notes in their visible group/rank order. Its option label uses the first non-empty Markdown heading when present and otherwise a stable fallback such as `Заметка 3`. A valid selection previews `checked/total`; an invalid selection shows a concise inline validation error but never opens a checklist chooser.

Creating or saving requires both a prepared/existing icon and a selected note whose current Markdown resolves to finite progress. This prevents a newly saved broken item. Existing items can later become broken when their note is deleted or edited.

## Editor actions and lifecycle

The modal footer contains `Отмена` and `Сохранить`. An existing item additionally shows the destructive `Удалить` action on the opposite side; a new item does not.

Deleting asks for the project's standard destructive confirmation, removes the item, and allows normal asset garbage collection to remove its now-unreferenced icon. Saving a new item appends it immediately before the `+` cell. Saving an existing item preserves its array position and stable id.

Closing with unsaved icon or note changes uses the existing unsaved-change confirmation. `Escape` closes when safe, focus is trapped while open, and focus returns to the originating item or add button after close. Save and delete states disable duplicate submissions.

## Component responsibilities

### Shared checklist model

A pure Markdown model module owns block parsing, checklist progress annotation, checklist-root discovery, heading ancestry, and `resolveNoteChecklistProgress(markdown)`. `MarkdownView` consumes the same model so rendered checklist counts and sidebar counts cannot diverge.

### Progress icon preparation

`optimizeProgressIcon` owns alpha trimming, no-upscale fitting, transparent centering, lossless WebP conversion, metadata creation, and deterministic error handling. It has focused pure helpers for alpha-bound and placement calculations so the geometry can be tested without browser image decoding.

### Progress grid

The grid receives the game items, current game notes, assets, and asset URL resolver. It memoizes resolution by item/note body, renders the fixed cells, and reports edit/add intent. It owns no persistence.

### Progress item editor

The modal owns one draft item, icon preparation, clipboard/file input, note choice, inline validation, dirty state, and action callbacks. It does not mutate the library directly.

### Game page and library state

`InlineGamePage` owns opening/closing the editor and passes progress-item overrides through its existing save path. `GameSaveInput` carries editable progress items and pending icon blobs. `LibraryContext` persists new blobs before mutation, retains icon metadata, writes canonical progress items, and relies on shared garbage collection after mutation.

## Data flow

```text
file / explicit Paste / Cmd+V
  -> decode static frame
  -> trim alpha bounds
  -> downscale only when larger than 64
  -> center on transparent 64×64 canvas
  -> lossless WebP + content-addressed asset metadata/blob
  -> editor draft preview

selected note body
  -> shared Markdown checklist model
  -> one root or lowest shared heading ancestor
  -> finite checked/total OR error
  -> editor validation and grid value

Save
  -> persist pending icon blob
  -> retain asset metadata
  -> update game.progressItems
  -> canonical diff and local patch
  -> referenced-asset garbage collection
```

## Accessibility

- The visible heading labels the progress section.
- Every saved item is a keyboard-focusable button with an accessible edit label and current `checked of total`, completed, or error state.
- The add cell has an explicit accessible name.
- The modal has a labelled dialog role, initial focus, focus trap, Escape handling, and focus restoration.
- Clipboard insertion is never the only input path; file selection remains available.
- Busy and preparation errors use existing `aria-busy` and alert patterns.
- Color is not the only signal for broken state because the visible value changes to `ошибка`; completion is also present in the accessible label.

## Testing

### Checklist resolver

- resolves one task list, nested task list, task-bearing table, and grouped task table;
- aggregates multiple roots under their lowest shared heading;
- errors for no tasks, missing note, wrong-game note, unrelated top-level roots, and open-ended total;
- remains value-for-value consistent with progress shown by `MarkdownView` fixtures.

### Icon preparation

- computes alpha bounds for transparent images;
- rejects fully transparent input;
- preserves small content size and centers it on 64×64;
- trims and proportionally reduces large content;
- handles odd padding deterministically;
- treats opaque images as full-bounds content;
- produces static lossless WebP metadata with exact 64×64 dimensions;
- uses identical preparation for file, button-paste, and paste-event paths.

### Model, validation, and assets

- accepts games without `progressItems`;
- validates item UUIDs and exact 64×64 image assets;
- permits a missing soft note reference but rejects an existing note owned by another game;
- includes progress icon assets in reference tracking, diff selection, integrity checks, publication, and garbage collection;
- persists pending icons and canonicalizes an empty item list to omission.

### Grid and editor

- renders exactly three columns, fixed 64 px icon rows, and aligned value rows;
- renders only icon plus `A/B` for a normal item;
- renders success-colored numbers without underline for completion;
- renders `ошибка` in the value row without changing cell size;
- opens the same editor from valid, broken, and add cells;
- keeps explicit `Вставить`, accepts `Cmd+V`/`Ctrl+V`, and ignores text paste;
- validates required icon/note/progress before save;
- appends new items, preserves edited positions, confirms deletion, and restores focus;
- hides delete for a new draft and prevents duplicate save/delete submission.

### Integration verification

On a real game page, verify the full sidebar with zero, one, three, four, and many items; edit a linked task and observe the live count; invalidate and repair a note; add icons from file, the explicit Paste button, and `Cmd+V`; confirm all stored icons are 64×64 WebP; delete an item and verify its unreferenced local asset is collected; and check the three-column grid at desktop and narrow responsive widths.

## Acceptance criteria

- The sidebar shows a `Прогресс` heading and a three-column grid after metadata.
- A normal item visibly contains only its static 64×64 in-game icon and aligned `checked/total` value.
- Completed values are green without an underline or animation.
- An unresolvable linked note shows `ошибка` exactly where the value normally appears.
- Clicking any saved item opens one icon/note editor; `+` opens the same editor for creation.
- Existing-item editing exposes delete; new-item editing does not.
- The editor provides both the established visible `Вставить` button and `Cmd+V`/`Ctrl+V` image paste.
- Every persisted progress icon is a deterministic static 64×64 lossless WebP produced by trim, no-upscale fit, transparent padding, and centering.
- Progress counts are derived from the linked note through the same checklist semantics as note rendering and are never duplicated in storage.
- Existing libraries without progress items continue to validate and render unchanged.
