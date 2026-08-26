import type { MarkdownBlock, MarkdownListItem } from "../domain/markdownChecklist";

export interface CompletedChecklistFilterSnapshot {
  hiddenListItemStructuralIds: ReadonlySet<string>;
  hiddenSectionCollapseIds: ReadonlySet<string>;
}

const emptySnapshot: CompletedChecklistFilterSnapshot = {
  hiddenListItemStructuralIds: new Set(),
  hiddenSectionCollapseIds: new Set(),
};

function listItemCanHide(item: MarkdownListItem, hiddenListItemStructuralIds: Set<string>): boolean {
  const childResults = item.children.map((block) => blockChecklistItemsCanHide(block, hiddenListItemStructuralIds));
  const childrenCanHide = childResults.every(Boolean);
  const canHide = item.taskState === "checked" && childrenCanHide;
  if (canHide && item.structuralId) hiddenListItemStructuralIds.add(item.structuralId);
  return canHide;
}

function blockChecklistItemsCanHide(block: MarkdownBlock, hiddenListItemStructuralIds: Set<string>): boolean {
  if (block.type !== "list" && block.type !== "ordered-list") return false;
  const itemResults = (block.items ?? []).map((item) => listItemCanHide(item, hiddenListItemStructuralIds));
  return itemResults.every(Boolean);
}

function blockContainsChecklist(block: MarkdownBlock): boolean {
  return (block.type === "list" || block.type === "ordered-list")
    && (block.items ?? []).some((item) => item.taskState !== undefined || item.children.some(blockContainsChecklist));
}

export function createCompletedChecklistFilterSnapshot(blocks: readonly MarkdownBlock[]): CompletedChecklistFilterSnapshot {
  const hiddenListItemStructuralIds = new Set<string>();
  for (const block of blocks) blockChecklistItemsCanHide(block, hiddenListItemStructuralIds);

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
      if (!blockChecklistItemsCanHide(block, hiddenListItemStructuralIds)) return false;
      containsChecklist ||= blockContainsChecklist(block);
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
