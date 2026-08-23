# Completed checklist subsection backgrounds

## Context

Progress-bearing Markdown subheadings already report whether every checklist item in their section is complete. The approved design extends the completed-row treatment used by Markdown tables to the whole checklist subsection, including collapsed subsections and independently completed nested subsections.

The visual contract was refined against these references:

- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_58KY6q/Screenshot 2026-08-23 at 08.44.41.png`
- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_9OODtr/Screenshot 2026-08-23 at 08.54.10.png`
- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_Rt7fHc/Screenshot 2026-08-23 at 09.00.54.png`
- `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_o9awXz/Screenshot 2026-08-23 at 09.19.33.png`

## Goal

Give every fully completed checklist subsection one continuous green background from its preceding divider to its following divider, without changing the established heading hierarchy, spacing, or collapse behavior.

## Behavioral contract

- Within a top-level Markdown heading section, every progress-bearing heading at depth 2 or deeper owns a subsection containing its rendered heading, ordinary content, lists, and all deeper heading subsections until the next heading at the same or shallower depth.
- A subsection is complete only when its heading progress exists, is not open-ended, and has `checked === total`.
- Completed and incomplete sibling subsections are independent. A completed nested subsection receives the completed treatment even when an ancestor or sibling is incomplete.
- Collapsing a subsection does not change its completion state or wrapper; the completed background therefore remains visible around its collapsed heading and state text.
- Top-level note headings remain section containers and do not receive this subsection background.
- Authored Markdown, checklist totals, checkbox behavior, collapse identifiers, source order, and saved state remain unchanged.

## Visual contract

- A complete subsection uses the existing `--success-wash` background used by completed Markdown table rows.
- The background covers the entire subsection, not only its heading, and reaches both horizontal edges of the note content.
- The background also fills the existing inter-section gap so there is no unpainted strip, while the measured margins, padding, and vertical rhythm remain unchanged.
- Section dividers run edge to edge and are drawn exactly once.
- Ordinary dividers retain the established `1px solid var(--line-soft)` appearance.
- Only the divider between two adjacent completed sibling subsections is slightly stronger: `color-mix(in srgb, var(--line-soft) 92%, var(--text))`, still at `1px`.
- Existing nested indentation guides, completed heading color, table styling, collapsed-state typography, focus treatment, hover behavior, and sticky note title styling remain unchanged.

## Theme compatibility

- Completion background and divider color/thickness are shared Markdown behavior and must be defined in `src/styles.css`, never in a game-specific stylesheet.
- A custom game theme may extend its existing direct-child heading selectors to the new subsection wrapper and may set only the subsection gap and `--markdown-content-inline-padding` compatibility property needed to preserve that theme's pre-existing vertical rhythm and note-content full bleed.
- Xenoblade Chronicles 2 must retain its established clipped heading treatment for headings now wrapped by `.markdown-checklist-subsection`; it must not override the shared divider color or thickness.

## Verification

- Add permanent generic tests using synthetic Markdown. Verify completed and incomplete sibling wrappers, independently completed nested wrappers, wrapper nesting boundaries, and completion-class updates after a checkbox change.
- Verify the production CSS keeps one divider source, full-width note bleed, `--success-wash`, the original ordinary divider, and the approved adjacent-completed divider mix.
- Run the focused Markdown task test, the full test suite, and the production build.
- Compare the final note directly with the cited references and the approved live state at the same desktop layout, checking expanded and collapsed completed/incomplete siblings plus double and triple nesting. Confirm full-width backgrounds, unchanged vertical rhythm, and a single subtle divider between adjacent green sections.
