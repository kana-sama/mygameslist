# Note Column Minimum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the ordinary note-column minimum from `360px` to `350px` without changing any other layout measurement.

**Architecture:** Keep the existing shared CSS custom property as the single layout control for rendered and editing grids. Add a computed-style contract test and update the canonical design prose alongside the one-value stylesheet change.

**Tech Stack:** CSS, TypeScript, Vitest, JSDOM, Jujutsu

**Spec:** `docs/superpowers/specs/2026-08-24-note-column-minimum-design.md`

## Global Constraints

- `.notes-list` and `.note-editors-grid` use a `350px` minimum column width.
- Existing grid topology, responsive breakpoints, drag preview width, and unrelated `360px` values remain unchanged.
- `DESIGN.md` describes the same `350px` contract.
- Use Jujutsu exclusively; finalize this feature as exactly one commit, then create a fresh working-copy change with `jj new`.
- Follow strict TDD: the computed-style test must fail with the existing `360px` value before production CSS changes.

---

### Task 1: Reduce the shared note-column minimum

**Files:**
- Create: `tests/note-layout-css.test.ts`
- Modify: `src/styles.css`
- Modify: `DESIGN.md`
- Include: `docs/superpowers/specs/2026-08-24-note-column-minimum-design.md`
- Include: `docs/superpowers/plans/2026-08-24-note-column-minimum.md`

**Interfaces:**
- Consumes: the existing `.notes-list, .note-editors-grid` shared CSS rule and Vitest JSDOM environment.
- Produces: a computed `--note-column-min` value of `350px` for both grid variants.

- [ ] **Step 1: Write the failing computed-style test**

Create `tests/note-layout-css.test.ts`. Load the real stylesheet, install it in a `<style>` element, append one rendered-note grid and one editor grid, then assert their consumer-visible computed property:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  document.head.querySelectorAll("style[data-note-layout-test]").forEach((style) => style.remove());
  document.body.replaceChildren();
});

describe("note column layout", () => {
  it("lets rendered and editing note columns shrink to 350px before wrapping", () => {
    const style = document.createElement("style");
    style.dataset.noteLayoutTest = "true";
    style.textContent = productionStyles;
    document.head.append(style);

    for (const className of ["notes-list", "note-editors-grid"]) {
      const grid = document.createElement("div");
      grid.className = className;
      document.body.append(grid);
      expect(getComputedStyle(grid).getPropertyValue("--note-column-min").trim()).toBe("350px");
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/note-layout-css.test.ts
```

Expected: FAIL because the computed value is still `360px`.

- [ ] **Step 3: Apply the minimal stylesheet and design update**

Change only the shared custom property in `src/styles.css`:

```css
.notes-list, .note-editors-grid { --note-column-min: 350px; ... }
```

In `DESIGN.md`, change the note-grid minimum in the layout description from `360px` to `350px`. Do not change the unrelated global-search height, drag-preview width, test fixture rectangles, or responsive one-column rule.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- tests/note-layout-css.test.ts
```

Expected: the focused test passes with pristine output.

- [ ] **Step 5: Verify the complete repository**

Run:

```bash
npm test -- --exclude '.superpowers/workspaces/**'
npm run build
```

Expected: the root repository suite passes when unrelated nested workspaces are excluded, and the production build exits zero.

- [ ] **Step 6: Inspect and finalize the single feature commit**

Run `jj status` and `jj diff`; confirm only this feature and its spec/plan are present. Then finalize:

```bash
jj describe -m "Reduce note column minimum"
jj new
```

