export interface MarkdownSourceRange {
  end: number;
  start: number;
}

const INLINE_TOKEN_SOURCE = "(`[^`\\n]+`|\\[[^\\]\\n]+\\]\\([^\\s)]+(?:\\s+\"[^\"]*\")?\\)|\\|\\|[^|\\n]+\\|\\||\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|_[^_\\n]+_)";

export function markdownInlineTokenPattern(): RegExp {
  return new RegExp(INLINE_TOKEN_SOURCE, "g");
}

function collectVisibleRanges(source: string, offset: number, ranges: MarkdownSourceRange[]): void {
  const token = markdownInlineTokenPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    if (match.index > cursor) {
      ranges.push({ start: offset + cursor, end: offset + match.index });
    }
    const raw = match[0];
    const start = offset + match.index;
    if (raw.startsWith("`")) {
      ranges.push({ start: start + 1, end: start + raw.length - 1 });
    } else if (raw.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(raw);
      if (link) collectVisibleRanges(link[1], start + 1, ranges);
      else ranges.push({ start, end: start + raw.length });
    } else if (raw.startsWith("||") || raw.startsWith("**") || raw.startsWith("__")) {
      collectVisibleRanges(raw.slice(2, -2), start + 2, ranges);
    } else {
      collectVisibleRanges(raw.slice(1, -1), start + 1, ranges);
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) ranges.push({ start: offset + cursor, end: offset + source.length });
}

export function markdownVisibleSourceRanges(source: string): MarkdownSourceRange[] {
  const ranges: MarkdownSourceRange[] = [];
  collectVisibleRanges(source, 0, ranges);
  return ranges;
}

export function markdownSourceRangeIsVisible(
  ranges: readonly MarkdownSourceRange[],
  start: number,
  end: number,
): boolean {
  return ranges.some((range) =>
    start === end
      ? start >= range.start && start <= range.end
      : start >= range.start && end <= range.end,
  );
}
