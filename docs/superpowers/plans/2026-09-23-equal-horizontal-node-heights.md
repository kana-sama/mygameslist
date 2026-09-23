# Equal Horizontal Node Heights Implementation Plan

**Goal:** Make all node cards in a horizontal graph row share the height of the tallest card.

**Architecture:** Keep natural text measurement unchanged, then normalize node-region heights only after the row is known to fit. Existing CSS already vertically centers both the text and checkbox.

**Spec:** `docs/superpowers/specs/2026-09-23-equal-horizontal-node-heights-design.md`

## Task 1: Normalize horizontal row node heights

- [x] Add a synthetic failing real-engine test with two horizontal nodes of unequal natural height; assert equal top, equal height and a centerline edge.
- [x] Change the horizontal direct-node placement to stretch every row node geometry to the maximum natural height, retaining existing widths, wrapped lines and row height.
- [x] Run the new regression plus focused graph layout, wrapping, client and renderer tests and TypeScript.
- [x] Compare the browser fixture at wide and narrow widths with the supplied reference; verify checklist state keeps geometry stable.
- [x] Complete independent scoped review, run production build, inspect Jujutsu status/diff, and finalize exactly one descendant commit.

## Verification result

- The regression failed before the implementation with natural heights 68 and 52, then passed after row normalization.
- Full suite: 111 test files passed, 2268 tests passed and 22 existing tests skipped.
- TypeScript and production build passed; the existing bundle-size advisory remains non-blocking.
- Browser at 320 px: both cards are 133×65 px with the same top. Text blocks of 31 and 47 px and both checkboxes share the card center. At 280 px the vertical flow remains unchanged.
- Group completion changes 0/2 to 2/2 and retains focus without changing measured node/group geometry. A clean browser load reported no console errors.
- Implementer and independent reviewer directly compared the final screenshots with the supplied reference. Review passed specification and code quality with no findings.
