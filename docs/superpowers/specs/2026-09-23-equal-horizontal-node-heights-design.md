# Equal heights for horizontal graph nodes

## Intent

Nodes placed in the same horizontal flow row must have the same visible height. The row height is the greatest natural node height in that row. Shorter nodes stretch to that height while their checkbox and text block remain vertically centered.

Reference: `assets/2026-09-23-equal-horizontal-node-heights-before.png`. Preserve the group, progress control, two nodes, labels, subtitles, arrow, widths, colors, fonts and task behavior. Only the shorter card height and the resulting vertical centering may change.

## Behavior

- Apply equal height only to nodes in an eligible horizontal simple-path row.
- Measure text and determine the row's maximum natural height first, then assign that height to every node geometry in the row.
- Keep every node at the same top coordinate. Existing flex styles center text vertically; the absolute checkbox remains centered through `top: calc(50% - 8px)`.
- Route the connecting edge between the vertical centers of the now-equal cards.
- Vertical flows, grids, non-node group regions, width selection, text wrapping, fonts, colors and state transitions remain unchanged.
- Checklist state changes must not affect geometry.

## Verification

A synthetic real-engine regression uses two horizontal nodes where one label wraps to two lines. It must fail before the fix because heights differ, then pass with equal top/height and a centered horizontal edge. Existing focused graph layout and renderer tests, TypeScript and production build must pass. A temporary browser fixture reproduces the supplied visual at wide and narrow widths; implementer and reviewer compare it directly with the reference.
