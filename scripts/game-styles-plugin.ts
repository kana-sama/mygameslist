import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import postcss, { type AtRule, type Container, type Rule } from "postcss";
import type { Plugin, ViteDevServer } from "vite";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUPPORTED_GROUPING_AT_RULES = new Set(["container", "layer", "media", "supports"]);
const WATCHED_EVENTS = new Set(["add", "change", "unlink", "rename"]);
const RESOLVED_VIRTUAL_MODULE_ID = "\0virtual:mygameslist-game-styles.css";

export const GAME_STYLES_VIRTUAL_MODULE_ID = "virtual:mygameslist-game-styles.css";

export interface GameStylesPluginOptions {
  gamesRoot: string;
}

export interface CompiledGameStyles {
  css: string;
  sourceFiles: readonly string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57
    || code >= 65 && code <= 90
    || code >= 97 && code <= 122
    || character === "-"
    || character === "_"
    || character === "\\"
    || code >= 128;
}

/** CSSOM's CSS.escape algorithm, kept local because Node does not expose CSS.escape. */
function escapeCssIdentifier(value: string): string {
  if (value.length === 0) return "";
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const code = value.charCodeAt(index);
    if (code === 0) {
      result += "\uFFFD";
      continue;
    }
    if (
      code >= 1 && code <= 31
      || code === 127
      || index === 0 && code >= 48 && code <= 57
      || index === 1 && code >= 48 && code <= 57 && value.charCodeAt(0) === 45
    ) {
      result += `\\${code.toString(16)} `;
      continue;
    }
    if (index === 0 && code === 45 && value.length === 1) {
      result += "\\-";
      continue;
    }
    if (
      code >= 128
      || code === 45
      || code === 95
      || code >= 48 && code <= 57
      || code >= 65 && code <= 90
      || code >= 97 && code <= 122
    ) {
      result += character;
      continue;
    }
    result += `\\${character}`;
  }
  return result;
}

function splitSelectorList(selectorList: string, sourcePath: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: "\"" | "'" | null = null;
  let inComment = false;

  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    const next = selectorList[index + 1];
    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
    if (parentheses < 0 || brackets < 0) {
      throw new Error(`Unsupported malformed selector in ${sourcePath}: ${selectorList}`);
    }
  }
  if (inComment || quote || parentheses !== 0 || brackets !== 0) {
    throw new Error(`Unsupported malformed selector in ${sourcePath}: ${selectorList}`);
  }
  selectors.push(selectorList.slice(start).trim());
  if (selectors.some((selector) => selector.length === 0)) {
    throw new Error(`Unsupported empty selector in ${sourcePath}`);
  }
  return selectors;
}

function selectorContainsToken(selector: string, token: string): boolean {
  let quote: "\"" | "'" | null = null;
  let inComment = false;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    const next = selector[index + 1];
    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (selector.startsWith(token, index)) return true;
  }
  return false;
}

function firstTopLevelCombinatorAfterScope(selector: string): " " | ">" | "+" | "~" | "||" | null {
  let parentheses = 0;
  let brackets = 0;
  let quote: "\"" | "'" | null = null;
  let inComment = false;
  let sawWhitespace = false;

  for (let index = 6; index < selector.length; index += 1) {
    const character = selector[index];
    const next = selector[index + 1];
    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses -= 1;
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]") {
      brackets -= 1;
      continue;
    }
    if (parentheses !== 0 || brackets !== 0) continue;
    if (/\s/u.test(character)) {
      sawWhitespace = true;
      continue;
    }
    if (character === "+" || character === "~" || character === ">") return character;
    if (character === "|" && next === "|") return "||";
    if (sawWhitespace) return " ";
  }
  return null;
}

function scopeSelector(selector: string, idSelector: string, sourcePath: string): string {
  if (selectorContainsToken(selector, "&")) {
    throw new Error(`Unsupported nested selector in ${sourcePath}: ${selector}`);
  }
  if (selectorContainsToken(selector.toLocaleLowerCase("en-US"), ":global")) {
    throw new Error(`Unsupported global selector escape in ${sourcePath}: ${selector}`);
  }
  if (selector.slice(0, 6).toLocaleLowerCase("en-US") === ":scope" && !isIdentifierCharacter(selector[6])) {
    const combinator = firstTopLevelCombinatorAfterScope(selector);
    if (combinator === "+" || combinator === "~" || combinator === "||") {
      throw new Error(`Unsupported root-level :scope sibling or column escape in ${sourcePath}: ${selector}`);
    }
    return `${idSelector}${selector.slice(6)}`;
  }
  return `${idSelector} ${selector}`;
}

function validateAndScopeRule(rule: Rule, idSelector: string, sourcePath: string): void {
  if (rule.parent?.type === "rule") {
    throw new Error(`Unsupported nested rule in ${sourcePath}: ${rule.selector}`);
  }
  rule.selector = splitSelectorList(rule.selector, sourcePath)
    .map((selector) => scopeSelector(selector, idSelector, sourcePath))
    .join(", ");
  for (const child of rule.nodes ?? []) {
    if (child.type !== "decl" && child.type !== "comment") {
      throw new Error(`Unsupported nested construct in ${sourcePath}: ${child.toString()}`);
    }
  }
}

function validateAndScopeContainer(
  container: Container,
  idSelector: string,
  sourcePath: string,
): void {
  for (const node of container.nodes ?? []) {
    if (node.type === "comment") continue;
    if (node.type === "rule") {
      validateAndScopeRule(node, idSelector, sourcePath);
      continue;
    }
    if (node.type === "atrule") {
      const atRule = node as AtRule;
      const name = atRule.name.toLocaleLowerCase("en-US");
      if (!SUPPORTED_GROUPING_AT_RULES.has(name) || !atRule.nodes || atRule.parent?.type === "rule") {
        throw new Error(`Unsupported global or non-grouping @${atRule.name} in ${sourcePath}`);
      }
      validateAndScopeContainer(atRule, idSelector, sourcePath);
      continue;
    }
    throw new Error(`Unsupported global ${node.type} in ${sourcePath}`);
  }
}

function gameIdFromDirectory(directoryName: string, sourcePath: string): string {
  const separator = directoryName.lastIndexOf("_");
  const gameId = separator === -1 ? "" : directoryName.slice(separator + 1);
  if (!UUID.test(gameId)) {
    throw new Error(`Invalid game directory UUID for stylesheet ${sourcePath}`);
  }
  return gameId;
}

export async function compileGameStyles(gamesRootInput: string): Promise<CompiledGameStyles> {
  const gamesRoot = resolve(gamesRootInput);
  const directories = (await readdir(gamesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => compareText(left.name, right.name));
  const compiled: string[] = [];
  const sourceFiles: string[] = [];

  for (const directory of directories) {
    const sourcePath = resolve(gamesRoot, directory.name, "styles.css");
    let css: string;
    try {
      css = await readFile(sourcePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const gameId = gameIdFromDirectory(directory.name, sourcePath);
    const root = postcss.parse(css, { from: sourcePath });
    validateAndScopeContainer(root, `#${escapeCssIdentifier(gameId)}`, sourcePath);
    compiled.push(root.toString());
    sourceFiles.push(sourcePath);
  }

  return {
    css: compiled.filter((css) => css.length > 0).join("\n"),
    sourceFiles,
  };
}

function isGameStylesPath(gamesRoot: string, candidate: string): boolean {
  const path = relative(gamesRoot, resolve(candidate));
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return false;
  const segments = path.split(sep);
  return segments.length === 2 && segments[1] === "styles.css";
}

export function gameStylesPlugin(options: GameStylesPluginOptions): Plugin {
  const gamesRoot = resolve(options.gamesRoot);
  let activeCleanup: (() => void) | undefined;

  return {
    name: "mygameslist-game-styles",
    enforce: "pre",
    resolveId(id) {
      return id === GAME_STYLES_VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return null;
      const result = await compileGameStyles(gamesRoot);
      this.addWatchFile(gamesRoot);
      for (const sourceFile of result.sourceFiles) this.addWatchFile(sourceFile);
      return result.css;
    },
    configureServer(server: ViteDevServer) {
      activeCleanup?.();
      server.watcher.add(gamesRoot);
      const onSourceEvent = (eventName: string, path: string): void => {
        if (!WATCHED_EVENTS.has(eventName) || !isGameStylesPath(gamesRoot, path)) return;
        const module = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
        if (module) server.moduleGraph.invalidateModule(module);
        server.hot.send({ type: "full-reload" });
      };
      const cleanup = (): void => {
        server.watcher.off("all", onSourceEvent);
        server.httpServer?.off("close", cleanup);
        if (activeCleanup === cleanup) activeCleanup = undefined;
      };
      server.watcher.on("all", onSourceEvent);
      server.httpServer?.once("close", cleanup);
      activeCleanup = cleanup;
    },
    closeBundle() {
      activeCleanup?.();
    },
  };
}
