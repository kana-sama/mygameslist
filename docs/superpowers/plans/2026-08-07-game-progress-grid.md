# Game Progress Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-column, icon-only progress grid to the game sidebar, backed by linked-note checklist counts and an add/edit/delete dialog with deterministic 64×64 WebP icon preparation.

**Architecture:** Extract the checklist block model currently embedded in `Markdown.tsx` into a shared pure module and expose one resolver for sidebar progress. Store ordered progress-item configuration on each game, reuse the existing content-addressed image asset pipeline for normalized icons, and isolate rendering/editing into focused grid and dialog components. `InlineGamePage` coordinates drafts while `LibraryContext` owns blob persistence, canonical data mutation, and asset garbage collection.

**Tech Stack:** React 19, TypeScript 7, Canvas 2D, lossless `@jsquash/webp`, Vitest 4, Testing Library, JSDOM, Vite 8, Jujutsu.

## Global Constraints

- Use Jujutsu (`jj`) exclusively for status, diff, history, and finalization; never invoke Git directly.
- The approved specification, this plan, tests, and implementation must end as exactly one feature commit.
- Do not create per-task commits. Keep every correction in the current working-copy change until final verification passes.
- Execute every implementation task through a fresh subagent and complete its review gate before dispatching the next task.
- Preserve existing games that omit `progressItems`; do not bump `LIBRARY_SCHEMA_VERSION`.
- Keep the sidebar grid at exactly three columns.
- Normal grid cells visibly contain only one static 64×64 icon and aligned `checked/total` text.
- Broken cells render `ошибка` in the value row and use the same editor as valid cells.
- Completed cells use value color only: no underline, animation, progress strip, ring, or glow.
- Persist icons only as deterministic, static, lossless 64×64 WebP assets.
- Keep both an explicit `Вставить` button and `Cmd+V` / `Ctrl+V` paste handling.
- Add no dependencies.

---

## File Structure

### New files

- `src/domain/markdownChecklist.ts` — pure Markdown block/checklist model extracted from the renderer, heading ancestry, and finite progress resolver.
- `src/domain/progressIcon.ts` — alpha-bound detection, trim/no-upscale placement, deterministic 64×64 canvas rendering, and lossless WebP preparation.
- `src/components/GameProgressGrid.tsx` — three-column grid, valid/complete/broken cells, and add cell.
- `src/components/GameProgressItemDialog.tsx` — item draft, note selection, icon preview/file/clipboard input, validation, modal focus behavior, save, and delete UI.
- `src/components/clipboardImage.ts` — shared explicit clipboard-read and paste-event image extraction used by `ImagePicker` and the progress dialog.
- `tests/game-progress-checklist.test.ts` — resolver and renderer-consistency fixtures.
- `tests/progress-icon.test.ts` — alpha bounds, placement, deterministic output dimensions, and preparation failures.
- `tests/game-progress-model.test.ts` — game validation, soft note references, asset references, diff field coverage, and garbage collection.
- `tests/game-progress-ui.test.tsx` — grid geometry/content, dialog lifecycle, paste behavior, add/edit/delete, and focus restoration.

### Modified files

- `src/components/Markdown.tsx` — consume shared parsed blocks/progress helpers instead of owning a private checklist model.
- `src/components/ImagePicker.tsx` — import shared clipboard helpers without changing current cover-picker behavior.
- `src/components/index.ts` — export the new progress components if project barrel tests require it.
- `src/domain/assets.ts` — export the existing image decode and lossless WebP primitives required by progress-icon preparation.
- `src/domain/types.ts` — add `GameProgressItem` and optional `Game.progressItems`.
- `src/domain/validation.ts` — validate progress items, 64×64 icon references, soft note references, and optional game field.
- `src/domain/assetReferences.ts` — count progress icons as referenced assets.
- `src/domain/changeReview.ts` — include progress icon references when grouping asset changes.
- `src/domain/patchSelection.ts` — include progress icon references when selecting dependent asset operations.
- `src/pages/GamePage.tsx` — extend save input/drafts and mount grid/dialog in `InlineGamePage`.
- `src/state/LibraryContext.tsx` — preflight pending icon blobs, retain icon assets, persist canonical progress items, and collect removed icons.
- `src/styles.css` — approved sidebar grid and modal styling, including responsive and focus states.
- `scripts/validate-data.mjs` — mirror optional progress-item validation, 64×64 icon checks, and asset-reference collection for published data.
- `tests/markdown-tasks.test.tsx` — preserve existing checklist rendering/editing behavior after extraction.
- `tests/image-picker.test.tsx` — preserve explicit cover clipboard behavior after helper extraction.
- `tests/domain-core.test.ts` — extend canonical library validation fixtures.
- `tests/asset-garbage-collection.test.ts` — retain/remove progress icons correctly.
- `tests/patch-selection.test.ts` — select progress-icon asset dependencies.
- `tests/change-review.test.ts` — group progress-icon assets with game changes.
- `tests/library-context.test.tsx` — persist pending progress icons and remove orphaned replacements/deletions.
- `tests/published-data-validation.test.mjs` — validate progress items and media references in the CLI mirror.
- `tests/ui-acceptance.test.tsx` — verify the full sidebar placement and visual-content contract.
- `.gitignore` — keep visual-companion `.superpowers/` artifacts out of the feature commit.
- `docs/superpowers/specs/2026-08-07-game-progress-grid-design.md` — approved specification already present in the working copy.
- `docs/superpowers/plans/2026-08-07-game-progress-grid.md` — this plan.

---

### Task 1: Extract the shared checklist model and implement finite note progress resolution

**Files:**
- Create: `src/domain/markdownChecklist.ts`
- Create: `tests/game-progress-checklist.test.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `tests/markdown-tasks.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface ChecklistProgress {
  checked: number;
  open: boolean;
  total: number;
}

export type NoteChecklistResolution =
  | { status: "ok"; checked: number; total: number }
  | { status: "error" };

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[];
export function getChecklistProgress(block: MarkdownBlock): ChecklistProgress;
export function hasMarkdownTasks(markdown: string): boolean;
export function resolveNoteChecklistProgress(markdown: string): NoteChecklistResolution;
export function firstMarkdownHeading(markdown: string): string | null;
```

- `MarkdownBlock` and the list/table child interfaces keep the exact fields currently read by `MarkdownView`, including source locations, collapse ids, task columns, table sections, and annotated progress.
- `Markdown.tsx` imports these types/functions and must not keep a second parser or checklist accumulator.

- [ ] **Step 1: Write failing resolver tests for a single list, nested list, and table**

Create `tests/game-progress-checklist.test.ts` with concrete fixtures:

```ts
import { describe, expect, it } from "vitest";
import {
  firstMarkdownHeading,
  resolveNoteChecklistProgress,
} from "../src/domain/markdownChecklist";

describe("resolveNoteChecklistProgress", () => {
  it.each([
    ["- [x] Found\n- [ ] Missing", { status: "ok", checked: 1, total: 2 }],
    ["- Parent\n  - [x] One\n  - [ ] Two", { status: "ok", checked: 1, total: 2 }],
    [
      "| Name | TW | SiP |\n| --- | --- | --- |\n| Dark Times | [x] | [ ] |",
      { status: "ok", checked: 1, total: 2 },
    ],
  ])("resolves %s", (markdown, expected) => {
    expect(resolveNoteChecklistProgress(markdown)).toEqual(expected);
  });

  it("extracts the first visible heading for editor options", () => {
    expect(firstMarkdownHeading("Intro\n\n# **Gold Bricks**\n- [ ] One"))
      .toBe("Gold Bricks");
  });
});
```

- [ ] **Step 2: Write failing ancestry and error tests**

Add exact expectations:

```ts
it("aggregates sibling roots under the lowest shared heading", () => {
  expect(resolveNoteChecklistProgress([
    "# Gold Bricks",
    "## Story",
    "- [x] A",
    "",
    "## Free play",
    "- [ ] B",
  ].join("\n"))).toEqual({ status: "ok", checked: 1, total: 2 });
});

it.each([
  ["plain prose"],
  ["- [ ] ..."],
  ["# First\n- [ ] A\n\n# Second\n- [ ] B"],
  ["- [ ] A\n\n| B | Done |\n| --- | --- |\n| x | [ ] |"],
])("returns error for %s", (markdown) => {
  expect(resolveNoteChecklistProgress(markdown)).toEqual({ status: "error" });
});
```

- [ ] **Step 3: Run the new tests to prove the module is missing**

Run:

```bash
npm test -- tests/game-progress-checklist.test.ts
```

Expected: FAIL because `src/domain/markdownChecklist.ts` does not exist.

- [ ] **Step 4: Move the Markdown block model and parser without changing rendering semantics**

Move the existing `MarkdownBlock`, `ChecklistProgress`, list/table interfaces, source-line splitter, list/table parsers, collapse-id annotation, `getChecklistProgress`, `getTableRowsProgress`, heading aggregation, `parseBlocks`, `hasMarkdownTasks`, and heading-label normalization from `Markdown.tsx` into `src/domain/markdownChecklist.ts`.

Rename `parseBlocks` to the exported `parseMarkdownBlocks`. Keep source offsets, table-group recognition, open-marker handling, collapse ids, and branch order unchanged. `Markdown.tsx` must render the returned blocks exactly as before.

- [ ] **Step 5: Implement explicit checklist-root ancestry and the finite resolver**

While `parseMarkdownBlocks` performs its existing heading stack pass, record each checklist-bearing list/table root with the active heading path. Use this pure resolution rule:

```ts
export function resolveNoteChecklistProgress(markdown: string): NoteChecklistResolution {
  const analysis = analyzeMarkdownChecklistRoots(markdown);
  if (analysis.roots.length === 0) return { status: "error" };

  const progress = analysis.roots.length === 1
    ? analysis.roots[0].progress
    : progressAtLowestSharedHeading(analysis.roots);

  if (!progress || progress.open || progress.total <= 0) return { status: "error" };
  return { status: "ok", checked: progress.checked, total: progress.total };
}
```

`progressAtLowestSharedHeading` must return `null` when roots share only the document root. Do not select one root heuristically.

- [ ] **Step 6: Make `MarkdownView` consume only the shared module**

Import `parseMarkdownBlocks`, `getChecklistProgress`, `hasMarkdownTasks`, and the shared types. Replace calls to the removed private `parseBlocks`. Re-export `hasMarkdownTasks` from `Markdown.tsx` to preserve its current public import path while its implementation lives in the domain module.

- [ ] **Step 7: Run focused and existing Markdown tests**

Run:

```bash
npm test -- tests/game-progress-checklist.test.ts tests/markdown-tasks.test.tsx tests/note-collapse.test.tsx
```

Expected: PASS with existing task toggles, tables, grouped progress, collapse ids, and open-ended checklists unchanged.

- [ ] **Step 8: Review Task 1 before continuing**

Use a fresh review subagent to verify that renderer and resolver share one parser, document root is not treated as a qualifying ancestor, source-location/collapse behavior is unchanged, and no React/DOM dependency leaked into the domain module. Apply corrections in the same working-copy change and rerun Step 7.

---

### Task 2: Normalize progress icons and share clipboard image extraction

**Files:**
- Create: `src/domain/progressIcon.ts`
- Create: `src/components/clipboardImage.ts`
- Create: `tests/progress-icon.test.ts`
- Modify: `src/domain/assets.ts`
- Modify: `src/components/ImagePicker.tsx`
- Modify: `tests/image-picker.test.tsx`

**Interfaces:**
- Consumes `canvasToLosslessWebPBytes`, `makeImageAssetMetadata`, and `OptimizedImage` from `src/domain/assets.ts`.
- Produces:

```ts
export interface PixelBounds { x: number; y: number; width: number; height: number }
export interface ProgressIconPlacement {
  source: PixelBounds;
  destination: PixelBounds;
}

export function nonTransparentPixelBounds(image: ImageData): PixelBounds | null;
export function progressIconPlacement(bounds: PixelBounds): ProgressIconPlacement;
export async function optimizeProgressIcon(file: File, alt?: string): Promise<OptimizedImage>;

export function clipboardImageFile(data: DataTransfer): File | null;
export function readClipboardImage(): Promise<File>;
```

- [ ] **Step 1: Write failing pure geometry tests**

Create `tests/progress-icon.test.ts` using constructed `ImageData`:

```ts
import { describe, expect, it } from "vitest";
import {
  nonTransparentPixelBounds,
  progressIconPlacement,
} from "../src/domain/progressIcon";

function pixels(width: number, height: number, opaque: Array<[number, number]>): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return new ImageData(data, width, height);
}

it("finds the inclusive non-transparent bounds", () => {
  expect(nonTransparentPixelBounds(pixels(8, 7, [[2, 1], [5, 4]])))
    .toEqual({ x: 2, y: 1, width: 4, height: 4 });
});

it("returns null for a fully transparent image", () => {
  expect(nonTransparentPixelBounds(pixels(3, 3, []))).toBeNull();
});

it("pads small content without upscaling", () => {
  expect(progressIconPlacement({ x: 3, y: 4, width: 31, height: 20 })).toEqual({
    source: { x: 3, y: 4, width: 31, height: 20 },
    destination: { x: 16, y: 22, width: 31, height: 20 },
  });
});
```

Add a large fixture asserting that `128×64` becomes `64×32` at `{x: 0, y: 16}` and an odd fixture asserting deterministic floor/ceiling placement.

- [ ] **Step 2: Run geometry tests to verify failure**

Run:

```bash
npm test -- tests/progress-icon.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement alpha bounds and deterministic placement**

Scan alpha bytes at offsets `3, 7, 11, ...`. Track inclusive min/max x/y. `progressIconPlacement` computes `scale = Math.min(1, 64 / width, 64 / height)`, rounds destination width/height to the nearest positive integer, and uses `Math.floor((64 - size) / 2)` for x/y so output is stable.

- [ ] **Step 4: Implement one-frame 64×64 lossless WebP preparation**

Export the existing image decoder from `assets.ts` as `loadImageElement(blob)`. In `optimizeProgressIcon`:

1. reject natural dimensions outside `1..MAX_WEBP_DIMENSION`;
2. draw the decoded static frame to a source canvas;
3. read `ImageData`, derive non-transparent bounds, and reject null bounds with `Изображение полностью прозрачное.`;
4. create a transparent 64×64 destination canvas;
5. draw the trimmed source rectangle into the calculated destination with high-quality smoothing;
6. encode through `canvasToLosslessWebPBytes`;
7. return `ImageAsset` metadata with exact width/height 64, the original name, and a static `image/webp` Blob.

Do not preserve original WebP bytes: even an existing WebP must be normalized to the canonical 64×64 output.

- [ ] **Step 5: Extract clipboard helpers and preserve the current cover picker**

Move `clipboardImageName` and `readClipboardImage` from `ImagePicker.tsx` into `src/components/clipboardImage.ts`. Add:

```ts
export function clipboardImageFile(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return Array.from(data.files).find((file) => file.type.startsWith("image/")) ?? null;
}
```

Keep the current `ImagePicker` cover button copy and errors unchanged. It imports the new helper; note mode still does not show the explicit clipboard button.

- [ ] **Step 6: Add preparation-level encoder tests and clipboard regression tests**

Mock the decoder/canvas encoder seam so one test proves returned metadata is `64×64 image/webp`, one proves large content uses the trimmed source rectangle, and one proves fully transparent data rejects. Extend `tests/image-picker.test.tsx` to assert its current explicit cover clipboard action still calls `onPrepare` and still surfaces denied/no-image errors.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/progress-icon.test.ts tests/image-picker.test.tsx tests/domain-storage-assets.test.ts
```

Expected: PASS.

- [ ] **Step 8: Review Task 2 before continuing**

Use a fresh review subagent to verify no-upscale behavior, transparent centering, deterministic odd padding, static lossless output, exact dimensions, and no regression in existing `ImagePicker`. Apply corrections and rerun Step 7.

---

### Task 3: Persist progress items and wire every asset/reference path

**Files:**
- Create: `tests/game-progress-model.test.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/validation.ts`
- Modify: `src/domain/assetReferences.ts`
- Modify: `src/domain/changeReview.ts`
- Modify: `src/domain/patchSelection.ts`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/state/LibraryContext.tsx`
- Modify: `scripts/validate-data.mjs`
- Modify: `tests/domain-core.test.ts`
- Modify: `tests/asset-garbage-collection.test.ts`
- Modify: `tests/patch-selection.test.ts`
- Modify: `tests/change-review.test.ts`
- Modify: `tests/library-context.test.tsx`
- Modify: `tests/published-data-validation.test.mjs`

**Interfaces:**
- Produces persisted types:

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

- Produces editable/save types in `GamePage.tsx`:

```ts
export interface EditableGameProgressItem {
  id: string;
  iconAssetId: string | null;
  noteId: string;
  pendingIcon: PreparedImage | null;
}

export interface GameSaveInput {
  // existing fields
  progressItems: EditableGameProgressItem[];
}
```

- [ ] **Step 1: Write failing model and validation tests**

In `tests/game-progress-model.test.ts`, construct a valid 64×64 WebP metadata fixture and assert:

```ts
const progressItem = { id: ITEM_ID, iconAssetId: ICON_ID, noteId: NOTE_ID };
database.games[GAME_ID].progressItems = [progressItem];
database.assets[ICON_ID] = iconAsset(ICON_ID, 64, 64);
database.notes[NOTE_ID] = noteFor(GAME_ID);

expect(validateLibrary(database).ok).toBe(true);

delete database.notes[NOTE_ID];
expect(validateLibrary(database).ok).toBe(true); // soft reference
```

Add failures for malformed item UUID, non-image icon, 63×64 icon, duplicate item id, and an existing note owned by another game. Assert games without `progressItems` still validate.

- [ ] **Step 2: Write failing reference and garbage-collection tests**

Assert `referencedAssetIds(database)` includes `ICON_ID`, `garbageCollectUnreferencedAssets` retains it while the item exists, and removes it after the item is deleted. Extend patch-selection and change-review fixtures so selecting/changing a game with a new progress icon includes the dependent asset unit.

- [ ] **Step 3: Run model tests to verify the field is unsupported**

Run:

```bash
npm test -- tests/game-progress-model.test.ts tests/asset-garbage-collection.test.ts tests/patch-selection.test.ts tests/change-review.test.ts
```

Expected: FAIL because `progressItems` is unknown and its icon is unreferenced.

- [ ] **Step 4: Add types and exact optional validation**

Add `GameProgressItem` and optional `Game.progressItems`. Add `progressItems` to `ENTITY_FIELDS.games` and `LOCALLY_PATCHABLE_FIELDS.games`, but pass it as an optional game key so existing games remain valid.

Validate each item with exact keys `id`, `iconAssetId`, `noteId`; require unique item UUIDs; require SHA-256 icon id and note UUID. After entity validation:

- icon must exist, be an image, and have width/height exactly 64;
- missing note is permitted;
- an existing note must have `gameId` equal to the containing game id.

- [ ] **Step 5: Extend every asset reference collector**

Update `referencedAssetIds`, validation's unreferenced set, change-review entity references, and patch-selection dependency scanning so every `game.progressItems[].iconAssetId` is treated like `coverAssetId`. Do not treat `noteId` as an asset id.

- [ ] **Step 6: Mirror validation in `scripts/validate-data.mjs`**

Accept optional `progressItems`, validate exact keys/UUID/SHA fields and duplicate ids, require referenced icon media metadata to be a 64×64 image, allow a missing note, reject a present wrong-game note, and include icons in the CLI unreferenced-media scan.

- [ ] **Step 7: Extend save input and pending local-asset preflight**

Add `progressItems` to every `GameSaveInput` construction. Existing game persistence defaults to editable copies of `game.progressItems ?? []`; new-game save passes `[]`.

In `preparedLocalAssets`, add every non-null `pendingIcon` through the same size-checked `add(...)` helper used by covers and attachments.

- [ ] **Step 8: Persist canonical items in `LibraryContext.saveGame`**

Before assigning the game, map editable items:

```ts
const progressItems = input.progressItems.map((item) => {
  const iconAssetId = item.pendingIcon
    ? retainLocalAsset(database, assetFromPrepared(item.pendingIcon), "image")
    : item.iconAssetId;
  if (!iconAssetId) throw new Error("Выберите иконку прогресса");
  return { id: item.id, iconAssetId, noteId: item.noteId };
});
```

Spread `{ progressItems }` only when non-empty. Preserve array order and ids. The existing post-mutation `garbageCollectUnreferencedAssets(next)` must collect replaced/deleted icon assets automatically once reference traversal is updated.

- [ ] **Step 9: Add LibraryContext and published-validation tests**

In `tests/library-context.test.tsx`, save one pending icon and assert metadata plus game reference are written; replace it and assert the old local icon is no longer referenced; delete the item and assert canonical game omission. In the CLI test, create a temporary `64×64` WebP media file and verify valid progress data passes while missing/wrong-size media fails.

- [ ] **Step 10: Run the model/persistence suite**

Run:

```bash
npm test -- tests/game-progress-model.test.ts tests/domain-core.test.ts tests/asset-garbage-collection.test.ts tests/patch-selection.test.ts tests/change-review.test.ts tests/library-context.test.tsx tests/published-data-validation.test.mjs
```

Expected: PASS.

- [ ] **Step 11: Review Task 3 before continuing**

Use a fresh review subagent to trace a new, replaced, deleted, missing-note, and published progress icon through validation, local blobs, diff dependencies, reference counting, and garbage collection. Apply corrections and rerun Step 10.

---

### Task 4: Build the three-column grid and unified item editor

**Files:**
- Create: `src/components/GameProgressGrid.tsx`
- Create: `src/components/GameProgressItemDialog.tsx`
- Create: `tests/game-progress-ui.test.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- `GameProgressGrid`:

```ts
export interface GameProgressGridProps {
  gameId: string;
  items: readonly GameProgressItem[];
  notes: readonly Note[];
  assets: Record<string, Asset>;
  resolveAssetUrl?: (assetId: string) => string | null;
  disabled?: boolean;
  onAdd(): void;
  onEdit(itemId: string, trigger: HTMLButtonElement): void;
}
```

- `GameProgressItemDialog`:

```ts
export interface GameProgressItemDialogProps {
  gameId: string;
  item: EditableGameProgressItem;
  notes: readonly Note[];
  assets: Record<string, Asset>;
  storageLocked: boolean;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  resolveAssetUrl?: (assetId: string) => string | null;
  onCancel(): void;
  onDelete?: () => void | Promise<void>;
  onSave(item: EditableGameProgressItem): void | Promise<void>;
}
```

- [ ] **Step 1: Write failing grid-content tests**

Create `tests/game-progress-ui.test.tsx` and assert:

```tsx
render(<GameProgressGrid
  assets={{ [ICON_ID]: iconAsset(ICON_ID) }}
  gameId={GAME_ID}
  items={[
    { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
    { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
    { id: ITEM_C, iconAssetId: ICON_ID, noteId: NOTE_INVALID },
  ]}
  notes={notes}
  onAdd={onAdd}
  onEdit={onEdit}
  resolveAssetUrl={() => "/icon.webp"}
/>);

expect(screen.getByRole("heading", { name: "Прогресс" })).toBeVisible();
expect(screen.getByRole("button", { name: /2 из 5/ })).toHaveTextContent("2/5");
expect(screen.getByRole("button", { name: /завершено/i })).toHaveTextContent("3/3");
expect(screen.getByRole("button", { name: /ошибка прогресса/i })).toHaveTextContent("ошибка");
expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeVisible();
```

Assert normal cells contain no note-title text, every image has rendered width/height 64, and valid/invalid clicks pass the correct item id.

- [ ] **Step 2: Write failing editor lifecycle and paste tests**

Render an existing draft and assert file selection, explicit `Вставить`, and dialog-level paste all call `optimizeProgressIcon`; text paste does nothing; note options follow group/rank order; invalid progress disables save; valid progress shows `2/5`; delete is present only for existing items; Escape/Cancel restores origin focus through the parent integration.

Use `userEvent.paste(new DataTransfer())` with an `image/png` File for the image path and a text-only DataTransfer for the ignored path.

- [ ] **Step 3: Run UI tests to verify missing components**

Run:

```bash
npm test -- tests/game-progress-ui.test.tsx
```

Expected: FAIL because both components are missing.

- [ ] **Step 4: Implement `GameProgressGrid`**

Build a semantic section with `h2`/`h3` level appropriate to the sidebar and CSS classes:

```tsx
<section aria-labelledby={headingId} className="game-progress">
  <h2 className="game-progress__heading" id={headingId}>Прогресс</h2>
  <div className="game-progress__grid">
    {items.map((item) => <button className="game-progress__item" ... />)}
    <button aria-label="Добавить элемент прогресса" className="game-progress__add" ...>
      <Icon name="plus" size={22} />
    </button>
  </div>
</section>
```

Resolve the linked note by id and same-game ownership, then call `resolveNoteChecklistProgress`. Render `ошибка` only in the value span on failure. Add `is-complete` only when `checked === total`; CSS may color the value but must not add a pseudo-element or text decoration. Resolve icon URL through existing asset/local URL support.

- [ ] **Step 5: Implement the unified modal editor**

The editor owns a cloned draft and dirty/busy/error state. Render the established preview plus action row with exact visible controls `Выбрать файл`, `Вставить`, and conditional `Убрать`. Both file selection and `readClipboardImage()` pass into one `processFile(file)` function that calls `optimizeProgressIcon`, quota preflight, and stores a `PreparedImage` preview.

Attach `onPaste` to the dialog surface:

```tsx
const onPaste = (event: React.ClipboardEvent) => {
  const file = clipboardImageFile(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  void processFile(file);
};
```

Build note options from `groupDraftNotes(...)` order. Use `firstMarkdownHeading` or `Заметка N`. Validate through `resolveNoteChecklistProgress`; disable/save-error when icon, note, or finite progress is missing.

Use the exact focus-management pattern in `DiffDialog.tsx`: a dialog ref, first-focusable focus on mount, document `keydown` handling for Escape, and first/last focus cycling for Tab/Shift+Tab. Render a labelled `role="dialog" aria-modal="true"` inside the existing modal-layer vocabulary, add backdrop close through the same target check, guard dirty closure, and restore focus from the parent. Confirm delete with `window.confirm("Удалить элемент прогресса?")`.

- [ ] **Step 6: Integrate draft coordination in `InlineGamePage`**

Create editable items from `game.progressItems ?? []`, with `pendingIcon: null`. Add state for the active item id/new draft and its trigger element. `onAdd` creates `{ id: crypto.randomUUID(), iconAssetId: null, noteId: "", pendingIcon: null }`. Save replaces by id or appends, then calls `persist({ progressItems: next })`; delete filters and persists. Do not close the dialog until persistence succeeds.

Mount the grid immediately after `game-sidebar__meta` and before `game-sidebar__tools`. Keep progress items unchanged in every unrelated title/status/tier/platform/tag/note persistence call through `persist` defaults.

- [ ] **Step 7: Implement the approved CSS exactly**

Add:

- `.game-progress__grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px 4px; }`;
- fixed item rows `64px 17px` and a fixed cell height;
- `img { width:64px; height:64px; object-fit:contain; }`;
- tabular monospaced value at one line/baseline;
- success color only for `.is-complete .game-progress__value`;
- destructive pink lowercase error text in the same value row;
- subtle border/surface hover and visible focus;
- dashed add cell with centered plus;
- no visible normal-item label, underline, strip, ring, glow, or animation;
- responsive rules that retain exactly three columns;
- dialog layout consistent with current fields/buttons and a separated destructive delete action.

- [ ] **Step 8: Extend acceptance tests for full sidebar placement**

In `tests/ui-acceptance.test.tsx`, render a game with progress items and assert DOM order is cover → title → metadata → `Прогресс` → delete tools. Render an editable game with zero items and assert the heading plus `Добавить элемент прогресса` cell are still visible. Verify storage lock disables image replacement/addition but still permits opening and viewing existing configuration.

- [ ] **Step 9: Run the UI suite**

Run:

```bash
npm test -- tests/game-progress-ui.test.tsx tests/ui-acceptance.test.tsx tests/markdown-tasks.test.tsx tests/library-context.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Review Task 4 before continuing**

Use a fresh review subagent to compare the UI against the approved spec: full sidebar placement, three columns, 64×64 static icons, value baseline, no labels, `ошибка`, completion color only, add cell, one editor, explicit `Вставить`, hotkey paste, validation, delete visibility, focus behavior, and no stale progress-item loss during unrelated saves. Apply corrections and rerun Step 9.

---

### Task 5: Complete cross-surface verification and finalize the single feature commit

**Files:**
- Modify only files found by verification/review to contain defects in this feature.
- Verify: `docs/superpowers/specs/2026-08-07-game-progress-grid-design.md`
- Verify: `docs/superpowers/plans/2026-08-07-game-progress-grid.md`

**Interfaces:**
- Consumes all prior tasks.
- Produces one verified Jujutsu feature commit and a fresh empty working-copy change.

- [ ] **Step 1: Run every focused progress suite together**

Run:

```bash
npm test -- tests/game-progress-checklist.test.ts tests/progress-icon.test.ts tests/game-progress-model.test.ts tests/game-progress-ui.test.tsx tests/markdown-tasks.test.tsx tests/image-picker.test.tsx tests/domain-core.test.ts tests/asset-garbage-collection.test.ts tests/patch-selection.test.ts tests/change-review.test.ts tests/library-context.test.tsx tests/published-data-validation.test.mjs tests/ui-acceptance.test.tsx
```

Expected: PASS with zero unhandled errors.

- [ ] **Step 2: Run the full automated verification**

Run:

```bash
npm test
npm run build
npm run data:validate
```

Expected: all tests pass, TypeScript/Vite build succeeds, and published data remains valid without migration.

- [ ] **Step 3: Perform browser verification on the real LEGO game page**

Using the local Vite app and the LEGO Harry Potter fixture/game:

1. verify the full sidebar and `Прогресс` placement;
2. add one icon through `Выбрать файл` and another through visible `Вставить`;
3. add one with `Cmd+V`/`Ctrl+V` while focus is in the note select;
4. verify the stored preview is static and exactly 64×64;
5. create enough items for more than one three-column row;
6. toggle a linked task and verify `A/B` updates;
7. edit the note into an invalid topology and verify only `ошибка` replaces the value;
8. repair the item through the same dialog;
9. delete an item and verify the UI closes/restores focus and the icon becomes collectible as an orphan;
10. verify desktop and narrow responsive widths retain three columns and aligned values.

- [ ] **Step 4: Run a final fresh code review**

Use `superpowers:requesting-code-review` through a fresh review subagent. Require findings to be classified by severity and checked against the approved spec, data integrity, clipboard permissions, image normalization, checklist consistency, accessibility, and unrelated-save preservation. Fix every valid in-scope finding in the same working-copy change, then rerun the complete commands and browser checklist from Steps 1–3.

- [ ] **Step 5: Inspect only task-related changes with Jujutsu**

Run:

```bash
jj status
jj diff --stat
jj diff
```

Confirm `.superpowers/` is ignored and that the diff contains only the specification, plan, tests, implementation, and `.gitignore` housekeeping required by this feature. Preserve unrelated work if any appears.

- [ ] **Step 6: Finalize the single feature commit and open a fresh change**

Run:

```bash
jj describe -m "Add game progress grid"
jj new
jj status
```

Expected: the feature is one immutable described commit containing spec, plan, tests, and implementation; the new working-copy change is empty.

---

### Final review correction wave: edit intent, normalized preview metadata, and bounded resolution work

**Files:**
- Modify: `src/components/GameProgressGrid.tsx`
- Modify: `src/components/GameProgressItemDialog.tsx`
- Modify: `tests/game-progress-ui.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`
- Update verification evidence: `.superpowers/sdd/2026-08-07-game-progress-grid/task-5-report.md`

**Interfaces:**
- `GameProgressGrid` continues to consume `items`, `notes`, and the shared `resolveNoteChecklistProgress` resolver, but exposes saved cells with accessible names that state edit intent plus current, completed, or error state.
- `GameProgressItemDialog` continues to produce the same save draft and shows `64×64 WebP` only when an existing or prepared icon is present.
- Resolution caching remains internal to `GameProgressGrid`; no persistence or domain interface changes.

- [x] **Step 1: Write all three focused regressions before production changes**

Strengthen the grid test to require exact accessible names `Редактировать элемент прогресса: 2 из 5`, `Редактировать элемент прогресса: 3 из 3, завершено`, and `Редактировать элемент прогресса: ошибка прогресса`. Add a dialog assertion that `64×64 WebP` is absent without an icon and appears after the shared image-processing path prepares one. Mock only the shared checklist resolver boundary and render two items linked to one note; require one resolver call for stable inputs, then rerender with a changed note body and require exactly one new call plus updated cell values.

- [x] **Step 2: Capture one combined RED**

Run:

```bash
npm test -- tests/game-progress-ui.test.tsx
```

Expected: failures for missing edit intent, missing `64×64 WebP` metadata, and duplicate resolver calls; the body-change assertion must remain capable of observing a fresh value.

- [x] **Step 3: Implement the minimal grid and dialog corrections**

In `GameProgressGrid`, build current-game note lookup and per-note-body resolution maps inside `useMemo`, derive each item result from that memoized map, and rebuild when `gameId`, `items`, or `notes` changes. Format saved-cell labels as the three exact Russian strings from Step 1. In `GameProgressItemDialog`, render concise `64×64 WebP` metadata adjacent to the dialog preview only when `hasIcon` is true.

- [x] **Step 4: Capture GREEN and update integration selectors**

Run `npm test -- tests/game-progress-ui.test.tsx`, then update `tests/ui-acceptance.test.tsx` selectors to the approved edit-intent names and rerun the Task 4 UI command.

- [ ] **Step 5: Run full automated and browser verification**

Run the exact 13-file focused suite, `npm test`, `npm run build`, and `npm run data:validate`. In the in-app browser, open the LEGO game dialog, arm the file-chooser event before activating `Выбрать файл`, provide `.superpowers/brainstorm/90642-1786059988/content/gold-golden-static.png`, verify an exact 64×64 preview plus visible `64×64 WebP`, select a valid note, save, then delete the QA item and confirm cleanup/focus. Append RED/GREEN, gate, browser, and cleanup evidence to the ignored Task 5 report.

---

## Plan Self-Review Checklist

- Every acceptance criterion in the approved spec maps to Tasks 1–5.
- Shared checklist semantics are extracted before grid rendering; no duplicate parser is planned.
- Icon geometry, static encoding, explicit Paste, and keyboard paste have focused tests and one implementation path.
- The optional model field, soft note reference, hard icon reference, CLI mirror, diff dependency, local blob, and garbage-collection paths are all covered.
- The full sidebar, three-column grid, 64×64 cells, aligned numbers, completed styling, broken text, add cell, editor, and delete action are all covered.
- The final review wave explicitly covers accessible edit intent, visible normalized-output metadata, per-stable-render checklist-resolution caching, note-body invalidation, and the missing real-browser file-chooser path.
- No schema bump, dependency addition, per-task commit, Git command, placeholder, or unresolved implementation choice remains.
