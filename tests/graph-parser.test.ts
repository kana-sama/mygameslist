import { describe, expect, it } from "vitest";
import { GraphParseError, parseGraph, validateGraph } from "../src/domain/graph";

const errors = (body: string) => validateGraph(`digraph { ${body} }`);
describe("graph language", () => {
  it("accepts empty source and empty or named graphs", () => {
    for (const source of ["", " \r\n", "// empty", "digraph {}", 'digraph "named graph" {}']) {
      expect(parseGraph(source)).toMatchObject({ nodes: [], groups: [], edges: [], rootIds: [] });
    }
  });
  it("preserves ownership and authored order for nested containers, grids, and sections", () => {
    const graph = parseGraph(`digraph Route {
      graph [label="Путь"];
      subgraph outer {
        subgraph inner { layout=grid; a [label="Шаг", subtitle="Место"]; b [kind=special]; }
        c [kind=milestone, state=doing]; a -> b -> c [label="далее"];
      }
      subgraph next { d [kind=note; task=false]; }
      outer -> next;
      subgraph section { graph [kind=section, layout=grid, label="Другие"]; e; }
    }`);
    expect(graph.label).toBe("Путь");
    expect(graph.rootIds).toEqual(["outer", "next", "section"]);
    expect(graph.nodes.map(n => n.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(graph.groups.map(g => [g.id, g.childIds, g.parentId])).toEqual([
      ["outer", ["inner", "c"], null], ["inner", ["a", "b"], "outer"],
      ["next", ["d"], null], ["section", ["e"], null],
    ]);
    expect(graph.groups[0].label).toBeUndefined();
    expect(graph.nodes[0]).toMatchObject({ label: "Шаг", subtitle: "Место", kind: "normal", task: true, state: "todo", parentId: "inner" });
    expect(graph.edges.map(e => [e.from, e.to, e.label])).toEqual([["a", "b", "далее"], ["b", "c", "далее"], ["outer", "next", undefined]]);
  });
  it("supports forward references, cross-container edges, cycles, self and parallel edges", () => {
    const graph = parseGraph("digraph { a -> b; a -> b; b -> a; a -> a; subgraph one { a; } subgraph two { b; } }");
    expect(graph.edges).toHaveLength(4);
  });
  it("keeps quoted HTML-like text and unusual IDs literal, with supported escapes", () => {
    const graph = parseGraph(String.raw`digraph { "__proto__" [label="<b>Кот</b>\n\"да\"\\N"]; constructor; "node"; "a:b"; "a:b" -> constructor; }`);
    expect(graph.nodes[0].label).toBe('<b>Кот</b>\n"да"\\N');
    expect(graph.nodes.map(n => n.id)).toEqual(["__proto__", "constructor", "node", "a:b"]);
  });
  it("carries exact source ranges for editing and diagnostics", () => {
    const source = 'digraph {\r\n  "a b" [label="hi", state = "done"];\r\n}';
    const node = parseGraph(source).nodes[0];
    expect(source.slice(node.source.identifier.start, node.source.identifier.end)).toBe('"a b"');
    expect(source.slice(node.source.stateValue!.start, node.source.stateValue!.end)).toBe('"done"');
    const diagnostic = validateGraph('digraph {\r\n  a [color=red];\r\n}')[0];
    expect(diagnostic).toMatchObject({ line: 2, column: 6, offset: 16, length: 5 });
    expect(diagnostic.message).toMatch(/color/);
    expect(() => parseGraph('digraph { a [color=red]; }')).toThrow(GraphParseError);
  });
  it.each([
    ['a [color=red]', /color/], ['a [shape=box]', /shape/], ['a [URL="https:\/\/x"]', /URL/],
    ['a [label=<b>]', /Unsupported|Unexpected/], ['a:p -> a', /Unsupported|Unexpected/],
    ['node [kind=normal]', /node|default/i], ['edge [label="x"]', /edge|default/i],
    ['subgraph { a; }', /identifier|named/i], ['a -> b; a;', /b/],
    ['a; a;', /duplicate/i], ['a; subgraph a { b; }', /duplicate/i],
    ['a [label="A", label="B"]', /duplicate/i], ['label="A"; graph [label="B"]', /duplicate/i],
    ['rankdir=LR', /rankdir/], ['kind=section', /kind/],
    ['a [kind=gold]', /kind/], ['a [state=partial]', /state/], ['a [task=yes]', /task/],
    ['a [task=false, state=todo]', /state/], ['subgraph g { layout=columns; a; }', /layout/],
    ['subgraph g { kind=box; a; }', /kind/], ['subgraph s { kind=section; a; }', /label/],
    ['subgraph s { kind=section; label=" "; a; }', /label/],
    ['subgraph g { subgraph s { kind=section; label="S"; a; } }', /root/],
    ['subgraph s { kind=section; label="S"; a; } b; s -> b', /section/],
    ['subgraph g {} b; b -> g', /empty/], ['subgraph g { a; } g -> a', /ancestor|contain/i],
    ['subgraph g { subgraph h { a; } } h -> g', /ancestor|contain/i],
    ['a [label="bad\\q"]', /escape/i], ['a [label="x]', /unterminated/i], ['/* broken', /unterminated/i],
    ['a [label="x"][state=done]', /Unexpected|unsupported/i],
  ])("rejects invalid grammar or semantics: %s", (body, pattern) => {
    expect(errors(body)[0]?.message).toMatch(pattern);
  });
  it("rejects a second graph and unsupported undirected grammar", () => {
    expect(validateGraph("digraph {} digraph {}")).not.toEqual([]);
    expect(validateGraph("graph { a -- b }")).not.toEqual([]);
  });
  it("bounds UTF-8 source size, node, edge, group, and nesting counts", () => {
    expect(validateGraph(`digraph {/*${"я".repeat(51200)}*/}`)[0].message).toMatch(/100 KiB/);
    expect(errors(Array.from({ length: 301 }, (_, i) => `n${i};`).join(""))[0].message).toMatch(/300 nodes/);
    expect(errors(`a;${"a -> a;".repeat(601)}`)[0].message).toMatch(/600 edges/);
    expect(errors(Array.from({ length: 51 }, (_, i) => `subgraph g${i} {}`).join(""))[0].message).toMatch(/50 subgraphs/);
    const nested = (n: number) => Array.from({ length: n }, (_, i) => `subgraph g${i} {`).join("") + "a;" + "}".repeat(n);
    expect(errors(nested(8))).toEqual([]);
    expect(errors(nested(9))[0].message).toMatch(/8.*nest/i);
  });
  it("bounds every label/subtitle to 500 Unicode characters", () => {
    expect(errors(`a [label="${"😀".repeat(500)}"]`)).toEqual([]);
    for (const body of [`label="${"x".repeat(501)}"`, `a [subtitle="${"x".repeat(501)}"]`, `a [label="${"x".repeat(501)}"]`, `a;b;a -> b [label="${"x".repeat(501)}"]`, `subgraph g {label="${"x".repeat(501)}"}`]) {
      expect(errors(body)[0].message).toMatch(/500/);
    }
    expect(errors(`"${"x".repeat(501)}"`)[0].message).toMatch(/500/);
  });
});
