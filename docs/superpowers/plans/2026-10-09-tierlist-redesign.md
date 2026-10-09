# Tier-list redesign implementation plan

Approved requirements: `docs/superpowers/specs/2026-10-09-tierlist-redesign-design.md`.

## Global constraints

Use JJ exclusively; no commits by workers. One final descendant commit containing this specification, plan, implementation and synthetic permanent tests. Existing commits are immutable. Shared image picker and cover optimizer, shared Markdown editor and rich tooltip, inline grade names, grade drag ordering and 150-square cards are mandatory. Reference paths and state/viewport verification are in the specification. Do not touch authored data or unrelated changes.

## Task 1: Integrate the redesign and compatibility as one coherent feature

1. Inspect the normative components/specifications/tests before changes. Add failing synthetic tests for new stable behavior and preserve prior persistence/ownership/concurrency regressions.
2. Introduce strict unified v2 parsing/serialization, escaped legacy text conversion and compatible asset ownership helpers. Update integration fixtures to test both versions.
3. Replace the old card form with a portalled modal using shared ImagePicker cover mode and shared Markdown editor. Update GamePage's quota/prepared-attachment adapter without duplicating image optimization. Keep cancellation, processing, focus, errors and object URL cleanup correct.
4. Update card faces to 150 squares and click-driven shared rich Markdown tooltips. Preserve drag activation/click suppression and introduce quiet local edit controls.
5. Add grade drag ordering with isolated activators and the existing sensor patterns; implement grade-local inline name creation/rename and hover/focus-revealed square add cells. Preserve existing card sorting, persistence and latest-source behavior.
6. Update user documentation and mark old design sizing/interaction sections superseded. Run focused code tests/type-check. Create an ignored isolated preview with synthetic data; compare directly with the normative references in all required states and viewports and record evidence in the report. No browser interaction with the real library.
7. Self-review and report paths, focused checks, visual evidence and limitations. No child agents or repository commits.

Controller runs a task review, resolves findings through the implementer, runs final full verification, requests one broad final review, removes task-specific temporary preview/workspace files, inspects JJ status/diff and finalizes with `jj describe` then `jj new`.
