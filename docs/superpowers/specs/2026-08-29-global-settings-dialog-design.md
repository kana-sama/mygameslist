# Global Settings Dialog Design

## Goal

Move the existing browser-local game-page preferences into one global settings dialog in the application header, add an opt-in Safari pinch-zoom guard, and leave deletion as the only tool in the game information panel.

## Reference

The approved interactive visual is binding for layout, hierarchy, wording, icon scale, control grouping, and responsive behavior:

- `/Users/kana/.codex/visualizations/2026/08/27/01a04356-c2d7-7283-a90a-4663a6a44332/settings-dialog-design.html`

The implementation must preserve these structural invariants:

- one settings dialog with a header, three settings groups, automatic-save status, and a single `Готово` action;
- the layout preference is represented by exactly two illustrated skeleton cards, not text-only radio buttons;
- the two boolean settings each have exactly one visible title, one description, and one unlabeled visual switch on the right;
- icons are full-size, meaningful line icons with consistent framed treatment, not glyphs or micro-icons;
- no duplicated visible label appears beside either switch.

## Header entry and dialog

- Add a settings button to `.app-header__actions`, between the random-game button and the local-changes indicator.
- The button uses a gear icon and exposes the accessible label and title `Настройки`.
- Activating it opens one modal dialog named `Настройки` from every application route.
- The dialog introduction is exactly: `Действуют для всей библиотеки, хранятся только в этом браузере и не синхронизируются.`
- Settings apply immediately. The footer says `Изменения сохраняются автоматически` and contains one `Готово` button that closes the dialog.
- The dialog also closes from its close button, `Escape`, or a pointer action on the backdrop.
- Opening moves focus into the dialog, Tab and Shift+Tab remain trapped inside it, and closing restores focus to the element that opened it.

## Layout preference

- The group title is `Расположение обложки и сведений`.
- Its description is `Выберите, где располагать панель с обложкой, сведениями об игре и кнопкой удаления.`
- Render exactly two illustrated selectable cards:
  - `Слева` with caption `Компактная боковая панель` and a skeleton showing a left information column beside notes;
  - `Сверху` with caption `Больше места для заметок` and a skeleton showing the information panel above note columns.
- The selected card is visibly accented and exposes the native radio state.
- Changing the card immediately applies the existing global `side | top` behavior to every game page and persists with the existing browser-local contract.

## Completed checklist preference

- The visible title is `Скрывать выполненные пункты`.
- The description is `В чеклистах будут видны только незавершённые пункты. Выполненные всегда можно временно раскрыть в самой заметке.`
- Use a checklist icon and one switch with no second visible label.
- The switch controls the existing global completed-checklist filter without changing its rendering, snapshot, reveal, persistence, or storage-failure semantics.

## Safari pinch preference

- The visible title is `Отключить масштабирование жестом`, followed by a small `Safari` marker.
- The main description is `Safari иногда смещает область наведения и клика после изменения масштаба двумя пальцами. Эта настройка отключает такой жест на трекпаде и помогает избежать ошибки.`
- The supporting note is `Изменение масштаба через меню Safari и сочетания клавиш ⌘+ и ⌘− продолжит работать.`
- Use a pointer icon and one switch with no second visible label.
- The preference is off by default. Only the enabled state is stored in `localStorage`; disabling removes its key.
- The preference is global across routes and games, browser-local, unsynchronized, and resilient to storage read/write failures. A failed write still updates the current React session; a failed read falls back to disabled.
- While enabled, prevent cancelable `wheel` events with `ctrlKey === true`, which is how Safari exposes trackpad pinch zoom to page script, and Safari gesture events that can initiate or continue visual pinch scaling.
- Do not prevent ordinary wheel scrolling, wheel events without `ctrlKey`, keyboard shortcuts, or browser-menu page zoom.
- Event listeners must be non-passive where cancellation is required and must be removed when the preference is disabled or the guard unmounts.

## Game information panel

- Remove the layout and completed-checklist controls from `.game-sidebar__tools`.
- When deletion is available, delete is the only remaining button in the tools container.
- Direct `GamePage` rendering continues to consume the two preference values so layout and filtering still apply; it no longer receives preference-changing callbacks.

## Visual and responsive behavior

- Follow the approved dark application styling, spacing, restrained borders, accent treatment, section separators, switch shape, and skeleton illustrations.
- At desktop widths, show the two layout cards side by side and each boolean setting as copy on the left with its switch aligned right.
- At narrow widths, stack the layout cards and let each boolean setting reflow without clipping or horizontal scrolling.
- Compare the implementation directly with the approved reference at `736px` and `360px`, with both layout cards selected in turn and both switches in off/on states.

## Scope boundaries

- Do not change authored content under `data/`, game or note persistence, Markdown rendering behavior, the sidebar layout CSS contract, or completed-checklist filtering semantics.
- Do not synchronize these settings or store them in the library patch.
- Do not disable ordinary browser page zoom through the menu or keyboard shortcuts.
- Do not add dependencies.

## Validation

- Preference tests cover default, exact enabled persistence, disable removal, invalid values, and storage failures.
- Pinch guard tests cover enabled/disabled wheel cancellation, the `ctrlKey` boundary, Safari gesture cancellation, and listener cleanup.
- Dialog tests cover exact accessible structure, exact two skeleton layout choices, immediate callbacks, absence of duplicated switch labels, close paths, focus trap, and focus restoration.
- Application and game-page tests cover the global header entry, immediate application and persistence, and deletion as the only game-panel tool.
- CSS/structural checks cover desktop and narrow modal composition without asserting generated build artifacts.
- Focused tests, the complete suite, and the production build must pass before the single feature commit is finalized.

