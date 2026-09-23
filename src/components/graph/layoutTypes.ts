import type { GraphDocument } from "../../domain/graph";

export interface GraphBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface GraphNodeGeometry extends GraphBox {
  labelLines: string[];
  subtitleLines: string[];
}
export interface GraphGroupGeometry extends GraphBox {
  depth: number;
  labelLines: string[];
}
export interface GraphEdgeGeometry {
  index: number;
  from: string;
  to: string;
  path: string;
  points: number[][];
  label?: string;
  labelLines: string[];
  labelBox?: GraphBox;
  x: number;
  y: number;
}
export interface GraphGeometry {
  width: number;
  height: number;
  nodes: GraphNodeGeometry[];
  groups: GraphGroupGeometry[];
  edges: GraphEdgeGeometry[];
}
export interface GraphLayoutRequest {
  id: number;
  key: string;
  graph: GraphDocument;
  width: number;
  font?: string;
}
export type GraphLayoutResponse =
  | { id: number; key: string; geometry: GraphGeometry }
  | { id: number; key: string; error: string };
export interface GraphEngine {
  renderJSON(
    source: string,
    options?: { engine?: string; yInvert?: boolean },
  ): unknown;
}
