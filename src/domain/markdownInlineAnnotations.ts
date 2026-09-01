import {
  MARKDOWN_ESCAPED_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE,
  MARKDOWN_INLINE_PLAIN_TEXT_TOKEN_SOURCE,
  MARKDOWN_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE,
  markdownRichTooltipBackslashRunIsEscaped,
  markdownRichTooltipLeadingBackslashCount,
  parseMarkdownRichTooltipReference,
} from "./markdownRichTooltips";

export type MarkdownInlineAnnotation =
  | {
    kind: "simple";
    labelMarkdown: string;
    labelText: string;
    description: string;
    sourceEnd: number;
    sourceStart: number;
  }
  | {
    kind: "rich";
    anchor: string;
    labelMarkdown: string;
    labelText: string;
    sourceEnd: number;
    sourceStart: number;
  };

type MarkdownInlineAnnotationToken = MarkdownInlineAnnotation extends infer Annotation
  ? Annotation extends MarkdownInlineAnnotation
    ? Omit<Annotation, "sourceEnd" | "sourceStart">
    : never
  : never;

const INLINE_TOKEN_SOURCE_PREFIX = "(`[^`\\n]+`";
const INLINE_RICH_TOOLTIP_TOKEN_SOURCE = `|${MARKDOWN_ESCAPED_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE}|${MARKDOWN_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE}`;
const INLINE_LEGACY_RICH_TOOLTIP_TOKEN_SOURCE = "|\\[[^\\]\\n]*\\]\\[\\?[^\\]\\n]+\\]";
const INLINE_TOKEN_SOURCE_SUFFIX = `${INLINE_LEGACY_RICH_TOOLTIP_TOKEN_SOURCE}|\\[[^\\]\\n]+\\]\\(\"[^\"\\n]*\"\\)|\\[[^\\]\\n]+\\]\\([^\\s)]+(?:\\s+\"[^\"]*\")?\\)|${MARKDOWN_INLINE_PLAIN_TEXT_TOKEN_SOURCE})`;
const SIMPLE_ANNOTATION = /^\[([^\]\r\n]+)\]\("([^"\r\n]*)"\)$/u;
const ORDINARY_LINK = /^\[([^\]\r\n]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/u;

export function markdownInlineTokenPattern(): RegExp {
  return new RegExp(`${INLINE_TOKEN_SOURCE_PREFIX}${INLINE_RICH_TOOLTIP_TOKEN_SOURCE}${INLINE_TOKEN_SOURCE_SUFFIX}`, "g");
}

export function markdownInlineAnnotationEscapeBackslashCount(source: string, tokenStart: number): number {
  let slashCount = 0;
  for (let cursor = tokenStart - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount;
}

export function markdownInlineAnnotationTokenIsEscaped(source: string, tokenStart: number): boolean {
  return markdownRichTooltipBackslashRunIsEscaped(markdownInlineAnnotationEscapeBackslashCount(source, tokenStart));
}

export function parseMarkdownInlineAnnotationToken(
  source: string,
): MarkdownInlineAnnotationToken | null {
  const simple = SIMPLE_ANNOTATION.exec(source);
  if (simple) {
    return {
      kind: "simple",
      labelMarkdown: simple[1],
      labelText: markdownInlinePlainText(simple[1]).trim(),
      description: simple[2],
    };
  }

  const rich = parseMarkdownRichTooltipReference(source);
  if (!rich) return null;
  return {
    kind: "rich",
    anchor: rich.anchor,
    labelMarkdown: rich.label,
    labelText: markdownInlinePlainText(rich.label).trim(),
  };
}

function collectAnnotations(source: string, offset: number, annotations: MarkdownInlineAnnotation[]): void {
  const token = markdownInlineTokenPattern();
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    const raw = match[0];
    if (raw.startsWith("\\")) {
      const slashCount = markdownRichTooltipLeadingBackslashCount(raw);
      if (!markdownRichTooltipBackslashRunIsEscaped(slashCount)) {
        collectAnnotations(raw.slice(slashCount), offset + match.index + slashCount, annotations);
      }
      continue;
    }
    if (raw.startsWith("[")) {
      if (markdownInlineAnnotationTokenIsEscaped(source, match.index)) continue;
    }
    if (raw.startsWith("`")) continue;
    if (raw.startsWith("||") || raw.startsWith("**") || raw.startsWith("__")) {
      collectAnnotations(raw.slice(2, -2), offset + match.index + 2, annotations);
      continue;
    }
    if (raw.startsWith("*") || raw.startsWith("_")) {
      collectAnnotations(raw.slice(1, -1), offset + match.index + 1, annotations);
      continue;
    }
    const annotation = parseMarkdownInlineAnnotationToken(raw);
    if (!annotation) continue;
    annotations.push({
      ...annotation,
      sourceStart: offset + match.index,
      sourceEnd: offset + match.index + raw.length,
    } as MarkdownInlineAnnotation);
  }
}

export function collectMarkdownInlineAnnotations(source: string): readonly MarkdownInlineAnnotation[] {
  const annotations: MarkdownInlineAnnotation[] = [];
  collectAnnotations(source, 0, annotations);
  return annotations;
}

export function markdownInlinePlainText(source: string): string {
  const token = markdownInlineTokenPattern();
  let cursor = 0;
  let result = "";
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    const raw = match[0];
    const annotation = raw.startsWith("[") ? parseMarkdownInlineAnnotationToken(raw) : null;
    const simpleEscapeSlashCount = annotation?.kind === "simple"
      ? markdownInlineAnnotationEscapeBackslashCount(source, match.index)
      : 0;
    result += source.slice(cursor, match.index - simpleEscapeSlashCount);
    result += "\\".repeat(Math.floor(simpleEscapeSlashCount / 2));
    if (raw === "\\|") {
      result += "|";
    } else if (raw.startsWith("\\")) {
      const slashCount = markdownRichTooltipLeadingBackslashCount(raw);
      result += "\\".repeat(Math.floor(slashCount / 2));
      const reference = raw.slice(slashCount);
      result += markdownRichTooltipBackslashRunIsEscaped(slashCount)
        ? reference
        : markdownInlinePlainText(reference);
    } else if (raw.startsWith("`")) {
      result += raw.slice(1, -1);
    } else if (raw.startsWith("[")) {
      const link = ORDINARY_LINK.exec(raw);
      if (annotation?.kind === "simple" && markdownInlineAnnotationTokenIsEscaped(source, match.index)) result += raw;
      else if (annotation) result += annotation.labelText;
      else if (link) result += markdownInlinePlainText(link[1]);
      else result += raw;
    } else {
      const markerLength = raw.startsWith("||") || raw.startsWith("**") || raw.startsWith("__") ? 2 : 1;
      result += markdownInlinePlainText(raw.slice(markerLength, -markerLength));
    }
    cursor = match.index + raw.length;
  }
  result += source.slice(cursor);
  return result;
}
