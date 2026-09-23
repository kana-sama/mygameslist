import { describe, expect, it } from "vitest";
import { graphProgress, parseGraph } from "../src/domain/graph";

describe("graph progress", () => {
  it("counts descendant task nodes exactly once, independent of edges", () => {
    const graph = parseGraph(`digraph {
      subgraph outer {
        subgraph inner { a [state=done]; b [kind=note]; a -> b; b -> a; }
        c [state=done]; hint [task=false];
      }
      d [state=done];
    }`);
    expect(graphProgress(graph, "outer")).toEqual({ total: 3, done: 2, state: "doing" });
    expect(graphProgress(graph, "inner")).toEqual({ total: 2, done: 1, state: "doing" });
    expect(graphProgress(graph)).toEqual({ total: 4, done: 3, state: "doing" });
  });
  it("never marks empty and information-only groups complete", () => {
    const graph = parseGraph("digraph { subgraph empty {} subgraph info { a [task=false]; } }");
    for (const id of [undefined, "empty", "info"]) expect(graphProgress(graph, id)).toEqual({ total: 0, done: 0, state: "todo" });
  });
  it("derives todo, partial and completed states including explicit doing", () => {
    for (const [state, expected] of [["todo", "todo"], ["doing", "doing"], ["done", "done"]] as const) {
      expect(graphProgress(parseGraph(`digraph { a [state=${state}] }`)).state).toBe(expected);
    }
  });
  it("rejects unknown group IDs rather than applying a root operation", () => {
    expect(() => graphProgress(parseGraph("digraph { a; }"), "missing")).toThrow(/group/i);
  });
});
