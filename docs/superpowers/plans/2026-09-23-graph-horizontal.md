# Adaptive horizontal chains implementation plan

Spec: `docs/superpowers/specs/2026-09-23-graph-horizontal-design.md`.
One bounded implementation task via subagent, then one combined scoped/final review. Controller owns browser verification and commit.

- [x] Implementer adds synthetic failing geometry tests, detects fitting linear flow paths and implements adaptive placement with existing routing. Preserve non-chain/grid behavior, source order, scope padding and state stability; document automatic orientation.
- [x] Run focused graph layout/wrapping/client/renderer tests and TypeScript. Report commands/results and inspect reference directly.
- [x] Controller validates screenshot-shaped browser fixture at wide/narrow widths, geometry, containment, arrows and checklist states; run production build.
- [x] Independent reviewer compares diff, test evidence, reference and final screenshots; resolve concrete findings through implementer.
- [x] Remove temporary fixtures, inspect Jujutsu status/diff, finalize one commit with `jj describe` and `jj new`.

## Verification results

- 77 tests in 8 focused graph test files passed; TypeScript and production build passed.
- Browser fixture at 790 px: both paths horizontal; first group height253→105 px and second205→118 px. At720 px only the two-node path is horizontal; at360 px both remain vertical.
- Two ordered groups, five nodes and four original edges retained. Card width220 px and text12 px unchanged; all nodes stay inside their groups and the page width does not expand.
- Space on the first group changes progress0/3→3/3 and checks all three children with identical measured group/node boxes; keyboard focus remains. Browser error log empty.
- Implementer and independent reviewer directly compared all final screenshots with the supplied reference; review approved. Reviewer independently reran15 horizontal-layout tests successfully. Temporary fixture removed before commit.
