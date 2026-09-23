import { parseGraph } from "./parser";
import { graphTasks } from "./progress";
import type { GraphNode, GraphState } from "./types";

interface Edit { start: number; end: number; text: string }
function stateEdit(node: GraphNode, state: GraphState): Edit | undefined {
  if (node.state === state) return undefined;
  if (node.source.stateValue) return { ...node.source.stateValue, text: state };
  const { offset, prefix, suffix } = node.source.stateInsertion;
  return { start: offset, end: offset, text: `${prefix}${state}${suffix}` };
}
function applyEdits(source: string, nodes: GraphNode[], state: GraphState): string {
  const edits = nodes.map(node => stateEdit(node, state)).filter((edit): edit is Edit => edit !== undefined);
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
export function setGraphTaskState(source: string, id: string, state: GraphState): string {
  const graph = parseGraph(source);
  const node = graph.nodes.find(candidate => candidate.id === id);
  if (!node) throw new Error(`Unknown graph node '${id}'`);
  if (!node.task) throw new Error(`Informational node '${id}' is not a task`);
  return applyEdits(source, [node], state);
}
export function setGraphGroupState(source: string, id: string, state: "todo" | "done"): string {
  return applyEdits(source, graphTasks(parseGraph(source), id), state);
}
