# Stacked side metadata implementation plan

Spec: ../specs/2026-10-22-game-metadata-stacked-design.md

- [x] Inspect third reference and default metadata/short-mode markup.
- [x] Implementer: conditional meta-short only for top, generic regression
  and existing acceptance update; active design contract.
- [x] Browser side/top geometry and editing/focus, direct visual comparisons.
- [x] Scoped review; focused tests and build, remove temporary fixture.
- [x] jj status/diff; finalize one commit and jj new, preserving prior commit.

## Verification

- New mode-switch regression failed before fix (side expected0short, received2).
  After fix,7focused metadata/editing/layout acceptance tests and5existing
  sidebar-layout-css checks passed. Production build passed.
- Browser at1280×864: side has0compact blocks, four220px full-width blocks
  with dt above dd; status andtier separated vertically, wishlist fits one line.
  Focused status select remains full-width with accent border; Escape cancels.
- At390×844 side has0compact blocks, four268px metadata blocks within panel;
  top remains2compact blocks paired, correct preceding-commit separators.
- Implementer and independent reviewer directly compared all supplied refs
  with final desktop/mobile screenshots; both approved no structural mismatch.
- Temporary fixture removed. No CSS, authored data, or persistence changes.
