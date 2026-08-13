# Per-game CSS Mods and Xenoblade Chronicles 2 Theme Plan

> **For agentic workers:** execute each task through `superpowers:subagent-driven-development`. Use Jujutsu only; never invoke Git.

**Goal:** Add a build-time per-game CSS-mod mechanism and implement the approved Quest Deck v2 design as Xenoblade Chronicles 2's own `styles.css`.

**Architecture:** Optional `data/games/*/styles.css` files are read by a Vite virtual-CSS plugin, parsed, and selector-scoped to the escaped `#<game-id>` derived from the containing directory. `AppShell` receives the active existing-game id and changes only its root `id`; CSS activation is otherwise independent of runtime JavaScript. The virtual stylesheet is imported after the base CSS and bundled by Vite.

## Global constraints

- Approved visual: `.superpowers/brainstorm/25659-1786593616/content/quest-deck-v2.html`.
- Target id: `d4ea2f9f-aac0-4b02-8104-ed92ae3e0215`.
- Target mod: `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css`.
- Do not edit `src/styles.css` or add React decoration markup.
- No runtime theme registry, title/id comparison, conditional CSS import, external assets, fonts, packages, metrics, or network dependency.
- Preserve current content, DOM hierarchy, controls, source order, grouping, card spans, scrolling, editing, keyboard behavior, and drag/drop.
- Required viewports: `1440 × 900`, `980 × 900`, `390 × 844`.
- Required states: idle, hover, focus-visible, active/dragging, editing, error, complete.
- Keep the spec, plan, implementation, and permanent generic tests in one feature commit.

## Task 1: Put the active existing-game id on the application shell

**Files:** `src/components/AppShell.tsx`, `src/components/PageStickyChecklistHeading.tsx`, `src/App.tsx`, `tests/ui-acceptance.test.tsx`, and the focused sticky-heading test; correct the earlier provisional hook in `src/pages/GamePage.tsx`.

1. Write a failing generic AppShell contract test that renders with a fixture UUID, asserts the shell `id`, rerenders without an active id, and asserts removal. Preserve the new-game exclusion contract.
2. Add an optional `gameId` prop to AppShell and render it as the root `id`.
3. In `LibraryRoutes`, derive the active id only for an existing exact `/games/:id` route and pass it to AppShell. Do not compare against a specific game id or expose theme metadata.
4. Remove the provisional `data-game-id` hook from GamePage and update its test to the final root-id contract.
5. Keep sticky checklist-heading portals inside the nearest `.app-shell` so cloned game UI remains within the id scope; retain a body fallback for isolated component use.
6. Run focused tests RED then GREEN and inspect the scoped diff.

## Task 2: Build and validate the generic CSS-mod pipeline

**Files:** create `scripts/game-styles-plugin.ts` and `tests/game-styles-plugin.test.ts`; modify `vite.config.ts`, `src/main.tsx`, `src/source/assemble.ts`, `src/source/project.ts`, and focused generic source tests as needed.

1. Write failing tests with temporary generic game directories for deterministic optional `styles.css` discovery and compilation.
2. Parse stylesheets with the existing PostCSS build dependency. Prefix every selector with the escaped id selector; convert a leading `:scope` to the id itself. Cover comma selector lists, UUIDs beginning with digits, conditional grouping at-rules, and rejection of globally escaping constructs. Do not regex-rewrite CSS.
3. Expose the combined output as a Vite virtual CSS module for both serve and build, with relevant source files watched. Register the plugin before React and import the virtual CSS immediately after `src/styles.css`.
4. Accept only an optional root-level `styles.css` in each game source directory. Keep it opaque to the runtime database/projection, allow it in validated inventory, and ensure database publication leaves the unprojected base-tree file untouched.
5. Run focused plugin/source tests and build; inspect the scoped diff.

## Task 3: Author and visually verify the Xenoblade CSS mod

**File:** create `data/games/xenoblade-chronicles-2_d4ea2f9f-aac0-4b02-8104-ed92ae3e0215/styles.css` only.

1. Author selectors without a hard-coded id. Use `:scope` for the AppShell root and ordinary existing classes elsewhere.
2. Implement the approved layered canvas/header, identity rail, Quest Deck, Player Note, note cards, and especially the layered ice/dark/red checklist headings using procedural CSS.
3. Add explicit responsive and interaction-state rules. Prevent overflow and pointer interception.
4. Run focused tests, full tests, and build.
5. Compare reference and implementation directly at all required viewports/states; confirm one existing sidebar/notes container, all controls/groups, and a visually unchanged non-target game. Record evidence.

## Final review and completion

Run task-scoped reviews after each task, then a whole-feature code review. Apply all accepted findings through implementer subagents. Finally rerun the complete test suite and build, inspect `jj status` and `jj diff`, describe exactly one feature change, and create a fresh `jj new` working copy.
