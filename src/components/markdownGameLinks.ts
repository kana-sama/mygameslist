import type { Game } from "../domain/types";
import { isInsideFencedMarkdownCode } from "./markdownListEditing";

export interface ActiveGameLinkQuery {
  start: number;
  end: number;
  query: string;
}

export interface ActiveBracketGameLinkQuery {
  openBracketOffset: number;
  queryStartOffset: number;
  queryEndOffset: number;
  replaceEndOffset: number;
  query: string;
}

export interface InsertedGameMarkdownLink {
  markdown: string;
  caret: number;
}

type GameMarkdownLinkTarget = Pick<Game, "id" | "title">;

export function formatGameMarkdownLink(game: GameMarkdownLinkTarget): string {
  return `[${game.title}](#/games/${encodeURIComponent(game.id)})`;
}

export function formatGameMarkdownCompletionInsertText(game: GameMarkdownLinkTarget): string {
  return formatGameMarkdownLink(game).slice(1);
}

function lineStartAt(markdown: string, position: number): number {
  if (position <= 0) return 0;
  return Math.max(
    markdown.lastIndexOf("\n", position - 1),
    markdown.lastIndexOf("\r", position - 1),
  ) + 1;
}

function isEscaped(markdown: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && markdown[index] === "\\"; index -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

interface MarkdownLineStructure {
  destinationDepth: number;
  inlineCodeDelimiterLength: number;
  openBrackets: number[];
}

function scanMarkdownLineStructure(
  markdown: string,
  lineStart: number,
  end: number,
): MarkdownLineStructure {
  let destinationDepth = 0;
  let inlineCodeDelimiterLength = 0;
  const openBrackets: number[] = [];
  let index = lineStart;

  while (index < end) {
    const character = markdown[index];

    if (destinationDepth > 0) {
      if (character === "(" && !isEscaped(markdown, index)) destinationDepth += 1;
      else if (character === ")" && !isEscaped(markdown, index)) destinationDepth -= 1;
      index += 1;
      continue;
    }

    if (character === "`" && !isEscaped(markdown, index)) {
      let runEnd = index + 1;
      while (runEnd < end && markdown[runEnd] === "`") runEnd += 1;
      const runLength = runEnd - index;
      if (!inlineCodeDelimiterLength) inlineCodeDelimiterLength = runLength;
      else if (runLength === inlineCodeDelimiterLength) inlineCodeDelimiterLength = 0;
      index = runEnd;
      continue;
    }

    if (inlineCodeDelimiterLength) {
      index += 1;
      continue;
    }

    if (character === "[" && !isEscaped(markdown, index)) {
      openBrackets.push(index);
    } else if (character === "]" && !isEscaped(markdown, index)) {
      openBrackets.pop();
      if (
        index + 1 < end
        && markdown[index + 1] === "("
        && !isEscaped(markdown, index + 1)
      ) {
        destinationDepth = 1;
        index += 1;
      }
    }
    index += 1;
  }

  return { destinationDepth, inlineCodeDelimiterLength, openBrackets };
}

export function findActiveGameLinkQuery(markdown: string, caret: number): ActiveGameLinkQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > markdown.length) return null;
  const lineStart = lineStartAt(markdown, caret);
  if (caret <= lineStart) return null;
  let trigger = markdown.lastIndexOf("#", Math.max(lineStart, caret - 1));
  while (trigger >= lineStart && trigger > 0 && !/\s/u.test(markdown[trigger - 1])) {
    trigger = markdown.lastIndexOf("#", trigger - 1);
  }
  if (trigger < lineStart) return null;

  const query = markdown.slice(trigger + 1, caret);
  if (query.length > 0 && /^\s/u.test(query)) return null;
  if (/[#\r\n]/u.test(query)) return null;
  if (isEscaped(markdown, trigger)) return null;
  if (isInsideFencedMarkdownCode(markdown, trigger)) return null;
  const structure = scanMarkdownLineStructure(markdown, lineStart, trigger);
  if (structure.inlineCodeDelimiterLength || structure.destinationDepth) return null;
  return { start: trigger, end: caret, query };
}

export function findActiveBracketGameLinkQuery(
  markdown: string,
  caret: number,
): ActiveBracketGameLinkQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > markdown.length) return null;
  const lineStart = lineStartAt(markdown, caret);
  const structure = scanMarkdownLineStructure(markdown, lineStart, caret);

  if (structure.destinationDepth || structure.inlineCodeDelimiterLength) return null;
  if (structure.openBrackets.length !== 1) return null;
  const openBracketOffset = structure.openBrackets[0];
  if (markdown[openBracketOffset - 1] === "!" && !isEscaped(markdown, openBracketOffset - 1)) return null;
  if (isInsideFencedMarkdownCode(markdown, openBracketOffset)) return null;

  const beforeBracket = markdown.slice(lineStart, openBracketOffset);
  if (/^[ \t]*(?:(?:\d+[.)])|[-+*])[ \t]+$/u.test(beforeBracket)) return null;
  const query = markdown.slice(openBracketOffset + 1, caret);
  if (/[\r\n]/u.test(query)) return null;

  return {
    openBracketOffset,
    queryStartOffset: openBracketOffset + 1,
    queryEndOffset: caret,
    replaceEndOffset: markdown[caret] === "]" ? caret + 1 : caret,
    query,
  };
}

export function insertGameMarkdownLink(
  markdown: string,
  range: Pick<ActiveGameLinkQuery, "start" | "end">,
  game: Pick<Game, "id" | "title">,
): InsertedGameMarkdownLink {
  const link = formatGameMarkdownLink(game);
  const nextMarkdown = `${markdown.slice(0, range.start)}${link}${markdown.slice(range.end)}`;
  return { markdown: nextMarkdown, caret: range.start + link.length };
}
