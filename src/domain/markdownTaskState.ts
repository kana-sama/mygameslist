import type { MarkdownTaskState } from "./markdownChecklist";

export type MarkdownTaskTransition = "partial" | "regular";

export function nextMarkdownTaskState(
  state: MarkdownTaskState,
  transition: MarkdownTaskTransition,
): MarkdownTaskState {
  if (transition === "partial") return state === "indeterminate" ? "unchecked" : "indeterminate";
  return state === "unchecked" ? "checked" : state === "checked" ? "unchecked" : "checked";
}

export function setMarkdownListTaskState(markdown: string, sourceLine: number, state: MarkdownTaskState): string {
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined) return markdown;

  const nextLine = line.replace(
    /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)[ xX-](\])(?=[ \t]|$)/,
    (_match, prefix: string, suffix: string) => `${prefix}${state === "checked" ? "x" : state === "indeterminate" ? "-" : " "}${suffix}`,
  );
  if (nextLine === line) return markdown;
  parts[lineIndex] = nextLine;
  return parts.join("");
}

export const setMarkdownTaskState = setMarkdownListTaskState;

export function setMarkdownTableTaskState(markdown: string, sourceLine: number, sourceColumn: number, state: MarkdownTaskState): string {
  if (!Number.isInteger(sourceLine) || !Number.isInteger(sourceColumn) || sourceLine < 0 || sourceColumn < 0) return markdown;
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined || !/^\[[ xX-]\]$/.test(line.slice(sourceColumn, sourceColumn + 3))) return markdown;

  parts[lineIndex] = `${line.slice(0, sourceColumn + 1)}${state === "checked" ? "x" : state === "indeterminate" ? "-" : " "}${line.slice(sourceColumn + 2)}`;
  return parts.join("");
}
