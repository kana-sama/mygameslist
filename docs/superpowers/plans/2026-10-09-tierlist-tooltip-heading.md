# Tier-list tooltip heading implementation plan

> Worker execution: superpowers:subagent-driven-development. One task; controller owns docs, browser QA, review and JJ finalization.

Spec: docs/superpowers/specs/2026-10-09-tierlist-tooltip-heading-design.md

## Constraints

Only the tier-list tooltip display omits its title heading; saved/editor source and all other content/callers remain unchanged. Use the same heading parsing semantics as tierListCardTitle, preserving escaped/code content, preceding text and later headings. Reuse shared tooltip rendering/registry/styles. No authored-data edits/tests or dependencies. Preserve one header, one existing tooltip body/list hierarchy, close/arrow/layout/focus interactions; no added styling. Exact reference path is in the spec.

## Task 1

Implementation files: src/components/tierlist/TierListCard.tsx, Markdown.tsx, MarkdownRichTooltip.tsx, markdownRichTooltipContext.ts and focused synthetic tier-list tooltip/editor tests. An optional source-offset display omission passes unchanged Markdown through the shared renderer; suppress only the selected parsed heading node and keep all other callers unchanged by default. Preserve original block boundaries rather than deleting source and reparsing.

- [x] Inspect reference, existing title parser/source locations and rich tooltip registry/rendering. Write failing real-renderer regression for a title heading plus description/list; record expected red failure.
- [x] Implement minimal parser-aware display projection and wire tier-list card tooltip only. Verify preserved preceding/later content, headingless/escaped/code content, nested registry, surrounding paragraph/list boundaries, definition-list offsets, default-renderer memo updates and editor source with meaningful generic tests.
- [x] Run focused card/tooltip/tierlist regressions once; report exact red/green commands/results and freeze product. Controller owns final full suite/build.
- [x] Prepare isolated temporary real-component/style preview in this task workspace with generic synthetic card Markdown, no live storage. Inspect reference and final desktop/mobile active captures supplied by controller; report direct visual comparison.

Controller: task Spec/Quality review; final whole-change review on most capable model; final full suite/build and native browser proof at1280x800/390x844; scoped repairs only if needed; remove this workspace, inspect jj status/diff, jj describe then jj new. Finalized history immutable.
