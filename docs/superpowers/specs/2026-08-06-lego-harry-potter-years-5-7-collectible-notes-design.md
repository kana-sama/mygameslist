# LEGO Harry Potter: Years 5–7 collectible notes

**Date:** 2026-08-06  
**Status:** Approved design

## Summary

Add three checklist notes to the existing `LEGO Harry Potter: Years 5-7` game in `public/data/library.json`:

1. every Gold Brick;
2. every Red Brick;
3. every Character Token.

The notes are location indexes, not walkthroughs. They tell the player which English-language level or hub area contains an item while deliberately omitting how to obtain it.

## Goals

- Cover exactly all 200 Gold Bricks, all 24 Red Bricks, and all 200 Character Tokens from the home-console/PC version of the game.
- Follow the visual conventions of the existing `LEGO Harry Potter: Years 1–4` checklists.
- Keep every checklist item initially unchecked.
- Use official English names for levels, hub locations, Red Brick extras, and characters.
- Make progress easy to follow in story order and then by open-world area.
- Avoid puzzle solutions and other acquisition hints.

## Non-goals

- Explaining how to collect an item.
- Naming a room or sub-area inside a story level.
- Listing required spells, characters, abilities, equipment, story prerequisites, or prices.
- Adding screenshots, links, attachments, prose walkthroughs, or gameplay advice to the notes.
- Changing the existing Years 1–4 notes or any unrelated library data.

## Shared presentation rules

- The three top-level note headings are English: `Gold Bricks`, `Red Bricks`, and `Character Tokens`.
- Section headings inside the notes are Russian.
- All locations and collectible names are English.
- Every trackable entry uses an unchecked Markdown checkbox, `[ ]`.
- A collectible inside a story level uses only the official level title as its location. It never uses an act, room, scene, landmark, or guide-specific area number.
- An open-world collectible uses the smallest independently navigable named hub area that does not reveal the solution.
- Parenthetical requirements and instructions from source guides are removed from location labels.
- Duplicate locations remain separate checklist entries when multiple collectibles belong to the same location.
- Ordering follows story progression first, then the hub traversal order used by the primary reference guide. Alphabetical ordering is not used.
- The three new notes appear in this order: Gold Bricks, Red Bricks, Character Tokens.
- The long Gold Brick and Character Token notes use the existing double-height note presentation.

## Note 1: Gold Bricks

The note starts with `# Gold Bricks`.

### Story-level table

The first section is a 24-row Markdown table grouped into:

- Order of the Phoenix;
- Half-Blood Prince;
- Deathly Hallows – Part 1;
- Deathly Hallows – Part 2.

Each group contains its six official story levels. Columns match the Years 1–4 note:

- `✓` — first completion;
- `TW` — True Wizard;
- `SiP` — Student in Peril;
- `HC` — completed House Crest.

The table therefore tracks 96 Gold Bricks: 24 in each column.

### Remaining sections

After the table, separate Russian-headed checklists track:

- 51 non-level Gold Bricks earned in interludes or found in open-world areas;
- the 36 open-world Students in Peril that count toward the 60-student total, because the other 24 are already represented in the level table;
- 16 Gold Bricks bought in Borgin & Burkes;
- the Gold Brick for LEGO Town.

Only a location is written on each checklist line. When an award is attached to a lesson or interlude rather than a freely collectible object, the entry uses the immediate named game area in which the award is received, not the action, spell, or accomplishment that triggers it. The Borgin & Burkes entries may repeat the same location sixteen times; prices are omitted.

The arithmetic must reconcile exactly:

`96 level-table bricks + 51 open-world/interlude bricks + 36 open-world SiP bricks + 16 shop bricks + 1 bonus-level brick = 200`.

The game's extra, non-counting open-world Student in Peril is excluded because this note tracks the 200 Gold Bricks rather than every optional rescue beyond the counter.

## Note 2: Red Bricks

The note starts with `# Red Bricks` and contains all 24 extras, including the four available from the start.

Each line uses:

`- [ ] Location — **Extra Name**`

The location is either an English hub area or `Already available`. There are no spell requirements, prices, effects, directions, or acquisition descriptions.

## Note 3: Character Tokens

The note starts with `# Character Tokens` and contains all 200 character entries represented by the game's Character Token collection.

Each line uses:

`- [ ] Location — **Character Name**`

Entries are grouped under Russian headings for the four story periods and the open world. Story entries are ordered by level and use only the level title as their location. Open-world entries are grouped in traversal order by named area. Characters available without collection use `Already available` if they are part of the game's 200-entry character list.

No purchase price, unlock requirement, ability, costume explanation, or intra-level direction is included.

## Source and normalization policy

- Use the comprehensive CyricZ GameFAQs walkthrough as the primary enumeration and ordering source.
- Cross-check Red Bricks and Character Tokens against at least one independent complete collectibles guide.
- Reconcile section counts and grand totals independently before editing the library.
- Preserve official capitalization and punctuation in level, extra, and character names where sources agree.
- When sources disagree on a hub label, prefer the name used by the primary guide and the in-game Advanced Guide area grouping.
- Never copy instructional text from a source into the notes.

## Data integration

- Add exactly three new note records whose `gameId` is `ef7ef992-4633-409a-aa55-1092aebfc783`.
- Give every note a new UUID, empty `attachments`, valid positive ranks in the requested display order, and valid ISO timestamps.
- Set `doubleHeight: true` on the Gold Brick and Character Token notes; keep the Red Brick note at normal height unless its final rendered length requires otherwise.
- Preserve all existing games, notes, assets, identifiers, ordering, and metadata outside the new records.
- Keep the work in the current Jujutsu working-copy change and finalize specification, plan, data, and verification evidence as one feature commit, as required by `AGENTS.md`.

## Verification

- Parse `public/data/library.json` successfully.
- Run the repository data validator.
- Run the repository test suite relevant to canonical library data.
- Programmatically assert that the game has exactly three new notes in the intended rank order.
- Programmatically count 24 level rows, 200 Gold Brick checkboxes/cells, 24 Red Brick entries, and 200 Character Token entries.
- Scan the final note bodies for source-only acquisition markers such as spell requirements, prices, guide area numbers, and procedural verbs.
- Inspect `jj status` and `jj diff` before finalizing to ensure the commit contains only this specification, its implementation plan, and the three notes.

## Acceptance criteria

- Opening `LEGO Harry Potter: Years 5-7` shows the three new notes in Gold/Red/Token order.
- Every checklist begins entirely unchecked.
- Every collectible is accounted for at the agreed totals.
- Story-level collectible locations never reveal more than the official level name.
- Open-world entries contain a location and, only where requested, a Red Brick or character name.
- None of the notes tells the player how to obtain a collectible.
