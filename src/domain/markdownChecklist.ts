import { scanMarkdownTableLine } from "../components/markdownTableSyntax";

export interface MarkdownBlock {
  type: "code" | "heading" | "list" | "ordered-list" | "quote" | "paragraph" | "rule" | "table";
  value?: string;
  items?: MarkdownListItem[];
  depth?: number;
  table?: MarkdownTable;
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
  sourceLocations?: MarkdownTextLocation[];
}

export interface MarkdownTextLocation {
  sourceColumn: number;
  sourceLine: number;
}

export interface ChecklistProgress {
  checked: number;
  open: boolean;
  total: number;
}

export type MarkdownTaskState = "unchecked" | "checked" | "indeterminate";

export interface MarkdownListItem {
  value: string;
  firstLineValue: string;
  openMarker: boolean;
  sourceLine: number;
  sourceLineStart: number;
  sourceTextEnd: number;
  sourceTextStart: number;
  taskChecked?: boolean;
  taskState?: MarkdownTaskState;
  taskSourceColumn?: number;
  children: MarkdownBlock[];
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
  structuralId?: string;
  sourceLocations: MarkdownTextLocation[];
}

export type MarkdownTableAlignment = "center" | "left" | "right" | undefined;

export interface MarkdownTableCell {
  value: string;
  sourceColumn?: number;
  sourceLine?: number;
  sourceValue?: string;
  taskChecked?: boolean;
  taskState?: MarkdownTaskState;
  taskSourceColumn?: number;
}

export interface MarkdownTableRow {
  cells: MarkdownTableCell[];
  sourceLine: number;
}

export interface MarkdownTableRows {
  type: "rows";
  rows: MarkdownTableRow[];
}

export interface MarkdownTableGroup {
  type: "group";
  title: MarkdownTableCell;
  titleSourceLine: number;
  rows: MarkdownTableRow[];
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
}

export type MarkdownTableSection = MarkdownTableRows | MarkdownTableGroup;

export interface MarkdownTable {
  alignments: MarkdownTableAlignment[];
  headers: MarkdownTableCell[];
  sections: MarkdownTableSection[];
}

export interface MarkdownSourceLine {
  content: string;
  eol: string;
  start: number;
}

export type NoteChecklistResolution =
  | { status: "ok"; checked: number; total: number }
  | { status: "error" };

const TASK_MARKER = /^\[([ xX-])\](?:[ \t]+|$)/;

function markdownTaskState(marker: string): MarkdownTaskState {
  if (marker === "-") return "indeterminate";
  return marker.toLowerCase() === "x" ? "checked" : "unchecked";
}

interface ParsedListLine {
  indent: number;
  contentIndent: number;
  type: "list" | "ordered-list";
  value: string;
  valueColumn: number;
}

interface ChecklistRoot {
  headingPaths: string[];
  progress: ChecklistProgress;
}

interface MarkdownChecklistAnalysis {
  blocks: MarkdownBlock[];
  roots: ChecklistRoot[];
}

export function splitMarkdownSourceLines(value: string): MarkdownSourceLine[] {
  const lines: MarkdownSourceLine[] = [];
  let start = 0;

  while (start <= value.length) {
    let end = start;
    while (end < value.length && value[end] !== "\r" && value[end] !== "\n") end += 1;
    const eol = end < value.length
      ? value[end] === "\r" && value[end + 1] === "\n" ? "\r\n" : value[end]
      : "";
    lines.push({ content: value.slice(start, end), eol, start });
    if (!eol) break;
    start = end + eol.length;
  }

  return lines;
}

function indentationWidth(value: string, initialWidth = 0): number {
  return Array.from(value).reduce(
    (width, character) => character === "\t" ? width + (4 - width % 4) : width + 1,
    initialWidth,
  );
}

function parseListLine(line: string): ParsedListLine | null {
  const match = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  const indent = indentationWidth(match[1]);
  return {
    indent,
    contentIndent: indentationWidth(match[3], indent + match[2].length),
    type: /^\d/.test(match[2]) ? "ordered-list" : "list",
    value: match[4],
    valueColumn: match[1].length + match[2].length + match[3].length,
  };
}

function parseList(sourceLines: readonly MarkdownSourceLine[], startIndex: number, minimumIndent = 0): { block: MarkdownBlock; nextIndex: number } {
  const lines = sourceLines.map((line) => line.content);
  const firstLine = parseListLine(lines[startIndex]);
  if (!firstLine) throw new Error("Expected a Markdown list line");

  const block: MarkdownBlock = { type: firstLine.type, items: [] };
  let index = startIndex;

  while (index < lines.length) {
    const line = parseListLine(lines[index]);
    if (!line || line.indent < minimumIndent || line.indent >= firstLine.contentIndent || line.type !== firstLine.type) break;

    const sourceLine = index;
    const task = TASK_MARKER.exec(line.value);
    const sourceTextStart = sourceLines[index].start + line.valueColumn + (task?.[0].length ?? 0);
    const item: MarkdownListItem = {
      value: task ? line.value.slice(task[0].length) : line.value,
      firstLineValue: task ? line.value.slice(task[0].length) : line.value,
      openMarker: false,
      sourceLine,
      sourceLineStart: sourceLines[index].start,
      sourceTextEnd: sourceLines[index].start + sourceLines[index].content.length,
      sourceTextStart,
      taskChecked: task ? markdownTaskState(task[1]) === "checked" : undefined,
      taskState: task ? markdownTaskState(task[1]) : undefined,
      taskSourceColumn: task ? line.valueColumn : undefined,
      children: [],
      sourceLocations: [{ sourceColumn: sourceTextStart - sourceLines[index].start, sourceLine }],
    };
    index += 1;

    while (index < lines.length) {
      const childLine = parseListLine(lines[index]);
      if (childLine?.indent !== undefined && childLine.indent >= line.contentIndent) {
        const child = parseList(sourceLines, index, line.contentIndent);
        item.children.push(child.block);
        index = child.nextIndex;
        continue;
      }
      if (childLine) break;

      if (!lines[index].trim()) {
        let lookahead = index;
        while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
        const nextLine = lookahead < lines.length ? parseListLine(lines[lookahead]) : null;
        const nextIsChild = nextLine !== null && nextLine.indent >= line.contentIndent;
        const nextIsSibling = nextLine !== null && nextLine.type === firstLine.type && nextLine.indent >= minimumIndent && nextLine.indent < firstLine.contentIndent;
        if (nextIsChild || nextIsSibling) {
          index = lookahead;
          if (nextIsChild) continue;
        }
        break;
      }

      const leadingWhitespace = /^[ \t]*/.exec(lines[index])?.[0] ?? "";
      if (indentationWidth(leadingWhitespace) < line.contentIndent) break;
      const continuation = lines[index].trim();
      item.value += `\n${continuation}`;
      item.sourceLocations.push({
        sourceColumn: lines[index].indexOf(continuation),
        sourceLine: index,
      });
      index += 1;
    }

    block.items?.push(item);
  }

  const lastItem = block.items?.at(-1);
  if (lastItem?.taskState === "unchecked" && lastItem.value.trim() === "...") lastItem.openMarker = true;

  return { block, nextIndex: index };
}

type ParsedTableCell = NonNullable<ReturnType<typeof scanMarkdownTableLine>>["cells"][number];

function splitTableLine(line: string): ParsedTableCell[] | null {
  return scanMarkdownTableLine(line)?.cells ?? null;
}

function tableAlignment(delimiter: string): MarkdownTableAlignment {
  if (delimiter.startsWith(":") && delimiter.endsWith(":")) return "center";
  if (delimiter.endsWith(":")) return "right";
  if (delimiter.startsWith(":")) return "left";
  return undefined;
}

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
    title: {
      sourceColumn: titleCells[0].sourceColumn,
      sourceLine: titleIndex,
      sourceValue: titleCells[0].sourceText,
      value: titleCells[0].value,
    },
  };
}

function parseTableStart(lines: string[], startIndex: number): { alignments: MarkdownTableAlignment[]; headers: MarkdownTableCell[] } | null {
  if (startIndex + 1 >= lines.length) return null;
  const headerCells = splitTableLine(lines[startIndex]);
  if (!headerCells?.length) return null;
  const delimiterCells = parseTableDelimiter(lines[startIndex + 1], headerCells.length);
  if (!delimiterCells) return null;
  return {
    alignments: delimiterCells.map((cell) => tableAlignment(cell.value)),
    headers: headerCells.map((cell) => ({
      sourceColumn: cell.sourceColumn,
      sourceLine: startIndex,
      sourceValue: cell.sourceText,
      value: cell.value,
    })),
  };
}

function parseTableRow(parsedCells: readonly ParsedTableCell[], columnCount: number, sourceLine: number): MarkdownTableRow {
  const cells = parsedCells.slice(0, columnCount).map<MarkdownTableCell>((cell) => {
    const task = TASK_MARKER.exec(cell.value);
    const taskSource = task ? TASK_MARKER.exec(cell.sourceText) : null;
    return {
      sourceColumn: cell.sourceColumn + (task?.[0].length ?? 0),
      sourceLine,
      sourceValue: taskSource ? cell.sourceText.slice(taskSource[0].length) : cell.sourceText,
      value: task ? cell.value.slice(task[0].length) : cell.value,
      taskChecked: task ? markdownTaskState(task[1]) === "checked" : undefined,
      taskState: task ? markdownTaskState(task[1]) : undefined,
      taskSourceColumn: task ? cell.sourceColumn : undefined,
    };
  });
  while (cells.length < columnCount) cells.push({ value: "" });
  return { cells, sourceLine };
}

function isTableBlockBoundary(line: string): boolean {
  return (
    /^\s*```/.test(line)
    || /^(#{1,4})\s+/.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
    || parseListLine(line) !== null
    || /^\s*>\s?/.test(line)
  );
}

function parseTable(lines: string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } | null {
  const start = parseTableStart(lines, startIndex);
  if (!start) return null;

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
    const groupHeader = parseTableGroupHeader(lines, index, start.headers.length, index === startIndex + 2);
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
}

export function getChecklistProgress(block: MarkdownBlock): ChecklistProgress {
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

  const blockProgress = (block.items ?? []).reduce<ChecklistProgress>((progress, item) => {
    const itemProgress: ChecklistProgress = { checked: 0, open: item.openMarker, total: 0 };
    if (item.taskState !== undefined && !item.openMarker) {
      itemProgress.total += 1;
      if (item.taskState === "checked") itemProgress.checked += 1;
    }
    for (const child of item.children) {
      const childProgress = getChecklistProgress(child);
      itemProgress.checked += childProgress.checked;
      itemProgress.open ||= childProgress.open;
      itemProgress.total += childProgress.total;
    }
    item.checklistProgress = itemProgress.total > 0 || itemProgress.open ? itemProgress : undefined;
    progress.checked += itemProgress.checked;
    progress.open ||= itemProgress.open;
    progress.total += itemProgress.total;
    return progress;
  }, { checked: 0, open: false, total: 0 });
  block.checklistProgress = blockProgress.total > 0 || blockProgress.open ? blockProgress : undefined;
  return blockProgress;
}

function getTableRowsProgress(rows: readonly MarkdownTableRow[]): ChecklistProgress {
  return rows.reduce<ChecklistProgress>((progress, row) => {
    for (const cell of row.cells) {
      if (cell.taskState === undefined) continue;
      progress.total += 1;
      if (cell.taskState === "checked") progress.checked += 1;
    }
    return progress;
  }, { checked: 0, open: false, total: 0 });
}

export function getTableRowProgress(row: MarkdownTableRow): ChecklistProgress {
  return getTableRowsProgress([row]);
}

export function markdownLabel(source: string): string {
  return source
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function normalizedCollapsePathPart(value: string): string {
  return markdownLabel(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function hashCollapsePath(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${value.length.toString(36)}`;
}

function nextCollapsePath(base: string, occurrences: Map<string, number>): string {
  const occurrence = occurrences.get(base) ?? 0;
  occurrences.set(base, occurrence + 1);
  return `${base}\u0000${occurrence}`;
}

function annotateChecklistGroupIds(block: MarkdownBlock, parentPath: string, occurrences: Map<string, number>): void {
  for (const item of block.items ?? []) {
    const kind = item.taskState === undefined ? "item" : "task";
    const base = `${parentPath}\u0000${block.type}\u0000${kind}\u0000${normalizedCollapsePathPart(item.value)}`;
    const itemPath = nextCollapsePath(base, occurrences);
    item.structuralId = `list-item:${hashCollapsePath(itemPath)}`;
    if (item.taskState === undefined && item.checklistProgress) {
      item.collapseId = `group:${hashCollapsePath(itemPath)}`;
    }
    for (const child of item.children) annotateChecklistGroupIds(child, itemPath, occurrences);
  }
}

function annotateTableGroupIds(block: MarkdownBlock, parentPath: string, occurrences: Map<string, number>): void {
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

function analyzeMarkdownChecklistRoots(markdown: string): MarkdownChecklistAnalysis {
  const sourceLines = splitMarkdownSourceLines(markdown);
  const lines = sourceLines.map((line) => line.content);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = /^\s*```(?:\w+)?\s*$/.exec(line);
    if (fence) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      blocks.push({ type: "code", value: content.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: heading[1].length,
        sourceLocations: [{ sourceColumn: heading[1].length + 1, sourceLine: index }],
        value: heading[2],
      });
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (parseListLine(line)) {
      const list = parseList(sourceLines, index);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      const sourceLocations: MarkdownTextLocation[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        const prefix = /^\s*>\s?/.exec(lines[index])?.[0] ?? "";
        quote.push(lines[index].slice(prefix.length));
        sourceLocations.push({ sourceColumn: prefix.length, sourceLine: index });
        index += 1;
      }
      blocks.push({ type: "quote", sourceLocations, value: quote.join("\n") });
      continue;
    }
    const table = parseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const firstParagraphLine = line.trim();
    const paragraph = [firstParagraphLine];
    const sourceLocations: MarkdownTextLocation[] = [{
      sourceColumn: line.indexOf(firstParagraphLine),
      sourceLine: index,
    }];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !/^\s*```/.test(lines[index])
      && !/^(#{1,4})\s+/.test(lines[index])
      && !parseTableStart(lines, index)
      && !/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])
    ) {
      const paragraphLine = lines[index].trim();
      paragraph.push(paragraphLine);
      sourceLocations.push({
        sourceColumn: lines[index].indexOf(paragraphLine),
        sourceLine: index,
      });
      index += 1;
    }
    blocks.push({ type: "paragraph", sourceLocations, value: paragraph.join("\n") });
  }

  const roots: ChecklistRoot[] = [];
  const activeHeadings: Array<{ block: MarkdownBlock; path: string }> = [];
  const collapsePathOccurrences = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === "heading") {
      const depth = block.depth ?? 0;
      while (activeHeadings.length && (activeHeadings[activeHeadings.length - 1].block.depth ?? 0) >= depth) {
        activeHeadings.pop();
      }
      const parentPath = activeHeadings[activeHeadings.length - 1]?.path ?? "root";
      const headingBase = `${parentPath}\u0000heading\u0000${depth}\u0000${normalizedCollapsePathPart(block.value ?? "")}`;
      const headingPath = nextCollapsePath(headingBase, collapsePathOccurrences);
      block.collapseId = `heading:${hashCollapsePath(headingPath)}`;
      activeHeadings.push({ block, path: headingPath });
      continue;
    }
    if (block.type !== "list" && block.type !== "ordered-list" && block.type !== "table") continue;

    if (block.type === "table") {
      annotateTableGroupIds(block, activeHeadings[activeHeadings.length - 1]?.path ?? "root", collapsePathOccurrences);
    }
    const progress = getChecklistProgress(block);
    if (progress.total === 0 && !progress.open) continue;
    roots.push({ headingPaths: activeHeadings.map((heading) => heading.path), progress });
    if (block.type === "list" || block.type === "ordered-list") {
      annotateChecklistGroupIds(block, activeHeadings[activeHeadings.length - 1]?.path ?? "root", collapsePathOccurrences);
    }
    for (const { block: heading } of activeHeadings) {
      const headingProgress = heading.checklistProgress ?? { checked: 0, open: false, total: 0 };
      headingProgress.checked += progress.checked;
      headingProgress.open ||= progress.open;
      headingProgress.total += progress.total;
      heading.checklistProgress = headingProgress;
    }
  }

  return { blocks, roots };
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  return analyzeMarkdownChecklistRoots(markdown).blocks;
}

export function hasMarkdownTasks(markdown: string): boolean {
  return analyzeMarkdownChecklistRoots(markdown).roots.length > 0;
}

function progressAtLowestSharedHeading(roots: readonly ChecklistRoot[]): ChecklistProgress | null {
  const commonLength = roots.reduce((length, root) => {
    let index = 0;
    while (index < length && root.headingPaths[index] === roots[0].headingPaths[index]) index += 1;
    return index;
  }, roots[0]?.headingPaths.length ?? 0);
  if (commonLength === 0) return null;

  return roots.reduce<ChecklistProgress>((progress, root) => ({
    checked: progress.checked + root.progress.checked,
    open: progress.open || root.progress.open,
    total: progress.total + root.progress.total,
  }), { checked: 0, open: false, total: 0 });
}

export function resolveNoteChecklistProgress(markdown: string): NoteChecklistResolution {
  const analysis = analyzeMarkdownChecklistRoots(markdown);
  if (analysis.roots.length === 0) return { status: "error" };

  const progress = analysis.roots.length === 1
    ? analysis.roots[0].progress
    : progressAtLowestSharedHeading(analysis.roots);

  if (!progress || progress.open || progress.total <= 0) return { status: "error" };
  return { status: "ok", checked: progress.checked, total: progress.total };
}

export function firstMarkdownHeading(markdown: string): string | null {
  const heading = parseMarkdownBlocks(markdown).find((block) => block.type === "heading");
  return heading ? markdownLabel(heading.value ?? "") || null : null;
}
