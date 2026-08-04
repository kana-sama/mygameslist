import type { Content, Root } from "mdast";
import { diffArrays, diffWordsWithSpace } from "diff";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export type SourceDiffKind = "context" | "added" | "removed";

export interface InlineDiffPart {
  kind: SourceDiffKind;
  value: string;
}

export interface SourceDiffLine {
  id: string;
  kind: SourceDiffKind;
  value: string;
  eol: string;
  beforeLine: number | null;
  afterLine: number | null;
  pairId?: string;
  inline?: InlineDiffPart[];
}

export type MarkdownBlockType = Content["type"] | "source";
export type MarkdownChangeKind = "context" | "added" | "removed" | "modified";

export interface MarkdownDecoration {
  kind: Exclude<MarkdownChangeKind, "context">;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  label: "Добавлено" | "Удалено" | "Изменено";
}

export interface MarkdownDiffSide {
  markdown: string;
  decorations: MarkdownDecoration[];
}

export interface MarkdownDiffFragment {
  id: string;
  blockType: MarkdownBlockType;
  kind: MarkdownChangeKind;
  before?: MarkdownDiffSide;
  after?: MarkdownDiffSide;
  sourceLineIds: string[];
}

export interface MarkdownDiffHunk {
  id: string;
  lines: SourceDiffLine[];
  fragments: MarkdownDiffFragment[];
  structuralPrologue?: {
    before: MarkdownDiffSide;
    after: MarkdownDiffSide;
  };
}

export interface MarkdownDiffFallback {
  blockType: MarkdownBlockType;
  reason: "ambiguous-anchor" | "parse-error" | "unsupported-position";
}

export interface MarkdownDiffModel {
  before: string;
  after: string;
  lines: SourceDiffLine[];
  hunks: MarkdownDiffHunk[];
  fragments: MarkdownDiffFragment[];
  fallbacks: MarkdownDiffFallback[];
  renderable: boolean;
}

interface BlockAnchor {
  node: Content;
  type: MarkdownBlockType;
  key: string | null;
  occurrenceCount: number;
  startOffset: number;
  endOffset: number;
}

interface PositionedNode {
  type: string;
  value?: string;
  depth?: number;
  children?: PositionedNode[];
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
}

interface LineStructure {
  identity: string;
  type: MarkdownBlockType;
  key: string | null;
  occurrenceCount: number;
  parentSignature: string;
  parentType: MarkdownBlockType;
  depth?: number;
  priority: number;
}

interface StructuralIndex {
  lines: Map<number, LineStructure>;
  anchors: BlockAnchor[];
  anchorDescendants: Map<string, string[]>;
  parentKeyCounts: Map<string, Map<string, number>>;
  parentTypes: Map<string, MarkdownBlockType>;
  unsupportedPosition: boolean;
}

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const MAX_SEMANTIC_PAIR_CHARACTER_PRODUCT = 100_000;
const MAX_REPLACEMENT_RUN_PAIR_COMPARISONS = 256;
const MAX_DOCUMENT_SEMANTIC_PAIR_WORK = 2_000_000;

function parseMarkdown(source: string): Root {
  return markdownParser.parse(source) as Root;
}

interface PhysicalLine {
  value: string;
  eol: string;
}

function physicalLines(source: string): PhysicalLine[] {
  if (!source) return [];

  const result: PhysicalLine[] = [];
  for (const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    result.push({ value: match[1], eol: match[2] });
  }
  return result;
}

export function reconstructBefore(lines: readonly SourceDiffLine[]): string {
  return lines
    .filter((line) => line.kind !== "added")
    .map((line) => `${line.value}${line.eol}`)
    .join("");
}

export function reconstructAfter(lines: readonly SourceDiffLine[]): string {
  return lines
    .filter((line) => line.kind !== "removed")
    .map((line) => `${line.value}${line.eol}`)
    .join("");
}

export function diffSourceLines(before: string, after: string): SourceDiffLine[] {
  const changes = diffArrays(physicalLines(before), physicalLines(after), {
    comparator: (left, right) => left.value === right.value && left.eol === right.eol,
  });
  const lines: SourceDiffLine[] = [];
  let beforeLine = 1;
  let afterLine = 1;

  for (const change of changes) {
    const kind: SourceDiffKind = change.added
      ? "added"
      : change.removed
        ? "removed"
        : "context";

    for (const line of change.value) {
      const currentBeforeLine = kind === "added" ? null : beforeLine++;
      const currentAfterLine = kind === "removed" ? null : afterLine++;
      lines.push({
        id: `${kind}:${currentBeforeLine ?? "-"}:${currentAfterLine ?? "-"}`,
        kind,
        value: line.value,
        eol: line.eol,
        beforeLine: currentBeforeLine,
        afterLine: currentAfterLine,
      });
    }
  }

  return lines;
}

function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function visibleText(node: PositionedNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(visibleText).join("");
}

function listItemKey(node: PositionedNode): string | null {
  const normalized = normalizeVisibleText(
    visibleText(node).replace(/^\s*\[[ xX]\]\s*/u, ""),
  );
  return normalized ? `listItem:${normalized}` : null;
}

function tableRowKey(node: PositionedNode): string | null {
  for (const cell of node.children ?? []) {
    const normalized = normalizeVisibleText(visibleText(cell));
    if (normalized) return `tableRow:${normalized}`;
  }
  return null;
}

function anchorKey(node: PositionedNode): string | null {
  const normalized = normalizeVisibleText(visibleText(node));
  if (!normalized) return null;

  switch (node.type) {
    case "heading":
      return `heading:${node.depth ?? 0}:${normalized}`;
    case "listItem":
      return listItemKey(node);
    case "tableRow":
      return tableRowKey(node);
    case "list":
    case "table":
    case "blockquote":
      return null;
    default:
      return `${node.type}:${normalized}`;
  }
}

function structuralPriority(type: string): number {
  switch (type) {
    case "tableRow":
      return 50;
    case "listItem":
      return 45;
    case "heading":
      return 40;
    case "code":
    case "html":
      return 35;
    case "paragraph":
      return 30;
    case "table":
    case "list":
    case "blockquote":
      return 20;
    default:
      return 10;
  }
}

function registerParentKeys(
  index: StructuralIndex,
  signature: string,
  type: MarkdownBlockType,
  nodes: readonly PositionedNode[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = anchorKey(node);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  index.parentKeyCounts.set(signature, counts);
  index.parentTypes.set(signature, type);
  return counts;
}

function buildStructuralIndex(root: Root): StructuralIndex {
  const index: StructuralIndex = {
    lines: new Map(),
    anchors: [],
    anchorDescendants: new Map(),
    parentKeyCounts: new Map(),
    parentTypes: new Map(),
    unsupportedPosition: false,
  };
  const rootNode = root as unknown as PositionedNode;
  const counters = new Map<string, number>();

  function nextContainerSignature(parent: string, type: string): string {
    const counterKey = `${parent}/${type}`;
    const ordinal = counters.get(counterKey) ?? 0;
    counters.set(counterKey, ordinal + 1);
    return `${counterKey}:${ordinal}`;
  }

  function registerAnchorDescendant(
    parentSignature: string,
    key: string,
    descendantSignature: string,
  ): void {
    const anchor = `${parentSignature}\0${key}`;
    const descendants = index.anchorDescendants.get(anchor) ?? [];
    if (!descendants.includes(descendantSignature)) descendants.push(descendantSignature);
    index.anchorDescendants.set(anchor, descendants);
  }

  function record(
    node: PositionedNode,
    parentSignature: string,
    parentType: MarkdownBlockType,
    occurrenceCount: number,
  ): void {
    const position = node.position;
    if (
      !position ||
      position.start.offset === undefined ||
      position.end.offset === undefined
    ) {
      index.unsupportedPosition = true;
      return;
    }

    const type = node.type as MarkdownBlockType;
    const key = anchorKey(node);
    const priority = structuralPriority(node.type);
    index.anchors.push({
      node: node as unknown as Content,
      type,
      key,
      occurrenceCount,
      startOffset: position.start.offset,
      endOffset: position.end.offset,
    });

    for (let line = position.start.line; line <= position.end.line; line += 1) {
      const current = index.lines.get(line);
      if (!current || priority >= current.priority) {
        index.lines.set(line, {
          identity: `${parentSignature}/${type}:${position.start.offset}:${position.end.offset}`,
          type,
          key,
          occurrenceCount,
          parentSignature,
          parentType,
          depth: node.depth,
          priority,
        });
      }
    }
  }

  function walkContainer(
    parent: PositionedNode,
    parentSignature: string,
    parentType: MarkdownBlockType,
  ): void {
    const children = parent.children ?? [];
    if (parent.type === "root") {
      interface HeadingPlacement {
        headingParent: string;
        sectionSignature: string;
      }

      const placements = new Map<PositionedNode, string | HeadingPlacement>();
      const headingGroups = new Map<string, PositionedNode[]>();
      const sectionChildren = new Map<string, PositionedNode[]>();
      const headingStack: Array<{ depth: number; sectionSignature: string }> = [];
      for (const child of children) {
        if (child.type === "heading") {
          const depth = child.depth ?? 0;
          while (headingStack.length > 0 && headingStack.at(-1)!.depth >= depth) {
            headingStack.pop();
          }
          const parentSection = headingStack.at(-1)?.sectionSignature ?? "root";
          const headingParent = `${parentSection}/headings`;
          const key = anchorKey(child) ?? `heading-line:${child.position?.start.line ?? "?"}`;
          const sectionSignature = `${parentSection}/section:${encodeURIComponent(key)}`;
          const headings = headingGroups.get(headingParent) ?? [];
          headings.push(child);
          headingGroups.set(headingParent, headings);
          placements.set(child, { headingParent, sectionSignature });
          headingStack.push({ depth, sectionSignature });
          continue;
        }
        const signature = headingStack.at(-1)?.sectionSignature ?? "root/preamble";
        const values = sectionChildren.get(signature) ?? [];
        values.push(child);
        sectionChildren.set(signature, values);
        placements.set(child, signature);
      }
      for (const [signature, headings] of headingGroups) {
        registerParentKeys(index, signature, "heading", headings);
      }
      for (const [signature, values] of sectionChildren) {
        registerParentKeys(index, signature, "source", values);
      }

      for (const child of children) {
        if (child.type === "heading") {
          const placement = placements.get(child) as HeadingPlacement;
          const key = anchorKey(child);
          const counts = index.parentKeyCounts.get(placement.headingParent) ?? new Map();
          record(child, placement.headingParent, "heading", key ? (counts.get(key) ?? 0) : 0);
          if (key) {
            registerAnchorDescendant(
              placement.headingParent,
              key,
              placement.sectionSignature,
            );
          }
          continue;
        }
        const scopedParent = placements.get(child) as string;
        const counts = index.parentKeyCounts.get(scopedParent) ?? new Map<string, number>();
        const key = anchorKey(child);
        record(child, scopedParent, "source", key ? (counts.get(key) ?? 0) : 0);
        if (child.type === "list" || child.type === "table" || child.type === "blockquote") {
          const signature = nextContainerSignature(scopedParent, child.type);
          walkContainer(child, signature, child.type as MarkdownBlockType);
        }
      }
      return;
    }

    const counts = registerParentKeys(index, parentSignature, parentType, children);

    for (const child of children) {
      const scopedParent = parentSignature;
      const key = anchorKey(child);
      record(child, scopedParent, parentType, key ? (counts.get(key) ?? 0) : 0);

      if (child.type === "list" || child.type === "table" || child.type === "blockquote") {
        const signature = nextContainerSignature(scopedParent, child.type);
        walkContainer(child, signature, child.type as MarkdownBlockType);
      } else if (child.type === "listItem") {
        for (const nested of child.children ?? []) {
          if (nested.type === "list") {
            const anchorParent = `${parentSignature}/anchor:${encodeURIComponent(key ?? "unkeyed")}`;
            if (key) registerAnchorDescendant(parentSignature, key, anchorParent);
            const signature = nextContainerSignature(anchorParent, nested.type);
            record(nested, parentSignature, parentType, 1);
            walkContainer(nested, signature, "list");
          }
        }
      }
    }
  }

  walkContainer(rootNode, "root/preamble", "source");
  return index;
}

function addFallback(
  fallbacks: MarkdownDiffFallback[],
  blockType: MarkdownBlockType,
  reason: MarkdownDiffFallback["reason"],
): void {
  if (!fallbacks.some((fallback) => fallback.blockType === blockType && fallback.reason === reason)) {
    fallbacks.push({ blockType, reason });
  }
}

function findAmbiguousParents(
  before: StructuralIndex,
  after: StructuralIndex,
  fallbacks: MarkdownDiffFallback[],
): Set<string> {
  const ambiguous = new Set<string>();
  for (const [signature, beforeCounts] of before.parentKeyCounts) {
    const afterCounts = after.parentKeyCounts.get(signature);
    if (!afterCounts) continue;

    for (const key of new Set([...beforeCounts.keys(), ...afterCounts.keys()])) {
      if ((beforeCounts.get(key) ?? 0) > 1 || (afterCounts.get(key) ?? 0) > 1) {
        ambiguous.add(`${signature}\0${key}`);
        const parentType = before.parentTypes.get(signature) ?? "source";
        for (const descendant of [
          ...(before.anchorDescendants.get(`${signature}\0${key}`) ?? []),
          ...(after.anchorDescendants.get(`${signature}\0${key}`) ?? []),
        ]) {
          ambiguous.add(`ancestor:${descendant}`);
        }
        addFallback(
          fallbacks,
          parentType === "table"
            ? "table"
            : parentType === "list"
              ? "listItem"
              : parentType,
          "ambiguous-anchor",
        );
      }
    }
  }
  return ambiguous;
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  const previous = new Uint32Array(right.length + 1);
  const current = new Uint32Array(right.length + 1);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] =
        left[leftIndex] === right[rightIndex]
          ? previous[rightIndex] + 1
          : Math.max(current[rightIndex], previous[rightIndex + 1]);
    }
    previous.set(current);
    current.fill(0);
  }

  return previous[right.length];
}

function exceedsProduct(left: number, right: number, maximum: number): boolean {
  return left > 0 && right > Math.floor(maximum / left);
}

function semanticPairText(value: string): string {
  return value.replace(/^\s*(?:[-*+] |\d+[.)] |\[[ xX]\]\s*)+/u, "");
}

function pairSimilarity(before: string, after: string): number {
  const left = semanticPairText(before);
  const right = semanticPairText(after);
  if (!left || !right) return 0;
  if (exceedsProduct(left.length, right.length, MAX_SEMANTIC_PAIR_CHARACTER_PRODUCT)) return 0;
  const common = longestCommonSubsequenceLength(left, right);
  return common / Math.max(left.length, right.length);
}

function mayPair(before: string, after: string): boolean {
  return pairSimilarity(before, after) >= 0.72;
}

function safeToPair(
  beforeLine: SourceDiffLine,
  afterLine: SourceDiffLine,
  beforeIndex: StructuralIndex,
  afterIndex: StructuralIndex,
  ambiguous: ReadonlySet<string>,
): boolean {
  if (!mayPair(beforeLine.value, afterLine.value)) return false;
  const beforeStructure = beforeLine.beforeLine
    ? beforeIndex.lines.get(beforeLine.beforeLine)
    : undefined;
  const afterStructure = afterLine.afterLine ? afterIndex.lines.get(afterLine.afterLine) : undefined;

  if (!beforeStructure || !afterStructure) {
    return !beforeStructure && !afterStructure;
  }
  if (
    beforeStructure.type !== afterStructure.type ||
    beforeStructure.parentSignature !== afterStructure.parentSignature
  ) {
    return false;
  }
  const isAmbiguous = (structure: LineStructure): boolean =>
    Boolean(
      (structure.key && ambiguous.has(`${structure.parentSignature}\0${structure.key}`)) ||
        [...ambiguous].some(
          (value) => {
            if (!value.startsWith("ancestor:")) return false;
            const ancestor = value.slice("ancestor:".length);
            return (
              structure.parentSignature === ancestor ||
              structure.parentSignature.startsWith(`${ancestor}/`)
            );
          },
        ),
    );
  if (isAmbiguous(beforeStructure) || isAmbiguous(afterStructure)) {
    return false;
  }

  if (beforeStructure.type === "heading") {
    return beforeStructure.depth === afterStructure.depth;
  }
  if (beforeStructure.type === "tableRow") {
    return beforeStructure.key !== null && beforeStructure.key === afterStructure.key;
  }
  if (beforeStructure.type === "listItem") {
    return beforeStructure.occurrenceCount <= 1 && afterStructure.occurrenceCount <= 1;
  }
  return beforeStructure.occurrenceCount <= 1 && afterStructure.occurrenceCount <= 1;
}

function inlineParts(
  before: string,
  after: string,
): { before: InlineDiffPart[]; after: InlineDiffPart[] } {
  const beforeParts: InlineDiffPart[] = [];
  const afterParts: InlineDiffPart[] = [];
  for (const part of diffWordsWithSpace(before, after)) {
    if (!part.added) {
      beforeParts.push({ kind: part.removed ? "removed" : "context", value: part.value });
    }
    if (!part.removed) {
      afterParts.push({ kind: part.added ? "added" : "context", value: part.value });
    }
  }
  return { before: beforeParts, after: afterParts };
}

function decoration(
  kind: "added" | "removed" | "modified",
  startColumn: number,
  endColumn: number,
): MarkdownDecoration {
  return {
    kind,
    startLine: 0,
    startColumn,
    endLine: 0,
    endColumn,
    label: kind === "added" ? "Добавлено" : kind === "removed" ? "Удалено" : "Изменено",
  };
}

interface CellRange {
  value: string;
  start: number;
}

function tableCells(markdown: string): CellRange[] {
  const delimiters: number[] = [];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "|") continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 0) delimiters.push(index);
  }
  if (delimiters.length === 0) return [];

  const boundaries = [
    markdown.startsWith("|") ? 0 : -1,
    ...delimiters.filter((value) => value !== 0 && value !== markdown.length - 1),
    markdown.endsWith("|") ? markdown.length - 1 : markdown.length,
  ];
  const cells: CellRange[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const rawStart = boundaries[index] + 1;
    const rawEnd = boundaries[index + 1];
    const raw = markdown.slice(rawStart, rawEnd);
    const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
    cells.push({ value: raw.slice(leading, raw.length - trailing), start: rawStart + leading });
  }
  return cells;
}

function wordDecorations(
  before: string,
  after: string,
): { before: MarkdownDecoration[]; after: MarkdownDecoration[] } {
  const beforeDecorations: MarkdownDecoration[] = [];
  const afterDecorations: MarkdownDecoration[] = [];
  let beforeColumn = 0;
  let afterColumn = 0;

  for (const part of diffWordsWithSpace(before, after)) {
    if (part.removed) {
      beforeDecorations.push(decoration("removed", beforeColumn, beforeColumn + part.value.length));
      beforeColumn += part.value.length;
    } else if (part.added) {
      afterDecorations.push(decoration("added", afterColumn, afterColumn + part.value.length));
      afterColumn += part.value.length;
    } else {
      beforeColumn += part.value.length;
      afterColumn += part.value.length;
    }
  }
  return { before: beforeDecorations, after: afterDecorations };
}

function pairedDecorations(
  before: string,
  after: string,
  blockType: MarkdownBlockType,
): { before: MarkdownDecoration[]; after: MarkdownDecoration[] } {
  if (blockType !== "tableRow") return wordDecorations(before, after);
  const beforeCells = tableCells(before);
  const afterCells = tableCells(after);
  if (beforeCells.length === 0 || beforeCells.length !== afterCells.length) {
    return wordDecorations(before, after);
  }

  const result = { before: [] as MarkdownDecoration[], after: [] as MarkdownDecoration[] };
  for (let index = 0; index < beforeCells.length; index += 1) {
    const beforeCell = beforeCells[index];
    const afterCell = afterCells[index];
    if (beforeCell.value === afterCell.value) continue;
    const local = wordDecorations(beforeCell.value, afterCell.value);
    result.before.push(
      ...local.before.map((item) => ({
        ...item,
        startColumn: item.startColumn + beforeCell.start,
        endColumn: item.endColumn + beforeCell.start,
      })),
    );
    result.after.push(
      ...local.after.map((item) => ({
        ...item,
        startColumn: item.startColumn + afterCell.start,
        endColumn: item.endColumn + afterCell.start,
      })),
    );
  }
  return result;
}

function lineStructure(
  line: SourceDiffLine,
  before: StructuralIndex,
  after: StructuralIndex,
): LineStructure | undefined {
  if (line.beforeLine) return before.lines.get(line.beforeLine);
  if (line.afterLine) return after.lines.get(line.afterLine);
  return undefined;
}

function lineBlockType(line: SourceDiffLine, before: StructuralIndex, after: StructuralIndex) {
  return lineStructure(line, before, after)?.type ?? "source";
}

function annotatePairs(
  lines: SourceDiffLine[],
  before: StructuralIndex,
  after: StructuralIndex,
  ambiguous: ReadonlySet<string>,
): Map<number, number> {
  const pairs = new Map<number, number>();
  let cursor = 0;
  let semanticPairWork = 0;

  while (cursor < lines.length) {
    if (lines[cursor].kind === "context") {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < lines.length && lines[cursor].kind !== "context") cursor += 1;
    const run = lines.slice(start, cursor);
    const removed = run
      .map((line, offset) => ({ line, index: start + offset }))
      .filter((entry) => entry.line.kind === "removed");
    const added = run
      .map((line, offset) => ({ line, index: start + offset }))
      .filter((entry) => entry.line.kind === "added");

    if (removed.length === 0 || added.length === 0) continue;
    if (run.some((line) => line.value.length === 0)) continue;
    const containsHeading = run.some(
      (line) => lineBlockType(line, before, after) === "heading",
    );
    if (containsHeading && run.length > 2) continue;

    if (removed.length !== added.length) continue;
    if (exceedsProduct(removed.length, added.length, MAX_REPLACEMENT_RUN_PAIR_COMPARISONS)) continue;
    const eligiblePairProducts = removed.flatMap((left) => {
      const leftLength = semanticPairText(left.line.value).length;
      return added
        .map((right) => leftLength * semanticPairText(right.line.value).length)
        .filter((product) => product > 0 && product <= MAX_SEMANTIC_PAIR_CHARACTER_PRODUCT);
    });
    if (!eligiblePairProducts.length) continue;
    const runPairWork = 4 * removed.length * added.length * Math.max(...eligiblePairProducts);
    if (semanticPairWork + runPairWork > MAX_DOCUMENT_SEMANTIC_PAIR_WORK) continue;
    semanticPairWork += runPairWork;
    const hasStrongerMovedMatch = removed.some((left, leftIndex) => {
      const corresponding = added[leftIndex];
      const correspondingScore = pairSimilarity(left.line.value, corresponding.line.value);
      return added.some(
        (right, rightIndex) =>
          rightIndex !== leftIndex &&
          pairSimilarity(left.line.value, right.line.value) > correspondingScore &&
          safeToPair(left.line, right.line, before, after, ambiguous),
      );
    }) || added.some((right, rightIndex) => {
      const corresponding = removed[rightIndex];
      const correspondingScore = pairSimilarity(corresponding.line.value, right.line.value);
      return removed.some(
        (left, leftIndex) =>
          leftIndex !== rightIndex &&
          pairSimilarity(left.line.value, right.line.value) > correspondingScore &&
          safeToPair(left.line, right.line, before, after, ambiguous),
      );
    });
    if (hasStrongerMovedMatch) continue;

    for (let pairIndex = 0; pairIndex < removed.length; pairIndex += 1) {
      const left = removed[pairIndex];
      const right = added[pairIndex];
      if (!safeToPair(left.line, right.line, before, after, ambiguous)) continue;
      const rightIndex = right.index;
      const pairId = `pair:${left.index}:${rightIndex}`;
      const inline = inlineParts(left.line.value, lines[rightIndex].value);
      left.line.pairId = pairId;
      left.line.inline = inline.before;
      lines[rightIndex].pairId = pairId;
      lines[rightIndex].inline = inline.after;
      pairs.set(left.index, rightIndex);
    }
  }

  return pairs;
}

function fragmentMarkdown(lines: readonly SourceDiffLine[]): string {
  return lines
    .map((line, index) => `${line.value}${index < lines.length - 1 ? line.eol : ""}`)
    .join("");
}

function shiftDecorationLine(
  item: MarkdownDecoration,
  lineOffset: number,
): MarkdownDecoration {
  return {
    ...item,
    startLine: item.startLine + lineOffset,
    endLine: item.endLine + lineOffset,
  };
}

function createFragments(
  lines: SourceDiffLine[],
  pairs: ReadonlyMap<number, number>,
  before: StructuralIndex,
  after: StructuralIndex,
): MarkdownDiffFragment[] {
  const fragments: MarkdownDiffFragment[] = [];
  const pairedAdded = new Set(pairs.values());

  for (let index = 0; index < lines.length; index += 1) {
    if (pairedAdded.has(index)) continue;
    const line = lines[index];
    const blockType = lineBlockType(line, before, after);
    const pairedIndex = pairs.get(index);
    if (pairedIndex !== undefined) {
      const beforeLines = [line];
      const afterLines = [lines[pairedIndex]];
      const beforeIdentity = lineStructure(line, before, after)?.identity;
      const afterIdentity = lineStructure(lines[pairedIndex], before, after)?.identity;
      let lastPairedIndex = pairedIndex;
      while (beforeIdentity && afterIdentity && index + 1 < lines.length) {
        const nextBeforeIndex = index + 1;
        const nextPairedIndex = pairs.get(nextBeforeIndex);
        if (nextPairedIndex === undefined || nextPairedIndex !== lastPairedIndex + 1) break;
        const nextBefore = lines[nextBeforeIndex];
        const nextAfter = lines[nextPairedIndex];
        if (
          lineStructure(nextBefore, before, after)?.identity !== beforeIdentity ||
          lineStructure(nextAfter, before, after)?.identity !== afterIdentity
        ) {
          break;
        }
        beforeLines.push(nextBefore);
        afterLines.push(nextAfter);
        index = nextBeforeIndex;
        lastPairedIndex = nextPairedIndex;
      }
      const beforeDecorations: MarkdownDecoration[] = [];
      const afterDecorations: MarkdownDecoration[] = [];
      for (let lineIndex = 0; lineIndex < beforeLines.length; lineIndex += 1) {
        const current = pairedDecorations(
          beforeLines[lineIndex].value,
          afterLines[lineIndex].value,
          blockType,
        );
        beforeDecorations.push(
          ...current.before.map((item) => shiftDecorationLine(item, lineIndex)),
        );
        afterDecorations.push(
          ...current.after.map((item) => shiftDecorationLine(item, lineIndex)),
        );
      }
      fragments.push({
        id: `fragment:${fragments.length}`,
        blockType,
        kind: "modified",
        before: { markdown: fragmentMarkdown(beforeLines), decorations: beforeDecorations },
        after: { markdown: fragmentMarkdown(afterLines), decorations: afterDecorations },
        sourceLineIds: [
          ...beforeLines.map((beforeLine) => beforeLine.id),
          ...afterLines.map((afterLine) => afterLine.id),
        ],
      });
      continue;
    }

    const kind = line.kind;
    const structure = lineStructure(line, before, after);
    const groupedLines = [line];
    while (structure && index + 1 < lines.length) {
      const nextIndex = index + 1;
      const next = lines[nextIndex];
      if (pairedAdded.has(nextIndex) || pairs.has(nextIndex) || next.kind !== kind) break;
      if (lineStructure(next, before, after)?.identity !== structure.identity) break;
      groupedLines.push(next);
      index = nextIndex;
    }
    const markdown = fragmentMarkdown(groupedLines);
    const markdownLines = markdown.split(/\r\n|\r|\n/u);
    const fullDecoration: MarkdownDecoration[] =
      kind === "context"
        ? []
        : [
            {
              ...decoration(kind, 0, 0),
              endLine: markdownLines.length - 1,
              endColumn: markdownLines.at(-1)?.length ?? 0,
            },
          ];
    fragments.push({
      id: `fragment:${fragments.length}`,
      blockType,
      kind,
      before:
        kind === "added"
          ? undefined
          : { markdown, decorations: kind === "removed" ? fullDecoration : [] },
      after:
        kind === "removed"
          ? undefined
          : { markdown, decorations: kind === "added" ? fullDecoration : [] },
      sourceLineIds: groupedLines.map((groupedLine) => groupedLine.id),
    });
  }
  return fragments;
}

function buildHunks(
  lines: SourceDiffLine[],
  fragments: MarkdownDiffFragment[],
): MarkdownDiffHunk[] {
  const changed = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.kind !== "context")
    .map(({ index }) => index);
  if (changed.length === 0) return [];

  const windows: Array<{ start: number; end: number }> = [];
  let changeCursor = 0;
  while (changeCursor < changed.length) {
    let runEnd = changeCursor;
    while (runEnd + 1 < changed.length && changed[runEnd + 1] === changed[runEnd] + 1) {
      runEnd += 1;
    }
    let start = changed[changeCursor];
    let context = 0;
    while (start > 0 && context < 3) {
      start -= 1;
      if (lines[start].kind === "context") context += 1;
    }
    let end = changed[runEnd] + 1;
    context = 0;
    while (end < lines.length && context < 3) {
      if (lines[end].kind === "context") context += 1;
      end += 1;
    }
    const previous = windows.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else windows.push({ start, end });
    changeCursor = runEnd + 1;
  }

  const linesById = new Map(lines.map((line) => [line.id, line]));
  const fragmentByLineId = new Map<string, MarkdownDiffFragment>();
  for (const fragment of fragments) {
    for (const lineId of fragment.sourceLineIds) fragmentByLineId.set(lineId, fragment);
  }
  const isTableFragment = (fragment: MarkdownDiffFragment | undefined): boolean =>
    fragment?.blockType === "table" || fragment?.blockType === "tableRow" || fragment?.blockType === "tableCell";
  const isTableDelimiter = (value: string): boolean => {
    if (!value.includes("|")) return false;
    const cells = value.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|");
    return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/u.test(cell));
  };
  const sliceDecorations = (
    decorations: readonly MarkdownDecoration[],
    startLine: number,
    endLine: number,
    lastLineLength: number,
  ): MarkdownDecoration[] => decorations
    .filter((item) => item.endLine >= startLine && item.startLine <= endLine)
    .map((item) => ({
      ...item,
      startLine: Math.max(item.startLine, startLine) - startLine,
      startColumn: item.startLine < startLine ? 0 : item.startColumn,
      endLine: Math.min(item.endLine, endLine) - startLine,
      endColumn: item.endLine > endLine ? lastLineLength : item.endColumn,
    }));
  const sliceFragmentSide = (
    fragment: MarkdownDiffFragment,
    side: "before" | "after",
    selectedIds: ReadonlySet<string>,
  ): MarkdownDiffSide | undefined => {
    const content = fragment[side];
    if (!content) return undefined;
    const sideLines = fragment.sourceLineIds
      .map((lineId) => linesById.get(lineId))
      .filter((line): line is SourceDiffLine => Boolean(line))
      .filter((line) => side === "before" ? line.kind !== "added" : line.kind !== "removed");
    const selectedLines = sideLines.filter((line) => selectedIds.has(line.id));
    if (!selectedLines.length) return undefined;
    const startLine = sideLines.findIndex((line) => line.id === selectedLines[0].id);
    const endLine = sideLines.findIndex((line) => line.id === selectedLines.at(-1)?.id);
    return {
      markdown: fragmentMarkdown(selectedLines),
      decorations: sliceDecorations(
        content.decorations,
        startLine,
        endLine,
        selectedLines.at(-1)?.value.length ?? 0,
      ),
    };
  };
  const sliceFragment = (
    fragment: MarkdownDiffFragment,
    selectedIds: ReadonlySet<string>,
    hunkIndex: number,
  ): MarkdownDiffFragment | null => {
    const sourceLineIds = fragment.sourceLineIds.filter((lineId) => selectedIds.has(lineId));
    if (!sourceLineIds.length) return null;
    return {
      ...fragment,
      id: `${fragment.id}:hunk:${hunkIndex}`,
      before: sliceFragmentSide(fragment, "before", selectedIds),
      after: sliceFragmentSide(fragment, "after", selectedIds),
      sourceLineIds,
    };
  };
  const structuralPrologue = (
    window: { start: number; end: number },
    hunkFragments: readonly MarkdownDiffFragment[],
  ): MarkdownDiffHunk["structuralPrologue"] => {
    if (!hunkFragments.some(isTableFragment)) return undefined;
    for (let delimiterIndex = window.start - 1; delimiterIndex > 0; delimiterIndex -= 1) {
      const delimiter = lines[delimiterIndex];
      if (delimiter.kind !== "context" || !isTableDelimiter(delimiter.value)) continue;
      if (fragmentByLineId.get(delimiter.id)?.blockType !== "table") continue;
      const header = lines[delimiterIndex - 1];
      if (header.kind !== "context") continue;
      if (fragmentByLineId.get(header.id)?.blockType !== "tableRow") continue;
      if (!lines.slice(delimiterIndex, window.start).every((line) =>
        isTableFragment(fragmentByLineId.get(line.id)),
      )) continue;
      const markdown = `${header.value}${header.eol || "\n"}${delimiter.value}${delimiter.eol || "\n"}`;
      return {
        before: { markdown, decorations: [] },
        after: { markdown, decorations: [] },
      };
    }
    return undefined;
  };

  return windows.map((window, index) => {
    const hunkLines = lines.slice(window.start, window.end);
    const ids = new Set(hunkLines.map((line) => line.id));
    const hunkFragments = fragments
      .map((fragment) => sliceFragment(fragment, ids, index))
      .filter((fragment): fragment is MarkdownDiffFragment => fragment !== null);
    const prologue = structuralPrologue(window, hunkFragments);
    return {
      id: `hunk:${index}`,
      lines: hunkLines,
      fragments: hunkFragments,
      ...(prologue ? { structuralPrologue: prologue } : {}),
    };
  });
}

function sourceOnlyModel(
  before: string,
  after: string,
  lines: SourceDiffLine[],
  fallbacks: MarkdownDiffFallback[],
): MarkdownDiffModel {
  const emptyIndex: StructuralIndex = {
    lines: new Map(),
    anchors: [],
    anchorDescendants: new Map(),
    parentKeyCounts: new Map(),
    parentTypes: new Map(),
    unsupportedPosition: false,
  };
  const fragments = createFragments(lines, new Map(), emptyIndex, emptyIndex);
  return {
    before,
    after,
    lines,
    fragments,
    hunks: buildHunks(lines, fragments),
    fallbacks,
    renderable: false,
  };
}

export function createMarkdownDiff(before: string, after: string): MarkdownDiffModel {
  const lines = diffSourceLines(before, after).map((line) => ({ ...line }));
  const fallbacks: MarkdownDiffFallback[] = [];
  let beforeTree: Root;
  let afterTree: Root;
  try {
    beforeTree = parseMarkdown(before);
    afterTree = parseMarkdown(after);
  } catch {
    addFallback(fallbacks, "source", "parse-error");
    return sourceOnlyModel(before, after, lines, fallbacks);
  }

  const beforeIndex = buildStructuralIndex(beforeTree);
  const afterIndex = buildStructuralIndex(afterTree);
  if (beforeIndex.unsupportedPosition || afterIndex.unsupportedPosition) {
    addFallback(fallbacks, "source", "unsupported-position");
  }
  const ambiguous = findAmbiguousParents(beforeIndex, afterIndex, fallbacks);
  const pairs = annotatePairs(lines, beforeIndex, afterIndex, ambiguous);
  const fragments = createFragments(lines, pairs, beforeIndex, afterIndex);

  return {
    before,
    after,
    lines,
    fragments,
    hunks: buildHunks(lines, fragments),
    fallbacks,
    renderable: true,
  };
}

function stripMarkdownPunctuation(value: string): string {
  return value
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/u, "")
    .replace(/^\[[ xX]\]\s*/u, "")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/gu, "$1")
    .replace(/[*_~`#>|]/gu, "")
    .trim();
}

export function deriveMarkdownTitle(markdown: string): string {
  try {
    const root = parseMarkdown(markdown) as unknown as PositionedNode;
    const queue = [...(root.children ?? [])];
    let heading: PositionedNode | undefined;
    while (queue.length > 0 && !heading) {
      const node = queue.shift();
      if (!node) break;
      if (node.type === "heading") heading = node;
      else queue.unshift(...(node.children ?? []));
    }
    if (heading) {
      const title = stripMarkdownPunctuation(visibleText(heading));
      if (title) return title;
    }
  } catch {
    // The exact-source fallback below also defines title behavior for malformed input.
  }

  const firstLine = markdown.split(/\r\n|\r|\n/u).find((line) => line.trim());
  if (firstLine) {
    const title = stripMarkdownPunctuation(firstLine);
    if (title) return title;
  }
  return "Заметка без заголовка";
}

function taskState(markdown: string): boolean | null {
  const match = markdown.match(/^\s*(?:[-*+] |\d+[.)] )\[([ xX])\]\s+/u);
  if (!match) return null;
  return match[1].toLowerCase() === "x";
}

function russianCount(count: number, one: string, few: string, many: string): string {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  if (modulo100 >= 11 && modulo100 <= 14) return `${count} ${many}`;
  if (modulo10 === 1) return `${count} ${one}`;
  if (modulo10 >= 2 && modulo10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function headingName(value: string): string | null {
  const match = value.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
  return match ? stripMarkdownPunctuation(match[1]) : null;
}

function headingSummary(lines: readonly SourceDiffLine[]): string | null {
  const added = lines
    .filter((line) => line.kind === "added")
    .map((line) => headingName(line.value))
    .filter((name): name is string => Boolean(name));
  const removed = lines
    .filter((line) => line.kind === "removed")
    .map((line) => headingName(line.value))
    .filter((name): name is string => Boolean(name));
  if (added.length === 0 && removed.length === 0) return null;

  const clauses: string[] = [];
  const named = [
    ...added.map((name) => ({ kind: "added" as const, name })),
    ...removed.map((name) => ({ kind: "removed" as const, name })),
  ];
  for (const heading of named.slice(0, 2)) {
    clauses.push(
      heading.kind === "added"
        ? `Добавлен раздел «${heading.name}»`
        : `Удалён раздел «${heading.name}»`,
    );
  }
  const remaining = Math.max(0, named.length - 2);
  if (remaining) clauses.push(`и ещё ${remaining}`);
  return clauses.join("; ");
}

export function summarizeMarkdownDiff(model: MarkdownDiffModel): string {
  let marked = 0;
  let unmarked = 0;
  for (const fragment of model.fragments) {
    if (fragment.kind !== "modified" || !fragment.before || !fragment.after) continue;
    const beforeState = taskState(fragment.before.markdown);
    const afterState = taskState(fragment.after.markdown);
    if (beforeState === false && afterState === true) marked += 1;
    if (beforeState === true && afterState === false) unmarked += 1;
  }
  if (marked || unmarked) {
    const clauses: string[] = [];
    if (marked) clauses.push(`Отмечено ${russianCount(marked, "пункт", "пункта", "пунктов")}`);
    if (unmarked) {
      clauses.push(
        `Снята отметка с ${russianCount(unmarked, "пункта", "пунктов", "пунктов")}`,
      );
    }
    return clauses.join("; ");
  }

  const headings = headingSummary(model.lines);
  if (headings) return headings;

  const structured = model.fragments.filter(
    (fragment) => fragment.blockType === "listItem" || fragment.blockType === "tableRow",
  );
  const added = structured.filter((fragment) => fragment.kind === "added").length;
  const removed = structured.filter((fragment) => fragment.kind === "removed").length;
  const changed = structured.filter((fragment) => fragment.kind === "modified").length;
  if (added || removed || changed) {
    const clauses: string[] = [];
    if (added) clauses.push(`Добавлено ${russianCount(added, "строка", "строки", "строк")}`);
    if (removed) clauses.push(`Удалено ${russianCount(removed, "строка", "строки", "строк")}`);
    if (changed) clauses.push(`Изменено ${russianCount(changed, "строка", "строки", "строк")}`);
    return clauses.join("; ");
  }

  const textChanges = model.fragments.filter((fragment) => fragment.kind !== "context").length;
  return `Изменено ${russianCount(textChanges, "фрагмент", "фрагмента", "фрагментов")} текста`;
}
