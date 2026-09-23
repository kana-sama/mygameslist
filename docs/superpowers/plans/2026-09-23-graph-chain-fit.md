# Adaptive node width for chain fit — plan

Spec: `docs/superpowers/specs/2026-09-23-graph-chain-fit-design.md`.

- [x] Subagent adds a failing regression for the reproduced717 px group, then measures eligible node chains against the actual row slots; updates threshold/containment tests and current graph docs.
- [x] Run focused geometry/wrapping/client/renderer tests and TypeScript; inspect reference directly and freeze code for browser capture.
- [x] Controller compares717/736/360 px browser fixtures and checkbox state; run production build.
- [x] Independent scoped/final reviewer checks requirements, diff and direct reference/screenshot comparison; fix concrete findings through implementer.
- [x] Clean temporary fixtures, inspect Jujutsu status/diff and finalize one descendant commit using `jj describe` followed by `jj new`.

## Verification evidence

- 47 tests across five focused graph suites passed; TypeScript and production build passed.
- Before: 717 px host produced a 720 px canvas and three vertical 220 px cards. After: host/canvas are both 717 px; three cards are approximately 213.67 px and horizontal, with unchanged 12 px label text and preserved subtitle/milestone styling.
- Browser checked 736 px (220 px cards), 424 px (116 px cards), 423 px and 360 px (vertical). The 424 → 423 → 424 one-pixel resize changes orientation correctly.
- Main untitled group, three tasks, progress control and incoming/outgoing group edges preserved. Space sets group progress to 3/3 and all children done without changing any measured box; focus retained.
- Fresh browser load has no console errors. Implementer and independent reviewer directly compared the reference with all final screenshots; review approved without actionable findings. Temporary fixture removed before commit.
