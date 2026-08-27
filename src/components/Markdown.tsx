import { Children, Fragment, isValidElement, memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MarkdownDecoration } from "../domain/markdownDiff";
import {
  getChecklistProgress,
  getTableRowProgress,
  hasMarkdownTasks,
  markdownLabel,
  parseMarkdownBlocks,
  splitMarkdownSourceLines,
  type ChecklistProgress,
  type MarkdownBlock,
  type MarkdownListItem,
  type MarkdownTaskState,
  type MarkdownSourceLine,
  type MarkdownTableRow,
  type MarkdownTextLocation,
} from "../domain/markdownChecklist";
import { Icon } from "./Icon";
import { safeUrl } from "./libraryUi";
import {
  completedChecklistItemIsHidden,
  completedChecklistSectionIsHidden,
  createCompletedChecklistFilterSnapshot,
  emptyCompletedChecklistFilterSnapshot,
  type CompletedChecklistFilterSnapshot,
} from "./markdownCompletedChecklistFilter";
import { useMarkdownChecklistCollapseMotion } from "./markdownChecklistCollapseMotion";
import { useCompletedChecklistMotion } from "./markdownCompletedChecklistMotion";
import type {
  RenderedInlineChange,
  RenderedRowChange,
  RenderedTaskChange,
} from "./markdownDiffRenderModel";
import { markdownInlineTokenPattern, markdownIsSingleSpoiler } from "./markdownInlineSyntax";

export { hasMarkdownTasks } from "../domain/markdownChecklist";

interface MarkdownInlineLocation {
  decorations: readonly MarkdownDecoration[];
  inlineChanges: readonly RenderedInlineChange[];
  renderedInlineChangeIds: Set<string>;
  sourceColumn: number;
  sourceLine: number;
}

function reactNodeText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (!isValidElement(child)) return "";
    return reactNodeText((child.props as { children?: ReactNode }).children);
  }).join("");
}

function MarkdownSpoiler({ children, forceRevealed = false }: { children: ReactNode; forceRevealed?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const reveal = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    setRevealed(true);
  };

  if (revealed || forceRevealed) return <span className="markdown-spoiler" data-revealed="true">{children}</span>;

  return (
    <span
      aria-label="Показать спойлер"
      className="markdown-spoiler"
      data-revealed="false"
      onClick={reveal}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        reveal(event);
      }}
      role="button"
      tabIndex={0}
    >
      <span aria-hidden="true">{reactNodeText(children)}</span>
    </span>
  );
}

function markdownTaskLabel(source: string, revealExactSpoiler: boolean): string {
  const safeSource = revealExactSpoiler && markdownIsSingleSpoiler(source)
    ? source.trim().slice(2, -2)
    : source.replace(/\|\|([^|\n]+)\|\|/g, "скрытый спойлер");
  return markdownLabel(safeSource).replace(/\\\|/g, "|");
}

function decorationAt(
  location: MarkdownInlineLocation,
  startColumn: number,
  endColumn: number,
): MarkdownDecoration | undefined {
  return location.decorations.find((decoration) => {
    if (location.sourceLine < decoration.startLine || location.sourceLine > decoration.endLine) return false;
    const decorationStart = location.sourceLine === decoration.startLine ? decoration.startColumn : 0;
    const decorationEnd = location.sourceLine === decoration.endLine ? decoration.endColumn : Number.POSITIVE_INFINITY;
    return decorationStart < endColumn && decorationEnd > startColumn;
  });
}

function renderDecorationOnly(
  text: string,
  keyPrefix: string,
  rawStart: number,
  location?: MarkdownInlineLocation,
): ReactNode[] {
  if (!location || !text) return text ? [text] : [];
  const sourceStart = location.sourceColumn + rawStart;
  const sourceEnd = sourceStart + text.length;
  const boundaries = new Set([sourceStart, sourceEnd]);
  for (const decoration of location.decorations) {
    if (location.sourceLine < decoration.startLine || location.sourceLine > decoration.endLine) continue;
    const start = location.sourceLine === decoration.startLine ? decoration.startColumn : 0;
    const end = location.sourceLine === decoration.endLine ? decoration.endColumn : Number.POSITIVE_INFINITY;
    if (start > sourceStart && start < sourceEnd) boundaries.add(start);
    if (end > sourceStart && end < sourceEnd) boundaries.add(end);
  }
  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const value = text.slice(start - sourceStart, end - sourceStart);
    const decoration = decorationAt(location, start, end);
    if (!decoration) return value;
    return (
      <span
        aria-label={`${decoration.label}: ${value}`}
        className={`markdown-diff-inline markdown-diff-inline--${decoration.kind}`}
        data-diff-kind={decoration.kind}
        key={`${keyPrefix}-decoration-${start}`}
      >
        {value}
      </span>
    );
  });
}

function renderInlineChange(change: RenderedInlineChange, key: string): ReactNode {
  return (
    <Fragment key={key}>
      {change.removed ? (
        <del
          aria-label={`Удалено: ${change.removed}`}
          className="markdown-diff-inline markdown-diff-inline--removed"
          data-diff-kind="removed"
        >
          {change.removed}
        </del>
      ) : null}
      {change.removed && change.added ? (
        <span aria-hidden="true" className="markdown-diff-inline-arrow">→</span>
      ) : null}
      {change.added ? (
        <ins
          aria-label={`Добавлено: ${change.added}`}
          className="markdown-diff-inline markdown-diff-inline--added"
          data-diff-kind="added"
        >
          {change.added}
        </ins>
      ) : null}
    </Fragment>
  );
}

function renderDecoratedText(
  text: string,
  keyPrefix: string,
  rawStart: number,
  location?: MarkdownInlineLocation,
): ReactNode[] {
  if (!location || !text) return text ? [text] : [];
  const sourceStart = location.sourceColumn + rawStart;
  const sourceEnd = sourceStart + text.length;
  const changes = location.inlineChanges
    .filter((change) =>
      change.sourceLine === location.sourceLine
      && !location.renderedInlineChangeIds.has(change.id)
      && change.startColumn >= sourceStart
      && change.endColumn <= sourceEnd,
    )
    .sort((left, right) => left.startColumn - right.startColumn || left.endColumn - right.endColumn);
  if (!changes.length) return renderDecorationOnly(text, keyPrefix, rawStart, location);

  const nodes: ReactNode[] = [];
  let cursor = sourceStart;
  for (const change of changes) {
    if (change.startColumn > cursor) {
      const start = cursor - sourceStart;
      const end = change.startColumn - sourceStart;
      nodes.push(...renderDecorationOnly(text.slice(start, end), `${keyPrefix}-before-${change.id}`, rawStart + start, location));
    }
    nodes.push(renderInlineChange(change, `${keyPrefix}-inline-${change.id}`));
    location.renderedInlineChangeIds.add(change.id);
    cursor = Math.max(cursor, change.endColumn);
  }
  if (cursor < sourceEnd) {
    const start = cursor - sourceStart;
    nodes.push(...renderDecorationOnly(text.slice(start), `${keyPrefix}-after`, rawStart + start, location));
  }
  return nodes;
}

function renderInline(source: string, keyPrefix = "inline", location?: MarkdownInlineLocation, forceRevealSpoilers = false): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = markdownInlineTokenPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    if (match.index > cursor) nodes.push(...renderDecoratedText(source.slice(cursor, match.index), keyPrefix, cursor, location));
    const raw = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (raw === "\\|") {
      nodes.push(...renderDecoratedText("|", key, match.index + 1, location));
    } else if (raw.startsWith("||")) {
      nodes.push(
        <MarkdownSpoiler forceRevealed={forceRevealSpoilers} key={key}>
          {renderInline(raw.slice(2, -2), `${key}-spoiler`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 2 } : undefined, forceRevealSpoilers)}
        </MarkdownSpoiler>,
      );
    } else if (raw.startsWith("`")) {
      nodes.push(<code key={key}>{renderDecoratedText(raw.slice(1, -1), key, match.index + 1, location)}</code>);
    } else if (raw.startsWith("[")) {
      const hintMatch = /^\[([^\]]+)\]\("([^"\n]*)"\)$/.exec(raw);
      const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(raw);
      const href = linkMatch ? safeUrl(linkMatch[2]) : null;
      if (hintMatch) {
        nodes.push(
          <span className="markdown-hover-hint" key={key} title={hintMatch[2]}>
            {renderInline(
              hintMatch[1],
              `${key}-label`,
              location ? { ...location, sourceColumn: location.sourceColumn + match.index + 1 } : undefined,
              forceRevealSpoilers,
            )}
          </span>,
        );
      } else if (linkMatch && href) {
        const isExternal = /^https?:/i.test(href);
        nodes.push(
          <a
            href={href}
            key={key}
            rel={isExternal ? "noreferrer noopener" : undefined}
            target={isExternal ? "_blank" : undefined}
            title={linkMatch[3] || undefined}
          >
            {renderInline(linkMatch[1], `${key}-label`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 1 } : undefined, forceRevealSpoilers)}
          </a>,
        );
      } else {
        nodes.push(...renderDecoratedText(raw, key, match.index, location));
      }
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(raw.slice(2, -2), `${key}-strong`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 2 } : undefined, forceRevealSpoilers)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(raw.slice(1, -1), `${key}-em`, location ? { ...location, sourceColumn: location.sourceColumn + match.index + 1 } : undefined, forceRevealSpoilers)}</em>);
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) nodes.push(...renderDecoratedText(source.slice(cursor), keyPrefix, cursor, location));
  return nodes;
}

export function setMarkdownTaskState(markdown: string, sourceLine: number, state: MarkdownTaskState): string {
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

export function setMarkdownTaskChecked(markdown: string, sourceLine: number, checked: boolean): string {
  return setMarkdownTaskState(markdown, sourceLine, checked ? "checked" : "unchecked");
}

function setMarkdownTableTaskState(markdown: string, sourceLine: number, sourceColumn: number, state: MarkdownTaskState): string {
  if (!Number.isInteger(sourceLine) || !Number.isInteger(sourceColumn) || sourceLine < 0 || sourceColumn < 0) return markdown;
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined || !/^\[[ xX-]\]$/.test(line.slice(sourceColumn, sourceColumn + 3))) return markdown;

  parts[lineIndex] = `${line.slice(0, sourceColumn + 1)}${state === "checked" ? "x" : state === "indeterminate" ? "-" : " "}${line.slice(sourceColumn + 2)}`;
  return parts.join("");
}

function markdownSingleLine(value: string): string {
  return value.replace(/\r\n|\r|\n/g, " ");
}

function findListItem(
  blocks: readonly MarkdownBlock[],
  sourceLine: number,
  predicate: (item: MarkdownListItem) => boolean,
): MarkdownListItem | null {
  const findInBlock = (block: MarkdownBlock): MarkdownListItem | null => {
    for (const item of block.items ?? []) {
      if (item.sourceLine === sourceLine && predicate(item)) return item;
      for (const child of item.children) {
        const match = findInBlock(child);
        if (match) return match;
      }
    }
    return null;
  };

  for (const block of blocks) {
    const match = findInBlock(block);
    if (match) return match;
  }
  return null;
}

function preferredMarkdownEol(lines: readonly MarkdownSourceLine[], lineIndex: number): string {
  if (lines[lineIndex]?.eol) return lines[lineIndex].eol;
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    if (lines[index].eol) return lines[index].eol;
  }
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    if (lines[index].eol) return lines[index].eol;
  }
  return "\n";
}

export function insertMarkdownOpenChecklistItem(markdown: string, markerSourceLine: number, value: string): string {
  const singleLineValue = markdownSingleLine(value);
  if (!singleLineValue.trim()) return markdown;

  const marker = findListItem(parseMarkdownBlocks(markdown), markerSourceLine, (item) => item.openMarker);
  const sourceLines = splitMarkdownSourceLines(markdown);
  const sourceLine = sourceLines[markerSourceLine];
  if (
    !marker
    || !sourceLine
    || marker.sourceLineStart !== sourceLine.start
    || marker.sourceTextEnd !== sourceLine.start + sourceLine.content.length
    || markdown.slice(marker.sourceTextStart, marker.sourceTextEnd).trim() !== "..."
  ) return markdown;

  const prefix = markdown.slice(marker.sourceLineStart, marker.sourceTextStart);
  const insertedLine = `${prefix}${singleLineValue}${preferredMarkdownEol(sourceLines, markerSourceLine)}`;
  return `${markdown.slice(0, marker.sourceLineStart)}${insertedLine}${markdown.slice(marker.sourceLineStart)}`;
}

export function setMarkdownTaskItemText(markdown: string, sourceLine: number, value: string): string {
  const item = findListItem(
    parseMarkdownBlocks(markdown),
    sourceLine,
    (candidate) => candidate.taskState !== undefined && !candidate.openMarker,
  );
  if (
    !item
    || item.sourceTextStart < item.sourceLineStart
    || item.sourceTextEnd < item.sourceTextStart
    || markdown.slice(item.sourceTextStart, item.sourceTextEnd) !== item.firstLineValue
  ) return markdown;

  const singleLineValue = markdownSingleLine(value);
  const prefix = markdown.slice(item.sourceLineStart, item.sourceTextStart);
  const missingTaskSeparator = Boolean(singleLineValue) && prefix.endsWith("]");
  return `${markdown.slice(0, item.sourceTextStart)}${missingTaskSeparator ? " " : ""}${singleLineValue}${markdown.slice(item.sourceTextEnd)}`;
}


export interface MarkdownViewProps {
  markdown: string;
  completedChecklistFilterEnabled?: boolean;
  completedChecklistFilterRevision?: number;
  completedChecklistFilterSnapshot?: CompletedChecklistFilterSnapshot;
  completedChecklistRevealedItemIds?: ReadonlySet<string>;
  completedChecklistRevealedSectionIds?: ReadonlySet<string>;
  className?: string;
  firstHeadingPortalTarget?: Element | null;
  collapsedChecklistSections?: readonly string[];
  decorations?: readonly MarkdownDecoration[];
  inlineChanges?: readonly RenderedInlineChange[];
  emptyText?: string;
  onCollapsedChecklistSectionsChange?: (sections: string[]) => void;
  onRevealCompletedChecklistItems?: (structuralIds: readonly string[]) => void;
  onRevealCompletedChecklistSections?: (collapseIds: readonly string[]) => void;
  onTaskChange?: (markdown: string) => void;
  onTaskCheckboxChange?: (markdown: string) => void;
  rowChanges?: readonly RenderedRowChange[];
  taskChanges?: readonly RenderedTaskChange[];
  taskChangesDisabled?: boolean;
}

interface MarkdownSingleLineEditorProps {
  ariaLabel: string;
  initialValue: string;
  onCancel: () => void;
  onCommit: (value: string) => void;
}

function MarkdownSingleLineEditor({ ariaLabel, initialValue, onCancel, onCommit }: MarkdownSingleLineEditorProps) {
  const [value, setValue] = useState(initialValue);
  const pasteSingleLine = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData("text/plain");
    if (!/[\r\n]/.test(pasted)) return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart ?? value.length;
    const end = event.currentTarget.selectionEnd ?? start;
    setValue(`${value.slice(0, start)}${markdownSingleLine(pasted)}${value.slice(end)}`);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onCommit(value);
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      autoFocus
      className="markdown-task-inline-input"
      onChange={(event) => setValue(markdownSingleLine(event.currentTarget.value))}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onPaste={pasteSingleLine}
      type="text"
      value={value}
    />
  );
}

type ActiveMarkdownTaskEditor =
  | { baseMarkdown: string; kind: "add"; sourceLine: number }
  | { baseMarkdown: string; initialValue: string; kind: "edit"; sourceLine: number };

function checklistProgressLabel(progress: ChecklistProgress): string {
  return progress.open
    ? `Выполнено ${progress.checked}, общее количество неизвестно`
    : `Выполнено ${progress.checked} из ${progress.total}`;
}

function ChecklistProgressView({ progress }: { progress: ChecklistProgress }) {
  return (
    <span aria-label={checklistProgressLabel(progress)} className="markdown-checklist-progress">
      {progress.checked}/{progress.open ? "?" : progress.total}
    </span>
  );
}

function blockContainsIndeterminateTask(block: MarkdownBlock): boolean {
  if (block.type === "list" || block.type === "ordered-list") {
    return (block.items ?? []).some((item) =>
      item.taskState === "indeterminate" || item.children.some(blockContainsIndeterminateTask),
    );
  }
  if (block.type === "table") {
    return (block.table?.sections ?? []).some((section) =>
      section.rows.some((row) => row.cells.some((cell) => cell.taskState === "indeterminate")),
    );
  }
  return false;
}

function directIndeterminateSubsectionIndexes(blocks: readonly MarkdownBlock[]): Set<number> {
  const indexes = new Set<number>();
  for (let headingIndex = 0; headingIndex < blocks.length; headingIndex += 1) {
    const heading = blocks[headingIndex];
    if (heading.type !== "heading" || !heading.checklistProgress || (heading.depth ?? 0) < 2) continue;
    for (let blockIndex = headingIndex + 1; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex];
      if (block.type === "heading") {
        break;
      }
      if (blockContainsIndeterminateTask(block)) {
        indexes.add(headingIndex);
        break;
      }
    }
  }
  return indexes;
}

function taskStateLabel(state: MarkdownTaskState): string {
  return state === "checked" ? "Снять отметку" : "Отметить";
}

function completedChecklistIdsFingerprint(ids: ReadonlySet<string>, effectiveIds: ReadonlySet<string>): string {
  return [...ids].filter((id) => effectiveIds.has(id)).sort().join("\u0000");
}

function completedChecklistSnapshotFingerprint(snapshot: CompletedChecklistFilterSnapshot): string {
  return `${[...snapshot.hiddenListItemStructuralIds].sort().join("\u0000")}\u0001${[...snapshot.hiddenSectionCollapseIds].sort().join("\u0000")}`;
}

function completedChecklistListMotionOwnerId(items: readonly MarkdownListItem[]): string {
  return `list:${items.map((item) => item.structuralId ?? `line:${item.sourceLine}`).join(":")}`;
}

function completedChecklistSectionMotionOwnerId(collapseId: string): string {
  return `section:${collapseId}`;
}

function collapsedChecklistSectionsFingerprint(ids: readonly string[]): string {
  return [...ids].sort().join("\u0000");
}

function MarkdownTaskCheckbox({
  state,
  ...props
}: Omit<ComponentPropsWithoutRef<"input">, "checked" | "type"> & { state: MarkdownTaskState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = state === "indeterminate";
  }, [state]);
  return (
    <input
      {...props}
      aria-checked={state === "indeterminate" ? "mixed" : undefined}
      checked={state === "checked"}
      className={`${props.className ?? ""}${state === "indeterminate" ? " markdown-task-checkbox--indeterminate" : ""}`}
      ref={inputRef}
      type="checkbox"
    />
  );
}

function TaskDiffControl({ change }: { change: RenderedTaskChange }) {
  const label = (position: "before" | "after", state: MarkdownTaskState): string => {
    const prefix = position === "before" ? "Было" : "Стало";
    return `${prefix} ${state === "checked" ? "отмечено" : state === "indeterminate" ? "частично отмечено" : "не отмечено"}`;
  };
  return (
    <span className="markdown-diff-task-change">
      <MarkdownTaskCheckbox
        aria-label={label("before", change.beforeState)}
        className="markdown-task-checkbox"
        disabled
        readOnly
        state={change.beforeState}
      />
      <span aria-hidden="true" className="markdown-diff-inline-arrow">→</span>
      <MarkdownTaskCheckbox
        aria-label={label("after", change.afterState)}
        className="markdown-task-checkbox"
        disabled
        readOnly
        state={change.afterState}
      />
    </span>
  );
}

function MarkdownRenderBody({ markdown, className = "", collapsedChecklistSections = [], completedChecklistFilterEnabled = false, completedChecklistFilterRevision = 0, completedChecklistFilterSnapshot: providedCompletedChecklistFilterSnapshot, completedChecklistRevealedItemIds = new Set(), completedChecklistRevealedSectionIds = new Set(), decorations, firstHeadingPortalTarget, inlineChanges = [], emptyText = "Текста пока нет", onCollapsedChecklistSectionsChange, onRevealCompletedChecklistItems, onRevealCompletedChecklistSections, onTaskChange, onTaskCheckboxChange, rowChanges = [], taskChanges = [], taskChangesDisabled = false }: MarkdownViewProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);
  const latestBlocksRef = useRef(blocks);
  latestBlocksRef.current = blocks;
  const completedChecklistFilterSnapshot = useMemo(
    () => providedCompletedChecklistFilterSnapshot ?? (completedChecklistFilterEnabled
      ? createCompletedChecklistFilterSnapshot(latestBlocksRef.current)
      : emptyCompletedChecklistFilterSnapshot()),
    [completedChecklistFilterEnabled, completedChecklistFilterRevision, providedCompletedChecklistFilterSnapshot],
  );
  const completedChecklistMotionMarkupEnabled = completedChecklistFilterEnabled || Boolean(onRevealCompletedChecklistItems || onRevealCompletedChecklistSections);
  const checklistCollapseMotionMarkupEnabled = Boolean(onCollapsedChecklistSectionsChange)
    && !decorations?.length
    && !inlineChanges.length
    && !rowChanges.length
    && !taskChanges.length;
  const markdownMotionRoot = useRef<HTMLDivElement>(null);
  useCompletedChecklistMotion(markdownMotionRoot, {
    enabled: completedChecklistFilterEnabled,
    revision: completedChecklistFilterRevision,
    revealedItemIdsFingerprint: completedChecklistIdsFingerprint(completedChecklistRevealedItemIds, completedChecklistFilterSnapshot.hiddenListItemStructuralIds),
    revealedSectionIdsFingerprint: completedChecklistIdsFingerprint(completedChecklistRevealedSectionIds, completedChecklistFilterSnapshot.hiddenSectionCollapseIds),
    snapshotFingerprint: completedChecklistSnapshotFingerprint(completedChecklistFilterSnapshot),
  });
  useMarkdownChecklistCollapseMotion(
    markdownMotionRoot,
    collapsedChecklistSectionsFingerprint(collapsedChecklistSections),
    markdown,
    firstHeadingPortalTarget ?? null,
  );
  const indeterminateSubsectionIndexes = useMemo(() => directIndeterminateSubsectionIndexes(blocks), [blocks]);
  const firstTopLevelHeadingIndex = blocks[0]?.type === "heading" && blocks[0].depth === 1 ? 0 : -1;
  const collapseDomIdPrefix = useId();
  const [activeTaskEditor, setActiveTaskEditor] = useState<ActiveMarkdownTaskEditor | null>(null);
  const taskTextEditingAvailable = Boolean(onTaskChange);
  const taskCheckboxChangesAvailable = Boolean(onTaskChange || onTaskCheckboxChange);
  const saveCheckboxChange = (nextMarkdown: string) => {
    if (onTaskCheckboxChange) onTaskCheckboxChange(nextMarkdown);
    else onTaskChange?.(nextMarkdown);
  };
  const taskChangeAt = (sourceLine: number, sourceColumn?: number): RenderedTaskChange | undefined =>
    taskChanges.find((change) =>
      change.sourceLine === sourceLine
      && (change.sourceColumn === undefined || sourceColumn === undefined || change.sourceColumn === sourceColumn),
    );
  const visualDecoration = (sourceLine: number): MarkdownDecoration | undefined => decorations?.find(
    (decoration) => sourceLine >= decoration.startLine && sourceLine <= decoration.endLine,
  );
  const diffVisualAttributes = (sourceLine?: number, evidence?: string) => {
    if ((!decorations && !rowChanges.length) || sourceLine === undefined) return {};
    const rowChange = rowChanges.find((change) => change.sourceLine === sourceLine);
    const decoration = visualDecoration(sourceLine);
    const label = rowChange?.label ?? decoration?.label;
    const kind = rowChange?.kind ?? decoration?.kind ?? "context";
    return {
      "aria-label": label && evidence && kind !== "modified" ? `${label}: ${evidence}` : label,
      "data-diff-kind": kind,
      "data-testid": "diff-visual-row",
    };
  };
  const locatedInline = (value: string, key: string, location?: MarkdownTextLocation, forceRevealSpoilers = false): ReactNode[] =>
    renderInline(
      value,
      key,
      location && (decorations || inlineChanges.length) ? {
        decorations: decorations ?? [],
        inlineChanges,
        renderedInlineChangeIds: new Set(),
        ...location,
      } : undefined,
      forceRevealSpoilers,
    );
  const locatedLines = (value: string, key: string, locations: readonly MarkdownTextLocation[] = [], forceRevealSpoilers = false): ReactNode => {
    if (!decorations && !inlineChanges.length) return renderInline(value, key, undefined, forceRevealSpoilers);
    const lines = value.split("\n");
    return lines.map((line, index) => (
      <Fragment key={`${key}-line-${index}`}>
        <span
          className="markdown-diff-rendered-line"
          {...diffVisualAttributes(locations[index]?.sourceLine, line)}
        >
          {locatedInline(line, `${key}-line-${index}`, locations[index], forceRevealSpoilers)}
        </span>
        {index < lines.length - 1 ? <br /> : null}
      </Fragment>
    ));
  };
  useEffect(() => {
    if (activeTaskEditor && (!taskTextEditingAvailable || activeTaskEditor.baseMarkdown !== markdown)) {
      setActiveTaskEditor(null);
    }
  }, [activeTaskEditor, markdown, taskTextEditingAvailable]);
  if (!blocks.length) return <p className={`markdown-empty ${className}`}>{emptyText}</p>;

  const collapsedSections = new Set(collapsedChecklistSections);
  const checklistCollapseMotionAttributes = (key: string, owner?: string) => ({
    "data-checklist-collapse-motion-key": checklistCollapseMotionMarkupEnabled ? key : undefined,
    "data-checklist-collapse-motion-owner": checklistCollapseMotionMarkupEnabled ? owner : undefined,
  });
  const checklistCollapseMotionTriggerAttributes = (collapseId?: string) => ({
    "data-checklist-collapse-motion-trigger": checklistCollapseMotionMarkupEnabled ? collapseId : undefined,
  });
  const completedChecklistItemIsEffectivelyHidden = (item: MarkdownListItem): boolean =>
    completedChecklistFilterEnabled
    && completedChecklistItemIsHidden(completedChecklistFilterSnapshot, item)
    && Boolean(item.structuralId && !completedChecklistRevealedItemIds.has(item.structuralId));
  const completedChecklistSectionIsEffectivelyHidden = (block: MarkdownBlock): boolean =>
    completedChecklistFilterEnabled
    && completedChecklistSectionIsHidden(completedChecklistFilterSnapshot, block)
    && Boolean(block.collapseId && !completedChecklistRevealedSectionIds.has(block.collapseId));
  const validCollapseIds = new Set<string>();
  const collectListCollapseIds = (block: MarkdownBlock): void => {
    for (const item of block.items ?? []) {
      if (item.collapseId) validCollapseIds.add(item.collapseId);
      for (const child of item.children) collectListCollapseIds(child);
    }
  };
  for (const block of blocks) {
    if (block.type === "heading" && block.checklistProgress && block.collapseId) validCollapseIds.add(block.collapseId);
    if (block.type === "list" || block.type === "ordered-list") collectListCollapseIds(block);
    if (block.type === "table") {
      for (const section of block.table?.sections ?? []) {
        if (section.type === "group" && section.collapseId) validCollapseIds.add(section.collapseId);
      }
    }
  }
  const toggleChecklistSection = (collapseId: string): void => {
    if (!onCollapsedChecklistSectionsChange || taskChangesDisabled) return;
    const next = new Set(collapsedChecklistSections.filter((id) => validCollapseIds.has(id)));
    if (next.has(collapseId)) next.delete(collapseId);
    else next.add(collapseId);
    onCollapsedChecklistSectionsChange([...next].sort());
  };

  const collapsedHeadingItemCount = (headingIndex: number, headingDepth: number, progress: ChecklistProgress): number => {
    let childHeadingCount = 0;
    for (let index = headingIndex + 1; index < blocks.length; index += 1) {
      const candidate = blocks[index];
      if (candidate.type !== "heading") continue;
      const candidateDepth = candidate.depth ?? 0;
      if (candidateDepth <= headingDepth) break;
      if (candidateDepth === headingDepth + 1 && candidate.checklistProgress) childHeadingCount += 1;
    }
    return childHeadingCount || progress.total;
  };

  const renderList = (
    block: MarkdownBlock,
    key: string,
    collapseMotionOwners: { container?: string; rows?: string } = {},
  ): ReactNode => {
    const Tag = block.type === "list" ? "ul" : "ol";
    const listOwnerId = completedChecklistMotionMarkupEnabled ? completedChecklistListMotionOwnerId(block.items ?? []) : undefined;
    const motionAttributes = (item: MarkdownListItem) => ({
      "data-completed-checklist-motion-key": listOwnerId ? item.structuralId : undefined,
      "data-completed-checklist-motion-target": listOwnerId && item.structuralId ? listOwnerId : undefined,
    });
    const hiddenItemStructuralIds = completedChecklistFilterEnabled
      ? (block.items ?? []).flatMap((item) => completedChecklistItemIsEffectivelyHidden(item) && item.structuralId ? [item.structuralId] : [])
      : [];
    return (
      <Tag key={key} {...(collapseMotionOwners.container ? checklistCollapseMotionAttributes(`list:${key}`, collapseMotionOwners.container) : {})}>
        {block.items?.map((item, itemIndex) => {
          const itemKey = `${key}-${item.sourceLine}-${itemIndex}`;
          if (completedChecklistItemIsEffectivelyHidden(item)) return null;
          const children = item.children.map((child, childIndex) => renderList(
            child,
            `${itemKey}-child-${childIndex}`,
            { rows: item.collapseId },
          ));
          const collapseMotionRowAttributes = checklistCollapseMotionAttributes(
            `list-item:${item.structuralId ?? itemKey}`,
            collapseMotionOwners.rows,
          );
          if (item.openMarker) {
            if (!taskTextEditingAvailable) return null;
            const adding = activeTaskEditor?.kind === "add" && activeTaskEditor.sourceLine === item.sourceLine;
            return (
              <li className="markdown-open-checklist-marker" key={itemKey} {...motionAttributes(item)} {...collapseMotionRowAttributes}>
                {adding ? (
                  <MarkdownSingleLineEditor
                    ariaLabel="Новый пункт чеклиста"
                    initialValue=""
                    key={`${itemKey}-input`}
                    onCancel={() => setActiveTaskEditor(null)}
                    onCommit={(value) => {
                      if (activeTaskEditor.baseMarkdown !== markdown) {
                        setActiveTaskEditor(null);
                        return;
                      }
                      const nextMarkdown = insertMarkdownOpenChecklistItem(markdown, item.sourceLine, value);
                      setActiveTaskEditor(null);
                      if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                    }}
                  />
                ) : (
                  <button
                    aria-label="Добавить пункт чеклиста"
                    className="markdown-open-checklist-add"
                    disabled={taskChangesDisabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (taskChangesDisabled) return;
                      setActiveTaskEditor({ baseMarkdown: markdown, kind: "add", sourceLine: item.sourceLine });
                    }}
                    type="button"
                  >Добавить</button>
                )}
                {children}
              </li>
            );
          }
          if (item.taskState === undefined) {
            const progress = item.checklistProgress;
            if (!progress) return <li key={itemKey} {...motionAttributes(item)} {...collapseMotionRowAttributes}>{locatedLines(item.value, itemKey, item.sourceLocations)}{children}</li>;
            const complete = !progress.open && progress.checked === progress.total;
            const collapseId = item.collapseId;
            const collapsed = Boolean(collapseId && collapsedSections.has(collapseId));
            const contentId = collapseId ? `${collapseDomIdPrefix}-markdown-${collapseId}-content` : undefined;
            const headerChildren = <>
              <span className="markdown-checklist-group__title">{locatedLines(item.value, itemKey, item.sourceLocations)}</span>{" "}
              <ChecklistProgressView progress={progress} />
            </>;
            return (
              <li
                className={`markdown-checklist-group${complete ? " markdown-checklist-group--complete" : ""}${collapsed ? " markdown-checklist-group--collapsed" : ""}`}
                data-checklist-section-id={collapseId}
                data-markdown-source-line={item.sourceLine}
                key={itemKey}
                {...motionAttributes(item)}
                {...collapseMotionRowAttributes}
              >
                {onCollapsedChecklistSectionsChange && collapseId ? (
                  <button aria-controls={contentId} aria-expanded={!collapsed} className="markdown-checklist-group__header markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} type="button" {...checklistCollapseMotionTriggerAttributes(collapseId)}>{headerChildren}</button>
                ) : <div className="markdown-checklist-group__header">{headerChildren}</div>}
                <div className="markdown-checklist-group__content" hidden={collapsed} id={contentId}>{children}</div>
              </li>
            );
          }
          const editing = activeTaskEditor?.kind === "edit" && activeTaskEditor.sourceLine === item.sourceLine;
          const forceRevealSpoilers = Boolean(item.taskState === "checked" && markdownIsSingleSpoiler(item.value));
          const taskLabel = markdownTaskLabel(item.firstLineValue, forceRevealSpoilers) || "пункт";
          const taskChange = taskChangeAt(item.sourceLine, item.taskSourceColumn);
          return (
            <li className={`markdown-task-item${item.taskState === "checked" ? " markdown-task-item--checked" : ""}${item.taskState === "indeterminate" ? " markdown-task-item--indeterminate" : ""}`} key={itemKey} {...motionAttributes(item)} {...collapseMotionRowAttributes}>
              <div className="markdown-task-row">
                {taskChange ? <TaskDiffControl change={taskChange} /> : (
                  <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                    <MarkdownTaskCheckbox
                      aria-disabled={taskChangesDisabled || undefined}
                      aria-label={`${taskStateLabel(item.taskState)}: ${taskLabel}`}
                      className="markdown-task-checkbox"
                      disabled={!taskCheckboxChangesAvailable || activeTaskEditor !== null}
                      onChange={(event) => {
                        if (taskChangesDisabled) return;
                        if ((event.nativeEvent as MouseEvent).metaKey) return;
                        const nextMarkdown = setMarkdownTaskState(markdown, item.sourceLine, event.currentTarget.checked ? "checked" : "unchecked");
                        if (nextMarkdown !== markdown) saveCheckboxChange(nextMarkdown);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (taskChangesDisabled) event.preventDefault();
                        if (event.metaKey && !taskChangesDisabled) {
                          event.preventDefault();
                          const nextMarkdown = setMarkdownTaskState(markdown, item.sourceLine, "indeterminate");
                          if (nextMarkdown !== markdown) saveCheckboxChange(nextMarkdown);
                        }
                      }}
                      state={item.taskState}
                    />
                  </label>
                )}
                <span className="markdown-task-content">
                  {editing ? (
                    <MarkdownSingleLineEditor
                      ariaLabel={`Текст пункта: ${taskLabel}`}
                      initialValue={activeTaskEditor.initialValue}
                      key={`${itemKey}-input`}
                      onCancel={() => setActiveTaskEditor(null)}
                      onCommit={(value) => {
                        if (activeTaskEditor.baseMarkdown !== markdown) {
                          setActiveTaskEditor(null);
                          return;
                        }
                        const nextMarkdown = setMarkdownTaskItemText(markdown, item.sourceLine, value);
                        setActiveTaskEditor(null);
                        if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                      }}
                    />
                  ) : locatedLines(item.value, itemKey, item.sourceLocations, forceRevealSpoilers)}
                </span>
                {taskTextEditingAvailable && !editing ? (
                  <button
                    aria-label={`Редактировать пункт: ${taskLabel}`}
                    className="markdown-task-edit-button"
                    disabled={taskChangesDisabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (taskChangesDisabled) return;
                      setActiveTaskEditor({ baseMarkdown: markdown, initialValue: item.firstLineValue, kind: "edit", sourceLine: item.sourceLine });
                    }}
                    title="Редактировать пункт"
                    type="button"
                  ><Icon name="edit" size={13} /></button>
                ) : null}
              </div>
              {children}
            </li>
          );
        })}
        {hiddenItemStructuralIds.length ? <li aria-live="off" className="markdown-checklist-hidden-count" data-completed-checklist-motion-summary={listOwnerId}><button onClick={() => onRevealCompletedChecklistItems?.(hiddenItemStructuralIds)} type="button">Скрыто {hiddenItemStructuralIds.length} пунктов</button></li> : null}
      </Tag>
    );
  };

  const renderTable = (block: MarkdownBlock, key: string, collapseMotionOwner?: string): ReactNode => {
    const table = block.table;
    if (!table) return null;
    const alignmentClass = (index: number) => table.alignments[index] ? `markdown-table-cell--${table.alignments[index]}` : undefined;
    const rows = table.sections.flatMap((section) => section.rows);
    const completedColumns = table.headers.map((_header, cellIndex) => {
      const taskCells = rows
        .map((row) => row.cells[cellIndex])
        .filter((cell) => cell?.taskState !== undefined);
      return taskCells.length > 0 && taskCells.every((cell) => cell.taskState === "checked");
    });

    const renderTableRow = (row: MarkdownTableRow, rowIndex: number, rowKey: string, rowCollapseMotionOwner?: string): ReactNode => {
      const progress = getTableRowProgress(row);
      const rowComplete = progress.total > 0 && progress.checked === progress.total;
      const rowIndeterminate = row.cells.some((cell) => cell.taskState === "indeterminate");
      const rowLabel = row.cells.map((cell) => markdownTaskLabel(cell.sourceValue ?? cell.value, false)).find(Boolean);
      const rowTaskLabel = rowLabel || `строка ${rowIndex + 1}`;
      return (
        <tr
          className={`${rowComplete ? "markdown-table-row--complete" : ""}${rowIndeterminate ? " markdown-table-row--indeterminate" : ""}`.trim() || undefined}
          key={`${rowKey}-row-${row.sourceLine}`}
          {...diffVisualAttributes(row.sourceLine, row.cells.map((cell) => cell.value).join(" | "))}
          {...checklistCollapseMotionAttributes(`table-row:${rowKey}:${row.sourceLine}`, rowCollapseMotionOwner)}
        >
          {row.cells.map((cell, cellIndex) => {
            const cellKey = `${rowKey}-row-${row.sourceLine}-cell-${cellIndex}`;
            const inlineSource = cell.sourceValue ?? cell.value;
            if (cell.taskState === undefined) {
              return <td className={alignmentClass(cellIndex)} data-checklist-column-complete={completedColumns[cellIndex] || undefined} key={cellKey}>{locatedInline(inlineSource, cellKey, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine })}</td>;
            }
            const forceRevealSpoilers = Boolean(cell.taskState === "checked" && markdownIsSingleSpoiler(inlineSource));
            const columnLabel = markdownTaskLabel(table.headers[cellIndex]?.sourceValue ?? table.headers[cellIndex]?.value ?? "", false);
            const cellLabel = markdownTaskLabel(inlineSource, forceRevealSpoilers);
            const taskLabel = cellLabel || [rowTaskLabel, columnLabel].filter(Boolean).join(" — ") || `строка ${rowIndex + 1}, столбец ${cellIndex + 1}`;
            const taskChange = taskChangeAt(row.sourceLine, cell.taskSourceColumn);
            return (
              <td className={alignmentClass(cellIndex)} data-checklist-checked={cell.taskState === "checked" || undefined} data-checklist-indeterminate={cell.taskState === "indeterminate" || undefined} data-checklist-column-complete={completedColumns[cellIndex] || undefined} key={cellKey}>
                <div className={`markdown-table-task${cell.value ? "" : " markdown-table-task--only"}`}>
                  {taskChange ? <TaskDiffControl change={taskChange} /> : (
                    <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                      <MarkdownTaskCheckbox
                        aria-disabled={taskChangesDisabled || undefined}
                        aria-label={`${taskStateLabel(cell.taskState)}: ${taskLabel}`}
                        className="markdown-task-checkbox"
                        disabled={!taskCheckboxChangesAvailable || activeTaskEditor !== null}
                        onChange={(event) => {
                          if (taskChangesDisabled) return;
                          if ((event.nativeEvent as MouseEvent).metaKey) return;
                          if (cell.taskSourceColumn === undefined) return;
                          const nextMarkdown = setMarkdownTableTaskState(markdown, row.sourceLine, cell.taskSourceColumn, event.currentTarget.checked ? "checked" : "unchecked");
                          if (nextMarkdown !== markdown) saveCheckboxChange(nextMarkdown);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (taskChangesDisabled) event.preventDefault();
                          if (event.metaKey && !taskChangesDisabled && cell.taskSourceColumn !== undefined) {
                            event.preventDefault();
                            const nextMarkdown = setMarkdownTableTaskState(markdown, row.sourceLine, cell.taskSourceColumn, "indeterminate");
                            if (nextMarkdown !== markdown) saveCheckboxChange(nextMarkdown);
                          }
                        }}
                        state={cell.taskState}
                      />
                    </label>
                  )}
                  {cell.value ? <span>{locatedInline(inlineSource, `${cellKey}-content`, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine }, forceRevealSpoilers)}</span> : null}
                </div>
              </td>
            );
          })}
        </tr>
      );
    };

    return (
      <div className="markdown-table-scroll" key={key} {...checklistCollapseMotionAttributes(`table:${key}`, collapseMotionOwner)}>
        <table className="markdown-table">
          <thead>
            <tr {...diffVisualAttributes(table.headers[0]?.sourceLine, table.headers.map((header) => header.value).join(" | "))}>
              {table.headers.map((cell, cellIndex) => (
                <th data-checklist-column-complete={completedColumns[cellIndex] || undefined} key={`${key}-header-${cellIndex}`} scope="col">
                  {locatedInline(cell.sourceValue ?? cell.value, `${key}-header-${cellIndex}`, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine })}
                </th>
              ))}
            </tr>
          </thead>
          {table.sections.map((section, sectionIndex) => {
            if (section.type === "rows") {
              return (
                <tbody key={`${key}-rows-${sectionIndex}`}>
                  {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, `${key}-rows-${sectionIndex}`))}
                </tbody>
              );
            }
            const progress = section.checklistProgress;
            const complete = Boolean(progress && progress.total > 0 && progress.checked === progress.total);
            const collapseId = section.collapseId;
            const collapsed = Boolean(collapseId && collapsedSections.has(collapseId));
            const contentId = collapseId ? `${collapseDomIdPrefix}-markdown-${collapseId}-content` : undefined;
            const groupKey = `${key}-group-${section.titleSourceLine}`;
            const headerChildren = <>
              <span className="markdown-table-group__title">
                {locatedInline(section.title.sourceValue ?? section.title.value, `${groupKey}-title`, section.title.sourceLine === undefined || section.title.sourceColumn === undefined ? undefined : { sourceColumn: section.title.sourceColumn, sourceLine: section.title.sourceLine })}
              </span>{" "}
              {progress ? <ChecklistProgressView progress={progress} /> : null}
            </>;
            return (
              <Fragment key={groupKey}>
                <tbody
                  className={`markdown-table-group${complete ? " markdown-table-group--complete" : ""}`}
                  data-checklist-section-id={collapseId}
                  data-markdown-source-line={section.titleSourceLine}
                >
                  <tr className="markdown-table-group__heading" {...diffVisualAttributes(section.titleSourceLine, section.title.value)}>
                    <th colSpan={table.headers.length} scope="rowgroup">
                      {onCollapsedChecklistSectionsChange && collapseId ? (
                        <button
                          aria-controls={contentId}
                          aria-expanded={!collapsed}
                          className="markdown-table-group__header markdown-checklist-toggle"
                          disabled={taskChangesDisabled}
                          onClick={() => toggleChecklistSection(collapseId)}
                          type="button"
                          {...checklistCollapseMotionTriggerAttributes(collapseId)}
                          {...checklistCollapseMotionAttributes(`table-group-heading:${collapseId ?? groupKey}`)}
                        >
                          {headerChildren}
                        </button>
                      ) : <div className="markdown-table-group__header" {...checklistCollapseMotionAttributes(`table-group-heading:${collapseId ?? groupKey}`)}>{headerChildren}</div>}
                    </th>
                  </tr>
                </tbody>
                <tbody className="markdown-table-group__content" hidden={collapsed} id={contentId}>
                  {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, groupKey, collapseId))}
                </tbody>
              </Fragment>
            );
          })}
        </table>
      </div>
    );
  };

  let hiddenHeadingDepth: number | null = null;
  let filteredHeadingDepth: number | null = null;
  const renderBlock = (block: MarkdownBlock, index: number, collapseMotionOwner?: string): ReactNode => {
    const key = `${block.type}-${index}`;
    if (block.type === "heading") {
      const depth = block.depth ?? 0;
      if (filteredHeadingDepth !== null) {
        if (depth > filteredHeadingDepth) return null;
        filteredHeadingDepth = null;
      }
      if (completedChecklistSectionIsEffectivelyHidden(block)) {
        filteredHeadingDepth = depth;
        return null;
      }
      if (hiddenHeadingDepth !== null) {
        if (depth > hiddenHeadingDepth) return null;
        hiddenHeadingDepth = null;
      }
    } else if (hiddenHeadingDepth !== null || filteredHeadingDepth !== null) {
      return null;
    }
    if (block.type === "code") return <pre key={key} {...checklistCollapseMotionAttributes(`block:${key}`, collapseMotionOwner)}><code>{block.value}</code></pre>;
    if (block.type === "rule") return <hr key={key} {...checklistCollapseMotionAttributes(`block:${key}`, collapseMotionOwner)} />;
    if (block.type === "quote") {
      return <blockquote key={key} {...checklistCollapseMotionAttributes(`block:${key}`, collapseMotionOwner)}>{locatedLines(block.value ?? "", key, block.sourceLocations)}</blockquote>;
    }
    if (block.type === "list" || block.type === "ordered-list") {
      return renderList(block, key, { container: collapseMotionOwner });
    }
    if (block.type === "table") return renderTable(block, key, collapseMotionOwner);
    if (block.type === "heading") {
      const children = locatedLines(block.value ?? "", key, block.sourceLocations);
      const progress = block.checklistProgress;
      const collapseId = block.collapseId;
      const collapsed = Boolean(progress && collapseId && collapsedSections.has(collapseId));
      if (collapsed) hiddenHeadingDepth = block.depth ?? 0;
      const headingClassName = progress ? `markdown-checklist-heading${!progress.open && progress.checked === progress.total ? " markdown-checklist-heading--complete" : ""}${collapsed ? " markdown-checklist-heading--collapsed" : ""}` : undefined;
      const progressChildren = progress ? <><span className="markdown-checklist-heading__title">{children}</span>{" "}<ChecklistProgressView progress={progress} /></> : children;
      const collapsedItemCount = collapsed && progress ? collapsedHeadingItemCount(index, block.depth ?? 0, progress) : 0;
      const renderHeading = (variant: "inner" | "outer" | "single", headingKey: string): ReactNode => {
        const visualDuplicate = variant === "inner";
        const titleLayer = variant === "single" ? "" : ` markdown-note-title--${variant}`;
        const headingChildren = progress && collapseId && onCollapsedChecklistSectionsChange ? (
          <button aria-expanded={!collapsed} className="markdown-checklist-heading__toggle markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} tabIndex={visualDuplicate ? -1 : undefined} type="button" {...(!visualDuplicate ? checklistCollapseMotionTriggerAttributes(collapseId) : {})}>{progressChildren}</button>
        ) : progressChildren;
        const commonProps = {
          "aria-hidden": visualDuplicate || undefined,
          className: `${headingClassName ?? ""}${titleLayer}`.trim() || undefined,
          "data-checklist-section-id": progress ? collapseId : undefined,
          inert: visualDuplicate || undefined,
          ...(!progress ? checklistCollapseMotionAttributes(`block:${key}`, collapseMotionOwner) : {}),
        };
        const heading = block.depth === 1
          ? <h2 {...commonProps}>{headingChildren}</h2>
          : block.depth === 2
            ? <h3 {...commonProps}>{headingChildren}</h3>
            : <h4 {...commonProps}>{headingChildren}</h4>;
        const collapsedStateClassName = `markdown-checklist-heading__collapsed-state${block.depth && block.depth >= 3 ? " markdown-checklist-heading__collapsed-state--nested" : ""}${visualDuplicate ? " markdown-checklist-heading__collapsed-state--placeholder" : ""}`;
        return (
          <Fragment key={headingKey}>
            {heading}
            {collapsed && progress && collapseId && onCollapsedChecklistSectionsChange ? (
              <div
                aria-hidden="true"
                className={collapsedStateClassName}
                {...(!visualDuplicate ? checklistCollapseMotionAttributes(`collapsed-state:${collapseId}`, collapseId) : {})}
              >Свернуто · {collapsedItemCount} пунктов внутри</div>
            ) : null}
          </Fragment>
        );
      };
      if (index === firstTopLevelHeadingIndex && firstHeadingPortalTarget) {
        return <Fragment key={key}>{renderHeading("inner", `${key}-inner`)}{createPortal(renderHeading("outer", `${key}-outer`), firstHeadingPortalTarget)}</Fragment>;
      }
      return renderHeading("single", key);
    }
    return <p key={key} {...checklistCollapseMotionAttributes(`block:${key}`, collapseMotionOwner)}>{locatedLines(block.value ?? "", key, block.sourceLocations)}</p>;
  };

  const content: ReactNode[] = [];
  let sectionStartIndex: number | null = null;
  let sectionChildren: ReactNode[] = [];
  let hiddenSectionCollapseIds: string[] = [];
  let sectionMotionOwnerId: string | undefined;
  let sectionCollapseMotionOwner: string | undefined;
  const subsectionStack: Array<{ children: ReactNode[]; collapseId?: string; complete: boolean; depth: number; hiddenSectionCollapseIds: string[]; indeterminate: boolean; parentCollapseMotionOwner?: string; parentOwnerId?: string; startIndex: number }> = [];
  const appendSectionChild = (child: ReactNode): void => {
    const parent = subsectionStack.at(-1);
    if (parent) parent.children.push(child);
    else sectionChildren.push(child);
  };
  const closeSubsection = (): void => {
    const subsection = subsectionStack.pop();
    if (!subsection) return;
    if (subsection.hiddenSectionCollapseIds.length) {
      subsection.children.push(<div aria-live="off" className="markdown-checklist-hidden-sections markdown-checklist-hidden-sections--nested" data-completed-checklist-motion-summary={subsection.collapseId ? completedChecklistSectionMotionOwnerId(subsection.collapseId) : undefined} key={`hidden-sections-${subsection.startIndex}`}><button onClick={() => onRevealCompletedChecklistSections?.(subsection.hiddenSectionCollapseIds)} type="button">Скрыто {subsection.hiddenSectionCollapseIds.length} секций</button></div>);
    }
    appendSectionChild(
      <div
        className={`markdown-checklist-subsection${subsection.depth >= 3 ? " markdown-checklist-subsection--nested" : ""}${subsection.complete ? " markdown-checklist-subsection--complete" : ""}${subsection.indeterminate ? " markdown-checklist-subsection--indeterminate" : ""}`}
        data-completed-checklist-motion-key={completedChecklistMotionMarkupEnabled ? subsection.collapseId : undefined}
        data-completed-checklist-motion-target={completedChecklistMotionMarkupEnabled && subsection.collapseId ? subsection.parentOwnerId : undefined}
        key={`subsection-${subsection.startIndex}`}
        {...checklistCollapseMotionAttributes(
          `subsection:${subsection.collapseId ?? subsection.startIndex}`,
          subsection.parentCollapseMotionOwner,
        )}
      >
        {subsection.children}
      </div>,
    );
  };
  const closeSubsectionsAtOrBelow = (depth: number): void => {
    while (subsectionStack.length > 0 && subsectionStack.at(-1)!.depth >= depth) closeSubsection();
  };
  const flushSection = (): void => {
    if (sectionStartIndex === null) return;
    closeSubsectionsAtOrBelow(0);
    const sectionCollapseIds = hiddenSectionCollapseIds;
    if (sectionCollapseIds.length) sectionChildren.push(<div aria-live="off" className="markdown-checklist-hidden-sections" data-completed-checklist-motion-summary={sectionMotionOwnerId} key={`hidden-sections-${sectionStartIndex}`}><button onClick={() => onRevealCompletedChecklistSections?.(sectionCollapseIds)} type="button">Скрыто {sectionCollapseIds.length} секций</button></div>);
    content.push(
      <div
        className="markdown-section"
        key={`section-${sectionStartIndex}`}
        {...checklistCollapseMotionAttributes(`section:${sectionStartIndex}`)}
      >{sectionChildren}</div>,
    );
  };
  blocks.forEach((block, index) => {
    if (block.type === "heading" && block.depth === 1) {
      flushSection();
      sectionStartIndex = index;
      sectionChildren = [];
      hiddenSectionCollapseIds = [];
      sectionMotionOwnerId = completedChecklistMotionMarkupEnabled && block.collapseId ? completedChecklistSectionMotionOwnerId(block.collapseId) : undefined;
      sectionCollapseMotionOwner = block.collapseId;
    }
    const hiddenByFilteredAncestor = block.type === "heading"
      && filteredHeadingDepth !== null
      && (block.depth ?? 0) > filteredHeadingDepth;
    const collapseMotionParent = block.type === "heading"
      ? [...subsectionStack].reverse().find((subsection) => subsection.depth < (block.depth ?? 0))?.collapseId ?? sectionCollapseMotionOwner
      : subsectionStack.at(-1)?.collapseId ?? sectionCollapseMotionOwner;
    const rendered = renderBlock(block, index, collapseMotionParent);
    if (sectionStartIndex !== null && block.type === "heading" && (block.depth ?? 0) >= 2) {
      const depth = block.depth ?? 0;
      closeSubsectionsAtOrBelow(depth);
      if (completedChecklistFilterEnabled && !hiddenByFilteredAncestor && completedChecklistSectionIsEffectivelyHidden(block)) {
        const parent = subsectionStack.at(-1);
        if (parent && block.collapseId) parent.hiddenSectionCollapseIds.push(block.collapseId);
        else if (block.collapseId) hiddenSectionCollapseIds.push(block.collapseId);
      } else if (rendered !== null) {
      const progress = block.checklistProgress;
      if (progress) {
        const parentSubsection = subsectionStack.at(-1);
        subsectionStack.push({
          children: [],
          collapseId: block.collapseId,
          complete: !progress.open && progress.checked === progress.total,
          depth,
          hiddenSectionCollapseIds: [],
          indeterminate: indeterminateSubsectionIndexes.has(index),
          parentCollapseMotionOwner: parentSubsection?.collapseId ?? sectionCollapseMotionOwner,
          parentOwnerId: parentSubsection?.collapseId ? completedChecklistSectionMotionOwnerId(parentSubsection.collapseId) : sectionMotionOwnerId,
          startIndex: index,
        });
      }
      }
    }
    if (sectionStartIndex === null) content.push(rendered);
    else appendSectionChild(rendered);
  });
  flushSection();

  return (
    <div
      className={`markdown ${className}`}
      data-checklist-collapse-motion-enabled={checklistCollapseMotionMarkupEnabled || undefined}
      data-completed-checklist-motion-enabled={completedChecklistMotionMarkupEnabled && completedChecklistFilterEnabled || undefined}
      ref={markdownMotionRoot}
    >{content}</div>
  );
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return left === right || Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));
}

const MemoizedMarkdownRenderBody = memo(MarkdownRenderBody, (previous, next) => (
  previous.markdown === next.markdown
  && previous.className === next.className
  && previous.completedChecklistFilterEnabled === next.completedChecklistFilterEnabled
  && previous.completedChecklistFilterRevision === next.completedChecklistFilterRevision
  && previous.completedChecklistFilterSnapshot === next.completedChecklistFilterSnapshot
  && previous.completedChecklistRevealedItemIds === next.completedChecklistRevealedItemIds
  && previous.completedChecklistRevealedSectionIds === next.completedChecklistRevealedSectionIds
  && previous.firstHeadingPortalTarget === next.firstHeadingPortalTarget
  && previous.emptyText === next.emptyText
  && sameStrings(previous.collapsedChecklistSections, next.collapsedChecklistSections)
  && previous.decorations === next.decorations
  && previous.inlineChanges === next.inlineChanges
  && previous.rowChanges === next.rowChanges
  && previous.taskChanges === next.taskChanges
  && previous.taskChangesDisabled === next.taskChangesDisabled
  && previous.onTaskChange === next.onTaskChange
  && previous.onTaskCheckboxChange === next.onTaskCheckboxChange
  && previous.onCollapsedChecklistSectionsChange === next.onCollapsedChecklistSectionsChange
  && previous.onRevealCompletedChecklistItems === next.onRevealCompletedChecklistItems
  && previous.onRevealCompletedChecklistSections === next.onRevealCompletedChecklistSections
));

export function MarkdownView({ onTaskChange, onTaskCheckboxChange, onCollapsedChecklistSectionsChange, onRevealCompletedChecklistItems, onRevealCompletedChecklistSections, ...renderProps }: MarkdownViewProps) {
  const taskChangeRef = useRef(onTaskChange);
  const taskCheckboxChangeRef = useRef(onTaskCheckboxChange);
  const collapsedSectionsChangeRef = useRef(onCollapsedChecklistSectionsChange);
  const revealCompletedChecklistItemsRef = useRef(onRevealCompletedChecklistItems);
  const revealCompletedChecklistSectionsRef = useRef(onRevealCompletedChecklistSections);
  taskChangeRef.current = onTaskChange;
  taskCheckboxChangeRef.current = onTaskCheckboxChange;
  collapsedSectionsChangeRef.current = onCollapsedChecklistSectionsChange;
  revealCompletedChecklistItemsRef.current = onRevealCompletedChecklistItems;
  revealCompletedChecklistSectionsRef.current = onRevealCompletedChecklistSections;
  const stableTaskChange = useCallback((markdown: string) => {
    taskChangeRef.current?.(markdown);
  }, []);
  const stableTaskCheckboxChange = useCallback((markdown: string) => {
    taskCheckboxChangeRef.current?.(markdown);
  }, []);
  const stableCollapsedSectionsChange = useCallback((sections: string[]) => {
    collapsedSectionsChangeRef.current?.(sections);
  }, []);
  const stableRevealCompletedChecklistItems = useCallback((structuralIds: readonly string[]) => {
    revealCompletedChecklistItemsRef.current?.(structuralIds);
  }, []);
  const stableRevealCompletedChecklistSections = useCallback((collapseIds: readonly string[]) => {
    revealCompletedChecklistSectionsRef.current?.(collapseIds);
  }, []);

  return (
    <MemoizedMarkdownRenderBody
      {...renderProps}
      onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange ? stableCollapsedSectionsChange : undefined}
      onRevealCompletedChecklistItems={onRevealCompletedChecklistItems ? stableRevealCompletedChecklistItems : undefined}
      onRevealCompletedChecklistSections={onRevealCompletedChecklistSections ? stableRevealCompletedChecklistSections : undefined}
      onTaskChange={onTaskChange ? stableTaskChange : undefined}
      onTaskCheckboxChange={onTaskCheckboxChange ? stableTaskCheckboxChange : undefined}
    />
  );
}
