# LEGO Harry Potter: Years 5–7 Collectible Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three spoiler-light, complete collectible checklist notes for LEGO Harry Potter: Years 5-7.

**Architecture:** Treat the feature as a canonical-data update. First build and reconcile normalized collectible inventories from independent guides, then encode them as three Markdown note records in `public/data/library.json`, recompute the canonical revision, and validate both schema integrity and collectible counts.

**Tech Stack:** JSON, GFM Markdown, Node.js 22, repository data validator, Vitest, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Finalize specification, plan, tests/verification, and implementation as exactly one feature commit; do not create intermediate commits.
- Add exactly three notes to game `ef7ef992-4633-409a-aa55-1092aebfc783` and preserve all unrelated library data.
- Top-level note headings are `Gold Bricks`, `Red Bricks`, and `Character Tokens`; internal section headings are Russian.
- Every location, level, Red Brick name, and character name is English.
- Story-level locations contain only the official level title.
- Do not include collection methods, required abilities, spells, directions, prices, guide area numbers, or story prerequisites.
- Every checkbox is initially unchecked.
- Required totals are 200 Gold Bricks, 24 Red Bricks, and 200 Character Tokens.

---

## File structure

- `docs/superpowers/specs/2026-08-06-lego-harry-potter-years-5-7-collectible-notes-design.md` — approved requirements and normalization rules; already created.
- `docs/superpowers/plans/2026-08-06-lego-harry-potter-years-5-7-collectible-notes.md` — this execution plan.
- `public/data/library.json` — the only product-data file to modify; receives three notes and a recomputed root revision.

No source-code or persistent test-file changes are required. Verification uses the existing validator plus a task-specific read-only Node assertion command.

### Task 1: Build and reconcile normalized inventories

**Files:**
- Read: `docs/superpowers/specs/2026-08-06-lego-harry-potter-years-5-7-collectible-notes-design.md`
- Read: `public/data/library.json`
- Product changes: none

**Interfaces:**
- Consumes: CyricZ GameFAQs walkthrough sections 7–12; independent Red Brick and Character Token collectible guides.
- Produces: three ordered Markdown bodies satisfying the exact counts and formatting rules consumed by Task 2.

- [ ] **Step 1: Enumerate the 24 official story levels**

Record six levels for each period in story order:

1. Order of the Phoenix;
2. Half-Blood Prince;
3. Deathly Hallows – Part 1;
4. Deathly Hallows – Part 2.

Use each official title as the entire story-level location label. Do not retain guide act markers such as `A1`, room names, or directions.

- [ ] **Step 2: Reconcile the Gold Brick inventory**

Build the Gold Brick Markdown from these disjoint groups:

```text
24 story completions
24 True Wizard awards
24 completed House Crests
24 story-level Students in Peril
51 open-world/interlude Gold Bricks
36 counting open-world Students in Peril
16 Borgin & Burkes purchases
1 LEGO Town completion
= 200
```

Use the 24 level rows with four checkbox cells for the first 96. Map each of the 51 non-level awards to the immediate English game area where it is received. Exclude the known 61st, non-counting Student in Peril.

- [ ] **Step 3: Reconcile all 24 Red Bricks**

Use the primary guide's Extras-menu order. Include the four pre-unlocked extras with location `Already available`, then all twenty collectible extras. Normalize every line to:

```markdown
- [ ] Location — **Extra Name**
```

Cross-check names and locations against the GamesRadar or PlayStationTrophies complete Red Brick guide. Remove every parenthetical requirement, price, effect, and instruction.

- [ ] **Step 4: Reconcile all 200 Character Tokens**

Use the primary guide's 200-entry Character Token list as the count authority. Cross-check names and placements against the SuperCheats or PlayStationTrophies complete character guide. Normalize every line to:

```markdown
- [ ] Location — **Character Name**
```

For a story collectible, replace any guide-specific act or room text with the official level title. Use `Already available` only for entries counted by the game's 200-entry list that require no collectible pickup.

- [ ] **Step 5: Perform a pre-edit count audit**

Before changing `library.json`, confirm:

```text
level rows = 24
Gold Brick checkbox cells/items = 200
Red Brick checklist items = 24
Character Token checklist items = 200
```

Also inspect every location label for parentheses containing requirements, spell names, prices, procedural verbs, guide area identifiers, or intra-level place names.

### Task 2: Add the three canonical note records

**Files:**
- Modify: `public/data/library.json`

**Interfaces:**
- Consumes: the three verified Markdown bodies from Task 1.
- Produces: three schema-valid `Note` records attached to game `ef7ef992-4633-409a-aa55-1092aebfc783`.

- [ ] **Step 1: Insert the Gold Bricks note**

Add a record under key `bb4f5b8c-a4fa-43c3-9698-52c9202dcd08` with these exact fields:

| Field | Value |
|---|---|
| `id` | `bb4f5b8c-a4fa-43c3-9698-52c9202dcd08` |
| `gameId` | `ef7ef992-4633-409a-aa55-1092aebfc783` |
| `bodyMarkdown` | complete verified Gold Brick Markdown produced by Task 1 |
| `attachments` | `[]` |
| `doubleHeight` | `true` |
| `rank` | `1024` |
| `createdAt` | `2026-08-06T07:26:34.000Z` |
| `updatedAt` | `2026-08-06T07:26:34.000Z` |

- [ ] **Step 2: Insert the Red Bricks note**

Add a record under key `fef68388-3e9e-4081-ab76-b73da1409d00` with these exact fields:

| Field | Value |
|---|---|
| `id` | `fef68388-3e9e-4081-ab76-b73da1409d00` |
| `gameId` | `ef7ef992-4633-409a-aa55-1092aebfc783` |
| `bodyMarkdown` | complete verified 24-line Red Brick Markdown produced by Task 1 |
| `attachments` | `[]` |
| `rank` | `2048` |
| `createdAt` | `2026-08-06T07:26:34.000Z` |
| `updatedAt` | `2026-08-06T07:26:34.000Z` |

Do not add `doubleHeight` unless rendering demonstrates that normal height is unusable.

- [ ] **Step 3: Insert the Character Tokens note**

Add a record under key `61b4a3f8-e4cc-4213-b723-015e64f1fc55` with these exact fields:

| Field | Value |
|---|---|
| `id` | `61b4a3f8-e4cc-4213-b723-015e64f1fc55` |
| `gameId` | `ef7ef992-4633-409a-aa55-1092aebfc783` |
| `bodyMarkdown` | complete verified 200-line Character Token Markdown produced by Task 1 |
| `attachments` | `[]` |
| `doubleHeight` | `true` |
| `rank` | `3072` |
| `createdAt` | `2026-08-06T07:26:34.000Z` |
| `updatedAt` | `2026-08-06T07:26:34.000Z` |

- [ ] **Step 4: Recompute the root revision**

After the records are complete, calculate the revision with the repository's canonical algorithm and replace only the root `revision` value:

```bash
node --input-type=module -e '
import { readFile } from "node:fs/promises";
import { computeRevision } from "./scripts/validate-data.mjs";
const database = JSON.parse(await readFile("public/data/library.json", "utf8"));
console.log(computeRevision(database));
'
```

Use `apply_patch` to place the printed lowercase SHA-256 value in `public/data/library.json`. Preserve `publicationId` and all unrelated metadata.

### Task 3: Verify and finalize the single feature commit

**Files:**
- Verify: `AGENTS.md`
- Verify: `public/data/library.json`
- Verify: `docs/superpowers/specs/2026-08-06-lego-harry-potter-years-5-7-collectible-notes-design.md`
- Verify: `docs/superpowers/plans/2026-08-06-lego-harry-potter-years-5-7-collectible-notes.md`

**Interfaces:**
- Consumes: the canonical data records from Task 2.
- Produces: one verified immutable Jujutsu feature commit and a fresh empty working-copy change.

- [ ] **Step 1: Run the task-specific content assertions**

Run this read-only check:

```bash
node --input-type=module -e '
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const db = JSON.parse(await readFile("public/data/library.json", "utf8"));
const gameId = "ef7ef992-4633-409a-aa55-1092aebfc783";
const ids = [
  "bb4f5b8c-a4fa-43c3-9698-52c9202dcd08",
  "fef68388-3e9e-4081-ab76-b73da1409d00",
  "61b4a3f8-e4cc-4213-b723-015e64f1fc55",
];
const notes = ids.map((id) => db.notes[id]);
const officialLevelTitles = [
  "Dark Times",
  "Dumbledore\u0027s Army",
  "Focus!",
  "Kreacher Discomforts",
  "A Giant Virtuoso",
  "A Veiled Threat",
  "Out of Retirement",
  "Just Desserts",
  "A Not So Merry Christmas",
  "Love Hurts",
  "Felix Felicis",
  "The Horcrux and the Hand",
  "The Seven Harrys",
  "Magic is Might",
  "In Grave Danger",
  "Sword and Locket",
  "Lovegood\u0027s Lunacy",
  "DOBBY!",
  "The Thief\u0027s Downfall",
  "Back to School",
  "Burning Bridges",
  "Fiendfyre Frenzy",
  "Snape\u0027s Tears",
  "The Flaw in the Plan",
];
assert.deepEqual(notes.map((note) => note.gameId), [gameId, gameId, gameId]);
assert.deepEqual(notes.map((note) => note.rank), [1024, 2048, 3072]);
assert.deepEqual(notes.map((note) => note.bodyMarkdown.split("\n", 1)[0]), [
  "# Gold Bricks",
  "# Red Bricks",
  "# Character Tokens",
]);
const checkboxCount = (body) => (body.match(/\[ \]/g) ?? []).length;
assert.equal(checkboxCount(notes[0].bodyMarkdown), 200);
assert.equal(checkboxCount(notes[1].bodyMarkdown), 24);
assert.equal(checkboxCount(notes[2].bodyMarkdown), 200);
const goldLevelTitles = notes[0].bodyMarkdown
  .split("\n")
  .map((line) => line.match(/^\| (.+) \| \[ \] \| \[ \] \| \[ \] \| \[ \] \|$/)?.[1])
  .filter((title) => title !== undefined);
assert.deepEqual(goldLevelTitles, officialLevelTitles);
const characterLines = notes[2].bodyMarkdown.split("\n");
const openWorldHeadingIndex = characterLines.indexOf("## Открытый мир");
assert.notEqual(openWorldHeadingIndex, -1);
const characterStoryLocations = characterLines
  .slice(0, openWorldHeadingIndex)
  .map((line) => line.match(/^- \[ \] (.+) — \*\*.+\*\*$/)?.[1])
  .filter((location) => location !== undefined);
assert.deepEqual(
  characterStoryLocations,
  officialLevelTitles.flatMap((title) => [title, title, title]),
  "Character Token story locations must use each official level title exactly three times",
);
assert.ok(notes.every((note) => !note.bodyMarkdown.includes("[x]")));
console.log("Collectible note assertions passed");
'
```

Expected output: `Collectible note assertions passed`.

- [ ] **Step 2: Run canonical validation**

Run:

```bash
npm run data:validate
```

Expected: exit code 0 and a valid-library success message. This verifies the root revision as well as note schema and referential integrity.

- [ ] **Step 3: Run the repository regression suite and build**

Run:

```bash
npm test
npm run build
```

Expected: all Vitest tests pass and the production build completes without errors.

- [ ] **Step 4: Inspect the complete working-copy change**

Run:

```bash
jj status
jj diff --stat
jj diff
```

Confirm that only `AGENTS.md`, the approved specification, this plan, and `public/data/library.json` changed. Review all three literal Markdown bodies for accidental walkthrough text and verify that no existing records changed except the root revision.

- [ ] **Step 5: Finalize exactly one feature commit**

Run:

```bash
jj describe -m "Add LEGO Harry Potter Years 5–7 collectible notes"
jj new
jj status
```

Expected: the described parent contains the complete feature and the new working-copy change is empty. Do not rewrite, squash, abandon, or otherwise amend the finalized commit.
