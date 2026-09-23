# Adaptive horizontal graph chains

## Intent and reference

User requests that linear chains run horizontally when they fit the available width. This is a bounded extension of the existing automatic flow layout.

Reference: `assets/2026-09-23-graph-horizontal-before.png`. Preserve the ordered group containers, headings, progress controls, node ownership, captions/subtitles, kinds and edges. The authorized visual change is orientation and resulting group height/edge routing. The pictured three-node group and following two-node group should use left-to-right rows when each group's inner width permits; the groups themselves retain their existing placement. No font, color, decoration, data, source syntax or checklist changes.

## Rules

- Detect directed simple paths of at least two children in a flow scope, including root connected chains and paths inside ordinary groups/sections. Follow edge direction even when declaration order differs; keep returned node order and keyboard traversal stable.
- Measure children using the existing normal card dimensions. Choose horizontal placement only if the entire row, spacing and necessary label clearance fit the actual scope budget after parent padding. Do not shrink cards just to enable a row.
- Center a fitting row and align child centers vertically. Route real edges using the existing engine; preserve endpoints and labels without introducing new overflow.
- Conservatively retain vertical flow when labeled edges touch the candidate scope, including external edges: existing label routing may require extra space. Horizontal label clearance is outside this bounded change; document the fallback.
- Otherwise retain existing vertical flow. Branches, merges, cycles, self loops, disconnected children and explicit grids retain their existing layout behavior. Do not infer new dependencies or collapse group boundaries. External group connections must survive a child's orientation change.
- Recompute on width changes using the existing worker/cache path. Checklist state changes must not change geometry.
- No new user-facing attributes or dependencies. Update graph format documentation to describe automatic orientation.

## Verification

Generic tests with the real graph engine cover wide/narrow and exact-fit thresholds, dependency order versus declaration order, grouped/nested containment, branch/cycle/grid exclusions, edge routing and checklist stability. Permanent tests use synthetic titles only.

Temporary browser fixture reproduces the screenshot's two groups and three/two-node paths. Compare wide (about 790 CSS px) and narrow (360 px) layouts, arrows, text, group progress and checked/focus state. Both implementer and reviewer view reference and final screenshots directly. Run focused graph tests, TypeScript and production build. Finalize one descendant commit; no publication or authored-data changes.
