# Markdown Table Row Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the agreed framed one-cell Markdown table syntax as independently collapsible row groups with checklist totals and completed styling.

**Architecture:** Extend the private Markdown table model from one flat `rows` array to ordered row sections and group sections. Parse only the exact framed group syntax, calculate group and table progress from the same physical rows, assign semantic collapse IDs during block annotation, and render each group as a full-width heading plus a separately hideable table body.

**Tech Stack:** React 19, TypeScript 7, Vitest 4, Testing Library, CSS, Jujutsu

## Global Constraints

- Use Jujutsu (`jj`) exclusively for repository status, diff, history, and commit operations.
- Run on Node.js `>=22.13.0`.
- The accepted syntax is `delimiter → one-cell title → delimiter`; the standard header delimiter is the opening delimiter of the first group.
- A later group must retain the delimiter above its title so the raw Markdown visibly separates it from the preceding data row.
- Group progress is `N/M`; completion color applies only when `M > 0` and `N = M`.
- Groups without checkboxes remain collapsible but show no progress and never receive completion color.
- Existing GFM tables, inline formatting, alignment, escaped pipes, checkbox source updates, completed-row styling, and heading totals must remain unchanged.
- Collapse state uses the existing `collapsedChecklistSections` field and stays stable when unrelated text is inserted above the table.
- Follow test-driven development: add one behavioral test, observe its expected failure, then add the minimum production change.

---

### Task 1: Parse and render framed table groups

**Files:**
- Modify: `src/components/Markdown.tsx:77-360`
- Modify: `src/components/Markdown.tsx:850-925`
- Test: `tests/markdown-tasks.test.tsx:190-268`

**Interfaces:**
- Consumes: existing `splitTableLine(line: string)`, `TASK_MARKER`, `ChecklistProgress`, `renderInline`, and table checkbox rendering.
- Produces: private `MarkdownTableSection`, `MarkdownTableGroup`, and group-aware `MarkdownTable.sections` used by Tasks 2 and 3.

- [ ] **Step 1: Add a failing rendering-and-progress test**

Add this test immediately after the existing arbitrary GFM table test:

```tsx
it("renders framed one-cell rows as table groups", () => {
  const markdown = [
    "# Campaign",
    "| Stage | Main | Secret |",
    "| --- | :---: | :---: |",
    "| Philosopher's Stone |",
    "| --- | --- | --- |",
    "| Start | [x] | [ ] |",
    "| Finish | [x] | [x] |",
    "| --- | --- | --- |",
    "| Chamber of Secrets |",
    "| --- | --- | --- |",
    "| Dobby | [x] | [x] |",
  ].join("\n");

  render(<MarkdownView markdown={markdown} />);

  const stoneHeading = screen.getByText("Philosopher's Stone").closest("th");
  const chamberHeading = screen.getByText("Chamber of Secrets").closest("th");
  expect(stoneHeading).toHaveAttribute("colspan", "3");
  expect(chamberHeading).toHaveAttribute("colspan", "3");
  expect(stoneHeading?.querySelector(".markdown-checklist-progress")).toHaveTextContent("3/4");
  expect(chamberHeading?.querySelector(".markdown-checklist-progress")).toHaveTextContent("2/2");
  expect(stoneHeading?.closest(".markdown-table-group")).not.toHaveClass("markdown-table-group--complete");
  expect(chamberHeading?.closest(".markdown-table-group")).toHaveClass("markdown-table-group--complete");
  expect(screen.getByRole("heading", { name: /^Campaign / }).querySelector(".markdown-checklist-progress")).toHaveTextContent("5/6");
  expect(screen.getAllByRole("row")).toHaveLength(6);
});
```

- [ ] **Step 2: Run the new test and verify the expected failure**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "renders framed one-cell rows as table groups"
```

Expected: FAIL because `Philosopher's Stone` is currently rendered as a padded ordinary `<td>` row and the delimiter lines appear as data rows.

- [ ] **Step 3: Add a second failing test for source-accurate checkbox updates**

```tsx
it("updates only the selected grouped-table task and completes its group", async () => {
  const user = userEvent.setup();
  let currentMarkdown = [
    "# Route",
    "| Stage | Main | Secret |",
    "| --- | --- | --- |",
    "| Philosopher's Stone |",
    "| --- | --- | --- |",
    "| Start | [x] | [ ] |",
    "| --- | --- | --- |",
    "| Chamber of Secrets |",
    "| --- | --- | --- |",
    "| Dobby | [ ] | [ ] |",
  ].join("\r\n");
  const expectedMarkdown = currentMarkdown.replace("| Start | [x] | [ ] |", "| Start | [x] | [x] |");
  let view: ReturnType<typeof render>;
  const onTaskChange = vi.fn((nextMarkdown: string) => {
    currentMarkdown = nextMarkdown;
    view.rerender(<MarkdownView markdown={currentMarkdown} onTaskChange={onTaskChange} />);
  });
  view = render(<MarkdownView markdown={currentMarkdown} onTaskChange={onTaskChange} />);

  await user.click(screen.getByRole("checkbox", { name: "Отметить: Start — Secret" }));

  expect(onTaskChange).toHaveBeenCalledWith(expectedMarkdown);
  expect(screen.getByText("Philosopher's Stone").closest(".markdown-table-group")).toHaveClass("markdown-table-group--complete");
  expect(screen.getByText("Chamber of Secrets").closest(".markdown-table-group")).not.toHaveClass("markdown-table-group--complete");
  expect(screen.getByRole("heading", { name: /^Route / }).querySelector(".markdown-checklist-progress")).toHaveTextContent("2/4");
});
```

- [ ] **Step 4: Run both new tests and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "framed one-cell|selected grouped-table task"
```

Expected: both tests FAIL because no table-group heading, total, or completion state exists yet. The checkbox callback may already preserve the selected physical marker, but the group assertions must fail.

- [ ] **Step 5: Replace the flat table model with ordered sections**

In `src/components/Markdown.tsx`, replace `MarkdownTable.rows` with these private types:

```ts
interface MarkdownTableRows {
  type: "rows";
  rows: MarkdownTableRow[];
}

interface MarkdownTableGroup {
  type: "group";
  title: MarkdownTableCell;
  titleSourceLine: number;
  rows: MarkdownTableRow[];
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
}

type MarkdownTableSection = MarkdownTableRows | MarkdownTableGroup;

interface MarkdownTable {
  alignments: MarkdownTableAlignment[];
  headers: MarkdownTableCell[];
  sections: MarkdownTableSection[];
}
```

Add exact delimiter and group-header recognition helpers next to `parseTableStart`:

```ts
function parseTableDelimiter(line: string, columnCount: number): ParsedTableCell[] | null {
  const cells = splitTableLine(line);
  if (!cells || cells.length !== columnCount) return null;
  return cells.every((cell) => /^:?-+:?$/.test(cell.value)) ? cells : null;
}

interface ParsedTableGroupHeader {
  nextIndex: number;
  sourceLine: number;
  title: MarkdownTableCell;
}

function parseTableGroupHeader(
  lines: readonly string[],
  index: number,
  columnCount: number,
  useHeaderDelimiter: boolean,
): ParsedTableGroupHeader | null {
  const titleIndex = useHeaderDelimiter ? index : index + 1;
  if (!useHeaderDelimiter && !parseTableDelimiter(lines[index] ?? "", columnCount)) return null;
  const titleCells = splitTableLine(lines[titleIndex] ?? "");
  if (titleCells?.length !== 1 || !titleCells[0].value.trim()) return null;
  if (!parseTableDelimiter(lines[titleIndex + 1] ?? "", columnCount)) return null;
  return {
    nextIndex: titleIndex + 2,
    sourceLine: titleIndex,
    title: { value: titleCells[0].value },
  };
}
```

Update `parseTableStart` to call `parseTableDelimiter(lines[startIndex + 1], headerCells.length)` so delimiter validation has one implementation.

- [ ] **Step 6: Parse sections without losing physical checkbox locations**

Extract the current cell conversion into this helper:

```ts
function parseTableRow(parsedCells: readonly ParsedTableCell[], columnCount: number, sourceLine: number): MarkdownTableRow {
  const cells = parsedCells.slice(0, columnCount).map<MarkdownTableCell>((cell) => {
    const task = TASK_MARKER.exec(cell.value);
    return {
      value: task ? cell.value.slice(task[0].length) : cell.value,
      taskChecked: task ? task[1].toLowerCase() === "x" : undefined,
      taskSourceColumn: task ? cell.sourceColumn : undefined,
    };
  });
  while (cells.length < columnCount) cells.push({ value: "" });
  return { cells, sourceLine };
}
```

Rewrite the body of `parseTable` around this state machine:

```ts
const sections: MarkdownTableSection[] = [];
let looseRows: MarkdownTableRow[] = [];
let activeGroup: MarkdownTableGroup | null = null;
let index = startIndex + 2;

const flushLooseRows = (): void => {
  if (!looseRows.length) return;
  sections.push({ type: "rows", rows: looseRows });
  looseRows = [];
};

while (index < lines.length && lines[index].trim()) {
  if (isTableBlockBoundary(lines[index])) break;
  const groupHeader = parseTableGroupHeader(
    lines,
    index,
    start.headers.length,
    index === startIndex + 2,
  );
  if (groupHeader) {
    flushLooseRows();
    activeGroup = {
      type: "group",
      title: groupHeader.title,
      titleSourceLine: groupHeader.sourceLine,
      rows: [],
    };
    sections.push(activeGroup);
    index = groupHeader.nextIndex;
    continue;
  }

  const parsedCells = splitTableLine(lines[index]);
  if (!parsedCells) break;
  const row = parseTableRow(parsedCells, start.headers.length, index);
  if (activeGroup) activeGroup.rows.push(row);
  else looseRows.push(row);
  index += 1;
}
flushLooseRows();

return {
  block: { type: "table", table: { ...start, sections } },
  nextIndex: index,
};
```

Define the boundary helper with the existing five predicates:

```ts
function isTableBlockBoundary(line: string): boolean {
  return (
    /^\s*```/.test(line)
    || /^(#{1,4})\s+/.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
    || parseListLine(line) !== null
    || /^\s*>\s?/.test(line)
  );
}
```

- [ ] **Step 7: Calculate group totals and table totals from the same rows**

Add a shared row reducer and update the table branch of `getChecklistProgress`:

```ts
function getTableRowsProgress(rows: readonly MarkdownTableRow[]): ChecklistProgress {
  return rows.reduce<ChecklistProgress>((progress, row) => {
    for (const cell of row.cells) {
      if (cell.taskChecked === undefined) continue;
      progress.total += 1;
      if (cell.taskChecked) progress.checked += 1;
    }
    return progress;
  }, { checked: 0, open: false, total: 0 });
}
```

Replace the table branch of `getChecklistProgress` with:

```ts
if (block.type === "table") {
  const tableProgress: ChecklistProgress = { checked: 0, open: false, total: 0 };
  for (const section of block.table?.sections ?? []) {
    const sectionProgress = getTableRowsProgress(section.rows);
    if (section.type === "group") {
      section.checklistProgress = sectionProgress.total > 0 ? sectionProgress : undefined;
    }
    tableProgress.checked += sectionProgress.checked;
    tableProgress.total += sectionProgress.total;
  }
  block.checklistProgress = tableProgress.total > 0 ? tableProgress : undefined;
  return tableProgress;
}
```

Keep `getTableRowProgress` for completed data-row styling.

- [ ] **Step 8: Render static group headings and omit technical delimiters**

Extract the current `<tr>` body into `renderTableRow(row, rowIndex, key, table)`. Then map `table.sections` inside `<table>`:

```tsx
{table.sections.map((section, sectionIndex) => {
  if (section.type === "rows") {
    return (
      <tbody key={`${key}-rows-${sectionIndex}`}>
        {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, `${key}-rows-${sectionIndex}`, table))}
      </tbody>
    );
  }
  const progress = section.checklistProgress;
  const complete = Boolean(progress && progress.total > 0 && progress.checked === progress.total);
  return (
    <tbody
      className={`markdown-table-group${complete ? " markdown-table-group--complete" : ""}`}
      data-markdown-source-line={section.titleSourceLine}
      key={`${key}-group-${section.titleSourceLine}`}
    >
      <tr className="markdown-table-group__heading">
        <th colSpan={table.headers.length} scope="rowgroup">
          <div className="markdown-table-group__header">
            <span className="markdown-table-group__title">{renderInline(section.title.value, `${key}-group-${section.titleSourceLine}-title`)}</span>
            {progress ? <ChecklistProgressView progress={progress} /> : null}
          </div>
        </th>
      </tr>
      {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, `${key}-group-${section.titleSourceLine}`, table))}
    </tbody>
  );
})}
```

The extracted `renderTableRow` must retain the current checkbox labels, `setMarkdownTableTaskChecked` call, alignment classes, and `markdown-table-row--complete` logic byte-for-byte except for receiving its values as parameters.

- [ ] **Step 9: Run focused and existing table tests**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "table|framed one-cell"
```

Expected: PASS for both new grouped-table tests and both existing GFM table tests.

- [ ] **Step 10: Inspect and commit Task 1 with Jujutsu**

Run each command separately:

```bash
jj status
jj diff
jj describe -m "Render Markdown table row groups"
jj new
```

Expected: only `src/components/Markdown.tsx` and `tests/markdown-tasks.test.tsx` are included in the described change, followed by a clean fresh working-copy change.

---

### Task 2: Add stable independent collapse state

**Files:**
- Modify: `src/components/Markdown.tsx:360-405`
- Modify: `src/components/Markdown.tsx:695-730`
- Modify: `src/components/Markdown.tsx:850-940`
- Test: `tests/markdown-tasks.test.tsx:370-460`
- Test: `tests/markdown-tasks.test.tsx:547-600`

**Interfaces:**
- Consumes: `MarkdownTableGroup`, `normalizedCollapsePathPart`, `hashCollapsePath`, `nextCollapsePath`, `collapsedChecklistSections`, and `onCollapsedChecklistSectionsChange` from Task 1 and existing checklist sections.
- Produces: `table-group:<hash>` IDs and accessible group toggle buttons consumed by saved note state and Task 3 styles.

- [ ] **Step 1: Add a failing independent-collapse test**

```tsx
it("collapses table groups independently", async () => {
  const user = userEvent.setup();
  const markdown = [
    "| Stage | Main | Secret |",
    "| --- | --- | --- |",
    "| Philosopher's Stone |",
    "| --- | --- | --- |",
    "| Start | [x] | [ ] |",
    "| --- | --- | --- |",
    "| Chamber of Secrets |",
    "| --- | --- | --- |",
    "| Dobby | [x] | [x] |",
  ].join("\n");
  let collapsed: string[] = [];
  let view: ReturnType<typeof render>;
  const onCollapsedChecklistSectionsChange = vi.fn((next: string[]) => {
    collapsed = next;
    view.rerender(
      <MarkdownView
        collapsedChecklistSections={collapsed}
        markdown={markdown}
        onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
      />,
    );
  });
  view = render(
    <MarkdownView
      collapsedChecklistSections={collapsed}
      markdown={markdown}
      onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange}
    />,
  );

  await user.click(screen.getByRole("button", { name: /^Philosopher's Stone / }));

  const stone = screen.getByRole("button", { name: /^Philosopher's Stone / });
  expect(stone).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("checkbox", { name: "Снять отметку: Start — Main" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Снять отметку: Dobby — Main" })).toBeInTheDocument();
  expect(collapsed).toHaveLength(1);
  expect(collapsed[0]).toMatch(/^table-group:/);
});
```

- [ ] **Step 2: Run it and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "collapses table groups independently"
```

Expected: FAIL because static group headers are not buttons and table-group IDs are not collected as valid collapse sections.

- [ ] **Step 3: Add failing stability and no-task tests**

```tsx
it("keeps table-group ids stable when unrelated text is inserted", () => {
  const markdown = [
    "| Stage | Complete |",
    "| --- | --- |",
    "| Reference |",
    "| --- | --- |",
    "| Prologue | [ ] |",
  ].join("\n");
  const onChange = vi.fn();
  const view = render(<MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={onChange} />);
  const firstToggle = screen.getByRole("button", { name: "Reference" });
  const firstId = firstToggle.closest(".markdown-table-group")?.getAttribute("data-checklist-section-id");

  view.rerender(<MarkdownView markdown={`Unrelated introduction.\n\n${markdown}`} onCollapsedChecklistSectionsChange={onChange} />);
  const stableToggle = screen.getByRole("button", { name: "Reference" });
  expect(stableToggle.closest(".markdown-table-group")).toHaveAttribute("data-checklist-section-id", firstId);
});

it("lets table groups without tasks collapse without showing progress", async () => {
  const user = userEvent.setup();
  const markdown = [
    "| Stage | Notes |",
    "| --- | --- |",
    "| Reference |",
    "| --- | --- |",
    "| Prologue | Read later |",
  ].join("\n");
  const onChange = vi.fn();
  render(<MarkdownView markdown={markdown} onCollapsedChecklistSectionsChange={onChange} />);
  const toggle = screen.getByRole("button", { name: "Reference" });
  const collapseId = toggle.closest(".markdown-table-group")?.getAttribute("data-checklist-section-id");
  expect(toggle.querySelector(".markdown-checklist-progress")).toBeNull();

  await user.click(toggle);
  expect(onChange).toHaveBeenCalledWith([collapseId]);
});
```

- [ ] **Step 4: Run both component tests and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "collapses table groups independently|table-group ids stable|groups without tasks"
```

Expected: both tests FAIL because Task 1 renders non-interactive group headings and has no table-group collapse IDs.

- [ ] **Step 5: Add a failing GamePage persistence test**

Place this beside the existing saved-collapse-state test:

```tsx
it("saves a collapsed table group as note state", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn<(input: GameSaveInput) => void>();
  const bodyMarkdown = [
    "| Stage | Complete |",
    "| --- | --- |",
    "| Philosopher's Stone |",
    "| --- | --- |",
    "| Intro | [ ] |",
  ].join("\n");
  const note = makeNote(bodyMarkdown);

  render(<GamePage assets={{}} game={game} mode="game" notes={[note]} onSave={onSave} />);
  await user.click(screen.getByRole("button", { name: /^Philosopher's Stone / }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

  const savedNote = onSave.mock.calls[0][0].notes[0];
  expect(savedNote.bodyMarkdown).toBe(bodyMarkdown);
  expect(savedNote.collapsedChecklistSections).toHaveLength(1);
  expect(savedNote.collapsedChecklistSections?.[0]).toMatch(/^table-group:/);
});
```

- [ ] **Step 6: Run all three new collapse tests and verify RED**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "collapse|collapsed table group|table-group ids"
```

Expected: all three new tests FAIL at the missing table-group button or collapse ID.

- [ ] **Step 7: Assign semantic IDs to every table group**

Add this annotation helper:

```ts
function annotateTableGroupIds(
  block: MarkdownBlock,
  parentPath: string,
  occurrences: Map<string, number>,
): void {
  const table = block.table;
  if (!table) return;
  const headerLabel = table.headers.map((header) => normalizedCollapsePathPart(header.value)).join("\u0000");
  const tablePath = nextCollapsePath(`${parentPath}\u0000table\u0000${headerLabel}`, occurrences);
  for (const section of table.sections) {
    if (section.type !== "group") continue;
    const groupPath = nextCollapsePath(
      `${tablePath}\u0000group\u0000${normalizedCollapsePathPart(section.title.value)}`,
      occurrences,
    );
    section.collapseId = `table-group:${hashCollapsePath(groupPath)}`;
  }
}
```

In the block-annotation loop, call it for every table before the `progress.total === 0` early exit. This ordering is required so a group without checkboxes also receives a collapse ID.

- [ ] **Step 8: Collect table IDs and render controlled toggle buttons**

Add every group `collapseId` to `validCollapseIds`. Replace the static group header from Task 1 with the existing controlled-section pattern:

```tsx
const collapseId = section.collapseId;
const collapsed = Boolean(collapseId && collapsedSections.has(collapseId));
const contentId = collapseId ? `${collapseDomIdPrefix}-markdown-${collapseId}-content` : undefined;
const headerChildren = <>
  <span className="markdown-table-group__title">
    {renderInline(section.title.value, `${key}-group-${section.titleSourceLine}-title`)}
  </span>
  {progress ? <ChecklistProgressView progress={progress} /> : null}
</>;
```

Render the group as two consecutive bodies inside a keyed `Fragment`: one `<tbody className="markdown-table-group">` containing the heading and one `<tbody className="markdown-table-group__content" hidden={collapsed} id={contentId}>` containing its data rows. When `onCollapsedChecklistSectionsChange` and `collapseId` exist, wrap `headerChildren` in:

```tsx
<button
  aria-controls={contentId}
  aria-expanded={!collapsed}
  className="markdown-table-group__header markdown-checklist-toggle"
  disabled={taskChangesDisabled}
  onClick={() => toggleChecklistSection(collapseId)}
  type="button"
>
  {headerChildren}
</button>
```

Without a collapse callback, retain the non-button `<div className="markdown-table-group__header">`.

- [ ] **Step 9: Run the new and existing collapse tests and verify GREEN**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx -t "collapse|collapsed table group|table-group ids"
```

Expected: PASS, including the pre-existing heading/list collapse and failed-save behavior.

- [ ] **Step 10: Inspect and commit Task 2 with Jujutsu**

Run each command separately:

```bash
jj status
jj diff
jj describe -m "Persist Markdown table group collapse state"
jj new
```

Expected: only the collapse implementation and its tests are included.

---

### Task 3: Add the framed visual treatment and run full verification

**Files:**
- Modify: `src/styles.css:353-367`
- Test: `tests/notes-masonry-css.test.ts:80-150`

**Interfaces:**
- Consumes: group markup/classes from Tasks 1 and 2, `ChecklistProgressView`, `.markdown-checklist-toggle`, and existing design tokens.
- Produces: compact full-width group headings whose existing cell borders visually reproduce the source delimiters.

- [ ] **Step 1: Add failing CSS contract assertions**

Extend the Markdown table section of `tests/notes-masonry-css.test.ts`:

```ts
const groupCell = declarationsFor(".markdown-table-group__heading > th");
const groupHeader = declarationsFor(".markdown-table-group__header");
const groupTitle = declarationsFor(".markdown-table-group__title");
const completeGroup = declarationsFor(".markdown-table-group--complete .markdown-table-group__header");
const hiddenGroup = declarationsFor(".markdown-table-group__content[hidden]");

expect(groupCell).toMatch(/padding:\s*0/);
expect(groupCell).toMatch(/background:\s*var\(--surface-2\)/);
expect(groupHeader).toMatch(/display:\s*flex/);
expect(groupHeader).toMatch(/width:\s*100%/);
expect(groupTitle).toMatch(/flex:\s*1/);
expect(completeGroup).toMatch(/color:\s*var\(--success\)/);
expect(hiddenGroup).toMatch(/display:\s*none/);
```

- [ ] **Step 2: Run the CSS test and verify RED**

Run:

```bash
npm test -- tests/notes-masonry-css.test.ts -t "Markdown tables"
```

Expected: FAIL because the new selectors have no declarations.

- [ ] **Step 3: Add compact framed group styles**

Add these declarations next to the existing `.markdown-table` rules:

```css
.markdown-table-group__heading > th { padding: 0; color: var(--text); background: var(--surface-2); text-align: left!important; }
.markdown-table-group__header { width: 100%; min-height: 28px; display: flex; align-items: baseline; gap: 6px; padding: 5px 6px; color: inherit; font-weight: 650; }
button.markdown-table-group__header { cursor: pointer; }
button.markdown-table-group__header:disabled { cursor: default; }
.markdown-table-group__title { min-width: 0; flex: 1; }
.markdown-table-group--complete .markdown-table-group__header { color: var(--success); }
.markdown-table-group--complete .markdown-checklist-progress { color: inherit; }
.markdown-table-group__content[hidden] { display: none; }
```

Keep the existing cell borders: they are the rendered equivalent of the delimiters above and below each source heading. Reuse `.markdown-checklist-toggle:focus-visible` for the keyboard focus ring.

- [ ] **Step 4: Run the complete focused test set**

Run:

```bash
npm test -- tests/markdown-tasks.test.tsx tests/notes-masonry-css.test.ts
```

Expected: PASS with no warnings, including existing tables, headings, list groups, note persistence, grouped checkbox updates, and CSS assertions.

- [ ] **Step 5: Run repository-wide verification**

Run:

```bash
npm test
npm run build
```

Expected: all Vitest suites pass; TypeScript and Vite production build succeed without errors.

- [ ] **Step 6: Inspect and commit Task 3 with Jujutsu**

Run each command separately:

```bash
jj status
jj diff
jj describe -m "Complete Markdown table group interactions"
jj new
jj status
```

Expected: the final described change contains only Task 3 files, and the fresh working-copy change is clean.
