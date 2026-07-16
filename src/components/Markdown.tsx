import { Fragment, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
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

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  minRows?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  label = "Текст",
  placeholder = "Напишите что-нибудь…",
  minRows = 8,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();

  const insert = (before: string, after = "", fallback = "текст") => {
    const input = textareaRef.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selection = value.slice(start, end) || fallback;
    const nextValue = `${value.slice(0, start)}${before}${selection}${after}${value.slice(end)}`;
    onChange(nextValue);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + before.length, start + before.length + selection.length);
    });
  };

  return (
    <div className="markdown-editor">
      <div className="markdown-editor__header">
        <span className="field-label" id={labelId}>{label}</span>
        <div className="segmented-control" aria-label="Режим редактора">
          <button aria-pressed={tab === "write"} onClick={() => setTab("write")} type="button">Текст</button>
          <button aria-pressed={tab === "preview"} onClick={() => setTab("preview")} type="button">Предпросмотр</button>
        </div>
      </div>
      {tab === "write" ? (
        <>
          <div className="markdown-editor__toolbar" aria-label="Форматирование Markdown">
            <button aria-label="Полужирный" onClick={() => insert("**", "**")} type="button"><strong>Ж</strong></button>
            <button aria-label="Курсив" onClick={() => insert("_", "_")} type="button"><em>К</em></button>
            <button aria-label="Ссылка" onClick={() => insert("[", "](https://)", "название")} type="button"><Icon name="link" size={17} /></button>
            <button aria-label="Маркированный список" onClick={() => insert("- ", "", "пункт")} type="button">• —</button>
            <button aria-label="Заголовок" onClick={() => insert("## ", "", "Заголовок")} type="button">H2</button>
          </div>
          <textarea
            aria-labelledby={labelId}
            onChange={(event) => onChange(event.currentTarget.value)}
            placeholder={placeholder}
            ref={textareaRef}
            rows={minRows}
            value={value}
          />
          <span className="markdown-editor__hint">Поддерживается Markdown. Raw HTML запрещён.</span>
        </>
      ) : (
        <div className="markdown-editor__preview" role="region" aria-label={`Предпросмотр: ${label}`}>
          <MarkdownView markdown={value} emptyText="Здесь появится предпросмотр" />
        </div>
      )}
    </div>
  );
}
