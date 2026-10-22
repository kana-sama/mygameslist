# Smart note activity implementation plan

Spec: ../specs/2026-10-22-smart-note-activity-design.md

- [x] Trace document activity handlers and smart/ordinary card props/classes.
- [x] Implementer subagent: generic failing regression, pass interactionActive
  through smart branch, shared class and active-state design contract.
- [x] Scoped review; focused activity/smart host tests and production build.
- [x] Inspect jj status/diff; one jj describe commit followed by jj new.

## Verification

- Regression reproduced before product fix: all three event variants failed
  at missing smart-card active class.
- `npm test -- tests/smart-note-card-activity.test.tsx tests/smart-note-ui.test.tsx`:
  27 passed. Synthetic shell/title/Shadow DOM controls cover pointerdown, click,
  focusin; single active card, ordinary/smart transfers, outside reset, pointer
  movement persistence and no save calls.
- Focused activity selection from ui-acceptance.test.tsx: 7 passed, 93 skipped.
- Production build passed. No authored data, smart program, CSS, modal or
  runtime changes.
- Independent scoped review approved; existing modal focus lifecycle remains unchanged.
