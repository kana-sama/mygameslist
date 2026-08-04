# Game-Grouped Selective Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the type-grouped local-change list with a compact game-grouped review UI that shows trustworthy Markdown diffs and can publish any selected meaningful change together with all of its dependencies while leaving every other local edit untouched.

**Architecture:** Add four pure domain layers before changing the dialog: an exact reconstructable source diff, Markdown-aware structural alignment, a game-grouped review model, and a dependency-aware patch partitioner. The React layer consumes those models, reuses the existing Markdown renderer for the default rendered preview, and keeps selection/view state ephemeral. `LibraryContext` freezes and publishes only the resolved subset, then reconciles deferred and post-click edits onto the returned database through the existing GitHub/pending-publication flow.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, jsdiff, unified/remark-parse/remark-gfm, existing Markdown renderer, CSS, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for status, diff, history, description, and commit operations. Never invoke `git`.
- Run on Node.js `>=22.13.0`.
- Follow test-driven development: add one behavioral test, observe the expected failure, then add the minimum production change.
- Keep pure diff, grouping, and selection logic under `src/domain`; React components must not infer patch dependencies.
- Review rows are grouped by game and describe meaningful user changes, never raw JSON paths or top-level operation types.
- Review mode has no checkboxes. `Выбрать часть` reveals game and change selection without changing the compact list layout.
- An empty explicit selection always means publish the full current patch.
- Rendered Markdown is the per-note default. `Исходник` toggles only that note, becomes `Как выглядит`, and is not persisted.
- Source and rendered previews use color, a thin edge, and accessible labels; they must not add visible `+`, `−`, or `~` service glyphs.
- Text previews show the complete first useful hunk when practical, up to 12 visual rows, rather than a context-free one-line pair.
- The source diff is authoritative: previous and next source must reconstruct byte-for-byte from its line model.
- Invalid or ambiguous structural matching falls back locally to the exact source diff; it never invents a moved, deleted, or paired Markdown node.
- Successful partial publication removes only the published subset. Deferred changes and edits made after the click remain local.
- A failure before GitHub accepts publication leaves the entire frozen patch unchanged. An accepted publication preserves the deferred remainder even if Pages or persistence is pending.
- Existing conflict blocking, PAT handling, commit-message generation, recovery export, local-asset verification, and pending-publication behavior remain in place.
- Commit each completed task with `jj describe`, then create a fresh working-copy change with `jj new`.

---

### Task 1: Build an exact, reconstructable source-line diff

**Files:**
- Create: `src/domain/markdownDiff.ts`
- Create: `tests/fixtures/lego-harry-potter-98c11c1c.ts`
- Create: `tests/markdown-diff.test.ts`
- Modify: `src/domain/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `SourceDiffLine`, `InlineDiffPart`, `diffSourceLines`, `reconstructBefore`, and `reconstructAfter`.
- Consumed later by structural Markdown alignment, source-mode rendering, summaries, and reconstruction validation.
- No React, database, or selection types enter this module.

- [ ] **Step 1: Add the real historical regression fixture**

Create `tests/fixtures/lego-harry-potter-98c11c1c.ts` with the exact small note from commit `98c11c1c` (`3df90019-eb27-4d3e-b209-2518071a6171`):

```ts
export const LEGO_HISTORY_COMMIT = "98c11c1c7ef7934c51edd1752b57326cee52d413";
export const LEGO_PARCELS_NOTE_ID = "3df90019-eb27-4d3e-b209-2518071a6171";

export const LEGO_PARCELS_BEFORE = [
  "## Посылки",
  "- [x] Двор",
  "- [x] Спальня Грифиндора",
  "- [x] Большой зал",
  "- [ ] ...",
].join("\n");

export const LEGO_PARCELS_AFTER = [
  "## Посылки",
  "- [x] Двор",
  "- [x] Спальня Грифиндора",
  "- [x] Большой зал",
  "- [x] Опушка",
  "- [x] Гостинная Пуфендуй",
  "- [ ] ...",
].join("\n");
```

The commit and note IDs document provenance; tests remain hermetic and must not call `jj` at runtime.

- [ ] **Step 2: Add failing exactness and regression tests**

Create `tests/markdown-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  diffSourceLines,
  reconstructAfter,
  reconstructBefore,
} from "../src/domain";
import {
  LEGO_PARCELS_AFTER,
  LEGO_PARCELS_BEFORE,
} from "./fixtures/lego-harry-potter-98c11c1c";

describe("exact Markdown source diff", () => {
  it("keeps an ellipsis task as context when text is inserted before it", () => {
    const lines = diffSourceLines(LEGO_PARCELS_BEFORE, LEGO_PARCELS_AFTER);
    const ellipsis = lines.filter((line) => line.value === "- [ ] ...");

    expect(ellipsis).toEqual([expect.objectContaining({ kind: "context" })]);
    expect(lines.filter((line) => line.kind === "added").map((line) => line.value)).toEqual([
      "- [x] Опушка",
      "- [x] Гостинная Пуфендуй",
    ]);
  });

  it.each([
    ["", ""],
    ["a", "a\n"],
    ["a\r\n\r\n", "a\r\nб\r\n"],
    ["- [ ] ...\n- [ ] ...", "- [x] один\n- [ ] ...\n- [ ] ..."],
    [LEGO_PARCELS_BEFORE, LEGO_PARCELS_AFTER],
  ])("reconstructs both exact inputs for corpus %#", (before, after) => {
    const lines = diffSourceLines(before, after);
    expect(reconstructBefore(lines)).toBe(before);
    expect(reconstructAfter(lines)).toBe(after);
  });
});
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
npm test -- tests/markdown-diff.test.ts
```

Expected: FAIL because `markdownDiff.ts` and the exported functions do not exist.

- [ ] **Step 4: Install direct parser/diff dependencies**

Run these as separate commands so `package.json` explicitly owns every imported runtime package:

```bash
npm install diff unified remark-parse
npm install --save-dev @types/mdast
```

`remark-gfm` is already a direct dependency. Do not rely on `react-markdown`'s transitive copies of `unified` or `remark-parse`.

- [ ] **Step 5: Define the exact line model**

Add to `src/domain/markdownDiff.ts`:

```ts
import { diffArrays } from "diff";

export type SourceDiffKind = "context" | "added" | "removed";

export interface InlineDiffPart {
  kind: SourceDiffKind;
  value: string;
}

export interface SourceDiffLine {
  id: string;
  kind: SourceDiffKind;
  value: string;
  eol: string;
  beforeLine: number | null;
  afterLine: number | null;
  pairId?: string;
  inline?: InlineDiffPart[];
}

function physicalLines(source: string): Array<{ value: string; eol: string }> {
  if (!source) return [];
  const result: Array<{ value: string; eol: string }> = [];
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    result.push({ value: match[1], eol: match[2] });
  }
  return result;
}

export function reconstructBefore(lines: readonly SourceDiffLine[]): string {
  return lines
    .filter((line) => line.kind !== "added")
    .map((line) => `${line.value}${line.eol}`)
    .join("");
}

export function reconstructAfter(lines: readonly SourceDiffLine[]): string {
  return lines
    .filter((line) => line.kind !== "removed")
    .map((line) => `${line.value}${line.eol}`)
    .join("");
}
```

Implement `diffSourceLines` with `diffArrays(physicalLines(before), physicalLines(after), { comparator })`. Preserve each side's original EOL, assign monotonically increasing before/after line numbers, and do not pair removed/added lines yet. Export the module from `src/domain/index.ts`.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- tests/markdown-diff.test.ts
```

Expected: PASS, including exact LF/CRLF reconstruction and the unchanged `- [ ] ...` line.

- [ ] **Step 7: Inspect and commit only Task 1**

Run:

```bash
jj status
jj diff
jj describe -m "Add exact Markdown source diff"
jj new
```

Expected: only the dependency manifests, new domain module, fixture, test, and domain export are described.

---

### Task 2: Add conservative Markdown-aware alignment and summaries

**Files:**
- Modify: `src/domain/markdownDiff.ts`
- Modify: `tests/fixtures/lego-harry-potter-98c11c1c.ts`
- Modify: `tests/markdown-diff.test.ts`

**Interfaces:**
- Produces `MarkdownDiffModel`, `MarkdownDiffHunk`, `MarkdownDiffFragment`, `MarkdownDecoration`, `createMarkdownDiff`, `deriveMarkdownTitle`, and `summarizeMarkdownDiff`.
- Uses exact `SourceDiffLine[]` as source of truth and remark only to improve local alignment.
- Every specialization must be able to decline and keep the exact source result unchanged.

- [ ] **Step 1: Add failing structure and fallback tests**

Append tests covering all trusted/ambiguous branches:

```ts
it("pairs a local task toggle without moving duplicate ellipsis items", () => {
  const before = "## A\n- [ ] Открыть\n- [ ] ...\n\n## B\n- [ ] Открыть\n- [ ] ...";
  const after = "## A\n- [x] Открыть\n- [ ] ...\n\n## B\n- [ ] Открыть\n- [ ] ...";
  const model = createMarkdownDiff(before, after);

  expect(model.renderable).toBe(true);
  expect(model.lines.filter((line) => line.value === "- [ ] ...").every((line) => line.kind === "context")).toBe(true);
  expect(model.fragments.some((fragment) => fragment.blockType === "listItem" && fragment.kind === "modified")).toBe(true);
  expect(reconstructBefore(model.lines)).toBe(before);
  expect(reconstructAfter(model.lines)).toBe(after);
});

it("falls back to exact lines when table row keys are ambiguous", () => {
  const before = "| Этап | Статус |\n| --- | --- |\n| Дубль | [ ] |\n| Дубль | [x] |";
  const after = "| Этап | Статус |\n| --- | --- |\n| Дубль | [x] |\n| Дубль | [x] |";
  const model = createMarkdownDiff(before, after);

  expect(model.fallbacks).toContainEqual(expect.objectContaining({ blockType: "table" }));
  expect(reconstructBefore(model.lines)).toBe(before);
  expect(reconstructAfter(model.lines)).toBe(after);
});

it("summarizes task and heading changes deterministically", () => {
  expect(summarizeMarkdownDiff(createMarkdownDiff("## Старое\n- [ ] A", "## Новое\n- [x] A")))
    .toMatch(/Отмечен 1 пункт|раздел/);
});
```

Extend the historical fixture with this exact excerpt from note `2df1685d-97e1-497b-8505-a3a41d3da985` in the same commit:

```ts
export const LEGO_LOCKS_BEFORE = [
  "## Замки",
  "- [ ] Коридор Чар",
  "- [ ] Класс Чар (левый)",
  "- [ ] Внешний коридор (картина слева)",
  "- [ ] Внешний коридор (факел справа)",
  "- [ ] Дырявый котел",
  "- [ ] Большой зал (слева у профессорского стола)",
  "- [ ] Большой зал (справа на профессорском столу)",
  "- [ ] Двор у Класса Полетов (тачка)",
  "- [ ] Класс Травологии",
  "- [ ] Класс Полетов",
  "- [ ] ...",
].join("\n");

export const LEGO_LOCKS_AFTER = [
  "## Замки",
  "- [ ] Коридор Чар",
  "- [ ] Класс Чар (левый)",
  "- [ ] Внешний коридор (картина слева)",
  "- [ ] Внешний коридор (факел справа)",
  "- [ ] Дырявый котел",
  "- [ ] Большой зал (слева у профессорского стола)",
  "- [ ] Большой зал (справа на профессорском столу)",
  "- [ ] Двор у Класса Полетов (тачка)",
  "- [ ] Класс Травологии",
  "- [ ] Класс Полетов",
  "- [ ] Класс Трансфигурации",
  "- [ ] Гостинная Пуфендуй",
  "- [ ] Ванный коридор - сверху",
  "- [ ] Ванный коридор - вход в женскую ванную",
  "- [ ] Вход в гостинную Слизерин - люки",
  "- [ ] ...",
].join("\n");
```

Assert all five inserted lock lines precede one context ellipsis and both exact excerpts reconstruct.

- [ ] **Step 2: Run the new cases and verify RED**

Run:

```bash
npm test -- tests/markdown-diff.test.ts -t "pairs a local|falls back|summarizes|Замки"
```

Expected: FAIL because only the exact line model exists.

- [ ] **Step 3: Define the structural model and strict trust boundary**

Add these exported types:

```ts
import type { Content, Root } from "mdast";
import { diffWordsWithSpace } from "diff";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export type MarkdownBlockType = Content["type"] | "source";
export type MarkdownChangeKind = "context" | "added" | "removed" | "modified";

export interface MarkdownDecoration {
  kind: Exclude<MarkdownChangeKind, "context">;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  label: "Добавлено" | "Удалено" | "Изменено";
}

export interface MarkdownDiffSide {
  markdown: string;
  decorations: MarkdownDecoration[];
}

export interface MarkdownDiffFragment {
  id: string;
  blockType: MarkdownBlockType;
  kind: MarkdownChangeKind;
  before?: MarkdownDiffSide;
  after?: MarkdownDiffSide;
  sourceLineIds: string[];
}

export interface MarkdownDiffHunk {
  id: string;
  lines: SourceDiffLine[];
  fragments: MarkdownDiffFragment[];
}

export interface MarkdownDiffFallback {
  blockType: MarkdownBlockType;
  reason: "ambiguous-anchor" | "parse-error" | "unsupported-position";
}

export interface MarkdownDiffModel {
  before: string;
  after: string;
  lines: SourceDiffLine[];
  hunks: MarkdownDiffHunk[];
  fragments: MarkdownDiffFragment[];
  fallbacks: MarkdownDiffFallback[];
  renderable: boolean;
}
```

Decoration coordinates are zero-based UTF-16 line/column offsets relative to the fragment side's `markdown`; end coordinates are exclusive. Convert remark's one-based positions once when creating a fragment.

Parse with a single configured processor:

```ts
const markdownParser = unified().use(remarkParse).use(remarkGfm);

function parseMarkdown(source: string): Root {
  return markdownParser.parse(source) as Root;
}
```

Never mutate the returned source-line model during structural matching. Fragments only reference line IDs and exact source slices.

- [ ] **Step 4: Implement unique, parent-local block anchors**

Walk each parent independently and create anchors with source positions:

```ts
interface BlockAnchor {
  node: Content;
  type: MarkdownBlockType;
  key: string | null;
  occurrenceCount: number;
  startOffset: number;
  endOffset: number;
}
```

Use these keys only when unique in both corresponding parents:

- heading: depth plus normalized visible text;
- list item: normalized visible content with `[ ]`/`[x]` removed;
- table row: normalized first non-empty cell;
- paragraph/other: exact normalized text, limited to low-occurrence anchors.

Match parent sections first, then anchors inside them. If either side has a duplicate key, append an `ambiguous-anchor` fallback and leave that region as exact source lines.

- [ ] **Step 5: Pair only strongly similar adjacent remove/add runs**

Within a matched block or unmatched local gap, pair a removed line with an adjacent added line only when all are true:

```ts
function mayPair(before: string, after: string): boolean {
  const left = before.replace(/^\s*(?:[-*+] |\d+[.)] |\[[ xX]\]\s*)+/, "");
  const right = after.replace(/^\s*(?:[-*+] |\d+[.)] |\[[ xX]\]\s*)+/, "");
  if (!left || !right) return false;
  const common = longestCommonSubsequenceLength(left, right);
  return common / Math.max(left.length, right.length) >= 0.72;
}
```

Give paired lines one `pairId`; populate `inline` via `diffWordsWithSpace`; translate changed ranges to `MarkdownDecoration`s. For a table, compare corresponding cells and decorate only changed cells/spans. Do not pair across a heading, list parent, table row key, or blank-line boundary.

- [ ] **Step 6: Build deterministic hunks and summaries**

Build hunks with three context lines on each side of a changed run, merging overlapping windows. A preview later consumes the first full hunk and counts remaining hunks.

Implement:

```ts
export function deriveMarkdownTitle(markdown: string): string;
export function summarizeMarkdownDiff(model: MarkdownDiffModel): string;
```

Title precedence is first heading, first non-empty line with Markdown punctuation stripped, then `Заметка без заголовка`.

Summary precedence is:

1. task toggles (`Отмечено N`, `Снята отметка с N`);
2. up to two added/removed heading names plus a remaining count;
3. list/table added, removed, and changed row counts;
4. `Изменено N фрагментов текста`.

No AI call, network request, clock, locale-dependent random ordering, or source truncation participates in the result.

- [ ] **Step 7: Run the complete engine suite and verify GREEN**

Run:

```bash
npm test -- tests/markdown-diff.test.ts
```

Expected: PASS for the two real historical notes, duplicate anchors, task toggles, tables, Cyrillic, line endings, and exact reconstruction.

- [ ] **Step 8: Inspect and commit only Task 2**

Run:

```bash
jj status
jj diff
jj describe -m "Add Markdown-aware diff alignment"
jj new
```

---

### Task 3: Build the game-grouped meaningful-change review model

**Files:**
- Create: `src/domain/changeReview.ts`
- Create: `tests/change-review.test.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes `LibraryDatabase`, `PatchEnvelope`, `parsePatchPath`, asset references, and Markdown diff/title/summary helpers.
- Produces `ChangeReviewModel`, `GameChangeGroup`, `ReviewChange`, `ChangeEvidence`, and `buildChangeReview`.
- A visible row has a stable `id`; a user-selectable unit has a stable `selectionId`; cross-game occurrences may share one selection ID.

- [ ] **Step 1: Add failing ownership, content, identity, and ordering tests**

Create databases and sparse patches with existing domain helpers. Cover at least:

```ts
it("groups game, note, and referenced asset evidence under the game", () => {
  const review = buildChangeReview(base, effective, patch);
  expect(review.groups).toHaveLength(1);
  expect(review.groups[0]).toMatchObject({ gameId: GAME_ID, title: "Lego Harry Potter: Years 1–4" });
  expect(review.groups[0].changes.map((change) => change.title)).toContain("Посылки");
  expect(review.groups[0].changes.find((change) => change.entity.id === NOTE_ID)?.evidence)
    .toMatchObject({ type: "markdown", before: expect.any(String), after: expect.any(String) });
});

it("uses base ownership and content for a deleted note", () => {
  const change = buildChangeReview(base, effectiveWithoutNote, deletePatch).groups[0].changes[0];
  expect(change.title).toBe("Посылки");
  expect(change.summary).toBe("Удалена заметка «Посылки»");
  expect(change.evidence).toMatchObject({ type: "markdown", after: "" });
});

it("shows a cross-game rank transaction in both groups with one selection identity", () => {
  const review = buildChangeReview(base, moved, crossGameRankPatch);
  const occurrences = review.groups.flatMap((group) => group.changes);
  expect(new Set(occurrences.map((change) => change.selectionId))).toHaveSize(1);
  expect(review.uniqueSelectionIds).toHaveLength(1);
});
```

Also assert:

- created-note title from heading, first text line, and fallback;
- scalar `before → after`, list chips, tier/rank move, and file metadata evidence;
- deleted-asset ownership through base references;
- orphan assets under `Без привязки к игре`;
- newest `changedAt` group ordering, Russian title tie-break, and deterministic row ordering;
- two unrelated entities sharing a normal save transaction remain separate meaningful rows unless the transaction is a cross-game ordering unit.

- [ ] **Step 2: Run the new suite and verify RED**

Run:

```bash
npm test -- tests/change-review.test.ts
```

Expected: FAIL because `buildChangeReview` does not exist.

- [ ] **Step 3: Define the review model**

Add:

```ts
export type ChangeKind = "added" | "changed" | "deleted" | "moved" | "asset";

export type ChangeEvidence =
  | { type: "scalar"; before: string; after: string }
  | { type: "chips"; added: string[]; removed: string[] }
  | { type: "move"; before: string; after: string }
  | { type: "markdown"; before: string; after: string; diff: MarkdownDiffModel }
  | { type: "asset"; assetId: string; originalName: string; mime: string; byteLength: number; width?: number; height?: number };

export interface ReviewChange {
  id: string;
  selectionId: string;
  entity: { map: "games" | "notes" | "assets"; id: string };
  kind: ChangeKind;
  title: string;
  summary: string;
  changedAt: string;
  operationPaths: string[];
  gameIds: string[];
  evidence: ChangeEvidence[];
}

export interface GameChangeGroup {
  id: string;
  gameId: string | null;
  title: string;
  coverAssetId: string | null;
  newestChangedAt: string;
  changes: ReviewChange[];
}

export interface ChangeReviewModel {
  groups: GameChangeGroup[];
  changesById: Record<string, ReviewChange>;
  changesBySelectionId: Record<string, ReviewChange[]>;
  uniqueSelectionIds: string[];
}
```

- [ ] **Step 4: Convert operations into semantic units**

Implement these deterministic passes:

1. Parse every surviving operation and attach before/effective entity data.
2. Group by `transactionId + entity map + entity id`.
3. Fold asset operations into the referencing cover/note unit when the same transaction and reference identify one owner.
4. Detect rank/placement transactions affecting multiple game IDs and give their occurrences `selectionId = tx:<transactionId>`.
5. Give ordinary units `selectionId = tx:<transactionId>:<map>:<id>` and legacy/missing IDs a path-derived fallback.
6. Build exact evidence from base/effective values; text evidence always calls `createMarkdownDiff`.

Use effective ownership first and base ownership second. Build an asset-to-game index from both databases. Never infer ownership from titles or filenames.

- [ ] **Step 5: Generate concise deterministic row summaries**

Use field-specific formatters:

```ts
function scalarEvidence(label: string, before: unknown, after: unknown): ChangeEvidence;
function placementLabel(database: LibraryDatabase, gameId: string): string;
function createdNoteSummary(title: string): string {
  return `Создана заметка «${title}»`;
}
function deletedNoteSummary(title: string): string {
  return `Удалена заметка «${title}»`;
}
```

For a mixed Markdown edit, use `summarizeMarkdownDiff`. For multiple fields in one unit, prioritize its user-facing action (created/deleted/moved/text) and append at most one compact secondary fact.

- [ ] **Step 6: Run the focused suite and verify GREEN**

Run:

```bash
npm test -- tests/change-review.test.ts
```

Expected: PASS for ownership, created/deleted content, cross-game identity, summaries, and ordering.

- [ ] **Step 7: Inspect and commit only Task 3**

Run:

```bash
jj status
jj diff
jj describe -m "Build game-grouped change review model"
jj new
```

---

### Task 4: Resolve dependency closure and partition the patch

**Files:**
- Create: `src/domain/patchSelection.ts`
- Create: `tests/patch-selection.test.ts`
- Modify: `src/domain/index.ts`

**Interfaces:**
- Consumes the frozen `base`, `effective`, `patch`, and explicitly selected review units.
- Produces a validated `publishPatch`, blob-pruned `deferredPatch`, selected paths, and dependency reasons.
- Does not know about React checkboxes or GitHub APIs.

- [ ] **Step 1: Add failing dependency and partition tests**

Cover each closure rule with a small patch:

```ts
it("includes a new note, its parent game, attachment metadata, and blob", () => {
  const result = resolvePatchSelection(base, effective, patch, [{
    changeId: "new-note",
    operationPaths: [`/notes/${NOTE_ID}`],
  }]);

  expect(Object.keys(result.publishPatch.operations).sort()).toEqual([
    `/assets/${ASSET_ID}`,
    `/games/${GAME_ID}`,
    `/notes/${NOTE_ID}`,
  ].sort());
  expect(result.publishPatch.blobs).toEqual({ [ASSET_ID]: patch.blobs[ASSET_ID] });
  expect(result.deferredPatch.blobs).not.toHaveProperty(ASSET_ID);
});

it("keeps unrelated operations and blobs deferred", () => {
  const result = resolvePatchSelection(base, effective, patch, [selectedGameTitle]);
  expect(result.publishPatch.operations).toHaveProperty(`/games/${GAME_ID}/title`);
  expect(result.deferredPatch.operations).toHaveProperty(`/notes/${OTHER_NOTE_ID}/bodyMarkdown`);
  expect(applyPatch(base, mergePatchEnvelopes(result.publishPatch, result.deferredPatch))).toEqual(effective);
});
```

Also test:

- selecting a whole game (multiple explicit units);
- root entity creation/deletion required by a field/reference operation;
- all rank updates in one ordering transaction, including cross-game moves;
- asset deletion plus its selected reference removals;
- a dependency reason such as `Нужно для вложения заметки «Посылки»`;
- invalid closure returns `PatchSelectionError` naming the originating change and performs no mutation;
- partition union has exactly the original operation paths, with no loss or duplication;
- each output retains correct `baseRevision`, schema/patch versions, and independently pruned blobs.

- [ ] **Step 2: Run the new suite and verify RED**

Run:

```bash
npm test -- tests/patch-selection.test.ts
```

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Define selection inputs and results**

Add:

```ts
export interface PatchSelectionSeed {
  changeId: string;
  operationPaths: readonly string[];
}

export interface PatchDependencyReason {
  requiredPath: string;
  requiredByChangeId: string;
  message: string;
}

export interface PatchSelectionResult {
  publishPatch: PatchEnvelope;
  deferredPatch: PatchEnvelope;
  selectedPaths: string[];
  explicitPaths: string[];
  dependencyReasons: PatchDependencyReason[];
}

export class PatchSelectionError extends Error {
  readonly changeId: string;
}

export function resolvePatchSelection(
  base: LibraryDatabase,
  effective: LibraryDatabase,
  patch: PatchEnvelope,
  seeds: readonly PatchSelectionSeed[],
): PatchSelectionResult;

export function mergePatchEnvelopes(
  earlier: PatchEnvelope,
  later: PatchEnvelope,
): PatchEnvelope;
```

`later` wins for the same operation path and blob ID. The merged envelope uses `later.baseRevision` when present and always runs `prunePatchBlobs`.

- [ ] **Step 4: Implement a fixed-point dependency resolver**

Seed the selected path set from `operationPaths`, reject unknown paths, then iterate until no path is added:

```ts
let changed = true;
while (changed) {
  changed = false;
  for (const path of [...selectedPaths]) {
    changed = includeEntityRoots(path) || changed;
    changed = includeParentGameForNewNote(path) || changed;
    changed = includeOrderingTransaction(path) || changed;
    changed = includeReferencedAsset(path) || changed;
    changed = includeAssetReferenceRemoval(path) || changed;
  }
}
```

Scope transaction expansion narrowly:

- root create/delete operations include same-transaction references needed for validity;
- `placement`, `rank`, and `groupRank` include same-transaction ordering operations;
- `coverAssetId` and `attachments` include only referenced asset roots/blobs;
- asset deletion includes reference-removal operations;
- unrelated text fields saved in the same transaction do not become dependencies.

Record the first human-readable reason and originating `changeId` for every added path.

- [ ] **Step 5: Partition, prune, and validate before publication**

Build both envelopes by filtering the frozen operation map. Call `prunePatchBlobs` on each. Then:

```ts
const selectedEffective = applyPatch(base, publishPatch);
assertValidLibrary(selectedEffective);

const union = mergePatchEnvelopes(publishPatch, deferredPatch);
if (canonicalStringify(applyPatch(base, union)) !== canonicalStringify(effective)) {
  throw new PatchSelectionError(originatingChangeId, "Выбранные зависимости не восстанавливают локальное состояние");
}
```

If a selected field requires an entity that is neither in `base` nor created by the patch, throw before any caller can start network work.

- [ ] **Step 6: Run domain selection tests and relevant patch regressions**

Run:

```bash
npm test -- tests/patch-selection.test.ts tests/domain-core.test.ts tests/domain-storage-assets.test.ts tests/patch-publication-integration.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Inspect and commit only Task 4**

Run:

```bash
jj status
jj diff
jj describe -m "Add dependency-aware patch selection"
jj new
```

---

### Task 5: Render compact Markdown diffs in rendered and source modes

**Files:**
- Create: `src/components/MarkdownDiffPreview.tsx`
- Create: `tests/markdown-diff-preview.test.tsx`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/styles.css`

**Interfaces:**
- `MarkdownDiffPreview` consumes one `MarkdownDiffModel`; it owns only transient mode/expansion state.
- `MarkdownView` gains optional source-position decorations but preserves all existing editing behavior when none are provided.
- The preview exposes no selection or publication logic.

- [ ] **Step 1: Add failing preview behavior tests**

Create `tests/markdown-diff-preview.test.tsx`:

```tsx
it("opens rendered, toggles only itself to exact source, and shows no service markers", async () => {
  const user = userEvent.setup();
  const first = createMarkdownDiff(LEGO_PARCELS_BEFORE, LEGO_PARCELS_AFTER);
  const second = createMarkdownDiff("## Другое\nСтарое", "## Другое\nНовое");
  render(<><MarkdownDiffPreview model={first} /><MarkdownDiffPreview model={second} /></>);

  expect(screen.getAllByRole("button", { name: "Показать исходник" })).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "Показать исходник" })[0]);

  expect(screen.getByText("- [x] Опушка")).toHaveAttribute("data-diff-kind", "added");
  expect(screen.getAllByRole("button", { name: "Показать исходник" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Показать как выглядит" })).toBeInTheDocument();
  expect(screen.queryByText(/^\+|^−|^~/)).not.toBeInTheDocument();
});

it("shows the full first hunk, folds after twelve rows, and expands in the current mode", async () => {
  const user = userEvent.setup();
  render(<MarkdownDiffPreview model={longModel} />);
  expect(screen.getAllByTestId("diff-visual-row").length).toBeLessThanOrEqual(12);
  await user.click(screen.getByRole("button", { name: /Весь diff/ }));
  expect(screen.getAllByTestId("diff-visual-row").length).toBeGreaterThan(12);
});
```

Add tests for created/deleted note content, rendered GFM table cells, inline changed decorations, source whitespace, accessible `Добавлено`/`Удалено`/`Изменено` labels, and per-note source fallback explanation.

- [ ] **Step 2: Run the new component suite and verify RED**

Run:

```bash
npm test -- tests/markdown-diff-preview.test.tsx
```

Expected: FAIL because the component and decoration contract do not exist.

- [ ] **Step 3: Add optional source decorations to `MarkdownView`**

Add one optional member to the existing public props without replacing or renaming any current member:

```ts
decorations?: readonly MarkdownDecoration[];
```

Carry source line/column data through headings, paragraphs, list items, and table cells. Split only rendered text nodes that intersect a decoration, wrapping them with:

```tsx
<span
  aria-label={decoration.label}
  className={`markdown-diff-inline markdown-diff-inline--${decoration.kind}`}
  data-diff-kind={decoration.kind}
>
  {text}
</span>
```

Keep Markdown punctuation structural: emphasis, links, code, tasks, lists, and table layout still render through the existing parser/renderer. Decoration offsets never modify the source string or checkbox source positions.

- [ ] **Step 4: Implement `MarkdownDiffPreview` with per-instance state**

Use this component contract:

```ts
export interface MarkdownDiffPreviewProps {
  model: MarkdownDiffModel;
  previewRows?: number;
}
```

Core state and labels:

```tsx
const [mode, setMode] = useState<"rendered" | "source">("rendered");
const [expanded, setExpanded] = useState(false);
const sourceOnly = !model.renderable;
const visibleMode = sourceOnly ? "source" : mode;

<button
  aria-label={visibleMode === "rendered" ? "Показать исходник" : "Показать как выглядит"}
  onClick={() => setMode((current) => current === "rendered" ? "source" : "rendered")}
  type="button"
>
  {visibleMode === "rendered" ? "Исходник" : "Как выглядит"}
</button>
```

Render source lines without prepending characters. Set `data-diff-kind` and screen-reader labels on changed lines. For rendered fragments, pass exact fragment Markdown and its decorations to `MarkdownView`; render before/after sides for a modified fragment with a shared amber edge and visually hidden side labels.

- [ ] **Step 5: Apply the compact preview budget and styling**

Default to the complete first hunk. If it exceeds 12 visual rows, keep the surrounding structural block intact where possible and fold at the next block boundary. `Весь diff · ещё N` expands all hunks in the current mode.

Add green/red/amber background tokens, a 2px logical-start edge, neutral context, compact table/list spacing, and focus-visible styles. Do not add a marker gutter or pseudo-element content.

- [ ] **Step 6: Run Markdown and preview regressions**

Run:

```bash
npm test -- tests/markdown-diff-preview.test.tsx tests/markdown-diff.test.ts tests/markdown-tasks.test.tsx tests/note-collapse.test.tsx
```

Expected: all PASS; existing Markdown task editing and table groups remain unchanged without decorations.

- [ ] **Step 7: Inspect and commit only Task 5**

Run:

```bash
jj status
jj diff
jj describe -m "Render trustworthy Markdown change previews"
jj new
```

---

### Task 6: Publish only the selected patch and preserve the remainder

**Files:**
- Modify: `src/state/LibraryContext.tsx`
- Modify: `tests/library-context.test.tsx`
- Modify: `tests/patch-publication-integration.test.ts`
- Modify: `tests/github-git-database-sync.test.ts`
- Modify: `tests/commit-message.test.ts`

**Interfaces:**
- `LibraryContextValue.syncToGitHub` accepts an options object with `selectedPaths` and `onStage`.
- `GitHubGitDatabaseSyncClient.publishPatch` remains unchanged and receives the already resolved subset.
- The returned database continues to drive the existing commit-message builder, so the message naturally describes only selected changes.

- [ ] **Step 1: Add a selectable sync probe and failing partial-success test**

Change the test probe to call:

```tsx
library.syncToGitHub(GITHUB_TOKEN, {
  selectedPaths: [`/games/${GAME_ID}/title`],
})
```

Add a test whose frozen patch contains title and placement edits:

```ts
it("publishes only selected paths and keeps deferred plus post-click edits", async () => {
  // title and placement exist before click; a note edit is made after click
  fireEvent.click(screen.getByRole("button", { name: "Sync selected title" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit note after click" }));

  await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
  expect(publishedLibraryFromRequest(api.requests).games[GAME_ID].title).toBe("Local title");
  expect(publishedLibraryFromRequest(api.requests).games[GAME_ID].placement.tierId).toBe("a");
  expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
  expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/notes/${NOTE_ID}/bodyMarkdown`);
});
```

Add separate tests for pre-acceptance failure retaining the full patch, selected-only assets becoming `awaiting-verification`, and accepted/pending publication keeping the deferred in-memory patch even if localStorage persistence fails.

- [ ] **Step 2: Add failing subset commit-message coverage**

In the GitHub client/commit-message tests, create a two-game patch but publish only one selected subpatch. Assert the commit subject/body names only the selected game and the JSON blob retains the other game's published value.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/library-context.test.tsx tests/github-git-database-sync.test.ts tests/commit-message.test.ts
```

Expected: selected options are rejected by TypeScript or ignored, and the full patch is currently published.

- [ ] **Step 4: Extend the context contract and freeze a partition**

Add:

```ts
export interface LibraryGitHubSyncOptions {
  onStage?: (stage: GitHubSyncStage) => void;
  selectedPaths?: readonly string[];
}

syncToGitHub: (
  token: string,
  options?: LibraryGitHubSyncOptions,
) => Promise<LibraryGitHubSyncResult>;
```

At the start of `syncToGitHub`, freeze `base`, `effective`, and `patch`. When `selectedPaths` is empty or absent, use the full frozen patch and an empty deferred patch. Otherwise call `resolvePatchSelection` with one seed containing those explicit paths. Perform this before setting local assets to publishing or constructing the GitHub client.

- [ ] **Step 5: Publish and verify only selected local assets**

Replace full-patch asset IDs with:

```ts
const snapshotPublishPatch = partition.publishPatch;
const snapshotDeferredPatch = partition.deferredPatch;
const snapshotLocalAssetIds = requiredLocalAssetIds(
  snapshotPublishPatch,
  applyPatch(snapshot.base, snapshotPublishPatch),
);
```

Read, validate, upload, transition, verify, and delete only those asset IDs. Pass `snapshotPublishPatch` to `client.publishPatch`.

- [ ] **Step 6: Merge deferred and post-click edits after success**

Keep the current post-click calculation relative to the frozen full effective state, then merge in this order:

```ts
const postClickPatch = diffLibrary(snapshotEffective, current.effective, {
  previousPatch: current.patch,
});
const remainderPatch = mergePatchEnvelopes(snapshotDeferredPatch, postClickPatch);
const remaining = reconcilePatch(result.database, remainderPatch);
```

Later post-click operations win on the same path. Persist `remaining.patch` in the pending-publication receipt. If receipt persistence fails after GitHub accepted the commit, still install `result.database + remaining` in memory and report the persistence risk; never restore the full pre-click patch.

- [ ] **Step 7: Preserve the full patch on all pre-acceptance failures**

Do not call `setLibraryState`, `installReconciled`, or patch persistence for PAT, network, validation, missing-asset, dependency, or GitHub conflict failures until the existing conflict-specific rebase path explicitly applies. In `finally`, return only selected asset states from `publishing` to `local` when `publicationAccepted` is false.

- [ ] **Step 8: Run publication, client, and message suites**

Run:

```bash
npm test -- tests/library-context.test.tsx tests/patch-publication-integration.test.ts tests/github-git-database-sync.test.ts tests/commit-message.test.ts tests/pending-publication.test.ts
```

Expected: all PASS, including full-sync compatibility and partial remainder preservation.

- [ ] **Step 9: Inspect and commit only Task 6**

Run:

```bash
jj status
jj diff
jj describe -m "Preserve deferred edits during partial publication"
jj new
```

---

### Task 7: Replace the dialog with compact game groups and transient selection

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/DiffDialog.tsx`
- Modify: `src/components/DiffSyncPanel.tsx`
- Modify: `src/components/diff-sync.css`
- Modify: `src/styles.css`
- Modify: `tests/ui-acceptance.test.tsx`
- Modify: `tests/diff-sync-panel.test.tsx`
- Modify: `tests/local-assets-ui.test.tsx`

**Interfaces:**
- `App` builds `ChangeReviewModel`, owns transient explicit selection while the dialog is open, resolves dependencies, and passes selected operation paths into sync.
- `DiffDialog` renders controlled game/change selection and evidence; it does not inspect patch operations.
- `DiffSyncController` accepts an optional operation-path scope and action label while remaining compatible with connect-only mode.

- [ ] **Step 1: Replace type-group UI fixtures with failing game-group tests**

Update `DiffDialog` tests to pass a small `ChangeReviewModel` and assert:

```tsx
it("groups compact evidence by game and hides checkboxes in review mode", () => {
  renderDialog(review);
  expect(screen.getByRole("heading", { name: "Lego Harry Potter: Years 1–4" })).toBeInTheDocument();
  expect(screen.getByText("Посылки")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /Lego Harry Potter/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Выбрать часть" })).toBeInTheDocument();
});

it("selects a game, exposes indeterminate state, and counts unique cross-game changes once", async () => {
  const user = userEvent.setup();
  renderControlledDialog(crossGameReview);
  await user.click(screen.getByRole("button", { name: "Выбрать часть" }));
  await user.click(screen.getByRole("checkbox", { name: "Выбрать изменение: Посылки" }));

  expect(screen.getByRole("checkbox", { name: "Выбрать игру: Lego Harry Potter: Years 1–4" }))
    .toHaveProperty("indeterminate", true);
  expect(screen.getByRole("button", { name: "Синхронизировать выбранное · 1" })).toBeInTheDocument();
});
```

Also assert:

- groups start expanded and sort as supplied by the pure model;
- game checkbox toggles all visible unique selection IDs;
- dependency-only checked rows are disabled and explain `связано с …`;
- deselecting the final explicit row restores `Синхронизировать всё`;
- closing/reopening resets selection mode, selections, collapse state, and rendered/source state;
- `Весь diff` and `Исходник` sit beside the note preview, not in a global panel;
- undoing a row/game sends the resolved dependency paths;
- conflict state still blocks every scope.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
npm test -- tests/ui-acceptance.test.tsx tests/diff-sync-panel.test.tsx tests/local-assets-ui.test.tsx
```

Expected: FAIL because the dialog still accepts flat type-grouped `DiffItem[]`.

- [ ] **Step 3: Replace `DiffItem`/`DiffGroupId` with controlled review props**

Use these props:

```ts
export interface DiffSelectionState {
  enabled: boolean;
  explicitSelectionIds: ReadonlySet<string>;
  selectedSelectionIds: ReadonlySet<string>;
  dependencySelectionIds: ReadonlySet<string>;
  dependencyLabels: Readonly<Record<string, string>>;
}

export interface DiffDialogProps {
  open: boolean;
  review: ChangeReviewModel;
  selection: DiffSelectionState;
  conflicts?: DiffConflictItem[];
  patchBytes: number;
  error?: string;
  onEnterSelection: () => void;
  onToggleChange: (selectionId: string) => void;
  onToggleGame: (gameId: string | null) => void;
  onUndoChange?: (selectionId: string) => void;
  onUndoGame?: (gameId: string | null) => void;
  onClose: () => void;
  onClearAll?: () => void;
  onExport: () => void;
  onImport: (text: string, fileName: string) => void | Promise<void>;
  onResolveConflict?: (conflictId: string, resolution: "static" | "local", manualValue?: unknown) => void;
  onDownloadCorruptedRaw?: () => void;
  onDismissError?: () => void;
  sync?: DiffSyncController;
  localAssets?: LocalAssetsSummary;
}
```

Create a small `TriStateCheckbox` that sets `input.indeterminate` in an effect and exposes `aria-checked="mixed"` through the native checkbox state.

- [ ] **Step 4: Render game groups and semantic evidence**

For each `GameChangeGroup`, render cover, title, visible row count, and an ephemeral collapse button. Rows render a small kind label, title, summary, then evidence by type:

- scalar: exact `before → after`;
- chips: colored added/removed chips;
- move: tier and user-facing position;
- asset: thumbnail/file icon, name, dimensions, MIME, and bytes;
- Markdown: `MarkdownDiffPreview`.

Keep per-row undo, but pass `selectionId` so all required paths are discarded together. Remove the old top-level `added/changed/deleted/moved/assets` sections and their group undo actions.

- [ ] **Step 5: Drive selection and dependency state from `App`**

Replace the flat `items` memo with:

```ts
const review = useMemo(
  () => buildChangeReview(library.base, library.effective, library.patch),
  [library.base, library.effective, library.patch],
);
```

Keep `selectionMode` and `explicitSelectionIds` in `LibraryRoutes`; clear both when the dialog closes. Convert explicit IDs to `PatchSelectionSeed[]` through `review.changesBySelectionId`, call `resolvePatchSelection`, and map selected/dependency paths back to selection IDs for display.

An empty explicit set passes `selectedPaths: undefined` to sync. A non-empty set passes the resolved `selectedPaths`. Game toggle adds/removes the unique selection IDs visible in that group. A dependency-only row cannot remove an ID that remains required by another explicit selection.

- [ ] **Step 6: Scope connect-and-sync and saved-PAT sync actions**

Extend controller methods compatibly:

```ts
onConnect: (token: string, remember: boolean, selectedPaths?: readonly string[]) => void | Promise<void>;
onSync: (selectedPaths?: readonly string[]) => void | Promise<void>;
actionLabel?: string;
```

`DiffDialog` supplies either `Синхронизировать всё` or `Синхронизировать выбранное · N`, where `N` is the number of unique explicit/required selection identities, not duplicate cross-game rows. The PAT form uses the same frozen scope when its submit action immediately synchronizes.

- [ ] **Step 7: Reuse the selection resolver for safe undo**

For change/game undo, resolve the same seed closure and call `library.discardPaths(result.selectedPaths)`. Delete the old `expandedDiscardPaths` heuristic from `App.tsx`. This keeps undo and partial publication dependency semantics identical.

- [ ] **Step 8: Style the compact list and responsive selection controls**

Replace `.diff-group` type-section rules with `.game-diff-group`, `.game-diff-row`, evidence, selection, dependency, and preview rules. Preserve the 620px desktop drawer and full-width mobile drawer. Checkboxes may use native controls with `accent-color`; do not create a permanent builder sidebar or a dedicated rendered/source toolbar.

- [ ] **Step 9: Run the UI and integration suites**

Run:

```bash
npm test -- tests/ui-acceptance.test.tsx tests/diff-sync-panel.test.tsx tests/local-assets-ui.test.tsx tests/markdown-diff-preview.test.tsx tests/library-context.test.tsx
```

Expected: all PASS, including empty-selection full sync, unique cross-game counts, transient source mode, and conflict blocking.

- [ ] **Step 10: Inspect and commit only Task 7**

Run:

```bash
jj status
jj diff
jj describe -m "Group selectable changes by game"
jj new
```

---

### Task 8: Verify the complete behavior and repository state

**Files:**
- Modify only if a verification failure reveals a missing regression in a task-owned test file.

**Interfaces:**
- Verifies the complete domain-to-UI-to-publication contract; introduces no new architecture.

- [ ] **Step 1: Run all automated tests**

Run:

```bash
npm test
```

Expected: all suites PASS with no unhandled promise rejection or console error.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite complete successfully.

- [ ] **Step 3: Perform focused static checks**

Run:

```bash
rg -n "DiffGroupId|groupLabels|expandedDiscardPaths" src tests
rg -n "localStorage|sessionStorage" src/components/MarkdownDiffPreview.tsx src/components/DiffDialog.tsx
rg -n "^[[:space:]]*[+−~]" src/components/MarkdownDiffPreview.tsx
```

Expected:

- no obsolete type-group implementation remains;
- no rendered/source or partial-selection persistence was introduced;
- no visible diff-marker prefixes are emitted by the preview component.

- [ ] **Step 4: Re-run the real-history regression explicitly**

Run:

```bash
npm test -- tests/markdown-diff.test.ts -t "ellipsis|Замки"
```

Expected: inserted lines appear before an unchanged `- [ ] ...`, and both exact historical sources reconstruct.

- [ ] **Step 5: Inspect the final Jujutsu history and working copy**

Run:

```bash
jj status
jj log -r '@- | @'
```

Expected: the working-copy change is empty after the final `jj new`, and the feature is represented by the task descriptions above with no unrelated files.
