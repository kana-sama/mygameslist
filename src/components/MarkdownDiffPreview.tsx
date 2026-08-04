import { useMemo, useState, type ReactNode } from "react";
import type {
  MarkdownChangeKind,
  MarkdownDecoration,
  MarkdownDiffFragment,
  MarkdownDiffHunk,
  MarkdownDiffModel,
  MarkdownDiffSide,
  SourceDiffLine,
} from "../domain/markdownDiff";
import { MarkdownView } from "./Markdown";

export interface MarkdownDiffPreviewProps {
  model: MarkdownDiffModel;
  previewRows?: number;
}

type PreviewMode = "rendered" | "source";
type SideLabel = "Добавлено" | "Удалено";

interface RenderedSide {
  decorations: readonly MarkdownDecoration[];
  key: string;
  kind: MarkdownChangeKind;
  label?: SideLabel;
  markdown: string;
  visualRows: number;
}

interface RenderedUnit {
  changed: boolean;
  key: string;
  modified: boolean;
  sides: RenderedSide[];
  visualRows: number;
}

const DEFAULT_PREVIEW_ROWS = 12;

function isTableFragment(fragment: MarkdownDiffFragment): boolean {
  return fragment.blockType === "table" || fragment.blockType === "tableRow" || fragment.blockType === "tableCell";
}

function sideLines(hunk: MarkdownDiffHunk, side: "before" | "after"): SourceDiffLine[] {
  return hunk.lines.filter((line) => side === "before" ? line.kind !== "added" : line.kind !== "removed");
}

function sideMarkdown(lines: readonly SourceDiffLine[]): string {
  return lines.map((line) => `${line.value}${line.eol}`).join("");
}

function markdownLines(markdown: string): string[] {
  return markdown.split(/\r\n|\r|\n/u);
}

function isTableDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/u.test(cell));
}

function visualRowCount(markdown: string): number {
  return markdownLines(markdown).reduce(
    (rows, line) => rows + (line.trim() && !isTableDelimiter(line) ? 1 : 0),
    0,
  );
}

function renderedSide(
  value: Omit<RenderedSide, "visualRows">,
): RenderedSide {
  return { ...value, visualRows: visualRowCount(value.markdown) };
}

function renderedUnit(
  value: Omit<RenderedUnit, "visualRows">,
): RenderedUnit {
  return {
    ...value,
    visualRows: value.sides.reduce((rows, side) => rows + side.visualRows, 0),
  };
}

function hunkDecorations(
  hunk: MarkdownDiffHunk,
  fragments: readonly MarkdownDiffFragment[],
  side: "before" | "after",
): MarkdownDecoration[] {
  const lines = sideLines(hunk, side);
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
      endLine: decoration.endLine + firstLine,
      startLine: decoration.startLine + firstLine,
    })));
  }
  return decorations;
}

function tableUnit(hunk: MarkdownDiffHunk, fragments: readonly MarkdownDiffFragment[]): RenderedUnit {
  const beforeLines = sideLines(hunk, "before");
  const afterLines = sideLines(hunk, "after");
  const hasRemoved = hunk.lines.some((line) => line.kind === "removed");
  const hasAdded = hunk.lines.some((line) => line.kind === "added");
  const modified = hasRemoved && hasAdded;
  const sides: RenderedSide[] = [];
  if (beforeLines.length && (hasRemoved || !hasAdded)) {
    sides.push(renderedSide({
      decorations: hunkDecorations(hunk, fragments, "before"),
      key: `${hunk.id}-table-before`,
      kind: "context",
      markdown: sideMarkdown(beforeLines),
    }));
  }
  if (afterLines.length && (hasAdded || !hasRemoved)) {
    sides.push(renderedSide({
      decorations: hunkDecorations(hunk, fragments, "after"),
      key: `${hunk.id}-table-after`,
      kind: "context",
      markdown: sideMarkdown(afterLines),
    }));
  }
  return renderedUnit({ changed: hasRemoved || hasAdded, key: `${hunk.id}-table`, modified, sides });
}

function fragmentUnit(fragment: MarkdownDiffFragment): RenderedUnit | null {
  const side = (
    content: MarkdownDiffSide | undefined,
    name: "before" | "after",
    kind: MarkdownChangeKind,
    label?: SideLabel,
  ): RenderedSide | null => content ? renderedSide({
    decorations: content.decorations,
    key: `${fragment.id}-${name}`,
    kind,
    label,
    markdown: content.markdown,
  }) : null;

  if (fragment.kind === "modified") {
    const sides = [
      side(fragment.before, "before", "modified", "Удалено"),
      side(fragment.after, "after", "modified", "Добавлено"),
    ].filter((item): item is RenderedSide => item !== null);
    return renderedUnit({ changed: true, key: fragment.id, modified: true, sides });
  }
  const content = fragment.kind === "removed" ? fragment.before : fragment.after ?? fragment.before;
  const rendered = side(
    content,
    fragment.kind === "removed" ? "before" : "after",
    fragment.kind,
    fragment.kind === "added" ? "Добавлено" : fragment.kind === "removed" ? "Удалено" : undefined,
  );
  return rendered ? renderedUnit({
    changed: fragment.kind !== "context",
    key: fragment.id,
    modified: false,
    sides: [rendered],
  }) : null;
}

function renderedUnits(hunk: MarkdownDiffHunk): RenderedUnit[] {
  if (hunk.fragments.some(isTableFragment)) return [tableUnit(hunk, hunk.fragments)];
  const units: RenderedUnit[] = [];
  for (let index = 0; index < hunk.fragments.length;) {
    const unit = fragmentUnit(hunk.fragments[index]);
    if (unit) units.push(unit);
    index += 1;
  }
  return units;
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

function truncateSide(side: RenderedSide, limit: number): RenderedSide {
  if (side.visualRows <= limit) return side;
  const truncated = truncatedMarkdown(side.markdown, limit);
  const lastLine = markdownLines(truncated.markdown).at(-1) ?? "";
  const decorations = side.decorations
    .filter((decoration) => decoration.startLine < truncated.lineCount)
    .map((decoration) => decoration.endLine < truncated.lineCount ? decoration : {
      ...decoration,
      endColumn: lastLine.length,
      endLine: Math.max(0, truncated.lineCount - 1),
    });
  return renderedSide({ ...side, decorations, markdown: truncated.markdown });
}

function minimumUnitRows(unit: RenderedUnit): number {
  if (!unit.modified) return Math.min(1, unit.visualRows);
  return unit.sides.reduce(
    (rows, side) => rows + (side.visualRows > 0 ? 1 : 0),
    0,
  );
}

function truncateUnit(unit: RenderedUnit, limit: number): RenderedUnit {
  if (unit.visualRows <= limit) return unit;
  let remaining = Math.max(limit, minimumUnitRows(unit));
  const sides = unit.sides.map((side, index) => {
    const sidesLeft = unit.sides.slice(index).filter((candidate) => candidate.visualRows > 0).length;
    const minimumLaterRows = unit.sides
      .slice(index + 1)
      .reduce((rows, candidate) => rows + (candidate.visualRows > 0 ? 1 : 0), 0);
    const sideMinimum = side.visualRows > 0 ? 1 : 0;
    const fairShare = sidesLeft > 0 ? Math.floor(remaining / sidesLeft) : 0;
    const allocation = Math.min(
      side.visualRows,
      Math.max(sideMinimum, Math.min(fairShare, remaining - minimumLaterRows)),
    );
    remaining -= allocation;
    return truncateSide(side, allocation);
  });
  return renderedUnit({ ...unit, sides });
}

function takeRenderedRows(units: readonly RenderedUnit[], limit: number): RenderedUnit[] {
  const visible: RenderedUnit[] = [];
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
      aria-label={label}
      className={`markdown-diff-source-row markdown-diff-source-row--${line.kind}`}
      data-diff-kind={line.kind}
      data-testid="diff-visual-row"
    >
      {line.value}
    </span>
  );
}

function RenderedRows({ units }: { units: readonly RenderedUnit[] }) {
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
          markdown={side.markdown}
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

export function MarkdownDiffPreview({ model, previewRows = DEFAULT_PREVIEW_ROWS }: MarkdownDiffPreviewProps) {
  const [mode, setMode] = useState<PreviewMode>("rendered");
  const [expanded, setExpanded] = useState(false);
  const sourceOnly = !model.renderable;
  const visibleMode: PreviewMode = sourceOnly ? "source" : mode;
  const rowBudget = Math.max(1, Math.floor(previewRows));
  const allRenderedUnits = useMemo(() => model.hunks.flatMap(renderedUnits), [model]);
  const firstRenderedUnits = useMemo(() => model.hunks[0] ? renderedUnits(model.hunks[0]) : [], [model]);
  const allSourceLines = useMemo(() => model.hunks.flatMap((hunk) => hunk.lines), [model]);

  let content: ReactNode;
  let visibleRows: number;
  let totalRows: number;
  if (visibleMode === "source") {
    const lines = expanded ? allSourceLines : takeSourceRows(model.hunks[0], rowBudget);
    visibleRows = lines.length;
    totalRows = allSourceLines.length;
    content = <pre className="markdown-diff-source"><code>{lines.map((line) => <SourceRow key={line.id} line={line} />)}</code></pre>;
  } else {
    const units = expanded ? allRenderedUnits : takeRenderedRows(firstRenderedUnits, rowBudget);
    visibleRows = units.reduce((rows, unit) => rows + unit.visualRows, 0);
    totalRows = allRenderedUnits.reduce((rows, unit) => rows + unit.visualRows, 0);
    content = <div className="markdown-diff-rendered"><RenderedRows units={units} /></div>;
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
