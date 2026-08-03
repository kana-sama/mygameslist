# Stable Columns for Collapsible Markdown Table Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Markdown table column widths identical to the fully expanded layout when a table group is collapsed, including after loading a saved collapsed state.

**Architecture:** Preserve the existing React markup and collapse-state flow. Change only the collapsed table-row-group CSS so the rows participate in intrinsic table sizing while taking no rendered height, then verify the behavior with the existing CSS regression test and a real Chromium layout check.

**Tech Stack:** React 19, TypeScript 7, CSS table layout, Vitest 4, Testing Library, Vite, in-app Chromium browser, Jujutsu.

## Global Constraints

- Every column must keep the width produced with all table groups expanded, including on the first render of a saved collapsed state.
- Each corresponding column width may differ by at most 0.5 CSS pixels between expanded and collapsed states.
- Collapsed group rows must have zero height, receive no pointer or keyboard interaction, and remain absent from the accessibility tree.
- Progress totals, completion styling, checkbox behavior, group headings, horizontal scrolling, and collapse-state persistence must not change.
- Do not add JavaScript measurement, resize observers, duplicate sizing rows, persisted pixel widths, or new dependencies.
- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.

---

## File Structure

- Modify `tests/notes-masonry-css.test.ts`: encode the required CSS contract for collapsed Markdown table row groups.
- Modify `src/styles.css`: keep a hidden table group in table layout with collapsed visibility.

### Task 1: Preserve intrinsic column sizing for collapsed groups

**Files:**

- Modify: `tests/notes-masonry-css.test.ts:109-123`
- Modify: `src/styles.css:368`

**Interfaces:**

- Consumes: the existing `.markdown-table-group__content[hidden]` selector and the `hidden={collapsed}` attribute emitted by `MarkdownView`.
- Produces: `.markdown-table-group__content[hidden] { display: table-row-group; visibility: collapse; }`, which remains a table sizing participant while occupying no row-group height.

- [ ] **Step 1: Write the failing CSS regression assertion**

In the existing test named `frames Markdown tables with compact collapsible group headings`, replace the old hidden-group assertion:

```ts
expect(hiddenGroup).toMatch(/display:\s*none/);
```

with the complete collapsed-layout contract:

```ts
expect(hiddenGroup).toMatch(/display:\s*table-row-group/);
expect(hiddenGroup).toMatch(/visibility:\s*collapse/);
expect(hiddenGroup).not.toMatch(/display:\s*none/);
```

- [ ] **Step 2: Run the targeted test and verify the new assertion fails**

Run:

```bash
npm test -- tests/notes-masonry-css.test.ts -t "frames Markdown tables with compact collapsible group headings"
```

Expected: FAIL because the current rule contains `display: none` and does not contain `display: table-row-group` or `visibility: collapse`.

- [ ] **Step 3: Implement the minimal table-layout fix**

Replace the current rule in `src/styles.css` with:

```css
.markdown-table-group__content[hidden] { display: table-row-group; visibility: collapse; }
```

Do not modify `src/components/Markdown.tsx`; its existing `hidden` attribute continues to provide the collapsed semantics and persisted-state behavior.

- [ ] **Step 4: Run the focused CSS and interaction tests**

Run:

```bash
npm test -- tests/notes-masonry-css.test.ts -t "frames Markdown tables with compact collapsible group headings"
npm test -- tests/markdown-tasks.test.tsx -t "collapses table groups independently"
```

Expected: both commands PASS. The interaction test must still find the expanded group's checkbox and must not expose the collapsed group's checkbox by role.

- [ ] **Step 5: Verify expanded, toggled-collapsed, and initially-collapsed layouts in Chromium**

Start the local application:

```bash
npm run dev -- --host 127.0.0.1
```

In the in-app browser, create and save one temporary note containing this fixture:

```markdown
| Stage | Main | Secret |
| --- | :---: | :---: |
| Short group |
| --- | --- | --- |
| Brief | [ ] | [ ] |
| --- | --- | --- |
| Wide group |
| --- | --- | --- |
| A deliberately wide stage name used for sizing | [ ] | [ ] |
```

With both groups expanded, record the three header widths. Collapse `Wide group`, record them again, reload the page while that group remains persisted as collapsed, and record them a third time. Use this browser-side measurement for each state:

```js
const table = [...document.querySelectorAll("table.markdown-table")]
  .find((candidate) => candidate.querySelector("thead")?.textContent?.includes("Stage"));
if (!table) throw new Error("Stable-column fixture table was not found");
const widths = [...table.querySelectorAll("thead th")]
  .map((cell) => cell.getBoundingClientRect().width);
const collapsedBody = table.querySelector(".markdown-table-group__content[hidden]");
({
  widths,
  collapsedDisplay: collapsedBody ? getComputedStyle(collapsedBody).display : null,
  collapsedVisibility: collapsedBody ? getComputedStyle(collapsedBody).visibility : null,
  collapsedHeight: collapsedBody ? collapsedBody.getBoundingClientRect().height : null,
});
```

Expected:

- each header width differs by no more than 0.5 CSS pixels across all three states;
- collapsed computed display is `table-row-group`;
- collapsed computed visibility is `collapse`;
- collapsed row-group height is `0`;
- the collapsed group's checkbox is absent from the browser accessibility snapshot and cannot be reached with Tab;
- the expanded group's checkbox remains available;
- expanding the group restores its controls without changing widths.

If Chromium does not preserve widths with `visibility: collapse`, stop before committing and replace Task 1 with the `<colgroup>` fallback described in the design specification; do not layer JavaScript measurement onto this CSS change without a revised plan.

Delete the temporary note after the check.

- [ ] **Step 6: Run the full project verification**

Run:

```bash
npm test
npm run build
npm run data:validate
```

Expected: all tests pass, the production build succeeds, and repository data validation succeeds.

- [ ] **Step 7: Inspect and commit only the implementation files**

Run:

```bash
jj status
jj diff
```

Confirm the working change contains only `src/styles.css` and `tests/notes-masonry-css.test.ts`, then finalize it:

```bash
jj describe -m "Keep grouped table columns stable"
jj new
```

Run `jj status` once more and confirm the new working-copy change is empty.
