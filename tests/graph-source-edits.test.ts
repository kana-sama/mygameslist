import { describe, expect, it } from "vitest";
import { graphProgress, parseGraph, setGraphGroupState, setGraphTaskState } from "../src/domain/graph";

describe("graph source edits", () => {
  it("replaces only an existing state value including quoted values and CRLF", () => {
    const source = 'digraph {\r\n  "a:b" [label="<b>hi</b>", /*keep*/ state = "doing" /*tail*/];\r\n}';
    expect(setGraphTaskState(source, "a:b", "done")).toBe(source.replace('"doing"', "done"));
    expect(setGraphTaskState(setGraphTaskState(source, "a:b", "done"), "a:b", "todo")).toBe(source.replace('"doing"', "todo"));
  });
  it.each([
    ["a;", "a [state=done];"],
    ["a /*tail*/;", "a [state=done] /*tail*/;"],
    ["a [];", "a [state=done];"],
    ["a [ /*keep*/ ];", "a [state=done /*keep*/ ];"],
    ['a [label="A"];', 'a [label="A", state=done];'],
    ['a [label="A"; /*tail*/ ];', 'a [label="A", state=done; /*tail*/ ];'],
    ['a [label="A", //tail\r\n ];', 'a [label="A", state=done, //tail\r\n ];'],
  ])("inserts state while preserving unrelated bytes: %s", (before, after) => {
    const changed = setGraphTaskState(`digraph { ${before} }`, "a", "done");
    expect(changed).toBe(`digraph { ${after} }`);
    expect(parseGraph(changed).nodes[0].state).toBe("done");
  });
  it("keeps source identical for a request matching the current semantic state", () => {
    for (const source of ['digraph { a; }', 'digraph { a [state="todo"]; }']) expect(setGraphTaskState(source, "a", "todo")).toBe(source);
  });
  it("changes nested tasks in one bulk edit and reopens ancestors", () => {
    const source = 'digraph { subgraph outer { a; subgraph inner { "x\\\"y" [state=doing]; hint [task=false]; } } z; }';
    const changed = setGraphGroupState(source, "outer", "done");
    expect(changed).toBe('digraph { subgraph outer { a [state=done]; subgraph inner { "x\\\"y" [state=done]; hint [task=false]; } } z; }');
    expect(graphProgress(parseGraph(changed), "outer")).toEqual({ total: 2, done: 2, state: "done" });
    const reopened = setGraphTaskState(changed, 'x"y', "todo");
    expect(graphProgress(parseGraph(reopened), "inner").state).toBe("todo");
    expect(graphProgress(parseGraph(reopened), "outer").state).toBe("doing");
    const reset = setGraphGroupState(changed, "outer", "todo");
    expect(graphProgress(parseGraph(reset), "outer")).toEqual({ total: 2, done: 0, state: "todo" });
    expect(parseGraph(reset).nodes.find(n => n.id === "z")!.source.stateValue).toBeUndefined();
  });
  it("does nothing to informational-only groups and rejects invalid targets", () => {
    const source = "digraph { subgraph info { a [task=false]; } b; }";
    expect(setGraphGroupState(source, "info", "done")).toBe(source);
    expect(() => setGraphTaskState(source, "a", "done")).toThrow(/task|informational/i);
    expect(() => setGraphTaskState(source, "missing", "done")).toThrow(/node/i);
    expect(() => setGraphGroupState(source, "missing", "done")).toThrow(/group/i);
    expect(() => setGraphTaskState("broken", "a", "done")).toThrow();
  });
});
