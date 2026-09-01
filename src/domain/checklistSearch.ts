import { fuzzySearch, type FuzzySearchField } from "./fuzzySearch";
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownTableCell,
  type MarkdownTaskState,
} from "./markdownChecklist";
import {
  collectMarkdownInlineAnnotations,
  markdownInlinePlainText,
  type MarkdownInlineAnnotation,
} from "./markdownInlineAnnotations";
import {
  markdownRichTooltipDefinitionBodyRanges,
  parseMarkdownRichTooltipBody,
  parseMarkdownRichTooltips,
  type ParsedMarkdownRichTooltips,
} from "./markdownRichTooltips";

export type ChecklistSearchAnnotation =
  | {
    id: string;
    kind: "simple";
    labelMarkdown: string;
    labelText: string;
    plainText: string;
    sourceOrder: number;
  }
  | {
    bodyMarkdown: string;
    id: string;
    kind: "rich";
    labelMarkdown: string;
    labelText: string;
    plainText: string;
    sourceOrder: number;
  };

export interface ChecklistSearchEntry {
  ancestorCollapseIds: readonly string[];
  annotations: readonly ChecklistSearchAnnotation[];
  id: string;
  noteClientId: string;
  noteId?: string;
  noteOrder: number;
  path: string;
  sourceColumn: number;
  sourceLine: number;
  state: MarkdownTaskState;
  structuralGuard: string;
  structuralItemId?: string;
  text: string;
  textMarkdown: string;
}

export interface ChecklistSearchSourceNote {
  bodyMarkdown: string;
  clientId: string;
  id?: string;
}

export interface ChecklistSearchResult {
  entry: ChecklistSearchEntry;
  matchedAnnotationIds: readonly string[];
  score: number;
}

interface HeadingContext {
  block: MarkdownBlock;
  label: string;
}

interface EntryContext {
  ancestorCollapseIds: readonly string[];
  pathParts: readonly string[];
}

function compactPlainText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function withoutRichTooltipDefinitionBodies(source: string): string {
  const ranges = markdownRichTooltipDefinitionBodyRanges(source);
  if (!ranges.length) return source;
  let cursor = 0;
  let result = "";
  for (const range of ranges) {
    const sourceStart = Math.min(source.length, range.sourceStart);
    const sourceEnd = Math.min(source.length, range.sourceEnd);
    if (sourceStart >= source.length || sourceEnd <= cursor) continue;
    result += source.slice(cursor, sourceStart);
    result += source.slice(sourceStart, sourceEnd).replace(/[^\r\n]/g, " ");
    cursor = sourceEnd;
  }
  return `${result}${source.slice(cursor)}`;
}

function blockMarkdownPlainText(markdown: string): string {
  return compactPlainText(markdown.split(/\r?\n/).map((line) => {
    const visibleLine = line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\[[ xX-]\](?:\s+|$)/, "")
      .replace(/^:\s+/, "");
    return markdownInlinePlainText(visibleLine);
  }).join(" "));
}

function richTooltipPlainText(bodyMarkdown: string): string {
  return compactPlainText(parseMarkdownRichTooltipBody(bodyMarkdown).flatMap((part) => {
    if (part.type === "markdown") return [blockMarkdownPlainText(part.markdown)];
    return part.items.flatMap((item) => [
      blockMarkdownPlainText(item.termMarkdown),
      blockMarkdownPlainText(item.descriptionMarkdown),
    ]);
  }).filter(Boolean).join(" "));
}

function richAnnotationIsValid(annotation: Extract<MarkdownInlineAnnotation, { kind: "rich" }>, parsed: ParsedMarkdownRichTooltips): boolean {
  const definition = parsed.definitions.get(annotation.anchor);
  return Boolean(
    annotation.anchor
    && definition?.bodyMarkdown.trim()
    && !parsed.duplicateAnchors.has(annotation.anchor)
    && !collectMarkdownInlineAnnotations(definition.bodyMarkdown).some((nested) => nested.kind === "rich"),
  );
}

function checklistAnnotations(
  textMarkdown: string,
  entryId: string,
  richTooltips: ParsedMarkdownRichTooltips,
): ChecklistSearchAnnotation[] {
  const result: ChecklistSearchAnnotation[] = [];
  for (const [sourceOrder, annotation] of collectMarkdownInlineAnnotations(textMarkdown).entries()) {
    const id = `${entryId}:annotation:${sourceOrder}`;
    if (annotation.kind === "simple") {
      if (!annotation.description.trim()) continue;
      result.push({
        id,
        kind: "simple",
        labelMarkdown: annotation.labelMarkdown,
        labelText: annotation.labelText,
        plainText: annotation.description,
        sourceOrder,
      });
      continue;
    }
    if (!richAnnotationIsValid(annotation, richTooltips)) continue;
    const definition = richTooltips.definitions.get(annotation.anchor)!;
    result.push({
      bodyMarkdown: definition.bodyMarkdown,
      id,
      kind: "rich",
      labelMarkdown: annotation.labelMarkdown,
      labelText: annotation.labelText,
      plainText: richTooltipPlainText(definition.bodyMarkdown),
      sourceOrder,
    });
  }
  return result;
}

export function checklistSearchEntryId(noteClientId: string, sourceLine: number, sourceColumn: number): string {
  return `checklist:${encodeURIComponent(noteClientId)}:${sourceLine}:${sourceColumn}`;
}

export function checklistSearchStructuralGuard(kind: "list" | "table", markerStableSource: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const value = `${kind}\u0000${markerStableSource}`;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${kind}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}:${value.length.toString(36)}`;
}

function headingCollapseIds(headings: readonly HeadingContext[]): string[] {
  return headings.flatMap(({ block }) => block.checklistProgress && block.collapseId ? [block.collapseId] : []);
}

function pathPartsForHeadings(titleBlock: MarkdownBlock | undefined, title: string, headings: readonly HeadingContext[]): string[] {
  return [title, ...headings.flatMap((heading) => heading.block === titleBlock ? [] : [heading.label])];
}

function createEntry(
  note: ChecklistSearchSourceNote,
  noteOrder: number,
  sourceLine: number,
  sourceColumn: number,
  state: MarkdownTaskState,
  textMarkdown: string,
  context: EntryContext,
  richTooltips: ParsedMarkdownRichTooltips,
  structuralGuard: string,
  structuralItemId?: string,
): ChecklistSearchEntry {
  const id = checklistSearchEntryId(note.clientId, sourceLine, sourceColumn);
  return {
    ancestorCollapseIds: context.ancestorCollapseIds,
    annotations: checklistAnnotations(textMarkdown, id, richTooltips),
    id,
    noteClientId: note.clientId,
    ...(note.id === undefined ? {} : { noteId: note.id }),
    noteOrder,
    path: context.pathParts.join(" › "),
    sourceColumn,
    sourceLine,
    state,
    structuralGuard,
    ...(structuralItemId === undefined ? {} : { structuralItemId }),
    text: compactPlainText(markdownInlinePlainText(textMarkdown)),
    textMarkdown,
  };
}

function collectListEntries(
  block: MarkdownBlock,
  note: ChecklistSearchSourceNote,
  noteOrder: number,
  context: EntryContext,
  richTooltips: ParsedMarkdownRichTooltips,
  entries: ChecklistSearchEntry[],
): void {
  for (const item of block.items ?? []) {
    if (item.taskState !== undefined && item.taskSourceColumn !== undefined && !item.openMarker) {
      entries.push(createEntry(
        note,
        noteOrder,
        item.sourceLine,
        item.taskSourceColumn,
        item.taskState,
        item.value,
        context,
        richTooltips,
        checklistSearchStructuralGuard("list", item.value),
        item.structuralId,
      ));
    }

    const childContext = item.collapseId
      ? {
        ancestorCollapseIds: [...context.ancestorCollapseIds, item.collapseId],
        pathParts: [...context.pathParts, compactPlainText(markdownInlinePlainText(item.value))],
      }
      : context;
    for (const child of item.children) {
      collectListEntries(child, note, noteOrder, childContext, richTooltips, entries);
    }
  }
}

function tableCellTextMarkdown(cell: MarkdownTableCell): string {
  return cell.value;
}

function collectTableEntries(
  block: MarkdownBlock,
  note: ChecklistSearchSourceNote,
  noteOrder: number,
  context: EntryContext,
  richTooltips: ParsedMarkdownRichTooltips,
  entries: ChecklistSearchEntry[],
): void {
  for (const section of block.table?.sections ?? []) {
    const sectionContext = section.type === "group" && section.collapseId
      ? {
        ancestorCollapseIds: [...context.ancestorCollapseIds, section.collapseId],
        pathParts: [...context.pathParts, compactPlainText(markdownInlinePlainText(section.title.value))],
      }
      : context;
    for (const row of section.rows) {
      for (const cell of row.cells) {
        if (cell.taskState === undefined || cell.taskSourceColumn === undefined || cell.sourceLine === undefined) continue;
        entries.push(createEntry(
          note,
          noteOrder,
          cell.sourceLine,
          cell.taskSourceColumn,
          cell.taskState,
          tableCellTextMarkdown(cell),
          sectionContext,
          richTooltips,
          checklistSearchStructuralGuard("table", cell.sourceValue ?? cell.value),
          row.structuralId,
        ));
      }
    }
  }
}

export function buildChecklistSearchIndex(notes: readonly ChecklistSearchSourceNote[]): ChecklistSearchEntry[] {
  return notes.flatMap((note, noteOrder) => {
    const richTooltips = parseMarkdownRichTooltips(note.bodyMarkdown);
    const blocks = parseMarkdownBlocks(withoutRichTooltipDefinitionBodies(richTooltips.visibleMarkdown));
    const titleBlock = blocks.find((block) => block.type === "heading");
    const title = titleBlock ? compactPlainText(markdownInlinePlainText(titleBlock.value ?? "")) : `Заметка ${noteOrder + 1}`;
    const headings: HeadingContext[] = [];
    const entries: ChecklistSearchEntry[] = [];

    for (const block of blocks) {
      if (block.type === "heading") {
        const depth = block.depth ?? 0;
        while (headings.length && (headings.at(-1)?.block.depth ?? 0) >= depth) headings.pop();
        headings.push({ block, label: compactPlainText(markdownInlinePlainText(block.value ?? "")) });
        continue;
      }
      if (block.type !== "list" && block.type !== "ordered-list" && block.type !== "table") continue;
      const context: EntryContext = {
        ancestorCollapseIds: headingCollapseIds(headings),
        pathParts: pathPartsForHeadings(titleBlock, title, headings),
      };
      if (block.type === "table") collectTableEntries(block, note, noteOrder, context, richTooltips, entries);
      else collectListEntries(block, note, noteOrder, context, richTooltips, entries);
    }
    return entries;
  });
}

type ChecklistFieldId = "item" | `annotation:${string}`;

function checklistSearchFields(entry: ChecklistSearchEntry): FuzzySearchField<ChecklistFieldId>[] {
  return [
    { id: "item", priority: "primary", text: entry.text },
    ...entry.annotations.map((annotation) => ({
      id: `annotation:${annotation.id}` as const,
      priority: "secondary" as const,
      text: annotation.plainText,
    })),
  ];
}

export function searchChecklistEntries(entries: readonly ChecklistSearchEntry[], query: string): ChecklistSearchResult[] {
  if (!query.trim()) return [];
  return entries.flatMap((entry) => {
    const match = fuzzySearch(query, checklistSearchFields(entry));
    if (!match) return [];
    return [{
      entry,
      matchedAnnotationIds: match.matchedFieldIds.flatMap((fieldId) =>
        fieldId === "item" ? [] : [fieldId.slice("annotation:".length)]
      ),
      score: match.score,
    }];
  }).sort((left, right) =>
    left.score - right.score
    || left.entry.noteOrder - right.entry.noteOrder
    || left.entry.sourceLine - right.entry.sourceLine
    || left.entry.sourceColumn - right.entry.sourceColumn
  );
}
