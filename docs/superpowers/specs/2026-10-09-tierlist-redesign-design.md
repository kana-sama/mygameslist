# Tier-list note interaction redesign

Status: Approved by the user's direct correction on 2026-10-09.

This supersedes the card sizing, card type selector, plaintext tooltip, grade buttons and bottom grade form in the original tier-list specification. Keep the original feature's note-format, attachment ownership, independent format drafts and persistence guarantees.

## Binding interaction and visual contract

- Cards are exactly 150 × 150 CSS px, including their border. They wrap inside each grade. Uploaded card images use the existing cover preparation pipeline: centered square 512 × 512 WebP, prepared by the site. The stored image is at least 300 × 300; its displayed card is 150 × 150. Ordinary note images keep their existing preparation behavior.
- A card has an optional image and Markdown content, without a visible card-type selector. Create/edit opens a centered, portalled, accessible modal with the established modal header/body/footer hierarchy. Use the existing `ImagePicker` in cover mode above the existing Markdown editor. File selection, image drop, clipboard insertion, replacement, removal, loading and errors use the shared picker. No duplicate file input or optimizer.
- With an image, the face displays the image. Without an image, use the first Markdown heading as the face title, using the existing heading parser. For existing/body-only content without a heading, use its first nonempty text line so valid text is still usable. No separate card-title field. A completely empty card cannot be saved.
- Clicking a card with nonempty Markdown opens the existing rich Markdown tooltip. Hover/focus alone do not open it. Links and Markdown render through the existing tooltip body. A short click and a completed drag remain distinct. In the editor, a quiet edit affordance opens the modal.
- Each editable grade contains a final 150 × 150 add-card square with centered plus. It has no persistent idle surface; the grade's hover or keyboard focus reveals its dashed border and quiet surface. Match progress-grid add controls, adapted to the explicit size and grade-area hover. Keep it in flow; no `+ карточка` text button or action bar.
- Grade names edit in their own left label slot using the application's inline-field treatment. Enter/blur commits; Escape cancels; empty names show a local error. Duplicate names are allowed. Grade creation inserts its inline name editor in a new row at the board end, rather than a detached bottom form.
- Grade order changes by dragging the grade label/handle, with keyboard support and touch activation. Remove up/down controls. Card dragging inside and across grades, empty-grade targeting, insertion feedback, cancel/outside/no-op behavior, autosave failure rollback, authoritative source updates and focus restoration remain working. Grade/card/note drag gestures must not interfere.
- Grade deletion remains available as a quiet local affordance; deleting a nonempty grade asks confirmation. Do not add persistent explanatory labels or decorative surfaces beyond these established controls.
- Modal Escape/backdrop/cancel restores focus and discards its local changes. Trap keyboard focus. Late image work cannot mutate a cancelled/unmounted draft; pending work cannot save stale images. Preserve valid Markdown when image preparation fails. Preserve quota validation, prepared-blob ownership, deduplication, rollback and object URL cleanup.

## Normative repository references

Inspect and compare directly with:

- `src/components/ImagePicker.tsx`, `src/domain/assets.ts`, `tests/image-picker.test.tsx`: shared image preparation and cover behavior.
- `src/components/GameProgressGrid.tsx`, `src/components/GameProgressItemDialog.tsx`, `src/styles.css` progress grid and modal rules.
- `docs/superpowers/specs/2026-08-07-game-progress-grid-design.md` and `2026-08-07-game-progress-reordering-design.md`: quiet add controls, pointer/touch/keyboard sensor patterns and post-drag click suppression.
- `src/components/MonacoNoteEditor.tsx`, `LazyMonacoNoteEditor.tsx`, `MonacoMarkdownEditor.tsx`: existing Markdown editing.
- `src/components/MarkdownRichTooltip.tsx`, `markdownRichTooltipContext.ts`, `src/domain/markdownChecklist.ts`: click-driven rich tooltip and first heading.
- `src/pages/GamePage.tsx` `InlineTextField` and `.inline-field-input` in `src/styles.css`: in-place name editing.

## Content compatibility

Use a unified version-2 card schema `{ id, imageAssetId: string | null, bodyMarkdown: string }`. Keep document title, grades, IDs, names and order. Read strict legacy version 1 and convert its literal text to escaped Markdown in memory; preserve image references and literal visible text. Serialize version 2 only on explicit user mutation, never rewrite authored data merely on reading. Version-2 validation rejects unknown/missing fields, invalid image IDs, duplicate IDs and empty cards. Existing attachment/pool/patch/source/GC integration remains one asset pipeline.

## Validation mapping

Use purpose-built synthetic fixtures only. Permanent tests prove v1 compatibility/v2 strictness, cover-mode shared picker routing and 512-square preparation, modal hierarchy and absent type selector, image-above-Markdown structure, heading face, click-only rich tooltip, grade-local add cell, inline rename/create, grade/card pointer/touch/keyboard sorting, cancel/no-op/failure/source-update behavior, image processing/cancel/quota/pool contracts and note-format drafts. Do not assert build artifacts or authored database content.

Implementer and reviewer compare the rendered UI directly with the references at 1280 × 800 and 390 × 844, including idle, grade hover, keyboard focus, tooltip, modal, pending/error and drag states. DOM measurements verify exactly 150-square cards/add cells, source image dimensions and one modal/picker/editor with correct order. Use an isolated synthetic preview, not the user's real library. Record any browser transport limitation honestly; inspect screenshots plus DOM evidence and sensor tests where direct automation is unavailable.

Run focused tests, the full suite, source validation and build before finalizing one descendant JJ commit. No new dependencies or authored-data changes.
