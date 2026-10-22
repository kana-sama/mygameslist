# Compact smart note dialog implementation plan

Spec: ../specs/2026-10-22-smart-note-dialog-design.md

- [x] Inspect reference, existing modal host/styles and CSS-ready lifecycle.
- [x] Implementer subagent: compact shell CSS/Icon, generic ready-page background
  bridge with cleanup, focused behavior tests, active design/author docs.
- [x] Controller: browser compare reference and final desktop/mobile views,
  generic alternate/transparent background and loading/close checks.
- [x] Scoped independent review of implementation plus direct visual comparison.
- [x] Focused tests/build; remove temporary fixtures; inspect jj status/diff.
- [x] Finalize one jj describe commit and create fresh jj new.

## Verification

- Implementer: `npx vitest run tests/smart-note-background.test.ts
  tests/smart-note-styles.test.ts tests/smart-note-ui.test.tsx` — 35 passed;
  initial background regression failed before implementation.
- Controller production build passed after final source changes.
- Real SmartNote + actual Barbuta modules with isolated in-memory state:
  desktop 1280×864, unchanged outer window 1232×816 at (24,24); header 28px,
  padding 4px 8px; title 14px/400/20px; close hit target 28px high, SVG14×14;
  border1px accent, radius5px, clipped corners. Header/page both rgb(8,10,8).
- Mobile390×844 window fits viewport with same compact header; map64 cells
  and existing sidebar retained. Preview title unchanged.
- Synthetic transparent wrappers: delayed CSS stays gated; header geometry
  unchanged through loading. Alternate rgb(37,48,71), dynamic rgb(75,36,57)
  and transparent fallback confirmed. Escape closes and restores focus.
- Implementer and independent reviewer directly viewed reference and final
  desktop/mobile/alternate screenshots. Scoped review approved.
- Temporary fixtures removed; authored programs/state were not changed.
