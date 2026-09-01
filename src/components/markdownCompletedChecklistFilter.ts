import type { MarkdownBlock, MarkdownListItem, MarkdownTableGroup, MarkdownTableRow, MarkdownTableSection } from "../domain/markdownChecklist";

export interface CompletedChecklistFilterSnapshot {
  hiddenListItemStructuralIds: ReadonlySet<string>;
  hiddenSectionCollapseIds: ReadonlySet<string>;
  hiddenTableGroupCollapseIds: ReadonlySet<string>;
  hiddenTableRowStructuralIds: ReadonlySet<string>;
}

const emptySnapshot: CompletedChecklistFilterSnapshot = {
  hiddenListItemStructuralIds: new Set(),
  hiddenSectionCollapseIds: new Set(),
  hiddenTableGroupCollapseIds: new Set(),
  hiddenTableRowStructuralIds: new Set(),
};

interface ChecklistHideAnalysis {
  canHide: boolean;
  containsChecklist: boolean;
}

function listItemChecklistHideAnalysis(
  item: MarkdownListItem,
  hiddenListItemStructuralIds: Set<string>,
  hiddenTableRowStructuralIds: Set<string>,
  hiddenTableGroupCollapseIds: Set<string>,
): ChecklistHideAnalysis {
  const childResults = item.children.map((block) => blockChecklistHideAnalysis(
    block,
    hiddenListItemStructuralIds,
    hiddenTableRowStructuralIds,
    hiddenTableGroupCollapseIds,
  ));
  const childrenCanHide = childResults.every((result) => result.canHide);
  const containsChecklist = item.taskState !== undefined || childResults.some((result) => result.containsChecklist);
  const canHide = item.taskState !== undefined
    ? item.taskState === "checked" && childrenCanHide
    : item.children.length > 0 && childrenCanHide && containsChecklist;
  if (canHide && item.structuralId) hiddenListItemStructuralIds.add(item.structuralId);
  return { canHide, containsChecklist };
}

function tableRowCanHide(row: MarkdownTableRow): boolean {
  const taskCells = row.cells.filter((cell) => cell.taskState !== undefined);
  return taskCells.length > 0 && taskCells.every((cell) => cell.taskState === "checked");
}

function tableSectionChecklistHideAnalysis(
  section: MarkdownTableSection,
  hiddenTableRowStructuralIds: Set<string>,
  hiddenTableGroupCollapseIds: Set<string>,
): ChecklistHideAnalysis {
  const rowsCanHide = section.rows.map((row) => tableRowCanHide(row));
  for (const [index, row] of section.rows.entries()) {
    if (rowsCanHide[index] && row.structuralId) hiddenTableRowStructuralIds.add(row.structuralId);
  }
  const canHide = section.rows.length > 0 && rowsCanHide.every(Boolean);
  if (section.type === "group" && canHide && section.collapseId) hiddenTableGroupCollapseIds.add(section.collapseId);
  return { canHide, containsChecklist: section.rows.some((row) => row.cells.some((cell) => cell.taskState !== undefined)) };
}

function blockChecklistHideAnalysis(
  block: MarkdownBlock,
  hiddenListItemStructuralIds: Set<string>,
  hiddenTableRowStructuralIds: Set<string>,
  hiddenTableGroupCollapseIds: Set<string>,
): ChecklistHideAnalysis {
  if (block.type === "table") {
    const sections = block.table?.sections ?? [];
    const analyses = sections.map((section) => tableSectionChecklistHideAnalysis(
      section,
      hiddenTableRowStructuralIds,
      hiddenTableGroupCollapseIds,
    ));
    const rows = sections.flatMap((section) => section.rows);
    return {
      canHide: rows.length > 0 && rows.every((row) => tableRowCanHide(row)),
      containsChecklist: analyses.some((analysis) => analysis.containsChecklist),
    };
  }
  if (block.type !== "list" && block.type !== "ordered-list") return { canHide: false, containsChecklist: false };
  const items = block.items ?? [];
  const itemResults = items.map((item) => listItemChecklistHideAnalysis(
    item,
    hiddenListItemStructuralIds,
    hiddenTableRowStructuralIds,
    hiddenTableGroupCollapseIds,
  ));
  return {
    canHide: items.length > 0 && itemResults.every((result) => result.canHide),
    containsChecklist: itemResults.some((result) => result.containsChecklist),
  };
}

export function createCompletedChecklistFilterSnapshot(blocks: readonly MarkdownBlock[]): CompletedChecklistFilterSnapshot {
  const hiddenListItemStructuralIds = new Set<string>();
  const hiddenTableRowStructuralIds = new Set<string>();
  const hiddenTableGroupCollapseIds = new Set<string>();
  for (const block of blocks) blockChecklistHideAnalysis(
    block,
    hiddenListItemStructuralIds,
    hiddenTableRowStructuralIds,
    hiddenTableGroupCollapseIds,
  );

  const hiddenSectionCollapseIds = new Set<string>();
  const sectionEnd = (headingIndex: number): number => {
    const depth = blocks[headingIndex].depth ?? 0;
    let index = headingIndex + 1;
    while (index < blocks.length) {
      const block = blocks[index];
      if (block.type === "heading" && (block.depth ?? 0) <= depth) break;
      index += 1;
    }
    return index;
  };
  const sectionCanHide = (headingIndex: number): boolean => {
    const heading = blocks[headingIndex];
    const depth = heading.depth ?? 0;
    if (heading.type !== "heading" || depth < 2) return false;
    const end = sectionEnd(headingIndex);
    let containsChecklist = false;
    let index = headingIndex + 1;
    while (index < end) {
      const block = blocks[index];
      if (block.type === "heading") {
        const childEnd = sectionEnd(index);
        if (!sectionCanHide(index)) return false;
        containsChecklist = true;
        index = childEnd;
        continue;
      }
      const analysis = blockChecklistHideAnalysis(
        block,
        hiddenListItemStructuralIds,
        hiddenTableRowStructuralIds,
        hiddenTableGroupCollapseIds,
      );
      if (!analysis.canHide) return false;
      containsChecklist ||= analysis.containsChecklist;
      index += 1;
    }
    if (!containsChecklist) return false;
    if (heading.collapseId) hiddenSectionCollapseIds.add(heading.collapseId);
    return true;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    if (blocks[index].type === "heading") sectionCanHide(index);
  }
  return { hiddenListItemStructuralIds, hiddenSectionCollapseIds, hiddenTableGroupCollapseIds, hiddenTableRowStructuralIds };
}

export function completedChecklistItemIsHidden(snapshot: CompletedChecklistFilterSnapshot, item: MarkdownListItem): boolean {
  return Boolean(item.structuralId && snapshot.hiddenListItemStructuralIds.has(item.structuralId));
}

export function completedChecklistSectionIsHidden(snapshot: CompletedChecklistFilterSnapshot, block: MarkdownBlock): boolean {
  return block.type === "heading" && Boolean(block.collapseId && snapshot.hiddenSectionCollapseIds.has(block.collapseId));
}

export function completedChecklistHiddenItemCount(snapshot: CompletedChecklistFilterSnapshot, block: MarkdownBlock): number {
  return (block.items ?? []).filter((item) => completedChecklistItemIsHidden(snapshot, item)).length;
}

export function completedChecklistTableRowIsHidden(snapshot: CompletedChecklistFilterSnapshot, row: MarkdownTableRow): boolean {
  return Boolean(row.structuralId && snapshot.hiddenTableRowStructuralIds.has(row.structuralId));
}

export function completedChecklistTableGroupIsHidden(snapshot: CompletedChecklistFilterSnapshot, section: MarkdownTableGroup): boolean {
  return Boolean(section.collapseId && snapshot.hiddenTableGroupCollapseIds.has(section.collapseId));
}

export function completedChecklistHiddenTableRowStructuralIds(
  snapshot: CompletedChecklistFilterSnapshot,
  rows: readonly MarkdownTableRow[],
): string[] {
  return rows.flatMap((row) => row.structuralId && completedChecklistTableRowIsHidden(snapshot, row) ? [row.structuralId] : []);
}

export function emptyCompletedChecklistFilterSnapshot(): CompletedChecklistFilterSnapshot {
  return emptySnapshot;
}
