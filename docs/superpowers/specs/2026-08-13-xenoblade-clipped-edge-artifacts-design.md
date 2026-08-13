# Xenoblade Quest Deck clipped-edge color artifact correction

## Summary

Keep the deliberate diagonal silhouettes throughout the Xenoblade Chronicles 2 Quest Deck, but remove the isolated cyan, gold, green, and red border fragments that appear as tiny pixels/wedges at a clipped corner. A rectangular `border-left` is painted before a parallelogram `clip-path`; only the last few pixels of that border survive at the lower-left cut.

Normative screenshots:

- Initial nested-heading examples: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_botdYR/Screenshot 2026-08-13 at 10.08.40.png` and `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_JxAuiw/Screenshot 2026-08-13 at 10.08.54.png`.
- Clarifying metadata-panel example: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_1p7GD6/Screenshot 2026-08-13 at 10.24.22.png`.

## Visual contract

- Restore and preserve the seven-pixel parallelogram clipping on sidebar metadata plates and subordinate `h3`/`h4` checklist headings. The angled upper-left and lower-right silhouettes are approved.
- Remove only border fragments that do not follow the clipped silhouette and survive as isolated lower-left color wedges.
- Audit every target-game selector combining `clip-path` with `border-left`. Remove the rectangular left accent only where the clip actually cuts the left edge: sidebar metadata plates, inline save errors, and subordinate `h3`/`h4` headings. Keep the note-card left accent because that card's clip cuts only its upper-right corner and leaves the left edge intact.
- Subordinate incomplete/complete hierarchy remains legible through existing gold/cyan/green text and layered backgrounds; metadata remains cyan-labeled; errors remain red through text/background.
- Keep primary `h2` ice faces, red cores, progress diamonds, card/deck/cover silhouettes, shadows, spacing, content, markup, interactions, and non-target pages unchanged.

## Verification

- Use a temporary authored-style audit that enumerates every `clip-path` plus `border-left` combination and fails for the three unsafe selectors while accepting the note-card surface.
- Compare all three exact screenshots at `1440 × 900`, `980 × 900`, and `390 × 844`; confirm diagonal geometry remains and isolated corner colors are absent.
- Confirm subordinate incomplete and complete states, inline error styling, primary headings, note-card left edge, and page overflow.
- Remove all real-game-specific temporary checks before finalization; do not add permanent tests naming this game or its content.
