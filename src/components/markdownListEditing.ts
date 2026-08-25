export interface MarkdownListEnterEdit {
  value: string;
  caret: number;
}

interface MarkdownLine {
  content: string;
  eol: string;
  start: number;
}

interface ParsedListLine {
  indent: string;
  indentWidth: number;
  contentIndentWidth: number;
  marker: string;
  separator: string;
  payload: string;
  body: string;
  bodyStart: number;
  taskMarker: string | null;
  taskSeparator: string;
  ordered: boolean;
  number: bigint | null;
  numberText: string | null;
  delimiter: "." | ")" | null;
}

interface Fence {
  character: "`" | "~";
  length: number;
}

function splitMarkdownLines(value: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;

  while (start <= value.length) {
    let end = start;
    while (end < value.length && value[end] !== "\r" && value[end] !== "\n") end += 1;

    let eol = "";
    if (end < value.length) {
      eol = value[end] === "\r" && value[end + 1] === "\n" ? "\r\n" : value[end];
    }
    lines.push({ content: value.slice(start, end), eol, start });
    if (!eol) break;
    start = end + eol.length;
  }

  return lines;
}

function indentationWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    width = character === "\t" ? width + 4 - width % 4 : width + 1;
  }
  return width;
}

function parseListLine(line: string): ParsedListLine | null {
  const match = /^([ \t]*)(?:(\d+)([.)])|([-+*]))(?:(?:([ \t]+)(.*))|$)$/.exec(line);
  if (!match) return null;

  const indent = match[1];
  const numberText = match[2] ?? null;
  const delimiter = (match[3] as "." | ")" | undefined) ?? null;
  const marker = numberText === null ? match[4] : `${numberText}${delimiter}`;
  const separator = match[5] ?? "";
  const payload = match[6] ?? "";
  const task = /^(\[[ xX-]\])(?:(?:([ \t]+)(.*))|$)$/.exec(payload);
  const taskMarker = task?.[1] ?? null;
  const taskSeparator = task?.[2] ?? "";
  const body = task ? task[3] ?? "" : payload;

  return {
    indent,
    indentWidth: indentationWidth(indent),
    contentIndentWidth: indentationWidth(`${indent}${marker}${separator}`),
    marker,
    separator,
    payload,
    body,
    bodyStart: indent.length + marker.length + separator.length
      + (taskMarker?.length ?? 0) + taskSeparator.length,
    taskMarker,
    taskSeparator,
    ordered: numberText !== null,
    number: numberText === null ? null : BigInt(numberText),
    numberText,
    delimiter,
  };
}

function fenceMarker(line: string, effectiveIndent: number): { character: "`" | "~"; length: number } | null {
  const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
  const rawIndentLength = /^[ \t]*/.exec(line)?.[0].length ?? 0;
  if (effectiveIndent > 3 && rawIndentLength > 3) return null;
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) return null;
  return { character: match[1][0] as "`" | "~", length: match[1].length };
}

function isClosingFence(line: string, fence: Fence, effectiveIndent: number): boolean {
  const rawIndentLength = /^[ \t]*/.exec(line)?.[0].length ?? 0;
  if (effectiveIndent > 3 && rawIndentLength > 3) return false;
  const marker = fence.character === "`" ? "`" : "~";
  const match = new RegExp(`^[ \\t]*(${marker}{${fence.length},})[ \\t]*$`).exec(line);
  return match !== null;
}

function effectiveListIndent(line: string, stack: readonly ParsedListLine[]): number {
  const leadingWhitespace = /^[ \t]*/.exec(line)?.[0] ?? "";
  const leadingWidth = indentationWidth(leadingWhitespace);
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (leadingWidth >= stack[index].contentIndentWidth) {
      return leadingWidth - stack[index].contentIndentWidth;
    }
  }
  return leadingWidth;
}

export function isInsideFencedMarkdownCode(value: string, position: number): boolean {
  if (!Number.isInteger(position) || position < 0 || position > value.length) return false;

  const lines = splitMarkdownLines(value);
  let fence: Fence | null = null;
  const listStack: ParsedListLine[] = [];

  for (const line of lines) {
    const nextStart = line.start + line.content.length + line.eol.length;
    const containsPosition = position < nextStart || !line.eol && position === nextStart;

    if (fence) {
      if (isClosingFence(line.content, fence, effectiveListIndent(line.content, listStack))) fence = null;
    } else {
      const parsed = parseListLine(line.content);
      if (parsed) {
        while (listStack.length && listStack[listStack.length - 1].indentWidth >= parsed.indentWidth) listStack.pop();
        listStack.push(parsed);
      } else if (line.content.trim()) {
        const leadingWhitespace = /^[ \t]*/.exec(line.content)?.[0] ?? "";
        const leadingWidth = indentationWidth(leadingWhitespace);
        while (listStack.length && leadingWidth < listStack[listStack.length - 1].contentIndentWidth) listStack.pop();
      }

      const candidate = parsed?.body ?? line.content;
      const marker = fenceMarker(candidate, parsed ? 0 : effectiveListIndent(line.content, listStack));
      if (marker) fence = { character: marker.character, length: marker.length };
    }

    if (containsPosition) return fence !== null;
  }

  return false;
}

function findLineIndex(lines: readonly MarkdownLine[], position: number): number {
  return lines.findIndex((line) => position >= line.start && position <= line.start + line.content.length);
}

function preferredEol(lines: readonly MarkdownLine[], lineIndex: number): string {
  if (lines[lineIndex].eol) return lines[lineIndex].eol;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    if (lines[index].eol) return lines[index].eol;
  }
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    if (lines[index].eol) return lines[index].eol;
  }
  return "\n";
}

function formatOrderedNumber(value: bigint, previousText: string): string {
  const result = value.toString();
  return previousText.length > 1 && previousText.startsWith("0")
    ? result.padStart(previousText.length, "0")
    : result;
}

function replaceOrderedMarker(line: MarkdownLine, parsed: ParsedListLine, number: bigint): void {
  if (!parsed.numberText || !parsed.delimiter) return;
  const marker = `${formatOrderedNumber(number, parsed.numberText)}${parsed.delimiter}`;
  line.content = `${parsed.indent}${marker}${parsed.separator}${parsed.payload}`;
}

function renumberSequentialTail(
  lines: MarkdownLine[],
  startIndex: number,
  indentWidth: number,
  delimiter: "." | ")",
  expectedNumber: bigint,
  delta: bigint,
): void {
  let expected = expectedNumber;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const parsed = parseListLine(line.content);

    if (!parsed) {
      if (!line.content.trim()) continue;
      const leadingWhitespace = /^[ \t]*/.exec(line.content)?.[0] ?? "";
      if (indentationWidth(leadingWhitespace) > indentWidth) continue;
      return;
    }
    if (parsed.indentWidth < indentWidth) return;
    if (parsed.indentWidth > indentWidth) continue;
    if (!parsed.ordered || parsed.delimiter !== delimiter || parsed.number !== expected) return;

    replaceOrderedMarker(line, parsed, expected + delta);
    expected += 1n;
  }
}

function findParentListLine(lines: readonly MarkdownLine[], lineIndex: number, indentWidth: number): ParsedListLine | null {
  const stack: ParsedListLine[] = [];

  for (let index = 0; index < lineIndex; index += 1) {
    const line = lines[index];
    const parsed = parseListLine(line.content);
    if (parsed) {
      while (stack.length && stack[stack.length - 1].indentWidth >= parsed.indentWidth) stack.pop();
      stack.push(parsed);
      continue;
    }

    if (!line.content.trim()) continue;
    const leadingWhitespace = /^[ \t]*/.exec(line.content)?.[0] ?? "";
    while (stack.length && indentationWidth(leadingWhitespace) <= stack[stack.length - 1].indentWidth) stack.pop();
  }

  while (
    stack.length
    && (
      stack[stack.length - 1].indentWidth >= indentWidth
      || indentWidth < stack[stack.length - 1].contentIndentWidth
    )
  ) stack.pop();
  return stack.at(-1) ?? null;
}

function emptyItemPrefix(parsed: ParsedListLine, marker = parsed.marker): string {
  const separator = parsed.separator || " ";
  const task = parsed.taskMarker === null ? "" : `[ ]${parsed.taskSeparator || " "}`;
  return `${parsed.indent}${marker}${separator}${task}`;
}

function serializeLines(lines: readonly MarkdownLine[]): string {
  return lines.map((line) => `${line.content}${line.eol}`).join("");
}

export function resolveMarkdownListEnter(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownListEnterEdit | null {
  if (
    !Number.isInteger(selectionStart)
    || !Number.isInteger(selectionEnd)
    || selectionStart !== selectionEnd
    || selectionStart < 0
    || selectionStart > value.length
  ) return null;
  if (isInsideFencedMarkdownCode(value, selectionStart)) return null;

  const lines = splitMarkdownLines(value);
  const lineIndex = findLineIndex(lines, selectionStart);
  if (lineIndex < 0) return null;
  const line = lines[lineIndex];
  const parsed = parseListLine(line.content);
  if (!parsed) return null;

  const offset = selectionStart - line.start;
  if (offset < parsed.bodyStart) return null;

  if (!parsed.body.trim()) {
    const parent = findParentListLine(lines, lineIndex, parsed.indentWidth);

    if (!parent) {
      line.content = "";
      if (parsed.ordered && parsed.number !== null && parsed.delimiter) {
        renumberSequentialTail(
          lines,
          lineIndex + 1,
          parsed.indentWidth,
          parsed.delimiter,
          parsed.number + 1n,
          -1n,
        );
      }
      return { value: serializeLines(lines), caret: line.start };
    }

    if (parsed.ordered && parsed.number !== null && parsed.delimiter) {
      renumberSequentialTail(
        lines,
        lineIndex + 1,
        parsed.indentWidth,
        parsed.delimiter,
        parsed.number + 1n,
        -1n,
      );
    }

    let marker = parent.marker;
    if (parent.ordered && parent.delimiter && parent.number !== null && parent.numberText !== null) {
      const nextNumber = parent.number + 1n;
      marker = `${formatOrderedNumber(nextNumber, parent.numberText)}${parent.delimiter}`;
      renumberSequentialTail(
        lines,
        lineIndex + 1,
        parent.indentWidth,
        parent.delimiter,
        nextNumber,
        1n,
      );
    }

    line.content = emptyItemPrefix(parent, marker);
    return { value: serializeLines(lines), caret: line.start + line.content.length };
  }

  let nextMarker = parsed.marker;
  if (parsed.number !== null && parsed.numberText && parsed.delimiter) {
    const nextNumber = parsed.number + 1n;
    nextMarker = `${formatOrderedNumber(nextNumber, parsed.numberText)}${parsed.delimiter}`;
    renumberSequentialTail(
      lines,
      lineIndex + 1,
      parsed.indentWidth,
      parsed.delimiter,
      nextNumber,
      1n,
    );
  }

  const markerSeparator = parsed.separator || " ";
  const taskPrefix = parsed.taskMarker === null
    ? ""
    : `[ ]${parsed.taskSeparator || " "}`;
  const nextPrefix = `${parsed.indent}${nextMarker}${markerSeparator}${taskPrefix}`;
  const left = line.content.slice(0, offset);
  const right = line.content.slice(offset);
  const oldEol = line.eol;
  const insertedEol = preferredEol(lines, lineIndex);
  line.content = left;
  line.eol = insertedEol;
  lines.splice(lineIndex + 1, 0, { content: `${nextPrefix}${right}`, eol: oldEol, start: 0 });

  return {
    value: serializeLines(lines),
    caret: line.start + left.length + insertedEol.length + nextPrefix.length,
  };
}
