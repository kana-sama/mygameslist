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
}

interface RenderedUnit {
  key: string;
  modified: boolean;
  sides: RenderedSide[];
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
    sides.push({
      decorations: hunkDecorations(hunk, fragments, "before"),
      key: `${hunk.id}-table-before`,
      kind: modified ? "modified" : hasRemoved ? "removed" : "context",
      label: hasRemoved ? "Удалено" : undefined,
      markdown: sideMarkdown(beforeLines),
    });
  }
  if (afterLines.length && (hasAdded || !hasRemoved)) {
    sides.push({
      decorations: hunkDecorations(hunk, fragments, "after"),
      key: `${hunk.id}-table-after`,
      kind: modified ? "modified" : hasAdded ? "added" : "context",
      label: hasAdded ? "Добавлено" : undefined,
      markdown: sideMarkdown(afterLines),
    });
  }
  return { key: `${hunk.id}-table`, modified, sides };
}

function fragmentUnit(fragment: MarkdownDiffFragment): RenderedUnit | null {
  const side = (
    content: MarkdownDiffSide | undefined,
    name: "before" | "after",
    kind: MarkdownChangeKind,
    label?: SideLabel,
  ): RenderedSide | null => content ? {
    decorations: content.decorations,
    key: `${fragment.id}-${name}`,
    kind,
    label,
    markdown: content.markdown,
  } : null;

  if (fragment.kind === "modified") {
    const sides = [
      side(fragment.before, "before", "modified", "Удалено"),
      side(fragment.after, "after", "modified", "Добавлено"),
    ].filter((item): item is RenderedSide => item !== null);
    return { key: fragment.id, modified: true, sides };
  }
  const content = fragment.kind === "removed" ? fragment.before : fragment.after ?? fragment.before;
  const rendered = side(
    content,
    fragment.kind === "removed" ? "before" : "after",
    fragment.kind,
    fragment.kind === "added" ? "Добавлено" : fragment.kind === "removed" ? "Удалено" : undefined,
  );
  return rendered ? { key: fragment.id, modified: false, sides: [rendered] } : null;
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

function takeRenderedRows(units: readonly RenderedUnit[], limit: number): RenderedUnit[] {
  const visible: RenderedUnit[] = [];
  let rows = 0;
  for (const unit of units) {
    const unitRows = unit.sides.length;
    if (visible.length && rows + unitRows > limit) break;
    visible.push(unit);
    rows += unitRows;
    if (rows >= limit) break;
  }
  return visible;
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
        data-testid="diff-visual-row"
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
  const firstSourceLines = model.hunks[0]?.lines ?? [];

  let content: ReactNode;
  let visibleRows: number;
  let totalRows: number;
  if (visibleMode === "source") {
    const lines = expanded ? allSourceLines : firstSourceLines.slice(0, rowBudget);
    visibleRows = lines.length;
    totalRows = allSourceLines.length;
    content = <pre className="markdown-diff-source"><code>{lines.map((line) => <SourceRow key={line.id} line={line} />)}</code></pre>;
  } else {
    const units = expanded ? allRenderedUnits : takeRenderedRows(firstRenderedUnits, rowBudget);
    visibleRows = units.reduce((rows, unit) => rows + unit.sides.length, 0);
    totalRows = allRenderedUnits.reduce((rows, unit) => rows + unit.sides.length, 0);
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
