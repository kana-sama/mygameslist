import type { MarkdownBlock, MarkdownListItem } from "../domain/markdownChecklist";

export interface CompletedChecklistFilterSnapshot {
  hiddenListItemStructuralIds: ReadonlySet<string>;
  hiddenSectionCollapseIds: ReadonlySet<string>;
}

const emptySnapshot: CompletedChecklistFilterSnapshot = {
  hiddenListItemStructuralIds: new Set(),
  hiddenSectionCollapseIds: new Set(),
};

interface ChecklistHideAnalysis {
  canHide: boolean;
  containsChecklist: boolean;
}

function listItemChecklistHideAnalysis(item: MarkdownListItem, hiddenListItemStructuralIds: Set<string>): ChecklistHideAnalysis {
  const childResults = item.children.map((block) => blockChecklistHideAnalysis(block, hiddenListItemStructuralIds));
  const childrenCanHide = childResults.every((result) => result.canHide);
  const containsChecklist = item.taskState !== undefined || childResults.some((result) => result.containsChecklist);
  const canHide = item.taskState !== undefined
    ? item.taskState === "checked" && childrenCanHide
    : item.children.length > 0 && childrenCanHide && containsChecklist;
  if (canHide && item.structuralId) hiddenListItemStructuralIds.add(item.structuralId);
  return { canHide, containsChecklist };
}

function blockChecklistHideAnalysis(block: MarkdownBlock, hiddenListItemStructuralIds: Set<string>): ChecklistHideAnalysis {
  if (block.type !== "list" && block.type !== "ordered-list") return { canHide: false, containsChecklist: false };
  const items = block.items ?? [];
  const itemResults = items.map((item) => listItemChecklistHideAnalysis(item, hiddenListItemStructuralIds));
  return {
    canHide: items.length > 0 && itemResults.every((result) => result.canHide),
    containsChecklist: itemResults.some((result) => result.containsChecklist),
  };
}

export function createCompletedChecklistFilterSnapshot(blocks: readonly MarkdownBlock[]): CompletedChecklistFilterSnapshot {
  const hiddenListItemStructuralIds = new Set<string>();
  for (const block of blocks) blockChecklistHideAnalysis(block, hiddenListItemStructuralIds);

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
      const analysis = blockChecklistHideAnalysis(block, hiddenListItemStructuralIds);
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
  return { hiddenListItemStructuralIds, hiddenSectionCollapseIds };
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

export function emptyCompletedChecklistFilterSnapshot(): CompletedChecklistFilterSnapshot {
  return emptySnapshot;
}
