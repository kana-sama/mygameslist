import { Fragment, useMemo, useState, type ReactNode } from "react";
import type {
  MarkdownDiffFragment,
  MarkdownDiffHunk,
  MarkdownDiffModel,
  SourceDiffLine,
} from "../domain/markdownDiff";
import { MarkdownView } from "./Markdown";
import {
  renderedDiffSide,
  renderedDiffUnit,
  renderedDiffUnits,
  type RenderedDiffSide,
  type RenderedDiffUnit,
} from "./markdownDiffRenderModel";

export interface MarkdownDiffPreviewProps {
  model: MarkdownDiffModel;
  previewRows?: number;
}

type PreviewMode = "rendered" | "source";

const DEFAULT_PREVIEW_ROWS = 12;

function markdownLines(markdown: string): string[] {
  return markdown.split(/\r\n|\r|\n/u);
}

function isTableDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/u.test(cell));
}


function truncatedMarkdown(markdown: string, limit: number): { lineCount: number; markdown: string } {
  const lines = markdownLines(markdown);
  const visible: string[] = [];
  let rows = 0;
  for (const line of lines) {
    const cost = line.trim() && !isTableDelimiter(line) ? 1 : 0;
    if (cost && rows >= limit) break;
    visible.push(line);
    rows += cost;
  }
  return { lineCount: visible.length, markdown: visible.join("\n") };
}

function truncateTableSide(side: RenderedDiffSide, limit: number): RenderedDiffSide | null {
  const lines = markdownLines(side.markdown);
  const delimiterIndexes = lines.flatMap((line, index) => isTableDelimiter(line) ? [index] : []);
  if (delimiterIndexes.length !== 1 || !side.rowChanges.length) return null;
  const delimiterIndex = delimiterIndexes[0];
  if (delimiterIndex <= 0) return null;
  const focus = side.rowChanges.find((change) => change.kind === "modified") ?? side.rowChanges[0];
  if (!focus || focus.sourceLine < 0 || focus.sourceLine >= lines.length) return null;

  const selected = new Set([delimiterIndex - 1, delimiterIndex, focus.sourceLine]);
  const rowCost = (index: number): number => {
    const line = lines[index] ?? "";
    return line.trim() && !isTableDelimiter(line) ? 1 : 0;
  };
  let rows = [...selected].reduce((total, index) => total + rowCost(index), 0);
  const changedCandidates = side.rowChanges
    .filter((change) => change.sourceLine !== focus.sourceLine)
    .sort((left, right) => left.sourceLine - right.sourceLine)
    .map((change) => change.sourceLine);
  const contextCandidates = lines
    .map((line, index) => ({ index, line }))
    .filter(({ index, line }) =>
      index > delimiterIndex
      && line.includes("|")
      && !isTableDelimiter(line)
      && !selected.has(index)
      && !changedCandidates.includes(index),
    )
    .sort((left, right) =>
      Math.abs(left.index - focus.sourceLine) - Math.abs(right.index - focus.sourceLine)
      || left.index - right.index,
    )
    .map(({ index }) => index);
  for (const index of [...changedCandidates, ...contextCandidates]) {
    if (rows >= limit || selected.has(index)) continue;
    const cost = rowCost(index);
    if (rows + cost > limit) continue;
    selected.add(index);
    rows += cost;
  }

  const selectedIndexes = [...selected].sort((left, right) => left - right);
  const lineMap = new Map(selectedIndexes.map((sourceLine, index) => [sourceLine, index]));
  const remapSourceLines = <T extends { sourceLine: number },>(items: readonly T[]): T[] =>
    items.flatMap((item) => {
      const sourceLine = lineMap.get(item.sourceLine);
      return sourceLine === undefined ? [] : [{ ...item, sourceLine }];
    });
  const decorations = side.decorations.flatMap((decoration) => {
    const startLine = lineMap.get(decoration.startLine);
    const endLine = lineMap.get(decoration.endLine);
    return startLine === undefined || endLine === undefined ? [] : [{
      ...decoration,
      endLine,
      startLine,
    }];
  });
  return renderedDiffSide({
    ...side,
    decorations,
    inlineChanges: remapSourceLines(side.inlineChanges),
    markdown: selectedIndexes.map((index) => lines[index]).join("\n"),
    rowChanges: remapSourceLines(side.rowChanges),
    taskChanges: remapSourceLines(side.taskChanges),
  });
}

function truncateSide(side: RenderedDiffSide, limit: number): RenderedDiffSide {
  if (side.visualRows <= limit) return side;
  const tableSide = truncateTableSide(side, limit);
  if (tableSide) return tableSide;
  const truncated = truncatedMarkdown(side.markdown, limit);
  const lastLine = markdownLines(truncated.markdown).at(-1) ?? "";
  const decorations = side.decorations
    .filter((decoration) => decoration.startLine < truncated.lineCount)
    .map((decoration) => decoration.endLine < truncated.lineCount ? decoration : {
      ...decoration,
      endColumn: lastLine.length,
      endLine: Math.max(0, truncated.lineCount - 1),
    });
  const visibleSourceLine = (item: { sourceLine: number }): boolean =>
    item.sourceLine < truncated.lineCount;
  return renderedDiffSide({
    ...side,
    decorations,
    inlineChanges: side.inlineChanges.filter(visibleSourceLine),
    markdown: truncated.markdown,
    rowChanges: side.rowChanges.filter(visibleSourceLine),
    taskChanges: side.taskChanges.filter(visibleSourceLine),
  });
}

function minimumSideRows(unit: RenderedDiffUnit, side: RenderedDiffSide): number {
  if (side.visualRows <= 0) return 0;
  const tableLines = markdownLines(side.markdown);
  const delimiterCount = tableLines.filter(isTableDelimiter).length;
  if (delimiterCount > 1 && side.rowChanges.length) return side.visualRows;
  if (delimiterCount === 1 && side.rowChanges.length) return Math.min(2, side.visualRows);
  return unit.modified ? side.visualRows : 1;
}

function minimumUnitRows(unit: RenderedDiffUnit): number {
  return unit.sides.reduce((rows, side) => rows + minimumSideRows(unit, side), 0);
}

function truncateUnit(unit: RenderedDiffUnit, limit: number): RenderedDiffUnit {
  if (unit.visualRows <= limit) return unit;
  let remaining = Math.max(limit, minimumUnitRows(unit));
  const sides = unit.sides.map((side, index) => {
    const sidesLeft = unit.sides.slice(index).filter((candidate) => candidate.visualRows > 0).length;
    const minimumLaterRows = unit.sides
      .slice(index + 1)
      .reduce((rows, candidate) => rows + minimumSideRows(unit, candidate), 0);
    const sideMinimum = minimumSideRows(unit, side);
    const fairShare = sidesLeft > 0 ? Math.floor(remaining / sidesLeft) : 0;
    const allocation = Math.min(
      side.visualRows,
      Math.max(sideMinimum, Math.min(fairShare, remaining - minimumLaterRows)),
    );
    remaining -= allocation;
    return truncateSide(side, allocation);
  });
  return renderedDiffUnit({ ...unit, sides });
}

function takeRenderedRows(units: readonly RenderedDiffUnit[], limit: number): RenderedDiffUnit[] {
  const visible: RenderedDiffUnit[] = [];
  let rows = 0;
  for (const unit of units) {
    let remaining = limit - rows;
    if (remaining <= 0) break;

    const minimumRows = minimumUnitRows(unit);
    while (remaining < minimumRows && visible.at(-1)?.changed === false) {
      const context = visible.pop();
      if (!context) break;
      rows -= context.visualRows;
      remaining = limit - rows;
    }

    const selected = unit.visualRows <= remaining
      ? unit
      : truncateUnit(unit, Math.max(remaining, minimumRows));
    visible.push(selected);
    rows += selected.visualRows;
    if (rows >= limit) break;
  }
  return visible;
}

function takeSourceRows(hunk: MarkdownDiffHunk | undefined, limit: number): SourceDiffLine[] {
  if (!hunk || hunk.lines.length <= limit) return hunk?.lines ?? [];
  const lineIndexes = new Map(hunk.lines.map((line, index) => [line.id, index]));
  const fragmentByLine = new Map<string, MarkdownDiffFragment>();
  for (const fragment of hunk.fragments) {
    for (const id of fragment.sourceLineIds) fragmentByLine.set(id, fragment);
  }

  let start = 0;
  let end = Math.min(limit, hunk.lines.length);
  let previousEnd = -1;
  while (end !== previousEnd) {
    previousEnd = end;
    for (const line of hunk.lines.slice(start, end)) {
      if (line.pairId) {
        const pairIndex = hunk.lines.findIndex((candidate) => candidate.pairId === line.pairId && candidate.id !== line.id);
        if (pairIndex >= end) end = pairIndex + 1;
      }
      const fragment = fragmentByLine.get(line.id);
      if (!fragment) continue;
      for (const id of fragment.sourceLineIds) {
        const fragmentIndex = lineIndexes.get(id);
        if (fragmentIndex !== undefined && fragmentIndex >= end) end = fragmentIndex + 1;
      }
    }
  }
  while (end - start > limit && hunk.lines[start]?.kind === "context") {
    const fragment = fragmentByLine.get(hunk.lines[start].id);
    if (fragment?.kind === "context") {
      const fragmentEnd = fragment.sourceLineIds.reduce((boundary, id) => {
        const index = lineIndexes.get(id);
        return index === undefined ? boundary : Math.max(boundary, index + 1);
      }, start + 1);
      start = fragmentEnd;
    } else {
      start += 1;
    }
  }
  return hunk.lines.slice(start, end);
}

function SourceRow({ line }: { line: SourceDiffLine }) {
  const label = line.kind === "added" ? "Добавлено" : line.kind === "removed" ? "Удалено" : undefined;
  return (
    <span
      aria-label={label ? `${label}: ${line.value}` : undefined}
      className={`markdown-diff-source-row markdown-diff-source-row--${line.kind}`}
      data-diff-kind={line.kind}
      data-testid="diff-visual-row"
    >
      {line.value}
    </span>
  );
}

function omittedLineCount(
  previous: MarkdownDiffHunk,
  next: MarkdownDiffHunk,
): number {
  const previousLine = [...previous.lines].reverse().find((line) => line.afterLine !== null)?.afterLine;
  const nextLine = next.lines.find((line) => line.afterLine !== null)?.afterLine;
  return previousLine === null || previousLine === undefined || nextLine === null || nextLine === undefined
    ? 0
    : Math.max(0, nextLine - previousLine - 1);
}

function omittedLineLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return `Пропущена ${count} строка`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `Пропущены ${count} строки`;
  return `Пропущено ${count} строк`;
}

function HunkSeparator({ lineCount }: { lineCount: number }) {
  const label = omittedLineLabel(lineCount);
  return (
    <span
      aria-label={label}
      className="markdown-diff-hunk-separator"
      role="separator"
    >
      {label}
    </span>
  );
}

function SourceHunks({ hunks }: { hunks: readonly MarkdownDiffHunk[] }) {
  return hunks.map((hunk, index) => (
    <Fragment key={hunk.id}>
      {index > 0 ? <HunkSeparator lineCount={omittedLineCount(hunks[index - 1], hunk)} /> : null}
      <pre className="markdown-diff-source">
        <code>{hunk.lines.map((line) => <SourceRow key={line.id} line={line} />)}</code>
      </pre>
    </Fragment>
  ));
}

function RenderedRows({ units }: { units: readonly RenderedDiffUnit[] }) {
  return units.map((unit) => {
    const sides = unit.sides.map((side) => (
      <div
        aria-label={side.label}
        className={`markdown-diff-rendered-side markdown-diff-rendered-side--${side.kind}`}
        data-diff-kind={side.kind}
        key={side.key}
        role="group"
      >
        {side.label ? <span className="visually-hidden">{side.label}</span> : null}
        <MarkdownView
          className="markdown-diff-rendered-markdown"
          decorations={side.decorations}
          inlineChanges={side.inlineChanges}
          markdown={side.markdown}
          rowChanges={side.rowChanges}
          taskChanges={side.taskChanges}
          taskChangesDisabled
        />
      </div>
    ));
    return unit.modified ? (
      <div aria-label="Изменено" className="markdown-diff-modified" key={unit.key} role="group">
        {sides}
      </div>
    ) : <div className="markdown-diff-rendered-unit" key={unit.key}>{sides}</div>;
  });
}

function RenderedHunks({ hunks }: {
  hunks: readonly { id: string; omittedLinesBefore: number; units: readonly RenderedDiffUnit[] }[];
}) {
  return hunks.map((hunk, index) => (
    <Fragment key={hunk.id}>
      {index > 0 ? <HunkSeparator lineCount={hunk.omittedLinesBefore} /> : null}
      <div className="markdown-diff-rendered"><RenderedRows units={hunk.units} /></div>
    </Fragment>
  ));
}

export function MarkdownDiffPreview({ model, previewRows = DEFAULT_PREVIEW_ROWS }: MarkdownDiffPreviewProps) {
  const [mode, setMode] = useState<PreviewMode>("rendered");
  const [expanded, setExpanded] = useState(false);
  const sourceOnly = !model.renderable;
  const visibleMode: PreviewMode = sourceOnly ? "source" : mode;
  const rowBudget = Math.max(1, Math.floor(previewRows));
  const renderedHunks = useMemo(() => model.hunks.map((hunk, index) => ({
    id: hunk.id,
    omittedLinesBefore: index > 0 ? omittedLineCount(model.hunks[index - 1], hunk) : 0,
    units: renderedDiffUnits(hunk),
  })), [model]);
  const allRenderedUnits = useMemo(() => renderedHunks.flatMap((hunk) => hunk.units), [renderedHunks]);
  const firstRenderedUnits = useMemo(() => model.hunks[0] ? renderedDiffUnits(model.hunks[0]) : [], [model]);
  const allSourceLines = useMemo(() => model.hunks.flatMap((hunk) => hunk.lines), [model]);

  let content: ReactNode;
  let visibleRows: number;
  let totalRows: number;
  if (visibleMode === "source") {
    const lines = expanded ? allSourceLines : takeSourceRows(model.hunks[0], rowBudget);
    visibleRows = lines.length;
    totalRows = allSourceLines.length;
    content = expanded ? (
      <div className="markdown-diff-hunks"><SourceHunks hunks={model.hunks} /></div>
    ) : (
      <pre className="markdown-diff-source">
        <code>{lines.map((line) => <SourceRow key={line.id} line={line} />)}</code>
      </pre>
    );
  } else {
    const units = expanded ? allRenderedUnits : takeRenderedRows(firstRenderedUnits, rowBudget);
    visibleRows = units.reduce((rows, unit) => rows + unit.visualRows, 0);
    totalRows = allRenderedUnits.reduce((rows, unit) => rows + unit.visualRows, 0);
    content = expanded ? (
      <div className="markdown-diff-hunks"><RenderedHunks hunks={renderedHunks} /></div>
    ) : (
      <div className="markdown-diff-rendered"><RenderedRows units={units} /></div>
    );
  }
  const remainingRows = Math.max(0, totalRows - visibleRows);

  return (
    <section className="markdown-diff-preview">
      <header className="markdown-diff-preview__toolbar">
        {sourceOnly ? (
          <p className="markdown-diff-preview__fallback" role="status">
            Показан точный исходник: эту заметку нельзя надёжно отобразить.
          </p>
        ) : (
          <button
            aria-label={visibleMode === "rendered" ? "Показать исходник" : "Показать как выглядит"}
            className="markdown-diff-preview__mode"
            onClick={() => setMode((current) => current === "rendered" ? "source" : "rendered")}
            type="button"
          >
            {visibleMode === "rendered" ? "Исходник" : "Как выглядит"}
          </button>
        )}
      </header>
      {content}
      {!expanded && remainingRows > 0 ? (
        <button
          aria-label={`Весь diff · ещё ${remainingRows}`}
          className="markdown-diff-preview__expand"
          onClick={() => setExpanded(true)}
          type="button"
        >
          Весь diff · ещё {remainingRows}
        </button>
      ) : null}
    </section>
  );
}
