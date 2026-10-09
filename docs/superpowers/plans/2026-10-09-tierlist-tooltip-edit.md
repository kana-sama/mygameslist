# Edit tier-list cards from their tooltip implementation plan

> Execute through superpowers:subagent-driven-development. One task; controller owns spec/plan/browser/reviews/history. Worker has no children or commits.

Spec: docs/superpowers/specs/2026-10-09-tierlist-tooltip-edit-design.md

## Global constraints

A saved tier-list card tooltip has an accessible edit icon button in its existing header, beside the established close action. Clicking it closes the tooltip and opens exactly one existing TierListCardForm prefilled with that card image and original Markdown, without opening the full note editor. Save updates that same stable card ID in place and uses the existing full-note/pool persistence; card and grade order, unrelated notes, active unrelated drafts/prepared attachments and provisional grouping survive. Reuse image/Markdown form, ownership/dedup/quota/URL lifecycle, pending duplicate/close prevention, cancel-without-save, failure retaining draft/retry, storage locks, current-source/format/card guards. The same header action in full note editing opens the existing local card editor flow; preserve current card edit controls there. Keep ordinary view free of drag handles/listeners and card-corner edit controls; add controls remain view-only. Shared tooltips without edit capability retain their existing structure; nested tooltip requests do not inherit the parent card edit action. Title deduplication and original block/source structure remain intact. No data/dependencies/global unrelated UI changes. Existing modal may reuse its deletion action only if wired with the same safe persistence contract; no new confirmation or extra feature UI.

## Task1

Ownership: src/components/tierlist/TierListView.tsx, TierListCard.tsx, TierListNote.tsx, shared markdownRichTooltipContext.ts/MarkdownRichTooltip.tsx, src/styles.css and card form only if needed; tests/tierlist-tooltip-edit.test.tsx plus focused necessary adaptations. Do NOT edit tierListNote.css (owned by spacing worker).

- [x] Trace existing tooltip request/header, card edit callback, modal and viewing save/pool path; write meaningful failing synthetic actual-GamePage tests for header edit→prefilled modal without full editor, same-card save and cancel.
- [x] Implement scoped optional tooltip edit capability and saved-view edit owner. Keep original source/current source and stable IDs; protect storage/pending/stale target, failure/retry and unrelated drafts. Do not expose ordinary card-corner edit controls or restore board dragging.
- [x] Run focused meaningful tierlist/modal/tooltip/persistence tests once and record red/green/freeze; controller owns full suite/build. Include default/nested tooltips, locks and current-source target changes where the new path affects them.
- [x] Prepare isolated actual-GamePage preview with S/A/B and a populated Markdown/image card, shared header/styles, in-memory saves only; controller captures tooltip edit hover/focus, prefilled modal, cancel/save/editor/mobile/failure as applicable. Worker directly compares captures/reference and current modal spec.

Controller: independent task Spec/Quality review, final integrated whole-change review, final fullsuite/build on frozen combined tree, scope each feature into its own descendant JJcommit with jjdescribe/jjnew while preserving the other task's tree, remove only owned task scratch previews. Separate scopes share no edited files; controller owns integration.

## Verification

Generic actual-GamePage integration coverage verifies header edit placement and one prefilled modal, cancel, stable-ID/current-source saves, shared image ownership and replacement preview lifecycle, failure/retry and pending locks, dynamic storage locking, stale targets/formats, local full-note editing, nested/default tooltip isolation and preservation of unrelated prepared-image/new-note drafts and provisional groups.

Native browser verification at 1280×800 and 390×844 covered tooltip idle/hover/focus, prefilled modal, cancel/save, nested tooltip, full-note local flow, save failure/retry and pending state. The existing image picker precedes the complete original Markdown. Implementer directly compared all final captures with the supplied references and existing modal specifications.

Combined frozen-tree validation: 122 test files passed; 2455 tests passed, 22 skipped. Type-check/build passed.
