# Table Completed-Checklist Filter Design

## Status

Approved by the user through the visual companion on 2026-09-01. This design extends `2026-08-26-hide-completed-checklists-design.md`; every existing snapshot, note-activity, persistence, reveal, accessibility, and reduced-motion rule remains in force unless this document explicitly extends table behavior.

The approved companion reference is `.superpowers/brainstorm/17637-1788275631/content/table-completed-filter-summaries-v3.html` at its authored viewport. The companion is ignored scratch, so this document is the permanent observable contract.

## Goal and scope

Extend the global completed-checklist filter to normal rendered Markdown tables. Hide snapshot-complete checklist rows and wholly complete row groups without changing authored Markdown, manual group-collapse persistence, checkbox save behavior, note snapshot timing, editors, diff/review rendering, or drag previews.

## Row eligibility and ownership

- A table row is filter-complete only when it contains at least one checkbox cell and every checkbox cell in that row is checked.
- An unchecked or indeterminate checkbox keeps its row visible. A row without checkbox cells is ordinary table content and remains visible.
- In an ungrouped table section, completed rows are owned by that section. In a visible named group, completed rows are owned by that group.
- Append exactly one interactive row summary after the remaining visible rows of each owner that has snapshot-hidden rows. Its exact text is `Скрыто N строк`.
- Clicking a row summary temporarily reveals only the rows counted by that exact summary. It does not reveal rows in another group or ungrouped section.
- Stable structural row IDs must survive unrelated Markdown inserted above or an unrelated sibling row inserted before the target at the same filter revision, so temporary reveals and checklist-search navigation continue to address the intended row.

## Group eligibility and ownership

- A named row group is filter-complete only when it has at least one row, every row contains at least one checkbox cell, and every checkbox cell in every row is checked.
- A group containing an ordinary row, unchecked checkbox, or indeterminate checkbox remains visible. Its individually complete rows are still filtered behind that group's `Скрыто N строк` summary.
- A filter-complete group hides as one unit: its heading and content rows are logically hidden immediately.
- Do not render a per-group replacement such as `Скрыта группа X`.
- Append one table-level summary after all table body groups when the table has snapshot-hidden groups. Its exact text is `Скрыто N групп`, counting only direct named groups hidden in that table.
- Clicking `Скрыто N групп` temporarily reveals the counted group headings and structure. The completed rows inside them remain filtered behind their own `Скрыто N строк` summaries, matching the existing minimum-reveal hierarchy used by hidden checklist sections.
- Revealing a filter-hidden group does not alter its independent manual collapse state. If the group was manually collapsed, its content remains manually collapsed.

## Completed sections containing tables

- A table is checklist-hideable for enclosing heading-section analysis only when it has at least one data row and every data row is filter-complete.
- A table with an ordinary row, unchecked checkbox, or indeterminate checkbox counts as visible content and keeps its enclosing heading section visible.
- The table header remains visible whenever its table remains rendered. An enclosing completed heading section may still hide the whole table according to existing section ownership rules.

## Summary-row visual contract

- `Скрыто N строк` and `Скрыто N групп` use identical row height, cell span, padding, typography, normal font weight, left alignment, and interactive hover/focus behavior.
- Neither summary is indented or centered.
- Their only persistent visual distinction is background color:
  - `Скрыто N строк` uses the same background as an ordinary table row;
  - `Скрыто N групп` uses the same `--surface-2` background as a table group heading.
- Summary rows introduce no icon, pill, border, marker, extra label, or group name.

## Column geometry

- Hiding and revealing rows or groups must never change any table column width.
- Logically hidden real `tr` and `tbody` elements remain semantic table sizing participants using the existing `display: table-row` or `display: table-row-group` plus `visibility: collapse` pattern. Do not replace this with `display: none`.
- Existing manual group-collapse column stability remains unchanged.
- Temporary motion replicas use a fixed semantic table shell and measured column widths, so they cannot feed different widths back into the live table.

## Motion and Safari

- Table row and group filtering uses the existing completed-filter duration and visual language exactly: 280 ms, the same vertical translation, `scaleY`, opacity, entry/exit easing, and surrounding-row FLIP settling as completed list rows and sections.
- Logical filtering and accessibility update immediately. A visual replica may finish afterward but is inert, `aria-hidden`, pointer-transparent, and ID-free.
- Never animate a live semantic `tr` or `tbody` for table entry/exit. Safari does not reliably composite transforms, masking, or clipping on animated table rows.
- Reuse the Safari-safe semantic-replica carrier proven by `markdownChecklistCollapseMotion.ts`: `table > colgroup > tbody > tr`, with measured column widths. During reveal, keep the real row in table layout with `visibility: hidden`, align the inserted replica's final rectangle exactly to the real row, then restore the real row and remove the replica in the same completion turn.
- Cancellation, interruption, content change, filter disable, and unmount restore every temporarily hidden real row and remove all replica tables and clip containers.
- When `prefers-reduced-motion: reduce` matches or Web Animations is unavailable, present the newest logical state immediately without replicas.

## Search, accessibility, and source boundaries

- Checklist-search entries for table cells carry the row's stable structural ID. Navigating to a filtered result uses the existing item and section reveal channels to reveal the minimum owning group and row before highlight/focus.
- Hidden rows and groups are absent from interaction and the accessibility tree immediately through their logical `hidden` state even though CSS retains them for sizing.
- Summary controls are ordinary keyboard-focusable buttons with exact accessible names matching their visible copy.
- Do not add dependencies or alter authored Markdown, `data/`, table parsing syntax, checkbox task semantics, group collapse IDs, local-storage keys, or save payloads.

## Validation

Permanent generic tests must prove:

- row eligibility for one and multiple checkbox cells, including unchecked, indeterminate, and ordinary rows;
- group eligibility and the absence of any per-group replacement line;
- exact owner counts and minimum hierarchical reveal for both summary types;
- identical summary geometry/typography with the approved background-only distinction;
- stable structural row identity and checklist-search reveal routing;
- enclosing heading-section behavior for complete and mixed tables;
- width stability for filtered rows, filtered groups, manual collapse, and reveal;
- Safari-safe semantic replicas with measured columns, exact final geometry, no direct live-row entry/exit animation, and cleanup on finish, cancel, interruption, and unmount;
- unchanged 280 ms completed-filter keyframes/easing, persistent FLIP motion, and immediate reduced-motion/no-Web-Animations behavior.

Run focused Markdown, checklist-search, and CSS tests, the full test suite, and the production build before finalizing exactly one Jujutsu commit.
