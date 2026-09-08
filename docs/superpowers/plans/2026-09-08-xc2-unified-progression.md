# XC2 Unified Progression Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute this single content task without intermediate commits.

**Goal:** Integrate all applicable additional-playthrough content into existing notes without mode labels or Driver skill checklists.

**Architecture:** Markdown-only migration into existing categories. Preserve the baseline as the authority for existing content and formatting; use external sources solely for missing factual details.

**Tech Stack:** Markdown note envelopes, temporary Python/Node verification, existing data validator and production builder, Jujutsu.

**Spec:** docs/superpowers/specs/2026-09-08-xc2-unified-progression-design.md

## Global Constraints

- Preserve old authored entries, checkbox states, tooltip definitions, layout metadata and relative ordering.
- No Driver skills, new notes, NG+ labels, permanent data-specific tests, or application-code changes.
- Only the current feature's final commit; use jj exclusively.

### Task 1: Integrate and verify the completion content

**Files:** Under `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/`, modify `blades_9c24c87a-736c-48cc-9352-502f0ea8b655.md`, `heart-to-hearts_350c7613-46a6-46ca-8ee0-5457d56f1047.md`, `nopons_65b5f842-01d9-4044-a1da-4eac1eb78f98.md`, `merc-missions_7cca4283-8332-469d-9b3d-e2ee11539b92.md`, and (if missing early portal access) `challenge_96e435c8-cee0-4569-ab4b-8be5c5758643.md`; delete `new-game_60667614-8aa3-44c1-877c-a319b3757ee9.md`.

**Inputs:** Approved spec, current destination note structures, baseline `/tmp/xc2-unified-notes-20260908/baseline`, researched source evidence.
**Outputs:** Integrated notes and temporary preservation verification; report `/tmp/xc2-unified-notes-20260908/implementation-report.md`.

- [x] Read the spec and all source/destination notes; inventory the original content and formatting.
- [x] Verify seven Blade acquisition methods, seven scenes including tooltip fields, twelve Bard trades, and remaining mechanics. Record sources and disposition; keep Driver skills excluded.
- [x] Move the seven Blade entries without changing statuses or other entries. Add the seven unchecked scenes under matching regions with matching rich tooltip definitions. Append twelve original Bard trades to Nopons, explain Bonus EXP, and integrate remaining verified mechanics. Remove source note after all relevant content has a destination.
- [x] Run temporary preservation checks against the baseline: existing entries/statuses and tooltip bodies unchanged, untouched files identical, source deleted, seven unique Blades correctly grouped, seven additional scenes, twelve identical Bard trade lines, no mode labels or Driver skills. Verify new tooltip references resolve and region structure is preserved.
- [x] Run `npm run data:validate` and `npm run build`; report outcomes. Compare source Markdown structure directly with the baseline and approved spec; no visual states or viewport changes are introduced.
- [x] Independent reviewer audits the whole diff, source completeness, preservation verification and structure. Resolve findings, remove temporary verifiers from repository if any, then coordinator inspects `jj status`/`jj diff` and finalizes with `jj describe` and `jj new`.

## Source audit and verification results

Execution results follow below.

### Coverage audit

- [Nintendo original announcement](https://www.nintendo.com/en-gb/News/2018/February/Monolith-Soft-s-Tetsuya-Takahashi-reveals-new-Xenoblade-Chronicles-2-update-information-1338196.html) and [Nintendo patch history](https://en-americas-support.nintendo.com/app/answers/detail/a_id/28012) identify the added recruitment, dispatch, level reduction, Bard trades, Special and Driver skills. Skills are explicitly excluded; the remaining mechanics have destination notes.
- [New Game Plus overview](https://xenoblade.fandom.com/wiki/New_Game_Plus_(XC2)) additionally identifies the early Argentum Challenge portal, included in Challenge. Ordinary quests, Merc Missions, Unique Monsters, Secret Areas and Store Deeds are not new mode-specific record sets; preserve their existing content. Carry-over, reset behavior and level-adjusted chapter-ten bosses are playthrough mechanics, not additional completion entries.
- [Neoseeker Bard inventory](https://www.neoseeker.com/xenoblade-chronicles-2/Collectibles/Traveling_Bards) confirms all twelve trade locations/items. [Wiki Bard inventory](https://xenoblade.fandom.com/wiki/Traveling_Bard) confirms quantities, prices and access directions, including all six Master Mods added after the original update. No trade was missing from the old note.
- [Infinity Blade](https://xenoblade.fandom.com/wiki/Infinity_Blade_(XC2)) identifies the specific Pneuma Level IV Special; replace the old vague source-note description with this concrete fact in Blades.
- [Momoni](https://xenoblade.fandom.com/wiki/Momoni) and Nintendo v1.3.1 notes identify an omitted helper in Argentum Bazaar, beside Max, during Big Job Preparations. Add ordinary explanatory prose to Nopons; do not invent a quest or repeatable objective.
- Earlier availability of existing Challenge outfits and Massive Melee Mythra does not create additional mode-exclusive checklist records. Existing non-mode-exclusive content and statuses remain untouched. T-elos is already present with the cleared-story acquisition hint and is not exclusive to an additional playthrough.
- The [original checklist database](https://xc2-checklist.firebaseapp.com/json/database.json) was downloaded to temporary storage and recursively inspected: exactly seven Blade records have `source: New Game Plus`, and exactly seven Heart-to-Heart records have `notes: New Game+`. No additional quest, Merc Mission, monster, area or shop record is marked exclusive. The only other textual mentions are the existing Tora's Tribe and Quantum Technochampion π quest prerequisites, already preserved in the destination note.

### Verification results

- Temporary migration verifier passed: old content preserved in sequence, all moved Blade states retained, all twelve trade lines copied exactly, untouched notes byte-identical.
- Actual application tooltip parser passed: 66 existing tooltip bodies byte-identical, 73 valid linked definitions, seven source-database additions in correct regional sections.
- Additional structural verification passed: exactly the authorized note deleted, no new note files, all note envelope metadata/assets/game.yaml unchanged, all 90 excluded Driver skill checklist entries absent, and the one Challenge table including every cell byte-identical.
- `npm run data:validate` passed: 325 games, 235 notes, 400 assets, 405 occurrences.
- Implementer ran `npm run build` successfully; only the standard advisory for chunks over 500 kB appeared.
- Seven new scene tooltip facts and reward information were checked against their individual Wiki pages: [Muscle Power](https://xenoblade.fandom.com/wiki/Muscle_Power), [Lone Wolf](https://xenoblade.fandom.com/wiki/Lone_Wolf), [Class of His Own / Jack of All Trades](https://xenoblade.fandom.com/wiki/Class_of_His_Own), [The Literary Life](https://xenoblade.fandom.com/wiki/The_Literary_Life), [A Thespian's Life](https://xenoblade.fandom.com/wiki/A_Thespian%27s_Life), [Patroka's Predilections](https://xenoblade.fandom.com/wiki/Patroka%27s_Predilections), and [Free as a Bird](https://xenoblade.fandom.com/wiki/Free_as_a_Bird). Where Muscle Power's source leaves Cressidus's Trust amount unknown, the tooltip explicitly preserves that uncertainty rather than inventing a number.
- Independent whole-feature review passed specification compliance and content quality. Its sole factual wording finding was corrected: Muscle Power transports the group to Clear Sky Beak. Preservation and tooltip checks passed again after correction; no unresolved findings.
