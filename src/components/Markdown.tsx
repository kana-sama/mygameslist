import { forwardRef, Fragment, useEffect, useId, useMemo, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from "react";
import type { MarkdownDecoration } from "../domain/markdownDiff";
import { Icon } from "./Icon";
import { safeUrl } from "./libraryUi";

interface MarkdownInlineLocation {
  decorations: readonly MarkdownDecoration[];
  sourceColumn: number;
  sourceLine: number;
}

function decorationAt(
  location: MarkdownInlineLocation,
  startColumn: number,
  endColumn: number,
): MarkdownDecoration | undefined {
  return location.decorations.find((decoration) => {
    if (location.sourceLine < decoration.startLine || location.sourceLine > decoration.endLine) return false;
    const decorationStart = location.sourceLine === decoration.startLine ? decoration.startColumn : 0;
    const decorationEnd = location.sourceLine === decoration.endLine ? decoration.endColumn : Number.POSITIVE_INFINITY;
    return decorationStart < endColumn && decorationEnd > startColumn;
  });
}

function renderDecoratedText(
  text: string,
  keyPrefix: string,
  rawStart: number,
  location?: MarkdownInlineLocation,
): ReactNode[] {
  if (!location || !text) return text ? [text] : [];
  const sourceStart = location.sourceColumn + rawStart;
  const sourceEnd = sourceStart + text.length;
  const boundaries = new Set([sourceStart, sourceEnd]);
  for (const decoration of location.decorations) {
    if (location.sourceLine < decoration.startLine || location.sourceLine > decoration.endLine) continue;
    const start = location.sourceLine === decoration.startLine ? decoration.startColumn : 0;
    const end = location.sourceLine === decoration.endLine ? decoration.endColumn : Number.POSITIVE_INFINITY;
    if (start > sourceStart && start < sourceEnd) boundaries.add(start);
    if (end > sourceStart && end < sourceEnd) boundaries.add(end);
  }
  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const value = text.slice(start - sourceStart, end - sourceStart);
    const decoration = decorationAt(location, start, end);
    if (!decoration) return value;
    return (
      <span
        aria-label={decoration.label}
        className={`markdown-diff-inline markdown-diff-inline--${decoration.kind}`}
        data-diff-kind={decoration.kind}
        key={`${keyPrefix}-decoration-${start}`}
      >
        {value}
      </span>
    );
  });
}

function renderInline(source: string, keyPrefix = "inline", location?: MarkdownInlineLocation): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    if (match.index > cursor) nodes.push(...renderDecoratedText(source.slice(cursor, match.index), keyPrefix, cursor, location));
    const raw = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (raw.startsWith("`")) {
      nodes.push(<code key={key}>{renderDecoratedText(raw.slice(1, -1), key, match.index + 1, location)}</code>);
    } else if (raw.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(raw);
      const href = linkMatch ? safeUrl(linkMatch[2]) : null;
      if (linkMatch && href) {
        const isExternal = /^https?:/i.test(href);
        nodes.push(
          <a
            href={href}
            key={key}
            rel={isExternal ? "noreferrer noopener" : undefined}
            target={isExternal ? "_blank" : undefined}
            title={linkMatch[3] || undefined}
          >
            {renderInline(linkMatch[1], `${key}-label`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 1 } : undefined)}
          </a>,
        );
      } else {
        nodes.push(...renderDecoratedText(raw, key, match.index, location));
      }
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(raw.slice(2, -2), `${key}-strong`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 2 } : undefined)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(raw.slice(1, -1), `${key}-em`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 1 } : undefined)}</em>);
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) nodes.push(...renderDecoratedText(source.slice(cursor), keyPrefix, cursor, location));
  return nodes;
}

interface MarkdownBlock {
  type: "code" | "heading" | "list" | "ordered-list" | "quote" | "paragraph" | "rule" | "table";
  value?: string;
  items?: MarkdownListItem[];
  depth?: number;
  table?: MarkdownTable;
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
  sourceLocations?: MarkdownTextLocation[];
}

interface MarkdownTextLocation {
  sourceColumn: number;
  sourceLine: number;
}

interface ChecklistProgress {
  checked: number;
  open: boolean;
  total: number;
}

interface MarkdownListItem {
  value: string;
  firstLineValue: string;
  openMarker: boolean;
  sourceLine: number;
  sourceLineStart: number;
  sourceTextEnd: number;
  sourceTextStart: number;
  taskChecked?: boolean;
  children: MarkdownBlock[];
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
  sourceLocations: MarkdownTextLocation[];
}

type MarkdownTableAlignment = "center" | "left" | "right" | undefined;

interface MarkdownTableCell {
  value: string;
  sourceColumn?: number;
  sourceLine?: number;
  taskChecked?: boolean;
  taskSourceColumn?: number;
}

interface MarkdownTableRow {
  cells: MarkdownTableCell[];
  sourceLine: number;
}

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

const TASK_MARKER = /^\[([ xX])\](?:[ \t]+|$)/;

interface ParsedListLine {
  indent: number;
  contentIndent: number;
  type: "list" | "ordered-list";
  value: string;
  valueColumn: number;
}

interface MarkdownSourceLine {
  content: string;
  eol: string;
  start: number;
}

function splitMarkdownSourceLines(value: string): MarkdownSourceLine[] {
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
      taskChecked: task ? task[1].toLowerCase() === "x" : undefined,
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
  if (lastItem?.taskChecked === false && lastItem.value.trim() === "...") lastItem.openMarker = true;

  return { block, nextIndex: index };
}

interface ParsedTableCell {
  sourceColumn: number;
  value: string;
}

function isEscapedCharacter(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function splitTableLine(line: string): ParsedTableCell[] | null {
  const separators: number[] = [];
  let codeFenceLength = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "`" && !isEscapedCharacter(line, index)) {
      let runLength = 1;
      while (line[index + runLength] === "`") runLength += 1;
      if (codeFenceLength === 0) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      index += runLength - 1;
      continue;
    }
    if (line[index] === "|" && codeFenceLength === 0 && !isEscapedCharacter(line, index)) {
      separators.push(index);
    }
  }
  if (!separators.length) return null;

  const segments: Array<{ end: number; start: number }> = [];
  let start = 0;
  for (const separator of separators) {
    segments.push({ start, end: separator });
    start = separator + 1;
  }
  segments.push({ start, end: line.length });
  if (line.slice(segments[0].start, segments[0].end).trim() === "") segments.shift();
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && line.slice(lastSegment.start, lastSegment.end).trim() === "") segments.pop();

  return segments.map((segment) => {
    const raw = line.slice(segment.start, segment.end);
    const leadingWhitespace = /^\s*/.exec(raw)?.[0].length ?? 0;
    const trailingWhitespace = /\s*$/.exec(raw)?.[0].length ?? 0;
    return {
      sourceColumn: segment.start + leadingWhitespace,
      value: raw.slice(leadingWhitespace, raw.length - trailingWhitespace).replace(/\\\|/g, "|"),
    };
  });
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
      value: cell.value,
    })),
  };
}

function parseTableRow(parsedCells: readonly ParsedTableCell[], columnCount: number, sourceLine: number): MarkdownTableRow {
  const cells = parsedCells.slice(0, columnCount).map<MarkdownTableCell>((cell) => {
    const task = TASK_MARKER.exec(cell.value);
    return {
      sourceColumn: cell.sourceColumn + (task?.[0].length ?? 0),
      sourceLine,
      value: task ? cell.value.slice(task[0].length) : cell.value,
      taskChecked: task ? task[1].toLowerCase() === "x" : undefined,
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

function getChecklistProgress(block: MarkdownBlock): ChecklistProgress {
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
    if (item.taskChecked !== undefined && !item.openMarker) {
      itemProgress.total += 1;
      if (item.taskChecked) itemProgress.checked += 1;
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
      if (cell.taskChecked === undefined) continue;
      progress.total += 1;
      if (cell.taskChecked) progress.checked += 1;
    }
    return progress;
  }, { checked: 0, open: false, total: 0 });
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
    const kind = item.taskChecked === undefined ? "item" : "task";
    const base = `${parentPath}\u0000${block.type}\u0000${kind}\u0000${normalizedCollapsePathPart(item.value)}`;
    const itemPath = nextCollapsePath(base, occurrences);
    if (item.taskChecked === undefined && item.checklistProgress) {
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

export function setMarkdownTaskChecked(markdown: string, sourceLine: number, checked: boolean): string {
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined) return markdown;

  const nextLine = line.replace(
    /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)[ xX](\])(?=[ \t]|$)/,
    (_match, prefix: string, suffix: string) => `${prefix}${checked ? "x" : " "}${suffix}`,
  );
  if (nextLine === line) return markdown;
  parts[lineIndex] = nextLine;
  return parts.join("");
}

function setMarkdownTableTaskChecked(markdown: string, sourceLine: number, sourceColumn: number, checked: boolean): string {
  if (!Number.isInteger(sourceLine) || !Number.isInteger(sourceColumn) || sourceLine < 0 || sourceColumn < 0) return markdown;
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined || !/^\[[ xX]\]$/.test(line.slice(sourceColumn, sourceColumn + 3))) return markdown;

  parts[lineIndex] = `${line.slice(0, sourceColumn + 1)}${checked ? "x" : " "}${line.slice(sourceColumn + 2)}`;
  return parts.join("");
}

function markdownSingleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ");
}

function findListItem(
  blocks: readonly MarkdownBlock[],
  sourceLine: number,
  predicate: (item: MarkdownListItem) => boolean,
): MarkdownListItem | null {
  const findInBlock = (block: MarkdownBlock): MarkdownListItem | null => {
    for (const item of block.items ?? []) {
      if (item.sourceLine === sourceLine && predicate(item)) return item;
      for (const child of item.children) {
        const match = findInBlock(child);
        if (match) return match;
      }
    }
    return null;
  };

  for (const block of blocks) {
    const match = findInBlock(block);
    if (match) return match;
  }
  return null;
}

function preferredMarkdownEol(lines: readonly MarkdownSourceLine[], lineIndex: number): string {
  if (lines[lineIndex]?.eol) return lines[lineIndex].eol;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    if (lines[index].eol) return lines[index].eol;
  }
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    if (lines[index].eol) return lines[index].eol;
  }
  return "\n";
}

export function insertMarkdownOpenChecklistItem(markdown: string, markerSourceLine: number, value: string): string {
  const singleLineValue = markdownSingleLine(value);
  if (!singleLineValue.trim()) return markdown;

  const marker = findListItem(parseBlocks(markdown), markerSourceLine, (item) => item.openMarker);
  const sourceLines = splitMarkdownSourceLines(markdown);
  const sourceLine = sourceLines[markerSourceLine];
  if (
    !marker
    || !sourceLine
    || marker.sourceLineStart !== sourceLine.start
    || marker.sourceTextEnd !== sourceLine.start + sourceLine.content.length
    || markdown.slice(marker.sourceTextStart, marker.sourceTextEnd).trim() !== "..."
  ) return markdown;

  const prefix = markdown.slice(marker.sourceLineStart, marker.sourceTextStart);
  const insertedLine = `${prefix}${singleLineValue}${preferredMarkdownEol(sourceLines, markerSourceLine)}`;
  return `${markdown.slice(0, marker.sourceLineStart)}${insertedLine}${markdown.slice(marker.sourceLineStart)}`;
}

export function setMarkdownTaskItemText(markdown: string, sourceLine: number, value: string): string {
  const item = findListItem(
    parseBlocks(markdown),
    sourceLine,
    (candidate) => candidate.taskChecked !== undefined && !candidate.openMarker,
  );
  if (
    !item
    || item.sourceTextStart < item.sourceLineStart
    || item.sourceTextEnd < item.sourceTextStart
    || markdown.slice(item.sourceTextStart, item.sourceTextEnd) !== item.firstLineValue
  ) return markdown;

  const singleLineValue = markdownSingleLine(value);
  const prefix = markdown.slice(item.sourceLineStart, item.sourceTextStart);
  const missingTaskSeparator = Boolean(singleLineValue) && prefix.endsWith("]");
  return `${markdown.slice(0, item.sourceTextStart)}${missingTaskSeparator ? " " : ""}${singleLineValue}${markdown.slice(item.sourceTextEnd)}`;
}

function parseBlocks(markdown: string): MarkdownBlock[] {
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
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !parseTableStart(lines, index) &&
      !/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])
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

  return blocks;
}

export function hasMarkdownTasks(markdown: string): boolean {
  return parseBlocks(markdown).some((block) => {
    const progress = getChecklistProgress(block);
    return progress.total > 0 || progress.open;
  });
}

function markdownLabel(source: string): string {
  return source
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function getTableRowProgress(row: MarkdownTableRow): ChecklistProgress {
  return row.cells.reduce<ChecklistProgress>((progress, cell) => {
    if (cell.taskChecked === undefined) return progress;
    progress.total += 1;
    if (cell.taskChecked) progress.checked += 1;
    return progress;
  }, { checked: 0, open: false, total: 0 });
}

export interface MarkdownViewProps {
  markdown: string;
  className?: string;
  collapsedChecklistSections?: readonly string[];
  decorations?: readonly MarkdownDecoration[];
  emptyText?: string;
  onCollapsedChecklistSectionsChange?: (sections: string[]) => void;
  onTaskChange?: (markdown: string) => void;
  taskChangesDisabled?: boolean;
}

interface MarkdownSingleLineEditorProps {
  ariaLabel: string;
  initialValue: string;
  onCancel: () => void;
  onCommit: (value: string) => void;
}

function MarkdownSingleLineEditor({ ariaLabel, initialValue, onCancel, onCommit }: MarkdownSingleLineEditorProps) {
  const [value, setValue] = useState(initialValue);
  const pasteSingleLine = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData("text/plain");
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart ?? value.length;
    const end = event.currentTarget.selectionEnd ?? start;
    setValue(`${value.slice(0, start)}${markdownSingleLine(pasted)}${value.slice(end)}`);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onCommit(value);
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      autoFocus
      className="markdown-task-inline-input"
      onChange={(event) => setValue(markdownSingleLine(event.currentTarget.value))}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onPaste={pasteSingleLine}
      type="text"
      value={value}
    />
  );
}

type ActiveMarkdownTaskEditor =
  | { baseMarkdown: string; kind: "add"; sourceLine: number }
  | { baseMarkdown: string; initialValue: string; kind: "edit"; sourceLine: number };

function checklistProgressLabel(progress: ChecklistProgress): string {
  return progress.open
    ? `Выполнено ${progress.checked}, общее количество неизвестно`
    : `Выполнено ${progress.checked} из ${progress.total}`;
}

function ChecklistProgressView({ progress }: { progress: ChecklistProgress }) {
  return (
    <span aria-label={checklistProgressLabel(progress)} className="markdown-checklist-progress">
      {progress.checked}/{progress.open ? "?" : progress.total}
    </span>
  );
}

export function MarkdownView({ markdown, className = "", collapsedChecklistSections = [], decorations, emptyText = "Текста пока нет", onCollapsedChecklistSectionsChange, onTaskChange, taskChangesDisabled = false }: MarkdownViewProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  const collapseDomIdPrefix = useId();
  const [activeTaskEditor, setActiveTaskEditor] = useState<ActiveMarkdownTaskEditor | null>(null);
  const taskTextEditingEnabled = Boolean(onTaskChange) && !taskChangesDisabled;
  const locatedInline = (value: string, key: string, location?: MarkdownTextLocation): ReactNode[] =>
    renderInline(value, key, decorations && location ? { decorations, ...location } : undefined);
  const locatedLines = (value: string, key: string, locations: readonly MarkdownTextLocation[] = []): ReactNode => {
    if (!decorations) return renderInline(value, key);
    const lines = value.split("\n");
    return lines.map((line, index) => (
      <Fragment key={`${key}-line-${index}`}>
        {locatedInline(line, `${key}-line-${index}`, locations[index])}
        {index < lines.length - 1 ? <br /> : null}
      </Fragment>
    ));
  };
  useEffect(() => {
    if (activeTaskEditor && (!taskTextEditingEnabled || activeTaskEditor.baseMarkdown !== markdown)) {
      setActiveTaskEditor(null);
    }
  }, [activeTaskEditor, markdown, taskTextEditingEnabled]);
  if (!blocks.length) return <p className={`markdown-empty ${className}`}>{emptyText}</p>;

  const collapsedSections = new Set(collapsedChecklistSections);
  const validCollapseIds = new Set<string>();
  const collectListCollapseIds = (block: MarkdownBlock): void => {
    for (const item of block.items ?? []) {
      if (item.collapseId) validCollapseIds.add(item.collapseId);
      for (const child of item.children) collectListCollapseIds(child);
    }
  };
  for (const block of blocks) {
    if (block.type === "heading" && block.checklistProgress && block.collapseId) validCollapseIds.add(block.collapseId);
    if (block.type === "list" || block.type === "ordered-list") collectListCollapseIds(block);
    if (block.type === "table") {
      for (const section of block.table?.sections ?? []) {
        if (section.type === "group" && section.collapseId) validCollapseIds.add(section.collapseId);
      }
    }
  }
  const toggleChecklistSection = (collapseId: string): void => {
    if (!onCollapsedChecklistSectionsChange || taskChangesDisabled) return;
    const next = new Set(collapsedChecklistSections.filter((id) => validCollapseIds.has(id)));
    if (next.has(collapseId)) next.delete(collapseId);
    else next.add(collapseId);
    onCollapsedChecklistSectionsChange([...next].sort());
  };

  const renderList = (block: MarkdownBlock, key: string): ReactNode => {
    const Tag = block.type === "list" ? "ul" : "ol";
    return (
      <Tag key={key}>
        {block.items?.map((item, itemIndex) => {
          const itemKey = `${key}-${item.sourceLine}-${itemIndex}`;
          const children = item.children.map((child, childIndex) => renderList(child, `${itemKey}-child-${childIndex}`));
          if (item.openMarker) {
            if (!taskTextEditingEnabled) return null;
            const adding = activeTaskEditor?.kind === "add" && activeTaskEditor.sourceLine === item.sourceLine;
            return (
              <li className="markdown-open-checklist-marker" key={itemKey}>
                {adding ? (
                  <MarkdownSingleLineEditor
                    ariaLabel="Новый пункт чеклиста"
                    initialValue=""
                    key={`${itemKey}-input`}
                    onCancel={() => setActiveTaskEditor(null)}
                    onCommit={(value) => {
                      if (activeTaskEditor.baseMarkdown !== markdown) {
                        setActiveTaskEditor(null);
                        return;
                      }
                      const nextMarkdown = insertMarkdownOpenChecklistItem(markdown, item.sourceLine, value);
                      setActiveTaskEditor(null);
                      if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                    }}
                  />
                ) : (
                  <button
                    aria-label="Добавить пункт чеклиста"
                    className="markdown-open-checklist-add"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTaskEditor({ baseMarkdown: markdown, kind: "add", sourceLine: item.sourceLine });
                    }}
                    type="button"
                  >Добавить</button>
                )}
                {children}
              </li>
            );
          }
          if (item.taskChecked === undefined) {
            const progress = item.checklistProgress;
            if (!progress) return <li key={itemKey}>{locatedLines(item.value, itemKey, item.sourceLocations)}{children}</li>;
            const complete = !progress.open && progress.checked === progress.total;
            const collapseId = item.collapseId;
            const collapsed = Boolean(collapseId && collapsedSections.has(collapseId));
            const contentId = collapseId ? `${collapseDomIdPrefix}-markdown-${collapseId}-content` : undefined;
            const headerChildren = <>
              <span className="markdown-checklist-group__title">{locatedLines(item.value, itemKey, item.sourceLocations)}</span>{" "}
              <ChecklistProgressView progress={progress} />
            </>;
            return (
              <li
                className={`markdown-checklist-group${complete ? " markdown-checklist-group--complete" : ""}${collapsed ? " markdown-checklist-group--collapsed" : ""}`}
                data-checklist-section-id={collapseId}
                data-markdown-source-line={item.sourceLine}
                key={itemKey}
              >
                {onCollapsedChecklistSectionsChange && collapseId ? (
                  <button aria-controls={contentId} aria-expanded={!collapsed} className="markdown-checklist-group__header markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} type="button">{headerChildren}</button>
                ) : <div className="markdown-checklist-group__header">{headerChildren}</div>}
                <div className="markdown-checklist-group__content" hidden={collapsed} id={contentId}>{children}</div>
              </li>
            );
          }
          const editing = activeTaskEditor?.kind === "edit" && activeTaskEditor.sourceLine === item.sourceLine;
          const taskLabel = markdownLabel(item.firstLineValue) || "пункт";
          return (
            <li className={`markdown-task-item${item.taskChecked ? " markdown-task-item--checked" : ""}`} key={itemKey}>
              <div className="markdown-task-row">
                <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                  <input
                    aria-label={`${item.taskChecked ? "Снять отметку" : "Отметить"}: ${item.value || "пункт"}`}
                    checked={item.taskChecked}
                    className="markdown-task-checkbox"
                    disabled={!onTaskChange || taskChangesDisabled}
                    onChange={(event) => {
                      const nextMarkdown = setMarkdownTaskChecked(markdown, item.sourceLine, event.currentTarget.checked);
                      if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                    }}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </label>
                <span className="markdown-task-content">
                  {editing ? (
                    <MarkdownSingleLineEditor
                      ariaLabel={`Текст пункта: ${taskLabel}`}
                      initialValue={activeTaskEditor.initialValue}
                      key={`${itemKey}-input`}
                      onCancel={() => setActiveTaskEditor(null)}
                      onCommit={(value) => {
                        if (activeTaskEditor.baseMarkdown !== markdown) {
                          setActiveTaskEditor(null);
                          return;
                        }
                        const nextMarkdown = setMarkdownTaskItemText(markdown, item.sourceLine, value);
                        setActiveTaskEditor(null);
                        if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                      }}
                    />
                  ) : locatedLines(item.value, itemKey, item.sourceLocations)}
                </span>
                {taskTextEditingEnabled && !editing ? (
                  <button
                    aria-label={`Редактировать пункт: ${taskLabel}`}
                    className="markdown-task-edit-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTaskEditor({ baseMarkdown: markdown, initialValue: item.firstLineValue, kind: "edit", sourceLine: item.sourceLine });
                    }}
                    title="Редактировать пункт"
                    type="button"
                  ><Icon name="edit" size={13} /></button>
                ) : null}
              </div>
              {children}
            </li>
          );
        })}
      </Tag>
    );
  };

  const renderTable = (block: MarkdownBlock, key: string): ReactNode => {
    const table = block.table;
    if (!table) return null;
    const alignmentClass = (index: number) => table.alignments[index] ? `markdown-table-cell--${table.alignments[index]}` : undefined;

    const renderTableRow = (row: MarkdownTableRow, rowIndex: number, rowKey: string): ReactNode => {
      const progress = getTableRowProgress(row);
      const rowComplete = progress.total > 0 && progress.checked === progress.total;
      const rowLabel = row.cells.map((cell) => markdownLabel(cell.value)).find(Boolean);
      const rowTaskLabel = rowLabel || `строка ${rowIndex + 1}`;
      return (
        <tr className={rowComplete ? "markdown-table-row--complete" : undefined} key={`${rowKey}-row-${row.sourceLine}`}>
          {row.cells.map((cell, cellIndex) => {
            const cellKey = `${rowKey}-row-${row.sourceLine}-cell-${cellIndex}`;
            if (cell.taskChecked === undefined) {
              return <td className={alignmentClass(cellIndex)} key={cellKey}>{locatedInline(cell.value, cellKey, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine })}</td>;
            }
            const columnLabel = markdownLabel(table.headers[cellIndex]?.value ?? "");
            const cellLabel = markdownLabel(cell.value);
            const taskLabel = cellLabel || [rowTaskLabel, columnLabel].filter(Boolean).join(" — ") || `строка ${rowIndex + 1}, столбец ${cellIndex + 1}`;
            return (
              <td className={alignmentClass(cellIndex)} key={cellKey}>
                <div className={`markdown-table-task${cell.value ? "" : " markdown-table-task--only"}`}>
                  <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                    <input
                      aria-label={`${cell.taskChecked ? "Снять отметку" : "Отметить"}: ${taskLabel}`}
                      checked={cell.taskChecked}
                      className="markdown-task-checkbox"
                      disabled={!onTaskChange || taskChangesDisabled}
                      onChange={(event) => {
                        if (cell.taskSourceColumn === undefined) return;
                        const nextMarkdown = setMarkdownTableTaskChecked(markdown, row.sourceLine, cell.taskSourceColumn, event.currentTarget.checked);
                        if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                      }}
                      onClick={(event) => event.stopPropagation()}
                      type="checkbox"
                    />
                  </label>
                  {cell.value ? <span>{locatedInline(cell.value, `${cellKey}-content`, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine })}</span> : null}
                </div>
              </td>
            );
          })}
        </tr>
      );
    };

    return (
      <div className="markdown-table-scroll" key={key}>
        <table className="markdown-table">
          <thead>
            <tr>
              {table.headers.map((cell, cellIndex) => (
                <th key={`${key}-header-${cellIndex}`} scope="col">
                  {locatedInline(cell.value, `${key}-header-${cellIndex}`, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine })}
                </th>
              ))}
            </tr>
          </thead>
          {table.sections.map((section, sectionIndex) => {
            if (section.type === "rows") {
              return (
                <tbody key={`${key}-rows-${sectionIndex}`}>
                  {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, `${key}-rows-${sectionIndex}`))}
                </tbody>
              );
            }
            const progress = section.checklistProgress;
            const complete = Boolean(progress && progress.total > 0 && progress.checked === progress.total);
            const collapseId = section.collapseId;
            const collapsed = Boolean(collapseId && collapsedSections.has(collapseId));
            const contentId = collapseId ? `${collapseDomIdPrefix}-markdown-${collapseId}-content` : undefined;
            const groupKey = `${key}-group-${section.titleSourceLine}`;
            const headerChildren = <>
              <span className="markdown-table-group__title">
                {locatedInline(section.title.value, `${groupKey}-title`, section.title.sourceLine === undefined || section.title.sourceColumn === undefined ? undefined : { sourceColumn: section.title.sourceColumn, sourceLine: section.title.sourceLine })}
              </span>{" "}
              {progress ? <ChecklistProgressView progress={progress} /> : null}
            </>;
            return (
              <Fragment key={groupKey}>
                <tbody
                  className={`markdown-table-group${complete ? " markdown-table-group--complete" : ""}`}
                  data-checklist-section-id={collapseId}
                  data-markdown-source-line={section.titleSourceLine}
                >
                  <tr className="markdown-table-group__heading">
                    <th colSpan={table.headers.length} scope="rowgroup">
                      {onCollapsedChecklistSectionsChange && collapseId ? (
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
                      ) : <div className="markdown-table-group__header">{headerChildren}</div>}
                    </th>
                  </tr>
                </tbody>
                <tbody className="markdown-table-group__content" hidden={collapsed} id={contentId}>
                  {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, groupKey))}
                </tbody>
              </Fragment>
            );
          })}
        </table>
      </div>
    );
  };

  let hiddenHeadingDepth: number | null = null;
  const renderBlock = (block: MarkdownBlock, index: number): ReactNode => {
    const key = `${block.type}-${index}`;
    if (block.type === "heading") {
      const depth = block.depth ?? 0;
      if (hiddenHeadingDepth !== null) {
        if (depth > hiddenHeadingDepth) return null;
        hiddenHeadingDepth = null;
      }
    } else if (hiddenHeadingDepth !== null) {
      return null;
    }
    if (block.type === "code") return <pre key={key}><code>{block.value}</code></pre>;
    if (block.type === "rule") return <hr key={key} />;
    if (block.type === "quote") {
      return <blockquote key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{locatedInline(line, `${key}-${lineIndex}`, block.sourceLocations?.[lineIndex])}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</blockquote>;
    }
    if (block.type === "list" || block.type === "ordered-list") {
      return renderList(block, key);
    }
    if (block.type === "table") return renderTable(block, key);
    if (block.type === "heading") {
      const children = locatedInline(block.value ?? "", key, block.sourceLocations?.[0]);
      const progress = block.checklistProgress;
      const collapseId = block.collapseId;
      const collapsed = Boolean(progress && collapseId && collapsedSections.has(collapseId));
      if (collapsed) hiddenHeadingDepth = block.depth ?? 0;
      const headingClassName = progress ? `markdown-checklist-heading${!progress.open && progress.checked === progress.total ? " markdown-checklist-heading--complete" : ""}${collapsed ? " markdown-checklist-heading--collapsed" : ""}` : undefined;
      const progressChildren = progress ? <><span className="markdown-checklist-heading__title">{children}</span>{" "}<ChecklistProgressView progress={progress} /></> : children;
      const headingChildren = progress && collapseId && onCollapsedChecklistSectionsChange ? (
        <button aria-expanded={!collapsed} className="markdown-checklist-heading__toggle markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} type="button">{progressChildren}</button>
      ) : progressChildren;
      if (block.depth === 1) return <h2 className={headingClassName} data-checklist-section-id={progress ? collapseId : undefined} key={key}>{headingChildren}</h2>;
      if (block.depth === 2) return <h3 className={headingClassName} data-checklist-section-id={progress ? collapseId : undefined} key={key}>{headingChildren}</h3>;
      return <h4 className={headingClassName} data-checklist-section-id={progress ? collapseId : undefined} key={key}>{headingChildren}</h4>;
    }
    return <p key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{locatedInline(line, `${key}-${lineIndex}`, block.sourceLocations?.[lineIndex])}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</p>;
  };

  const content: ReactNode[] = [];
  let sectionStartIndex: number | null = null;
  let sectionChildren: ReactNode[] = [];
  const flushSection = (): void => {
    if (sectionStartIndex === null) return;
    content.push(<div className="markdown-section" key={`section-${sectionStartIndex}`}>{sectionChildren}</div>);
  };
  blocks.forEach((block, index) => {
    if (block.type === "heading" && block.depth === 1) {
      flushSection();
      sectionStartIndex = index;
      sectionChildren = [];
    }
    const rendered = renderBlock(block, index);
    if (sectionStartIndex === null) content.push(rendered);
    else sectionChildren.push(rendered);
  });
  flushSection();

  return <div className={`markdown ${className}`}>{content}</div>;
}

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || !file.type && IMAGE_FILE_EXTENSION.test(file.name);
}

export function snapshotFiles(transfer: DataTransfer): File[] {
  const itemFiles = Array.from(transfer.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  return itemFiles.length ? itemFiles : Array.from(transfer.files ?? []);
}

export function hasFilePayload(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes("Files") || Array.from(transfer.items ?? []).some((item) => item.kind === "file") || transfer.files.length > 0;
}

export interface PlainMarkdownTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onPaste" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"> {
  value: string;
  onChange: (value: string) => void;
  onImageFiles?: (files: File[]) => void;
  onFileFiles?: (files: File[]) => void;
  onImageError?: (error: Error) => void;
  imagesDisabled?: boolean;
}

export const PlainMarkdownTextarea = forwardRef<HTMLTextAreaElement, PlainMarkdownTextareaProps>(function PlainMarkdownTextarea({
  value,
  onChange,
  onImageFiles,
  onFileFiles,
  onImageError,
  imagesDisabled = false,
  className = "",
  ...textareaProps
}, ref) {
  const [dragOver, setDragOver] = useState(false);

  const acceptFiles = (transfer: DataTransfer): boolean => {
    const files = snapshotFiles(transfer);
    const images = files.filter(isImageFile);
    const otherFiles = files.filter((file) => !isImageFile(file));
    if (!images.length && (!otherFiles.length || !onFileFiles)) {
      if (!imagesDisabled) onImageError?.(new Error("Можно добавить только изображения."));
      return false;
    }
    if (!imagesDisabled) {
      if (images.length) onImageFiles?.(images);
      if (otherFiles.length) onFileFiles?.(otherFiles);
    }
    return true;
  };

  return (
    <textarea
      {...textareaProps}
      className={`${className}${dragOver ? `${className ? " " : ""}is-drag-over` : ""}`}
      onChange={(event) => onChange(event.currentTarget.value)}
      onDragEnter={(event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        if (!imagesDisabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDragOver={(event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!imagesDisabled) setDragOver(true);
      }}
      onDrop={(event) => {
        setDragOver(false);
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        if (!imagesDisabled) acceptFiles(event.dataTransfer);
      }}
      onPaste={(event) => {
        const files = snapshotFiles(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        acceptFiles(event.clipboardData);
      }}
      ref={ref}
      value={value}
    />
  );
});
