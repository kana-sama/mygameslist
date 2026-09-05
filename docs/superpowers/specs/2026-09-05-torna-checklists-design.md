# Torna checklist notes

## Scope

Implement the user's seven-category content specification in the existing Torna game, using the current Xenoblade Chronicles 2 notes as the presentation reference. This is an authored-data feature; application behavior is unchanged.

Target: `data/games/xenoblade-chronicles-2-torna-the-golden-country_b7f7c8da-59f5-48f9-b77d-dec9ee377f66/notes/`.

Create exactly seven notes, in this order:

1. **Quests** — all 52 regular Torna quests, including every quest in connected chains, with dependencies stated in annotations. A checkbox means completion. Main-story quests and separate story/quest-boss lists are outside this side-quest category.
2. **Community** — all 89 named supporters. A checkbox means joining as a supporter, not merely meeting the NPC. State the actual joining condition and any subsequent conversation; distinguish story, Community-level and quest prerequisites.
3. **Unique Monsters** — the 16 regular unique monsters, once each, grouped by region and ordered by level within a region.
4. **Golden Monsters** — the four superbosses, ordered by level, distinct from the regular 16. Include the seal/slate unlock conditions and monster locations.
5. **Barney Stones** — the four trials. Completion means clearing all three waves, not finding or activating the stone. Include tutorial-quest and field-skill gates where relevant.
6. **Secret Areas** — the four Secret Areas in Torna and its version of Gormott, grouped by area. Landmarks, Locations, chests and collection points are outside this category.
7. **Affinity Charts** — six flat unchecked items: Jin, Haze, Mythra, Minoth, Brighid, Aegaeon. Each means completing that Blade's entire chart. No annotations or individual nodes.

## Presentation contract

- English note titles, canonical names and geographical headings; concise Russian directions and explanations.
- Markdown checklists, with all new items unchecked. No tables. Preserve the current XC2 grouping/checklist idiom; quest children represent real dependencies, never invented containers.
- Every entry except Affinity Charts uses `[Name][?]` and one terminal `[?Name]:` definition with four-space-indented content. Each definition contains a specific location, relevant availability/completion requirements, and a clickable wiki source. Monster levels also remain visible beside the name as `(lvl N)`.
- Use short definition-list fields such as `Адрес`, `Требования`, `Завершение`, `Вики`. Avoid lengthy walkthroughs and story spoilers beyond prerequisites necessary to find/unlock an entry.
- Long notes use `doubleHeight: true`. Use the canonical `mygameslist-note:v1` envelope, unique UUIDs, sequential positive ranks, one checklist group, and fresh ISO timestamps. Do not copy checked state or collapsed-section metadata from XC2.
- Leave the base-game notes, Torna `game.yaml`, application code and assets unchanged.

## References and factual evidence

Presentation references:

- `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/quests_b799c929-ef7f-4afb-accc-238a29fe44d6.md`
- `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/unique-monsters_f85b6c11-f686-4569-941e-b776e514e768.md`
- `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/secret-areas_43f5bd37-39b0-4f3f-b612-a0d791222d2a.md`
- `docs/superpowers/specs/2026-08-12-xenoblade-chronicles-2-checklists-design.md`
- `docs/superpowers/specs/2026-08-30-markdown-rich-tooltips-design.md`

User references: [Community](https://xenoblade.fandom.com/wiki/Community_%28TTGC%29), [monster list](https://www.nintendolife.com/news/2018/09/guide_xenoblade_chronicles_2_torna_the_golden_country_combat_explained_barney_stones_slate_pieces_and_unique_monsters_locations), [Barney Stones](https://xenoblade.fandom.com/wiki/Barney_Stone).

Use Xeno Series Wiki index and individual articles as accessible corroboration and to correct obvious spelling mistakes in the Nintendo Life list. Verify exact set membership, NPC locations and requirements from the relevant individual pages. Paraphrase source prose into Russian. Record any unresolved factual gap rather than inventing a condition.

The individual articles flag incomplete prerequisite information for Community Spirit and What Goes Around. Their annotations must identify that limitation alongside the confirmed conditions.

## Validation and delivery

- Temporary verification checks exactly seven notes in the required order; all 175 checklist items unchecked; 52 Quests, 89 Community, 16 ordinary monsters, 4 Golden Monsters, 4 Barney Stones, 4 Secret Areas and 6 complete charts; source-based exact membership; no duplicates and no tables.
- Use the application's rich-tooltip parser and checklist index to ensure every non-chart entry has one resolvable annotation, no orphan/duplicate definitions, and every annotation has a wiki link and category-relevant directions/requirements.
- Run source-tree validation, relevant existing parser/index tests, and production build. Do not commit content-specific tests or scripts.
- Implementer and independent reviewer compare the notes directly with XC2 references and this specification. Inspect representative long/short annotations and checklist grouping in the rendered app at desktop 1440×900 and mobile 390×844; inherited tooltip behavior remains governed by the existing tooltip specification. No new visual design or interaction state is introduced.
- The user explicitly requested this scope correction in the same change, authorizing a targeted Jujutsu rewrite by the parent agent. Inspect `jj status` and `jj diff`, then finalize one commit containing this specification, the implementation plan and seven notes using `jj describe` followed by `jj new`. No intermediate commits or unrelated history rewriting.
