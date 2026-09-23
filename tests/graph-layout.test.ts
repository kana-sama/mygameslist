import { describe, expect, it } from "vitest";
import { instance } from "@viz-js/viz";
import { parseGraph, setGraphTaskState } from "../src/domain/graph";
import { layoutGraph, graphLayoutKey } from "../src/components/graph/layout";

const engine = instance();
const layout = async (source: string, width = 720) =>
  layoutGraph(parseGraph(source), width, await engine);

describe("graph geometry with the real engine", () => {
  it("keeps nested grid ownership, three columns at wide widths, and reduces columns on narrow widths", async () => {
    const source =
      "digraph { subgraph outer { subgraph inner { layout=grid; a;b;c;d;e;f; } } }";
    const wide = await layout(source);
    const narrow = await layout(source, 320);
    expect(wide.groups).toHaveLength(2);
    expect(new Set(wide.nodes.slice(0, 3).map((n) => n.y)).size).toBe(1);
    expect(wide.nodes[3].y).toBeGreaterThan(wide.nodes[0].y);
    expect(new Set(narrow.nodes.map((n) => n.y)).size).toBeGreaterThan(2);
    for (const n of wide.nodes) {
      const group = wide.groups.find((g) => g.id === "inner")!;
      expect(n.x).toBeGreaterThan(group.x);
      expect(n.x + n.width).toBeLessThanOrEqual(group.x + group.width);
    }
  });
  it("reduces nested-grid columns to contain every descendant and keep siblings disjoint", async () => {
    const source = `digraph {
      subgraph outer {
        layout=grid;
        subgraph one {
          subgraph deep1 { subgraph deep2 { subgraph deep3 { subgraph deep4 { a; } } } }
        }
        subgraph two { b; }
        subgraph three { c; }
      }
    }`;
    const graph = parseGraph(source);
    for (const width of [390, 180]) {
      const result = await layout(source, width);
      if (width === 390) expect(result.width).toBe(width);
      const boxes = new Map(
        [...result.groups, ...result.nodes].map((box) => [box.id, box]),
      );
      for (const item of [...graph.groups, ...graph.nodes]) {
        const box = boxes.get(item.id)!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        if (!item.parentId) continue;
        const parent = boxes.get(item.parentId)!;
        expect(box.x).toBeGreaterThanOrEqual(parent.x);
        expect(box.y).toBeGreaterThanOrEqual(parent.y);
        expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width);
        expect(box.y + box.height).toBeLessThanOrEqual(
          parent.y + parent.height,
        );
      }
      for (const group of graph.groups) {
        const children = group.childIds.map((id) => boxes.get(id)!);
        for (let i = 0; i < children.length; i++) {
          for (const right of children.slice(i + 1)) {
            const left = children[i];
            const overlaps =
              left.x < right.x + right.width &&
              left.x + left.width > right.x &&
              left.y < right.y + right.height &&
              left.y + left.height > right.y;
            expect(overlaps).toBe(false);
          }
        }
      }
      expect(boxes.get("two")!.y).toBeGreaterThan(
        boxes.get("one")!.y + boxes.get("one")!.height,
      );
    }
  });
  it("preserves compound, cyclic, parallel, self and grid edges without inventing relationships", async () => {
    const result = await layout(
      "digraph { subgraph g { layout=grid; a;b; a->b; } subgraph h { c;d; c->d;d->c;c->c; } g->c; a->h; a->h; }",
    );
    expect(result.edges).toHaveLength(7);
    expect(result.edges.every((e) => e.path && !e.path.includes("NaN"))).toBe(
      true,
    );
    expect(
      result.edges.filter((e) => e.from === "a" && e.to === "h")[0].path,
    ).not.toBe(
      result.edges.filter((e) => e.from === "a" && e.to === "h")[1].path,
    );
  });
  it("packs independent root groups in authored order and breaks for a borderless section", async () => {
    const result = await layout(
      'digraph { subgraph g { a;b; a->b; } subgraph h { c; } subgraph s { label="Later";kind=section;layout=grid;d;e;f; } }',
    );
    expect(result.groups[0].x).toBeLessThan(result.groups[1].x);
    const section = result.groups.find((g) => g.id === "s")!;
    expect(section.width).toBe(720);
    expect(section.y).toBeGreaterThan(
      result.groups[0].y + result.groups[0].height,
    );
  });
  it("keeps node connections across full-width root sections", async () => {
    const result = await layout(
      "digraph { a; subgraph s { kind=section; label=Chapter; b;c; b->c; } d; a->b; c->d; a->d; }",
    );
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.edges).toHaveLength(4);
    expect(result.nodes.find((n) => n.id === "d")!.y).toBeGreaterThan(
      result.groups[0].y + result.groups[0].height,
    );
    expect(result.groups[0].width).toBe(720);
  });
  it("routes same-row grid edges around intermediate cards with visible facing endpoints", async () => {
    const result = await layout(
      "digraph { subgraph g { layout=grid; a;b;c; a->c; a->b; } }",
    );
    const [a, b, c] = result.nodes;
    const edge = result.edges[1];
    expect(edge.points[0][0]).toBeCloseTo(a.x + a.width, 0);
    expect(edge.points.at(-1)![0]).toBeCloseTo(b.x, 0);
    const crossing = result.edges[0];
    expect(
      crossing.points.some((p) => p[1] < b.y || p[1] > b.y + b.height),
    ).toBe(true);
    const end = crossing.points.at(-1)!;
    expect(
      Math.min(
        Math.abs(end[0] - c.x),
        Math.abs(end[0] - c.x - c.width),
        Math.abs(end[1] - c.y),
        Math.abs(end[1] - c.y - c.height),
      ),
    ).toBeLessThan(1);
  });
  it("reduces connected group columns before squeezing their labels at narrow widths", async () => {
    const result = await layout(
      "digraph { subgraph start { a; } subgraph left { b; } subgraph right { c; } a->b; a->c; }",
      360,
    );
    const [, left, right] = result.groups;
    expect(left.width).toBe(360);
    expect(right.y).toBeGreaterThan(left.y + left.height);
  });
  it("wraps long edge labels into bounded non-overlapping rectangles", async () => {
    const result = await layout(
      `digraph { a;b; a->b[label="${"Очень длинная подпись ".repeat(12)}"]; }`,
      320,
    );
    const edge = result.edges[0];
    expect(edge.labelLines.length).toBeGreaterThan(1);
    expect(edge.labelBox!.width).toBeLessThanOrEqual(180);
    const box = edge.labelBox!;
    expect(
      result.nodes.some(
        (n) =>
          box.x < n.x + n.width &&
          box.x + box.width > n.x &&
          box.y < n.y + n.height &&
          box.y + box.height > n.y,
      ),
    ).toBe(false);
  });
  it("wraps long Unicode text and ignores checklist source changes in structural keys", async () => {
    const source =
      'digraph { a [label="Очень длинное название синтетического задания для проверки переноса текста", subtitle="Подробное пояснение"]; }';
    const graph = parseGraph(source);
    const result = await layout(source, 300);
    expect(result.nodes[0].labelLines.length).toBeGreaterThan(1);
    expect(graphLayoutKey(graph, 300)).toBe(
      graphLayoutKey(parseGraph(setGraphTaskState(source, "a", "done")), 300),
    );
    expect(graphLayoutKey(graph, 300)).not.toBe(graphLayoutKey(graph, 720));
  });
});
