# Game Progress Reordering and Visual Fidelity Design

Date: 2026-08-07 (Asia/Tbilisi)

Status: Approved

## Goal

Allow progress items in the game sidebar to be reordered by dragging any part of an item while preserving a normal click as the way to open its editor. Correct the shipped grid styling so it follows the previously approved visual design: large immediately readable counts and no persistent card surface behind idle items.

## Normative visual references

The selected design artifact is:

- `.superpowers/brainstorm/90642-1786059988/content/full-panel-normalized-64-icons.html`

The earlier aligned-grid artifact remains supporting evidence for the intended count scale and idle-cell treatment:

- `.superpowers/brainstorm/90642-1786059988/content/full-panel-static-aligned-grid.html`

This written specification is authoritative if the approved follow-up differs from those artifacts. The only explicit visual override is the add cell: unlike the selected artifact, its idle state has neither a background nor a border.

## Grid visual contract

The section remains a fixed three-column grid at every responsive width. Each saved item visibly contains only its static normalized 64×64 icon and its progress value. No normal label, drag handle, badge, or instruction is added.

The visible `Прогресс` heading is metadata, not a separate display heading. It must share the exact typography declaration used by `.game-sidebar__meta dt`: `color: var(--muted-2)`, `font-size: 8px`, `font-weight: 650`, `letter-spacing: .07em`, and `text-transform: uppercase`. The implementation must use one shared selector/declaration so the heading cannot silently drift from labels such as `Теги` and `Изменено`.

Each item uses an 88 px visual cell with a fixed 64 px icon row and a fixed 17 px count row. Counts use 14 px semibold monospaced tabular numerals, matching the selected design rather than the shipped 10 px implementation. The checked value is bright, the slash is quiet, and the total is muted. A complete item colors the complete `A/B` value with the existing quiet success green and adds no other completion decoration. A broken item keeps the same geometry and renders lowercase `ошибка` in the value row at the selected design's readable 11 px size.

An idle saved item has a transparent background and transparent border. It must not expose the current persistent `var(--surface)` card fill. Hover and keyboard focus may reveal the selected subtle surface plus a thin solid border. The focus state also retains a visible focus outline.

The add cell remains the final grid cell and never participates in sorting. In its idle state it shows only the centered plus sign: its background and border are both transparent. On hover or keyboard focus it reveals the subtle surface and a quiet dashed border. It retains the accessible name `Добавить элемент прогресса`.

## Reordering interaction

The whole saved-item button is the drag activator. There is no handle. A short click without crossing the activation threshold opens the existing item editor exactly as before.

Use the project's existing `@dnd-kit` stack:

- non-touch pointer dragging begins only after 8 px of movement, preserving ordinary clicks;
- touch dragging begins after a 180 ms hold with 8 px tolerance;
- keyboard users start and finish sorting with Space or Enter, move through grid positions with arrow keys, and cancel with Escape;
- Russian screen-reader announcements describe pickup, target movement, completion, and cancellation.

While dragging, a lightweight overlay reproduces the same icon/value cell. The source cell becomes visibly subdued, valid targets use the approved hover/active treatment, and neighboring items move with the sortable grid transition. The overlay and active state must not introduce a permanent card background after the drag ends.

The post-drag click is suppressed so dropping an item never opens the editor. Once the interaction settles, focus remains on the moved item. The plus cell stays last regardless of the item order.

## Persistence and state

Order is represented solely by the existing `game.progressItems` array. Dropping item A over item B uses the standard sortable `arrayMove(currentItems, activeIndex, overIndex)` result: A occupies B's former array index and the intervening items shift by one. The reordered copy is persisted through the existing game save path. No rank field or schema change is added.

Dragging is disabled while a game save is active. A no-op drop, a cancelled drag, or a drop outside the sortable list does not save. If persistence fails, the canonical order remains unchanged and the existing inline save error is shown. Reordering never replaces icons, never creates blobs, and therefore does not alter asset reference or garbage-collection behavior.

## Component boundaries

`GameProgressGrid` owns sortable presentation, sensors, collision handling, active overlay state, click suppression, and accessibility announcements. It receives an `onReorder(activeItemId, overItemId)` callback and does not persist data itself.

`InlineGamePage` converts the two ids into a reordered `EditableGameProgressItem[]` and calls the existing `persist({ progressItems })` path. Existing add, edit, delete, focus-restoration, checklist resolution, and icon URL behavior remain unchanged.

## Verification

Automated coverage must prove:

- the reorder helper applies exact `arrayMove` index semantics with stable ids and preserves all item data;
- no-op, cancelled, and outside drops do not save;
- the whole saved-item button is the activator while an ordinary click still calls edit;
- the add cell is excluded from sortable ids and remains last;
- pointer, touch, and keyboard sensors use the approved activation behavior;
- the post-drop click is suppressed;
- screen-reader announcements and focus behavior remain usable;
- unrelated saves preserve the reordered array;
- CSS has exactly three columns, 64 px icon rows, 17 px value rows, 14 px normal counts, 11 px error text, transparent idle saved cells, and a transparent borderless idle add cell;
- the `Прогресс` heading and sidebar metadata terms resolve to the same color, font size, font weight, letter spacing, and uppercase transformation from one shared CSS declaration;
- only hover/focus/drag states reveal the approved surfaces and borders;
- completed styling remains value-color-only.

Real-browser verification must compare the complete sidebar directly with the normative mockup at desktop and narrow widths. It must observe idle, hover, keyboard focus, pointer drag, completed, broken, and add-cell states; perform a reorder; verify a short click still opens edit; reload or rerender to prove order persistence; and restore any QA data before completion.

## Acceptance criteria

- Any point on a saved progress item can start a drag; no drag handle is visible.
- A normal click still opens the item editor.
- Dragging reorders items across rows in the three-column grid and persists the new array order.
- The add cell is never draggable and always remains last.
- Idle item and add cells have no visible background; the idle add cell also has no visible border.
- Backgrounds and the appropriate solid/dashed borders appear only during hover, keyboard focus, or drag-related interaction.
- Normal progress values are immediately readable at 14 px and remain aligned under 64×64 icons.
- The `Прогресс` heading exactly matches the sidebar metadata-term style used by `Теги`, `Изменено`, and the other metadata labels.
- Existing complete, broken, editing, clipboard, deletion, and asset-cleanup behavior does not regress.
- `AGENTS.md` permanently requires exact conformance to user-approved visual designs.
