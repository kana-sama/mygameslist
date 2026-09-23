import { wrapGraphText } from "./textWrap";
export { wrapGraphText } from "./textWrap";
import type { GraphDocument, GraphNode } from "../../domain/graph";
import type {
  GraphBox,
  GraphEngine,
  GraphGeometry,
  GraphGroupGeometry,
  GraphNodeGeometry,
} from "./layoutTypes";

const GAP = 16;
const PADDING = 16;
const FONT_SIZE = 12;
const SUBTITLE_SIZE = 10;
type Region = {
  width: number;
  height: number;
  nodes: GraphNodeGeometry[];
  groups: GraphGroupGeometry[];
};
type EngineOutput = { bb: string; objects?: { name: string; pos?: string }[] };

/** Source ranges, state, and spelling of equivalent DOT never invalidate geometry. */
export function graphLayoutKey(
  graph: GraphDocument,
  width: number,
  font = "",
): string {
  return JSON.stringify({
    width: Math.round(width),
    font,
    nodes: graph.nodes.map(({ id, label, subtitle, kind, task, parentId }) => ({
      id,
      label,
      subtitle,
      kind,
      task,
      parentId,
    })),
    groups: graph.groups.map(({ source: _, ...group }) => group),
    edges: graph.edges.map(({ source: _, ...edge }) => edge),
    rootIds: graph.rootIds,
  });
}

/** Font metrics are measured in the worker when OffscreenCanvas is available. */
function textMeasurer(font: string) {
  const context =
    typeof OffscreenCanvas === "undefined"
      ? null
      : new OffscreenCanvas(1, 1).getContext("2d");
  return (text: string, size: number) => {
    if (context) {
      context.font = `${size}px ${font}`;
      return context.measureText(text).width;
    }
    return [...text].reduce(
      (sum, char) =>
        sum +
        (/[il.,:!\s]/.test(char) ? 0.3 : /[MWЖШЩ]/.test(char) ? 0.85 : 0.57) *
          size,
      0,
    );
  };
}
function shift(region: Region, dx: number, dy: number): Region {
  return {
    ...region,
    nodes: region.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    groups: region.groups.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
  };
}
function combine(regions: Region[], width: number, height: number): Region {
  return {
    width,
    height,
    nodes: regions.flatMap((r) => r.nodes),
    groups: regions.flatMap((r) => r.groups),
  };
}

export async function layoutGraph(
  graph: GraphDocument,
  availableWidth: number,
  engine: GraphEngine,
  font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
): Promise<GraphGeometry> {
  const width = Math.max(180, Math.round(availableWidth));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  const parents = new Map(
    [...graph.nodes, ...graph.groups].map((n) => [n.id, n.parentId]),
  );
  const measure = textMeasurer(font);
  const representative = (id: string, scope: string | null): string => {
    let current = id;
    while (parents.get(current) !== scope && parents.get(current) != null)
      current = parents.get(current)!;
    return current;
  };
  const childEdges = (ids: string[], scope: string | null) => {
    const included = new Set(ids);
    return graph.edges
      .map((edge) => ({
        from: representative(edge.from, scope),
        to: representative(edge.to, scope),
      }))
      .filter(
        (e) => included.has(e.from) && included.has(e.to) && e.from !== e.to,
      );
  };
  const simplePath = (
    ids: string[],
    scope: string | null,
    edges: { from: string; to: string }[],
  ): string[] | null => {
    if (ids.length < 2 || edges.length !== ids.length - 1) return null;
    const included = new Set(ids);
    // Preserve the existing routing space for labeled edges, including those
    // crossing this scope. Projected edges omit self loops, so check them here.
    if (graph.edges.some((edge) =>
      (edge.label || edge.from === edge.to) &&
      (included.has(representative(edge.from, scope)) ||
        included.has(representative(edge.to, scope))),
    )) return null;
    const next = new Map<string, string>();
    const incoming = new Set<string>();
    for (const edge of edges) {
      if (next.has(edge.from) || incoming.has(edge.to)) return null;
      next.set(edge.from, edge.to);
      incoming.add(edge.to);
    }
    const starts = ids.filter((id) => !incoming.has(id));
    if (starts.length !== 1) return null;
    const path: string[] = [];
    let current: string | undefined = starts[0];
    while (current !== undefined && !path.includes(current)) {
      path.push(current);
      current = next.get(current);
    }
    return path.length === ids.length && current === undefined ? path : null;
  };
  const nodeRegion = (node: GraphNode, budget: number): Region => {
    const nodeWidth = Math.max(116, Math.min(220, budget));
    const textWidth = nodeWidth - (node.task ? 42 : 20);
    const labelLines = wrapGraphText(node.label, textWidth, FONT_SIZE, measure);
    const subtitleLines = node.subtitle
      ? wrapGraphText(node.subtitle, textWidth, SUBTITLE_SIZE, measure)
      : [];
    const height = Math.max(
      52,
      20 + labelLines.length * 16 + subtitleLines.length * 13,
    );
    return {
      width: nodeWidth,
      height,
      nodes: [
        {
          id: node.id,
          x: 0,
          y: 0,
          width: nodeWidth,
          height,
          labelLines,
          subtitleLines,
        },
      ],
      groups: [],
    };
  };
  const enginePositions = (
    ids: string[],
    regions: Region[],
    edges: { from: string; to: string }[],
  ) => {
    const internal = new Map(ids.map((id, i) => [id, `n${i}`]));
    // Only safe generated IDs and numeric dimensions reach Graphviz. Clusters support
    // group boundaries; authored labels and identifiers never become engine syntax.
    const declarations = ids
      .map((id, i) => {
        const node = `${internal.get(id)} [width=${regions[i].width / 72},height=${regions[i].height / 72}];`;
        return groups.has(id)
          ? `subgraph cluster_${i} { margin=0; ${node} }`
          : node;
      })
      .join("\n");
    const links = edges
      .map((e) => {
        const a = ids.indexOf(e.from),
          b = ids.indexOf(e.to);
        return `${internal.get(e.from)} -> ${internal.get(e.to)} [${groups.has(e.from) ? `ltail=cluster_${a},` : ""}${groups.has(e.to) ? `lhead=cluster_${b},` : ""}weight=2];`;
      })
      .join("\n");
    const dot = `digraph { graph [rankdir=TB,compound=true,nodesep=0.2222,ranksep=0.3056,margin=0,pad=0,newrank=true]; node [shape=box,fixedsize=true,label="",margin=0]; ${declarations}\n${links} }`;
    const result = engine.renderJSON(dot, {
      engine: "dot",
      yInvert: true,
    }) as EngineOutput;
    const bb = result.bb.split(",").map(Number);
    const positions = new Map(
      (result.objects ?? [])
        .filter((o) => o.pos)
        .map((o) => [o.name, o.pos!.split(",").map(Number)]),
    );
    return { width: bb[2] - bb[0], height: Math.abs(bb[3] - bb[1]), positions };
  };
  const flow = async (
    ids: string[],
    budget: number,
    scope: string | null,
    depth: number,
  ): Promise<Region> => {
    if (!ids.length) return combine([], budget, 0);
    const edges = childEdges(ids, scope);
    // A first pass measures rank breadth before text wraps. This reduces columns
    // before any possibility of scaling, including two parallel chain starts.
    const placeholders = ids.map(() => ({
      width: 120,
      height: 52,
      nodes: [],
      groups: [],
    }));
    const probe = enginePositions(ids, placeholders, edges);
    const ranks = new Map<number, number>();
    for (const p of probe.positions.values()) {
      const y = Math.round(p[1]);
      ranks.set(y, (ranks.get(y) ?? 0) + 1);
    }
    const columnLimit =
      scope === null && budget < 620
        ? 1
        : Math.max(1, Math.floor((budget + GAP) / (116 + GAP)));
    const regions = await Promise.all(
      ids.map((id, i) => {
        const rank = Math.round(probe.positions.get(`n${i}`)?.[1] ?? 0);
        const breadth = Math.min(columnLimit, ranks.get(rank) ?? 1);
        const childBudget = Math.max(
          116,
          (budget - GAP * (breadth - 1)) / breadth,
        );
        return item(id, childBudget, depth);
      }),
    );
    const path = simplePath(ids, scope, edges);
    if (path) {
      // Direct node chains share the available row width. Remeasure their text
      // at the fitted width, but keep group containers at their measured size.
      const slotWidth = (budget - 22 * (ids.length - 1)) / ids.length;
      const fittedNodes = slotWidth >= 116 && ids.every((id) => nodes.has(id));
      const rowRegions = fittedNodes
        ? ids.map((id) => nodeRegion(nodes.get(id)!, slotWidth))
        : regions;
      const rowWidth = rowRegions.reduce((sum, region) => sum + region.width, 0) +
        22 * (rowRegions.length - 1);
      // Equal fractional slots can sum a fraction of a pixel beyond the budget.
      if (fittedNodes || rowWidth <= budget) {
        const rowHeight = Math.max(...rowRegions.map((region) => region.height));
        let x = (budget - rowWidth) / 2;
        const placed = path.map((id) => {
          const region = rowRegions[ids.indexOf(id)];
          const result = shift(region, x, (rowHeight - region.height) / 2);
          x += region.width + 22;
          return result;
        });
        return combine(placed, budget, rowHeight);
      }
    }
    const placement = enginePositions(ids, regions, edges);
    const rows = new Map<number, number[]>();
    regions.forEach((_, i) => {
      const p = placement.positions.get(`n${i}`);
      if (!p || p.some((v) => !Number.isFinite(v)))
        throw new Error("Не удалось рассчитать расположение графа.");
      const rank = Math.round(p[1]);
      rows.set(rank, [...(rows.get(rank) ?? []), i]);
    });
    const placed: Region[] = [];
    let y = 0;
    let actualWidth = budget;
    for (const [, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      row.sort(
        (a, b) =>
          placement.positions.get(`n${a}`)![0] -
          placement.positions.get(`n${b}`)![0],
      );
      for (let start = 0; start < row.length; start += columnLimit) {
        const slice = row.slice(start, start + columnLimit);
        const rowWidth =
          slice.reduce((sum, i) => sum + regions[i].width, 0) +
          GAP * (slice.length - 1);
        actualWidth = Math.max(actualWidth, rowWidth);
        let x = Math.max(0, (budget - rowWidth) / 2);
        for (const i of slice) {
          placed.push(shift(regions[i], x, y));
          x += regions[i].width + GAP;
        }
        y += Math.max(...slice.map((i) => regions[i].height)) + 22;
      }
    }
    return combine(placed, actualWidth, Math.max(0, y - 22));
  };
  const grid = async (
    ids: string[],
    budget: number,
    depth: number,
  ): Promise<Region> => {
    let columns = Math.max(
      1,
      Math.min(3, Math.floor((budget + GAP) / (170 + GAP)), ids.length || 1),
    );
    let childWidth: number;
    let regions: Region[];
    // Nested padding can make a child wider than a nominal grid slot. Remeasure
    // with fewer columns before allowing any contained horizontal overflow.
    while (true) {
      childWidth = (budget - GAP * (columns - 1)) / columns;
      regions = await Promise.all(ids.map((id) => item(id, childWidth, depth)));
      if (
        columns === 1 ||
        regions.every((region) => region.width <= childWidth)
      )
        break;
      columns--;
    }
    // Even one deeply nested child may exceed the available width. Expand its
    // slot to the right, keeping every descendant inside its parent rectangle.
    childWidth = Math.max(childWidth, ...regions.map((region) => region.width));
    const result: Region[] = [];
    let y = 0;
    for (let row = 0; row < regions.length; row += columns) {
      const rowItems = regions.slice(row, row + columns);
      const rowHeight = Math.max(...rowItems.map((r) => r.height));
      rowItems.forEach((r, col) =>
        result.push(
          shift(r, col * (childWidth + GAP) + (childWidth - r.width) / 2, y),
        ),
      );
      y += rowHeight + GAP;
    }
    return combine(
      result,
      Math.max(budget, childWidth * columns + GAP * (columns - 1)),
      Math.max(0, y - GAP),
    );
  };
  const item = async (
    id: string,
    budget: number,
    depth: number,
  ): Promise<Region> => {
    const node = nodes.get(id);
    if (node) return nodeRegion(node, budget);
    const group = groups.get(id)!;
    const padding = group.kind === "section" ? 0 : PADDING;
    const labelLines = group.label
      ? wrapGraphText(
          group.label,
          Math.max(80, budget - padding * 2 - 52),
          14,
          measure,
        )
      : [];
    const header = group.label ? labelLines.length * 19 + 18 : 24;
    const innerWidth = Math.max(116, budget - padding * 2);
    const content =
      group.layout === "grid"
        ? await grid(group.childIds, innerWidth, depth + 1)
        : await flow(group.childIds, innerWidth, group.id, depth + 1);
    const result = shift(content, padding, header);
    const groupWidth = Math.max(budget, content.width + padding * 2);
    const height = header + content.height + padding;
    const geometry: GraphGroupGeometry = {
      id,
      x: 0,
      y: 0,
      width: groupWidth,
      height,
      depth,
      labelLines,
    };
    return {
      width: groupWidth,
      height,
      nodes: result.nodes,
      groups: [geometry, ...result.groups],
    };
  };
  // Connected root units stay together. A section flushes the packing lanes.
  const segments = new Map<string, number>();
  let segment = 0;
  for (const id of graph.rootIds) {
    if (groups.get(id)?.kind === "section") {
      segments.set(id, ++segment);
      segment++;
    } else segments.set(id, segment);
  }
  const rootEdges = childEdges(graph.rootIds, null).filter(
    (e) =>
      groups.get(e.from)?.kind !== "section" &&
      groups.get(e.to)?.kind !== "section" &&
      segments.get(e.from) === segments.get(e.to),
  );
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const root of graph.rootIds) {
    if (visited.has(root)) continue;
    const found = new Set([root]);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of rootEdges) {
        const neighbor = e.from === id ? e.to : e.to === id ? e.from : null;
        if (neighbor && !found.has(neighbor)) {
          found.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    const ordered = graph.rootIds.filter((id) => found.has(id));
    ordered.forEach((id) => visited.add(id));
    components.push(ordered);
  }
  const columns = width >= 620 ? 2 : 1;
  const laneWidth = (width - GAP * (columns - 1)) / columns;
  const lanes = Array(columns).fill(0) as number[];
  const packed: Region[] = [];
  for (const ids of components) {
    const section = groups.get(ids[0])?.kind === "section";
    const full = section || ids.length > 1 || containsGrid(ids[0]);
    if (full) {
      const y = Math.max(...lanes);
      const region =
        section || ids.length === 1
          ? await item(ids[0], width, 0)
          : await flow(ids, width, null, 0);
      packed.push(shift(region, 0, y));
      lanes.fill(y + region.height + GAP);
    } else {
      const lane = lanes.indexOf(Math.min(...lanes));
      const region = await item(ids[0], laneWidth, 0);
      packed.push(shift(region, lane * (laneWidth + GAP), lanes[lane]));
      lanes[lane] += region.height + GAP;
    }
  }
  function containsGrid(id: string): boolean {
    const group = groups.get(id);
    return (
      !!group && (group.layout === "grid" || group.childIds.some(containsGrid))
    );
  }
  const combined = combine(
    packed,
    Math.max(width, ...packed.map((r) => r.width)),
    Math.max(0, ...lanes) - GAP,
  );
  combined.width = Math.max(
    width,
    ...combined.nodes.map((n) => n.x + n.width),
    ...combined.groups.map((g) => g.x + g.width),
  );
  const boxes = new Map<string, GraphBox>(
    [...combined.nodes, ...combined.groups].map((n) => [n.id, n]),
  );
  // A final pinned neato pass routes real edges around the measured cards without
  // moving the flow/grid layout. Group endpoints are tiny internal boundary
  // anchors, not extra visible nodes or expanded child relationships.
  type RouteOutput = {
    objects: { name: string; pos: string }[];
    edges?: {
      id: string;
      pos: string;
      _draw_?: { op: string; points?: number[][] }[];
    }[];
  };
  const routingNodes: { name: string; box: GraphBox }[] = combined.nodes.map(
    (node, i) => ({ name: `n${i}`, box: node }),
  );
  const nodeNames = new Map(
    routingNodes.map(({ name, box }) => [box.id, name]),
  );
  const anchors = new Map<string, string>();
  const anchor = (id: string, other: string, index: number, suffix: string) => {
    if (nodeNames.has(id)) return nodeNames.get(id)!;
    const box = boxes.get(id)!,
      target = boxes.get(other)!;
    let x = Math.max(
        box.x + 8,
        Math.min(box.x + box.width - 8, target.x + target.width / 2),
      ),
      y = box.y + box.height;
    if (target.y + target.height <= box.y) y = box.y;
    else if (target.y < box.y + box.height && target.x >= box.x + box.width) {
      x = box.x + box.width;
      y = box.y + box.height / 2;
    } else if (
      target.y < box.y + box.height &&
      target.x + target.width <= box.x
    ) {
      x = box.x;
      y = box.y + box.height / 2;
    }
    const key = JSON.stringify([id, x, y]);
    const existing = anchors.get(key);
    if (existing) return existing;
    const name = `a${index}${suffix}`;
    anchors.set(key, name);
    routingNodes.push({
      name,
      box: { id: name, x: x - 0.36, y: y - 0.36, width: 0.72, height: 0.72 },
    });
    return name;
  };
  const routingEdges = graph.edges.map(
    (edge, index) =>
      `${anchor(edge.from, edge.to, index, "s")} -> ${anchor(edge.to, edge.from, index, "t")} [id="e${index}",arrowsize=0.45];`,
  );
  const routeDot = `digraph { graph [layout=neato,notranslate=true,overlap=true,splines=true,sep="+3"]; node [shape=box,fixedsize=true,label="",pin=true]; ${routingNodes.map(({ name, box }) => `${name} [width=${box.width / 72},height=${box.height / 72},pos="${(box.x + box.width / 2) / 72},${-(box.y + box.height / 2) / 72}!"];`).join("\n")} ${routingEdges.join("\n")} }`;
  const routed = graph.edges.length
    ? (engine.renderJSON(routeDot, {
        engine: "neato",
        yInvert: true,
      }) as RouteOutput)
    : null;
  const origin = routed?.objects
    .find((n) => n.name === routingNodes[0]?.name)
    ?.pos.split(",")
    .map(Number);
  const dx = origin
    ? routingNodes[0].box.x + routingNodes[0].box.width / 2 - origin[0]
    : 0;
  const dy = origin
    ? routingNodes[0].box.y + routingNodes[0].box.height / 2 - origin[1]
    : 0;
  const labelBoxes: GraphBox[] = [];
  const intersects = (a: GraphBox, b: GraphBox) =>
    a.x < b.x + b.width + 4 &&
    a.x + a.width + 4 > b.x &&
    a.y < b.y + b.height + 4 &&
    a.y + a.height + 4 > b.y;
  const pairCounts = new Map<string, number>();
  const edges = graph.edges.map((edge, index) => {
    const route = routed?.edges?.find((e) => e.id === `e${index}`);
    const rawPoints = route?._draw_?.find((op) => op.op === "b")?.points;
    if (!route || !rawPoints?.length)
      throw new Error("Не удалось построить связь графа.");
    const points = rawPoints.map(([x, y]) => [x + dx, y + dy]);
    const pair = JSON.stringify([edge.from, edge.to]);
    const parallel = pairCounts.get(pair) ?? 0;
    pairCounts.set(pair, parallel + 1);
    // neato intentionally overlays duplicate splines. Separate their interior
    // control points while retaining the exact boundary endpoints.
    if (parallel) {
      const start = points[0],
        end = points[points.length - 1];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
      const offset = 3 * parallel;
      for (let i = 1; i < points.length - 1; i++) {
        points[i][0] -= ((end[1] - start[1]) / length) * offset;
        points[i][1] += ((end[0] - start[0]) / length) * offset;
      }
    }
    let path = `M ${points[0].join(" ")} C ${points
      .slice(1)
      .map((p) => p.join(" "))
      .join(", ")}`;
    const arrow = route.pos.match(/(?:^|;)e,([\d.e+-]+),([\d.e+-]+)/);
    if (arrow) {
      const end = [Number(arrow[1]) + dx, Number(arrow[2]) + dy];
      points.push(end);
      path += ` L ${end.join(" ")}`;
    }
    const mid = points[Math.floor(points.length / 2)];
    let x = mid[0],
      y = mid[1];
    const labelLines = edge.label
      ? wrapGraphText(edge.label, 164, 11, measure)
      : [];
    let labelBox: GraphBox | undefined;
    if (labelLines.length) {
      const labelWidth = Math.min(
        180,
        Math.max(32, ...labelLines.map((line) => measure(line, 11))) + 12,
      );
      labelBox = {
        id: `label${index}`,
        x: Math.max(0, x - labelWidth / 2),
        y: Math.max(0, y - (labelLines.length * 14) / 2),
        width: labelWidth,
        height: labelLines.length * 14 + 4,
      };
      const obstacles = [
        ...combined.nodes,
        ...labelBoxes,
        ...combined.groups
          .filter((g) => g.labelLines.length)
          .map((g) => ({ ...g, height: g.labelLines.length * 19 + 18 })),
      ];
      if (obstacles.some((box) => intersects(labelBox!, box))) {
        labelBox.x = combined.width + 12;
        labelBox.y = Math.max(0, y - labelBox.height / 2);
        while (labelBoxes.some((box) => intersects(labelBox!, box)))
          labelBox.y += labelBox.height + 8;
      }
      labelBoxes.push(labelBox);
      x = labelBox.x + labelBox.width / 2;
      y = labelBox.y;
      combined.width = Math.max(combined.width, labelBox.x + labelBox.width);
      combined.height = Math.max(combined.height, labelBox.y + labelBox.height);
    }
    for (const p of points) {
      combined.width = Math.max(combined.width, p[0] + 2);
      combined.height = Math.max(combined.height, p[1] + 2);
    }
    return {
      index,
      from: edge.from,
      to: edge.to,
      path,
      points,
      label: edge.label,
      labelLines,
      labelBox,
      x,
      y,
    };
  });
  // Return declaration order for deterministic React keys and keyboard traversal.
  return {
    ...combined,
    height: Math.max(0, combined.height),
    nodes: graph.nodes.map((n) => combined.nodes.find((v) => v.id === n.id)!),
    groups: graph.groups.map((g) =>
      combined.groups.find((v) => v.id === g.id)!,
    ),
    edges,
  };
}
