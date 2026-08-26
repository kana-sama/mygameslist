# Hide Completed Checklists Design

## Goal

Add a global client-side game-page filter that hides completed Markdown list checklist content while preserving incomplete work, ordinary section content, existing authored data, and existing checklist interactions.

## Toolbar and persistence

- Add a new completed-checklist filter button as the first control in `.game-sidebar__tools`, immediately before the existing layout toggle and delete button.
- Use a crossed-out-eye icon. The inactive accessible action is `Скрывать выполненные пункты`; the active accessible action is `Показывать выполненные пункты`.
- Expose the state with `aria-pressed`. Use the same quiet active treatment as the layout toggle.
- The default state is off. Store only the enabled state under `mygameslist:hide-completed-checklists:v1` in `localStorage`; disabling removes the key.
- The preference is global across games and survives reloads. Storage read/write failures keep the current React session usable and fall back to showing completed content on a fresh load.

## Snapshot timing

- Enabling the filter, including restoring an enabled preference on mount or opening another game while it is enabled, immediately snapshots the currently checked list items and hides them.
- While the filter remains enabled, changing a checkbox does not immediately change which items are visible. The changed row remains in its current filtered view so the page does not jump under the pointer.
- Each checkbox change restarts a 60,000 ms debounce owned by the game page. When the full minute passes without another checkbox change, every note on the page refreshes its completed-content snapshot from the latest Markdown.
- Only checklist checkbox changes reset the debounce. Scrolling, pointer movement, ordinary clicks, editing, layout changes, and other page activity do not.
- Disabling the filter immediately shows all content and cancels a pending refresh. Re-enabling immediately builds a fresh snapshot.
- Leaving the game page cancels its pending timer. The next game builds its own immediate snapshot from current content.

## List filtering

- Filter Markdown list checklist items only. Markdown tables, including their checkbox cells, rows, groups, progress, and styling, remain unchanged in this version.
- Hide a checked list item when hiding it cannot conceal an incomplete or indeterminate descendant. An incomplete or indeterminate descendant keeps its checked ancestor branch visible until the descendant is also complete.
- Unchecked items, indeterminate items, open checklist markers, ordinary leaf list items, and list items whose descendants include ordinary content remain visible.
- A non-task list item is a structural checklist-group label when it has at least one checklist descendant and every child block is recursively checklist-only. Hide that label with its descendants when the entire descendant checklist subtree is hideable. This lets completed grouped checklists disappear without treating a standalone ordinary list item as a checklist.
- Preserve authored order, nesting, checkbox behavior, edit behavior, progress totals, spoilers, links, and existing collapse state. Filtering changes rendering only and never writes note content or `collapsedChecklistSections`.
- After each rendered list checklist from which at least one item is hidden, append one quiet summary line with the exact text `Скрыто N пунктов`. The line uses the approved option A treatment: small muted text aligned with list content, without an icon, pill, border, or click behavior.
- Count the items hidden from that rendered checklist. A checked ancestor retained for an incomplete descendant is visible and is not counted as hidden.

## Section filtering

- The first level-one Markdown heading remains the note title and is never hidden by this filter.
- A checklist section begins at a checklist-bearing heading of depth two or greater and continues until the next heading of the same or shallower depth.
- Hide a section heading and its checklist content when the snapshot leaves no visible checklist item in that section and the section contains no ordinary Markdown content.
- Any paragraph, quote, code block, rule, ordinary leaf or mixed-content list item, or table keeps its section visible. A structural checklist-group label does not count as ordinary content for this rule. Completed list checklist content inside a visible section is still filtered, leaving the ordinary content and applicable `Скрыто N пунктов` summaries.
- A table counts as ordinary content because table filtering is out of scope.
- Nested section ownership follows heading depth. If hidden child sections belong to a visible parent, append one quiet summary at the end of that parent's child-section sequence with the exact text `Скрыто N секций`.
- If hidden depth-two sections belong directly to the note title, append the section summary at the end of that note-title section. Count only the direct hidden sibling sections; a hidden parent represents its hidden subtree once.
- The section summary uses the same approved quiet option A treatment and is non-interactive.

## Scope boundaries

- Apply the filter to normal note cards on the game page. Note editors, Markdown diff/review rendering, and drag previews retain their current unfiltered behavior.
- Do not change authored files under `data/`, the Markdown source schema, note persistence, task-save semantics, table rendering, or manual checklist-section collapse persistence.
- Do not add dependencies.

## Validation

- Preference tests cover exact persistence, removal on disable, default behavior, and storage failures.
- Markdown component tests cover immediate filtering, stable snapshots across Markdown changes, refresh revisions, unchecked and indeterminate items, nested incomplete descendants, quiet item counts, hidden sibling sections, visible sections with ordinary content, level-one title preservation, and unchanged tables.
- Game-page tests cover toolbar order, active accessibility, immediate enabling, a newly checked row remaining visible, refresh at exactly 60,000 ms after the last checkbox change, debounce reset by a second checkbox change, cancellation when disabled, and the global toggle callback.
- Focused tests, the complete test suite, and the production build must pass with pristine output before the feature is finalized.
