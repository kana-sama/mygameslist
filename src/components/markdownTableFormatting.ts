import { scanMarkdownTableLine, type MarkdownTableLineSyntax } from "./markdownTableSyntax";

export interface MarkdownTableFormattedLine {
  lineIndex: number;
  text: string;
}

export interface MarkdownTableFormattingResult {
  lines: MarkdownTableFormattedLine[];
}

export interface MinimalMarkdownTableLineEdit {
  startColumn: number;
  endColumn: number;
  text: string;
}

type Alignment = "center" | "left" | "right";

interface OrdinaryRow {
  kind: "ordinary" | "delimiter";
  lineIndex: number;
  syntax: MarkdownTableLineSyntax;
}

interface GroupTitle {
  kind: "title";
  lineIndex: number;
  syntax: MarkdownTableLineSyntax;
}

type TableLine = OrdinaryRow | GroupTitle;

function isTableBoundary(line: string): boolean {
  return /^\s*(?:`{3,}|~{3,}|#{1,6}\s|>\s?)/.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)
    || /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function isDelimiter(syntax: MarkdownTableLineSyntax | null, columnCount: number): boolean {
  return Boolean(
    syntax
    && syntax.cells.length === columnCount
    && syntax.cells.every((cell) => /^:?-{3,}:?$/.test(cell.sourceText)),
  );
}

function hasMatchingFrame(
  syntax: MarkdownTableLineSyntax,
  framed: boolean,
  prefix: string,
): boolean {
  return framed
    ? syntax.hasLeadingPipe && syntax.hasTrailingPipe && syntax.leadingWhitespace === prefix
    : !syntax.hasLeadingPipe && !syntax.hasTrailingPipe;
}

function normalizeOrdinarySyntax(
  syntax: MarkdownTableLineSyntax,
  columnCount: number,
  framed: boolean,
  prefix: string,
): MarkdownTableLineSyntax | null {
  if (framed) {
    return hasMatchingFrame(syntax, true, prefix) && syntax.cells.length === columnCount
      ? syntax
      : null;
  }
  if (syntax.hasLeadingPipe) return null;
  if (!syntax.hasTrailingPipe && syntax.cells.length === columnCount) return syntax;
  if (syntax.hasTrailingPipe && syntax.cells.length + 1 === columnCount) {
    const lastPipe = syntax.pipeIndices.at(-1);
    if (lastPipe === undefined) return null;
    return {
      ...syntax,
      cells: [...syntax.cells, { sourceColumn: lastPipe + 1, sourceText: "", value: "" }],
      hasTrailingPipe: false,
    };
  }
  return null;
}

function isGroupTitle(
  syntax: MarkdownTableLineSyntax | null,
  framed: boolean,
  prefix: string,
): syntax is MarkdownTableLineSyntax {
  if (!syntax || syntax.cells.length !== 1 || !syntax.cells[0].sourceText.trim()) return false;
  return framed
    ? syntax.hasLeadingPipe && syntax.hasTrailingPipe && syntax.leadingWhitespace === prefix
    : !syntax.hasLeadingPipe && syntax.hasTrailingPipe;
}

function alignmentForDelimiter(value: string): Alignment {
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
}

function tableBlockAt(lines: readonly string[], triggerLine: number): { end: number; start: number } | null {
  if (!Number.isInteger(triggerLine) || triggerLine < 0 || triggerLine >= lines.length) return null;
  if (isTableBoundary(lines[triggerLine]) || !scanMarkdownTableLine(lines[triggerLine])) return null;
  let start = triggerLine;
  while (start > 0 && !isTableBoundary(lines[start - 1]) && scanMarkdownTableLine(lines[start - 1])) start -= 1;
  let end = triggerLine + 1;
  while (end < lines.length && !isTableBoundary(lines[end]) && scanMarkdownTableLine(lines[end])) end += 1;
  return { start, end };
}

function padCell(value: string, width: number, alignment: Alignment): string {
  const extra = width - value.length;
  if (alignment === "right") return `${" ".repeat(extra)}${value}`;
  if (alignment === "center") {
    const left = Math.floor(extra / 2);
    return `${" ".repeat(left)}${value}${" ".repeat(extra - left)}`;
  }
  return `${value}${" ".repeat(extra)}`;
}

function formatDelimiter(value: string, width: number): string {
  const startsWithColon = value.startsWith(":");
  const endsWithColon = value.endsWith(":");
  return `${startsWithColon ? ":" : ""}${"-".repeat(width - Number(startsWithColon) - Number(endsWithColon))}${endsWithColon ? ":" : ""}`;
}

function serializeCells(cells: readonly string[], framed: boolean, prefix: string): string {
  const body = cells.join(" | ");
  return framed ? `${prefix}| ${body} |` : body;
}

function hasCompactDelimiterGutters(syntax: MarkdownTableLineSyntax): boolean {
  return syntax.cells.every((cell, column) => {
    const cellEnd = cell.sourceColumn + cell.sourceText.length;
    if (syntax.hasLeadingPipe || column > 0) {
      const precedingPipe = syntax.pipeIndices[syntax.hasLeadingPipe ? column : column - 1];
      if (cell.sourceColumn !== precedingPipe + 1) return false;
    }
    if (syntax.hasTrailingPipe || column < syntax.cells.length - 1) {
      const followingPipe = syntax.pipeIndices[syntax.hasLeadingPipe ? column + 1 : column];
      if (cellEnd !== followingPipe) return false;
    }
    return true;
  });
}

function compactDelimiterGutter(framed: boolean, column: number, columnCount: number): number {
  return framed || (column > 0 && column < columnCount - 1) ? 2 : 1;
}

function serializeDelimiterCells(
  cells: readonly string[],
  framed: boolean,
  prefix: string,
  compact: boolean,
): string {
  if (!compact) return serializeCells(cells, framed, prefix);
  const body = cells.join("|");
  return framed ? `${prefix}|${body}|` : body;
}

export function formatMarkdownTableAtLine(
  lines: readonly string[],
  triggerLine: number,
): MarkdownTableFormattingResult | null {
  const block = tableBlockAt(lines, triggerLine);
  if (!block) return null;
  let tableStart = -1;
  for (let index = block.start; index < block.end - 1 && index <= triggerLine; index += 1) {
    const candidateHeader = scanMarkdownTableLine(lines[index]);
    if (!candidateHeader?.cells.length) continue;
    const candidateDelimiter = scanMarkdownTableLine(lines[index + 1]);
    if (!candidateDelimiter?.cells.length || !isDelimiter(candidateDelimiter, candidateDelimiter.cells.length)) continue;
    const candidateFramed = candidateHeader.hasLeadingPipe && candidateHeader.hasTrailingPipe;
    const candidatePrefix = candidateFramed ? candidateHeader.leadingWhitespace : "";
    const normalizedHeader = normalizeOrdinarySyntax(
      candidateHeader,
      candidateDelimiter.cells.length,
      candidateFramed,
      candidatePrefix,
    );
    if (
      normalizedHeader
      && (candidateFramed || candidateDelimiter.cells.length > 1)
      && hasMatchingFrame(candidateDelimiter, candidateFramed, candidatePrefix)
    ) {
      tableStart = index;
      break;
    }
  }
  if (tableStart < 0) return null;
  const rawHeader = scanMarkdownTableLine(lines[tableStart]);
  if (!rawHeader || !rawHeader.cells.length) return null;

  const headerDelimiterIndex = tableStart + 1;
  const rawHeaderDelimiter = scanMarkdownTableLine(lines[headerDelimiterIndex] ?? "");
  if (!rawHeaderDelimiter?.cells.length || !isDelimiter(rawHeaderDelimiter, rawHeaderDelimiter.cells.length)) return null;
  const columnCount = rawHeaderDelimiter.cells.length;
  const framed = rawHeader.hasLeadingPipe && rawHeader.hasTrailingPipe;
  const prefix = framed ? rawHeader.leadingWhitespace : "";
  const header = normalizeOrdinarySyntax(rawHeader, columnCount, framed, prefix);
  const headerDelimiter = normalizeOrdinarySyntax(rawHeaderDelimiter, columnCount, framed, prefix);
  if (!header || !headerDelimiter || (!framed && columnCount === 1)) return null;

  const parsed: TableLine[] = [
    { kind: "ordinary", lineIndex: tableStart, syntax: header },
    { kind: "delimiter", lineIndex: headerDelimiterIndex, syntax: headerDelimiter },
  ];
  let index = headerDelimiterIndex + 1;
  let firstGroupMayUseHeaderDelimiter = columnCount > 1;

  while (index < block.end) {
    const syntax = scanMarkdownTableLine(lines[index]);
    if (!syntax) return null;

    if (firstGroupMayUseHeaderDelimiter && isGroupTitle(syntax, framed, prefix)) {
      const closing = scanMarkdownTableLine(lines[index + 1] ?? "");
      const normalizedClosing = closing && normalizeOrdinarySyntax(closing, columnCount, framed, prefix);
      if (isDelimiter(closing, columnCount) && normalizedClosing) {
        parsed.push({ kind: "title", lineIndex: index, syntax });
        parsed.push({ kind: "delimiter", lineIndex: index + 1, syntax: normalizedClosing });
        index += 2;
        firstGroupMayUseHeaderDelimiter = false;
        continue;
      }
    }
    firstGroupMayUseHeaderDelimiter = false;

    if (isDelimiter(syntax, columnCount)) {
      const normalizedDelimiter = normalizeOrdinarySyntax(syntax, columnCount, framed, prefix);
      if (!normalizedDelimiter) return null;
      if (columnCount > 1) {
        const title = scanMarkdownTableLine(lines[index + 1] ?? "");
        const closing = scanMarkdownTableLine(lines[index + 2] ?? "");
        const normalizedClosing = closing && normalizeOrdinarySyntax(closing, columnCount, framed, prefix);
        if (isGroupTitle(title, framed, prefix) && isDelimiter(closing, columnCount) && normalizedClosing) {
          parsed.push({ kind: "delimiter", lineIndex: index, syntax: normalizedDelimiter });
          parsed.push({ kind: "title", lineIndex: index + 1, syntax: title });
          parsed.push({ kind: "delimiter", lineIndex: index + 2, syntax: normalizedClosing });
          index += 3;
          continue;
        }
      }
      parsed.push({ kind: "delimiter", lineIndex: index, syntax: normalizedDelimiter });
      index += 1;
      continue;
    }

    const normalSyntax = normalizeOrdinarySyntax(syntax, columnCount, framed, prefix);
    if (!normalSyntax) return null;
    parsed.push({ kind: "ordinary", lineIndex: index, syntax: normalSyntax });
    index += 1;
  }

  const delimiterCells = parsed.find((line) => line.kind === "delimiter")?.syntax.cells;
  if (!delimiterCells) return null;
  const widths = Array.from({ length: columnCount }, (_, column) => Math.max(
    ...parsed
      .filter((line): line is OrdinaryRow => line.kind !== "title")
      .map((line) => {
        const cell = line.syntax.cells[column];
        return line.kind === "delimiter" && hasCompactDelimiterGutters(line.syntax)
          ? cell.sourceText.length - compactDelimiterGutter(framed, column, columnCount)
          : cell.sourceText.length;
      }),
  ));
  const titleCapacity = () => widths.reduce((total, width) => total + width, 0)
    + 3 * (columnCount - 1) - (framed ? 0 : 2);
  const longestTitle = Math.max(0, ...parsed
    .filter((line): line is GroupTitle => line.kind === "title")
    .map((line) => line.syntax.cells[0].sourceText.length));
  if (longestTitle > titleCapacity()) widths[widths.length - 1] += longestTitle - titleCapacity();

  const alignments = delimiterCells.map((cell) => alignmentForDelimiter(cell.sourceText));
  const formatted = parsed.map((line) => {
    if (line.kind === "title") {
      const title = line.syntax.cells[0].sourceText.padEnd(titleCapacity());
      return {
        lineIndex: line.lineIndex,
        text: framed ? `${prefix}| ${title} |` : `${title} |`,
      };
    }
    const compact = line.kind === "delimiter" && hasCompactDelimiterGutters(line.syntax);
    const cells = line.syntax.cells.map((cell, column) => line.kind === "delimiter"
      ? formatDelimiter(
        cell.sourceText,
        widths[column] + (compact ? compactDelimiterGutter(framed, column, columnCount) : 0),
      )
      : padCell(cell.sourceText, widths[column], alignments[column]));
    return {
      lineIndex: line.lineIndex,
      text: line.kind === "delimiter"
        ? serializeDelimiterCells(cells, framed, prefix, compact)
        : serializeCells(cells, framed, prefix),
    };
  });
  const changed = formatted.filter((line) => lines[line.lineIndex] !== line.text);
  return changed.length ? { lines: changed } : null;
}

export function deriveMinimalMarkdownTableLineEdit(
  previous: string,
  next: string,
): MinimalMarkdownTableLineEdit | null {
  if (previous === next) return null;
  let startColumn = 0;
  while (startColumn < previous.length && startColumn < next.length && previous[startColumn] === next[startColumn]) startColumn += 1;
  let suffixLength = 0;
  while (
    suffixLength < previous.length - startColumn
    && suffixLength < next.length - startColumn
    && previous[previous.length - suffixLength - 1] === next[next.length - suffixLength - 1]
  ) suffixLength += 1;
  return {
    startColumn,
    endColumn: previous.length - suffixLength,
    text: next.slice(startColumn, next.length - suffixLength),
  };
}
