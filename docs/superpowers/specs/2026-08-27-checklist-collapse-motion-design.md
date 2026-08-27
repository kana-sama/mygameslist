# Checklist Collapse Motion Design

## Status

Approved in the visual companion on 2026-08-27. The binding reference is variant C, “Короткий каскад к заголовку”, in:

`/Users/kana/Development/mygameslist/.superpowers/brainstorm/63358-1787808510/content/nested-collapse-motion-variants-reopened.html`

## Scope

Animate the existing explicit collapse and expand interactions for:

- checklist sublists controlled by a parent checklist row;
- checklist sections controlled by a checklist heading;
- grouped table rows controlled by a table-group heading.

The feature changes only visual handoff. Collapse IDs, persisted collapsed state, click targets, Markdown structure, keyboard behavior, filtering, editing, and table semantics remain unchanged.

## Motion contract

Content moves toward the control that owns it:

- sublist rows move into the parent checklist row;
- section content moves into its checklist heading;
- table rows move into the table-group heading.

Collapse runs farthest visible item first. Adjacent items start 14 ms apart, with total stagger capped at 42 ms. Expansion is the exact directional inverse: the nearest item emerges first and later items follow downward. Per-item transform/opacity motion plus its capped delay must finish within 235 ms of the interaction. Variant C's phases are preserved: collapse transforms run for 185 ms while opacity fades after 55 ms for 85 ms; expansion transforms run for 190 ms while opacity fades in after 45 ms for 95 ms.

Each moving item translates vertically to the owning control, compresses only on the Y axis to approximately eight percent of its height, and fades out. Expansion uses the inverse keyframes. There is no X-axis scaling, horizontal travel, bounce, blur, marker, background flash, or decorative destination point.

The owning control remains visually stable. Persistent content that changes position uses FLIP-style vertical settling so rows below the collapsed or expanded region move smoothly rather than jumping.

For checklist headings, the existing `Свернуто · N пунктов внутри` state appears after the child-content motion begins and disappears into the same heading on expansion. Entry uses a 145 ms transform after 90 ms and an 85 ms fade after 115 ms; exit uses the same durations with no delay. Its text and layout remain unchanged.

## Logical and accessibility behavior

React state remains authoritative and updates immediately. Removed content leaves the accessible DOM at once; temporary exit replicas are visual only, `aria-hidden`, inert, pointer-transparent, and stripped of IDs. Replica list and table rows preserve enough ancestor context to retain their rendered indentation, ordered-list numbering, and column geometry during motion.

Initial mount does not animate. A new collapse/expand interaction cancels obsolete animations and removes obsolete replicas. Unmount does the same. When Web Animations are unavailable or `prefers-reduced-motion: reduce` matches, state changes immediately with no replica or transform animation.

## Integration constraints

- Reuse the current collapsed-section state and `onCollapsedChecklistSectionsChange` API.
- Do not change the completed-checklist filter animation or its 280 ms timing.
- Do not add a dependency or timer-based state delay.
- Apply motion only to normal interactive Markdown rendering. Diff/review output, editors, drag previews, authored Markdown, and `data/` remain unchanged.
- Tables must remain semantic tables; do not replace rows with div-based layout.
- Add stable motion metadata only where needed for collapse layout capture and owner routing.
- When the first checklist heading is portaled into the note's sticky title layer, only that visible accessible control and state participate in motion; the inert inner placeholder must not animate.
- If Markdown content and collapsed IDs change in the same render, skip the visual handoff rather than matching entries through stale source-position identities. The logical collapse still applies immediately.

## Validation

Automated tests must observe RED before implementation and then verify:

- owner routing for sublists, headings, and table groups;
- collapse delay order of farthest-to-nearest with 14 ms steps capped at 42 ms;
- expansion delay order of nearest-to-farthest;
- vertical-only owner-bound keyframes and 235 ms maximum completion;
- smooth FLIP settling for persistent following content;
- inert, ID-free replicas with correct list/table context;
- exact transform/opacity phases, sticky-title portal routing, and ordered-list counters;
- safe suppression when content and collapse state change together;
- interruption, unmount cleanup, initial-mount silence, and reduced-motion bypass;
- unchanged collapse persistence, `aria-expanded`, and table semantics.

The final artifact must also be compared with approved companion variant C for all three content types in collapsed and expanded directions.
