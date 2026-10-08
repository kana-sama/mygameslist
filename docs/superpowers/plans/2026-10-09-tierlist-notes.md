# Tier-list Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The project's AGENTS.md overrides intermediate commits and plan approval: execute now, retain one working-copy feature change, and finalize exactly one commit after verification.

**Goal:** Add visually authored tier-list notes with arbitrary grades, square cards, and persisted card dragging.

**Architecture:** Add `format: tierlist` using the existing note envelope and a versioned JSON body. Use existing image attachments as the asset ownership pool: cards reference their `imageAssetId`, validation requires the corresponding image attachment, and images used by cards are hidden from the ordinary attachment gallery. This preserves existing source asset projection, blob storage, ownership and GC contracts without adding another resource storage system. Keep the pure model, board/dragging, card form, and note integration in focused modules.

**Tech Stack:** TypeScript, React, existing @dnd-kit packages, Vitest/Testing Library, existing image optimizer and note storage.

**Spec:** `docs/superpowers/specs/2026-10-09-tierlist-notes-design.md`

## Global Constraints

- Jujutsu exclusively; no direct git commands, intermediate commits, history rewrites, authored-data changes or new product dependencies.
- One completed feature commit contains specification, plan, implementation and generic permanent tests; controller alone finalizes with `jj describe` then `jj new`.
- Every card and drag preview is 80 × 80 CSS px, independent of type, content, viewport and note width.
- Grades are ordered vertical rows, label left and cards right; cards wrap within their grade. No preset grades, grade colors, arbitrary card sizing or visible image captions.
- Image-with-text content appears only in a tooltip; mouse hover, keyboard focus and touch opening are supported; drag closes it and suppresses subsequent click.
- Dragging works in drafts and saved notes, with one save per successful drop, rollback on error, overlapping-write protection, and isolation from note dragging.
- Markdown/graph behavior, existing text-format switching, file attachments, source paths and authored data stay compatible.
- Permanent tests use synthetic fixtures. UI implementer and reviewer compare the artifact directly with the spec at 1280×800 and 390×844, normal/double-width notes, specified interaction/error states.

## Review Focus

1. Reusing the same uploaded image in multiple cards must retain one valid ownership pool entry; deleting a card cannot orphan another card or delete another note's image.
2. Switching formats with an existing draft must preserve the source in each format and make Cancel restore the original note.
3. Pending image optimization and canceled/unmounted forms must not save partially prepared cards, lose user text or publish late state updates.
4. Wrapped multi-row dragging must resolve actual insertion position and empty grades, including keyboard cross-grade movement and canceled drops.
5. A failed/stale connected save must restore placement, focus and scroll, leave an explicit error, and enable retry.

---

### Task 1: Tier-list model and persistence contracts

**Files:**
- Create `src/domain/tierList.ts`, `tests/tierlist.test.ts`, `tests/tierlist-note-persistence.test.ts`.
- Modify `src/domain/types.ts`, `src/domain/index.ts`, `src/domain/noteContent.ts`, `src/domain/validation.ts`, `src/domain/patch.ts`, `src/domain/patchSelection.ts`, `src/domain/changeReview.ts` as required by existing format dispatch.
- Modify `src/source/metadata.ts`, `src/source/noteDocument.ts`, `src/source/paths.ts` as required by existing format dispatch; existing attachment projection remains the image ownership mechanism.
- Modify `src/state/interactionRescue.ts`, `src/state/libraryStore.ts`, `src/state/LibraryContext.tsx` only where necessary to propagate a new NoteFormat and correctly guard interactive saves.

**Interfaces:**
- Export `TierListDocument = { version: 1; title: string; grades: TierListGrade[] }`.
- Export `TierListGrade = { id: string; name: string; cards: TierListCard[] }`.
- Export a discriminated `TierListCard` union: `{id; type: 'text'; text}`, `{id; type: 'image'; imageAssetId}`, `{id; type: 'image-text'; imageAssetId; text}`; string IDs, text and asset references.
- Export `createTierListDocument(): TierListDocument`, `parseTierList(source: string): TierListDocument`, `serializeTierList(document: TierListDocument): string`, `validateTierList(source: string): string[]`, `tierListImageAssetIds(document: TierListDocument): Set<string>`, `moveTierListCard(document: TierListDocument, cardId: string, gradeId: string, index: number): TierListDocument`.
- Empty body parses as an empty document; serialization is deterministic JSON with two-space indentation. Nonempty JSON requires the explicit version/title/grades fields, rejects unknown keys/versions, globally duplicate IDs, whitespace-only required names/text, and non-SHA256 image IDs. Duplicate display names are legal.
- `moveTierListCard` is pure; index refers to the destination after removing the source card, clamped within the destination; invalid targets and unchanged drops return the original document. Preserve IDs and other values.
- Tier-list notes with images require matching image attachments; their assets must pass existing database-level image validation. UI pending-image attachments become ordinary image attachments through existing saves.

- [x] Write failing pure-model tests for empty/versioned bodies, Unicode/multiline content, all three types, required fields, exact keys, duplicate IDs, legal duplicate names, image references, cross-grade/in-grade moves, empty grades and unchanged/invalid drops.
- [x] Run `npm test -- tests/tierlist.test.ts` and observe feature-related failures before implementing.
- [x] Implement the pure model and integrate NoteFormat/title/content validation/progress (no checklist progress for tier lists).
- [x] Write failing synthetic persistence tests for note source round-trip with images, complete database validation, patch diff/apply/reconcile/selection, text-only source review, rescue/interactive writes, mismatched expected format and old Markdown/graph defaults.
- [x] Run the new persistence tests, implement format propagation and enforce image ownership through the existing attachment pool. Do not create a second asset owner representation.
- [x] Run new tests plus related graph persistence, source, patch, validation and rescue suites; report exact commands, counts, and any unresolved failures. Do not commit.
- [x] Write an implementation report including changed files, interface decisions, red/green evidence and compatibility checks. Controller requests a task review before Task 2.

### Task 2: Visual board, editor and note integration

**Files:**
- Create focused components under `src/components/tierlist/`: `TierListNote.tsx`, `TierListEditor.tsx`, `TierListCardForm.tsx`, `tierListNote.css` (further small helpers only if they separate responsibilities).
- Modify `src/pages/GamePage.tsx` and, if needed, the existing note draft input types. Reuse the Task 1 contracts and current interaction-save path.
- Create `tests/tierlist-note.test.tsx`, `tests/tierlist-note-editor.test.tsx`, add generic fixtures/helpers under tests if needed.
- Create `docs/tierlist-notes.md`; update README with the new note format.

**Interfaces:**
- Board consumes `source: string`, `assets: Record<string, Asset>`, `resolveAssetUrl?: (assetId: string) => string | null`, `disabled?: boolean`, `onSourceChange?: (source: string) => void | Promise<void>`. Own drag state/overlay and tooltip behavior, use Task 1 parser and mover, retain focus/scroll through saves.
- Editor consumes the document and ordinary/pending image pool through GamePage integration. It emits complete atomic draft updates, not saved writes. Image preparation uses existing optimizer/storage/quota checks and reports pending state to the outer editor to block save.
- Grade buttons implement add/rename/up/down/delete, with explicit confirmation for nonempty deletion. Card form implements type/text/image, preview, validation, save/cancel and delete. No Monaco for tier-list format.
- Existing Markdown↔graph switching keeps its current shared-source semantics. A separate tier-list draft is restored on repeated switches; switching to it starts empty unless a saved tier-list body exists. Switching back restores the text-format draft. Outer Cancel restores the saved note.
- Render only attachment images not referenced by current cards in the ordinary gallery. When deleting a last card reference, remove its associated pool entry only if it was a card-owned image in the previous document; preserve unrelated attachments. Shared IDs remain while another card references them.

- [x] Write failing tests for choosing Tierlist, empty board, visual grade/card CRUD, all three variants, validation, pending/error uploads, grade ordering/deletion confirmation, duplicate names and card-form cancellation.
- [x] Run these tests to observe feature-related failures, then implement visual components using existing UI styling and localized labels.
- [x] Implement dnd-kit nested context, 80px square cards/overlay, wrap-aware pointer insertion, empty-grade targeting, custom keyboard cross-grade targeting, touch activation, cancel/outside-drop behavior, tooltip closing/click suppression and visible insertion feedback.
- [x] Write and run interaction tests that exercise actual user events and production drop resolution: cross-grade, within-grade, canceled, boundary positions, one-save count, disabled writes, focus/scroll preservation and rollback/retry. Tests must not merely assert mocked dnd-kit callbacks.
- [x] Integrate draft/save/card/drag-preview paths in GamePage, choose-format footer, ordinary/pending image pool, and initial-file transfer. Guard all Markdown-only search, checklist, width measurement and warnings by format.
- [x] Test distinct format drafts, Cancel, save/reopen, current interaction snapshots, connected expected-format/body guards, image pool retention and unrelated file attachments.
- [x] Run focused new UI suites and related existing note/graph/editor/search/progress tests; fix regressions.
- [x] Compare the running board to the approved spec in a real browser at 1280×800 and 390×844, ordinary/double-width notes: measure all square card types and overlay, verify exact grade/card structure, idle/hover/focus/touch/edit/drag/error states. Use temporary synthetic browser fixtures only; do not author real data.
- [x] Document how users create/edit/drag notes and the JSON/source/image-pool contract. Record browser evidence and focused-test commands in the report. Do not commit.

Browser evidence: exact approved viewport sizes, normal/double widths, focus/click, keyboard-active and editor/error/upload states were checked directly. Documented CUA lacks native touch/hover input; those production sensor/tooltip paths are additionally covered by permanent user-event tests. Implementer and independent reviewers approved the final artifact. After child browser transport became unavailable, the controller captured 24 current UI states and DOM measurements at both approved sizes and widths; both implementer and final reviewer directly compared those captures with the specification. No unresolved visual or structural deviations remain.

### Final verification and commit (controller)

- [x] Request independent spec and quality review of Task 2, followed by whole-feature review; delegate fixes to the corresponding implementer. Reviewer also compares running UI directly with the spec at both approved viewport sizes.
- [x] Run `npm test`, `npm run data:validate`, and `npm run build`; resolve required failures and rerun only affected verification after further fixes.
- [x] Remove temporary browser/data verifiers and fixtures, retain only generic permanent code tests. Verify no authored data or unrelated paths changed.
- [x] Inspect `jj status` and `jj diff` for the complete feature. Finalize exactly one scoped commit via `jj describe -m 'Add visual tier-list notes'`, then `jj new`. Do not amend or rewrite any existing commit.
- [x] Report the result, commit identity, verification and any actual remaining limitations concisely.

Final verification: `npm test` — 116 files, 2334 passed, 22 existing skipped; `npm run data:validate` and `npm run build` exited 0. Authored data unchanged. Both task gates and the final scoped fix review passed. Final review fixes preserve the latest authoritative source through asynchronous save settlement and keep add/rename grade modes separate from arbitrary valid IDs.
