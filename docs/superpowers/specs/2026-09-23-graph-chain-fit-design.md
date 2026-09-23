# Fit linear node chains to available width

The user reports that the A → B → C chain stays vertical despite apparently sufficient width. Reference: `assets/2026-09-23-graph-chain-fit-before.png`. Preserve the untitled group, three tasks, subtitle under A, milestone styling on C, progress control, and entering/leaving group edges. Authorized changes are row orientation, adaptive card width and resulting group height/routing.

## Reproduced cause

The previous implementation measures every node at 220 px before testing the row. Three cards require 704 px plus32 px group padding. A717 px group therefore stays vertical even though three approximately214 px cards fit. Reproduced with the real engine at717,735 and736 px. The previous specification's assumption that cards must never shrink was too restrictive for the user's intended fit behavior; this correction supersedes that restriction.

Browser reproduction also measured a717 px host with a720 px canvas: GraphNote starts at720 and ignores width changes smaller than4 px. This directly affects fit decisions and causes small overflow. Honor the actual rounded width initially and on subsequent changes, deduplicating equal rounded values instead of discarding real pixel changes.

## Behavior

- Keep the existing eligible simple-path detection and exclusions. For a path made of direct node children, allocate the available inner row width after22 px edge gaps equally, capped at the existing220 px maximum.
- If each slot is at least the existing116 px minimum, measure/wrap the nodes at that width and place the row with existing center alignment and routing. Preserve font sizes, padding, checkbox size and text; use the existing balanced wrapper.
- If slots would be narrower than116 px, use the existing vertical flow. Do not resize group containers merely to force a horizontal group chain; retain parent hierarchy and padding.
- Width changes recompute geometry; task/group completion does not. Explicit grids, branches, cycles and labeled-edge fallback stay unchanged.
- Initial width and one-to-three-pixel changes must reach layout, including changes across a row-fit threshold. Keep rounded pixel deduplication to avoid subpixel churn.
- Update current user/format docs and affected generic threshold tests. Preserve finalized historical specs/commits.

## Verification

Synthetic real-engine tests reproduce the rejected short-label chain near717 px, establish the actual minimum-width threshold including nested padding, verify horizontal/vertical transitions, variable-height wrapped captions and stable checklist geometry. Browser reference-shaped fixture compares717,736 and360 px with three task nodes and external group links; verify fonts, widths, group ownership, arrows and checked/focus states. Implementer and reviewer directly compare screenshots to the reference. Focused graph tests, TypeScript and production build; one descendant commit and no authored-data edits.
