# Smart editor local loading implementation plan

Spec: ../specs/2026-10-22-smart-editor-local-loading-design.md

- [x] Inspect video frames and trace service stylesheet mirroring/host gating.
- [x] Implementer: reproduce generic cold-editor flash; isolate widget style
  loading from ready page, preserve authored styles and incremental mirroring;
  focused generic regressions and documentation.
- [x] Browser controlled cold editor/CSS checks, geometry/visibility and cleanup.
- [x] Scoped review with direct reference comparison; focused tests/build.
- [x] Remove temporary fixtures, jj status/diff, one commit and jj new.

## Verification

- Generic regression failed before implementation: creating a cold editor
  changed the ready page stylesheet status from false to true.
- `npm test -- tests/smart-note-styles.test.ts tests/smart-note-widgets.test.tsx
  tests/smart-note-ui.test.tsx`: 3 files, 41 tests passed.
- Production build passed after a type-only Element|null annotation fixed
  TypeScript TS7022 in the incremental clone ordering loop.
- Fresh browser origin, actual SmartNote/Barbuta/Monaco, no-store service CSS
  delayed 1800ms: at 1280×720, hidden-after-ready counter stayed zero through
  first editor load, CSS readiness and typing. Map851.6015625×618, page1230×642
  and header1230×28 were unchanged. Focused editor accepted typed text.
- At390×844, local CSS loading→ready retained map372×271.3125, page388×814
  and header388×28. Hidden counter stayed zero; text persisted, close succeeded.
- Implementer and independent reviewer directly compared reference frames
  with final desktop/mobile loading/ready screenshots; both approved.
- Temporary browser fixtures removed; no authored programs/state changed.
