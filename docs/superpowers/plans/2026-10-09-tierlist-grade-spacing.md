# Compact tier-list grade label spacing implementation plan

> Execute through superpowers:subagent-driven-development. One task; controller owns spec/plan/browser/reviews/history. Worker has no children or commits.

Spec: docs/superpowers/specs/2026-10-09-tierlist-grade-spacing-design.md

## Global constraints

Replace the fixed grade-label column with a compact content-sized column: for short S/A/B labels, the first150x150 card starts8px after the shared label-column boundary, with no unused56–100px label slot. Align first cards across grades in one board using the width needed by its labels; cap/wrap long labels without hiding text or shrinking150-square cards. Preserve the existing6px saved-note outer inset, grade/card order, card gap8px, controls, hover/focus/editing/drag behavior and all decoration. Inline grade names and drag handles must remain usable in the editor. Only change tierlist CSS; no TS product files/dependencies/authored data. No permanent CSS-string or infrastructure tests; browser geometry verification is the relevant temporary test.

## Task1

Ownership: src/components/tierlist/tierListNote.css only; scratch preview/report under this task folder

- [x] Inspect reference and board/editor styles. Prepare isolated real TierListNote/TierListEditor preview with S/A/B labels and a long-label variant, existing styles, no real storage.
- [x] Make the smallest CSS layout correction; preserve shared card starts, cap/wrap long labels and usable editor controls. No product TS edits or permanent tests that mirror CSS.
- [x] Controller measures label-column/card gap8px, cards150x150 and mobile overflow at1280x800/390x844 in idle/hover/focus/editor and long-label states. Worker directly compares captures/reference and reports freeze.

Controller: independent task Spec/Quality review, final integrated whole-change review, final fullsuite/build on frozen combined tree, scope each feature into its own descendant JJcommit with jjdescribe/jjnew while preserving the other task's tree, remove only owned task scratch previews. Separate scopes share no edited files; controller owns integration.

## Verification

Native browser geometry at 1280×800 and 390×844 confirmed a shared compact label column with 8px gap, aligned 150×150 cards and no horizontal overflow. Long names wrap within the 100px cap. Inline naming, empty-name validation, hover/focus controls and native keyboard grade reordering remain usable. Implementer and independent reviewer directly compared the final states with the supplied reference; no product findings.

Combined frozen-tree validation: 122 test files passed; 2455 tests passed, 22 skipped. Type-check/build passed. No permanent CSS-string or authored-data tests were added.
