import { Fragment, useMemo, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { safeUrl } from "./libraryUi";

function renderInline(source: string, keyPrefix = "inline"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(source))) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index));
    const raw = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (raw.startsWith("`")) {
      nodes.push(<code key={key}>{raw.slice(1, -1)}</code>);
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
            {renderInline(linkMatch[1], `${key}-label`)}
          </a>,
        );
      } else {
        nodes.push(raw);
      }
    } else if (raw.startsWith("**") || raw.startsWith("__")) {
      nodes.push(<strong key={key}>{renderInline(raw.slice(2, -2), `${key}-strong`)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(raw.slice(1, -1), `${key}-em`)}</em>);
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

interface MarkdownBlock {
  type: "code" | "heading" | "list" | "ordered-list" | "quote" | "paragraph" | "rule";
  value?: string;
  items?: MarkdownListItem[];
  depth?: number;
  checklistProgress?: ChecklistProgress;
}

interface ChecklistProgress {
  checked: number;
  total: number;
}

interface MarkdownListItem {
  value: string;
  sourceLine: number;
  taskChecked?: boolean;
  children: MarkdownBlock[];
}

const TASK_MARKER = /^\[([ xX])\](?:[ \t]+|$)/;

interface ParsedListLine {
  indent: number;
  contentIndent: number;
  type: "list" | "ordered-list";
  value: string;
}

function indentationWidth(value: string, initialWidth = 0): number {
  return Array.from(value).reduce(
    (width, character) => character === "\t" ? width + (4 - width % 4) : width + 1,
    initialWidth,
  );
}

function parseListLine(line: string): ParsedListLine | null {
  const match = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  const indent = indentationWidth(match[1]);
  return {
    indent,
    contentIndent: indentationWidth(match[3], indent + match[2].length),
    type: /^\d/.test(match[2]) ? "ordered-list" : "list",
    value: match[4],
  };
}

function parseList(lines: string[], startIndex: number, minimumIndent = 0): { block: MarkdownBlock; nextIndex: number } {
  const firstLine = parseListLine(lines[startIndex]);
  if (!firstLine) throw new Error("Expected a Markdown list line");

  const block: MarkdownBlock = { type: firstLine.type, items: [] };
  let index = startIndex;

  while (index < lines.length) {
    const line = parseListLine(lines[index]);
    if (!line || line.indent < minimumIndent || line.indent >= firstLine.contentIndent || line.type !== firstLine.type) break;

    const sourceLine = index;
    const task = TASK_MARKER.exec(line.value);
    const item: MarkdownListItem = {
      value: task ? line.value.slice(task[0].length) : line.value,
      sourceLine,
      taskChecked: task ? task[1].toLowerCase() === "x" : undefined,
      children: [],
    };
    index += 1;

    while (index < lines.length) {
      const childLine = parseListLine(lines[index]);
      if (childLine?.indent !== undefined && childLine.indent >= line.contentIndent) {
        const child = parseList(lines, index, line.contentIndent);
        item.children.push(child.block);
        index = child.nextIndex;
        continue;
      }
      if (childLine) break;

      if (!lines[index].trim()) {
        let lookahead = index;
        while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
        const nextLine = lookahead < lines.length ? parseListLine(lines[lookahead]) : null;
        const nextIsChild = nextLine !== null && nextLine.indent >= line.contentIndent;
        const nextIsSibling = nextLine !== null && nextLine.type === firstLine.type && nextLine.indent >= minimumIndent && nextLine.indent < firstLine.contentIndent;
        if (nextIsChild || nextIsSibling) {
          index = lookahead;
          if (nextIsChild) continue;
        }
        break;
      }

      const leadingWhitespace = /^[ \t]*/.exec(lines[index])?.[0] ?? "";
      if (indentationWidth(leadingWhitespace) < line.contentIndent) break;
      item.value += `\n${lines[index].trim()}`;
      index += 1;
    }

    block.items?.push(item);
  }

  return { block, nextIndex: index };
}

function getChecklistProgress(block: MarkdownBlock): ChecklistProgress {
  return (block.items ?? []).reduce<ChecklistProgress>((progress, item) => {
    if (item.taskChecked !== undefined) {
      progress.total += 1;
      if (item.taskChecked) progress.checked += 1;
    }
    for (const child of item.children) {
      const childProgress = getChecklistProgress(child);
      progress.checked += childProgress.checked;
      progress.total += childProgress.total;
    }
    return progress;
  }, { checked: 0, total: 0 });
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

function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = /^\s*```(?:\w+)?\s*$/.exec(line);
    if (fence) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      blocks.push({ type: "code", value: content.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", depth: heading[1].length, value: heading[2] });
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (parseListLine(line)) {
      const list = parseList(lines, index);
      blocks.push(list.block);
      index = list.nextIndex;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", value: quote.join("\n") });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", value: paragraph.join("\n") });
  }
  for (let blockIndex = 0; blockIndex < blocks.length - 1; blockIndex += 1) {
    const block = blocks[blockIndex];
    const nextBlock = blocks[blockIndex + 1];
    if (block.type !== "heading" || nextBlock.type !== "list" && nextBlock.type !== "ordered-list") continue;
    const progress = getChecklistProgress(nextBlock);
    if (progress.total > 0) block.checklistProgress = progress;
  }

  return blocks;
}

export function hasMarkdownTasks(markdown: string): boolean {
  return parseBlocks(markdown).some((block) => getChecklistProgress(block).total > 0);
}

export interface MarkdownViewProps {
  markdown: string;
  className?: string;
  emptyText?: string;
  onTaskChange?: (markdown: string) => void;
  taskChangesDisabled?: boolean;
}

export function MarkdownView({ markdown, className = "", emptyText = "Текста пока нет", onTaskChange, taskChangesDisabled = false }: MarkdownViewProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  if (!blocks.length) return <p className={`markdown-empty ${className}`}>{emptyText}</p>;

  const renderList = (block: MarkdownBlock, key: string): ReactNode => {
    const Tag = block.type === "list" ? "ul" : "ol";
    return (
      <Tag key={key}>
        {block.items?.map((item, itemIndex) => {
          const itemKey = `${key}-${item.sourceLine}-${itemIndex}`;
          const children = item.children.map((child, childIndex) => renderList(child, `${itemKey}-child-${childIndex}`));
          if (item.taskChecked === undefined) {
            return <li key={itemKey}>{renderInline(item.value, itemKey)}{children}</li>;
          }
          return (
            <li className={`markdown-task-item${item.taskChecked ? " markdown-task-item--checked" : ""}`} key={itemKey}>
              <div className="markdown-task-row">
                <label className="markdown-task-control" onClick={(event) => event.stopPropagation()}>
                  <input
                    aria-label={`${item.taskChecked ? "Снять отметку" : "Отметить"}: ${item.value || "пункт"}`}
                    checked={item.taskChecked}
                    className="markdown-task-checkbox"
                    disabled={!onTaskChange || taskChangesDisabled}
                    onChange={(event) => {
                      const nextMarkdown = setMarkdownTaskChecked(markdown, item.sourceLine, event.currentTarget.checked);
                      if (nextMarkdown !== markdown) onTaskChange?.(nextMarkdown);
                    }}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </label>
                <span className="markdown-task-content">{renderInline(item.value, itemKey)}</span>
              </div>
              {children}
            </li>
          );
        })}
      </Tag>
    );
  };

  return (
    <div className={`markdown ${className}`}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "code") return <pre key={key}><code>{block.value}</code></pre>;
        if (block.type === "rule") return <hr key={key} />;
        if (block.type === "quote") {
          return <blockquote key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{renderInline(line, `${key}-${lineIndex}`)}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</blockquote>;
        }
        if (block.type === "list" || block.type === "ordered-list") {
          return renderList(block, key);
        }
        if (block.type === "heading") {
          const children = renderInline(block.value ?? "", key);
          const progress = block.checklistProgress;
          const headingClassName = progress ? `markdown-checklist-heading${progress.checked === progress.total ? " markdown-checklist-heading--complete" : ""}` : undefined;
          const headingChildren = progress ? <><span className="markdown-checklist-heading__title">{children}</span>{" "}<span aria-label={`Выполнено ${progress.checked} из ${progress.total}`} className="markdown-checklist-progress">{progress.checked}/{progress.total}</span></> : children;
          if (block.depth === 1) return <h2 className={headingClassName} key={key}>{headingChildren}</h2>;
          if (block.depth === 2) return <h3 className={headingClassName} key={key}>{headingChildren}</h3>;
          return <h4 className={headingClassName} key={key}>{headingChildren}</h4>;
        }
        return <p key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{renderInline(line, `${key}-${lineIndex}`)}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</p>;
      })}
    </div>
  );
}

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || !file.type && IMAGE_FILE_EXTENSION.test(file.name);
}

export function snapshotFiles(transfer: DataTransfer): File[] {
  const itemFiles = Array.from(transfer.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  return itemFiles.length ? itemFiles : Array.from(transfer.files ?? []);
}

export function hasFilePayload(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes("Files") || Array.from(transfer.items ?? []).some((item) => item.kind === "file") || transfer.files.length > 0;
}

export interface PlainMarkdownTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onPaste" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"> {
  value: string;
  onChange: (value: string) => void;
  onImageFiles?: (files: File[]) => void;
  onFileFiles?: (files: File[]) => void;
  onImageError?: (error: Error) => void;
  imagesDisabled?: boolean;
}

export function PlainMarkdownTextarea({
  value,
  onChange,
  onImageFiles,
  onFileFiles,
  onImageError,
  imagesDisabled = false,
  className = "",
  ...textareaProps
}: PlainMarkdownTextareaProps) {
  const [dragOver, setDragOver] = useState(false);

  const acceptFiles = (transfer: DataTransfer): boolean => {
    const files = snapshotFiles(transfer);
    const images = files.filter(isImageFile);
    const otherFiles = files.filter((file) => !isImageFile(file));
    if (!images.length && (!otherFiles.length || !onFileFiles)) {
      if (!imagesDisabled) onImageError?.(new Error("Можно добавить только изображения."));
      return false;
    }
    if (!imagesDisabled) {
      if (images.length) onImageFiles?.(images);
      if (otherFiles.length) onFileFiles?.(otherFiles);
    }
    return true;
  };

  return (
    <textarea
      {...textareaProps}
      className={`${className}${dragOver ? `${className ? " " : ""}is-drag-over` : ""}`}
      onChange={(event) => onChange(event.currentTarget.value)}
      onDragEnter={(event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        if (!imagesDisabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDragOver={(event) => {
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!imagesDisabled) setDragOver(true);
      }}
      onDrop={(event) => {
        setDragOver(false);
        if (!hasFilePayload(event.dataTransfer)) return;
        event.preventDefault();
        if (!imagesDisabled) acceptFiles(event.dataTransfer);
      }}
      onPaste={(event) => {
        const files = snapshotFiles(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        acceptFiles(event.clipboardData);
      }}
      value={value}
    />
  );
}
