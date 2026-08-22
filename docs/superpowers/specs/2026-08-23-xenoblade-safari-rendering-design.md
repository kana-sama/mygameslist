# Xenoblade Chronicles 2 Safari rendering stability

## Summary

Keep the approved Quest Deck design while removing the nested CSS filter layers that make the Xenoblade Chronicles 2 notes deck expensive to composite and can leave note cards temporarily unpainted in Safari after an image lightbox changes focus and page overflow.

## Rendering contract

- The notes deck and note cards must not use `filter: drop-shadow(...)`.
- The note-card idle, hover, and focus states must not transition `filter`.
- Recreate the existing offset plates and deck cast shadow with CSS-only grid layers that contain no note descendants. Keep inset shadows on clipped surfaces and paint the card's cast shadow on its unclipped wrapper so `clip-path` cannot discard it.
- Do not introduce another filtered or backdrop-filtered ancestor around the notes.
- Unrelated effects outside the notes deck, including the cover treatment, remain unchanged.

## Visual and interaction invariants

- Preserve the approved clipped deck and card silhouettes, cyan left edge, layered backgrounds, colors, and responsive composition.
- Preserve one notes container, note hierarchy, grouping, order, shelf packing, card spans, internal scrolling, attachments, and image-lightbox behavior.
- Idle, hover, and focus must keep card and neighboring-card rectangles identical. The action tray may appear without moving the card.
- Preserve drag transforms, editing, drop-target, error, complete, and narrow-screen states.
- Non-target games and non-game routes remain unchanged.

## Verification

- Use a temporary authored-style verifier to reject `filter` on `.game-notes` and `.note-card`, reject `filter` in the note-card transition, and confirm the separate backing layers plus unclipped card shadow. Remove it before finalization.
- Run the production build.
- Inspect the target page at `1440 × 900`, `980 × 900`, and `390 × 844` in idle, hover, focus, and image-lightbox open/close states when Safari automation is available.
- Keep this content-only CSS correction free of permanent game-specific tests.
