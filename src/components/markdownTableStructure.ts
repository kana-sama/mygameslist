import { isInsideFencedMarkdownCode } from "./markdownListEditing";
import {
  scanMarkdownTableLine,
  type MarkdownTableLineSyntax,
  type MarkdownTableSyntaxCell,
} from "./markdownTableSyntax";

export type ParsedMarkdownTableLine =
  | { kind: "ordinary" | "delimiter"; lineIndex: number; syntax: MarkdownTableLineSyntax }
  | { kind: "title"; lineIndex: number; syntax: MarkdownTableLineSyntax };

export interface ParsedMarkdownTableBlock {
  columnCount: number;
  delimiterCells: readonly MarkdownTableSyntaxCell[];
  framed: boolean;
  lines: readonly ParsedMarkdownTableLine[];
  prefix: string;
}

export interface MarkdownTableSourceLine {
  lineIndex: number;
  text: string;
}

interface ParsedTableLines {
  columnCount: number;
  delimiterCells: readonly MarkdownTableSyntaxCell[];
  framed: boolean;
  lines: readonly ParsedMarkdownTableLine[];
  prefix: string;
}

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

function tableBlockAt(lines: readonly string[], triggerLine: number): { end: number; start: number } | null {
  if (!Number.isInteger(triggerLine) || triggerLine < 0 || triggerLine >= lines.length) return null;
  if (isTableBoundary(lines[triggerLine]) || !scanMarkdownTableLine(lines[triggerLine])) return null;
  let start = triggerLine;
  while (start > 0 && !isTableBoundary(lines[start - 1]) && scanMarkdownTableLine(lines[start - 1])) start -= 1;
  let end = triggerLine + 1;
  while (end < lines.length && !isTableBoundary(lines[end]) && scanMarkdownTableLine(lines[end])) end += 1;
  return { start, end };
}

function parseTableLines(
  lines: readonly string[],
  triggerLine: number,
  bounds: { end: number; start: number },
): ParsedTableLines | null {
  let tableStart = -1;
  for (let index = bounds.start; index < bounds.end - 1 && index <= triggerLine; index += 1) {
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

  const parsed: ParsedMarkdownTableLine[] = [
    { kind: "ordinary", lineIndex: tableStart, syntax: header },
    { kind: "delimiter", lineIndex: headerDelimiterIndex, syntax: headerDelimiter },
  ];
  let index = headerDelimiterIndex + 1;
  let firstGroupMayUseHeaderDelimiter = columnCount > 1;

  while (index < bounds.end) {
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
  return {
    columnCount,
    delimiterCells,
    framed,
    lines: parsed,
    prefix,
  };
}

export function parseMarkdownTableAtLine(
  lines: readonly string[],
  triggerLine: number,
): ParsedMarkdownTableBlock | null {
  const bounds = tableBlockAt(lines, triggerLine);
  if (!bounds) return null;

  const source = lines.join("\n");
  const triggerOffset = lines
    .slice(0, triggerLine)
    .reduce((offset, line) => offset + line.length + 1, 0);
  if (isInsideFencedMarkdownCode(source, triggerOffset)) return null;

  return parseTableLines(lines, triggerLine, bounds);
}

export function findMarkdownTableSourceLines(
  lines: readonly string[],
): MarkdownTableSourceLine[] {
  const found: MarkdownTableSourceLine[] = [];
  let source: string | undefined;
  let lineIndex = 0;
  let lineOffset = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (isTableBoundary(line) || !scanMarkdownTableLine(line)) {
      lineOffset += line.length + 1;
      lineIndex += 1;
      continue;
    }

    const bounds = { start: lineIndex, end: lineIndex + 1 };
    const regionOffset = lineOffset;
    lineOffset += line.length + 1;
    while (bounds.end < lines.length) {
      const candidate = lines[bounds.end];
      if (isTableBoundary(candidate) || !scanMarkdownTableLine(candidate)) break;
      lineOffset += candidate.length + 1;
      bounds.end += 1;
    }

    const block = parseTableLines(lines, bounds.end - 1, bounds);
    if (!block) {
      lineIndex = bounds.end;
      continue;
    }

    source ??= lines.join("\n");
    if (isInsideFencedMarkdownCode(source, regionOffset)) {
      lineIndex = bounds.end;
      continue;
    }

    for (const line of block.lines) {
      found.push({
        lineIndex: line.lineIndex,
        text: lines[line.lineIndex],
      });
    }
    lineIndex = bounds.end;
  }

  return found;
}
