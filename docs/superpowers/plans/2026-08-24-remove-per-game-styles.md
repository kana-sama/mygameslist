# Remove Per-Game Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove optional per-game CSS and leave `src/styles.css` as the only application design layer.

**Architecture:** Delete the Vite compiler and UI activation path, then simplify the source inventory and GitHub publisher by removing their opaque-stylesheet exception. The source validator becomes the boundary that rejects any future game-level `styles.css`.

**Tech Stack:** React 19, TypeScript, Vite 8, Vitest, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-24-remove-per-game-styles-design.md`

## Global Constraints

- `src/styles.css` remains the shared universal stylesheet.
- `data/games/*/styles.css` is unsupported and rejected by source validation.
- Remove runtime, build, publication, preference, UI, and test code used only by per-game styles.
- Historical documents under `docs/superpowers/` remain implementation records.
- Use Jujutsu exclusively; finalize this feature as exactly one commit, then create a fresh working-copy change with `jj new`.
- Follow strict TDD: first make consumer-visible tests fail for the missing removal behavior, then implement the minimum deletion/simplification that makes them pass.

---

### Task 1: Remove the per-game stylesheet feature end to end

**Files:**
- Delete: `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`
- Delete: `scripts/game-styles-plugin.ts`
- Delete: `src/state/gameStylePreferences.ts`
- Delete: `tests/game-styles-plugin.test.ts`
- Modify: `vite.config.ts`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/pages/GamePage.tsx`
- Modify: `src/styles.css`
- Modify: `src/source/assemble.ts`
- Modify: `src/source/project.ts`
- Modify: `src/source/types.ts`
- Modify: `src/state/githubGitDatabaseSync.ts`
- Modify: `tests/ui-acceptance.test.tsx`
- Modify: `tests/app-selective-diff.test.tsx`
- Modify: `tests/source-roundtrip.test.ts`
- Modify: `tests/github-git-database-sync.test.ts`
- Include: `docs/superpowers/specs/2026-08-24-remove-per-game-styles-design.md`
- Include: `docs/superpowers/plans/2026-08-24-remove-per-game-styles.md`

**Interfaces:**
- Consumes: the existing shared `src/styles.css`, `AppShell`, `GamePage`, source projection/inventory validation, and GitHub tree publication.
- Produces: a universal-style application with no per-game CSS APIs and a source validator that rejects a game-root `styles.css`.

- [ ] **Step 1: Write failing removal tests**

Replace the AppShell activation test with consumer-visible assertions that the shell no longer accepts or emits a game id, and replace the browser preference integration test with an assertion that an existing game page has no custom-style control:

```tsx
const view = render(
  <AppShell onOpenDiff={vi.fn()} route="game" storage={{ bytes: 0, operationCount: 0 }}>
    <div>Игра</div>
  </AppShell>,
);
expect(view.container.firstElementChild).not.toHaveAttribute("id");

render(<App />);
expect(screen.queryByRole("button", { name: /кастомные стили/i })).not.toBeInTheDocument();
```

Change the generic source tests so both filesystem assembly and projected inventory validation reject a game-root stylesheet as an unknown entry:

```ts
const stylesheetPath = `${GAME_A_DIRECTORY}/styles.css`;
await expect(assembleLibrarySource(
  [...projectedEntries(), { kind: "file", path: stylesheetPath }],
  reader,
)).rejects.toThrow(`unknown game source entry ${stylesheetPath}`);

expect(() => validateProjectedSourceInventory(projection, [
  ...inventoryEntries,
  sourceEntry(stylesheetPath, "file"),
])).toThrow(`Unexpected source inventory entry ${stylesheetPath}`);
```

Remove tests that specify successful stylesheet compilation, browser persistence of the old theme toggle, stylesheet preservation during moves/publication, or the deleted `optionalGameStylesByGameId` return value.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/ui-acceptance.test.tsx tests/app-selective-diff.test.tsx tests/source-roundtrip.test.ts tests/github-git-database-sync.test.ts
```

Expected: the new UI/source rejection expectations fail because the app still exposes custom-style activation and source validation still accepts root game stylesheets.

- [ ] **Step 3: Remove build and UI activation code**

Delete `scripts/game-styles-plugin.ts`, its dedicated test, and `src/state/gameStylePreferences.ts`. Remove `gameStylesPlugin(...)` from `vite.config.ts` and remove the `virtual:mygameslist-game-styles.css` import from `src/main.tsx` while retaining:

```ts
import "./styles.css";
```

Remove `activeGameIdForRoute`, disabled-style state, `gameId` activation, `customStylesEnabled`, `onToggleCustomStyles`, and the style-toggle button throughout `App.tsx`, `AppShell.tsx`, and `GamePage.tsx`. Remove only the obsolete pressed-style selector from `src/styles.css`; keep the shared sidebar tools and delete button styles.

- [ ] **Step 4: Remove source and publication exceptions**

In `src/source/assemble.ts`, allow only `game.yaml` as a game-root file. In `src/source/project.ts`, delete `optionalOpaqueInventory` and validate entries solely against the projected required inventory. In `src/source/types.ts`, remove `ValidatedSourceInventory.optionalGameStylesByGameId`.

In `src/state/githubGitDatabaseSync.ts`, remove the remote optional-style map, its inventory conversion, and the publication loop that reuses/moves the old stylesheet blob. Delete or simplify fixtures and assertions in `tests/github-git-database-sync.test.ts` that exist only for that behavior.

Delete the authored Xenoblade stylesheet.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/ui-acceptance.test.tsx tests/app-selective-diff.test.tsx tests/source-roundtrip.test.ts tests/github-git-database-sync.test.ts
```

Expected: all focused tests pass with pristine output.

- [ ] **Step 6: Audit feature removal**

Run:

```bash
rg -n 'gameStylesPlugin|virtual:mygameslist-game-styles|gameStylePreferences|customStylesEnabled|onToggleCustomStyles|optionalGameStylesByGameId|game-sidebar__style-toggle' src scripts tests vite.config.ts
find data/games -name styles.css -print
```

Expected: both commands produce no matches/output. References to shared `src/styles.css` and historical documents are allowed.

- [ ] **Step 7: Verify the complete repository**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and the production build exits zero with pristine output.

- [ ] **Step 8: Inspect and finalize the single feature commit**

Run `jj status` and `jj diff`, confirm the change includes only this feature and its approved spec/plan, then finalize:

```bash
jj describe -m "Remove per-game styles"
jj new
```

