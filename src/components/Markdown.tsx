import { forwardRef, Fragment, useId, useMemo, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { safeUrl } from "./libraryUi";

function renderInline(source: string, keyPrefix = "inline"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    const raw = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (raw.startsWith("`")) {
      nodes.push(<code key={key}>{raw.slice(1, -1)}</code>);
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
            {renderInline(linkMatch[1], `${key}-label`)}
          </a>,
        );
      } else {
        nodes.push(raw);
      }
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(raw.slice(2, -2), `${key}-strong`)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(raw.slice(1, -1), `${key}-em`)}</em>);
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
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
}

interface ChecklistProgress {
  checked: number;
  total: number;
}

interface MarkdownListItem {
  value: string;
  sourceLine: number;
  taskChecked?: boolean;
  children: MarkdownBlock[];
  checklistProgress?: ChecklistProgress;
  collapseId?: string;
}

type MarkdownTableAlignment = "center" | "left" | "right" | undefined;

interface MarkdownTableCell {
  value: string;
  taskChecked?: boolean;
  taskSourceColumn?: number;
}

interface MarkdownTableRow {
  cells: MarkdownTableCell[];
  sourceLine: number;
}

interface MarkdownTable {
  alignments: MarkdownTableAlignment[];
  headers: MarkdownTableCell[];
  rows: MarkdownTableRow[];
}

const TASK_MARKER = /^\[([ xX])\](?:[ \t]+|$)/;

interface ParsedListLine {
  indent: number;
  contentIndent: number;
  type: "list" | "ordered-list";
  value: string;
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
  };
}

function parseList(lines: string[], startIndex: number, minimumIndent = 0): { block: MarkdownBlock; nextIndex: number } {
  const firstLine = parseListLine(lines[startIndex]);
  if (!firstLine) throw new Error("Expected a Markdown list line");

  const block: MarkdownBlock = { type: firstLine.type, items: [] };
  let index = startIndex;

  while (index < lines.length) {
    const line = parseListLine(lines[index]);
    if (!line || line.indent < minimumIndent || line.indent >= firstLine.contentIndent || line.type !== firstLine.type) break;

    const sourceLine = index;
    const task = TASK_MARKER.exec(line.value);
    const item: MarkdownListItem = {
      value: task ? line.value.slice(task[0].length) : line.value,
      sourceLine,
      taskChecked: task ? task[1].toLowerCase() === "x" : undefined,
      children: [],
    };
    index += 1;

    while (index < lines.length) {
      const childLine = parseListLine(lines[index]);
      if (childLine?.indent !== undefined && childLine.indent >= line.contentIndent) {
        const child = parseList(lines, index, line.contentIndent);
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
      item.value += `\n${lines[index].trim()}`;
      index += 1;
    }

    block.items?.push(item);
  }

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

function parseTableStart(lines: string[], startIndex: number): { alignments: MarkdownTableAlignment[]; headers: MarkdownTableCell[] } | null {
  if (startIndex + 1 >= lines.length) return null;
  const headerCells = splitTableLine(lines[startIndex]);
  const delimiterCells = splitTableLine(lines[startIndex + 1]);
  if (!headerCells?.length || !delimiterCells || delimiterCells.length !== headerCells.length) return null;
  if (!delimiterCells.every((cell) => /^:?-+:?$/.test(cell.value))) return null;
  return {
    alignments: delimiterCells.map((cell) => tableAlignment(cell.value)),
    headers: headerCells.map((cell) => ({ value: cell.value })),
  };
}

function parseTable(lines: string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } | null {
  const start = parseTableStart(lines, startIndex);
  if (!start) return null;

  const rows: MarkdownTableRow[] = [];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].trim()) {
    if (
      /^\s*```/.test(lines[index]) ||
      /^(#{1,4})\s+/.test(lines[index]) ||
      /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(lines[index]) ||
      parseListLine(lines[index]) ||
      /^\s*>\s?/.test(lines[index])
    ) break;
    const parsedCells = splitTableLine(lines[index]);
    if (!parsedCells) break;
    const cells = parsedCells.slice(0, start.headers.length).map<MarkdownTableCell>((cell) => {
      const task = TASK_MARKER.exec(cell.value);
      return {
        value: task ? cell.value.slice(task[0].length) : cell.value,
        taskChecked: task ? task[1].toLowerCase() === "x" : undefined,
        taskSourceColumn: task ? cell.sourceColumn : undefined,
      };
    });
    while (cells.length < start.headers.length) cells.push({ value: "" });
    rows.push({ cells, sourceLine: index });
    index += 1;
  }

  return {
    block: { type: "table", table: { ...start, rows } },
    nextIndex: index,
  };
}

function getChecklistProgress(block: MarkdownBlock): ChecklistProgress {
  if (block.type === "table") {
    const tableProgress = (block.table?.rows ?? []).reduce<ChecklistProgress>((progress, row) => {
      for (const cell of row.cells) {
        if (cell.taskChecked === undefined) continue;
        progress.total += 1;
        if (cell.taskChecked) progress.checked += 1;
      }
      return progress;
    }, { checked: 0, total: 0 });
    block.checklistProgress = tableProgress.total > 0 ? tableProgress : undefined;
    return tableProgress;
  }

  const blockProgress = (block.items ?? []).reduce<ChecklistProgress>((progress, item) => {
    const itemProgress: ChecklistProgress = { checked: 0, total: 0 };
    if (item.taskChecked !== undefined) {
      itemProgress.total += 1;
      if (item.taskChecked) itemProgress.checked += 1;
    }
    for (const child of item.children) {
      const childProgress = getChecklistProgress(child);
      itemProgress.checked += childProgress.checked;
      itemProgress.total += childProgress.total;
    }
    item.checklistProgress = itemProgress.total > 0 ? itemProgress : undefined;
    progress.checked += itemProgress.checked;
    progress.total += itemProgress.total;
    return progress;
  }, { checked: 0, total: 0 });
  block.checklistProgress = blockProgress.total > 0 ? blockProgress : undefined;
  return blockProgress;
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

function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
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
      blocks.push({ type: "heading", depth: heading[1].length, value: heading[2] });
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (parseListLine(line)) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", value: quote.join("\n") });
      continue;
    }
    const table = parseTable(lines, index);
    if (table) {
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !parseTableStart(lines, index) &&
      !/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", value: paragraph.join("\n") });
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

    const progress = getChecklistProgress(block);
    if (progress.total === 0) continue;
    if (block.type === "list" || block.type === "ordered-list") {
      annotateChecklistGroupIds(block, activeHeadings[activeHeadings.length - 1]?.path ?? "root", collapsePathOccurrences);
    }
    for (const { block: heading } of activeHeadings) {
      const headingProgress = heading.checklistProgress ?? { checked: 0, total: 0 };
      headingProgress.checked += progress.checked;
      headingProgress.total += progress.total;
      heading.checklistProgress = headingProgress;
    }
  }

  return blocks;
}

export function hasMarkdownTasks(markdown: string): boolean {
  return parseBlocks(markdown).some((block) => getChecklistProgress(block).total > 0);
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
  }, { checked: 0, total: 0 });
}

export interface MarkdownViewProps {
  markdown: string;
  className?: string;
  collapsedChecklistSections?: readonly string[];
  emptyText?: string;
  onCollapsedChecklistSectionsChange?: (sections: string[]) => void;
  onTaskChange?: (markdown: string) => void;
  taskChangesDisabled?: boolean;
}

export function MarkdownView({ markdown, className = "", collapsedChecklistSections = [], emptyText = "Текста пока нет", onCollapsedChecklistSectionsChange, onTaskChange, taskChangesDisabled = false }: MarkdownViewProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  const collapseDomIdPrefix = useId();
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
          if (item.taskChecked === undefined) {
            const progress = item.checklistProgress;
            if (!progress) return <li key={itemKey}>{renderInline(item.value, itemKey)}{children}</li>;
            const complete = progress.checked === progress.total;
            const collapseId = item.collapseId;
            const collapsed = Boolean(collapseId && collapsedSections.has(collapseId));
            const contentId = collapseId ? `${collapseDomIdPrefix}-markdown-${collapseId}-content` : undefined;
            const headerChildren = <>
              <span className="markdown-checklist-group__title">{renderInline(item.value, itemKey)}</span>{" "}
              <span aria-label={`Выполнено ${progress.checked} из ${progress.total}`} className="markdown-checklist-progress">
                {progress.checked}/{progress.total}
              </span>
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
                <span className="markdown-task-content">{renderInline(item.value, itemKey)}</span>
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

    return (
      <div className="markdown-table-scroll" key={key}>
        <table className="markdown-table">
          <thead>
            <tr>
              {table.headers.map((cell, cellIndex) => (
                <th key={`${key}-header-${cellIndex}`} scope="col">
                  {renderInline(cell.value, `${key}-header-${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => {
              const progress = getTableRowProgress(row);
              const rowComplete = progress.total > 0 && progress.checked === progress.total;
              const rowLabel = row.cells.map((cell) => markdownLabel(cell.value)).find(Boolean);
              const rowTaskLabel = rowLabel || `строка ${rowIndex + 1}`;
              return (
                <tr className={rowComplete ? "markdown-table-row--complete" : undefined} key={`${key}-row-${row.sourceLine}`}>
                  {row.cells.map((cell, cellIndex) => {
                    const cellKey = `${key}-row-${row.sourceLine}-cell-${cellIndex}`;
                    if (cell.taskChecked === undefined) {
                      return <td className={alignmentClass(cellIndex)} key={cellKey}>{renderInline(cell.value, cellKey)}</td>;
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
                          {cell.value ? <span>{renderInline(cell.value, `${cellKey}-content`)}</span> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  let hiddenHeadingDepth: number | null = null;
  return (
    <div className={`markdown ${className}`}>
      {blocks.map((block, index) => {
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
          return <blockquote key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{renderInline(line, `${key}-${lineIndex}`)}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</blockquote>;
        }
        if (block.type === "list" || block.type === "ordered-list") {
          return renderList(block, key);
        }
        if (block.type === "table") return renderTable(block, key);
        if (block.type === "heading") {
          const children = renderInline(block.value ?? "", key);
          const progress = block.checklistProgress;
          const collapseId = block.collapseId;
          const collapsed = Boolean(progress && collapseId && collapsedSections.has(collapseId));
          if (collapsed) hiddenHeadingDepth = block.depth ?? 0;
          const headingClassName = progress ? `markdown-checklist-heading${progress.checked === progress.total ? " markdown-checklist-heading--complete" : ""}${collapsed ? " markdown-checklist-heading--collapsed" : ""}` : undefined;
          const progressChildren = progress ? <><span className="markdown-checklist-heading__title">{children}</span>{" "}<span aria-label={`Выполнено ${progress.checked} из ${progress.total}`} className="markdown-checklist-progress">{progress.checked}/{progress.total}</span></> : children;
          const headingChildren = progress && collapseId && onCollapsedChecklistSectionsChange ? (
            <button aria-expanded={!collapsed} className="markdown-checklist-heading__toggle markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} type="button">{progressChildren}</button>
          ) : progressChildren;
          if (block.depth === 1) return <h2 className={headingClassName} data-checklist-section-id={progress ? collapseId : undefined} key={key}>{headingChildren}</h2>;
          if (block.depth === 2) return <h3 className={headingClassName} data-checklist-section-id={progress ? collapseId : undefined} key={key}>{headingChildren}</h3>;
          return <h4 className={headingClassName} data-checklist-section-id={progress ? collapseId : undefined} key={key}>{headingChildren}</h4>;
        }
        return <p key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{renderInline(line, `${key}-${lineIndex}`)}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</p>;
      })}
    </div>
  );
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
