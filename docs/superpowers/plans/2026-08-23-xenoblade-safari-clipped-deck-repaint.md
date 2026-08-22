# Xenoblade Safari clipped-deck repaint implementation plan

1. Record the screen-recording evidence and visual/interaction invariants in the follow-up specification.
2. Refactor only the Xenoblade theme CSS: make `.game-notes` an unpainted layout container, move its deck face and polygon clipping to `::before`, raise `.note-groups`, and move the file-drag deck state to the clipped layer.
3. Use a temporary CSS audit to verify ownership of clipping/painting, exact desktop/mobile geometry, stacking, and drag-state routing; remove the audit after it passes.
4. Run the production build and compare the rendered desktop/mobile structure and states to the cited reference.
5. Independently review the diff against the recording and specification, then finalize the correction as one descendant Jujutsu commit.
