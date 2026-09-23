import { describe, expect, it } from "vitest";
import { instance } from "@viz-js/viz";
import { parseGraph, setGraphTaskState } from "../src/domain/graph";
import { graphLayoutKey, layoutGraph } from "../src/components/graph/layout";

const engine = instance();
const layout = async (source: string, width: number) =>
  layoutGraph(parseGraph(source), width, await engine);

describe("adaptive horizontal flow paths", () => {
  it("centers a fitting path in dependency order while returning declaration order", async () => {
    const result = await layout("digraph { c; a; b; a->b->c; }", 790);
    const [c, a, b] = result.nodes;
    expect(result.nodes.map((node) => node.id)).toEqual(["c", "a", "b"]);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(b.x + b.width).toBeLessThan(c.x);
    expect(a.x).toBeCloseTo(790 - c.x - c.width);
    expect(result.width).toBe(790);
    for (const [index, from, to] of [[0, a, b], [1, b, c]] as const) {
      const edge = result.edges[index];
      expect(edge.points[0][0]).toBeCloseTo(from.x + from.width, 0);
      expect(edge.points.at(-1)![0]).toBeCloseTo(to.x, 0);
      expect(edge.path).not.toContain("NaN");
    }
  });

  it("switches at the exact measured fit without shrinking cards", async () => {
    const source = "digraph { a;b;c; a->b->c; }";
    const exact = await layout(source, 704);
    const below = await layout(source, 703);
    expect(new Set(exact.nodes.map((node) => node.y)).size).toBe(1);
    expect(new Set(below.nodes.map((node) => node.y)).size).toBe(3);
    expect(exact.nodes.map((node) => node.width)).toEqual([220, 220, 220]);
    expect(below.nodes.map((node) => node.width)).toEqual([220, 220, 220]);
    expect(below.height).toBeGreaterThan(exact.height);
  });

  it("keeps connected group boundaries and uses each group's padded inner width", async () => {
    const source = `digraph {
      subgraph first { label="First chapter"; a;b;c; a->b->c; }
      subgraph second { label="Second chapter"; d;e; d->e; }
      first->second;
    }`;
    const wide = await layout(source, 736);
    const below = await layout(source, 735);
    const narrow = await layout(source, 360);
    expect(wide.groups.map((group) => group.id)).toEqual(["first", "second"]);
    expect(wide.groups[1].y).toBeGreaterThan(wide.groups[0].y + wide.groups[0].height);
    expect(new Set(wide.nodes.slice(0, 3).map((node) => node.y)).size).toBe(1);
    expect(new Set(below.nodes.slice(0, 3).map((node) => node.y)).size).toBe(3);
    expect(wide.nodes[3].y).toBe(wide.nodes[4].y);
    expect(narrow.nodes[3].y).toBeLessThan(narrow.nodes[4].y);
    expect(wide.edges.at(-1)!.from).toBe("first");
    expect(wide.edges.at(-1)!.to).toBe("second");
    // Graphviz clips the tiny group-boundary anchors with pixel rounding.
    expect(Math.abs(wide.edges.at(-1)!.points[0][1] - wide.groups[0].y - wide.groups[0].height)).toBeLessThan(2);
    expect(Math.abs(wide.edges.at(-1)!.points.at(-1)![1] - wide.groups[1].y)).toBeLessThan(2);
    for (const result of [wide, below, narrow]) {
      expect(result.width).toBe(result.groups[0].width);
      for (const node of result.nodes) {
        const parent = result.groups[node.id < "d" ? 0 : 1];
        expect(node.x).toBeGreaterThanOrEqual(parent.x + 16);
        expect(node.x + node.width).toBeLessThanOrEqual(parent.x + parent.width - 16);
        expect(node.y + node.height).toBeLessThanOrEqual(parent.y + parent.height - 16);
      }
    }
  });

  it("supports sections and nested groups, aligning unequal card centers", async () => {
    const source = `digraph { subgraph chapter { kind=section; label="Chapter";
      subgraph outer { subgraph inner {
        a[label="First",subtitle="A long explanatory subtitle that wraps across several lines"];
        b[label="Second"]; a->b;
      } }
    } }`;
    const wide = await layout(source, 526);
    const narrow = await layout(source, 525);
    const [a, b] = wide.nodes;
    expect(a.height).toBeGreaterThan(b.height);
    expect(a.y + a.height / 2).toBe(b.y + b.height / 2);
    expect(a.x).toBeLessThan(b.x);
    expect(narrow.nodes[0].y + narrow.nodes[0].height).toBeLessThan(narrow.nodes[1].y);
    expect(wide.groups.map((group) => group.id)).toEqual(["chapter", "outer", "inner"]);
  });

  it("fits a direct section path to the section's full width", async () => {
    const result = await layout('digraph { subgraph s { kind=section; label="Chapter"; a;b;c; a->b->c; } }', 704);
    expect(new Set(result.nodes.map((node) => node.y)).size).toBe(1);
    expect(result.groups[0].width).toBe(704);
  });

  it.each([
    "a->b; a->c;",
    "a->c; b->c;",
    "a->b->c->a;",
    "a->b->c; b->b;",
    "a->b;",
    "a->b->c; a->b;",
  ])("retains flow ranks for a non-simple path: %s", async (edges) => {
    const result = await layout(`digraph { subgraph s { kind=section; label="Scope"; a;b;c; ${edges} } }`, 790);
    expect(new Set(result.nodes.map((node) => node.y)).size).toBeGreaterThan(1);
  });

  it("keeps explicit grids in declaration order even when edges run backwards", async () => {
    const result = await layout("digraph { subgraph g { layout=grid; c;b;a; a->b->c; } }", 790);
    const [c, b, a] = result.nodes;
    expect(c.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(a.x);
    expect(c.y).toBe(a.y);
  });

  it("retains vertical flow for labels instead of introducing horizontal overflow", async () => {
    const result = await layout('digraph { a;b; a->b[label="Continue"]; }', 704);
    expect(result.nodes[0].y).toBeLessThan(result.nodes[1].y);
    const label = result.edges[0].labelBox!;
    expect(label.width).toBeGreaterThan(0);
    expect(label.x + label.width).toBeLessThanOrEqual(result.width);
    expect(result.nodes.some((node) =>
      label.x < node.x + node.width && label.x + label.width > node.x &&
      label.y < node.y + node.height && label.y + label.height > node.y,
    )).toBe(false);
  });

  it("retains vertical flow when a labeled edge crosses the group's boundary", async () => {
    const result = await layout('digraph { subgraph g { a;b; a->b; } c; b->c[label="Later"]; }', 790);
    expect(result.nodes[0].y + result.nodes[0].height).toBeLessThan(result.nodes[1].y);
    expect(result.edges[1].labelLines).toEqual(["Later"]);
  });

  it("keeps geometry stable across task state changes and invalidates it on resize", async () => {
    const source = "digraph { a;b;c; a->b->c; }";
    const done = setGraphTaskState(source, "b", "done");
    expect(await layout(done, 790)).toEqual(await layout(source, 790));
    expect(graphLayoutKey(parseGraph(done), 790)).toBe(graphLayoutKey(parseGraph(source), 790));
    expect(graphLayoutKey(parseGraph(source), 360)).not.toBe(graphLayoutKey(parseGraph(source), 790));
  });
});
