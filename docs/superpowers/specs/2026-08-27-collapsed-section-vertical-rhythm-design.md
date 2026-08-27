# Collapsed Section Vertical Rhythm Design

## Status

Approved by the user on 2026-08-27. The normative visual reference is:

`/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_4hrrdT/Screenshot 2026-08-27 at 09.38.40.png`

## Scope

Fix two related vertical-rhythm defects in Markdown checklist sections:

1. `Скрыто N секций` must sit after the complete geometric area of the last visible section at the same hierarchy level, with exactly 8 px of neutral space.
2. A collapsed root subsection must keep its current top inset while reducing only its lower reserve so the title-plus-`Свернуто · N пунктов внутри` block is visually centered between section boundaries.

Do not change Markdown structure, collapse/filter state, focus, click behavior, animation ownership, animation timing, summary text or counts, tables, checklist-item summaries, or authored data.

## Section area and hidden-section summaries

A section's complete area consists of its visible content plus the lower reserve that may carry the section's green or yellow wash. Geometry must be identical for unpainted, complete, and indeterminate sections.

The summary after a visible root subsection uses the root reserve plus 8 px. A nested summary after a visible nested subsection uses the nested reserve plus 8 px. These rules depend only on DOM hierarchy and adjacency, never on paint-state classes.

The summary itself uses a 10 px font, so its structural margins use the subsection reserves converted to absolute pixels: 20.088 px at the root and 6 px when nested. This prevents `em` from being reinterpreted in the summary's smaller font context.

When every subsection at a level is hidden, the summary has no preceding visible section and keeps the existing base 8 px inset; no phantom subsection or reserve is introduced. Existing nested indentation, guide line, typography, click target, and motion-owner metadata remain unchanged. The summary receives no top padding and no background mask.

## Collapsed-section rhythm

Current browser geometry shows a collapsed root subsection with approximately 12.66 px from its upper boundary to the visible heading control but approximately 20.09 px from the collapsed-state line to the next full-area boundary. Nested collapsed subsections are already balanced at approximately 6.59 px above and 6 px below.

For collapsed root subsections only, reduce the lower reserve from `1.674em` to `1em`. Compensate the existing inter-section margin structurally so the following subsection or hidden-section summary moves upward by the same difference. The top heading margin and padding remain unchanged. Expanded root subsections and all nested subsection spacing remain unchanged.

Complete and indeterminate `::after` washes use the reduced reserve for collapsed root subsections, so paint and dividers end on the new lower boundary. Unpainted, complete, and indeterminate collapsed root subsections therefore have the same height.

## Implementation constraints

- Prefer CSS only; change `Markdown.tsx` only if the existing DOM cannot express the structural relationships.
- Remove the four paint-state-dependent hidden-summary offset rules.
- Do not inherit a custom property from a previous sibling.
- Do not add `padding-top` to a hidden-section summary.
- Do not use transforms, relative positioning, or content displacement to fake the collapsed height.
- Do not increase the top inset.
- Preserve the existing completed-filter and explicit-collapse animations.

## Validation

Automated tests must exercise rendered elements with the production stylesheet and cover:

- root summaries after unpainted, complete, and indeterminate visible subsections;
- nested summaries after the same three states;
- summaries with no preceding visible subsection;
- collapsed root subsections in unpainted, complete, and indeterminate states;
- unchanged expanded subsection rhythm and unchanged nested collapsed rhythm;
- unchanged summary hierarchy, click behavior, and motion-owner routing through the existing regression suite.

Browser verification on Xenoblade Chronicles 2 must compare the Shop Deeds root subsections and the nested collapsed sections in Quests. Root collapsed lower reserve must be 12 px (`1em` at the current Markdown size), nested reserve must remain 6 px, and the hidden-section summary must begin 8 px after the corresponding full-area boundary.

Run at minimum:

```bash
npm test -- tests/markdown-tasks.test.tsx
npm run build
```

Finalize specification, plan, CSS, and regression tests as one Jujutsu commit.
