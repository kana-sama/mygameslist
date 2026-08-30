export interface MarkdownRichTooltipDefinition {
  anchor: string;
  bodyMarkdown: string;
  sourceEnd: number;
  sourceStart: number;
}

export interface MarkdownRichTooltipReference {
  anchor: string;
  sourceEnd: number;
  sourceStart: number;
}

export interface ParsedMarkdownRichTooltips {
  definitions: ReadonlyMap<string, MarkdownRichTooltipDefinition>;
  definitionSectionStart: number | null;
  duplicateAnchors: ReadonlySet<string>;
  errors: readonly string[];
  references: readonly MarkdownRichTooltipReference[];
  source: string;
  visibleMarkdown: string;
}

export type MarkdownRichTooltipBodyPart =
  | { markdown: string; type: "markdown" }
  | { items: readonly { descriptionMarkdown: string; termMarkdown: string }[]; type: "definition-list" };

interface SourceLine {
  content: string;
  eol: string;
  end: number;
  start: number;
}

interface DefinitionCandidate {
  anchor: string;
  lineIndex: number;
}

interface Diagnostic {
  message: string;
  offset: number;
  sequence: number;
}

export const MARKDOWN_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE = String.raw`\[[^\]\r\n]*\]\[\?\]`;
export const MARKDOWN_ESCAPED_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE = String.raw`\\+\[[^\]\r\n]*\]\[\?\]`;
export const MARKDOWN_INLINE_PLAIN_TEXT_TOKEN_SOURCE = "`[^`\\n]+`|\\\\[|]|\\|\\|[^|\\n]+\\|\\||\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|_[^_\\n]+_";

const DEFINITION_OPENER = /^\[\?([^\]\r\n]*)\]:[ \t]*$/;
const RICH_TOOLTIP_REFERENCE = /^\[([^\]\r\n]*)\]\[\?\]/;
const LEGACY_HOVER_HINT = /^\[[^\]\r\n]+\]\("[^"\r\n]*"\)/;
const ORDINARY_LINK = /^\[[^\]\r\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const DEFINITION_BODY_FENCE_OPEN = /^ {0,4}(`{3,}|~{3,})/;
const DEFINITION_BODY_FENCE_CLOSE = /^ {0,4}(`{3,}|~{3,})[ \t]*$/;

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
    let eol = "";
    if (source.startsWith("\r\n", end)) eol = "\r\n";
    else if (end < source.length) eol = source[end];
    lines.push({ content: source.slice(start, end), eol, start, end });
    start = end + eol.length;
  }
  return lines;
}

function fencedCodeLines(lines: readonly SourceLine[], allowsDefinitionIndent = false): ReadonlySet<number> {
  const fenced = new Set<number>();
  const opener = allowsDefinitionIndent ? DEFINITION_BODY_FENCE_OPEN : FENCE_OPEN;
  const closer = allowsDefinitionIndent ? DEFINITION_BODY_FENCE_CLOSE : FENCE_CLOSE;
  let marker: string | null = null;
  let markerLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const openingMatch = opener.exec(line.content);
    if (marker === null) {
      if (!openingMatch) continue;
      marker = openingMatch[1][0];
      markerLength = openingMatch[1].length;
      fenced.add(index);
      continue;
    }
    fenced.add(index);
    const closingMatch = closer.exec(line.content);
    if (closingMatch && closingMatch[1][0] === marker && closingMatch[1].length >= markerLength) {
      marker = null;
      markerLength = 0;
    }
  }
  return fenced;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return markdownRichTooltipBackslashRunIsEscaped(slashCount);
}

export function markdownRichTooltipBackslashRunIsEscaped(length: number): boolean {
  return length % 2 === 1;
}

export function markdownRichTooltipLeadingBackslashCount(source: string): number {
  let count = 0;
  while (source[count] === "\\") count += 1;
  return count;
}

export function markdownRichTooltipAnchor(labelMarkdown: string): string {
  const plainText = (markdown: string): string => {
    let result = "";
    const token = new RegExp(MARKDOWN_INLINE_PLAIN_TEXT_TOKEN_SOURCE, "g");
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = token.exec(markdown))) {
      result += markdown.slice(cursor, match.index);
      const raw = match[0];
      if (raw === "\\|") result += "|";
      else if (raw.startsWith("`")) result += raw.slice(1, -1);
      else {
        const markerLength = raw.startsWith("||") || raw.startsWith("**") || raw.startsWith("__") ? 2 : 1;
        result += plainText(raw.slice(markerLength, -markerLength));
      }
      cursor = match.index + raw.length;
    }
    result += markdown.slice(cursor);
    return result;
  };
  return plainText(labelMarkdown).trim();
}

export function parseMarkdownRichTooltipReference(source: string): { anchor: string; label: string } | null {
  const match = RICH_TOOLTIP_REFERENCE.exec(source);
  return match && match[0].length === source.length ? { label: match[1], anchor: markdownRichTooltipAnchor(match[1]) } : null;
}

function collectRichTooltipReferences(source: string, offset = 0, allowsDefinitionIndent = false): MarkdownRichTooltipReference[] {
  const lines = splitLines(source);
  const fenced = fencedCodeLines(lines, allowsDefinitionIndent);
  const references: MarkdownRichTooltipReference[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (fenced.has(lineIndex)) continue;
    const line = lines[lineIndex];
    let cursor = 0;
    while (cursor < line.content.length) {
      if (line.content[cursor] === "`") {
        const code = /^`[^`\r\n]+`/.exec(line.content.slice(cursor));
        cursor += code?.[0].length ?? 1;
        continue;
      }
      if (line.content[cursor] !== "[" || isEscaped(line.content, cursor)) {
        if (line.content[cursor] === "[" && isEscaped(line.content, cursor)) {
          cursor += RICH_TOOLTIP_REFERENCE.exec(line.content.slice(cursor))?.[0].length ?? 1;
          continue;
        }
        cursor += 1;
        continue;
      }
      const remaining = line.content.slice(cursor);
      const metadata = LEGACY_HOVER_HINT.exec(remaining) ?? ORDINARY_LINK.exec(remaining);
      if (metadata) {
        cursor += metadata[0].length;
        continue;
      }
      const match = RICH_TOOLTIP_REFERENCE.exec(remaining);
      if (!match) {
        cursor += 1;
        continue;
      }
      references.push({
        anchor: markdownRichTooltipAnchor(match[1]),
        sourceStart: offset + line.start + cursor,
        sourceEnd: offset + line.start + cursor + match[0].length,
      });
      cursor += match[0].length;
    }
  }
  return references;
}

function definitionBody(lines: readonly SourceLine[], startIndex: number, endIndex: number): string {
  const bodyLines = lines.slice(startIndex + 1, endIndex);
  let lastNonblank = -1;
  for (let index = 0; index < bodyLines.length; index += 1) {
    if (bodyLines[index].content.trim().length > 0) lastNonblank = index;
  }
  if (lastNonblank === -1) return "";
  return bodyLines.slice(0, lastNonblank + 1).map((line, index) => {
    const content = line.content.trim().length === 0 ? line.content : line.content.slice(4);
    return `${content}${index === lastNonblank ? "" : line.eol}`;
  }).join("");
}

function terminalDefinitionCandidates(source: string): {
  candidates: DefinitionCandidate[];
  definitionSectionStart: number | null;
  lines: SourceLine[];
  terminal: boolean;
} {
  const lines = splitLines(source);
  const fenced = fencedCodeLines(lines);
  const candidates = lines.flatMap((line, index) => {
    const match = !fenced.has(index) ? DEFINITION_OPENER.exec(line.content) : null;
    return match ? [{ anchor: match[1].trim(), lineIndex: index }] : [];
  });
  if (!candidates.length) return { candidates, definitionSectionStart: null, lines, terminal: true };

  const first = candidates[0];
  const terminal = lines.slice(first.lineIndex + 1).every((line, relativeIndex) => {
    const lineIndex = first.lineIndex + relativeIndex + 1;
    return line.content.trim().length === 0 || !fenced.has(lineIndex) && DEFINITION_OPENER.test(line.content) || /^ {4}/.test(line.content);
  });
  return {
    candidates,
    definitionSectionStart: terminal ? lines[first.lineIndex].start : null,
    lines,
    terminal,
  };
}

export function parseMarkdownRichTooltips(source: string): ParsedMarkdownRichTooltips {
  const { candidates, definitionSectionStart, lines, terminal } = terminalDefinitionCandidates(source);
  const diagnostics: Diagnostic[] = [];
  let sequence = 0;
  const addDiagnostic = (offset: number, message: string) => diagnostics.push({ offset, message, sequence: sequence++ });

  if (!terminal && candidates.length) {
    addDiagnostic(lines[candidates[0].lineIndex].start, "Rich tooltip definitions должны находиться в конце Markdown");
    const references = collectRichTooltipReferences(source);
    for (const reference of references) {
      if (!reference.anchor) addDiagnostic(reference.sourceStart, "Некорректный rich tooltip anchor: ");
    }
    return {
      definitions: new Map(),
      definitionSectionStart: null,
      duplicateAnchors: new Set(),
      errors: diagnostics.sort((left, right) => left.offset - right.offset || left.sequence - right.sequence).map(({ message }) => message),
      references,
      source,
      visibleMarkdown: source,
    };
  }

  const definitions = new Map<string, MarkdownRichTooltipDefinition>();
  const duplicateAnchors = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const next = candidates[index + 1]?.lineIndex ?? lines.length;
    const line = lines[candidate.lineIndex];
    const bodyMarkdown = definitionBody(lines, candidate.lineIndex, next);
    const definition: MarkdownRichTooltipDefinition = {
      anchor: candidate.anchor,
      sourceStart: line.start,
      sourceEnd: next < lines.length ? lines[next].start : source.length,
      bodyMarkdown,
    };
    if (!candidate.anchor) addDiagnostic(line.start, "Некорректный rich tooltip anchor: ");
    if (definitions.has(candidate.anchor)) {
      duplicateAnchors.add(candidate.anchor);
      addDiagnostic(line.start, `Rich tooltip [?${candidate.anchor}]: определение задано несколько раз`);
    } else {
      definitions.set(candidate.anchor, definition);
    }
    if (!bodyMarkdown) addDiagnostic(line.start, `Rich tooltip [?${candidate.anchor}]: пустое определение`);

    const nestedSourceStart = lines[candidate.lineIndex + 1]?.start ?? source.length;
    for (const reference of collectRichTooltipReferences(source.slice(nestedSourceStart, definition.sourceEnd), nestedSourceStart, true)) {
      addDiagnostic(reference.sourceStart, `Rich tooltip [?${reference.anchor}]: вложенные rich tooltip references запрещены`);
    }
  }

  const visibleMarkdown = definitionSectionStart === null ? source : source.slice(0, definitionSectionStart);
  const references = collectRichTooltipReferences(visibleMarkdown);
  for (const reference of references) {
    if (!reference.anchor) {
      addDiagnostic(reference.sourceStart, "Некорректный rich tooltip anchor: ");
    } else if (!definitions.has(reference.anchor)) {
      addDiagnostic(reference.sourceStart, `Rich tooltip [?${reference.anchor}]: определение не найдено`);
    }
  }

  return {
    definitions,
    definitionSectionStart,
    duplicateAnchors,
    errors: diagnostics.sort((left, right) => left.offset - right.offset || left.sequence - right.sequence).map(({ message }) => message),
    references,
    source,
    visibleMarkdown,
  };
}

export function restoreMarkdownRichTooltipDefinitions(parsed: ParsedMarkdownRichTooltips, visibleMarkdown: string): string {
  return parsed.definitionSectionStart === null ? visibleMarkdown : `${visibleMarkdown}${parsed.source.slice(parsed.definitionSectionStart)}`;
}

function definitionListPair(lines: readonly SourceLine[], index: number): { descriptionMarkdown: string; termMarkdown: string } | null {
  const term = lines[index];
  const description = lines[index + 1];
  if (!term || !description || term.content.trim().length === 0 || !description.content.startsWith(": ") || description.content.length === 2) return null;
  return { termMarkdown: term.content, descriptionMarkdown: description.content.slice(2) };
}

export function parseMarkdownRichTooltipBody(markdown: string): MarkdownRichTooltipBodyPart[] {
  const lines = splitLines(markdown);
  const fenced = fencedCodeLines(lines);
  const pairAt = (index: number) => fenced.has(index) || fenced.has(index + 1) ? null : definitionListPair(lines, index);
  const parts: MarkdownRichTooltipBodyPart[] = [];
  let sourceCursor = 0;
  let lineCursor = 0;
  while (lineCursor < lines.length) {
    const first = pairAt(lineCursor);
    if (!first) {
      lineCursor += 1;
      continue;
    }
    if (sourceCursor < lines[lineCursor].start) parts.push({ type: "markdown", markdown: markdown.slice(sourceCursor, lines[lineCursor].start) });
    const items = [first];
    let lastDescriptionIndex = lineCursor + 1;
    let nextLineIndex = lineCursor + 2;
    while (nextLineIndex < lines.length) {
      let candidateIndex = nextLineIndex;
      while (candidateIndex < lines.length && lines[candidateIndex].content.trim().length === 0) candidateIndex += 1;
      const next = pairAt(candidateIndex);
      if (!next) break;
      items.push(next);
      lastDescriptionIndex = candidateIndex + 1;
      nextLineIndex = candidateIndex + 2;
    }
    parts.push({ type: "definition-list", items });
    sourceCursor = lines[lastDescriptionIndex].end;
    lineCursor = lastDescriptionIndex + 1;
  }
  if (sourceCursor < markdown.length || !parts.length) parts.push({ type: "markdown", markdown: markdown.slice(sourceCursor) });
  return parts;
}
