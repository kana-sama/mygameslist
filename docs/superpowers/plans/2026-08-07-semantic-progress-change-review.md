# Semantic Progress Change Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render game progress changes as one semantic icon-and-note-title row while coalescing every referenced progress icon asset into the same selectable and undoable change.

**Architecture:** Extend `ChangeEvidence` with a progress-specific model derived from the base and intended game states. Teach asset folding to associate progress icons across transaction boundaries by their before/after references, then give `DiffDialog` a dedicated compact renderer that never passes through generic scalar or asset metadata presentation.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, JSDOM, CSS, Jujutsu.

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository operations; never invoke Git.
- Keep this approved specification, this plan, tests, and implementation in exactly one feature commit. Do not create per-task commits.
- Approved contract: `docs/superpowers/specs/2026-08-07-semantic-progress-change-review-design.md`.
- Progress is one change titled exactly `Прогресс` inside its existing game group.
- Never render progress item ids, note ids, asset ids, JSON, MIME types, byte sizes, image dimensions, or original progress-icon file names.
- Cards show a `32×32` icon and the linked note's markdown-derived title; unresolved notes say exactly `Заметка недоступна`.
- Replaced items appear in removed and added sections. Reorder-only evidence says exactly `Порядок изменён` and shows resulting order.
- Every asset operation referenced by the before or intended-after progress items folds into the progress change across transaction boundaries.
- Progress selection and undo include the progress path plus every folded icon asset path exactly once.
- Unrelated standalone assets and ordinary attachments preserve their existing generic representation and folding behavior.
- Add no dependency and change no persisted schema, patch schema, publication protocol, or blob format.
- Follow strict TDD: add the focused test, run it and observe the intended failure, then write production code and rerun it green.
- Each implementation task runs through a fresh subagent and receives a fresh review gate before the next task.

---

## File Structure

### New files

- `docs/superpowers/specs/2026-08-07-semantic-progress-change-review-design.md` — approved behavior and presentation contract.
- `docs/superpowers/plans/2026-08-07-semantic-progress-change-review.md` — this execution plan.

### Modified files

- `src/domain/changeReview.ts` — progress evidence types, semantic comparison, readable title/summary generation, and cross-transaction icon folding.
- `src/components/DiffDialog.tsx` — dedicated progress evidence renderer.
- `src/styles.css` — compact progress evidence sections and icon/title cards.
- `tests/change-review.test.ts` — semantic domain and folding regressions.
- `tests/ui-acceptance.test.tsx` — consumer-visible dialog rendering and technical-data suppression.

---

### Task 1: Build semantic progress evidence and coalesce icon operations

**Files:**
- Modify: `src/domain/changeReview.ts`
- Modify: `tests/change-review.test.ts`

**Interfaces:**
- Consumes: existing `GameProgressItem`, `deriveMarkdownTitle(markdown)`, `SemanticUnit.foldedAssets`, `intendedEntityForUnit`, `allOperationPaths`, and generic same-transaction asset folding.
- Produces:

```ts
export interface ProgressEvidenceItem {
  itemId: string;
  iconAssetId: string;
  noteTitle: string;
}

export interface ProgressChangeEvidence {
  type: "progress";
  added: ProgressEvidenceItem[];
  removed: ProgressEvidenceItem[];
  after: ProgressEvidenceItem[];
  reordered: boolean;
}
```

- Extends `ChangeEvidence` with `ProgressChangeEvidence`.
- A progress-only game unit has `title === "Прогресс"`, semantic count/order summary, one selection id, and operation paths for the game field plus all coalesced icon assets.

- [ ] **Step 1: Add a failing sequential-save folding test**

Create a base game plus three notes with headings `Золото`, `Красные кирпичи`, and `Гербы`. Create three WebP icon asset operations in transactions `progress-1`, `progress-2`, and `progress-3`, while the surviving `/games/{id}/progressItems` operation belongs only to `progress-3`. Build the review and assert literal consumer behavior:

```ts
expect(review.groups).toHaveLength(1);
expect(review.groups[0].changes).toHaveLength(1);
const [change] = review.groups[0].changes;
expect(change.title).toBe("Прогресс");
expect(change.selectionId).toBe(`tx:progress-3:games:${GAME_A_ID}`);
expect(change.operationPaths).toEqual([
  `/assets/${ASSET_A_ID}`,
  `/assets/${ASSET_B_ID}`,
  `/assets/${ASSET_C_ID}`,
  `/games/${GAME_A_ID}/progressItems`,
]);
expect(change.evidence).toEqual([{
  type: "progress",
  added: [
    { itemId: PROGRESS_ITEM_ID, iconAssetId: ASSET_A_ID, noteTitle: "Золото" },
    { itemId: PROGRESS_ITEM_B_ID, iconAssetId: ASSET_B_ID, noteTitle: "Красные кирпичи" },
    { itemId: PROGRESS_ITEM_C_ID, iconAssetId: ASSET_C_ID, noteTitle: "Гербы" },
  ],
  removed: [],
  after: [
    { itemId: PROGRESS_ITEM_ID, iconAssetId: ASSET_A_ID, noteTitle: "Золото" },
    { itemId: PROGRESS_ITEM_B_ID, iconAssetId: ASSET_B_ID, noteTitle: "Красные кирпичи" },
    { itemId: PROGRESS_ITEM_C_ID, iconAssetId: ASSET_C_ID, noteTitle: "Гербы" },
  ],
  reordered: false,
}]);
expect(review.groups[0].changes.some((item) => item.entity.map === "assets")).toBe(false);
expect(JSON.stringify(change.summary)).not.toContain(PROGRESS_ITEM_ID);
```

The production mutation caught is restoring transaction-id-only folding or scalar JSON evidence.

- [ ] **Step 2: Run the sequential-save test and verify RED**

Run:

```bash
npm test -- tests/change-review.test.ts -t "coalesces sequential progress icons"
```

Expected: FAIL because older icon operations remain separate changes and `progressItems` is scalar JSON.

- [ ] **Step 3: Implement cross-transaction progress-icon folding**

In `foldAssets`, identify game units whose `operationFields` include `progressItems`. For each asset unit, first find the progress units whose base or intended-after progress arrays reference that asset id. Fold into the progress unit when there is exactly one such game progress owner, regardless of transaction id. Otherwise retain the existing rule that folds only into one same-transaction referencing owner. Mark each folded asset unit once and keep unrelated asset behavior unchanged.

Use the intended entity rather than the final effective game alone so conflicts and undo-target values retain the correct icon set.

- [ ] **Step 4: Implement the minimal added-item progress evidence**

Add a narrow parser that accepts only array entries with string `id`, `iconAssetId`, and `noteId`; invalid entries are ignored instead of serialized. Convert each item with the database appropriate to its side:

```ts
function progressEvidenceItem(item: GameProgressItem, database: LibraryDatabase): ProgressEvidenceItem {
  const note = database.notes[item.noteId];
  return {
    itemId: item.id,
    iconAssetId: item.iconAssetId,
    noteTitle: note ? deriveMarkdownTitle(note.bodyMarkdown) : "Заметка недоступна",
  };
}
```

For this first green cycle, handle the sequential-add case only: an item whose id is absent before is appended to `added`, `removed` is empty, `after` preserves the intended array order, and `reordered` is false. When the `progressItems` field is encountered in `evidenceForUnit`, emit one `ProgressChangeEvidence`; do not append generic asset evidence for folded progress icons.

- [ ] **Step 5: Implement the human-readable title and summary**

For a game unit whose only changed field is `progressItems`, return `Прогресс` from `unitTitle`. Teach `compactSecondary`/`unitSummary` to summarize progress evidence from literal Russian fragments:

```ts
[
  evidence.added.length ? `Добавлено: ${evidence.added.length}` : "",
  evidence.removed.length ? `Удалено: ${evidence.removed.length}` : "",
  evidence.reordered ? "Порядок изменён" : "",
].filter(Boolean).join("; ") || "Прогресс изменён"
```

Do not put ids, filenames, or JSON into the title or summary.

- [ ] **Step 6: Run the focused sequential-save test and verify GREEN**

Run:

```bash
npm test -- tests/change-review.test.ts -t "coalesces sequential progress icons"
```

Expected: PASS with one semantic change and zero standalone icon rows.

- [ ] **Step 7: Add failing semantic comparison regressions**

Add table-driven tests with literal expected evidence for:

- removed item uses the base note title;
- the same item id with another note or icon appears in both `removed` and `added`;
- reorder-only returns `reordered: true`, no additions/removals, and `after` in the new order;
- adding an item while reordering retained items returns both the added item and `reordered: true`;
- an unresolved note title is exactly `Заметка недоступна`;
- an unrelated asset operation remains an asset change with generic `asset` evidence;
- the pre-existing note attachment test still folds its asset in the same transaction.

For every case, assert literal titles/summaries/evidence and operation paths rather than reusing production helpers. The production mutations caught are comparing only array length, confusing an edit with reorder, resolving removed notes from the wrong database, or folding unrelated files.

- [ ] **Step 8: Run the new semantic tests and verify RED**

Run:

```bash
npm test -- tests/change-review.test.ts
```

Expected: at least one new comparison or fallback case FAILS before its production branch exists; existing non-progress review tests continue to pass.

- [ ] **Step 9: Complete the semantic comparison branches and rerun GREEN**

Compare stable ids and the two reference fields. Preserve before order in `removed`, after order in `added` and `after`, and set `reordered` when the retained unchanged ids have a different relative order. Implement only the branches required by Step 7, then run:

```bash
npm test -- tests/change-review.test.ts
```

Expected: PASS.

- [ ] **Step 10: Review Task 1**

Use a fresh review subagent with this task brief, its report, and a Jujutsu diff package. Require separate verdicts for specification compliance and code quality. Any Important or Critical issue returns to the implementer for a tested correction in this same working-copy change. Do not commit.

---

### Task 2: Render compact progress evidence without technical data

**Files:**
- Modify: `src/components/DiffDialog.tsx`
- Modify: `src/styles.css`
- Modify: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- Consumes: `ProgressChangeEvidence` and `ProgressEvidenceItem` from Task 1 plus the existing optional `resolveAssetUrl(assetId)` dialog prop.
- Produces: `.game-diff-evidence--progress`, `.game-diff-progress__section`, `.game-diff-progress__items`, `.game-diff-progress__item`, `.game-diff-progress__icon`, and removed-state modifier classes.
- Does not modify the generic `asset` evidence renderer.

- [ ] **Step 1: Add a failing dialog test for added progress items**

Construct one `ReviewChange` titled `Прогресс` with a `progress` evidence object containing two added cards, full UUID-like item/note/asset ids in the fixture, and icon asset original names that are not part of the evidence. Render the real `DiffDialog` with `resolveAssetUrl` returning two literal blob URLs. Assert:

```tsx
expect(screen.getByText("Добавлено", { selector: ".game-diff-progress__label" })).toBeInTheDocument();
expect(screen.getByText("Золото")).toBeInTheDocument();
expect(screen.getByText("Красные кирпичи")).toBeInTheDocument();
expect(screen.getByRole("img", { name: "Золото" })).toHaveAttribute("src", "blob:gold");
expect(screen.getByRole("img", { name: "Красные кирпичи" })).toHaveAttribute("src", "blob:bricks");
expect(screen.queryByText(/image\/webp|64×64|КБ|\.webp|\[{|iconAssetId|noteId/u)).not.toBeInTheDocument();
expect(document.body.textContent).not.toContain(PROGRESS_ITEM_ID);
expect(document.body.textContent).not.toContain(NOTE_ID);
expect(document.body.textContent).not.toContain(PROGRESS_ICON_ID);
```

The production mutation caught is routing progress back through scalar or generic asset evidence.

- [ ] **Step 2: Run the added-progress dialog test and verify RED**

Run:

```bash
npm test -- tests/ui-acceptance.test.tsx -t "renders semantic progress evidence"
```

Expected: FAIL because `ChangeEvidenceView` has no `progress` renderer.

- [ ] **Step 3: Implement the minimal added-progress renderer**

Add a small presentational helper inside `DiffDialog.tsx` that renders one labeled section and cards in evidence order. Each card resolves its image from `iconAssetId`; a resolved URL renders `<img alt={noteTitle}>`, while a missing URL renders the existing `Icon name="image"` with `aria-hidden="true"`. The visible card body is only the thumbnail and note title.

For this first green cycle, render the `Добавлено` section and its cards when non-empty. Keep progress evidence on its dedicated path even when the added list is empty so it can never fall through to scalar or generic asset rendering.

- [ ] **Step 4: Add the compact CSS contract**

Add:

```css
.game-diff-evidence--progress { display: grid; gap: 5px; }
.game-diff-progress__section { display: grid; gap: 3px; }
.game-diff-progress__label { color: var(--muted-2); font-size: 8px; }
.game-diff-progress__items { display: flex; flex-wrap: wrap; gap: 4px; }
.game-diff-progress__item { min-width: 0; max-width: 190px; display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 3px; color: var(--text); background: var(--field); font-size: 10px; }
.game-diff-progress__item--removed { color: var(--muted); }
.game-diff-progress__icon { width: 32px; height: 32px; display: grid; flex: 0 0 32px; place-items: center; overflow: hidden; border-radius: 3px; color: var(--muted); background: var(--surface-3); }
.game-diff-progress__icon img { width: 32px; height: 32px; display: block; object-fit: contain; }
.game-diff-progress__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

Do not add strike-through or technical metadata.

- [ ] **Step 5: Run the focused dialog test and verify GREEN**

Run:

```bash
npm test -- tests/ui-acceptance.test.tsx -t "renders semantic progress evidence"
```

Expected: PASS.

- [ ] **Step 6: Add failing removed, reordered, fallback, and atomic-control tests**

Add focused tests that assert:

- removed cards use `.game-diff-progress__item--removed` but `textDecorationLine` is not `line-through`;
- reorder-only displays `Порядок изменён`, renders cards in exact `after` order, and has no `Добавлено` or `Удалено` section;
- missing icon URLs show the existing image placeholder while `Заметка недоступна` remains visible;
- selection mode exposes exactly one checkbox named `Выбрать изменение: Прогресс`, and undo calls `onUndoChange` once with the progress selection id;
- the pre-existing generic image asset test still displays `800×600 · image/webp · 24 КБ`.

The production mutations caught are showing the wrong list for reorder, leaking removed decoration, making icons mandatory, or splitting selection by asset.

- [ ] **Step 7: Run the dialog regressions and verify RED then GREEN**

Run the new tests before completing missing branches and observe the intended assertion failures. Then render `Удалено` when non-empty, render `Порядок изменён` with `evidence.after` when `reordered` is true, and render `Изменено` with `evidence.after` when every semantic section is empty. Implement the minimal accessibility and removed-state corrections required by the tests, then run:

```bash
npm test -- tests/ui-acceptance.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Review Task 2**

Use a fresh review subagent with this task brief, its report, and a Jujutsu diff package. Require separate verdicts for specification compliance and code quality, including explicit inspection for leaked ids or generic asset metadata. Apply tested corrections through the implementer in this same working-copy change. Do not commit.

---

### Task 3: Verify the integrated local-changes experience

**Files:**
- Verify: `src/domain/changeReview.ts`
- Verify: `src/components/DiffDialog.tsx`
- Verify: `src/styles.css`
- Verify: `tests/change-review.test.ts`
- Verify: `tests/ui-acceptance.test.tsx`
- Verify: `docs/superpowers/specs/2026-08-07-semantic-progress-change-review-design.md`

**Interfaces:**
- Consumes the completed domain model and renderer from Tasks 1–2.
- Produces verification evidence only; no new production interface.

- [ ] **Step 1: Run focused and full automated verification**

Run:

```bash
npm test -- tests/change-review.test.ts tests/ui-acceptance.test.tsx
npm test
npm run build
```

Expected: all tests PASS and the TypeScript/Vite production build exits zero without warnings introduced by this feature.

- [ ] **Step 2: Reproduce the approved browser scenario**

Use the running local app and the in-app browser. Add at least three progress items sequentially so icon assets have different transactions, then open the complete local-changes dialog. Verify one `Прогресс` row under the game, correct resolved icons and note titles, no raw JSON, and no separate file rows for those icons. Enter partial-selection mode and verify progress is one selectable row; invoke and cancel undo if necessary to prove the action targets that row atomically without losing QA data.

Also inspect a normal attachment or standalone image change if one is available and confirm its generic file metadata remains unchanged. Restore any temporary QA data before completion.

- [ ] **Step 3: Run the final whole-feature review**

Use a fresh, high-capability review subagent with the approved spec, the complete plan, the task ledger, test reports, and a Jujutsu diff package covering the working-copy change. Require separate verdicts for specification compliance and code quality. If it returns load-bearing findings, dispatch one fix subagent with the complete list, rerun the covering tests, and perform one scoped re-review.

- [ ] **Step 4: Inspect and finalize one Jujutsu commit**

Run `jj status` and `jj diff`, confirm only this specification, plan, tests, and implementation are present, then finalize:

```bash
jj describe -m "Make progress changes semantic"
jj new
```

Confirm the fresh working copy is empty and the completed feature is exactly one immutable parent commit.
