import { Children, Fragment, isValidElement, memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
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
  type MarkdownSourceLine,
  type MarkdownTableRow,
  type MarkdownTextLocation,
} from "../domain/markdownChecklist";
import { Icon } from "./Icon";
import { safeUrl } from "./libraryUi";
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
      const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/.exec(raw);
      const href = linkMatch ? safeUrl(linkMatch[2]) : null;
      if (linkMatch && href) {
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

export function setMarkdownTaskChecked(markdown: string, sourceLine: number, checked: boolean): string {
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined) return markdown;

  const nextLine = line.replace(
    /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)[ xX](\])(?=[ \t]|$)/,
    (_match, prefix: string, suffix: string) => `${prefix}${checked ? "x" : " "}${suffix}`,
  );
  if (nextLine === line) return markdown;
  parts[lineIndex] = nextLine;
  return parts.join("");
}

function setMarkdownTableTaskChecked(markdown: string, sourceLine: number, sourceColumn: number, checked: boolean): string {
  if (!Number.isInteger(sourceLine) || !Number.isInteger(sourceColumn) || sourceLine < 0 || sourceColumn < 0) return markdown;
  const parts = markdown.split(/(\r\n?|\n)/);
  const lineIndex = sourceLine * 2;
  const line = parts[lineIndex];
  if (line === undefined || !/^\[[ xX]\]$/.test(line.slice(sourceColumn, sourceColumn + 3))) return markdown;

  parts[lineIndex] = `${line.slice(0, sourceColumn + 1)}${checked ? "x" : " "}${line.slice(sourceColumn + 2)}`;
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
    (candidate) => candidate.taskChecked !== undefined && !candidate.openMarker,
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
  className?: string;
  firstHeadingPortalTarget?: Element | null;
  collapsedChecklistSections?: readonly string[];
  decorations?: readonly MarkdownDecoration[];
  inlineChanges?: readonly RenderedInlineChange[];
  emptyText?: string;
  onCollapsedChecklistSectionsChange?: (sections: string[]) => void;
  onTaskChange?: (markdown: string) => void;
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

function TaskDiffControl({ change }: { change: RenderedTaskChange }) {
  return (
    <span className="markdown-diff-task-change">
      <input
        aria-label={change.beforeChecked ? "Было отмечено" : "Было не отмечено"}
        checked={change.beforeChecked}
        className="markdown-task-checkbox"
        disabled
        readOnly
        type="checkbox"
      />
      <span aria-hidden="true" className="markdown-diff-inline-arrow">→</span>
      <input
        aria-label={change.afterChecked ? "Стало отмечено" : "Стало не отмечено"}
        checked={change.afterChecked}
        className="markdown-task-checkbox"
        disabled
        readOnly
        type="checkbox"
      />
    </span>
  );
}

function MarkdownRenderBody({ markdown, className = "", collapsedChecklistSections = [], decorations, firstHeadingPortalTarget, inlineChanges = [], emptyText = "Текста пока нет", onCollapsedChecklistSectionsChange, onTaskChange, rowChanges = [], taskChanges = [], taskChangesDisabled = false }: MarkdownViewProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);
  const firstTopLevelHeadingIndex = blocks[0]?.type === "heading" && blocks[0].depth === 1 ? 0 : -1;
  const collapseDomIdPrefix = useId();
  const [activeTaskEditor, setActiveTaskEditor] = useState<ActiveMarkdownTaskEditor | null>(null);
  const taskTextEditingAvailable = Boolean(onTaskChange);
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

  const renderList = (block: MarkdownBlock, key: string): ReactNode => {
    const Tag = block.type === "list" ? "ul" : "ol";
    return (
      <Tag key={key}>
        {block.items?.map((item, itemIndex) => {
          const itemKey = `${key}-${item.sourceLine}-${itemIndex}`;
          const children = item.children.map((child, childIndex) => renderList(child, `${itemKey}-child-${childIndex}`));
          if (item.openMarker) {
            if (!taskTextEditingAvailable) return null;
            const adding = activeTaskEditor?.kind === "add" && activeTaskEditor.sourceLine === item.sourceLine;
            return (
              <li className="markdown-open-checklist-marker" key={itemKey}>
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
          if (item.taskChecked === undefined) {
            const progress = item.checklistProgress;
            if (!progress) return <li key={itemKey}>{locatedLines(item.value, itemKey, item.sourceLocations)}{children}</li>;
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
              >
                {onCollapsedChecklistSectionsChange && collapseId ? (
                  <button aria-controls={contentId} aria-expanded={!collapsed} className="markdown-checklist-group__header markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} type="button">{headerChildren}</button>
                ) : <div className="markdown-checklist-group__header">{headerChildren}</div>}
                <div className="markdown-checklist-group__content" hidden={collapsed} id={contentId}>{children}</div>
              </li>
            );
          }
          const editing = activeTaskEditor?.kind === "edit" && activeTaskEditor.sourceLine === item.sourceLine;
          const forceRevealSpoilers = Boolean(item.taskChecked && markdownIsSingleSpoiler(item.value));
          const taskLabel = markdownTaskLabel(item.firstLineValue, forceRevealSpoilers) || "пункт";
          const taskChange = taskChangeAt(item.sourceLine, item.taskSourceColumn);
          return (
            <li className={`markdown-task-item${item.taskChecked ? " markdown-task-item--checked" : ""}`} key={itemKey}>
              <div className="markdown-task-row">
                {taskChange ? <TaskDiffControl change={taskChange} /> : (
                  <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                    <input
                      aria-disabled={taskChangesDisabled || undefined}
                      aria-label={`${item.taskChecked ? "Снять отметку" : "Отметить"}: ${taskLabel}`}
                      checked={item.taskChecked}
                      className="markdown-task-checkbox"
                      disabled={!onTaskChange || activeTaskEditor !== null}
                      onChange={(event) => {
                        if (taskChangesDisabled) return;
                        const nextMarkdown = setMarkdownTaskChecked(markdown, item.sourceLine, event.currentTarget.checked);
                        if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (taskChangesDisabled) event.preventDefault();
                      }}
                      type="checkbox"
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
      </Tag>
    );
  };

  const renderTable = (block: MarkdownBlock, key: string): ReactNode => {
    const table = block.table;
    if (!table) return null;
    const alignmentClass = (index: number) => table.alignments[index] ? `markdown-table-cell--${table.alignments[index]}` : undefined;
    const rows = table.sections.flatMap((section) => section.rows);
    const completedColumns = table.headers.map((_header, cellIndex) => {
      const taskCells = rows
        .map((row) => row.cells[cellIndex])
        .filter((cell) => cell?.taskChecked !== undefined);
      return taskCells.length > 0 && taskCells.every((cell) => cell.taskChecked);
    });

    const renderTableRow = (row: MarkdownTableRow, rowIndex: number, rowKey: string): ReactNode => {
      const progress = getTableRowProgress(row);
      const rowComplete = progress.total > 0 && progress.checked === progress.total;
      const rowLabel = row.cells.map((cell) => markdownTaskLabel(cell.sourceValue ?? cell.value, false)).find(Boolean);
      const rowTaskLabel = rowLabel || `строка ${rowIndex + 1}`;
      return (
        <tr className={rowComplete ? "markdown-table-row--complete" : undefined} key={`${rowKey}-row-${row.sourceLine}`} {...diffVisualAttributes(row.sourceLine, row.cells.map((cell) => cell.value).join(" | "))}>
          {row.cells.map((cell, cellIndex) => {
            const cellKey = `${rowKey}-row-${row.sourceLine}-cell-${cellIndex}`;
            const inlineSource = cell.sourceValue ?? cell.value;
            if (cell.taskChecked === undefined) {
              return <td className={alignmentClass(cellIndex)} data-checklist-column-complete={completedColumns[cellIndex] || undefined} key={cellKey}>{locatedInline(inlineSource, cellKey, cell.sourceLine === undefined || cell.sourceColumn === undefined ? undefined : { sourceColumn: cell.sourceColumn, sourceLine: cell.sourceLine })}</td>;
            }
            const forceRevealSpoilers = Boolean(cell.taskChecked && markdownIsSingleSpoiler(inlineSource));
            const columnLabel = markdownTaskLabel(table.headers[cellIndex]?.sourceValue ?? table.headers[cellIndex]?.value ?? "", false);
            const cellLabel = markdownTaskLabel(inlineSource, forceRevealSpoilers);
            const taskLabel = cellLabel || [rowTaskLabel, columnLabel].filter(Boolean).join(" — ") || `строка ${rowIndex + 1}, столбец ${cellIndex + 1}`;
            const taskChange = taskChangeAt(row.sourceLine, cell.taskSourceColumn);
            return (
              <td className={alignmentClass(cellIndex)} data-checklist-checked={cell.taskChecked || undefined} data-checklist-column-complete={completedColumns[cellIndex] || undefined} key={cellKey}>
                <div className={`markdown-table-task${cell.value ? "" : " markdown-table-task--only"}`}>
                  {taskChange ? <TaskDiffControl change={taskChange} /> : (
                    <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                      <input
                        aria-disabled={taskChangesDisabled || undefined}
                        aria-label={`${cell.taskChecked ? "Снять отметку" : "Отметить"}: ${taskLabel}`}
                        checked={cell.taskChecked}
                        className="markdown-task-checkbox"
                        disabled={!onTaskChange || activeTaskEditor !== null}
                        onChange={(event) => {
                          if (taskChangesDisabled) return;
                          if (cell.taskSourceColumn === undefined) return;
                          const nextMarkdown = setMarkdownTableTaskChecked(markdown, row.sourceLine, cell.taskSourceColumn, event.currentTarget.checked);
                          if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (taskChangesDisabled) event.preventDefault();
                        }}
                        type="checkbox"
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
      <div className="markdown-table-scroll" key={key}>
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
                        >
                          {headerChildren}
                        </button>
                      ) : <div className="markdown-table-group__header">{headerChildren}</div>}
                    </th>
                  </tr>
                </tbody>
                <tbody className="markdown-table-group__content" hidden={collapsed} id={contentId}>
                  {section.rows.map((row, rowIndex) => renderTableRow(row, rowIndex, groupKey))}
                </tbody>
              </Fragment>
            );
          })}
        </table>
      </div>
    );
  };

  let hiddenHeadingDepth: number | null = null;
  const renderBlock = (block: MarkdownBlock, index: number): ReactNode => {
    const key = `${block.type}-${index}`;
    if (block.type === "heading") {
      const depth = block.depth ?? 0;
      if (hiddenHeadingDepth !== null) {
        if (depth > hiddenHeadingDepth) return null;
        hiddenHeadingDepth = null;
      }
    } else if (hiddenHeadingDepth !== null) {
      return null;
    }
    if (block.type === "code") return <pre key={key}><code>{block.value}</code></pre>;
    if (block.type === "rule") return <hr key={key} />;
    if (block.type === "quote") {
      return <blockquote key={key}>{locatedLines(block.value ?? "", key, block.sourceLocations)}</blockquote>;
    }
    if (block.type === "list" || block.type === "ordered-list") {
      return renderList(block, key);
    }
    if (block.type === "table") return renderTable(block, key);
    if (block.type === "heading") {
      const children = locatedLines(block.value ?? "", key, block.sourceLocations);
      const progress = block.checklistProgress;
      const collapseId = block.collapseId;
      const collapsed = Boolean(progress && collapseId && collapsedSections.has(collapseId));
      if (collapsed) hiddenHeadingDepth = block.depth ?? 0;
      const headingClassName = progress ? `markdown-checklist-heading${!progress.open && progress.checked === progress.total ? " markdown-checklist-heading--complete" : ""}${collapsed ? " markdown-checklist-heading--collapsed" : ""}` : undefined;
      const progressChildren = progress ? <><span className="markdown-checklist-heading__title">{children}</span>{" "}<ChecklistProgressView progress={progress} /></> : children;
      const renderHeading = (variant: "inner" | "outer" | "single", headingKey: string): ReactNode => {
        const visualDuplicate = variant === "inner";
        const titleLayer = variant === "single" ? "" : ` markdown-note-title--${variant}`;
        const headingChildren = progress && collapseId && onCollapsedChecklistSectionsChange ? (
          <button aria-expanded={!collapsed} className="markdown-checklist-heading__toggle markdown-checklist-toggle" disabled={taskChangesDisabled} onClick={() => toggleChecklistSection(collapseId)} tabIndex={visualDuplicate ? -1 : undefined} type="button">{progressChildren}</button>
        ) : progressChildren;
        const commonProps = {
          "aria-hidden": visualDuplicate || undefined,
          className: `${headingClassName ?? ""}${titleLayer}`.trim() || undefined,
          "data-checklist-section-id": progress ? collapseId : undefined,
          inert: visualDuplicate || undefined,
        };
        if (block.depth === 1) return <h2 key={headingKey} {...commonProps}>{headingChildren}</h2>;
        if (block.depth === 2) return <h3 key={headingKey} {...commonProps}>{headingChildren}</h3>;
        return <h4 key={headingKey} {...commonProps}>{headingChildren}</h4>;
      };
      if (index === firstTopLevelHeadingIndex && firstHeadingPortalTarget) {
        return <Fragment key={key}>{renderHeading("inner", `${key}-inner`)}{createPortal(renderHeading("outer", `${key}-outer`), firstHeadingPortalTarget)}</Fragment>;
      }
      return renderHeading("single", key);
    }
    return <p key={key}>{locatedLines(block.value ?? "", key, block.sourceLocations)}</p>;
  };

  const content: ReactNode[] = [];
  let sectionStartIndex: number | null = null;
  let sectionChildren: ReactNode[] = [];
  const flushSection = (): void => {
    if (sectionStartIndex === null) return;
    content.push(<div className="markdown-section" key={`section-${sectionStartIndex}`}>{sectionChildren}</div>);
  };
  blocks.forEach((block, index) => {
    if (block.type === "heading" && block.depth === 1) {
      flushSection();
      sectionStartIndex = index;
      sectionChildren = [];
    }
    const rendered = renderBlock(block, index);
    if (sectionStartIndex === null) content.push(rendered);
    else sectionChildren.push(rendered);
  });
  flushSection();

  return <div className={`markdown ${className}`}>{content}</div>;
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return left === right || Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));
}

const MemoizedMarkdownRenderBody = memo(MarkdownRenderBody, (previous, next) => (
  previous.markdown === next.markdown
  && previous.className === next.className
  && previous.firstHeadingPortalTarget === next.firstHeadingPortalTarget
  && previous.emptyText === next.emptyText
  && sameStrings(previous.collapsedChecklistSections, next.collapsedChecklistSections)
  && previous.decorations === next.decorations
  && previous.inlineChanges === next.inlineChanges
  && previous.rowChanges === next.rowChanges
  && previous.taskChanges === next.taskChanges
  && previous.taskChangesDisabled === next.taskChangesDisabled
  && previous.onTaskChange === next.onTaskChange
  && previous.onCollapsedChecklistSectionsChange === next.onCollapsedChecklistSectionsChange
));

export function MarkdownView({ onTaskChange, onCollapsedChecklistSectionsChange, ...renderProps }: MarkdownViewProps) {
  const taskChangeRef = useRef(onTaskChange);
  const collapsedSectionsChangeRef = useRef(onCollapsedChecklistSectionsChange);
  taskChangeRef.current = onTaskChange;
  collapsedSectionsChangeRef.current = onCollapsedChecklistSectionsChange;
  const stableTaskChange = useCallback((markdown: string) => {
    taskChangeRef.current?.(markdown);
  }, []);
  const stableCollapsedSectionsChange = useCallback((sections: string[]) => {
    collapsedSectionsChangeRef.current?.(sections);
  }, []);

  return (
    <MemoizedMarkdownRenderBody
      {...renderProps}
      onCollapsedChecklistSectionsChange={onCollapsedChecklistSectionsChange ? stableCollapsedSectionsChange : undefined}
      onTaskChange={onTaskChange ? stableTaskChange : undefined}
    />
  );
}
