# Global Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved global browser-local settings dialog, move the existing game-page preferences into it, and add an opt-in Safari pinch-zoom guard.

**Architecture:** `LibraryRoutes` remains the single owner of global client preference state and modal visibility. A focused `SettingsDialog` renders the approved UI, existing preference modules gain explicit setters while retaining their toggle contracts, and a small `PinchZoomGuard` owns non-passive Safari event listeners. `GamePage` continues to consume layout/filter values but no longer exposes controls for changing them.

**Tech Stack:** React 19, TypeScript, CSS Grid/Flexbox, localStorage, DOM wheel/gesture events, Vitest, Testing Library, JSDOM, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-29-global-settings-dialog-design.md`

## Global Constraints

- The approved visual at `/Users/kana/.codex/visualizations/2026/08/27/01a04356-c2d7-7283-a90a-4663a6a44332/settings-dialog-design.html` is binding for observable structure, hierarchy, wording, icon scale, skeleton-card choices, switch labeling, and responsive behavior.
- The layout and completed-checklist preferences remain global, browser-local, immediately applied, and otherwise semantically unchanged.
- Pinch blocking defaults off, stores only the enabled state, and does not intercept ordinary scrolling or menu/keyboard page zoom.
- `.game-sidebar__tools` retains only delete; no preference-changing callback remains in `GamePageProps`.
- Use exact Russian copy from the spec; each boolean setting has one visible title and no duplicate label beside its switch.
- Do not add dependencies or modify authored content under `data/`.
- Use Jujutsu exclusively; finalize the whole feature as exactly one commit only after implementer and reviewers compare the final UI with the reference, then create a fresh working-copy change with `jj new`.
- Follow strict TDD and record actual RED/GREEN command output in the ignored task report.

---

### Task 1: Implement the global settings dialog and Safari pinch guard

**Files:**
- Create: `src/components/SettingsDialog.tsx`
- Create: `src/components/PinchZoomGuard.tsx`
- Create: `src/state/pinchZoomPreference.ts`
- Create: `tests/settings-dialog.test.tsx`
- Create: `tests/pinch-zoom-guard.test.tsx`
- Create: `tests/pinch-zoom-preference.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/Icon.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/state/sidebarLayoutPreference.ts`
- Modify: `src/state/completedChecklistFilterPreference.ts`
- Modify: `src/styles.css`
- Modify: `tests/app-selective-diff.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`
- Modify only if existing contracts require it: `tests/sidebar-layout-preference.test.ts`
- Modify only if existing contracts require it: `tests/completed-checklist-filter-preference.test.ts`
- Include: `docs/superpowers/specs/2026-08-29-global-settings-dialog-design.md`
- Include: `docs/superpowers/plans/2026-08-29-global-settings-dialog.md`

**Interfaces:**
- Produces: `loadPinchZoomBlocked(storage?: Pick<Storage, "getItem">): boolean`.
- Produces: `setPinchZoomBlocked(enabled: boolean, storage?: Pick<Storage, "setItem" | "removeItem">): boolean`.
- Produces: `setSidebarLayoutMode(mode: SidebarLayoutMode, storage?: Pick<Storage, "setItem" | "removeItem">): SidebarLayoutMode`; existing `toggleSidebarLayoutMode` delegates to it.
- Produces: `setCompletedChecklistFilterEnabled(enabled: boolean, storage?: Pick<Storage, "setItem" | "removeItem">): boolean`; existing toggle delegates to it.
- Produces: `<PinchZoomGuard enabled: boolean>` with no rendered DOM.
- Produces: `<SettingsDialog open, sidebarLayoutMode, completedChecklistFilterEnabled, pinchZoomBlocked, onSidebarLayoutModeChange, onCompletedChecklistFilterEnabledChange, onPinchZoomBlockedChange, onClose>`.
- `AppShellProps` consumes required `onOpenSettings(): void` and renders the header trigger.
- `GamePageProps` retains `sidebarLayoutMode` and `completedChecklistFilterEnabled`; it no longer consumes either preference toggle callback.

- [ ] **Step 1: Write failing preference and event-boundary tests**

Create `tests/pinch-zoom-preference.test.ts` with a small in-memory `Storage` subset and throwing read/write fakes. Assert these literal outcomes:

```ts
expect(loadPinchZoomBlocked(storageWith(null))).toBe(false);
expect(loadPinchZoomBlocked(storageWith("enabled"))).toBe(true);
expect(loadPinchZoomBlocked(storageWith("unexpected"))).toBe(false);
expect(setPinchZoomBlocked(true, memoryStorage)).toBe(true);
expect(memoryStorage.getItem("mygameslist:block-pinch-zoom:v1")).toBe("enabled");
expect(setPinchZoomBlocked(false, memoryStorage)).toBe(false);
expect(memoryStorage.getItem("mygameslist:block-pinch-zoom:v1")).toBeNull();
expect(loadPinchZoomBlocked(throwingReadStorage)).toBe(false);
expect(setPinchZoomBlocked(true, throwingWriteStorage)).toBe(true);
```

Create `tests/pinch-zoom-guard.test.tsx`. Render the real guard and dispatch cancelable events on `document`:

```tsx
const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true });
document.dispatchEvent(wheel);
expect(wheel.defaultPrevented).toBe(true);
```

Verify disabled mode and `ctrlKey: false` leave wheel events uncancelled. Dispatch `new Event("gesturestart", { bubbles: true, cancelable: true })` and `gesturechange` while enabled and expect cancellation. Unmount or rerender disabled, dispatch fresh events, and expect they are no longer cancelled.

- [ ] **Step 2: Run the focused preference and guard tests and verify RED**

Run:

```bash
npm test -- tests/pinch-zoom-preference.test.ts tests/pinch-zoom-guard.test.tsx
```

Expected: FAIL because the preference module and guard component do not exist.

- [ ] **Step 3: Implement the minimal preference and pinch guard path**

Create `src/state/pinchZoomPreference.ts` with storage key `mygameslist:block-pinch-zoom:v1` and stored value `enabled`. Reads return true only for that exact value. Writes store only enabled mode; disabled mode removes the key. Catch storage errors while returning the requested current-session state.

Create `src/components/PinchZoomGuard.tsx` with one `useEffect`. When disabled, attach nothing. When enabled, install non-passive capture listeners on `document` for `wheel`, `gesturestart`, and `gesturechange`; prevent wheel only when `event.ctrlKey`, prevent both gesture events, and remove the exact listeners/options in cleanup. Render `null`.

Add explicit persistence setters to the two existing preference modules:

```ts
export function setSidebarLayoutMode(next: SidebarLayoutMode, storage?: Pick<Storage, "setItem" | "removeItem">): SidebarLayoutMode
export function setCompletedChecklistFilterEnabled(next: boolean, storage?: Pick<Storage, "setItem" | "removeItem">): boolean
```

Keep their current storage keys, defaults, and error behavior. Make the existing toggle functions call these setters so old callers and tests retain their contract.

- [ ] **Step 4: Re-run the focused preference and guard tests and verify GREEN**

Run the Step 2 command again. Expected: both files pass with no leaked listeners or warnings. Then run:

```bash
npm test -- tests/sidebar-layout-preference.test.ts tests/completed-checklist-filter-preference.test.ts
```

Expected: existing preference contracts still pass.

- [ ] **Step 5: Write failing dialog, header, application, and game-panel tests**

Create `tests/settings-dialog.test.tsx` against the real component. Assert:

- the accessible dialog name is `Настройки` and the exact introduction and all exact spec copy are visible;
- exactly two radios exist, named `Слева` and `Сверху`, each inside a skeleton preview card; selecting `Сверху` calls `onSidebarLayoutModeChange("top")` once;
- exactly two switches exist and are accessible from the single visible titles `Скрывать выполненные пункты` and `Отключить масштабирование жестом`;
- no second visible text such as `Скрывать выполненные` or `Блокировать pinch` is rendered beside a switch;
- each boolean change calls its explicit callback with the next checked value;
- close button, `Готово`, backdrop, and Escape call `onClose`;
- initial focus enters the dialog, Tab wraps, and unmount after close restores focus to the opener.

In the `AppShell` acceptance group, pass `onOpenSettings`, assert a button named `Настройки` appears between the random button and local-changes indicator, and click it to verify the callback.

Update game-page acceptance tests first so `.game-sidebar__tools` contains exactly the delete button when deletion is available and contains neither preference control. Keep assertions that `sidebarLayoutMode="top"` and `completedChecklistFilterEnabled` still affect rendering.

In `tests/app-selective-diff.test.tsx`, update the existing global-layout interaction to open settings and select the `Сверху` radio instead of using a game-panel button. Add an application integration path that opens settings from a non-game route, changes both boolean settings, navigates to a game to observe the checklist behavior, dispatches a cancelable `ctrlKey` wheel event to observe pinch cancellation, remounts to prove persistence, disables the settings, and verifies their keys are removed.

- [ ] **Step 6: Run the UI-focused tests and verify RED**

Run:

```bash
npm test -- tests/settings-dialog.test.tsx tests/ui-acceptance.test.tsx tests/app-selective-diff.test.tsx
```

Expected: FAIL because the header trigger/dialog do not exist and the game panel still owns the preference buttons.

- [ ] **Step 7: Implement the approved dialog and global state wiring**

Add `settings`, `panel-left`, `list-checks`, and `mouse-pointer` line paths to `IconName` and `paths` in `src/components/Icon.tsx`. Use `currentColor`, matching the existing stroke system.

Create `src/components/SettingsDialog.tsx`:

- return `null` when `open` is false;
- use the established `.modal-layer` backdrop pattern, dialog semantics, backdrop-only close, Escape handling, focus trap, and opener-focus restoration;
- render the exact Russian copy and structural invariants from the spec;
- use a native radio group for exactly two illustrated layout cards and native checkbox inputs for the two switches;
- connect the switch inputs to their single title/description with `aria-labelledby` and `aria-describedby` without rendering duplicate visible labels;
- apply changes immediately through the explicit callbacks and close only through the explicit close actions.

Modify `AppShell` so its required `onOpenSettings` callback is triggered by an icon-only button titled/named `Настройки` between `RandomGameButton` and `LocalChangesIndicator`.

In `LibraryRoutes`, add `settingsOpen` and `pinchZoomBlocked` state. Initialize all preferences from their loaders. Render `PinchZoomGuard`, pass the header open callback, and render `SettingsDialog` with explicit persistence setters. Keep the dialog available on every route. Pass only the layout/filter values through `GameRoute` to `GamePage`.

Remove `onToggleSidebarLayout` and `onToggleCompletedChecklistFilter` from `GamePageProps`, `GameRoute`, and `InlineGamePage`. Remove both related buttons from `.game-sidebar__tools`; retain delete only.

Export the new components from `src/components/index.ts`.

Implement `src/styles.css` from the approved reference: header trigger active/hover treatment, opaque settings dialog, 44px framed title icon, section icon blocks, two skeleton choice cards with selected accent/check, separators, right-aligned switches without adjacent labels, automatic-save footer, and narrow stacking below the existing mobile breakpoint. Reuse project color tokens rather than introducing a separate theme.

- [ ] **Step 8: Re-run the UI-focused tests and verify GREEN**

Run the Step 6 command again. Expected: all three files pass with no accessibility or React warnings.

- [ ] **Step 9: Run all directly affected tests**

Run:

```bash
npm test -- tests/settings-dialog.test.tsx tests/pinch-zoom-preference.test.ts tests/pinch-zoom-guard.test.tsx tests/sidebar-layout-preference.test.ts tests/completed-checklist-filter-preference.test.ts tests/sidebar-layout-css.test.ts tests/ui-acceptance.test.tsx tests/app-selective-diff.test.tsx tests/note-wheel-gesture.test.tsx
```

Expected: all focused behavior passes. The note wheel routing suite proves the new global guard did not alter ordinary note scrolling.

- [ ] **Step 10: Compare the implementation with the approved reference**

Run the local app and inspect the settings dialog directly against `/Users/kana/.codex/visualizations/2026/08/27/01a04356-c2d7-7283-a90a-4663a6a44332/settings-dialog-design.html` at `736px` and `360px`. Verify both layout-card selections and both switch off/on states. Confirm exactly one dialog, two layout cards, two switches, no duplicate switch labels, no clipping, and no horizontal overflow. Record the observed comparisons in the task report; correct every observable mismatch before review.

- [ ] **Step 11: Verify the repository and audit scope**

Run fresh:

```bash
npm test
npm run build
jj status
jj diff
```

Expected: the full suite passes, the production build exits zero, and the diff contains only this feature, its tests, spec, and plan.

- [ ] **Step 12: Review, finalize the single feature commit, and open a fresh change**

The implementer and task reviewer must both compare the final artifact directly with the approved reference before any commit. After task and final review findings are resolved and fresh verification is green, run:

```bash
jj describe -m "Add global client settings dialog"
jj new
```

