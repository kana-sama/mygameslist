# Torna Checklists Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the authored-content task. Repository AGENTS.md overrides generic Git, intermediate-commit and permanent-content-test instructions.

**Goal:** Add the seven requested completion checklists to the existing Torna game, with the sixth category limited to Secret Areas.

**Architecture:** Seven Markdown notes use the current note envelope, checklist parser and rich annotation definitions. This is data authoring only; no application or schema changes.

**Tech Stack:** Markdown, YAML note metadata, TypeScript source validation and generic Vitest tests, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-09-05-torna-checklists-design.md`

## Global Constraints

- Exactly seven notes in order: Quests, Community, Unique Monsters, Golden Monsters, Barney Stones, Secret Areas, Affinity Charts.
- English names/headings and concise Russian explanations. All new checklist items unchecked. No tables.
- Each non-chart item has a rich annotation with location, relevant requirements and a wiki link. Affinity Charts has six unannotated whole-chart items.
- Keep base XC2 data, Torna metadata/assets and application code unchanged.
- Only Jujutsu repository commands. One final commit for the complete feature. No permanent content-specific tests or temporary research files in the commit.

### Task 1: Research, author and verify the seven notes

**Files:**
- Create seven `<category>_<uuid>.md` documents under `data/games/xenoblade-chronicles-2-torna-the-golden-country_b7f7c8da-59f5-48f9-b77d-dec9ee377f66/notes/`.
- Read the exact XC2 reference paths and tooltip specification from the feature spec.
- Temporary research and verifiers live under `/private/tmp/torna-checklists/` and never become repository tests.

**Interfaces:**
- Consume external source facts, the source note format, `parseMarkdownRichTooltips`, `auditMarkdownRichTooltipLinks`, and `buildChecklistSearchIndex`.
- Produce seven independently valid note documents whose ranks preserve the category order and whose indexed checklist entries each expose the required annotation.

- [x] Gather source inventories for regular quests, 89 supporters, 20 monsters, four trials and the four Secret Areas. Read individual pages for exact prerequisites and locations. Independent research helpers may prepare temporary evidence; one implementation subagent integrates repository notes.
- [x] Author the checklist bodies and Russian rich definitions. Preserve real quest-chain dependencies; group long lists geographically without tiny invented sections. Keep all six whole-chart entries plain.
- [x] Compare authored notes directly against the current XC2 reference files and the feature specification. Verify exact source membership as well as counts; distinguish Community support from acquaintance and ordinary monsters from Golden Monsters.
- [x] Run temporary structural verification through application parsers/indexes. Assert metadata, seven note titles/order, empty progress, exact item sets, links, annotation coverage, zero parser errors/orphans/duplicates, zero tables, and category totals. Remove every task-specific repository verifier if one was needed.
- [x] Run `npm run data:validate`, existing focused tests for source note documents, Markdown rich tooltips/inline annotations and checklist search, then `npm run build`. Inspect their exit codes and output.
- [x] Inspect representative rendered notes and annotations alongside XC2 at desktop 1440×900 and mobile 390×844. Record actual evidence and any limits.
- [x] Obtain independent spec/content review of all seven notes, including direct reference comparison and source cross-checks. Resolve findings within the current change.
- Finalization after the completed checks: the user's explicit request to incorporate the Secret Areas correction into the same change authorizes the parent agent's targeted Jujutsu rewrite. Inspect `jj status` and the entire task diff, then incorporate only this correction with `jj squash --into tywxupruyqzy --keep-emptied --use-destination-message`. Preserve the original change ID and the existing empty working-copy change; verify the working copy is empty.

## Verification record

- Seven notes now contain 175 unchecked items and 169 valid annotations. Exact counts: Quests 52; Community 89; ordinary monsters 16; golden monsters 4; Barney Stones 4; Secret Areas 4; Affinity Charts 6.
- Temporary content verification for the narrowed scope passed through note parsing, rich-tooltip parsing/link auditing and checklist indexing. Source inventories matched exactly; no duplicate entries, unresolved annotations, tables or content-specific repository tests remain.
- Fresh `npm run data:validate` and `npm run build` passed for the narrowed source tree after renaming the note to the canonical title-derived `secret-areas_<uuid>.md` filename. The earlier four focused test files (131 tests) passed before this correction and remain historical evidence; this content-only removal uses focused temporary validation instead of rerunning unchanged code tests.
- Implementer and independent reviewer compared XC2 and Torna directly at 1440×900 and 390×844. Short and long annotations are readable; the long desktop dialog scrolls through its wiki link, and the mobile dialog fits the viewport.
- Independent content/spec review and the separate review of all 52 quest infoboxes passed after corrections. The annotations explicitly retain source uncertainty for Community Spirit and What Goes Around.
- Review evidence, screenshots and temporary verification scripts are outside the repository under `/private/tmp/torna-checklists/`. The final change contains only the seven notes, specification and this plan.
