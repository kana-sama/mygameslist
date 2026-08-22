# Xenoblade Chronicles 2 Safari rendering stability implementation plan

> **For agentic workers:** execute through subagents and use Jujutsu only.

**Goal:** Prevent Safari from temporarily dropping note-card paint after image-lightbox focus changes without changing the approved Quest Deck layout.

**Architecture:** Replace the large, nested `filter: drop-shadow(...)` groups with descendant-free CSS backing and cast-shadow layers. Keep inset shadows on the clipped deck/card surfaces and paint the card cast shadow on its unclipped wrapper. Remove filter animation while retaining non-moving hover/focus feedback.

## Constraints

- Modify only the Xenoblade stylesheet plus this specification and plan.
- Preserve all structure, geometry, clipped silhouettes, responsive breakpoints, content, and interactions.
- Do not add permanent real-game-specific tests.
- Finalize specification, plan, implementation, and verification in one Jujutsu commit, then create a fresh working-copy change.

## Tasks

- [x] Replace the desktop and narrow `.game-notes` drop-shadow filters with clipped, descendant-free backing and cast-shadow layers in the same grid area.
- [x] Remove note-card filters and filter transitions; recreate the offset plate with a pseudo-layer and the cast shadow on the unclipped card wrapper.
- [x] Run and remove a temporary selector-level CSS verifier.
- [x] Run the production build and inspect the final Jujutsu diff.
- [x] Have implementer and reviewer compare the CSS structure with the Quest Deck reference and the theme, hover-stability, and clipped-edge specifications. Confirm unchanged layout geometry, responsive grid areas, stacking order, and clipped-edge invariants before committing.

## Verification record

- The temporary selector-level audit passed and was removed; no task-specific verifier remains in the tree.
- `npm run build` passed after the final stacking correction.
- Independent review found no remaining blocking, high, or medium issues.
- Direct automated browser comparison at `1440 × 900`, `980 × 900`, and `390 × 844`, especially Safari lightbox open/close, was unavailable because Safari's `Allow remote automation` setting is disabled. The implementation does not change that system setting; the scenario remains a manual post-change check.
