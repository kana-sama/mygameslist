# Xenoblade Chronicles 2 Pouch location hints

## Goal

Replace every spoiler-wrapped favorite type and item in the existing `Pouch` table with the already-supported Markdown hover-hint syntax, so the table stays readable and each value exposes where it can be obtained.

## Content contract

- Modify only the existing `Pouch` note and its `updatedAt` metadata, plus this specification and its implementation plan.
- Preserve the table's five columns, two row groups, row order, names, checkbox states, and favorite text exactly.
- Replace each of the table body's 240 `||text||` spoiler spans with `[text]("description")`; do not alter table headers or group rows.
- Each liked-type description lists the English in-game city names containing a shop for that category, including special one-item and relocated sellers, deduplicated and ordered by normal story progression.
- Each liked-item description lists every English in-game city where that exact item is sold, including temporary or relocated shops when applicable.
- When a favorite item is crafted rather than sold, use the crafting city's name followed by ` (crafted)` instead of inventing a shop sale. This applies to Pyra's Cooking, Gorg's Patissier, Vale's Weaving, and Dahlia's Icecraft favorites.
- Use concise comma-separated descriptions with no URLs, shop names, unlock requirements, region names, or explanatory prose.
- Keep the exact hint syntax `[text]("description")`; ordinary link syntax and application code remain unchanged.

## Location authorities

- Use the current English Xenoblade 2 BDAT shop tables at `https://xenoblade.github.io/xb2/bdat/` as the primary item-to-shop inventory source.
- Use the CyricZ GameFAQs `Pouch Items and Shop Deeds` guide as a readable cross-check for city and shop grouping.
- Use Xenoblade Wiki crafting-station pages for favorite items absent from normal shop inventories.
- Normalize shop regions to these city labels: `Argentum`, `Torigoth`, `Garfont Village`, `Fonsa Myma`, `Alba Cavanich`, `Indol`, `Fonsett Village`, and `Theosoir`.

## Verification

- Verify structurally that the note still contains exactly one five-column table, two group rows, and the same 60 character rows in the same order.
- Verify there are exactly 240 hover hints in the table body and no `||` spoiler delimiters remain.
- Verify every checkbox state and every visible favorite value matches the pre-change note.
- Run the repository's source-data validator; do not add a permanent test or task-specific test file.
