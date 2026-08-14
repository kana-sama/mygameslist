# Table Overflow Word Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable Monaco word wrapping only when a valid Markdown table still exceeds the editing note's realized width after the shelf has exhausted rightward expansion.

**Architecture:** Keep the existing monotonic pixel demand for card growth and add a separate current table-width signal for overflow. `ShelfGrid` computes overflow from its final placement and publishes a transient DOM marker; a focused editor-local extension observes the marker and updates Monaco in place.

**Tech Stack:** React 19, TypeScript 7, Monaco Editor 0.56, CSS Grid, Vitest 4, Testing Library, JSDOM, Jujutsu.

## Global Constraints

- Expand the note through the existing anchored automatic-width behavior before deciding that the table still overflows.
- Set Monaco `wordWrap: "off"` only while the current valid table exceeds the final realized editing-card width; otherwise use `wordWrap: "on"`.
- Keep the existing automatic card width monotonic for the mounted editor session even when the current table shrinks or disappears.
- Never move the editing note left or to another shelf merely to gain width.
- Update the mounted Monaco instance in place; do not recreate its model or editor.
- Do not persist current table width, overflow state, or automatic width in note data.
- Do not change horizontal scrollbar styling or add controls, dependencies, or unrelated refactors.
- Preserve prose-only notes, read mode, persisted `doubleWidth`, manual size controls, attachments, formatting, drag behavior, save, and cancel behavior.
- Use Jujutsu (`jj`) exclusively for repository inspection and finalization; never invoke `git`.
- This feature, including its specification, plan, tests, and implementation, ends as exactly one commit. Do not create intermediate or per-task commits.
- Execute implementation through a subagent and complete task and final review gates before finalizing the single commit.

---

## File Structure

### New files

- `src/components/monacoMarkdownTableOverflowWrap.ts` — observe the shelf overflow marker and update Monaco word wrapping without remounting.
- `tests/monaco-markdown-table-overflow-wrap.test.ts` — real observer lifecycle and wrap-transition coverage.
- `docs/superpowers/specs/2026-08-14-table-overflow-word-wrap-design.md` — approved feature specification.
- `docs/superpowers/plans/2026-08-14-table-overflow-word-wrap.md` — this implementation plan.

### Modified files

- `src/pages/GamePage.tsx` — retain both current table width and the existing session maximum on the editing card.
- `src/components/ShelfGrid.tsx` — compare current table width with the final realized placement and maintain the transient overflow marker.
- `src/components/MonacoNoteEditor.tsx` — install and dispose the overflow-wrap extension with the other note-editor extensions.
- `tests/note-editor-auto-width.test.tsx` — verify current width changes independently from monotonic expansion demand.
- `tests/shelf-grid.test.tsx` — verify final-placement overflow marking and clearing.
- `tests/monaco-note-editor.test.tsx` — verify extension installation order and reverse disposal.

### Task 1: Switch wrapping from final shelf overflow

**Files:**
- Create: `src/components/monacoMarkdownTableOverflowWrap.ts`
- Create: `tests/monaco-markdown-table-overflow-wrap.test.ts`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/components/ShelfGrid.tsx`
- Modify: `src/components/MonacoNoteEditor.tsx`
- Modify: `tests/note-editor-auto-width.test.tsx`
- Modify: `tests/shelf-grid.test.tsx`
- Modify: `tests/monaco-note-editor.test.tsx`

**Interfaces:**
- The editing article continues to expose the session maximum as `data-shelf-required-width`.
- The editing article exposes the latest observer report as `data-shelf-current-table-width`; zero or no valid table removes the attribute.
- `ShelfGrid` exposes a current residual overflow as `data-shelf-table-overflow="true"` on the `.note-card--editing` element only after computing the final placement.
- The new module produces:

```ts
export function installMonacoMarkdownTableOverflowWrap(
  context: MonacoMarkdownEditorReadyContext,
): Monaco.IDisposable;
```

- [ ] **Step 1: Write failing editing-card state tests**

Extend `tests/note-editor-auto-width.test.tsx` so one current report can shrink while the automatic demand remains monotonic:

```ts
act(() => widthReports.get(`note:${NOTE_ID}`)?.(730));
expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
expect(editingCard).toHaveAttribute("data-shelf-current-table-width", "730");

act(() => widthReports.get(`note:${NOTE_ID}`)?.(360));
expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
expect(editingCard).toHaveAttribute("data-shelf-current-table-width", "360");

act(() => widthReports.get(`note:${NOTE_ID}`)?.(0));
expect(editingCard).toHaveAttribute("data-shelf-required-width", "730");
expect(editingCard).not.toHaveAttribute("data-shelf-current-table-width");
```

Production change caught: incorrectly reusing only the session maximum would keep wrapping disabled after a table shrinks or disappears.

- [ ] **Step 2: Write failing final-placement shelf tests**

Extend `tests/shelf-grid.test.tsx` with real `ShelfGrid` layouts:

```tsx
<article
  className="note-card--editing"
  data-note-id="editor"
  data-shelf-current-table-width="2000"
  data-shelf-required-width="2000"
/>
```

For the existing four-column, right-edge fixture, expect the anchored editor to remain in column four and gain `data-shelf-table-overflow="true"`. Add a fitting expanded-card fixture whose final two-column capacity contains the current width and therefore has no marker. Rerender the oversized fixture with `data-shelf-current-table-width="360"` while keeping `data-shelf-required-width="2000"`; expect the marker to clear without reducing the retained session span.

Production changes caught: comparing before expansion, comparing against total grid width, forgetting right-edge clamping, or failing to clear stale overflow state.

- [ ] **Step 3: Write failing Monaco overflow-wrap lifecycle tests**

Create `tests/monaco-markdown-table-overflow-wrap.test.ts`. Mount a real editing-card DOM fixture, attach the fake editor DOM below it, and use a real `MutationObserver`. Verify:

```ts
const disposable = installMonacoMarkdownTableOverflowWrap(context);

editingCard.dataset.shelfTableOverflow = "true";
await Promise.resolve();
expect(editor.updateOptions).toHaveBeenLastCalledWith({ wordWrap: "off" });

editingCard.removeAttribute("data-shelf-table-overflow");
await Promise.resolve();
expect(editor.updateOptions).toHaveBeenLastCalledWith({ wordWrap: "on" });
```

Also cover an initially marked card, repeated equivalent marker mutations without duplicate updates, no owning editing card, and no updates after `dispose()`.

Production changes caught: reversed modes, observing the wrong element, redundant updates, lost restoration, or leaked observation after editor disposal.

- [ ] **Step 4: Write the failing note-editor extension wiring test**

Mock `installMonacoMarkdownTableOverflowWrap` in `tests/monaco-note-editor.test.tsx`. Require installation after width measurement and before list editing, then require reverse disposal order:

```text
actions, completion, list, overflow-wrap, width, table
```

Production change caught: the extension exists but is never owned by the note editor or leaks on unmount.

- [ ] **Step 5: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/note-editor-auto-width.test.tsx tests/shelf-grid.test.tsx tests/monaco-markdown-table-overflow-wrap.test.ts tests/monaco-note-editor.test.tsx
```

Expected: FAIL because current table width is not published, final shelf overflow is not marked, the new extension module is missing, and `MonacoNoteEditor` does not install it.

- [ ] **Step 6: Publish current table width without weakening monotonic growth**

In the editing note component in `src/pages/GamePage.tsx`, add a current-width state beside `requiredTableWidth`. Replace the one-purpose callback with one that sanitizes every report, stores the latest positive current width or zero, and raises `requiredTableWidth` only through `Math.max`. Add `data-shelf-current-table-width={currentTableWidth || undefined}` while preserving `data-shelf-required-width={requiredTableWidth || undefined}`.

- [ ] **Step 7: Mark residual overflow from the final shelf placement**

In `src/components/ShelfGrid.tsx`, keep current-width parsing separate from the session demand used by `shelfColumnSpanForWidth`. After all `expandShelfLayout` calls produce `shelfLayout`, calculate one-column width from `gridWidth`, `columnCount`, and `columnGap`; calculate each final placement's capacity as:

```ts
const placementWidth = columnWidth * placement.columnSpan
  + columnGap * Math.max(0, placement.columnSpan - 1);
```

Set `data-shelf-table-overflow="true"` on an editing card only when its finite positive current width exceeds that placement capacity; otherwise remove the marker. Remove stale markers from cards that no longer contain an editing card. Do not add the new marker to the shelf `MutationObserver` attribute filter.

Add `data-shelf-current-table-width` to the shelf `MutationObserver` attribute filter so a current-width decrease recomputes the marker even when the monotonic required width does not change. Do not add `data-shelf-table-overflow` to that filter, because the marker is layout output and observing it would create a feedback loop.

- [ ] **Step 8: Implement the focused Monaco extension**

In `src/components/monacoMarkdownTableOverflowWrap.ts`, find the owning `.note-card--editing` from `context.editor.getDomNode()`. Treat the default state as `wordWrap: "on"`; update only when the desired state changes. Observe only `data-shelf-table-overflow`, call `editor.updateOptions({ wordWrap: desired })`, and disconnect on disposal. If no owning card exists, return a no-op disposable.

- [ ] **Step 9: Install the extension in the note editor**

Import and install `installMonacoMarkdownTableOverflowWrap` in `src/components/MonacoNoteEditor.tsx` immediately after `installMonacoMarkdownTableWidth`. Let the existing reverse `disposeAll` ownership clean it up on partial installation failure and editor unmount.

- [ ] **Step 10: Run focused tests and verify GREEN**

Run the Step 5 command again. Expected: PASS with no warnings.

- [ ] **Step 11: Run regression verification**

Run:

```bash
npm test
npm run build
```

Expected: every test passes and the production build exits successfully without new warnings.

- [ ] **Step 12: Self-review and prepare the single working-copy change**

Inspect only with:

```bash
jj status
jj diff
```

Confirm the diff contains only the approved specification, this plan, implementation, and permanent behavior tests. Do not finalize or create additional commits; the controller will run the required review gates and finalize exactly one commit with `jj describe` followed by `jj new`.
