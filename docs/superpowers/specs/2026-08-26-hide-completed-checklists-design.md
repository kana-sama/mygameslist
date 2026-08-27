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
- The game page owns one explicit active-note identity independently of the filter. A pointer action anywhere inside a note or keyboard focus entering a note makes that note active. Pointer movement and pointer exit alone do not change activity. A pointer action or keyboard focus outside the active note clears it or transfers activity to another note.
- The active note always uses its existing one-pixel border in the accent color, whether the completed-checklist filter is enabled or disabled. Activity has no filtering effect while the filter is disabled.
- A successfully saved checklist checkbox change marks only its note's completed-content snapshot as pending. Clicking a hidden-content summary marks the same note pending through the same refresh mechanism.
- Pending work remains unchanged while its note is active. The first pointer action or keyboard focus outside that note refreshes only that note's completed-content snapshot synchronously, with no debounce and no functional timeout. The resulting visual transition starts in the same interaction turn.
- If an asynchronous checkbox save finishes after activity already left its note, refresh that note synchronously when the successful save finishes.
- A refresh clears that note's temporary hidden-content reveals. Other notes retain their own snapshots and pending state.
- Scrolling, pointer movement, hover, editing, layout changes, and other activity inside the same note do not refresh the snapshot.
- Disabling the filter immediately shows all content and clears pending filter work and temporary reveals without clearing the independent active-note identity. Re-enabling immediately builds fresh snapshots.
- Leaving the game page clears pending work. The next game builds its own immediate snapshots from current content.

## List filtering

- Filter Markdown list checklist items only. Markdown tables, including their checkbox cells, rows, groups, progress, and styling, remain unchanged in this version.
- Hide a checked list item when hiding it cannot conceal an incomplete or indeterminate descendant. An incomplete or indeterminate descendant keeps its checked ancestor branch visible until the descendant is also complete.
- Unchecked items, indeterminate items, open checklist markers, ordinary leaf list items, and list items whose descendants include ordinary content remain visible.
- A non-task list item is a structural checklist-group label when it has at least one checklist descendant and every child block is recursively checklist-only. Hide that label with its descendants when the entire descendant checklist subtree is hideable. This lets completed grouped checklists disappear without treating a standalone ordinary list item as a checklist.
- Preserve authored order, nesting, checkbox behavior, edit behavior, progress totals, spoilers, links, and existing collapse state. Filtering changes rendering only and never writes note content or `collapsedChecklistSections`.
- After each rendered list checklist from which at least one item is hidden, append one quiet text button with the exact text `Скрыто N пунктов`. The button uses the approved option A treatment: small muted text aligned with list content, without an icon, pill, or persistent border; hover and keyboard focus communicate interactivity.
- Count the items hidden from that rendered checklist. A checked ancestor retained for an incomplete descendant is visible and is not counted as hidden.
- Clicking the button temporarily reveals only the direct hidden items counted by that exact rendered list summary. Other hidden lists and sections remain filtered.

## Section filtering

- The first level-one Markdown heading remains the note title and is never hidden by this filter.
- A checklist section begins at a checklist-bearing heading of depth two or greater and continues until the next heading of the same or shallower depth.
- Hide a section heading and its checklist content when the snapshot leaves no visible checklist item in that section and the section contains no ordinary Markdown content.
- Any paragraph, quote, code block, rule, ordinary leaf or mixed-content list item, or table keeps its section visible. A structural checklist-group label does not count as ordinary content for this rule. Completed list checklist content inside a visible section is still filtered, leaving the ordinary content and applicable `Скрыто N пунктов` summaries.
- A table counts as ordinary content because table filtering is out of scope.
- Nested section ownership follows heading depth. If hidden child sections belong to a visible parent, append one quiet summary at the end of that parent's child-section sequence with the exact text `Скрыто N секций`.
- Preserve that ownership visually: a summary owned by a visible subsection uses the same nested inset and vertical guide as the child headings it replaces, while a summary owned directly by the note title remains at the outer content level.
- If hidden depth-two sections belong directly to the note title, append the section summary at the end of that note-title section. Count only the direct hidden sibling sections; a hidden parent represents its hidden subtree once.
- The section summary is a quiet text button using the same approved option A treatment and interactive hover/focus behavior as the list summary.
- Clicking `Скрыто N секций` temporarily reveals only the direct hidden sibling sections counted by that exact summary. Checked items inside those sections remain filtered behind their own `Скрыто N пунктов` buttons; the section click never expands the whole descendant checklist subtree.

## Motion

- Apply motion to completed Markdown list rows and checklist sections only. Markdown tables, note editors, diff/review rendering, and drag previews do not participate.
- A logical filter refresh is immediate. Motion is a visual handoff lasting 280 ms; it never reintroduces a debounce or delays the start after note activity leaves.
- When rows become hidden, each disappearing row keeps its full inline width while moving vertically into the exact `Скрыто N пунктов` summary that owns it, fading and collapsing on the vertical axis as the remaining rows smoothly move into their final positions. Do not scale the row horizontally and do not draw a point, marker, trail, or other destination decoration.
- When sections become hidden, each disappearing section (heading plus its rendered checklist body) uses the same full-width vertical motion into the exact `Скрыто N секций` summary owned by its hierarchy level. Nested and root summaries remain separate destinations.
- Clicking a hidden-items or hidden-sections summary plays the reverse relationship: the minimum content owned by that summary emerges from that same summary line while surrounding content smoothly makes room.
- Content that is logically hidden becomes non-interactive and absent from the accessibility tree immediately even if a visual exit replica is still finishing. Temporary visual replicas must be inert, `aria-hidden`, pointer-transparent, and must not duplicate DOM IDs.
- Motion uses a fast, readable ease-out/ease-in curve and is interruptible: a new filter/reveal transition cancels obsolete animations and replicas, then converges on the newest logical state without stale nodes.
- When `prefers-reduced-motion: reduce` matches, skip the visual handoff and present the new logical state immediately.

## Scope boundaries

- Apply the filter to normal note cards on the game page. Note editors, Markdown diff/review rendering, and drag previews retain their current unfiltered behavior.
- Do not change authored files under `data/`, the Markdown source schema, note persistence, task-save semantics, table rendering, or manual checklist-section collapse persistence.
- Do not add dependencies.

## Validation

- Preference tests cover exact persistence, removal on disable, default behavior, and storage failures.
- Markdown component tests cover immediate filtering, stable snapshots across Markdown changes, refresh revisions, unchecked and indeterminate items, nested incomplete descendants, interactive item counts with exact list ownership, interactive section counts with exact nesting ownership and minimum reveal, hidden sibling sections, visible sections with ordinary content, level-one title preservation, and unchanged tables.
- Motion tests cover owner-specific row and section destinations, full-width vertical-only keyframes, smooth FLIP movement for surviving content, reverse reveal motion, inert visual exit replicas, interruption cleanup, initial-mount behavior, and reduced-motion behavior without asserting browser implementation details.
- Game-page tests cover toolbar order, active accessibility, immediate enabling, independent active-note styling with the filter on and off, activation by pointer and keyboard focus, no refresh while the changed note remains active, synchronous note-only refresh when activity leaves, successful saves that settle after departure, reveal clicks using the same zero-delay refresh path, clearing pending work when disabled, and the global toggle callback.
- Focused tests, the complete test suite, and the production build must pass with pristine output before the feature is finalized.
