import type { GraphDiagnostic, GraphDocument, GraphEdge, GraphGroup, GraphKind, GraphNode, GraphSourceRange, GraphState } from "./types";

export class GraphParseError extends Error {
  readonly diagnostics: GraphDiagnostic[];
  constructor(diagnostics: GraphDiagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    this.name = "GraphParseError";
    this.diagnostics = diagnostics;
  }
}

interface Token extends GraphSourceRange { kind: "id" | "quoted" | "symbol" | "eof"; value: string }
interface Attribute { key: Token; value: Token }
type Attributes = Map<string, Attribute>;
const reserved = new Set(["digraph", "graph", "subgraph", "node", "edge", "strict"]);

class Parser {
  private offset = 0;
  private token!: Token;
  private graph: GraphDocument = { nodes: [], groups: [], edges: [], rootIds: [] };
  private declarations = new Map<string, GraphNode | GraphGroup>();
  constructor(private readonly source: string) {}

  private fail(message: string, range: GraphSourceRange = this.token): never {
    const before = this.source.slice(0, range.start);
    const lines = before.split(/\r\n|\r|\n/);
    throw new GraphParseError([{ message, line: lines.length, column: lines.at(-1)!.length + 1, offset: range.start, length: Math.max(1, range.end - range.start) }]);
  }

  private next(): Token {
    const previous = this.token;
    const text = this.source;
    while (this.offset < text.length) {
      if (/\s/u.test(text[this.offset])) { this.offset++; continue; }
      if (text.startsWith("//", this.offset)) {
        while (this.offset < text.length && !/[\r\n]/.test(text[this.offset])) this.offset++;
        continue;
      }
      if (text.startsWith("/*", this.offset)) {
        const start = this.offset;
        const end = text.indexOf("*/", start + 2);
        if (end < 0) this.fail("Unterminated block comment", { start, end: text.length });
        this.offset = end + 2;
        continue;
      }
      break;
    }
    const start = this.offset;
    if (start === text.length) this.token = { kind: "eof", value: "", start, end: start };
    else if (text[start] === '"') {
      this.offset++;
      let value = "";
      let closed = false;
      while (this.offset < text.length) {
        const character = text[this.offset++];
        if (character === '"') { closed = true; break; }
        if (character !== "\\") { value += character; continue; }
        const escaped = text[this.offset++];
        if (escaped === '"' || escaped === "\\") value += escaped;
        else if (escaped === "n") value += "\n";
        else this.fail("Unsupported escape; use \\n, \\\" or \\\\" , { start: this.offset - 2, end: this.offset });
      }
      if (!closed) this.fail("Unterminated quoted string", { start, end: text.length });
      this.token = { kind: "quoted", value, start, end: this.offset };
    } else if (text.startsWith("->", start)) {
      this.offset += 2;
      this.token = { kind: "symbol", value: "->", start, end: this.offset };
    } else if ("{}[]=,;".includes(text[start])) {
      this.offset++;
      this.token = { kind: "symbol", value: text[start], start, end: this.offset };
    } else {
      const bare = /^(?:[\p{L}_][\p{L}\p{N}_]*|-?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?))/u.exec(text.slice(start));
      if (!bare) this.fail(`Unsupported character ${JSON.stringify(text[start])}`, { start, end: start + 1 });
      this.offset += bare[0].length;
      this.token = { kind: "id", value: bare[0], start, end: this.offset };
    }
    return previous;
  }

  private isEof(): boolean { return this.token.kind === "eof"; }
  private at(value: string): boolean { return this.token.kind === "symbol" && this.token.value === value; }
  private keyword(value: string): boolean { return this.token.kind === "id" && this.token.value.toLowerCase() === value; }
  private expect(value: string): Token {
    if (!this.at(value)) this.fail(`Unexpected token; expected '${value}'`);
    return this.next();
  }
  private identifier(): Token {
    if (this.token.kind !== "id" && this.token.kind !== "quoted") this.fail("Unexpected token; expected a named identifier or quoted string");
    if (this.token.kind === "id" && reserved.has(this.token.value.toLowerCase())) this.fail(`Reserved identifier '${this.token.value}' must be quoted; default node/edge blocks are unsupported`);
    return this.next();
  }
  private attribute(attributes: Attributes, allowed: readonly string[]): void {
    const key = this.identifier();
    if (!allowed.includes(key.value)) this.fail(`Unsupported attribute '${key.value}'`, key);
    if (attributes.has(key.value)) this.fail(`Duplicate attribute '${key.value}'`, key);
    this.expect("=");
    const value = this.identifier();
    attributes.set(key.value, { key, value });
    if ((key.value === "label" || key.value === "subtitle") && [...value.value].length > 500) this.fail(`${key.value} exceeds 500 characters`, value);
  }
  private attributeList(attributes: Attributes, allowed: readonly string[]): GraphSourceRange {
    const start = this.expect("[").start;
    while (!this.at("]")) {
      this.attribute(attributes, allowed);
      if (this.at(",") || this.at(";")) this.next();
    }
    return { start, end: this.expect("]").end };
  }
  private value(attributes: Attributes, name: string): string | undefined { return attributes.get(name)?.value.value; }
  private enumValue<T extends string>(attributes: Attributes, name: string, options: readonly T[], fallback: T): T {
    const attribute = attributes.get(name);
    if (!attribute) return fallback;
    if (!options.includes(attribute.value.value as T)) this.fail(`Invalid ${name}; expected ${options.join(", ")}`, attribute.value);
    return attribute.value.value as T;
  }
  private declare(id: Token, item: GraphNode | GraphGroup, parent: GraphGroup | null): void {
    if (this.declarations.has(id.value)) this.fail(`Duplicate identifier '${id.value}'`, id);
    this.declarations.set(id.value, item);
    (parent ? parent.childIds : this.graph.rootIds).push(id.value);
  }

  private body(parent: GraphGroup | null, depth: number): Attributes {
    const attributes: Attributes = new Map();
    const allowed = parent ? ["label", "kind", "layout"] : ["label"];
    while (!this.at("}")) {
      if (this.at(";")) { this.next(); continue; }
      if (this.keyword("graph")) {
        this.next();
        this.attributeList(attributes, allowed);
      } else if (this.keyword("subgraph")) this.group(parent, depth + 1);
      else {
        const first = this.identifier();
        if (this.at("=")) {
          if (!allowed.includes(first.value)) this.fail(`Unsupported attribute '${first.value}'`, first);
          if (attributes.has(first.value)) this.fail(`Duplicate attribute '${first.value}'`, first);
          this.next();
          const value = this.identifier();
          attributes.set(first.value, { key: first, value });
          if (first.value === "label" && [...value.value].length > 500) this.fail("label exceeds 500 characters", value);
        } else if (this.at("->")) this.edge(first);
        else this.node(first, parent);
      }
    }
    return attributes;
  }

  private group(parent: GraphGroup | null, depth: number): void {
    const start = this.next().start;
    if (depth > 8) this.fail("Maximum 8 subgraph nesting levels exceeded", { start, end: this.token.end });
    const id = this.identifier();
    if (this.graph.groups.length >= 50) this.fail("Maximum 50 subgraphs exceeded", id);
    this.expect("{");
    const group: GraphGroup = { id: id.value, kind: "group", layout: "flow", parentId: parent?.id ?? null, childIds: [], source: { start, end: start } };
    this.declare(id, group, parent);
    this.graph.groups.push(group);
    const attributes = this.body(group, depth);
    group.source.end = this.expect("}").end;
    group.label = this.value(attributes, "label");
    group.kind = this.enumValue(attributes, "kind", ["group", "section"], "group");
    group.layout = this.enumValue(attributes, "layout", ["flow", "grid"], "flow");
    if (group.kind === "section") {
      if (parent) this.fail("A section must be at the root", id);
      if (!group.label?.trim()) this.fail("A section requires a nonempty label", id);
    }
  }

  private node(id: Token, parent: GraphGroup | null): void {
    if (this.graph.nodes.length >= 300) this.fail("Maximum 300 nodes exceeded", id);
    const attributes: Attributes = new Map();
    const range = this.at("[") ? this.attributeList(attributes, ["label", "subtitle", "kind", "task", "state"]) : undefined;
    const label = this.value(attributes, "label") ?? id.value;
    if ([...label].length > 500) this.fail("label exceeds 500 characters", id);
    const lastValue = [...attributes.values()].at(-1)?.value;
    const node: GraphNode = {
      id: id.value, label, subtitle: this.value(attributes, "subtitle"),
      kind: this.enumValue<GraphKind>(attributes, "kind", ["normal", "special", "milestone", "note"], "normal"),
      task: this.enumValue(attributes, "task", ["true", "false"], "true") === "true",
      state: this.enumValue<GraphState>(attributes, "state", ["todo", "doing", "done"], "todo"),
      parentId: parent?.id ?? null,
      source: {
        declaration: { start: id.start, end: range?.end ?? id.end },
        identifier: { start: id.start, end: id.end }, attributes: range,
        stateValue: attributes.has("state") ? { start: attributes.get("state")!.value.start, end: attributes.get("state")!.value.end } : undefined,
        stateInsertion: range
          ? { offset: lastValue?.end ?? range.start + 1, prefix: lastValue ? ", state=" : "state=", suffix: "" }
          : { offset: id.end, prefix: " [state=", suffix: "]" },
      },
    };
    if (!node.task && attributes.has("state")) this.fail("An informational node (task=false) cannot carry state", attributes.get("state")!.key);
    this.declare(id, node, parent);
    this.graph.nodes.push(node);
  }

  private edge(first: Token): void {
    const endpoints = [first];
    while (this.at("->")) {
      this.next(); endpoints.push(this.identifier());
      if (this.graph.edges.length + endpoints.length - 1 > 600) this.fail("Maximum 600 edges exceeded", first);
    }
    const attributes: Attributes = new Map();
    const range = this.at("[") ? this.attributeList(attributes, ["label"]) : undefined;
    for (let index = 1; index < endpoints.length; index++) {
      this.graph.edges.push({ from: endpoints[index - 1].value, to: endpoints[index].value, label: this.value(attributes, "label"), source: { start: first.start, end: range?.end ?? endpoints.at(-1)!.end } });
    }
  }

  private validateEdge(edge: GraphEdge): void {
    const from = this.declarations.get(edge.from), to = this.declarations.get(edge.to);
    if (!from || !to) this.fail(`Undeclared edge endpoint '${!from ? edge.from : edge.to}'`, edge.source);
    for (const endpoint of [from, to]) {
      if ("childIds" in endpoint) {
        if (endpoint.kind === "section") this.fail("A section cannot be an edge endpoint", edge.source);
        // A container needs actual content, not only a hierarchy of empty boxes.
        const hasNode = this.graph.nodes.some(node => this.isAncestor(endpoint.id, node.id));
        if (!hasNode) this.fail("An empty group cannot be an edge endpoint", edge.source);
      }
    }
    if (this.isAncestor(edge.from, edge.to) || this.isAncestor(edge.to, edge.from)) this.fail("An ancestor/descendant edge has ambiguous containment", edge.source);
  }
  private isAncestor(ancestor: string, descendant: string): boolean {
    let parentId = this.declarations.get(descendant)?.parentId;
    while (parentId != null) {
      if (parentId === ancestor) return true;
      parentId = this.declarations.get(parentId)?.parentId;
    }
    return false;
  }

  parse(): GraphDocument {
    if (new TextEncoder().encode(this.source).byteLength > 100 * 1024) this.fail("Graph source exceeds 100 KiB UTF-8", { start: 0, end: 1 });
    this.next();
    if (this.isEof()) return this.graph;
    if (!this.keyword("digraph")) this.fail("Expected one digraph");
    this.next();
    if (!this.at("{")) this.identifier();
    this.expect("{");
    const attributes = this.body(null, 0);
    this.expect("}");
    if (!this.isEof()) this.fail("Unexpected content after digraph");
    this.graph.label = this.value(attributes, "label");
    for (const edge of this.graph.edges) this.validateEdge(edge);
    return this.graph;
  }
}

export function parseGraph(source: string): GraphDocument { return new Parser(source).parse(); }
/** Returns the first precise diagnostic; malformed input is never partially accepted. */
export function validateGraph(source: string): GraphDiagnostic[] {
  try { parseGraph(source); return []; }
  catch (error) { if (error instanceof GraphParseError) return error.diagnostics; throw error; }
}
