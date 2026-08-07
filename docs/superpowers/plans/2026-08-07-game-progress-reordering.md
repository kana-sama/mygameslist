# Game Progress Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every saved progress cell draggable for persistent reordering while restoring the exact approved transparent-cell, large-count visual design.

**Architecture:** Keep array order as the sole persisted order and add one pure reorder helper. `GameProgressGrid` owns `@dnd-kit` sensors, sortable cells, overlay, announcements, and click suppression; `InlineGamePage` persists the reordered editable array through its existing save path. Visual rules are encoded in shared CSS selectors and source-level assertions tied to the approved mockup.

**Tech Stack:** React 19, TypeScript 7, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, Vitest 4, Testing Library, JSDOM, Vite 8, Jujutsu.

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository operations; never invoke Git.
- Keep the approved specification, plan, AGENTS rule, tests, and implementation in exactly one follow-up feature commit. Do not create task commits.
- Normative reference: `.superpowers/brainstorm/90642-1786059988/content/full-panel-normalized-64-icons.html`.
- Supporting reference: `.superpowers/brainstorm/90642-1786059988/content/full-panel-static-aligned-grid.html`.
- Written contract: `docs/superpowers/specs/2026-08-07-game-progress-reordering-design.md`.
- Saved cells and the add cell have transparent idle backgrounds; the idle add cell has no visible border.
- Normal counts are exactly 14 px; broken text is exactly 11 px; icon and value rows remain exactly 64 px and 17 px.
- `Прогресс` shares one typography declaration with `.game-sidebar__meta dt`.
- The whole saved-item button is the activator. Do not add a handle, visible label, badge, or instruction.
- Keep exactly three columns at every responsive width. The add cell stays outside the sortable ids and remains last.
- Reuse existing dependencies; add no package.
- Preserve add, edit, delete, clipboard, checklist-resolution, focus-restoration, asset persistence, and garbage-collection behavior.
- Each implementation task runs through a fresh subagent and receives a fresh review gate before the next task.

---

## File Structure

### New files

- `src/domain/progressItems.ts` — pure stable-id array reorder helper with standard sortable index semantics.
- `tests/game-progress-reordering.test.ts` — focused pure reorder contract.
- `docs/superpowers/specs/2026-08-07-game-progress-reordering-design.md` — approved interaction and visual specification.
- `docs/superpowers/plans/2026-08-07-game-progress-reordering.md` — this plan.

### Modified files

- `AGENTS.md` — make approved visual designs binding and require direct state/viewport comparison before commit.
- `src/components/GameProgressGrid.tsx` — split count styling, make saved cells sortable, own sensors/overlay/announcements/click suppression.
- `src/pages/GamePage.tsx` — map a drop to the pure helper and persist reordered editable progress items.
- `src/styles.css` — exact heading, transparent idle, large-count, hover/focus/drag, overlay, and sortable-transition styling.
- `tests/game-progress-ui.test.tsx` — component DOM, exact CSS contract, sensor configuration, click, drag, cancellation, and add exclusion.
- `tests/ui-acceptance.test.tsx` — real `GamePage` persistence, pointer/keyboard sorting, focus, and unrelated-save preservation.

---

### Task 1: Restore the approved visual contract

**Files:**
- Modify: `src/components/GameProgressGrid.tsx`
- Modify: `src/styles.css`
- Modify: `tests/game-progress-ui.test.tsx`
- Verify: `AGENTS.md`
- Verify: `docs/superpowers/specs/2026-08-07-game-progress-reordering-design.md`

**Interfaces:**
- Consumes: existing `GameProgressGridProps`, `NoteChecklistResolution`, and the existing `.game-progress*` class names.
- Produces: count-part classes `.game-progress__checked`, `.game-progress__slash`, `.game-progress__total`; shared metadata-heading typography; exact idle/hover/focus visual rules used unchanged by Task 2.

- [ ] **Step 1: Add failing DOM assertions for large split counts without visible labels**

Extend the first `GameProgressGrid` test in `tests/game-progress-ui.test.tsx`:

```tsx
expect(within(valid).getByText("2")).toHaveClass("game-progress__checked");
expect(within(valid).getByText("/")).toHaveClass("game-progress__slash");
expect(within(valid).getByText("5")).toHaveClass("game-progress__total");
expect(valid).toHaveTextContent("2/5");
expect(valid.children).toHaveLength(2);
expect(broken.querySelector(".game-progress__checked")).toBeNull();
expect(broken.querySelector(".game-progress__value")).toHaveTextContent("ошибка");
```

Keep the existing assertions that normal cells leak no note title and contain exactly one image.

- [ ] **Step 2: Add a failing computed-style contract test against the real component**

Add a test named `matches the approved metadata heading and transparent large-count grid contract`. Insert the complete production stylesheet into a temporary `<style>` element, render a real metadata term beside `GameProgressGrid`, and assert consumer-visible computed styles:

```tsx
const productionStyle = document.createElement("style");
productionStyle.textContent = readFileSync("src/styles.css", "utf8");
document.head.append(productionStyle);
render(<>
  <dl className="game-sidebar__meta"><div><dt>Теги</dt><dd>LEGO</dd></div></dl>
  <GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={items} notes={notes} onAdd={vi.fn()} onEdit={vi.fn()} resolveAssetUrl={() => "/icon.webp"} />
</>);

const headingStyle = getComputedStyle(screen.getByRole("heading", { name: "Прогресс" }));
const termStyle = getComputedStyle(screen.getByText("Теги"));
for (const property of ["color", "fontSize", "fontWeight", "letterSpacing", "textTransform"] as const) {
  expect(headingStyle[property]).toBe(termStyle[property]);
}
expect(headingStyle.fontSize).toBe("8px");
expect(headingStyle.textTransform).toBe("uppercase");

const savedStyle = getComputedStyle(screen.getByRole("button", { name: "Редактировать элемент прогресса: 2 из 5" }));
const addStyle = getComputedStyle(screen.getByRole("button", { name: "Добавить элемент прогресса" }));
expect(savedStyle.height).toBe("88px");
expect(savedStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
expect(savedStyle.borderTopColor).toBe("rgba(0, 0, 0, 0)");
expect(addStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
expect(addStyle.borderTopColor).toBe("rgba(0, 0, 0, 0)");

const valueStyle = getComputedStyle(screen.getByText("2").closest(".game-progress__value")!);
const errorStyle = getComputedStyle(screen.getByText("ошибка"));
expect(valueStyle.fontSize).toBe("14px");
expect(valueStyle.lineHeight).toBe("17px");
expect(errorStyle.fontSize).toBe("11px");
productionStyle.remove();
```

Keep hover, focus, and drag-state surface/border verification in Task 3's real-browser acceptance, where those pseudo-classes and pointer states are observable rather than inferred from source text.

- [ ] **Step 3: Run Task 1 tests to prove the current visual mismatch**

Run:

```bash
npm test -- tests/game-progress-ui.test.tsx
```

Expected: FAIL because the current value is one text node, computed counts are 10 px, broken text is 9 px, computed heading typography differs from metadata terms, and idle cells compute to a persistent surface and visible border.

- [ ] **Step 4: Split finite values into styled semantic fragments**

In `GameProgressGrid.tsx`, replace the finite `value` string rendering with:

```tsx
<span className="game-progress__value">
  {resolution.status === "ok" ? (
    <>
      <span className="game-progress__checked">{resolution.checked}</span>
      <span className="game-progress__slash">/</span>
      <span className="game-progress__total">{resolution.total}</span>
    </>
  ) : "ошибка"}
</span>
```

Do not add a visual label or wrapper beyond the existing icon/value children. Preserve the existing accessible edit label exactly.

- [ ] **Step 5: Implement the shared heading and exact idle/count CSS**

Replace the independent heading typography with one shared declaration:

```css
.game-sidebar__meta dt, .game-progress__heading { color: var(--muted-2); font-size: 8px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; }
.game-progress__heading { margin: 0 0 5px; }
```

Use this cell/count contract:

```css
.game-progress__item, .game-progress__add { min-width: 0; height: 88px; appearance: none; padding: 0; border: 1px solid transparent; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer; }
.game-progress__item { display: grid; grid-template-rows: 64px 17px; row-gap: 2px; justify-items: center; overflow: hidden; }
.game-progress__item:hover, .game-progress__item:focus-visible { border-color: #30343a; background: #17191c; }
.game-progress__add:hover:not(:disabled), .game-progress__add:focus-visible { border-color: #30343a; border-style: dashed; background: #17191c; }
.game-progress__value { height: 17px; display: flex; align-items: baseline; justify-content: center; color: #f0f1f2; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 14px; font-variant-numeric: tabular-nums; font-weight: 690; letter-spacing: -.07em; line-height: 17px; white-space: nowrap; }
.game-progress__slash { padding: 0 1px; color: #50565e; font-weight: 350; }
.game-progress__total { color: #9399a1; font-weight: 560; }
.game-progress__item.is-complete .game-progress__value, .game-progress__item.is-complete .game-progress__value > span { color: var(--success); }
.game-progress__item.is-error .game-progress__value { color: #df888f; font-family: inherit; font-size: 11px; font-weight: 720; letter-spacing: 0; }
.game-progress__add { display: grid; place-items: center; }
```

Keep the existing focus outline. Do not put `border-style: dashed` or a surface color on the idle add cell.

- [ ] **Step 6: Run Task 1 tests and the existing acceptance slice**

Run:

```bash
npm test -- tests/game-progress-ui.test.tsx tests/ui-acceptance.test.tsx
```

Expected: PASS, including all existing add/edit/delete/focus behavior.

- [ ] **Step 7: Review Task 1 against the mockup and AGENTS rule**

Use a fresh review subagent. It must read both normative HTML references, the approved spec, `AGENTS.md`, the component diff, CSS diff, and tests. Reject persistent idle fills/borders, 10 px values, 9 px errors, independent heading typography, extra visible content, or completed decoration beyond value color. Apply corrections in the same working-copy change and rerun Step 6. Do not commit.

---

### Task 2: Add whole-cell sortable reordering and persistence

**Files:**
- Create: `src/domain/progressItems.ts`
- Create: `tests/game-progress-reordering.test.ts`
- Modify: `src/components/GameProgressGrid.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `tests/game-progress-ui.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`

**Interfaces:**
- Produces:

```ts
export function reorderProgressItems<T extends { id: string }>(
  items: readonly T[],
  activeId: string,
  overId: string,
): T[] | null;

export class NonTouchProgressPointerSensor extends PointerSensor;
export const PROGRESS_GRID_SENSOR_TYPES: {
  pointer: typeof NonTouchProgressPointerSensor;
  touch: typeof TouchSensor;
  keyboard: typeof KeyboardSensor;
};
export const PROGRESS_GRID_SENSOR_OPTIONS: {
  pointer: { activationConstraint: { distance: 8 } };
  touch: { activationConstraint: { delay: 180; tolerance: 8 } };
  keyboard: {
    coordinateGetter: typeof sortableKeyboardCoordinates;
    keyboardCodes: {
      start: [KeyboardCode.Space, KeyboardCode.Enter];
      cancel: [KeyboardCode.Esc];
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab];
    };
  };
};
```

- Extends `GameProgressGridProps` with:

```ts
sortingDisabled?: boolean;
onReorder(activeItemId: string, overItemId: string): void | Promise<void>;
```

- Consumes the exact Task 1 classes and count fragments for saved cells and the overlay.

- [ ] **Step 1: Write failing pure reorder tests**

Create `tests/game-progress-reordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reorderProgressItems } from "../src/domain/progressItems";

const items = [
  { id: "a", noteId: "note-a" },
  { id: "b", noteId: "note-b" },
  { id: "c", noteId: "note-c" },
  { id: "d", noteId: "note-d" },
];

describe("reorderProgressItems", () => {
  it("uses sortable arrayMove semantics in both directions without cloning item data", () => {
    const forward = reorderProgressItems(items, "a", "c")!;
    const backward = reorderProgressItems(items, "d", "b")!;
    expect(forward.map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
    expect(backward.map((item) => item.id)).toEqual(["a", "d", "b", "c"]);
    expect(forward[2]).toBe(items[0]);
    expect(backward[1]).toBe(items[3]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it.each([["a", "a"], ["missing", "b"], ["a", "missing"]])("returns null for no-op or unresolved %s -> %s", (active, over) => {
    expect(reorderProgressItems(items, active, over)).toBeNull();
  });
});
```

- [ ] **Step 2: Add failing component sensor and whole-cell drag tests**

In `tests/game-progress-ui.test.tsx`, import `KeyboardCode`, `KeyboardSensor`, `PointerSensor`, `TouchSensor`, `sortableKeyboardCoordinates`, `NonTouchProgressPointerSensor`, `PROGRESS_GRID_SENSOR_TYPES`, and `PROGRESS_GRID_SENSOR_OPTIONS`.

Add a configuration test requiring the exact exported types/options from the Interfaces block. Assert the custom pointer sensor rejects `pointerType: "touch"` and delegates mouse pointers to the base activator, matching the existing note/tier Safari-safe pattern.

Add a three-item component test with fixed `getBoundingClientRect()` values. Pass `onReorder` and `onEdit` spies, then:

```ts
await user.click(first);
expect(onEdit).toHaveBeenCalledWith(ITEM_A, first);
onEdit.mockClear();

await user.pointer([
  { keys: "[MouseLeft>]", target: first, coords: { clientX: 20, clientY: 40 } },
  { target: first, coords: { clientX: 32, clientY: 40 } },
  { target: third, coords: { clientX: 160, clientY: 130 } },
  { keys: "[/MouseLeft]", target: third, coords: { clientX: 160, clientY: 130 } },
]);

await waitFor(() => expect(onReorder).toHaveBeenCalledWith(ITEM_A, ITEM_C));
expect(onEdit).not.toHaveBeenCalled();
```

Assert every saved button has `aria-roledescription="перетаскиваемый элемент прогресса"`, the active source receives `is-dragging`, an overlay appears only during drag, and the add button lacks sortable description/data and remains the grid's final child. Add cancellation/outside-drop coverage requiring zero `onReorder` calls.

- [ ] **Step 3: Add failing GamePage persistence and keyboard tests**

In `tests/ui-acceptance.test.tsx`, add a stateful game with three progress items and three finite notes. Mock exact three-column item rectangles. Pointer-drag the first saved button over the third and require the first `onSave` input order to be `[ITEM_B, ITEM_C, ITEM_A]`, with every `iconAssetId`, `noteId`, and `pendingIcon` preserved.

Add a keyboard test:

```ts
first.focus();
await user.keyboard("[Space][ArrowRight][Enter]");
await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
expect(onSave.mock.calls[0][0].progressItems.map((item) => item.id))
  .toEqual([ITEM_B, ITEM_A, ITEM_C]);
expect(document.activeElement).toHaveAttribute("data-progress-item-id", ITEM_A);
```

Assert a short click still opens `dialog "Элемент прогресса"`, a cancelled drag does not call `onSave`, the add cell remains last, and the existing unrelated-title-save test preserves the latest reordered order.

- [ ] **Step 4: Run the new Task 2 tests to verify RED**

Run:

```bash
npm test -- tests/game-progress-reordering.test.ts tests/game-progress-ui.test.tsx tests/ui-acceptance.test.tsx
```

Expected: FAIL because the pure module, sortable exports/props, drag state, overlay, persistence callback, and keyboard flow do not exist.

- [ ] **Step 5: Implement the pure reorder helper**

Create `src/domain/progressItems.ts`:

```ts
export function reorderProgressItems<T extends { id: string }>(items: readonly T[], activeId: string, overId: string): T[] | null {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return null;
  const reordered = [...items];
  const [active] = reordered.splice(activeIndex, 1);
  reordered.splice(overIndex, 0, active);
  return reordered;
}
```

- [ ] **Step 6: Add exact progress sensors and a sortable saved-cell boundary**

In `GameProgressGrid.tsx`, add the `@dnd-kit` imports and the exported sensor constants from the Interfaces block. Use a `NonTouchProgressPointerSensor` activator identical in shape to `NonTouchNotePointerSensor`, but with the progress-specific name.

Extract a presentational `ProgressCellContent` that renders the Task 1 icon/value fragments. Add `SortableProgressItem` using:

```ts
const sortableId = `progress:${item.id}`;
const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
  id: sortableId,
  animateLayoutChanges: () => false,
  attributes: { roleDescription: "перетаскиваемый элемент прогресса" },
  data: { type: "progress-item", itemId: item.id },
  disabled: sortingDisabled,
});
```

Attach `setNodeRef` and `data-progress-item-id` to the existing saved-item button. Attach `setActivatorNodeRef`, `attributes`, and `listeners` to that same button so any point is draggable. Apply `CSS.Transform.toString(transform)` plus `transition`. Keep the same button as the click target for edit.

- [ ] **Step 7: Wrap only saved items in the sortable context and suppress post-drop edit**

Create pointer/touch/keyboard sensors with `useSensors`. Wrap the existing grid in `DndContext` and wrap only `items.map(...)` in:

```tsx
<SortableContext items={items.map((item) => `progress:${item.id}`)} strategy={rectSortingStrategy}>
  {sortableItems}
</SortableContext>
```

Render the add button after `SortableContext` but inside `.game-progress__grid`.

On drag start, store the active item id in state and in `suppressEditFor.current`. On cancel/end, clear the visual active id immediately and clear suppression with `window.setTimeout(..., 0)`. The saved-cell `onClick` must return without calling `onEdit` while its id is suppressed. On a valid end, extract `itemId` from active/over data, reject missing/same ids, and invoke `onReorder(activeItemId, overItemId)` exactly once.

Configure Russian announcements:

```ts
onDragStart: ({ active }) => `Вы взяли элемент прогресса ${indexOf(active) + 1} из ${items.length}.`,
onDragOver: ({ over }) => over ? `Новое место: ${indexOf(over) + 1} из ${items.length}.` : "Элемент вне списка прогресса.",
onDragEnd: ({ over }) => over ? "Порядок элементов прогресса изменён." : "Перемещение элемента прогресса отменено.",
onDragCancel: () => "Перемещение элемента прогресса отменено.",
```

Render `DragOverlay dropAnimation={null}` with one non-button `.game-progress__item.game-progress__drag-overlay` containing the same icon/value content and `aria-hidden="true"`.

- [ ] **Step 8: Add drag/overlay CSS without violating transparent idle states**

Add:

```css
.game-progress__item { touch-action: manipulation; transition: border-color .12s, background .12s, opacity .12s, transform .16s ease; }
.game-progress__item.is-dragging { opacity: .25; cursor: grabbing; }
.game-progress__item.is-drop-target, .game-progress__drag-overlay { border-color: #30343a; background: #17191c; }
.game-progress__drag-overlay { width: 100%; cursor: grabbing; box-shadow: 0 8px 20px rgba(0, 0, 0, .28); }
```

The idle base rule must remain transparent. Do not add a default surface to `.game-progress__item` or `.game-progress__add`.

- [ ] **Step 9: Persist exact array order through `InlineGamePage`**

Import `reorderProgressItems` in `GamePage.tsx` and add:

```ts
const moveProgressItem = async (activeItemId: string, overItemId: string) => {
  if (saving) return;
  const reordered = reorderProgressItems(editableProgressItems, activeItemId, overItemId);
  if (!reordered) return;
  await persist({ progressItems: reordered });
};
```

Pass `onReorder={(activeId, overId) => moveProgressItem(activeId, overId)}` and `sortingDisabled={saving}` to `GameProgressGrid`. Keep the current add `disabled={storageLocked || saving}` behavior, so storage lock does not hide or disable editing existing cells and does not redefine asset behavior.

- [ ] **Step 10: Run Task 2 focused verification**

Run:

```bash
npm test -- tests/game-progress-reordering.test.ts tests/game-progress-ui.test.tsx tests/ui-acceptance.test.tsx tests/game-progress-model.test.ts tests/library-context.test.tsx tests/asset-garbage-collection.test.ts
```

Expected: PASS with pointer, touch configuration, keyboard sorting, persistence, click/edit, cancellation, visual, model, and asset regressions green.

- [ ] **Step 11: Review Task 2 behavior and data integrity**

Use a fresh review subagent. It must verify standard arrayMove semantics, no schema/rank field, whole-button activation, threshold-preserved click, post-drop suppression, pointer/touch/keyboard sensors, announcements, focus, add exclusion, no-op/outside/cancel behavior, saving lock, unchanged icons/notes/pending blobs, and no regression to Task 1's visual contract. Apply corrections in the same working-copy change and rerun Step 10. Do not commit.

---

### Task 3: Full verification and direct visual comparison

**Files:**
- Verify: all files listed above
- Append ignored evidence: `.superpowers/sdd/2026-08-07-game-progress-reordering/task-3-report.md`
- Append ignored ledger: `.superpowers/sdd/2026-08-07-game-progress-reordering/progress.md`

**Interfaces:**
- Consumes the completed Task 1 visual contract and Task 2 persistence/interaction contract.
- Produces verification evidence and a clean final review; no new public production interface.

- [ ] **Step 1: Run the exact focused feature suite**

Run:

```bash
npm test -- tests/game-progress-reordering.test.ts tests/game-progress-ui.test.tsx tests/ui-acceptance.test.tsx tests/game-progress-checklist.test.ts tests/game-progress-model.test.ts tests/progress-icon.test.ts tests/markdown-tasks.test.tsx tests/image-picker.test.tsx tests/domain-core.test.ts tests/asset-garbage-collection.test.ts tests/patch-selection.test.ts tests/change-review.test.ts tests/library-context.test.tsx tests/published-data-validation.test.mjs
```

Expected: all files and tests PASS with zero unhandled errors.

- [ ] **Step 2: Run repository-wide gates**

Run separately and record every exit code:

```bash
npm test
npm run build
npm run data:validate
```

Expected: all exit 0. Treat the existing Vite large-chunk advisory as informational unless its content changes materially.

- [ ] **Step 3: Compare implementation structurally with the approved references**

Inspect the normative/supporting HTML, `AGENTS.md`, the approved specification, `GameProgressGrid.tsx`, and the complete progress CSS. Record exact evidence that:

- the complete sidebar placement and three columns match;
- `Прогресс` shares the metadata-term declaration;
- normal counts are 14 px on a 17 px baseline below a 64 px icon row;
- idle saved cells have transparent surfaces/borders;
- the idle add cell has transparent surface/border despite the original mockup's add fill;
- hover/focus/drag alone reveal the correct solid/dashed treatment;
- complete styling changes only value color;
- there is no visible handle or extra normal text.

- [ ] **Step 4: Run real-browser interaction and visual acceptance**

On a game with at least four progress items, verify at the real 220 px sidebar and at a narrow responsive viewport:

1. capture the full sidebar in the idle state and compare it directly to the normative mockup;
2. inspect computed heading typography against a `Теги` or `Изменено` `dt` and require equal color, size, weight, spacing, and uppercase transformation;
3. require computed normal count size 14 px, error size 11 px, icon natural/rendered size 64, fixed 17 px value row, and three grid tracks;
4. require transparent idle saved/add backgrounds and transparent idle borders;
5. hover a saved item and the add cell, then keyboard-focus each, verifying surfaces and solid/dashed borders appear only in those states;
6. drag the first item from any point over the fourth item, observe overlay/source/target treatment, drop, and verify the new row-major order persists after reload/rerender;
7. verify the drop does not open the editor, then short-click the moved item and verify the editor opens;
8. keyboard-reorder one item and verify focus remains on it;
9. cancel one drag and drop once outside, verifying no order change;
10. restore the original order and remove any QA items/notes/icons without altering pre-existing local changes.

- [ ] **Step 5: Request final whole-feature review**

Use a fresh reviewer with the exact normative paths. It must inspect the entire current Jujutsu diff, the approved spec/plan, automated results, real-browser evidence, and `AGENTS.md`. It must report Critical/Important findings only and explicitly answer whether every approved visual invariant and drag/persistence invariant is satisfied. Apply one bounded correction wave if needed, rerun Steps 1-4, and request one scoped re-review.

- [ ] **Step 6: Inspect and finalize exactly one Jujutsu commit**

The controller, not a task subagent, runs:

```bash
jj status
jj diff --stat
jj diff
jj describe -m "Reorder game progress items"
jj new
jj status
```

Before `jj describe`, require only `AGENTS.md`, the approved spec/plan, the intended source/CSS files, and their tests. After `jj new`, require an empty working copy whose parent is the single described feature commit.

---

## Final acceptance checklist

- The whole saved cell drags; no handle appears; a short click still edits.
- Pointer, delayed touch, and keyboard sorting work and announce state in Russian.
- Drop uses exact arrayMove semantics, saves once, preserves item data, and survives rerender/reload.
- Cancel, outside, same-item, and post-drop click paths do not save or open the editor.
- The add cell remains last and is never sortable.
- `Прогресс` exactly matches metadata-term typography through a shared CSS declaration.
- Idle saved/add backgrounds are transparent; idle add border is transparent.
- Hover/focus/drag reveal only the approved surfaces and solid/dashed borders.
- Normal values are 14 px; errors are 11 px; 64 px icon and 17 px value rows remain aligned.
- Completion remains value-color-only, and broken/edit/delete/clipboard/asset behavior remains green.
- `AGENTS.md` prevents future unapproved divergence from selected visual designs.
- One Jujutsu commit contains specification, plan, policy, tests, and implementation; the next working copy is empty.
