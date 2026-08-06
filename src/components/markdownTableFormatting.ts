import {
  parseMarkdownTableAtLine,
  type ParsedMarkdownTableLine,
} from "./markdownTableStructure";
import type { MarkdownTableLineSyntax } from "./markdownTableSyntax";

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
type ParsedOrdinaryTableLine = Extract<ParsedMarkdownTableLine, { kind: "ordinary" | "delimiter" }>;
type ParsedTableTitleLine = Extract<ParsedMarkdownTableLine, { kind: "title" }>;

function alignmentForDelimiter(value: string): Alignment {
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
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

function delimiterLogicalMinimum(
  value: string,
  compact: boolean,
  framed: boolean,
  column: number,
  columnCount: number,
): number {
  const physicalMinimum = 3 + Number(value.startsWith(":")) + Number(value.endsWith(":"));
  return compact
    ? Math.max(0, physicalMinimum - compactDelimiterGutter(framed, column, columnCount))
    : physicalMinimum;
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
  const parsedBlock = parseMarkdownTableAtLine(lines, triggerLine);
  if (!parsedBlock) return null;
  const {
    columnCount,
    delimiterCells,
    framed,
    lines: parsed,
    prefix,
  } = parsedBlock;
  const widths = Array.from({ length: columnCount }, (_, column) => Math.max(
    ...parsed
      .filter((line): line is ParsedOrdinaryTableLine => line.kind !== "title")
      .map((line) => {
        const cell = line.syntax.cells[column];
        if (line.kind !== "delimiter") return cell.sourceText.length;
        return delimiterLogicalMinimum(
          cell.sourceText,
          hasCompactDelimiterGutters(line.syntax),
          framed,
          column,
          columnCount,
        );
      }),
  ));
  const titleCapacity = () => widths.reduce((total, width) => total + width, 0)
    + 3 * (columnCount - 1) - (framed ? 0 : 2);
  const longestTitle = Math.max(0, ...parsed
    .filter((line): line is ParsedTableTitleLine => line.kind === "title")
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
