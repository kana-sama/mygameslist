export type GraphKind = "normal" | "special" | "milestone" | "note";
export type GraphState = "todo" | "doing" | "done";

/** End-exclusive UTF-16 offsets, suitable for source.slice and Monaco. */
export interface GraphSourceRange { start: number; end: number }
export interface GraphNodeSource {
  declaration: GraphSourceRange;
  identifier: GraphSourceRange;
  attributes?: GraphSourceRange;
  stateValue?: GraphSourceRange;
  /** Inserts an absent state without rewriting existing tokens or comments. */
  stateInsertion: { offset: number; prefix: string; suffix: string };
}
export interface GraphNode {
  id: string;
  label: string;
  subtitle?: string;
  kind: GraphKind;
  task: boolean;
  state: GraphState;
  parentId: string | null;
  source: GraphNodeSource;
}
export interface GraphGroup {
  id: string;
  label?: string;
  kind: "group" | "section";
  layout: "flow" | "grid";
  parentId: string | null;
  childIds: string[];
  source: GraphSourceRange;
}
export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  source: GraphSourceRange;
}
export interface GraphDocument {
  label?: string;
  nodes: GraphNode[];
  groups: GraphGroup[];
  edges: GraphEdge[];
  rootIds: string[];
}
export interface GraphDiagnostic {
  message: string;
  line: number;
  column: number;
  offset: number;
  length: number;
}
