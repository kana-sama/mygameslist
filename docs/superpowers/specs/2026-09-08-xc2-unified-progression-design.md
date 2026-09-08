# Xenoblade Chronicles 2 unified progression notes

Status: Approved in conversation, with Driver skills explicitly excluded.

## Contract

Treat the original game and its additional playthrough content as one completion journey. Delete `new-game_60667614-8aa3-44c1-877c-a319b3757ee9.md` after integrating its relevant content. Do not create mode-specific headings, labels, warnings, or separate notes. Driver affinity skills (all 90 entries, including Shining Justice) are explicitly out of scope and must not become checklist entries.

The normative presentation reference is the current contents of `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/notes/`, especially Blades, Heart-to-Hearts, Nopons, Merc Missions, and Challenge. The 2026-08-12 checklist design is historical context; this approved change supersedes its NG+ isolation requirements. Preserve current syntax and structure, including Heart-to-Hearts regional headings and `[Name][?]` checklist entries with rich tooltip definitions, inline Blade acquisition tooltips, checkbox states, metadata/layout settings, and all existing authored text. No UI behavior or viewport changes are requested.

## Integration

- Move Akhos, Patroka, Obrona, Sever, Perdido, Cressidus into Random Core Crystal Blades, and Mikhail into Special Blades; retain each existing status and provide Mikhail's acquisition location in the existing tooltip syntax. Remove only the old mode-specific heading. Preserve every other Blade entry verbatim, with relative order unchanged.
- Add Muscle Power and Lone Wolf to Gormott, Jack of All Trades and The Literary Life to Uraya, A Thespian's Life to Mor Ardain, Patroka's Predilections and Free as a Bird to Leftheria. Preserve all existing scene entries and tooltip definitions verbatim. Match the existing tooltip fields; research availability and answer rewards rather than inventing them.
- Append Traveling Bards to Nopons with all twelve original trades, costs, locations, and directions preserved. Explain level reduction at inns and spending Bonus EXP here.
- Integrate the story-Blade dispatch mechanic into Merc Missions. Integrate the specific additional Level 4 Special into Blades after verifying its identity. Include any verified missing mode-specific content in its matching existing category (for example early Challenge access).
- Do not transfer reset/carry-over warnings, which contradict the explicitly requested unified completion view. Do not alter existing non-mode-specific data or personal notes.

## Completeness and preservation

Use Nintendo's original patch announcement and patch history, Xenoblade Wiki's New Game Plus / individual scene pages, and an independent Traveling Bards guide to audit additions. Check every existing note category for missing applicable content; no speculative entries. Document source evidence and disposition in the plan.

Use a temporary baseline snapshot outside the repository and a temporary verifier. Assert unchanged existing notes byte-for-byte except permitted destination notes; unchanged old entries, statuses, tooltip definitions and section order in destination notes; exactly seven unique moved Blades, seven added scenes, twelve preserved Bard trades; deleted source note; no NG+ labels or Driver skill checklist. Validate note syntax and production assembly with `npm run data:validate` and `npm run build`. Review the whole diff independently. No permanent database-specific tests or application-code changes. Finalize specification, plan, and content in exactly one Jujutsu commit, followed by `jj new`.
