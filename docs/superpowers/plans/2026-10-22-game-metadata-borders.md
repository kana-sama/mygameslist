# Game metadata borders implementation plan

Spec: ../specs/2026-10-22-game-metadata-borders-design.md

- [x] Inspect both reference screenshots and existing metadata/top-mode cascade.
- [x] Implementation subagent: narrow top-mode CSS, update active design contract.
- [x] Browser computed borders and direct reference comparison; scoped review.
- [x] Focused layout check/build, jj status/diff, finalize one immutable commit.

## Verification

- Real GamePage at 1280×864 and390×844: top-mode dlborder0; four block
  bottom borders1/1/1/0; status/tier share row; panelbottom1. Sidebaseline
  unchanged (dlborder1, allfourblockbottom1).
- Implementer and reviewer directly compared desired/defect references with
  final desktop output; both approved exact border/structure preservation.
- Existing sidebar-layout-css checks passed (5 tests); production build passed.
- No authored data, markup, state or permanent test changes.
