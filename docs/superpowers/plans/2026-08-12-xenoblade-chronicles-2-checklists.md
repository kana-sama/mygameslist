# Xenoblade Chronicles 2 Checklist Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fourteen complete, source-verified Xenoblade Chronicles 2 checklist notes while isolating all NG+-exclusive content from the first-playthrough notes.

**Architecture:** Treat the feature as authored canonical data guarded by a focused content-contract test. Normalize the primary checklist JSON and targeted external guides into fourteen Markdown note documents, then validate exact counts, hierarchy, presentation rules, and source-tree assembly without adding a runtime data dependency.

**Tech Stack:** TypeScript, Vitest, GFM Markdown, canonical YAML/Markdown source tree, Node.js 22, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Finalize the `AGENTS.md` rule update, specification, plan, and fourteen notes as exactly one feature commit; do not create intermediate commits.
- Data-specific validation tests are temporary task artifacts and must be deleted after verification, before finalizing the feature commit.
- Preserve `game.yaml`, the existing personal XC2 note, and every unrelated file.
- Use English for every heading, table header, canonical name, region, and mechanic label; use Russian only for explanatory prose.
- Use lists for every note except `Challenges`, which is exactly one six-column table.
- Keep Base Game and Expansion Pass content together and mark Expansion Pass entries inline with `[DLC]`.
- Put every NG+-exclusive entry only in `New Game+`.
- Avoid one- and two-entry sections; flatten those groupings and show the attribute inline.
- Every checkbox is initially unchecked.

---

## File structure

- `docs/superpowers/specs/2026-08-12-xenoblade-chronicles-2-checklists-design.md` — approved content and presentation contract.
- `docs/superpowers/plans/2026-08-12-xenoblade-chronicles-2-checklists.md` — this plan.
- `tests/xc2-checklists.test.ts` — temporary filesystem-level contract for IDs, counts, hierarchy, tables, DLC tags, and NG+ isolation; delete before finalization.
- `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/*.md` — fourteen new canonical note documents.

The test owns the expected note manifest below so later note tasks have a stable interface:

| Title | ID | Rank |
|---|---|---:|
| Blades | `01ffe0d8-f4e5-47f6-995b-7976895c7b87` | 2048 |
| Quests | `b799c929-ef7f-4afb-accc-238a29fe44d6` | 3072 |
| Shop Deeds | `6ce41b9c-4587-4748-bbe7-3cdf28feceeb` | 4096 |
| Unique Monsters | `f85b6c11-f686-4569-941e-b776e514e768` | 5120 |
| Heart-to-Hearts | `350c7613-46a6-46ca-8ee0-5457d56f1047` | 6144 |
| Merc Missions | `7cca4283-8332-469d-9b3d-e2ee11539b92` | 7168 |
| Secret Areas | `43f5bd37-39b0-4f3f-b612-a0d791222d2a` | 8192 |
| Pouch Expansion Kits | `49087b0e-513e-42d6-b256-a6fbc0f3bad4` | 9216 |
| Poppi Technical Manuals | `70cf2c4a-a098-4bd5-bc95-124e1d41284a` | 10240 |
| Foorara | `65b5f842-01d9-4044-a1da-4eac1eb78f98` | 11264 |
| Brothersisterpons | `a56dba92-6c2b-4e2a-9c27-e6cb84e3afd8` | 12288 |
| Nopon Doubloons | `769276e9-bf39-4339-b221-ede11200295f` | 13312 |
| Challenges | `96e435c8-cee0-4569-ab4b-8be5c5758643` | 14336 |
| New Game+ | `60667614-8aa3-44c1-877c-a319b3757ee9` | 15360 |

### Task 1: Add the temporary failing XC2 content contract

**Files:**
- Create: `tests/xc2-checklists.test.ts`
- Read: `src/source/noteDocument.ts`
- Read: `tests/source-note-document.test.ts`

**Interfaces:**
- Consumes: the approved note manifest above and the exact structural requirements in the specification.
- Produces: a temporary Vitest suite that fails while the fourteen files are absent and passes only when every note satisfies the content contract. It is verification scaffolding, not a product test, and Task 5 deletes it.

- [ ] **Step 1: Define the expected manifest and helpers**

Create constants for the XC2 notes directory and all fourteen title/ID/rank tuples. Add helpers that locate a note by its UUID suffix, parse the `mygameslist-note:v1` metadata envelope, return the Markdown body, count checkbox tokens, count top-level and indented checklist lines, and recognize Markdown table separator lines.

- [ ] **Step 2: Assert document identity and shared presentation**

Add tests that assert:

```text
notes directory total = 15 files
new note files = 14
first body line = # <expected English title>
metadata id and rank = expected tuple
all new task tokens = [ ], never [x] or [X]
heading lines contain no Cyrillic
only Challenges contains a Markdown table separator
no first-playthrough note contains "New Game+" or "NG+"
no heading equals or starts with "DLC"
```

- [ ] **Step 3: Assert every type-specific count and hierarchy**

Encode the following exact contracts:

```text
Blades: 34 top-level tasks; headings Random Core Crystals and Fixed Acquisition
Quests: 152 tasks; Chapter h2 headings; Region h3 headings only for chapter/region groups with at least three quests, otherwise region inline
Shop Deeds: 52 top-level shop/deed tasks and 259 indented deed-prerequisite product tasks; six region headings
Unique Monsters: 85 tasks; region headings; every task contains "Lv."
Heart-to-Hearts: 66 tasks; no h2 grouping headings after title
Merc Missions: 274 tasks; six region headings; exactly 26 inline [DLC] tags selected by primary notes mentioning DLC
Secret Areas: 17 tasks; no h2 grouping headings after title
Pouch Expansion Kits: 4 tasks
Poppi Technical Manuals: 5 tasks
Foorara: 9 tasks
Brothersisterpons: 11 tasks
Nopon Doubloons: 11 tasks
Challenges: 27 table data rows and 81 task cells; exact six headers
New Game+: sections Blades, Heart-to-Hearts, Hidden Affinity Charts, Traveling Bards, New Features; 7 Blade tasks, 7 Heart-to-Heart tasks, 6 Driver parent tasks with nested skill tasks, and 12 Bard tasks
```

Use section slicing rather than a single global checkbox count for `New Game+` because nested hidden-chart skill totals come from the verified character pages.

- [ ] **Step 4: Run the focused test and verify the expected failure**

Run:

```bash
npx vitest run tests/xc2-checklists.test.ts
```

Expected: FAIL because the fourteen note files do not yet exist.

### Task 2: Author the primary-data first-playthrough notes

**Files:**
- Create: the Blades, Unique Monsters, Heart-to-Hearts, Merc Missions, Secret Areas, Pouch Expansion Kits, Poppi Technical Manuals, Foorara, Brothersisterpons, Nopon Doubloons, and Challenges note files listed in the manifest.
- Read: `/private/tmp/xc2-checklist-source-20260812/database.json`
- Read: `docs/superpowers/specs/2026-08-12-xenoblade-chronicles-2-checklists-design.md`

**Interfaces:**
- Consumes: the primary database arrays and the structural test from Task 1.
- Produces: eleven schema-valid note documents containing every corresponding non-NG+ primary entry.

- [ ] **Step 1: Normalize primary arrays without changing membership**

Filter `blades` and `hearttoheart` entries whose source or known membership is New Game Plus into Task 4. Preserve all entries in the other eleven arrays. Normalize region spelling, whitespace, punctuation, and Russian explanation text without translating canonical names. Apply the reviewed exact source-name correction `Bureoning Curiosity` → `Burgeoning Curiosity`; do not use fuzzy name matching.

- [ ] **Step 2: Write the five large checklist documents**

Create Blades, Unique Monsters, Heart-to-Hearts, Merc Missions, and Challenges with the exact grouping and formatting from the specification. Use region headings only where specified. Mark exactly the 26 Merc Mission records whose primary `notes` mention DLC with inline `[DLC]`. Challenges must be exactly one Markdown table with 27 rows and three task cells per row.

- [ ] **Step 3: Write the six route checklist documents**

Create Secret Areas, Pouch Expansion Kits, Poppi Technical Manuals, Foorara, Brothersisterpons, and Nopon Doubloons in source or required route order. Flatten regions for Secret Areas and keep chapter/region attributes inline for the short lists.

- [ ] **Step 4: Add canonical metadata**

Give every file its manifest UUID and rank, a shared valid ISO `createdAt` and `updatedAt`, no attachments, and `doubleHeight: true` for Blades, Unique Monsters, Heart-to-Hearts, Merc Missions, and Challenges.

- [ ] **Step 5: Run focused tests for completed notes**

Run:

```bash
npx vitest run tests/xc2-checklists.test.ts
```

Expected: identity tests now find the eleven files; their count assertions pass, while the absent Quests, Shop Deeds, and New Game+ files still fail.

### Task 3: Author Quests and Shop Deeds with external enrichment

**Files:**
- Create: Quests note `b799c929-ef7f-4afb-accc-238a29fe44d6`
- Create: Shop Deeds note `6ce41b9c-4587-4748-bbe7-3cdf28feceeb`
- Read: `/private/tmp/xc2-checklist-source-20260812/database.json`
- Read: GameFAQs `Pouch Items and Shop Deeds` and `Shops & Deeds`
- Read: Xenoblade Wiki quest pages and the `r52/xc2-checklist` quest dataset

**Interfaces:**
- Consumes: 152 primary quest identities, 52 primary deed identities, full external deed-prerequisite inventories that supersede erroneous primary product counts, and Task 1's hierarchy contract.
- Produces: a chapter/region Quest checklist and a region/shop/product Store Deed checklist.

- [ ] **Step 1: Reconcile quest chapter availability**

Assign every primary quest to the earliest chapter in which all mandatory story, party, region, and prior-quest prerequisites can be satisfied. Within each chapter, group by region and order quest chains. Mark all 24 DLC quest entries inline with `[DLC]`; do not create a DLC section.

- [ ] **Step 2: Write all 152 quest lines**

Use this information order on each checklist line:

```text
Quest Name [DLC when applicable] — type; giver, location; краткие prerequisites
```

Omit absent fields instead of inserting placeholders. Use English for names and game labels and Russian for connective explanation.

- [ ] **Step 3: Reconcile every shop inventory**

For each of the 52 primary shops, enumerate all and only the externally documented products whose purchase contributes to the Store Deed bonus. Use primary `numberOfItemsSold` only as a reconciliation signal; the external deed-prerequisite inventory supersedes it when they disagree. Soniarus Music has five required products (Torigonda, Woodgrain Alphorn, Cedarwood Koto, Woodboard, Coralline Marimba), despite primary count four. Memoria Art has only its three primary products (Ancient King's Portrait, Snow-Crystal Vase, Portrait of Ger the Hero); omit later imports The Girl on the Hill and Final Chorus. Record automatic availability without prose; append a concise Russian condition only to products unlocked by story, quest, development level, or Merc Mission.

- [ ] **Step 4: Write nested Shop Deed checklists**

Under each region heading, use one shop/deed parent task and indent every required product by two spaces. Include the deed benefit on the parent line. The sum across all shops must be exactly 259 children. Regional product totals are Argentum Trade Guild 43, Gormott Province 43, Kingdom of Uraya 54, Empire of Mor Ardain 43, Leftherian Archipelago 31, and Kingdom of Tantal 45. Every shop's child count matches the primary source except the explicit Soniarus Music external override from four to five.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run tests/xc2-checklists.test.ts
```

Expected: every first-playthrough note test passes; only the absent New Game+ file still fails.

### Task 4: Author the complete New Game+ note

**Files:**
- Create: New Game+ note `60667614-8aa3-44c1-877c-a319b3757ee9`
- Read: primary database NG+ Blade and Heart-to-Heart entries
- Read: Xenoblade Wiki pages for Rex, Nia, Tora, Vandham, Mòrag, Zeke, and New Game Plus
- Read: Neoseeker Traveling Bards guide

**Interfaces:**
- Consumes: seven Blade records, seven Heart-to-Heart records, six complete Hidden Affinity Charts, twelve Bard trades, and documented NG+ mechanics.
- Produces: one isolated NG+ note whose nested sections satisfy Task 1.

- [ ] **Step 1: Verify the exclusive inventories**

Cross-check the seven Torna Blades and seven exclusive Heart-to-Hearts against the primary database. Extract every hidden-chart skill name, SP cost, and concise effect for the six base-game Drivers. Extract all twelve Bard locations, items, and Bonus EXP prices.

- [ ] **Step 2: Write the four checklist sections**

Write `Blades`, `Heart-to-Hearts`, `Hidden Affinity Charts`, and `Traveling Bards` as lists. Each Driver is a parent checkbox with every hidden skill indented below it. Keep Bard entries flat in route order with region inline so twelve entries are not fragmented into tiny groups.

- [ ] **Step 3: Write non-checklist guidance**

Add concise Russian prose under `New Features` for level reduction, Bonus EXP trading, broader Merc Mission eligibility, and other NG+-only mechanics. Add a short Russian reset/carry-over warning at the top only for data that materially affects completion planning.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run tests/xc2-checklists.test.ts
```

Expected: PASS.

### Task 5: Validate presentation, source integrity, and the single feature change

**Files:**
- Verify: all fourteen new notes
- Delete after successful verification: `tests/xc2-checklists.test.ts`
- Verify: the specification and this plan

**Interfaces:**
- Consumes: all authored documents and the contract suite.
- Produces: one verified immutable Jujutsu feature commit and a fresh empty working-copy change.

- [ ] **Step 1: Run canonical source validation**

Run:

```bash
npm run data:validate
```

Expected: exit code 0 with the source tree assembling successfully.

- [ ] **Step 2: Run focused and full regression tests**

Run:

```bash
npx vitest run tests/xc2-checklists.test.ts
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Perform structural audits**

Run read-only searches and count scripts that independently verify the fourteen note IDs, fifteen total XC2 note files, English-only headings, inline DLC tags, NG+ isolation, exact required counts, 52/259 shop parent-child counts with the Soniarus override and six regional product totals, and exactly one table in Challenges.

- [ ] **Step 4: Remove the temporary data-specific test**

After the focused test, canonical validation, full code test suite, build, and independent structural audits all pass, delete `tests/xc2-checklists.test.ts`. Run `npm test` again to prove the permanent code suite remains green without any expectations about the real XC2 data.

- [ ] **Step 5: Inspect rendered output against the approved design**

Open the XC2 game page at the normal desktop viewport and inspect all fourteen notes. Compare each note directly with the primary site and the approved specification. Verify list indentation, checkbox interaction, collapsed heading progress, table checkbox interaction, horizontal overflow, and the requested group order. Stop and correct any observable structural mismatch.

- [ ] **Step 6: Review the complete working-copy change**

Run:

```bash
jj status
jj diff --stat
jj diff
```

Confirm that only `AGENTS.md`, the specification, plan, and fourteen new XC2 note documents changed. The temporary data-specific test must be absent. Require an independent specification review and quality review before finalization.

- [ ] **Step 7: Finalize exactly one feature commit**

Run:

```bash
jj describe -m "Add Xenoblade Chronicles 2 checklist notes"
jj new
jj status
```

Expected: the described parent contains the complete feature and the new working-copy change is empty. Do not rewrite, squash, abandon, or amend the finalized commit.
