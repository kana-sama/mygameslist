export function reorderProgressItems<T extends { id: string }>(items: readonly T[], activeId: string, overId: string): T[] | null {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return null;
  const reordered = [...items];
  const [active] = reordered.splice(activeIndex, 1);
  reordered.splice(overIndex, 0, active);
  return reordered;
}
