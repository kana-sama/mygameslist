import {
  MARKDOWN_ESCAPED_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE,
  MARKDOWN_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE,
  markdownRichTooltipBackslashRunIsEscaped,
  markdownRichTooltipIdIsCanonical,
  markdownRichTooltipLeadingBackslashCount,
  parseMarkdownRichTooltipReference,
} from "../domain/markdownRichTooltips";

export interface MarkdownSourceRange {
  end: number;
  start: number;
}

const INLINE_TOKEN_SOURCE_PREFIX = "(`[^`\\n]+`";
const INLINE_RICH_TOOLTIP_TOKEN_SOURCE = `|${MARKDOWN_ESCAPED_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE}|${MARKDOWN_RICH_TOOLTIP_REFERENCE_TOKEN_SOURCE}`;
const INLINE_TOKEN_SOURCE_SUFFIX = "|\\[[^\\]\\n]+\\]\\(\"[^\"\\n]*\"\\)|\\[[^\\]\\n]+\\]\\([^\\s)]+(?:\\s+\"[^\"]*\")?\\)|\\\\[|]|\\|\\|[^|\\n]+\\|\\||\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|_[^_\\n]+_)";

export function markdownInlineTokenPattern(): RegExp {
  return new RegExp(`${INLINE_TOKEN_SOURCE_PREFIX}${INLINE_RICH_TOOLTIP_TOKEN_SOURCE}${INLINE_TOKEN_SOURCE_SUFFIX}`, "g");
}

export function markdownIsSingleSpoiler(source: string): boolean {
  return /^\|\|[^|\n]+\|\|$/.test(source.trim());
}

function collectVisibleRanges(source: string, offset: number, ranges: MarkdownSourceRange[], richTooltipsEnabled: boolean): void {
  const token = markdownInlineTokenPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    if (match.index > cursor) {
      ranges.push({ start: offset + cursor, end: offset + match.index });
    }
    const raw = match[0];
    const start = offset + match.index;
    if (raw === "\\|") {
      ranges.push({ start: start + 1, end: start + 2 });
    } else if (raw.startsWith("\\")) {
      const slashCount = markdownRichTooltipLeadingBackslashCount(raw);
      const visibleSlashCount = Math.floor(slashCount / 2);
      if (visibleSlashCount > 0) ranges.push({ start, end: start + visibleSlashCount });
      if (markdownRichTooltipBackslashRunIsEscaped(slashCount)) {
        ranges.push({ start: start + slashCount, end: start + raw.length });
      } else {
        collectVisibleRanges(raw.slice(slashCount), start + slashCount, ranges, richTooltipsEnabled);
      }
    } else if (raw.startsWith("`")) {
      ranges.push({ start: start + 1, end: start + raw.length - 1 });
    } else if (raw.startsWith("[")) {
      const richReference = parseMarkdownRichTooltipReference(raw);
      const hint = /^\[([^\]]+)\]\("([^"\n]*)"\)$/.exec(raw);
      const link = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(raw);
      if (richReference && richTooltipsEnabled && markdownRichTooltipIdIsCanonical(richReference.id)) {
        collectVisibleRanges(richReference.label, start + 1, ranges, richTooltipsEnabled);
      }
      else if (richReference) ranges.push({ start, end: start + raw.length });
      else if (hint) collectVisibleRanges(hint[1], start + 1, ranges, richTooltipsEnabled);
      else if (link) collectVisibleRanges(link[1], start + 1, ranges, richTooltipsEnabled);
      else ranges.push({ start, end: start + raw.length });
    } else if (raw.startsWith("||") || raw.startsWith("**") || raw.startsWith("__")) {
      collectVisibleRanges(raw.slice(2, -2), start + 2, ranges, richTooltipsEnabled);
    } else {
      collectVisibleRanges(raw.slice(1, -1), start + 1, ranges, richTooltipsEnabled);
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) ranges.push({ start: offset + cursor, end: offset + source.length });
}

export function markdownVisibleSourceRanges(source: string, richTooltipsEnabled = false): MarkdownSourceRange[] {
  const ranges: MarkdownSourceRange[] = [];
  collectVisibleRanges(source, 0, ranges, richTooltipsEnabled);
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
