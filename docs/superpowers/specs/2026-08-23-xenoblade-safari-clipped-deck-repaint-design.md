# Xenoblade Safari clipped-deck repaint correction

## Problem

The Safari screen recording supplied on 2026-08-23 is the normative failure reference. After a note image lightbox closes, the deck background and sidebar remain painted, but almost every descendant note disappears. Scrolling repaints only the tiles entering the visible region. The DOM is still present. Removing `filter` effects therefore addressed only one compositor trigger and did not resolve the failure.

The remaining large compositor boundary is the tall `.game-notes` element itself: it clips and paints the deck while also containing every note. Lightbox root/overflow changes can make Safari lose the descendant paint for that clipped layer.

## Required correction

- `.game-notes` remains the single semantic and layout container, but must not have `clip-path`, filter, mask, transform, grouped opacity, border, background, or shadow painting.
- A full-size, descendant-free `.game-notes::before` layer owns the existing polygon clip, border, layered blue deck face, inset shadows, and horizontal rule.
- `.note-groups` paints above that layer. The existing `Completion Record` label remains on `.game-notes::after` above the content.
- File-drag outline and tint move from the unclipped container to the clipped decorative layer; group drop states remain unchanged.
- Desktop retains the 34px corner cuts and the rule at 67px with 22px side insets. At the 980px breakpoint the existing 14px rule insets remain. Mobile retains 20px cuts and the rule at 59px with 10px insets, narrowing only the rule inset to 8px at 500px; the full deck face never shrinks.
- The descendant-free backing layers on `.game-view-layout` remain unchanged.
- No DOM structure, grouping, ordering, note span, editor, drag-and-drop, attachment, or lightbox behavior changes.

## Validation

1. A temporary selector-level audit must prove the container has no compositor/paint grouping and that only its empty decorative layer is clipped and painted.
2. Compare the final deck at desktop and mobile widths with `.superpowers/brainstorm/25659-1786593616/content/quest-deck-v2.html` and the prior Xenoblade visual specifications, including idle and file-drag states.
3. Run the production build.
4. Repeat the recorded Safari sequence: open a note image, close it, then scroll through the page. All notes must remain continuously painted.
