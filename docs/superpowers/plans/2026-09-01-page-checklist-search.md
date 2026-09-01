# Page Checklist Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить на страницу игры fuzzy-поиск по checklist items и обоим типам аннотаций с inline tri-state actions, browser-local recent history и переходом к скрытому исходному пункту.

**Architecture:** Общий чистый fuzzy scorer обслуживает игры и checklist index. Checklist index строится из authoritative Markdown и общих inline/checklist parsers, а React palette получает snapshot по требованию, сохраняет через существующий note-interaction path и передаёт заметке структурный navigation request. Recent history хранит только bounded identities в отдельном localStorage key.

**Tech Stack:** TypeScript 7, React 19, Vitest 4, Testing Library, существующие Markdown/checklist/rich-tooltip domain helpers, CSS из `src/styles.css`, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-09-01-page-checklist-search-design.md`

## Global Constraints

- Никаких новых fuzzy-search dependencies: улучшить и переиспользовать существующий алгоритм.
- Simple tooltip `[text]("description")` и rich tooltip `[text][?]` являются разными полноценными типами аннотаций и оба индексируются.
- `Shift+Click` и `Cmd+Click` выполняют одинаковый partial transition; `Cmd+Space` не регистрируется.
- Palette доступна только на существующей desktop game page и блокируется editor/modal state.
- Утверждённый visual reference: `.superpowers/brainstorm/96049-1788248038/content/refined-two-pane-v5.html`.
- Геометрия palette: `690×366px`, колонки `44% / 56%`, result row без `height`/`min-height`, padding `7px 10px`.
- Пользовательская коррекция переопределяет reference только для размера текста: query, item text, annotation title и simple/rich body следуют существующей primary/control ступени `12px`; path, footer hints и `Esc` — существующей secondary/label ступени `9px`. Не вводить palette-only `13px` и не менять геометрию ради более крупного текста.
- Recent cache хранит только identities: максимум `8` на игру, `24` глобально и `8 KiB` serialized payload.
- Не добавлять permanent tests, зависящие от реального содержимого `data/`.
- Не создавать task-level commits. После всех задач spec, plan, implementation и tests финализируются одним `jj describe`, затем создаётся fresh change через `jj new`.

## File Structure

- Create `src/domain/fuzzySearch.ts`: общий normalization, layout variants, scoring и matched-field result.
- Modify `src/domain/catalogue.ts`: тонкий game wrapper общего scorer.
- Create `src/domain/markdownInlineAnnotations.ts`: единый parser simple/rich inline annotations и plain-text projection.
- Modify `src/components/markdownInlineSyntax.ts`: переиспользование/re-export общего tokenizer/parser без изменения diff projection.
- Create `src/domain/checklistSearch.ts`: checklist index, stable identities, paths, annotation resolution и fuzzy projection.
- Create `src/domain/markdownTaskState.ts`: единые regular/partial transitions и source mutators list/table.
- Create `src/state/checklistSearchHistory.ts`: bounded versioned localStorage/in-memory recent store.
- Create `src/components/PageChecklistSearch.tsx`: dialog, keyboard modes, preview, optimistic actions и shortcut.
- Modify `src/components/MarkdownRichTooltip.tsx`: экспорт неинтерактивного body renderer для preview.
- Modify `src/components/Markdown.tsx`: общий annotation parser, tri-state mouse rules и target markup/highlight props.
- Modify `src/pages/GamePage.tsx`: authoritative snapshot builder, palette save callback, blocking, reveal/navigation request и focus restoration.
- Modify `src/styles.css`: утверждённая overlay/palette/result/preview/highlight геометрия и states.
- Modify `src/domain/index.ts` and `src/components/index.ts`: экспорт новых публичных interfaces/helpers, которые нужны соседним слоям.
- Create focused tests under `tests/` for fuzzy search, annotations/index, history and palette; extend existing Markdown/GamePage suites for shared interactions and navigation.

---

### Task 1: Extract and improve the shared fuzzy scorer

**Files:**
- Create: `src/domain/fuzzySearch.ts`
- Modify: `src/domain/catalogue.ts`
- Modify: `src/domain/index.ts`
- Create: `tests/fuzzy-search.test.ts`
- Modify: `tests/domain-core.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FuzzySearchField<FieldId extends string> {
  id: FieldId;
  priority: "primary" | "secondary";
  text: string;
}

export interface FuzzySearchMatch<FieldId extends string> {
  matchedFieldIds: readonly FieldId[];
  score: number;
}

export function searchQueryVariants(value: string): string[];
export function fuzzySearch<FieldId extends string>(
  query: string,
  fields: readonly FuzzySearchField<FieldId>[],
): FuzzySearchMatch<FieldId> | null;
```

- Preserves: `gameSearchScore(game, query): number` and every existing `gameMatchesFilters` caller.

- [ ] **Step 1: Write failing shared-scorer tests**

Add fixture assertions covering exact/prefix/substring, primary-before-secondary, wrong keyboard layout, initials, multi-field AND terms, `etnl → eternal` with a gap beyond the old limit, `eteranl → eternal` transposition, deterministic `matchedFieldIds`, and rejection of broad two-character fuzzy matches.

```ts
expect(fuzzySearch("etnl", [{ id: "title", priority: "primary", text: "Eternal" }]))
  .toMatchObject({ matchedFieldIds: ["title"] });
expect(fuzzySearch("mg sl", [
  { id: "title", priority: "primary", text: "Metal Gear" },
  { id: "tag", priority: "secondary", text: "stealth" },
])).not.toBeNull();
expect(fuzzySearch("mt", [{ id: "title", priority: "primary", text: "Metal" }])).toBeNull();
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm test -- tests/fuzzy-search.test.ts tests/domain-core.test.ts`

Expected: FAIL because `fuzzySearch` does not exist and the old gap cutoff rejects the new omission fixture.

- [ ] **Step 3: Move the existing algorithm into the generic module**

Move normalization, keyboard layouts, edit distance, initialism and term scoring out of `catalogue.ts`. Score every query term against every field/keyboard variant, apply a fixed secondary-field penalty after the intrinsic match class, sum the best term scores, and return unique contributing field ids in best-match order.

Replace the subsequence hard cutoff with a score based on omitted character count and matched span. Keep the minimum fuzzy term length at three characters. Preserve exact, prefix, initialism, primary substring, secondary substring, subsequence and edit-distance ordering.

- [ ] **Step 4: Rebuild `gameSearchScore` as a wrapper**

Construct one primary `title` field plus distinct secondary platform/tag fields. Return `match?.score ?? Number.POSITIVE_INFINITY`; keep empty-query score `0` and all filter semantics unchanged.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- tests/fuzzy-search.test.ts tests/domain-core.test.ts tests/global-game-search.test.tsx`

Expected: PASS with existing game keyboard routing and new shared tolerance.

- [ ] **Step 6: Review Task 1 diff without committing**

Run: `jj diff -- src/domain/fuzzySearch.ts src/domain/catalogue.ts src/domain/index.ts tests/fuzzy-search.test.ts tests/domain-core.test.ts`

Confirm no React/DOM types entered the domain API and no visible GlobalGameSearch behavior changed.

---

### Task 2: Parse both annotation types and build the checklist index

**Files:**
- Create: `src/domain/markdownInlineAnnotations.ts`
- Create: `src/domain/checklistSearch.ts`
- Modify: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/domain/index.ts`
- Create: `tests/markdown-inline-annotations.test.ts`
- Create: `tests/checklist-search.test.ts`

**Interfaces:**
- Consumes: `fuzzySearch` from Task 1, `parseMarkdownBlocks`, `parseMarkdownRichTooltips`, `parseMarkdownRichTooltipBody`.
- Produces:

```ts
export type MarkdownInlineAnnotation =
  | { kind: "simple"; labelMarkdown: string; labelText: string; description: string; sourceEnd: number; sourceStart: number }
  | { kind: "rich"; anchor: string; labelMarkdown: string; labelText: string; sourceEnd: number; sourceStart: number };

export function parseMarkdownInlineAnnotationToken(source: string): Omit<MarkdownInlineAnnotation, "sourceEnd" | "sourceStart"> | null;
export function collectMarkdownInlineAnnotations(source: string): readonly MarkdownInlineAnnotation[];
export function markdownInlinePlainText(source: string): string;

export type ChecklistSearchAnnotation =
  | { id: string; kind: "simple"; labelMarkdown: string; labelText: string; plainText: string; sourceOrder: number }
  | { bodyMarkdown: string; id: string; kind: "rich"; labelMarkdown: string; labelText: string; plainText: string; sourceOrder: number };

export interface ChecklistSearchEntry {
  ancestorCollapseIds: readonly string[];
  annotations: readonly ChecklistSearchAnnotation[];
  id: string;
  noteClientId: string;
  noteId?: string;
  noteOrder: number;
  path: string;
  sourceColumn: number;
  sourceLine: number;
  state: MarkdownTaskState;
  structuralItemId?: string;
  text: string;
  textMarkdown: string;
}

export interface ChecklistSearchSourceNote {
  bodyMarkdown: string;
  clientId: string;
  id?: string;
}

export interface ChecklistSearchResult {
  entry: ChecklistSearchEntry;
  matchedAnnotationIds: readonly string[];
  score: number;
}

export function checklistSearchEntryId(noteClientId: string, sourceLine: number, sourceColumn: number): string;
export function buildChecklistSearchIndex(notes: readonly ChecklistSearchSourceNote[]): ChecklistSearchEntry[];
export function searchChecklistEntries(entries: readonly ChecklistSearchEntry[], query: string): ChecklistSearchResult[];
```

- [ ] **Step 1: Write failing inline-annotation tests**

Cover simple description extraction, rich reference extraction, mixed source order, formatted labels, escaped annotations, ordinary link titles excluded, Markdown-like simple description preserved as plain text, and `markdownInlinePlainText` returning only visible labels.

- [ ] **Step 2: Run annotation tests and confirm RED**

Run: `npm test -- tests/markdown-inline-annotations.test.ts`

Expected: FAIL because the shared parser does not exist.

- [ ] **Step 3: Extract shared inline parsing**

Move the simple-tooltip token parser out of `Markdown.tsx`; make `Markdown.tsx` call `parseMarkdownInlineAnnotationToken(raw)` for both simple and rich branches. Keep `markdownInlineTokenPattern` behavior byte-for-byte for diff/range callers and re-export it from `markdownInlineSyntax.ts`.

- [ ] **Step 4: Write failing checklist-index tests**

Use purpose-built Markdown fixtures containing nested list tasks, table task cells, headings/groups, checked/unchecked/indeterminate states, simple and rich annotations, multiple annotations, invalid/missing rich definitions and only-marker state changes. Assert exact path, source line/column, stable id, ancestor ids, annotation ordering and item-text-before-annotation fuzzy ranking.

- [ ] **Step 5: Run index tests and confirm RED**

Run: `npm test -- tests/checklist-search.test.ts`

Expected: FAIL because index/search functions do not exist.

- [ ] **Step 6: Implement structural traversal and annotation resolution**

Traverse top-level heading state, nested list ancestors and table groups from `parseMarkdownBlocks`. Use `checklistSearchEntryId(clientId, line, taskSourceColumn)` for list and table identities. Resolve rich bodies from the note-level parser, ignore invalid/duplicate/empty definitions, keep simple descriptions plain, and derive each compact path from first note heading plus active headings/group labels without duplicating the title.

- [ ] **Step 7: Implement checklist fuzzy projection**

Create primary field `item` and secondary fields `annotation:<entry-id>`. Sort by score, note order, source line and source column. Return matched annotation ids in scorer order so preview can promote matched annotations.

- [ ] **Step 8: Run focused suites and confirm GREEN**

Run: `npm test -- tests/markdown-inline-annotations.test.ts tests/checklist-search.test.ts tests/markdown-tasks.test.tsx tests/markdown-rich-tooltip-ui.test.tsx`

Expected: PASS with unchanged Markdown rendering and new index contracts.

- [ ] **Step 9: Review Task 2 diff without committing**

Run: `jj diff -- src/domain/markdownInlineAnnotations.ts src/domain/checklistSearch.ts src/components/markdownInlineSyntax.ts src/components/Markdown.tsx tests/markdown-inline-annotations.test.ts tests/checklist-search.test.ts`

Confirm the palette has no duplicate regex parser and no authored `data/` facts appear in tests.

---

### Task 3: Unify tri-state source mutations and mouse modifiers

**Files:**
- Create: `src/domain/markdownTaskState.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/domain/index.ts`
- Modify: `tests/markdown-tasks.test.tsx`
- Create: `tests/markdown-task-state.test.ts`

**Interfaces:**
- Produces:

```ts
export type MarkdownTaskTransition = "partial" | "regular";
export function nextMarkdownTaskState(state: MarkdownTaskState, transition: MarkdownTaskTransition): MarkdownTaskState;
export function setMarkdownListTaskState(markdown: string, sourceLine: number, state: MarkdownTaskState): string;
export function setMarkdownTableTaskState(markdown: string, sourceLine: number, sourceColumn: number, state: MarkdownTaskState): string;
```

- [ ] **Step 1: Write failing transition tests**

Assert all six approved state transitions. Add component tests for list and table checkbox clicks with no modifier, `shiftKey`, `metaKey`, `ctrlKey`, repeated modifier click from `[-]`, and absence of any `Cmd+Space` document handler.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/markdown-task-state.test.ts tests/markdown-tasks.test.tsx`

Expected: FAIL because Shift is not partial, repeated meta click does not clear `[-]`, and shared functions do not exist.

- [ ] **Step 3: Move source mutators into the domain module**

Move list/table marker replacement out of `Markdown.tsx`, keep the existing source validation, and update renderer imports. Preserve `setMarkdownTaskState` as a compatibility alias of `setMarkdownListTaskState` so existing callers remain source-compatible.

- [ ] **Step 4: Implement one modifier decision path**

Treat `event.shiftKey || event.metaKey` as `partial`. Prevent the native click, call `nextMarkdownTaskState(current, "partial")`, and suppress the paired `onChange`. For other clicks, call the regular transition. Do not add any keydown handler for meta-space.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- tests/markdown-task-state.test.ts tests/markdown-tasks.test.tsx`

Expected: PASS for list/table transitions and existing checkbox saves.

- [ ] **Step 6: Review Task 3 diff without committing**

Run: `jj diff -- src/domain/markdownTaskState.ts src/components/Markdown.tsx tests/markdown-task-state.test.ts tests/markdown-tasks.test.tsx`

Confirm Ctrl remains regular and both Shift/Meta use the exact same partial helper.

---

### Task 4: Add bounded browser-local recent history

**Files:**
- Create: `src/state/checklistSearchHistory.ts`
- Create: `tests/checklist-search-history.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ChecklistSearchHistoryRecord {
  gameId: string;
  itemId: string;
  noteId: string;
  touchedAt: number;
}

export interface ChecklistSearchHistoryStore {
  list(gameId: string, validItemIds: ReadonlySet<string>): readonly ChecklistSearchHistoryRecord[];
  record(record: ChecklistSearchHistoryRecord): void;
}

export function createChecklistSearchHistoryStore(storage?: Storage | null): ChecklistSearchHistoryStore;
```

- [ ] **Step 1: Write failing storage tests**

Cover write-after-success API usage, move-to-front dedupe, per-game filtering, `8`/`24` limits, UTF-8 serialized `8 KiB` eviction, corrupt JSON recovery, stale pruning and a Storage mock that throws on get/set to prove in-memory continuity.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- tests/checklist-search-history.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement versioned bounded storage**

Use one constant key such as `mygameslist:checklist-search-history:v1`. Parse only an exact versioned envelope, retain a private in-memory copy after any storage failure, compute byte size with `TextEncoder`, prune stale ids during `list`, and never throw from public methods.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npm test -- tests/checklist-search-history.test.ts`

Expected: PASS for all caps and failure modes.

- [ ] **Step 5: Review Task 4 diff without committing**

Run: `jj diff -- src/state/checklistSearchHistory.ts tests/checklist-search-history.test.ts`

Confirm records contain no text, Markdown, paths or annotation bodies.

---

### Task 5: Build the searchable two-pane palette component

**Files:**
- Create: `src/components/PageChecklistSearch.tsx`
- Modify: `src/components/MarkdownRichTooltip.tsx`
- Modify: `src/components/index.ts`
- Create: `tests/page-checklist-search.test.tsx`

**Interfaces:**
- Consumes: checklist entries/search from Task 2, state transitions from Task 3 and history store from Task 4.
- Produces:

```ts
export interface ChecklistSearchNavigationTarget {
  ancestorCollapseIds: readonly string[];
  id: string;
  noteClientId: string;
  noteId?: string;
  sourceColumn: number;
  sourceLine: number;
  structuralItemId?: string;
}

export interface PageChecklistSearchProps {
  blocked: boolean;
  gameId: string;
  getEntries: () => readonly ChecklistSearchEntry[];
  history: ChecklistSearchHistoryStore;
  onNavigate: (target: ChecklistSearchNavigationTarget) => void;
  onToggle: (entry: ChecklistSearchEntry, state: MarkdownTaskState) => Promise<void>;
}

export function MarkdownRichTooltipBodyView(props: { bodyMarkdown: string; className?: string }): ReactNode;
export function PageChecklistSearch(props: PageChecklistSearchProps): ReactNode;
```

- [ ] **Step 1: Write failing shortcut/open-close tests**

Use fake timers for two complete Shift press/release cycles within/outside `400ms`, other-key cancellation, repeat/IME/modifier rejection, blocked state, Escape/outside close and focus restoration.

- [ ] **Step 2: Write failing keyboard-mode tests**

Cover empty-query recent projection, query space insertion, Down to first result, Up from first back to input, Up from input to last, no wrap at bottom, printable character and Backspace return, row Space, Shift+Space, Enter, result replacement focus rules and no-results return to input.

- [ ] **Step 3: Write failing preview/action tests**

Cover mixed simple/rich annotations in source order, matched annotation promotion, plain simple description, rendered rich Markdown/definition list, empty preview, hover selection without input blur, row click navigation, checkbox click without close, optimistic update, pending guard, failure rollback/error live region and history record only after resolved save.

- [ ] **Step 4: Run component tests and confirm RED**

Run: `npm test -- tests/page-checklist-search.test.tsx`

Expected: FAIL because component/body-view exports do not exist.

- [ ] **Step 5: Extract the reusable noninteractive rich body view**

Move only body-parts rendering from the provider into `MarkdownRichTooltipBodyView`; use it inside the current tooltip unchanged and inside checklist preview with interactions disabled.

- [ ] **Step 6: Implement dialog state and keyboard model**

Keep `open`, `query`, mode, selected id, optimistic state by entry id, pending note ids and one error string locally. Call `getEntries()` on open and after successful toggle. Use combobox/grid semantics, roving focus in result mode, a document-level Shift sequence listener, a focus trap and stored opener element.

- [ ] **Step 7: Implement recent/fuzzy projections and preview ordering**

For empty query resolve `history.list(gameId, validIds)` against the fresh index. For nonempty query use `searchChecklistEntries`. Promote `matchedAnnotationIds` before remaining annotations; do not add a visible heading/count/status chip.

- [ ] **Step 8: Implement mouse and optimistic actions**

Stop checkbox clicks from invoking row navigation. Use `shiftKey || metaKey` for partial mouse transitions and only Shift+Space for keyboard partial. Await `onToggle`; on success refresh entries and record `{ gameId, noteId: entry.noteId ?? entry.noteClientId, itemId: entry.id, touchedAt: Date.now() }`; on failure restore the authoritative snapshot and show one footer error.

- [ ] **Step 9: Run focused tests and confirm GREEN**

Run: `npm test -- tests/page-checklist-search.test.tsx tests/markdown-rich-tooltip-ui.test.tsx`

Expected: PASS with unchanged standalone rich-tooltip behavior.

- [ ] **Step 10: Review Task 5 diff without committing**

Run: `jj diff -- src/components/PageChecklistSearch.tsx src/components/MarkdownRichTooltip.tsx tests/page-checklist-search.test.tsx`

Compare component structure with the approved reference and confirm no extra permanent chrome exists.

---

### Task 6: Integrate authoritative saves and navigation into GamePage/Markdown

**Files:**
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `tests/game-progress-ui.test.tsx` or create `tests/game-page-checklist-search.test.tsx`
- Modify: `tests/markdown-tasks.test.tsx`

**Interfaces:**
- Consumes: `PageChecklistSearch`, `ChecklistSearchNavigationTarget`, index builder and task source mutators.
- Adds Markdown props:

```ts
export interface MarkdownChecklistSearchTargetProps {
  checklistSearchNoteIdentity?: string;
  highlightedChecklistSearchTargetId?: string | null;
}
```

- [ ] **Step 1: Write failing GamePage integration tests**

Build fixture notes with one visible list task, one completed-filter-hidden nested task, one collapsed-heading task and one table task. Assert the palette indexes authoritative snapshots, calls `saveNoteInteraction({ field: "bodyMarkdown" })`, remains isolated from full `onSave`, and is blocked while editor/progress/settings-equivalent modal state is active.

- [ ] **Step 2: Write failing navigation/reveal tests**

Assert Enter/body click closes the palette, removes target ancestor ids from persisted collapsed state, reveals structural item/section ids, waits for render, focuses the exact checkbox, scrolls its row and applies/removes highlight. Cover stale target and reduced motion.

- [ ] **Step 3: Run integration tests and confirm RED**

Run: `npm test -- tests/game-page-checklist-search.test.tsx tests/markdown-tasks.test.tsx`

Expected: FAIL because the page does not mount the palette or expose target markup.

- [ ] **Step 4: Build authoritative entries on demand**

Inside `InlineGamePage`, construct `getChecklistSearchEntries` with current page note order and `noteInteractionSource.readNoteInteractionSnapshot(note.id)` for saved notes. Do not subscribe the page root to every checkbox update. Return an empty index when the page is editing or unavailable.

- [ ] **Step 5: Wire palette toggle saves**

Locate the current note snapshot, call the shared list/table source mutator from entry coordinates, then await `noteInteractionSource.saveNoteInteraction({ noteId, field: "bodyMarkdown", value })`. Reuse the existing completed-filter pending notification after success. Throw existing Russian save errors to the palette for rollback/live display.

- [ ] **Step 6: Add deterministic target markup**

Pass note identity into `MarkdownView`. Add `data-checklist-search-target-id={checklistSearchEntryId(...)}` to each list `.markdown-task-row` and table `.markdown-table-task`; pass the same id to the checkbox accessible relationship. Apply the highlight class through React props, not a text query.

- [ ] **Step 7: Coordinate reveal and focus inside the target note**

Store a request counter plus target in `InlineGamePage` and pass only the matching request to its note card. The note card removes matching collapsed ids, calls existing completed-item/section reveal setters, sets local highlighted id, then after React commit finds the exact data target, focuses its checkbox with `preventScroll`, calls `scrollIntoView({ block: "center", behavior })`, and clears highlight after the tested interval. A stale lookup exits without touching another row.

- [ ] **Step 8: Run focused tests and confirm GREEN**

Run: `npm test -- tests/game-page-checklist-search.test.tsx tests/markdown-tasks.test.tsx tests/completed-checklist-filter-preference.test.ts`

Expected: PASS for saved snapshot isolation, list/table target identity and reveal/navigation states.

- [ ] **Step 9: Review Task 6 diff without committing**

Run: `jj diff -- src/pages/GamePage.tsx src/components/Markdown.tsx tests/game-page-checklist-search.test.tsx tests/markdown-tasks.test.tsx`

Confirm no custom DOM event, no DOM text scan and no root subscription to note body Markdown were introduced.

---

### Task 7: Apply approved styling, run full verification, review, and finalize one commit

**Files:**
- Modify: `src/styles.css`
- Modify: `DESIGN.md` to record the permanent page-checklist palette and its approved geometry/interactions.
- Modify: focused CSS/acceptance tests only when they verify stable semantic selectors rather than generated artifacts.
- Verify all files from Tasks 1–6 plus spec and plan.

**Interfaces:**
- Consumes final DOM classes from `PageChecklistSearch` and target highlight class from `Markdown`.
- Produces no new behavioral API.

- [ ] **Step 1: Write failing stable CSS acceptance assertions**

Assert one overlay/palette class, `690px` width, `366px` height, `44% 56%` columns, `7px 10px` row padding, absence of result-row `height`/`min-height`, primary palette typography at `12px`, and path/footer/keycap typography at `9px`. Avoid asserting bundle output or generated CSS hashes.

- [ ] **Step 2: Run CSS acceptance test and confirm RED**

Run: `npm test -- tests/note-layout-css.test.ts tests/ui-acceptance.test.tsx tests/page-checklist-search.test.tsx`

Expected: FAIL until approved selectors/styles exist.

- [ ] **Step 3: Implement the approved visual contract**

Add only the overlay, 690×366 surface, 44/56 body, compact search header, independently scrollable results/preview, content-sized rows with `padding: 7px 10px`, selected/hover/focus states, footer, single-line error, focus rings and transient target highlight. Apply the user-corrected existing app scale: `12px` for query/item/annotation primary text and `9px` for path/footer/`Esc`, preferably through palette inheritance; do not introduce `13px` or resize the palette. Do not add counters, result headers, match-source labels, status chips, metadata tables or mobile breakpoint behavior.

- [ ] **Step 4: Add reduced-motion and accessibility states**

Disable overlay/highlight motion under `prefers-reduced-motion`, retain a static short highlight, preserve visible focus, and verify saving/error/empty-history/no-results states do not change palette geometry.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/fuzzy-search.test.ts tests/markdown-inline-annotations.test.ts tests/checklist-search.test.ts tests/markdown-task-state.test.ts tests/checklist-search-history.test.ts tests/page-checklist-search.test.tsx tests/game-page-checklist-search.test.tsx tests/markdown-tasks.test.tsx tests/global-game-search.test.tsx tests/markdown-rich-tooltip-ui.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run the complete suite and build**

Run: `npm test`

Expected: all tests PASS with no unhandled rejection or console error.

Run: `npm run build`

Expected: TypeScript and production build PASS.

- [ ] **Step 7: Perform direct visual comparison**

Run the app and compare at `1280×800` and `1440×900` against `.superpowers/brainstorm/96049-1788248038/content/refined-two-pane-v5.html`, applying the explicit user typography override (`12px` primary, `9px` secondary/hints) while preserving every other reference invariant. Verify readable idle input, recent history, fuzzy results, hover, result focus, all checkbox states, simple preview, rich preview, saving, error, collapsed reveal and reduced motion without geometry shift or asymmetric row whitespace. Stop and fix any observable mismatch before continuing.

- [ ] **Step 8: Request two-stage code review and apply findings**

Dispatch a spec-compliance reviewer first, then a code-quality reviewer. Provide both exact reference paths:

- `docs/superpowers/specs/2026-09-01-page-checklist-search-design.md`
- `docs/superpowers/plans/2026-09-01-page-checklist-search.md`
- `.superpowers/brainstorm/96049-1788248038/content/refined-two-pane-v5.html`

Require direct desktop-state comparison and rerun focused tests after every accepted correction.

- [ ] **Step 9: Inspect the single feature change**

Run: `jj status`

Run: `jj diff`

Confirm only feature-related spec, plan, implementation, DESIGN changes and permanent generic tests are present. Preserve unrelated work.

- [ ] **Step 10: Finalize exactly one Jujutsu commit**

Run:

```bash
jj describe -m "Add page checklist search

Add a compact two-pane checklist palette with shared fuzzy matching across
games, simple and rich annotation previews, tri-state inline actions,
bounded browser-local recent history, and reveal navigation back to notes."
jj new
```

Expected: the completed feature is one immutable commit containing spec, plan, implementation and tests; the fresh working copy is empty.
