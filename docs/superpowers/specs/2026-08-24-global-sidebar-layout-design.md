# Global Sidebar Layout Design

## Goal

Add a browser-local control that switches every existing game page between the default left sidebar and a horizontal sidebar across the top.

## Behavior

- The default mode remains `side`: the existing `220px` sticky sidebar stays left of the notes.
- The alternative mode is `top`: the page becomes one column, the sidebar spans the top, and notes occupy the full row below it.
- In wide top mode, the sidebar is a three-column grid: a `160px` cover on the left, title and metadata in the flexible center column, and the progress grid in a `300px`–`420px` right column. Tools remain below the center metadata.
- At `720px` and narrower, top mode uses the existing compact two-column sidebar structure with progress across the full width below it. Existing `640px` and `500px` responsive behavior remains compatible.
- The control is the first button in `.game-sidebar__tools`, immediately before delete. It uses the existing `expand-horizontal` icon when the action moves the sidebar to the top and `expand-vertical` when the action returns it to the left.
- The control exposes `aria-pressed="false"` and the label/title `Переместить сайдбар наверх` in side mode. In top mode it exposes `aria-pressed="true"` and `Вернуть сайдбар слева`.

## Persistence

- One browser-local setting applies to all games, not one setting per game.
- The setting survives navigation, unmount/remount, and reload through `localStorage`.
- Only the non-default `top` value is stored; returning to `side` removes the key.
- If browser storage throws, the toggle remains usable for the current React session and loading falls back to `side`.

## Acceptance Criteria

- Toggling on one game immediately applies the top-layout class, remains active on another game, and is restored after remount.
- Returning to side mode removes the top-layout class and persistence.
- The layout control precedes delete, has the correct pressed state and accessible action label, and invokes a no-argument global toggle.
- Computed desktop styles produce a one-column page plus cover-left/details-center/progress-right sidebar grid.
- Focused preference, application, component, and CSS tests pass; the root suite and production build pass.

