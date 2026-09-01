import {
  markdownRichTooltipAnchor,
  markdownRichTooltipBackslashRunIsEscaped,
  markdownRichTooltipLeadingBackslashCount,
  parseMarkdownRichTooltipReference,
} from "../domain/markdownRichTooltips";
import { markdownInlineTokenPattern } from "../domain/markdownInlineAnnotations";

export { markdownInlineTokenPattern } from "../domain/markdownInlineAnnotations";

export interface MarkdownSourceRange {
  end: number;
  start: number;
}

const LEGACY_TOOLTIP_TOKEN = /^\[([^\]\r\n]+)\]\("[^"\r\n]*"\)$/u;

interface MarkdownTooltipProjection {
  formattedText: string;
  legacyCount: number;
  renderedText: string;
  richCount: number;
}

function markdownTooltipProjection(source: string): MarkdownTooltipProjection {
  const token = markdownInlineTokenPattern();
  let cursor = 0;
  let formattedText = "";
  let legacyCount = 0;
  let renderedText = "";
  let richCount = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    const preceding = source.slice(cursor, match.index);
    formattedText += preceding;
    renderedText += markdownRichTooltipAnchor(preceding);
    const raw = match[0];
    const legacy = LEGACY_TOOLTIP_TOKEN.exec(raw);
    const rich = parseMarkdownRichTooltipReference(raw);
    if (legacy) {
      legacyCount += 1;
      formattedText += legacy[1];
      renderedText += markdownRichTooltipAnchor(legacy[1]);
    } else if (rich) {
      richCount += 1;
      formattedText += rich.label;
      renderedText += markdownRichTooltipAnchor(rich.label);
    } else {
      formattedText += raw;
      renderedText += markdownRichTooltipAnchor(raw);
    }
    cursor = match.index + raw.length;
  }
  const trailing = source.slice(cursor);
  formattedText += trailing;
  renderedText += markdownRichTooltipAnchor(trailing);
  return { formattedText, legacyCount, renderedText, richCount };
}

function isLegacyTooltipCandidate(projection: MarkdownTooltipProjection): boolean {
  return projection.legacyCount === 1 && projection.richCount === 0;
}

function isRichTooltipCandidate(projection: MarkdownTooltipProjection): boolean {
  return projection.legacyCount === 0 && projection.richCount === 1;
}

export function isMarkdownLegacyTooltipMigrationCandidate(source: string): boolean {
  return isLegacyTooltipCandidate(markdownTooltipProjection(source));
}

export function isMarkdownRichTooltipMigrationCandidate(source: string): boolean {
  return isRichTooltipCandidate(markdownTooltipProjection(source));
}

export function isMarkdownLegacyTooltipToRichTooltipMigration(before: string, after: string): boolean {
  const beforeProjection = markdownTooltipProjection(before);
  const afterProjection = markdownTooltipProjection(after);
  return isLegacyTooltipCandidate(beforeProjection)
    && isRichTooltipCandidate(afterProjection)
    && beforeProjection.renderedText === afterProjection.renderedText;
}

export function isMarkdownLegacyTooltipToRichTooltipVisuallyEquivalent(
  before: string,
  after: string,
): boolean {
  const beforeProjection = markdownTooltipProjection(before);
  const afterProjection = markdownTooltipProjection(after);
  return isLegacyTooltipCandidate(beforeProjection)
    && isRichTooltipCandidate(afterProjection)
    && beforeProjection.formattedText === afterProjection.formattedText;
}

export function markdownRichTooltipVisibleText(source: string): string {
  return markdownTooltipProjection(source).renderedText;
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
      if (richReference && richTooltipsEnabled) {
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
