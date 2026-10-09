# Tier-list viewing and editing modes

Status: approved by the user’s direct three-part correction on 2026-10-09. This overrides the previous saved-board drag behavior and editor-only add-card control. One coherent mode-contract correction; the excess label inset comes from the viewing-mode drag handle.

## Binding contract

- In ordinary saved-note viewing, grades and cards do not reorder with pointer, touch or keyboard. No grade drag handle or reserved handle slot, drag cursor, drag-specific accessibility description or drag overlay appears. Clicking cards still opens their rich Markdown tooltip. Existing general note arrangement is outside this correction.
- Saved-note heading and content use the same shared framing as neighboring graph/Markdown notes: 6px content inset, with grade label text aligned to that inset without an additional anchor gutter. Keep the same title typography and sticky arrangement. No new padding, persistent surfaces or decoration. Cards remain exactly 150x150 CSS px.
- In ordinary viewing, each grade has a final 150x150 add square. Match the established progress-grid add affordance: no idle surface, dashed square with centered plus on grade hover or keyboard focus. Clicking it opens the existing portalled TierListCardForm with one shared ImagePicker above one Markdown editor, without switching the entire note into editing. Save persists the new card in that grade and any image through the existing attachment/pool and game-note save path.
- In full note editing, grade/card drag sorting, inline names, grade creation/deletion and existing-card editing remain available. There is no add-card square or other add-card control in this mode. The existing add-grade control remains.
- Reuse image preparation (512-square WebP), pool ownership/deduplication, unrelated attachments, quota checks and URL cleanup. Cancel never writes; pending preparation/save prevents duplicate save; failure retains the card draft and reports an error so retry is possible. Storage/saving locks prevent unavailable actions. An authoritative source/format change while the form is open must not overwrite newer content or append into a vanished grade.
- No new dependencies, authored-data edits or data-coupled permanent tests. Existing finalized commits are immutable. One descendant JJ commit contains this spec, plan, implementation and necessary synthetic tests.

## References

- User’s latest numbered correction is authoritative for mode behavior.
- User screenshot from the prior correction: `/var/folders/ts/h63qz7zd7nd66cmmz3z2gc3c0000gn/T/TemporaryItems/NSIRD_screencaptureui_i5DTNe/Screenshot 2026-10-09 at 5.15.33 AM.png`; its neighboring graph/Markdown note heading and minimum inset remain normative.
- `src/pages/GamePage.tsx`: ScrollableNoteCard heading/container and InlineNoteCard / saveNote persistence.
- `src/components/GameProgressGrid.tsx`, `GameProgressItemDialog.tsx`, shared progress-grid/modal styles in `src/styles.css`: hover/focus add control and standalone card dialog flow.
- `src/components/tierlist/TierListCardForm.tsx`, TierListEditor.tsx, tierListPool.ts and `docs/superpowers/specs/2026-10-09-tierlist-redesign-design.md`: card modal, image/Markdown hierarchy, square geometry and editor interactions. The previous editor-only add requirement is superseded above.

## Validation

Permanent synthetic tests: actual GamePage ordinary-mode absence of grade handles/reorder saves/overlays and working click tooltip; add square per grade and modal structure; text and prepared-image persistence to target grade with unchanged unrelated notes/attachments; cancel/failure/retry/pending/locks and current-source reconciliation; editor lacks add-card controls while grade/card reordering and existing-card editing work. Update obsolete saved-note reorder/editor-add tests to the new contract without dropping still-applicable pool/draft tests.

Temporary actual-GamePage browser preview at1280x800 and390x844: directly compare grade label and heading edge inset with graph/Markdown, measure150-square cards/add cells, idle/grade hover/keyboard focus plus, normal click tooltip and add modal, cancel/save, editor no-plus and retained drag handles. Implementer and reviewer inspect references and final screenshots directly. Run focused related tests, full suite and build on final code once. Clean only this task’s preview workspace before JJ finalization.
