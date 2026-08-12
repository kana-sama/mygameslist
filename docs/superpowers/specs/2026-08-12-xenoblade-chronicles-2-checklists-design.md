# Xenoblade Chronicles 2 checklist notes

**Date:** 2026-08-12  
**Status:** Approved design

## Summary

Add fourteen checklist notes to the existing `Xenoblade Chronicles 2` game source. Thirteen notes mirror the tracked content types from [XC2 Checklist](https://xc2-checklist.firebaseapp.com/) and are enriched where that site omits useful completion data. A fourteenth `New Game+` note contains every NG+-exclusive checklist item so the other notes can be used for a first playthrough as if NG+ did not exist.

The notes are completion indexes, not walkthroughs. They give enough location, availability, requirement, and shop-inventory information to identify an entry without reproducing long acquisition guides.

## Scope

Create these notes in this display order:

1. `Blades`
2. `Quests`
3. `Shop Deeds`
4. `Unique Monsters`
5. `Heart-to-Hearts`
6. `Merc Missions`
7. `Secret Areas`
8. `Pouch Expansion Kits`
9. `Poppi Technical Manuals`
10. `Foorara`
11. `Brothersisterpons`
12. `Nopon Doubloons`
13. `Challenges`
14. `New Game+`

The Torna – The Golden Country campaign and unrelated completion grinds are outside scope.

## Shared presentation rules

- Every note title, section heading, subsection heading, table header, canonical content name, region name, and game-mechanic label is English.
- Explanations, directions, clarifications, and warnings are Russian.
- Every completable entry starts unchecked as `[ ]`.
- Only `Challenges` uses a Markdown table. Every other note uses flat or nested Markdown checklists.
- Base-game and Expansion Pass entries remain together. Expansion Pass entries carry an inline `[DLC]` tag and never receive a separate `DLC` heading.
- No NG+-exclusive entry appears in any of the thirteen first-playthrough notes. Those entries exist only in `New Game+`.
- Avoid headings that would contain only one or two entries. When a natural grouping would produce such fragments, flatten the note and write the grouping attribute on each line.
- Preserve English names and source order where it represents story, unlock, quest-chain, or route order. Otherwise sort entries predictably within their natural group.
- Long notes use the existing `doubleHeight: true` presentation. The compact route lists may remain at normal height.
- Preserve the existing personal XC2 note unchanged.

## Note designs

### Blades

Track the 34 non-NG+ optional Rare Blades present in the primary checklist: 28 base-game entries and 6 Expansion Pass entries.

Use two acquisition groups:

- `Random Core Crystals`
- `Fixed Acquisition`

Each line includes the Blade name, element, role, weapon, acquisition summary, and `[DLC]` when applicable. The seven NG+ Torna Blades are excluded.

### Quests

Track all 152 quests from the primary checklist: Main Story, Normal, Blade, and DLC quest types.

The outer grouping is earliest available chapter, using headings such as `Chapter 2`. Within each chapter, use a region subheading only when that chapter contains at least three quests from the region. Put one- or two-quest regional fragments directly under the chapter heading and write the region inline on each line. Keep connected quest-chain entries in their playable order. Each line includes the quest name, quest type when useful, giver and location when known, concise prerequisites, and `[DLC]` for the 24 DLC quests. Do not create Base Game or DLC sections.

### Shop Deeds

Track all 52 Store Deeds and all 259 products required to expose them.

Group shops under their six regions. Each shop is a parent checkbox whose line contains the shop name, deed name, and deed benefit. Every and only product whose purchase contributes to that Store Deed bonus is an indented child checkbox immediately below it. A child includes its English item name and a concise Russian unlock condition when it is not automatically available, including the relevant Merc Mission name. Do not include unrelated products imported into the shop later when they do not contribute to the deed.

Products must come from a full external deed-prerequisite inventory rather than being inferred only from the primary checklist's item counts. That external inventory supersedes an incorrect primary `numberOfItemsSold`: Soniarus Music requires Torigonda, Woodgrain Alphorn, Cedarwood Koto, Woodboard, and Coralline Marimba (five, not the primary four); Memoria Art requires only Ancient King's Portrait, Snow-Crystal Vase, and Portrait of Ger the Hero, excluding the later imported The Girl on the Hill and Final Chorus.

The exact required-product totals, in note-region order, are Argentum Trade Guild 43, Gormott Province 43, Kingdom of Uraya 54, Empire of Mor Ardain 43, Leftherian Archipelago 31, and Kingdom of Tantal 45.

### Unique Monsters

Track all 85 Unique Monsters. Group by region and sort each region by numeric level. Do not create level-based groups. Each line includes monster name, `Lv.`, sublocation, spawn time or condition when relevant, and an inline marker for special monster variants when the source distinguishes them.

### Heart-to-Hearts

Track 66 first-playthrough Heart-to-Hearts. The seven NG+-exclusive scenes are excluded.

Keep one flat list ordered by region and location to avoid tiny region sections. Each line includes scene name, region, location, required party members, and the concise activation note or prerequisite.

### Merc Missions

Track all 274 Merc Missions. Group under the six source regions and keep related mission chains adjacent and ordered. Each line includes mission name and the available source note or concise unlock requirement. The exactly 26 records whose primary `notes` mention DLC carry an inline `[DLC]` tag. Do not use a table because requirements vary in length.

### Secret Areas

Track all 17 Secret Areas in one flat list ordered by region. Each line includes area name, region, subregion, and a concise Russian access hint. Region headings are deliberately omitted because several regions contain only one or two entries.

### Pouch Expansion Kits

Track all 4 overworld Pouch Expansion Kits in earliest-availability order. Each line includes kit label, chapter availability, region, landmark, and concise directions.

### Poppi Technical Manuals

Track all 5 manuals in earliest-availability order. Each line includes manual name, chapter, region, landmark, and concise chest location.

### Foorara

Track all 9 Foorara encounters in the quest's required encounter order. Each line includes the region, locality, landmark, and concise directions.

### Brothersisterpons

Track all 11 Brothersisterpons in the quest's required order. Each line includes the Nopon name, earliest chapter, region, locality or landmark, and concise directions.

### Nopon Doubloons

Track all 11 Nopon Doubloons in quest order. Each line includes region, locality, landmark, prerequisite when applicable, and concise directions.

### Challenges

Track the 27 Challenge Battles as exactly one Markdown table and no additional tables. Use these columns:

```text
Challenge | Lv. | Restrictions | Easy | Normal | Bringer of Chaos
```

Every row has three independent checkbox cells, one for each difficulty, for exactly 81 tracked completions. Keep level and restrictions inline; do not add level groups.

### New Game+

Keep all NG+-exclusive content in one note because its size remains smaller than the largest first-playthrough notes. Use these English section headings:

- `Blades` — the seven Torna Blades, including acquisition method.
- `Heart-to-Hearts` — the seven exclusive scenes with location, party, and prerequisite.
- `Hidden Affinity Charts` — one Driver parent checklist for Rex, Nia, Tora, Vandham, Mòrag, and Zeke, with every hidden-chart skill as an indented child containing its SP cost and concise effect.
- `Traveling Bards` — all twelve Bards in route order with region, location, traded item, and Bonus EXP price.
- `New Features` — short Russian explanatory bullets for NG+-only mechanics that are not meaningful completion tasks; genuine unlocks may use checkboxes.

The note begins with a concise Russian reset/carry-over warning only where it prevents the checklist from misleading the player. It does not duplicate ordinary first-playthrough content.

## Sources and normalization

- Use `https://xc2-checklist.firebaseapp.com/json/database.json` as the identity, count, and ordering authority for the thirteen primary checklist record sets, except that external deed-prerequisite evidence controls Shop Deeds product-child membership/counts.
- Use the XC2 Checklist UI as the reference for which data fields are intended to identify each entry.
- Use the CyricZ GameFAQs `Pouch Items and Shop Deeds` and `Shops & Deeds` guide sections to enumerate the 259 deed-prerequisite products and their unlock conditions. This external prerequisite inventory, not a shop's later/general catalog and not an erroneous primary count, determines product-child membership.
- Use Xenoblade Wiki character, quest, and New Game+ pages plus the Neoseeker Traveling Bards guide to fill chapter availability, hidden Driver affinity skills, Bard trades, and other missing details.
- Cross-check totals and ambiguous names against the independent `r52/xc2-checklist` dataset or Xenoblade data tables when available.
- Prefer the current English in-game spelling. Preserve diacritics such as `Mòrag`; normalize the primary typo `Bureoning Curiosity` to canonical `Burgeoning Curiosity`.
- Paraphrase directions and explanatory prose into concise Russian; do not copy walkthrough passages.

## Data integration

- Add exactly fourteen Markdown note documents below `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/`.
- Use new UUIDs, positive ranks after the existing personal note, valid ISO timestamps, and the canonical `mygameslist-note:v1` envelope.
- Add no attachments and change neither `game.yaml` nor the existing note.
- Keep the `AGENTS.md` rule update, specification, implementation plan, and fourteen notes in exactly one Jujutsu feature commit. No data-specific test or validation script remains in the commit.

## Verification

- Use a temporary task-specific contract test or script that reads the fourteen note documents and asserts titles, ordering metadata, counts, grouping syntax, NG+ isolation, DLC inline tags, and the single-table rule. Delete it after successful verification and before finalizing.
- Assert the required totals: 34 first-playthrough Blades, 152 Quests, 52 Shop Deeds plus 259 nested deed-prerequisite products, 85 Unique Monsters, 66 first-playthrough Heart-to-Hearts, 274 Merc Missions including exactly 26 inline `[DLC]` tags selected from primary notes, 17 Secret Areas, 4 Pouch Expansion Kits, 5 Poppi Technical Manuals, 9 Foorara encounters, 11 Brothersisterpons, 11 Nopon Doubloons, and 27 Challenge rows with 81 checkbox cells.
- Assert that the game directory contains the existing note plus exactly fourteen new note files.
- Run `npm run data:validate`, the focused Vitest file, the full test suite, and the production build.
- Inspect the rendered notes at the application's normal note-card width. Confirm that only Challenges is tabular, every list hierarchy remains usable, headings are English, explanations are Russian, and long lines do not hide checklist controls.
- Inspect `jj status` and `jj diff` before finalizing; only `AGENTS.md`, the specification, plan, and XC2 note files may be included. No data-specific test or script may remain.

## Acceptance criteria

- A first-time player can use the thirteen main notes without seeing or tracking NG+-exclusive content.
- Every primary checklist entry is represented once in the appropriate note, except the NG+ Blades and Heart-to-Hearts that are represented once in `New Game+` instead.
- Store Deeds expose a nested, individually checkable list of every required product.
- Quests are navigable first by chapter and then by region.
- Unique Monsters are navigable by region with level shown inline rather than used as a grouping.
- Challenges is the only table and provides independent Easy, Normal, and Bringer of Chaos progress.
- All user-visible headings are English and only explanatory prose is Russian.
