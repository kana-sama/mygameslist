# Table Checkbox Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give checked table cells, fully checked rows, and fully checked columns a shared green background.

**Architecture:** Derive column completion from the existing parsed table rows inside `MarkdownRenderBody`, expose completion through data attributes on rendered cells, and keep the existing completed-row class. CSS applies one success wash to all three states without persisting any new state.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, CSS, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- A row or column is complete only when it contains at least one checkbox and every checkbox it contains is active.
- Non-checkbox cells do not prevent row or column completion.
- A complete column includes its `thead` header and every ordinary `td` at that column index; spanning table-group headers are not column cells.
- Preserve current table parsing, alignment, group rendering, source checkbox updates, and completed-row text color.
- Follow test-driven development: add the behavioral test, observe its expected failure, then add the minimum production change.
- Finish this feature as exactly one Jujutsu commit containing this specification, plan, implementation, and test.

---

### Task 1: Render the three green completion levels

**Files:**
- Modify: `src/components/Markdown.tsx`
- Modify: `src/styles.css`
- Test: `tests/markdown-tasks.test.tsx`
- Include: `docs/superpowers/specs/2026-08-13-table-checkbox-backgrounds-design.md`
- Include: `docs/superpowers/plans/2026-08-13-table-checkbox-backgrounds.md`

**Interfaces:**
- Consumes: `MarkdownTable.sections`, `MarkdownTableRow.cells`, and `getTableRowProgress(row)`.
- Produces: `data-checklist-checked="true"` on active task cells and `data-checklist-column-complete="true"` on every header/body cell in a complete column.

- [ ] **Step 1: Write the failing rendering test**

Add a test to `tests/markdown-tasks.test.tsx` that renders:

```tsx
const markdown = [
  "| Stage | Main | Secret |",
  "| --- | --- | --- |",
  "| Start | [x] | [x] |",
  "| Finish | [x] | [ ] |",
].join("\n");
```

Assert literal observable markers:

```tsx
const startRow = screen.getByText("Start").closest("tr")!;
const finishRow = screen.getByText("Finish").closest("tr")!;
const mainHeader = screen.getByRole("columnheader", { name: "Main" });
const secretHeader = screen.getByRole("columnheader", { name: "Secret" });

expect(startRow).toHaveClass("markdown-table-row--complete");
expect(finishRow).not.toHaveClass("markdown-table-row--complete");
expect(startRow.querySelectorAll('[data-checklist-checked="true"]')).toHaveLength(2);
expect(finishRow.querySelectorAll('[data-checklist-checked="true"]')).toHaveLength(1);
expect(mainHeader).toHaveAttribute("data-checklist-column-complete", "true");
expect(secretHeader).not.toHaveAttribute("data-checklist-column-complete");
expect(screen.getByRole("checkbox", { name: "Снять отметку: Start — Main" }).closest("td")).toHaveAttribute("data-checklist-column-complete", "true");
expect(screen.getByRole("checkbox", { name: "Снять отметку: Finish — Main" }).closest("td")).toHaveAttribute("data-checklist-column-complete", "true");
```

The production break this catches is omitting any one of the cell, row, header-column, or body-column completion markers.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "green backgrounds for checked cells"
```

Expected: FAIL because checked cells and complete columns do not yet expose the required data attributes.

- [ ] **Step 3: Compute completed columns and render data attributes**

In `renderTable`, flatten all `section.rows` and derive one boolean per header index:

```ts
const rows = table.sections.flatMap((section) => section.rows);
const completedColumns = table.headers.map((_header, cellIndex) => {
  const taskCells = rows
    .map((row) => row.cells[cellIndex])
    .filter((cell) => cell?.taskChecked !== undefined);
  return taskCells.length > 0 && taskCells.every((cell) => cell.taskChecked);
});
```

Set `data-checklist-column-complete={completedColumns[cellIndex] || undefined}` on every ordinary `th` and `td`. Set `data-checklist-checked={cell.taskChecked || undefined}` on task-bearing `td` elements.

- [ ] **Step 4: Add the shared green background**

Add `--success-wash: rgba(111, 166, 134, .16);` beside `--success`. Apply `background: var(--success-wash)` to checked task cells, cells and headers marked as complete columns, and every `td` in `.markdown-table-row--complete`. Keep the existing success text rules.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx
```

Expected: PASS with no warnings or errors.

- [ ] **Step 6: Finalize the feature commit**

Inspect only this feature with `jj status` and `jj diff`. Run `jj describe -m "Add green table checkbox completion backgrounds"`, then `jj new` so the finalized commit remains immutable.
