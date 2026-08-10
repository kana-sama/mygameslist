import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  stringify,
  type ParsedNode,
} from "yaml";

const METADATA_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MARKDOWN_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const YAML_11_AMBIGUOUS = /^(?:y|yes|n|no|true|false|on|off|null|~)$/i;

function failure(sourceKind: string, path: string, message: string): Error {
  return new Error(`${sourceKind} YAML${path ? ` at ${path}` : ""}: ${message}`);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function preflightNode(node: ParsedNode, sourceKind: string, path: string): void {
  if (isAlias(node)) throw failure(sourceKind, path, "aliases are not allowed");
  if (node.anchor !== undefined) throw failure(sourceKind, path, "anchors are not allowed");
  if (node.tag !== undefined) throw failure(sourceKind, path, "explicit and custom tags are not allowed");

  if (isMap(node)) {
    const keys = new Set<string>();
    for (const pair of node.items) {
      const key = pair.key;
      if (!isScalar(key) || typeof key.value !== "string") {
        throw failure(sourceKind, path, "mapping keys must be string scalars");
      }
      preflightNode(key, sourceKind, path);
      const keyPath = `${path}/${key.value}`;
      if (keys.has(key.value)) throw failure(sourceKind, keyPath, "duplicate mapping key");
      keys.add(key.value);
      if (key.value === "<<") throw failure(sourceKind, keyPath, "merge keys are not allowed");
      if (pair.value !== null) preflightNode(pair.value as ParsedNode, sourceKind, keyPath);
    }
    return;
  }

  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      if (item !== null) preflightNode(item as ParsedNode, sourceKind, `${path}/${index}`);
    });
  }
}

/** Parses one strict YAML 1.2 Core mapping after forbidden syntax is rejected on the parsed tree. */
export function parseStrictYamlMapping(text: string, sourceKind: string): Record<string, unknown> {
  if (/(?:^|\n)(?:\uFEFF)?%/.test(text)) throw failure(sourceKind, "", "directives are not allowed");

  const documents = parseAllDocuments(text, {
    version: "1.2",
    schema: "core",
    customTags: [],
    resolveKnownTags: false,
    merge: false,
    strict: true,
    uniqueKeys: true,
    keepSourceTokens: true,
    prettyErrors: true,
  });

  if (documents.length !== 1) throw failure(sourceKind, "", "exactly one document is required");
  const document = documents[0];
  if (document.contents && isMap(document.contents)) preflightNode(document.contents, sourceKind, "");
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) throw failure(sourceKind, "", problem.message);
  if (!document.contents || !isMap(document.contents)) throw failure(sourceKind, "", "the document root must be a mapping");
  return document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
}

/** Applies the source-tree Unicode/control policy to parsed and serialized values. */
export function assertSourceValueStrings(value: unknown, sourceKind: string, path = ""): void {
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) throw failure(sourceKind, path, "string contains an unpaired Unicode surrogate");
    const control = path.endsWith("/reviewMarkdown") ? MARKDOWN_CONTROL : METADATA_CONTROL;
    if (control.test(value)) throw failure(sourceKind, path, "string contains a disallowed control character");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSourceValueStrings(item, sourceKind, `${path}/${index}`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    assertSourceValueStrings(key, sourceKind, `${path}/${key}`);
    assertSourceValueStrings(item, sourceKind, `${path}/${key}`);
  }
}

function escapeDoubleQuoted(value: string, escapeHyphenRuns: boolean): string {
  let result = '"';
  let hyphenRunIndex = 0;
  for (const character of value) {
    if (character === "-") {
      result += escapeHyphenRuns && hyphenRunIndex % 2 === 1 ? "\\x2D" : "-";
      hyphenRunIndex += 1;
      continue;
    }
    hyphenRunIndex = 0;
    switch (character) {
      case '"': result += '\\"'; break;
      case "\\": result += "\\\\"; break;
      case "\0": result += "\\0"; break;
      case "\b": result += "\\b"; break;
      case "\t": result += "\\t"; break;
      case "\n": result += "\\n"; break;
      case "\v": result += "\\v"; break;
      case "\f": result += "\\f"; break;
      case "\r": result += "\\r"; break;
      case "\u001b": result += "\\e"; break;
      case "\u0085": result += "\\N"; break;
      case "\u00a0": result += "\\_"; break;
      case "\u2028": result += "\\L"; break;
      case "\u2029": result += "\\P"; break;
      default: {
        const codePoint = character.codePointAt(0) as number;
        result += codePoint <= 0x1f || codePoint >= 0x7f && codePoint <= 0x9f
          ? `\\x${codePoint.toString(16).toUpperCase().padStart(2, "0")}`
          : character;
      }
    }
  }
  return `${result}"`;
}

export function doubleQuotedYamlString(value: string): string {
  return escapeDoubleQuoted(value, false);
}

export function noteDoubleQuotedYamlString(value: string): string {
  return escapeDoubleQuoted(value, true);
}

/** Uses a plain scalar when YAML 1.2 and common YAML 1.1 readers both retain the string type. */
export function canonicalYamlString(value: string): string {
  if (YAML_11_AMBIGUOUS.test(value)) return doubleQuotedYamlString(value);
  const rendered = stringify(value, {
    version: "1.2",
    schema: "core",
    directives: false,
    lineWidth: 0,
    defaultStringType: "PLAIN",
    doubleQuotedMinMultiLineLength: Number.POSITIVE_INFINITY,
  });
  const withoutTerminalLf = rendered.endsWith("\n") ? rendered.slice(0, -1) : rendered;
  return withoutTerminalLf.includes("\n") ? doubleQuotedYamlString(value) : withoutTerminalLf;
}
