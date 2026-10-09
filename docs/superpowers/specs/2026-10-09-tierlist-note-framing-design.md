# Tier-list note framing parity

Status: approved by the user’s screenshot and direct visual correction on 2026-10-09.

The saved tier-list note must use the same note title treatment and minimum content inset as the graph and Markdown note beside it. The cited screenshot shows three note formats with the same title; its graph/Markdown columns are normative, while the oversized and edge-aligned tier-list column is the reported defect.

## Contract

- Render tier-list note titles through the existing note-card heading presentation: the same font, weight, color, line height, wrapping, top position and inner/outer sticky-heading arrangement as graph/Markdown. One accessible title, with any layout duplicate hidden/inert as in the graph reference. Empty/invalid titles must not create a new header or error title.
- Use the existing note-card content container and its 6px inset on both sides and top/bottom. Do not duplicate padding in the board or editor and do not reduce card/add-cell 150x150 geometry.
- Preserve the screenshot’s note grouping/hierarchy and the established grade/card layout, drag/drop, inline editing, tooltip and modal interactions. Do not change data, card source format or image preparation.
- This is one note-format integration correction: connect the tier-list body and title to the shared note-card framing path. Do not introduce a separate title style or refactor unrelated formats.

## Normative references

- User attachment: `/var/folders/ts/h63qz7zd7nd66cmmz3z2gc3c0000gn/T/TemporaryItems/NSIRD_screencaptureui_i5DTNe/Screenshot 2026-10-09 at 5.15.33 AM.png`; copied for review to `.superpowers/sdd/tierlist-note-framing/reference.png`.
- `src/pages/GamePage.tsx` ScrollableNoteCard: graph heading outer/inner and `.markdown.graph-note-card-body` framing.
- `src/components/Markdown.tsx` first heading inner/outer presentation and portal; `src/styles.css` lines around 404-420 and 813-834: shared Markdown headings and note-card insets/sticky rules.
- `src/components/tierlist/TierListNote.tsx`, `tierListNote.css`; `docs/superpowers/specs/2026-10-09-tierlist-redesign-design.md`: preserve 150-square cards and interactions.

## Validation

Use synthetic notes with equal titles in actual GamePage, including blank title, long wrapping title, standalone board, empty/nonempty grades and a populated 150-square card. Structurally verify one accessible heading, existing heading slots/classes, the shared inset-bearing container, and no double board/editor padding. Do not encode authored note/game content in tests. In a temporary isolated preview compare all three real note formats at1280x800 and390x844: measure actual title typography/placement and both content insets, check wrapping/no horizontal overflow, 150-square card, sticky heading while scrolling, and a focused/hovered grade control. Implementer and reviewer inspect the user reference and final screenshots directly. CSS geometry verification may be temporary; retain only stable component/integration tests.

Run focused related tests, full tests and build once on final code. One new descendant JJ commit includes this specification, plan, scoped implementation and necessary generic tests; leave prior commits immutable. No authored-data/dependency changes.
