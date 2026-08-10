import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { runtimeAssetFilename as domainRuntimeAssetFilename } from "../domain/assets";
import type { Asset, Game, Note } from "../domain/types";
import type { SourceAssetOccurrence, SourceFileAssetOccurrence } from "./types";

const MAX_SLUG_CODE_POINTS = 48;
const MAX_SLUG_UTF8_BYTES = 160;
const markdownParser = unified().use(remarkParse).use(remarkGfm);

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start: { line: number };
    end: { line: number };
  };
}

export function slugifySourceName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  const encoder = new TextEncoder();
  let slug = "";
  let bytes = 0;
  for (const codePoint of [...normalized].slice(0, MAX_SLUG_CODE_POINTS)) {
    const codePointBytes = encoder.encode(codePoint).byteLength;
    if (bytes + codePointBytes > MAX_SLUG_UTF8_BYTES) break;
    slug += codePoint;
    bytes += codePointBytes;
  }

  slug = slug.replace(/-+$/u, "");
  return slug || fallback;
}

export function gameSourceDirectoryName(game: Game): string {
  return `${slugifySourceName(game.title, "game")}_${game.id.toLowerCase()}`;
}

function visibleInlineText(nodes: readonly MarkdownNode[]): string {
  let result = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") result += node.value ?? "";
    else if (node.type === "break") result += " ";
    else if (node.type !== "image" && node.type !== "imageReference" && node.type !== "html" && node.children) {
      result += visibleInlineText(node.children);
    }
  }
  return result;
}

function inlineKinds(nodes: readonly MarkdownNode[]): Set<"image" | "link" | "text"> {
  const kinds = new Set<"image" | "link" | "text">();
  for (const node of nodes) {
    if (node.type === "image" || node.type === "imageReference") kinds.add("image");
    else if (node.type === "link" || node.type === "linkReference") kinds.add("link");
    else if ((node.type === "text" || node.type === "inlineCode") && /\S/u.test(node.value ?? "")) kinds.add("text");
    else if (node.children) {
      for (const kind of inlineKinds(node.children)) kinds.add(kind);
    }
  }
  return kinds;
}

function usableVisibleText(nodes: readonly MarkdownNode[]): string | null {
  const kinds = inlineKinds(nodes);
  if (!kinds.has("text") && (kinds.has("link") || kinds.has("image"))) return null;
  const visible = visibleInlineText(nodes).trim();
  return /[\p{L}\p{N}]/u.test(visible) ? visible : null;
}

function collectCandidates(root: MarkdownNode): { headings: MarkdownNode[]; paragraphs: MarkdownNode[] } {
  const headings: MarkdownNode[] = [];
  const paragraphs: MarkdownNode[] = [];
  const excludedContainers = new Set(["code", "html", "table", "thematicBreak", "definition"]);

  function visit(node: MarkdownNode): void {
    if (excludedContainers.has(node.type)) return;
    if (node.type === "heading") headings.push(node);
    else if (node.type === "paragraph") paragraphs.push(node);
    for (const child of node.children ?? []) visit(child);
  }

  visit(root);
  return { headings, paragraphs };
}

function stripBlockMarkers(value: string): string {
  let candidate = value;
  let previous = "";
  while (candidate !== previous) {
    previous = candidate;
    candidate = candidate.replace(/^[ \t]{0,3}>[ \t]?/u, "");
    candidate = candidate.replace(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/u, "");
    candidate = candidate.replace(/^[ \t]{0,3}\[[ xX]\][ \t]+/u, "");
  }
  return candidate.replace(/^[ \t]{0,3}/u, "");
}

function visibleTextFromPhysicalLine(value: string): string | null {
  const candidate = stripBlockMarkers(value);
  const trimmed = candidate.trim();
  if (/^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>.*<\/\1>$/u.test(trimmed) || /^<\/?[A-Za-z][^>]*>$/u.test(trimmed)) return null;
  const root = markdownParser.parse(candidate) as Root;
  const node = (root.children[0] as unknown as MarkdownNode | undefined);
  if (!node || (node.type !== "paragraph" && node.type !== "heading")) return null;
  return usableVisibleText(node.children ?? []);
}

function deriveNoteSlugText(bodyMarkdown: string): string {
  const root = markdownParser.parse(bodyMarkdown) as Root;
  const { headings, paragraphs } = collectCandidates(root as unknown as MarkdownNode);

  for (const heading of headings) {
    const visible = usableVisibleText(heading.children ?? []);
    if (visible) return [...visible].slice(0, MAX_SLUG_CODE_POINTS).join("");
  }

  const lines = bodyMarkdown.split(/\r\n|\r|\n/u);
  for (const paragraph of paragraphs) {
    const startLine = paragraph.position?.start.line;
    const endLine = paragraph.position?.end.line;
    if (startLine === undefined || endLine === undefined) continue;
    for (let line = startLine; line <= endLine; line += 1) {
      const visible = visibleTextFromPhysicalLine(lines[line - 1] ?? "");
      if (visible) return [...visible].slice(0, MAX_SLUG_CODE_POINTS).join("");
    }
  }

  return "";
}

export function deriveNoteFilename(note: Note): string {
  const slug = slugifySourceName(deriveNoteSlugText(note.bodyMarkdown), "note");
  return `${slug}_${note.id.toLowerCase()}.md`;
}

function splitSourceFilename(originalName: string): { stem: string; extension: string | null } {
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0 || dot >= originalName.length - 1) return { stem: originalName, extension: null };
  return { stem: originalName.slice(0, dot), extension: originalName.slice(dot + 1) };
}

function occurrenceIsMp4(occurrence: SourceFileAssetOccurrence): boolean {
  return occurrence.references.length > 0
    && occurrence.references.every((reference) => reference.mime.toLowerCase() === "video/mp4");
}

export function sourceAssetFilename(occurrence: SourceAssetOccurrence, asset: Asset): string {
  const { stem, extension: candidate } = splitSourceFilename(occurrence.originalName);
  const extension = occurrence.kind === "image"
    ? "webp"
    : occurrenceIsMp4(occurrence)
      ? "mp4"
      : candidate && /^[A-Za-z0-9]{1,16}$/u.test(candidate)
        ? candidate.toLowerCase()
        : "bin";
  return `${slugifySourceName(stem, "asset")}_${asset.id.toLowerCase()}.${extension}`;
}

export function runtimeAssetFilename(asset: Asset): string {
  return domainRuntimeAssetFilename(asset);
}
