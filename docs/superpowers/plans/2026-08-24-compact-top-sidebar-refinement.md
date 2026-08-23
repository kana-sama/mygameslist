# Compact Top Sidebar Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pack cover, bounded details, and progress at the left; leave only progress surplus before far-right vertical layout/delete tools; and remove the rendered `Изменено` row.

**Architecture:** Preserve the existing React and persistence implementation. Refine only the top-mode CSS grid and its computed-style contract, with canonical design prose updated to describe the corrected structure.

**Tech Stack:** CSS Grid, TypeScript, Vitest, JSDOM, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-24-compact-top-sidebar-refinement-design.md`

## Global Constraints

- Normative references: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_t3hJyf/Screenshot 2026-08-24 at 03.04.14.png`, `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_elXdzC/Screenshot 2026-08-24 at 03.15.14.png`, and `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_vzjXtZ/Screenshot 2026-08-24 at 03.24.10.png`.
- Horizontal order is cover → bounded details → left-packed progress → unused space → far-right vertical tools.
- Wide columns are exactly `160px minmax(320px, 360px) minmax(0, 1fr) auto`.
- Top-mode progress uses exactly `repeat(auto-fit, minmax(88px, 96px))` and start justification.
- Cover is column 1 across rows 1–2; vertical tools use the far-right auto column across those rows; inline errors are details column row 3. Progress stays adjacent to details and has all unused space before the far-right tools.
- Remove the rendered `Изменено` metadata row globally. Under normal no-error wide content, the panel is no taller than the cover.
- Top-mode titles truncate visibly to one line without changing their accessible name or inline editing behavior.
- From 1020–1100px, use `160px 320px minmax(0, 1fr) 26px` with 10px gaps so five normal progress cells stay on one row. At `1019px` and narrower, use `112px minmax(0, 1fr) 26px`, with the dedicated third tools column and progress in the full-width following row; `500px` uses `96px minmax(0, 1fr) 26px`.
- Persistence, controls, side mode, progress card dimensions, note layout, and shared interaction styles do not change.
- Use Jujutsu exclusively; finalize this correction as exactly one descendant commit, then create a fresh working-copy change with `jj new`.
- Follow strict TDD and record actual RED/GREEN output in the ignored task report.

---

### Task 1: Compact the top-sidebar grid

**Files:**
- Modify: `tests/sidebar-layout-css.test.ts`
- Modify: `src/styles.css`
- Modify: `DESIGN.md`
- Include: `docs/superpowers/specs/2026-08-24-compact-top-sidebar-refinement-design.md`
- Include: `docs/superpowers/plans/2026-08-24-compact-top-sidebar-refinement.md`

**Interfaces:**
- Consumes: `.game-view-layout--sidebar-top`, its existing sidebar children, and `.game-progress__grid`.
- Produces: corrected computed layout geometry; no TypeScript or React interface changes.

- [ ] **Step 1: Tighten the computed-style contract before CSS changes**

In `tests/sidebar-layout-css.test.ts`, append a `.game-progress__grid` child inside the existing progress fixture and replace/extend the assertions:

```ts
expect(getComputedStyle(sidebar).gridTemplateColumns).toBe("160px minmax(320px, 360px) minmax(0, 1fr) auto");
expect(getComputedStyle(cover).gridColumn).toBe("1");
expect(getComputedStyle(cover).gridRow).toBe("1 / span 2");
expect(getComputedStyle(metadata).gridColumn).toBe("2");
expect(getComputedStyle(progress).gridColumn).toBe("3");
expect(getComputedStyle(progressGrid).gridTemplateColumns).toBe("repeat(auto-fit, minmax(88px, 96px))");
expect(getComputedStyle(progressGrid).justifyContent).toBe("start");
expect(getComputedStyle(tools).gridColumn).toBe("4");
expect(getComputedStyle(tools).gridRow).toBe("1 / span 2");
expect(getComputedStyle(tools).flexDirection).toBe("column");
expect(getComputedStyle(error).gridColumn).toBe("2");
expect(getComputedStyle(error).gridRow).toBe("3");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/sidebar-layout-css.test.ts
```

Expected: FAIL with the old stretching columns, four-row cover span, center-column tools, and fixed three-column progress grid.

- [ ] **Step 3: Apply the compact wide and narrow CSS geometry**

In `src/styles.css`:

```css
.game-view-layout--sidebar-top .game-sidebar { grid-template-columns: 160px minmax(320px, 360px) minmax(0, 1fr) auto; ... }
.game-view-layout--sidebar-top .game-sidebar__cover,
.game-view-layout--sidebar-top .inline-cover-editor { grid-column: 1; grid-row: 1 / span 2; }
.game-view-layout--sidebar-top .game-sidebar__tools { grid-column: 4; grid-row: 1 / span 2; flex-direction: column; }
.game-view-layout--sidebar-top .inline-save-error { grid-column: 2; grid-row: 3; }
.game-view-layout--sidebar-top .game-progress { grid-column: 3; grid-row: 1 / span 3; margin-top: 0; }
.game-view-layout--sidebar-top .game-progress__grid { grid-template-columns: repeat(auto-fit, minmax(88px, 96px)); justify-content: start; }
```

Add the `1020px`–`1100px` compact-wide adjustment and update `@media (max-width: 1019px)` top-mode rules so the cover remains in column 1, a dedicated third 26px column holds vertical tools, inline errors occupy column 2 row 3, and progress occupies columns 1 through -1 at row 4. Keep the `112px` and `96px` responsive cover-column widths, append the 26px tools track, and remove the rendered `Изменено` metadata row.

In `DESIGN.md`, extend the game-page layout paragraph with the compact top-mode contract: bounded details, left-packed auto-fit progress, far-right vertical controls, and unused space between them.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/sidebar-layout-css.test.ts tests/ui-acceptance.test.tsx tests/app-selective-diff.test.tsx tests/sidebar-layout-preference.test.ts
```

Expected: all focused layout, control, persistence, and navigation tests pass.

- [ ] **Step 5: Verify the root repository and build**

Run:

```bash
npm test -- --exclude '.superpowers/workspaces/**'
npm run build
```

Expected: the root suite passes and the production build exits zero. Existing JSDOM navigation notices and Vite chunk-size warning may remain but no new warnings are introduced.

- [ ] **Step 6: Inspect and finalize the descendant correction commit**

Run `jj status` and `jj diff`; compare the result directly with the normative screenshot and specification, confirming all structural invariants. Then finalize:

```bash
jj describe -m "Compact the top sidebar layout"
jj new
```
