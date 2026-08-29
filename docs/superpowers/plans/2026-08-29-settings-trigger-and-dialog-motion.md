# Settings Trigger Order and Dialog Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the settings trigger at the far right of the header and add reversible settings-dialog motion with a real exit lifecycle.

**Architecture:** `AppShell` changes only action ordering. `SettingsDialog` owns a small rendered/open lifecycle so a closed prop can enter a temporary exiting state before unmount; CSS state selectors own the visual motion and reduced-motion behavior.

**Tech Stack:** React 19, TypeScript, CSS animations, Vitest, Testing Library, JSDOM, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-29-settings-trigger-and-dialog-motion-design.md`

## Global Constraints

- Settings is the final child of `.app-header__actions`, after `Добавить игру`.
- Opening and closing both animate for approximately 160 milliseconds.
- The closing layer becomes non-interactive and is removed only after its exit lifecycle delay.
- Escape, backdrop, close button, `Готово`, focus trap, and original-trigger focus restoration retain their behavior.
- `prefers-reduced-motion: reduce` effectively removes visual motion.
- Do not change setting persistence, copy, dialog layout, or any game-page behavior.
- Finalize the complete correction as exactly one Jujutsu commit, then open a fresh working-copy change.

---

### Task 1: Reorder the trigger and add reversible dialog motion

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/styles.css`
- Modify: `tests/ui-acceptance.test.tsx`
- Modify: `tests/settings-dialog.test.tsx`
- Modify: `tests/sidebar-layout-css.test.ts`
- Include: `docs/superpowers/specs/2026-08-29-settings-trigger-and-dialog-motion-design.md`
- Include: `docs/superpowers/plans/2026-08-29-settings-trigger-and-dialog-motion.md`

**Interfaces:**
- `AppShell` keeps its existing props and moves the existing `.app-header__settings` element after `.button--new-game`.
- `SettingsDialog` keeps its existing props. When `open` changes from `true` to `false`, its DOM remains temporarily with `data-state="closing"`, `aria-hidden="true"`, and no pointer interaction, then unmounts after the exit duration.
- When `open` is true, the rendered layer exposes `data-state="open"`.

- [ ] **Step 1: Write failing behavior tests**

Update the AppShell acceptance test so it asserts the settings button is `actions.lastElementChild` and immediately follows the new-game action. Add a fake-timer dialog test that renders open, rerenders closed, observes a closing DOM layer, advances past the exit duration, and observes removal. Extend CSS acceptance to require open/closing animation selectors and a `prefers-reduced-motion: reduce` override.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/settings-dialog.test.tsx tests/ui-acceptance.test.tsx tests/sidebar-layout-css.test.ts
```

Expected: FAIL because settings is not rightmost and the dialog currently unmounts immediately without motion states.

- [ ] **Step 3: Implement minimal behavior**

Move the existing settings button after the new-game link. In `SettingsDialog`, add internal rendered state and an approximately 170 millisecond cleanup delay around a 160 millisecond exit animation. Cancel a pending exit when reopened. Keep focus restoration driven by `open`, mark the temporary closing layer hidden from accessibility, and make it non-interactive. Add restrained backdrop/dialog in/out keyframes and a reduced-motion media query.

- [ ] **Step 4: Verify GREEN and regressions**

Re-run the focused command from Step 2, then run:

```bash
npm test
npm run build
```

Expected: all tests and production build pass; only the pre-existing Monaco chunk-size advisory may remain.

- [ ] **Step 5: Review and finalize**

Inspect `jj status` and `jj diff`; obtain task and final review. Resolve all Critical and Important findings. Then run fresh full verification, `jj describe -m "Move settings trigger and animate dialog"`, and `jj new`.

