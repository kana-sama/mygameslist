# Tier-list note framing parity implementation plan

> Use subagent-driven development; workers do not commit or spawn agents.

**Goal:** Use the same saved-note heading and content framing for tier lists as graph/Markdown.
**Architecture:** Correct the missing integration in ScrollableNoteCard using its existing shared heading/container path; narrowly adapt TierListNote title rendering if needed to avoid duplicate accessible headings. Preserve standalone component/editor behavior.
**Tech stack:** React, TypeScript, existing CSS, Vitest and native browser verification.
**Spec:** docs/superpowers/specs/2026-10-09-tierlist-note-framing-design.md

## Global constraints

JJ exclusively, existing commits immutable. One scoped final commit. Shared6px insets and heading typography/hierarchy; 150x150 cards; no double padding or data/dependency changes. Exact references and visual states are in the spec. Controller owns final commit and temporary preview cleanup.

## Review focus

- Equal titles in all formats must share computed typography and accessible heading count.
- Empty/invalid tier-list sources must not create a phantom header.
- Long titles wrap at narrow width with equal insets and no overflow.
- Standalone/editor embedding must not acquire doubled padding or duplicate titles.
- Sticky note headings must keep tier-list grade/card controls accessible during scroll.

## Task 1: Shared note-card framing integration

Files: src/pages/GamePage.tsx, src/components/tierlist/TierListNote.tsx and tierListNote.css only as needed; related tests/tierlist-note-editor.test.tsx and/or a synthetic note-framing integration test. No unrelated refactoring.

- [x] Read the exact screenshot and shared graph/Markdown note-card implementation/CSS. Confirm oversized standalone tier-list title and missing inset-bearing wrapper as the cause.
- [x] Add minimal failing synthetic actual-GamePage regressions for heading slots/accessibility and shared content wrapper, including empty/long title and preserved standalone/editor behavior. Do not write tests that mirror CSS declarations; measure geometry in temporary browser QA.
- [x] Connect tier-list title/body to the existing shared note-card path. Keep heading duplicates hidden/inert, board150square and error handling unchanged.
- [x] Run focused tier-list note/editor/drag and relevant heading integration tests. Create a temporary actual-GamePage comparison preview with synthetic data, inspect user screenshot and final screenshots at both widths, record actual measurements and control/scroll states.
- [x] Report exact changed paths, failing/passing commands/results, reference comparison and any concern. No history writes or child agents.

Controller dispatches task review, then final whole-change review, verifies full tests/build, cleans this task’s scratch folder, checks JJ scope and finalizes with jj describe then jj new.
