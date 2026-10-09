# Tier-list interaction modes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Worker implements the single coherent mode correction; controller owns docs, browser QA, reviews and JJ finalization. No worker commits or child agents.

**Goal:** Make viewing useful for adding and reading cards, and reserve board reordering for editing.
**Architecture:** Separate board drag capability from add-card availability. Use the existing saved-note wrapper and a small viewing-mode card-dialog owner wired to the existing persistence/pool path through a viewing-mode save callback; keep the existing editor for structural/card edits.
**Tech Stack:** React/TypeScript, existing dnd-kit, shared ImagePicker/Markdown modal, Vitest, native browser QA.
**Spec:** docs/superpowers/specs/2026-10-09-tierlist-interaction-modes-design.md

## Global Constraints

- Ordinary viewing: no grade/card reordering, drag handles/gutters/cursors/descriptions or overlays; click rich tooltip works.
- Saved heading/body framing remains shared; content inset6px, label starts there without reserved anchor gutter. Cards/add cells150x150.
- Add-card square only in ordinary viewing, last in each grade, idle surface absent, dashed plus on grade hover/focus; existing modal with one ImagePicker before one Markdown editor. Full note editor has no add-card control.
- Editor retains grade/card drag, inline name/create/delete and existing-card edit; shared512-square image pipeline/pool unchanged.
- One scoped descendant JJ commit; generic synthetic tests only, no data/dependencies, finalized commits immutable.

## Review Focus

- Viewing drag disabled on keyboard/pointer/touch while tooltip buttons remain usable and correctly described.
- Text/image addition saves to the selected grade, retains unrelated notes/attachments and never opens full editor.
- Failed or pending save/preparation preserves local draft and prevents duplicates; cancel writes nothing.
- Current source/format/grade changes during modal do not overwrite newer content; storage locks respected.
- No plus in editor; existing-card edit and sorting still work; no accidental extra6px/handle gutter in saved view.

## Task 1: Correct board capabilities and ordinary-mode card addition

Files: modify src/components/tierlist/TierListNote.tsx, TierListCard.tsx, TierListEditor.tsx, TierListCardForm.tsx / tierListNote.css only as needed, src/pages/GamePage.tsx; create a small tierlist view/dialog owner if needed. Tests: tests/tierlist-note-modes.test.tsx plus scoped updates to tests/tierlist-note-editor.test.tsx and tierlist-redesign.test.tsx for superseded expectations. Controller owns spec/plan.

Interfaces: consumes existing EditableNote/EditableAttachment, parseTierList/serializeTierList/updateTierListPool, TierListCardForm, existing note-save callback and current source snapshots. Existing consumers retain editor/standalone behavior unless the mode contract requires adaptation. Use a dedicated ordinary-add save callback over persisted notes, preserving unrelated active drafts and provisional grouping; reconcile only the saved target content into a prospective note tree. Return an explicit success result to keep a failed modal open.

- [x] Read the exact references/spec. Trace ordinary onSourceChange => writable => handle gutter and editor-only onAddCard; confirm current cause.
- [x] Write failing actual-GamePage synthetic mode regressions: normal no handles/drag overlay or save on reorder keys, click tooltip, last add square per grade opening shared modal, editor no plus and retained drag/edit; run npm test -- tests/tierlist-note-modes.test.tsx and record red evidence.
- [x] Implement the mode distinction, removing normal-mode anchor gutter and drag semantics. Wire normal add modal through shared card form and pool-aware note saving, with pending/error/cancel/source behavior above. Remove editor add control and adapt old tests to meaningful retained contracts.
- [x] Run focused related tests (mode/editor/board/grade-drag/redesign/card-form/framing/pool). Report exact commands/results and source/source-lock cases. Do not repeat full suite/build; controller owns final checks.
- [x] Supply isolated synthetic actual-GamePage preview using actual app header44px and three neighboring formats plus editor/modal states. No real library storage. Compare reference and final captures at1280x800/390x844 with controller’s geometry/state record; report self-review and concerns.

Controller performs task spec/quality review, final whole-change review, full suite/build, focused repairs if required, temporary preview cleanup, scoped jj status/diff then jj describe and jj new.
