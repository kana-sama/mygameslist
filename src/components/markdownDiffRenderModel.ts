import { diffArrays } from "diff";
import type {
  MarkdownChangeKind,
  MarkdownDecoration,
  MarkdownDiffFragment,
  MarkdownDiffHunk,
  MarkdownDiffSide,
  SourceDiffLine,
} from "../domain/markdownDiff";
import {
  markdownSourceRangeIsVisible,
  markdownVisibleSourceRanges,
} from "./markdownInlineSyntax";
import { scanMarkdownTableLine } from "./markdownTableSyntax";
import type { MarkdownTaskState } from "../domain/markdownChecklist";

export type RenderedSideLabel = "Добавлено" | "Удалено";

export interface RenderedInlineChange {
  id: string;
  sourceLine: number;
  startColumn: number;
  endColumn: number;
  removed: string;
  added: string;
}

export interface RenderedTaskChange {
  id: string;
  sourceLine: number;
  sourceColumn?: number;
  beforeState: MarkdownTaskState;
  afterState: MarkdownTaskState;
}

export interface RenderedRowChange {
  kind: "added" | "removed" | "modified";
  label: "Добавлено" | "Удалено" | "Изменено";
  sourceLine: number;
}

export interface RenderedDiffSide {
  decorations: readonly MarkdownDecoration[];
  inlineChanges: readonly RenderedInlineChange[];
  key: string;
  kind: MarkdownChangeKind;
  label?: RenderedSideLabel;
  markdown: string;
  rowChanges: readonly RenderedRowChange[];
  taskChanges: readonly RenderedTaskChange[];
  visualRows: number;
}

export interface RenderedDiffUnit {
  changed: boolean;
  key: string;
  modified: boolean;
  sides: RenderedDiffSide[];
  visualRows: number;
}

function markdownLines(markdown: string): string[] {
  return markdown.split(/\r\n|\r|\n/u);
}

function isTableDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/u.test(cell));
}

export function renderedVisualRowCount(markdown: string): number {
  return markdownLines(markdown).reduce(
    (rows, line) => rows + (line.trim() && !isTableDelimiter(line) ? 1 : 0),
    0,
  );
}

export function renderedDiffSide(
  value: Omit<RenderedDiffSide, "visualRows">,
): RenderedDiffSide {
  return { ...value, visualRows: renderedVisualRowCount(value.markdown) };
}

export function renderedDiffUnit(
  value: Omit<RenderedDiffUnit, "visualRows">,
): RenderedDiffUnit {
  return {
    ...value,
    visualRows: value.sides.reduce((rows, side) => rows + side.visualRows, 0),
  };
}

function isTableFragment(fragment: MarkdownDiffFragment): boolean {
  return fragment.blockType === "table"
    || fragment.blockType === "tableRow"
    || fragment.blockType === "tableCell";
}

function sideLines(hunk: MarkdownDiffHunk, side: "before" | "after"): SourceDiffLine[] {
  return hunk.lines.filter((line) => side === "before" ? line.kind !== "added" : line.kind !== "removed");
}

function leadingTableGroupFrame(
  hunk: MarkdownDiffHunk,
  side: "before" | "after",
): SourceDiffLine | null {
  const prologue = hunk.structuralPrologue?.[side].markdown;
  if (!prologue) return null;
  const lines = sideLines(hunk, side);
  const [frame, title, delimiter] = lines;
  if (
    frame?.kind !== "context"
    || delimiter?.kind !== "context"
    || !isTableDelimiter(frame.value)
    || !isTableDelimiter(delimiter.value)
  ) return null;
  const headerColumnCount = scanMarkdownTableLine(markdownLines(prologue)[0] ?? "")?.cells.length;
  const frameColumnCount = scanMarkdownTableLine(frame.value)?.cells.length;
  const titleColumnCount = scanMarkdownTableLine(title?.value ?? "")?.cells.length;
  const delimiterColumnCount = scanMarkdownTableLine(delimiter.value)?.cells.length;
  return headerColumnCount
    && frameColumnCount === headerColumnCount
    && titleColumnCount === 1
    && delimiterColumnCount === headerColumnCount
    ? frame
    : null;
}

function tableSideLines(hunk: MarkdownDiffHunk, side: "before" | "after"): SourceDiffLine[] {
  const lines = sideLines(hunk, side);
  const frame = leadingTableGroupFrame(hunk, side);
  return frame ? lines.filter((line) => line.id !== frame.id) : lines;
}

function sideMarkdown(lines: readonly SourceDiffLine[]): string {
  return lines.map((line) => `${line.value}${line.eol}`).join("");
}

function hunkDecorations(
  hunk: MarkdownDiffHunk,
  fragments: readonly MarkdownDiffFragment[],
  side: "before" | "after",
  lineOffset = 0,
  lines = sideLines(hunk, side),
): MarkdownDecoration[] {
  const lineIndexes = new Map(lines.map((line, index) => [line.id, index]));
  const decorations: MarkdownDecoration[] = [];
  for (const fragment of fragments) {
    const content = fragment[side];
    if (!content?.decorations.length) continue;
    const firstLine = fragment.sourceLineIds
      .map((id) => lineIndexes.get(id))
      .find((line): line is number => line !== undefined);
    if (firstLine === undefined) continue;
    decorations.push(...content.decorations.map((decoration) => ({
      ...decoration,
      endLine: decoration.endLine + firstLine + lineOffset,
      startLine: decoration.startLine + firstLine + lineOffset,
    })));
  }
  return decorations;
}

function fallbackTableRowChanges(
  side: "before" | "after",
  lineOffset: number,
  lines: readonly SourceDiffLine[],
): RenderedRowChange[] {
  const changedKind = side === "before" ? "removed" : "added";
  const rows = new Map<number, RenderedRowChange>();
  lines.forEach((line, index) => {
    if (line.kind !== changedKind) return;
    const rowIndex = isTableDelimiter(line.value) ? Math.max(0, index - 1) : index;
    rows.set(rowIndex, {
      kind: changedKind,
      label: side === "before" ? "Удалено" : "Добавлено",
      sourceLine: rowIndex + lineOffset,
    });
  });
  return [...rows.values()];
}

function splitTableUnit(
  hunk: MarkdownDiffHunk,
  fragments: readonly MarkdownDiffFragment[],
): RenderedDiffUnit {
  const beforeLines = tableSideLines(hunk, "before");
  const afterLines = tableSideLines(hunk, "after");
  const hasRemoved = hunk.lines.some((line) => line.kind === "removed");
  const hasAdded = hunk.lines.some((line) => line.kind === "added");
  const sides: RenderedDiffSide[] = [];
  const withPrologue = (
    side: "before" | "after",
    markdown: string,
  ): { lineOffset: number; markdown: string } => {
    const prologue = hunk.structuralPrologue?.[side].markdown ?? "";
    return {
      lineOffset: prologue.match(/\r\n|\r|\n/gu)?.length ?? 0,
      markdown: `${prologue}${markdown}`,
    };
  };
  if (beforeLines.length && (hasRemoved || !hasAdded)) {
    const content = withPrologue("before", sideMarkdown(beforeLines));
    sides.push(renderedDiffSide({
      decorations: hunkDecorations(hunk, fragments, "before", content.lineOffset, beforeLines),
      inlineChanges: [],
      key: `${hunk.id}-table-before`,
      kind: "context",
      markdown: content.markdown,
      rowChanges: fallbackTableRowChanges("before", content.lineOffset, beforeLines),
      taskChanges: [],
    }));
  }
  if (afterLines.length && (hasAdded || !hasRemoved)) {
    const content = withPrologue("after", sideMarkdown(afterLines));
    sides.push(renderedDiffSide({
      decorations: hunkDecorations(hunk, fragments, "after", content.lineOffset, afterLines),
      inlineChanges: [],
      key: `${hunk.id}-table-after`,
      kind: "context",
      markdown: content.markdown,
      rowChanges: fallbackTableRowChanges("after", content.lineOffset, afterLines),
      taskChanges: [],
    }));
  }
  return renderedDiffUnit({ changed: hasRemoved || hasAdded, key: `${hunk.id}-table`, modified: false, sides });
}

function unicodeTokens(value: string): string[] {
  return value.match(/[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}\s_]+/gu) ?? [];
}

interface PendingInlineChange {
  added: string;
  beforeEndColumn: number;
  beforeStartColumn: number;
  endColumn: number;
  removed: string;
  startColumn: number;
}

function inlineChangesForText(
  before: string,
  after: string,
  sourceLine: number,
  idPrefix: string,
  afterOffset = 0,
): RenderedInlineChange[] | null {
  const changes = diffArrays(unicodeTokens(before), unicodeTokens(after));
  const result: RenderedInlineChange[] = [];
  const beforeVisibleRanges = markdownVisibleSourceRanges(before);
  const afterVisibleRanges = markdownVisibleSourceRanges(after);
  let beforeColumn = 0;
  let afterColumn = 0;
  let pending: PendingInlineChange | null = null;
  let safe = true;

  const flush = (): void => {
    if (!pending || (!pending.removed && !pending.added)) return;
    const removedVisible = !pending.removed || markdownSourceRangeIsVisible(
      beforeVisibleRanges,
      pending.beforeStartColumn,
      pending.beforeEndColumn,
    );
    const addedVisible = !pending.added || markdownSourceRangeIsVisible(
      afterVisibleRanges,
      pending.startColumn,
      pending.endColumn,
    );
    if (!removedVisible || !addedVisible) {
      safe = false;
      pending = null;
      return;
    }
    result.push({
      added: pending.added,
      endColumn: pending.endColumn + afterOffset,
      id: `${idPrefix}:${result.length}`,
      removed: pending.removed,
      sourceLine,
      startColumn: pending.startColumn + afterOffset,
    });
    pending = null;
  };

  for (const change of changes) {
    const value = change.value.join("");
    if (!change.added && !change.removed) {
      flush();
      beforeColumn += value.length;
      afterColumn += value.length;
      continue;
    }
    pending ??= {
      added: "",
      beforeEndColumn: beforeColumn,
      beforeStartColumn: beforeColumn,
      endColumn: afterColumn,
      removed: "",
      startColumn: afterColumn,
    };
    if (change.removed) {
      pending.removed += value;
      beforeColumn += value.length;
      pending.beforeEndColumn = beforeColumn;
    }
    if (change.added) {
      pending.added += value;
      afterColumn += value.length;
      pending.endColumn = afterColumn;
    }
  }
  flush();
  return safe ? result : null;
}

interface ParsedListPrefix {
  state?: MarkdownTaskState;
  contentStart: number;
  structuralKey: string;
  taskColumn?: number;
}

function parsedListPrefix(value: string): ParsedListPrefix | null {
  const match = /^(\s*(?:[-*+]|\d+[.)])[ \t]+)(?:\[([ xX-])\]([ \t]+|$))?/u.exec(value);
  if (!match) return null;
  return {
    state: match[2] === undefined ? undefined : match[2] === "-" ? "indeterminate" : match[2].toLowerCase() === "x" ? "checked" : "unchecked",
    contentStart: match[0].length,
    structuralKey: `${match[1]}${match[2] === undefined ? "" : `[]${match[3]}`}`,
    taskColumn: match[2] === undefined ? undefined : match[1].length,
  };
}

interface ParsedTaskPrefix {
  state?: MarkdownTaskState;
  contentStart: number;
  taskColumn?: number;
}

function parsedTaskPrefix(value: string): ParsedTaskPrefix {
  const match = /^\[([ xX-])\]([ \t]+|$)/u.exec(value);
  return match ? {
    state: match[1] === "-" ? "indeterminate" : match[1].toLowerCase() === "x" ? "checked" : "unchecked",
    contentStart: match[0].length,
    taskColumn: 0,
  } : { contentStart: 0 };
}

function renderChangesForTableRow(
  before: string,
  after: string,
  sourceLine: number,
  idPrefix: string,
): { inlineChanges: RenderedInlineChange[]; taskChanges: RenderedTaskChange[] } | null {
  const beforeTable = scanMarkdownTableLine(before);
  const afterTable = scanMarkdownTableLine(after);
  if (!beforeTable || !afterTable || beforeTable.cells.length !== afterTable.cells.length) return null;
  if (
    beforeTable.hasLeadingPipe !== afterTable.hasLeadingPipe
    || beforeTable.hasTrailingPipe !== afterTable.hasTrailingPipe
  ) return null;

  const inlineChanges: RenderedInlineChange[] = [];
  const taskChanges: RenderedTaskChange[] = [];
  for (let index = 0; index < beforeTable.cells.length; index += 1) {
    const beforeCell = beforeTable.cells[index];
    const afterCell = afterTable.cells[index];
    if (beforeCell.sourceText !== beforeCell.value || afterCell.sourceText !== afterCell.value) return null;
    const beforePrefix = parsedTaskPrefix(beforeCell.sourceText);
    const afterPrefix = parsedTaskPrefix(afterCell.sourceText);
    if ((beforePrefix.state === undefined) !== (afterPrefix.state === undefined)) return null;
    const cellInlineChanges = inlineChangesForText(
      beforeCell.sourceText.slice(beforePrefix.contentStart),
      afterCell.sourceText.slice(afterPrefix.contentStart),
      sourceLine,
      `${idPrefix}:cell:${index}`,
      afterCell.sourceColumn + afterPrefix.contentStart,
    );
    if (!cellInlineChanges) return null;
    inlineChanges.push(...cellInlineChanges);
    if (
      beforePrefix.state !== undefined
      && afterPrefix.state !== undefined
      && beforePrefix.state !== afterPrefix.state
    ) {
      taskChanges.push({
        afterState: afterPrefix.state,
        beforeState: beforePrefix.state,
        id: `${idPrefix}:cell:${index}:task`,
        sourceColumn: afterCell.sourceColumn + (afterPrefix.taskColumn ?? 0),
        sourceLine,
      });
    }
  }
  return { inlineChanges, taskChanges };
}

function renderChangesForLine(
  before: string,
  after: string,
  blockType: MarkdownDiffFragment["blockType"],
  sourceLine: number,
  idPrefix: string,
): { inlineChanges: RenderedInlineChange[]; taskChanges: RenderedTaskChange[] } | null {
  if (blockType === "tableRow") {
    return renderChangesForTableRow(before, after, sourceLine, idPrefix);
  }
  if (blockType === "table" || blockType === "tableCell") return null;
  if (blockType === "paragraph") {
    const beforeLayout = /^(\s*)(.*?)(\s*)$/u.exec(before);
    const afterLayout = /^(\s*)(.*?)(\s*)$/u.exec(after);
    if (
      !beforeLayout
      || !afterLayout
      || beforeLayout[1] !== afterLayout[1]
      || beforeLayout[3] !== afterLayout[3]
    ) return null;
    const inlineChanges = inlineChangesForText(
      beforeLayout[2],
      afterLayout[2],
      sourceLine,
      idPrefix,
      afterLayout[1].length,
    );
    return inlineChanges ? { inlineChanges, taskChanges: [] } : null;
  }
  if (blockType !== "listItem") {
    const inlineChanges = inlineChangesForText(before, after, sourceLine, idPrefix);
    return inlineChanges ? { inlineChanges, taskChanges: [] } : null;
  }

  const beforePrefix = parsedListPrefix(before);
  const afterPrefix = parsedListPrefix(after);
  if (!beforePrefix || !afterPrefix || beforePrefix.structuralKey !== afterPrefix.structuralKey) return null;
  const inlineChanges = inlineChangesForText(
    before.slice(beforePrefix.contentStart),
    after.slice(afterPrefix.contentStart),
    sourceLine,
    idPrefix,
    afterPrefix.contentStart,
  );
  if (!inlineChanges) return null;
  const taskChanges: RenderedTaskChange[] = [];
  if (
    beforePrefix.state !== undefined
    && afterPrefix.state !== undefined
    && beforePrefix.state !== afterPrefix.state
  ) {
    taskChanges.push({
      afterState: afterPrefix.state,
      beforeState: beforePrefix.state,
      id: `${idPrefix}:task`,
      sourceColumn: afterPrefix.taskColumn,
      sourceLine,
    });
  }
  return { inlineChanges, taskChanges };
}

function lineIsTableHeader(
  hunk: MarkdownDiffHunk,
  line: SourceDiffLine,
  side: "before" | "after",
): boolean {
  const lines = sideLines(hunk, side);
  const index = lines.findIndex((candidate) => candidate.id === line.id);
  return index >= 0 && isTableDelimiter(lines[index + 1]?.value ?? "");
}

function tableScaffold(
  hunk: MarkdownDiffHunk,
  side: "before" | "after",
): string | null {
  const prologue = hunk.structuralPrologue?.[side].markdown;
  const lines = prologue ? markdownLines(prologue) : sideLines(hunk, side).map((line) => line.value);
  const delimiterIndex = lines.findIndex(isTableDelimiter);
  if (delimiterIndex <= 0) return null;
  return `${lines[delimiterIndex - 1]}\n${lines[delimiterIndex]}`;
}

function mergedTableUnit(
  hunk: MarkdownDiffHunk,
  fragments: readonly MarkdownDiffFragment[],
): RenderedDiffUnit | null {
  const beforeScaffold = tableScaffold(hunk, "before");
  const afterScaffold = tableScaffold(hunk, "after");
  if (!beforeScaffold || beforeScaffold !== afterScaffold) return null;
  if (
    hunk.structuralPrologue
    && hunk.structuralPrologue.before.markdown !== hunk.structuralPrologue.after.markdown
  ) return null;

  const fragmentByLineId = new Map<string, MarkdownDiffFragment>();
  const pairedRemovedByPairId = new Map<string, SourceDiffLine>();
  for (const fragment of fragments) {
    for (const id of fragment.sourceLineIds) fragmentByLineId.set(id, fragment);
    if (fragment.kind !== "modified") continue;
    const paired = pairedFragmentLines(fragment, hunk);
    if (!paired || fragment.blockType === "table" || fragment.blockType === "tableCell") return null;
    for (let index = 0; index < paired.before.length; index += 1) {
      const before = paired.before[index];
      const after = paired.after[index];
      if (
        fragment.blockType === "tableRow"
        && (lineIsTableHeader(hunk, before, "before") || lineIsTableHeader(hunk, after, "after"))
      ) return null;
      if (!before.pairId) return null;
      pairedRemovedByPairId.set(before.pairId, before);
    }
  }

  const prologue = hunk.structuralPrologue?.after.markdown ?? "";
  const lineOffset = prologue.match(/\r\n|\r|\n/gu)?.length ?? 0;
  const renderedLines: string[] = [];
  const inlineChanges: RenderedInlineChange[] = [];
  const rowChanges: RenderedRowChange[] = [];
  const taskChanges: RenderedTaskChange[] = [];
  let hasModified = false;
  const leadingGroupFrame = leadingTableGroupFrame(hunk, "after");

  for (const line of hunk.lines) {
    if (line.id === leadingGroupFrame?.id) continue;
    if (line.kind === "removed" && line.pairId && pairedRemovedByPairId.has(line.pairId)) continue;
    const sourceLine = lineOffset + renderedLines.length;
    if (line.kind === "added" && line.pairId) {
      const before = pairedRemovedByPairId.get(line.pairId);
      if (before) {
        const fragment = fragmentByLineId.get(line.id);
        if (!fragment) return null;
        const changes = renderChangesForLine(
          before.value,
          line.value,
          fragment.blockType,
          sourceLine,
          `${hunk.id}:table:${line.pairId}`,
        );
        if (!changes || (!changes.inlineChanges.length && !changes.taskChanges.length)) return null;
        inlineChanges.push(...changes.inlineChanges);
        taskChanges.push(...changes.taskChanges);
        rowChanges.push({ kind: "modified", label: "Изменено", sourceLine });
        hasModified = true;
        renderedLines.push(line.value);
        continue;
      }
    }
    if (line.kind === "removed") {
      rowChanges.push({ kind: "removed", label: "Удалено", sourceLine });
    } else if (line.kind === "added") {
      rowChanges.push({ kind: "added", label: "Добавлено", sourceLine });
    }
    renderedLines.push(line.value);
  }

  const markdown = `${prologue}${renderedLines.join("\n")}`;
  const side = renderedDiffSide({
    decorations: [],
    inlineChanges,
    key: `${hunk.id}-table-combined`,
    kind: "context",
    markdown,
    rowChanges,
    taskChanges,
  });
  return renderedDiffUnit({
    changed: rowChanges.length > 0,
    key: `${hunk.id}-table`,
    modified: hasModified,
    sides: [side],
  });
}

function pairedFragmentLines(
  fragment: MarkdownDiffFragment,
  hunk: MarkdownDiffHunk,
): { before: SourceDiffLine[]; after: SourceDiffLine[] } | null {
  const selected = new Set(fragment.sourceLineIds);
  const before = hunk.lines.filter((line) => selected.has(line.id) && line.kind === "removed");
  const after = hunk.lines.filter((line) => selected.has(line.id) && line.kind === "added");
  if (!before.length || before.length !== after.length) return null;
  for (let index = 0; index < before.length; index += 1) {
    if (!before[index].pairId || before[index].pairId !== after[index].pairId) return null;
  }
  return { before, after };
}

function mergedFragmentSide(
  fragment: MarkdownDiffFragment,
  hunk: MarkdownDiffHunk,
): RenderedDiffSide | null {
  if (!fragment.after) return null;
  const paired = pairedFragmentLines(fragment, hunk);
  if (!paired) return null;
  const lineChanges = paired.before.map((line, index) =>
    renderChangesForLine(
      line.value,
      paired.after[index].value,
      fragment.blockType,
      index,
      `${fragment.id}:line:${index}`,
    ),
  );
  if (lineChanges.some((changes) => changes === null)) return null;
  const safeLineChanges = lineChanges.filter(
    (changes): changes is NonNullable<typeof changes> => changes !== null,
  );
  const inlineChanges = safeLineChanges.flatMap((changes) => changes.inlineChanges);
  const taskChanges = safeLineChanges.flatMap((changes) => changes.taskChanges);
  if (!inlineChanges.length && !taskChanges.length) return null;
  return renderedDiffSide({
    decorations: [],
    inlineChanges,
    key: `${fragment.id}-merged`,
    kind: "modified",
    markdown: fragment.after.markdown,
    rowChanges: paired.after.map((_, sourceLine) => ({
      kind: "modified",
      label: "Изменено",
      sourceLine,
    })),
    taskChanges,
  });
}

function fragmentUnit(
  fragment: MarkdownDiffFragment,
  hunk: MarkdownDiffHunk,
): RenderedDiffUnit | null {
  const side = (
    content: MarkdownDiffSide | undefined,
    name: "before" | "after",
    kind: MarkdownChangeKind,
    label?: RenderedSideLabel,
  ): RenderedDiffSide | null => content ? renderedDiffSide({
    decorations: content.decorations,
    inlineChanges: [],
    key: `${fragment.id}-${name}`,
    kind,
    label,
    markdown: content.markdown,
    rowChanges: [],
    taskChanges: [],
  }) : null;

  if (fragment.kind === "modified") {
    const merged = mergedFragmentSide(fragment, hunk);
    if (merged) {
      return renderedDiffUnit({ changed: true, key: fragment.id, modified: true, sides: [merged] });
    }
    const sides = [
      side(fragment.before, "before", "removed", "Удалено"),
      side(fragment.after, "after", "added", "Добавлено"),
    ].filter((item): item is RenderedDiffSide => item !== null);
    return renderedDiffUnit({ changed: true, key: fragment.id, modified: false, sides });
  }
  const content = fragment.kind === "removed" ? fragment.before : fragment.after ?? fragment.before;
  const rendered = side(
    content,
    fragment.kind === "removed" ? "before" : "after",
    fragment.kind,
    fragment.kind === "added" ? "Добавлено" : fragment.kind === "removed" ? "Удалено" : undefined,
  );
  return rendered ? renderedDiffUnit({
    changed: fragment.kind !== "context",
    key: fragment.id,
    modified: false,
    sides: [rendered],
  }) : null;
}

function startsListItem(fragment: MarkdownDiffFragment): boolean {
  const firstLine = markdownLines(fragment.after?.markdown ?? fragment.before?.markdown ?? "")[0] ?? "";
  return parsedListPrefix(firstLine) !== null;
}

function sameStructuralFragmentGroup(
  current: MarkdownDiffFragment,
  next: MarkdownDiffFragment,
): boolean {
  if (current.blockType !== next.blockType || current.kind === "context" || next.kind === "context") {
    return false;
  }
  if (!["blockquote", "code", "listItem", "paragraph"].includes(next.blockType)) return false;
  return next.blockType !== "listItem" || !startsListItem(next);
}

function structuralFragmentGroups(
  fragments: readonly MarkdownDiffFragment[],
): MarkdownDiffFragment[][] {
  const groups: MarkdownDiffFragment[][] = [];
  for (const fragment of fragments) {
    const current = groups.at(-1);
    if (current?.length && sameStructuralFragmentGroup(current.at(-1) as MarkdownDiffFragment, fragment)) {
      current.push(fragment);
    } else {
      groups.push([fragment]);
    }
  }
  return groups;
}

function groupRequiresFullFallback(
  group: readonly MarkdownDiffFragment[],
  hunk: MarkdownDiffHunk,
): boolean {
  if (!group.some((fragment) => fragment.kind === "modified")) return false;
  const selected = new Set(group.flatMap((fragment) => fragment.sourceLineIds));
  const removed = hunk.lines.filter((line) => selected.has(line.id) && line.kind === "removed");
  const added = hunk.lines.filter((line) => selected.has(line.id) && line.kind === "added");
  if (!removed.length || removed.length !== added.length) return true;
  const addedPairIds = new Set(added.map((line) => line.pairId).filter(Boolean));
  return removed.some((line) => !line.pairId || !addedPairIds.has(line.pairId))
    || addedPairIds.size !== added.length;
}

function fallbackFragmentGroupUnit(
  group: readonly MarkdownDiffFragment[],
  hunk: MarkdownDiffHunk,
): RenderedDiffUnit {
  const selected = new Set(group.flatMap((fragment) => fragment.sourceLineIds));
  const subhunk: MarkdownDiffHunk = {
    fragments: [...group],
    id: `${hunk.id}:fallback:${group[0]?.id ?? "fragment"}`,
    lines: hunk.lines.filter((line) => selected.has(line.id)),
  };
  const sides = (["before", "after"] as const).flatMap((name): RenderedDiffSide[] => {
    const lines = sideLines(subhunk, name);
    if (!lines.length) return [];
    const kind = name === "before" ? "removed" : "added";
    return [renderedDiffSide({
      decorations: hunkDecorations(subhunk, group, name),
      inlineChanges: [],
      key: `${subhunk.id}-${name}`,
      kind,
      label: name === "before" ? "Удалено" : "Добавлено",
      markdown: sideMarkdown(lines),
      rowChanges: [],
      taskChanges: [],
    })];
  });
  return renderedDiffUnit({ changed: true, key: subhunk.id, modified: false, sides });
}

export function renderedDiffUnits(hunk: MarkdownDiffHunk): RenderedDiffUnit[] {
  if (hunk.fragments.some(isTableFragment)) {
    return [mergedTableUnit(hunk, hunk.fragments) ?? splitTableUnit(hunk, hunk.fragments)];
  }
  const units: RenderedDiffUnit[] = [];
  for (const group of structuralFragmentGroups(hunk.fragments)) {
    if (groupRequiresFullFallback(group, hunk)) {
      units.push(fallbackFragmentGroupUnit(group, hunk));
      continue;
    }
    for (const fragment of group) {
      const unit = fragmentUnit(fragment, hunk);
      if (unit) units.push(unit);
    }
  }
  return units;
}
