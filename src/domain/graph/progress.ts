import type { GraphDocument, GraphNode, GraphState } from "./types";

/** Shared by aggregation and bulk edits, preserving node declaration order. */
export function graphTasks(graph: GraphDocument, groupId?: string): GraphNode[] {
  if (groupId === undefined) return graph.nodes.filter(node => node.task);
  const groups = new Map(graph.groups.map(group => [group.id, group]));
  if (!groups.has(groupId)) throw new Error(`Unknown graph group '${groupId}'`);
  return graph.nodes.filter(node => {
    if (!node.task) return false;
    let parentId = node.parentId;
    while (parentId !== null) {
      if (parentId === groupId) return true;
      parentId = groups.get(parentId)?.parentId ?? null;
    }
    return false;
  });
}

export function graphProgress(graph: GraphDocument, groupId?: string): { total: number; done: number; state: GraphState } {
  const tasks = graphTasks(graph, groupId);
  const total = tasks.length;
  const done = tasks.filter(node => node.state === "done").length;
  const state = total > 0 && done === total ? "done" : done > 0 || tasks.some(node => node.state === "doing") ? "doing" : "todo";
  return { total, done, state };
}
