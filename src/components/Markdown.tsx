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
  values?: string[];
  depth?: number;
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
    if (/^\s*[-*+]\s+/.test(line)) {
      const values: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        values.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", values });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const values: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        values.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ordered-list", values });
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
  return blocks;
}

export interface MarkdownViewProps {
  markdown: string;
  className?: string;
  emptyText?: string;
}

export function MarkdownView({ markdown, className = "", emptyText = "Текста пока нет" }: MarkdownViewProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  if (!blocks.length) return <p className={`markdown-empty ${className}`}>{emptyText}</p>;

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
          const Tag = block.type === "list" ? "ul" : "ol";
          return <Tag key={key}>{block.values?.map((value, itemIndex) => <li key={itemIndex}>{renderInline(value, `${key}-${itemIndex}`)}</li>)}</Tag>;
        }
        if (block.type === "heading") {
          const children = renderInline(block.value ?? "", key);
          if (block.depth === 1) return <h2 key={key}>{children}</h2>;
          if (block.depth === 2) return <h3 key={key}>{children}</h3>;
          return <h4 key={key}>{children}</h4>;
        }
        return <p key={key}>{block.value?.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{renderInline(line, `${key}-${lineIndex}`)}{lineIndex < (block.value?.split("\n").length ?? 0) - 1 ? <br /> : null}</Fragment>)}</p>;
      })}
    </div>
  );
}

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || !file.type && IMAGE_FILE_EXTENSION.test(file.name);
}

function snapshotFiles(transfer: DataTransfer): File[] {
  const itemFiles = Array.from(transfer.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  return itemFiles.length ? itemFiles : Array.from(transfer.files ?? []);
}

function hasFilePayload(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes("Files") || Array.from(transfer.items ?? []).some((item) => item.kind === "file") || transfer.files.length > 0;
}

export interface PlainMarkdownTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onPaste" | "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop"> {
  value: string;
  onChange: (value: string) => void;
  onImageFiles?: (files: File[]) => void;
  onImageError?: (error: Error) => void;
  imagesDisabled?: boolean;
}

export function PlainMarkdownTextarea({
  value,
  onChange,
  onImageFiles,
  onImageError,
  imagesDisabled = false,
  className = "",
  ...textareaProps
}: PlainMarkdownTextareaProps) {
  const [dragOver, setDragOver] = useState(false);

  const acceptFiles = (transfer: DataTransfer): boolean => {
    const files = snapshotFiles(transfer);
    const images = files.filter(isImageFile);
    if (!images.length) {
      onImageError?.(new Error("Можно добавить только изображения."));
      return false;
    }
    if (!imagesDisabled) onImageFiles?.(images);
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
        const images = files.filter(isImageFile);
        if (!images.length) {
          if (!imagesDisabled) onImageError?.(new Error("Можно добавить только изображения."));
          return;
        }
        if (!imagesDisabled) onImageFiles?.(images);
      }}
      value={value}
    />
  );
}
