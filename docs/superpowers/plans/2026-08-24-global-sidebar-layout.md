# Global Sidebar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one persistent browser-wide toggle that moves the game sidebar from the left to a horizontal row above the notes.

**Architecture:** A focused state helper owns the `side | top` localStorage contract. `LibraryRoutes` owns the single global React state and passes it through `GameRoute` to `GamePage`, which renders an accessible control and a layout modifier class. Shared CSS maps that modifier to the approved wide and narrow top layouts.

**Tech Stack:** React 19, TypeScript, CSS Grid, localStorage, Vitest, Testing Library, JSDOM, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-24-global-sidebar-layout-design.md`

## Global Constraints

- The `side` layout remains the default and existing game pages remain unchanged until the user toggles.
- One locally persisted `top` mode applies to all games and survives remount/reload.
- The layout button is first in `.game-sidebar__tools`, immediately before delete, with exact action labels `Переместить сайдбар наверх` and `Вернуть сайдбар слева`.
- Wide top mode is one page column with a `160px` cover, flexible details, and a `300px`–`420px` progress column; notes follow below at full width.
- At `720px` and narrower, top mode uses the compact two-column sidebar and full-width progress row.
- Existing shared visual tokens and responsive rules remain the source of colors, focus, hover, sizing, and mobile behavior.
- Use Jujutsu exclusively; finalize this feature as exactly one commit, then create a fresh working-copy change with `jj new`.
- Follow strict TDD and record actual RED/GREEN command output in the ignored task report.

---

### Task 1: Add the global persistent top-sidebar mode

**Files:**
- Create: `src/state/sidebarLayoutPreference.ts`
- Create: `tests/sidebar-layout-preference.test.ts`
- Create: `tests/sidebar-layout-css.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `tests/app-selective-diff.test.tsx`
- Modify: `tests/ui-acceptance.test.tsx`
- Include: `docs/superpowers/specs/2026-08-24-global-sidebar-layout-design.md`
- Include: `docs/superpowers/plans/2026-08-24-global-sidebar-layout.md`

**Interfaces:**
- Produces: `type SidebarLayoutMode = "side" | "top"`.
- Produces: `loadSidebarLayoutMode(storage?: Pick<Storage, "getItem">): SidebarLayoutMode`.
- Produces: `toggleSidebarLayoutMode(current: SidebarLayoutMode, storage?: Pick<Storage, "setItem" | "removeItem">): SidebarLayoutMode`.
- `GamePageProps` consumes `sidebarLayoutMode?: SidebarLayoutMode` and `onToggleSidebarLayout?: () => void`.

- [ ] **Step 1: Write failing public UI and CSS tests**

In `tests/app-selective-diff.test.tsx`, clear `localStorage` in `beforeEach` and add an integration test with two games. It must:

```tsx
expect(document.querySelector(".game-view-layout")).not.toHaveClass("game-view-layout--sidebar-top");
expect(screen.getByRole("button", { name: "Переместить сайдбар наверх" })).toHaveAttribute("aria-pressed", "false");

await user.click(screen.getByRole("button", { name: "Переместить сайдбар наверх" }));
expect(document.querySelector(".game-view-layout")).toHaveClass("game-view-layout--sidebar-top");
expect(screen.getByRole("button", { name: "Вернуть сайдбар слева" })).toHaveAttribute("aria-pressed", "true");
```

Navigate the same mounted `App` to the second game and assert the top class remains. Unmount and render again to prove browser persistence. Toggle back to side, remount once more, and assert the top class is absent.

In `tests/ui-acceptance.test.tsx`, render `GamePage` in top mode with both callbacks. Assert the modifier class exists, the layout button is the first tools button before delete, its pressed state/label is correct, and clicking it calls the no-argument callback once.

Create `tests/sidebar-layout-css.test.ts`. Install the real `src/styles.css`, build a minimal DOM with `.game-view-layout.game-view-layout--sidebar-top`, `.game-sidebar`, cover, `h1`, metadata, progress, tools, and error children. Assert computed desktop behavior:

```ts
expect(getComputedStyle(layout).gridTemplateColumns).toBe("minmax(0, 1fr)");
expect(getComputedStyle(sidebar).position).toBe("static");
expect(getComputedStyle(sidebar).display).toBe("grid");
expect(getComputedStyle(sidebar).gridTemplateColumns).toBe("160px minmax(160px, 1fr) minmax(300px, 420px)");
expect(getComputedStyle(cover).gridColumn).toBe("1");
expect(getComputedStyle(metadata).gridColumn).toBe("2");
expect(getComputedStyle(progress).gridColumn).toBe("3");
```

- [ ] **Step 2: Run public tests and verify RED**

Run:

```bash
npm test -- tests/app-selective-diff.test.tsx tests/ui-acceptance.test.tsx tests/sidebar-layout-css.test.ts
```

Expected: assertions fail because the layout control, modifier class, and top-layout CSS do not exist.

- [ ] **Step 3: Implement the normal preference, React, control, and layout path**

Create `src/state/sidebarLayoutPreference.ts` with key `mygameslist:sidebar-layout:v1`. On load, return `top` only when the stored value is exactly `top`; otherwise return `side`. On toggle, store `top` when entering top mode and remove the key when returning to side.

In `LibraryRoutes`, initialize one state with `loadSidebarLayoutMode`, update it with `toggleSidebarLayoutMode`, and pass the mode/callback only to the existing-game `GameRoute`. Forward both through `GameRoute` and `GamePageProps`. Default direct `GamePage` usage to `side`.

In `InlineGamePage`, add `game-view-layout--sidebar-top` only for top mode. Render the layout button before delete whenever its callback exists:

```tsx
<button
  aria-label={sidebarLayoutMode === "top" ? "Вернуть сайдбар слева" : "Переместить сайдбар наверх"}
  aria-pressed={sidebarLayoutMode === "top"}
  className="game-sidebar__layout-toggle"
  onClick={onToggleSidebarLayout}
  title={sidebarLayoutMode === "top" ? "Вернуть сайдбар слева" : "Переместить сайдбар наверх"}
  type="button"
>
  <Icon name={sidebarLayoutMode === "top" ? "expand-vertical" : "expand-horizontal"} size={15} />
</button>
```

In `src/styles.css`, add the desktop modifier rules:

```css
.game-view-layout.game-view-layout--sidebar-top { grid-template-columns: minmax(0, 1fr); }
.game-view-layout--sidebar-top .game-sidebar { position: static; display: grid; grid-template-columns: 160px minmax(160px, 1fr) minmax(300px, 420px); column-gap: 12px; align-items: start; padding-bottom: 10px; border-bottom: 1px solid var(--line-soft); }
.game-view-layout--sidebar-top .game-sidebar__cover,
.game-view-layout--sidebar-top .inline-cover-editor { grid-column: 1; grid-row: 1 / span 4; }
.game-view-layout--sidebar-top .game-sidebar h1 { grid-column: 2; grid-row: 1; margin-top: 0; }
.game-view-layout--sidebar-top .game-sidebar__meta { grid-column: 2; grid-row: 2; }
.game-view-layout--sidebar-top .game-sidebar__tools { grid-column: 2; grid-row: 3; }
.game-view-layout--sidebar-top .inline-save-error { grid-column: 2; grid-row: 4; }
.game-view-layout--sidebar-top .game-progress { grid-column: 3; grid-row: 1 / span 4; margin-top: 0; }
.game-sidebar__tools .game-sidebar__layout-toggle[aria-pressed="true"] { color: var(--accent); background: var(--surface-3); }
```

Within `@media (max-width: 720px)`, override top mode to the compact two-column sidebar: `112px minmax(0, 1fr)`, cover/details in their existing columns, and progress at `grid-column: 1 / -1; grid-row: auto`. Within `@media (max-width: 500px)`, reduce the top-mode cover column to `96px` to match the existing responsive rule.

- [ ] **Step 4: Run public tests and verify GREEN**

Run the Step 2 command again. Expected: all public UI and CSS tests pass.

- [ ] **Step 5: Write failing storage-error tests**

Create `tests/sidebar-layout-preference.test.ts` with small storage fakes. Verify exact normal persistence, invalid-value fallback, and throwing storage:

```ts
expect(loadSidebarLayoutMode(storageWith("top"))).toBe("top");
expect(loadSidebarLayoutMode(storageWith("unexpected"))).toBe("side");
expect(toggleSidebarLayoutMode("side", memoryStorage)).toBe("top");
expect(memoryStorage.getItem("mygameslist:sidebar-layout:v1")).toBe("top");
expect(toggleSidebarLayoutMode("top", memoryStorage)).toBe("side");
expect(memoryStorage.getItem("mygameslist:sidebar-layout:v1")).toBeNull();
expect(loadSidebarLayoutMode(throwingReadStorage)).toBe("side");
expect(toggleSidebarLayoutMode("side", throwingWriteStorage)).toBe("top");
```

Run:

```bash
npm test -- tests/sidebar-layout-preference.test.ts
```

Expected: the throwing-storage assertions fail before defensive handling is added.

- [ ] **Step 6: Add minimal storage failure handling and verify GREEN**

Wrap read and write/remove operations in `try/catch`. Loading failure returns `side`; persistence failure still returns the computed next mode so the current React session remains usable. Re-run the preference test and then all four focused files:

```bash
npm test -- tests/sidebar-layout-preference.test.ts
npm test -- tests/sidebar-layout-preference.test.ts tests/sidebar-layout-css.test.ts tests/app-selective-diff.test.tsx tests/ui-acceptance.test.tsx
```

Expected: all focused tests pass with pristine output.

- [ ] **Step 7: Verify the repository and audit scope**

Run:

```bash
npm test -- --exclude '.superpowers/workspaces/**'
npm run build
jj status
jj diff
```

Expected: the root suite passes, production build exits zero, and the diff contains only this feature plus its approved spec/plan.

- [ ] **Step 8: Finalize the single feature commit**

```bash
jj describe -m "Add global top sidebar layout"
jj new
```

