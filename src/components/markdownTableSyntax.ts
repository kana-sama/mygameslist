export interface MarkdownTableSyntaxCell {
  sourceColumn: number;
  sourceText: string;
  value: string;
}

export interface MarkdownTableLineSyntax {
  cells: MarkdownTableSyntaxCell[];
  hasLeadingPipe: boolean;
  hasTrailingPipe: boolean;
  leadingWhitespace: string;
  pipeIndices: number[];
}

export function isEscapedMarkdownTableCharacter(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

export function scanMarkdownTableLine(line: string): MarkdownTableLineSyntax | null {
  const pipeIndices: number[] = [];
  let inlineCodeDelimiterLength = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "`" && !isEscapedMarkdownTableCharacter(line, index)) {
      let runLength = 1;
      while (line[index + runLength] === "`") runLength += 1;
      if (!inlineCodeDelimiterLength) inlineCodeDelimiterLength = runLength;
      else if (inlineCodeDelimiterLength === runLength) inlineCodeDelimiterLength = 0;
      index += runLength - 1;
      continue;
    }
    if (line[index] === "|" && !inlineCodeDelimiterLength && !isEscapedMarkdownTableCharacter(line, index)) {
      pipeIndices.push(index);
    }
  }
  if (!pipeIndices.length) return null;

  const segments: Array<{ end: number; start: number }> = [];
  let start = 0;
  for (const pipe of pipeIndices) {
    segments.push({ start, end: pipe });
    start = pipe + 1;
  }
  segments.push({ start, end: line.length });

  const hasLeadingPipe = line.slice(segments[0].start, segments[0].end).trim() === "";
  if (hasLeadingPipe) segments.shift();
  const lastSegment = segments[segments.length - 1];
  const hasTrailingPipe = Boolean(lastSegment && line.slice(lastSegment.start, lastSegment.end).trim() === "");
  if (hasTrailingPipe) segments.pop();

  return {
    cells: segments.map((segment) => {
      const raw = line.slice(segment.start, segment.end);
      const leadingWhitespace = /^\s*/.exec(raw)?.[0].length ?? 0;
      const trailingWhitespace = /\s*$/.exec(raw)?.[0].length ?? 0;
      const sourceText = raw.slice(leadingWhitespace, raw.length - trailingWhitespace);
      return {
        sourceColumn: segment.start + leadingWhitespace,
        sourceText,
        value: sourceText.replace(/\\\|/g, "|"),
      };
    }),
    hasLeadingPipe,
    hasTrailingPipe,
    leadingWhitespace: /^[ \t]*/.exec(line)?.[0] ?? "",
    pipeIndices,
  };
}
