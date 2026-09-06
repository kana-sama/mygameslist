/// <reference lib="dom" />

import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { isDeploymentCommitSha, parseDeploymentVersion, type DeploymentVersion } from "../src/shared/deploymentVersion";

interface Location {
  startOffset: number;
  endOffset: number;
  startTag?: Location;
  endTag?: Location;
}
interface ParsedDocument {
  window: { document: Document; close(): void };
  nodeLocation(node: Node): Location | null;
}
// jsdom is an existing build/test dependency. Keep its untyped boundary local.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { includeNodeLocations: true }) => ParsedDocument;
};
const META_NAME = "mygameslist-deployment-commit";

function inspectHtml(html: string): { headEnd: number; meta: Location | null; content: string | null } {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  try {
    const document = dom.window.document;
    const head = dom.nodeLocation(document.head);
    const body = dom.nodeLocation(document.body);
    const root = dom.nodeLocation(document.documentElement);
    if (!head?.startTag || !head.endTag || !body?.startTag || !body.endTag || !root?.startTag || !root.endTag
      || head.endTag.endOffset > body.startTag.startOffset) {
      throw new Error("Deployment HTML requires an explicit, well-formed html/head/body structure");
    }
    // Ignore comments and literal markup in raw-text/RCDATA elements. Ordinary
    // whitespace nodes can span closing body/html tags after parser coalescing;
    // masking their source ranges would hide real document structure.
    const ignored: Location[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === 8 || (node.nodeType === 3
        && /^(?:SCRIPT|STYLE|TITLE|TEXTAREA|XMP|IFRAME|NOEMBED|NOFRAMES|PLAINTEXT)$/.test(node.parentNode?.nodeName ?? ""))) {
        const location = dom.nodeLocation(node);
        if (location) ignored.push(location);
      }
      for (const child of node.childNodes) visit(child);
      if (node.nodeName === "TEMPLATE") visit((node as HTMLTemplateElement).content);
    };
    visit(document);
    let tags = html;
    for (const location of ignored.sort((a, b) => b.startOffset - a.startOffset)) {
      tags = tags.slice(0, location.startOffset) + " ".repeat(location.endOffset - location.startOffset) + tags.slice(location.endOffset);
    }
    const structure = [...tags.matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g)]
      .map(([tag]) => /^<\s*(\/?(?:html|head|body))(?=[\s>])/i.exec(tag)?.[1]?.toLowerCase())
      .filter(Boolean);
    if (structure.join(",") !== "html,head,/head,body,/body,/html") {
      throw new Error("Deployment HTML contains malformed or duplicate document structure");
    }
    const metas = [...document.querySelectorAll("meta")].filter((meta) => meta.getAttribute("name") === META_NAME);
    if (metas.length > 1 || metas.some((meta) => meta.parentElement !== document.head)) {
      throw new Error("Deployment HTML must have at most one deployment meta, directly in head");
    }
    const meta = metas[0];
    return { headEnd: head.endTag.startOffset, meta: meta ? dom.nodeLocation(meta) : null, content: meta?.getAttribute("content") ?? null };
  } finally {
    dom.window.close();
  }
}

type Identity = { path: string; stat: BigIntStats };

async function directoryChain(root: string): Promise<Identity[]> {
  const chain: Identity[] = [];
  for (let path = resolve(root); ; path = dirname(path)) {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Deployment root must use real directories: ${path}`);
    chain.unshift({ path, stat });
    if (dirname(path) === path) return chain;
  }
}

async function assertChain(chain: readonly Identity[]): Promise<void> {
  for (const { path, stat } of chain) {
    const actual = await lstat(path, { bigint: true });
    if (!actual.isDirectory() || actual.dev !== stat.dev || actual.ino !== stat.ino) {
      throw new Error(`Deployment directory identity changed: ${path}`);
    }
  }
}

async function regularFile(
  path: string,
  chain: readonly Identity[],
  replacement?: string,
  previous?: BigIntStats,
): Promise<{ text: string; stat: BigIntStats }> {
  await assertChain(chain);
  let expected: BigIntStats | null;
  try {
    expected = await lstat(path, { bigint: true });
  } catch (error) {
    if (replacement === undefined || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    expected = null;
  }
  if (expected && (!expected.isFile() || expected.isSymbolicLink() || (replacement !== undefined && expected.nlink !== 1n))) {
    throw new Error(`Deployment entry must be a regular unlinked file: ${path}`);
  }
  if (previous && (!expected || expected.dev !== previous.dev || expected.ino !== previous.ino)) {
    throw new Error(`Deployment file identity changed: ${path}`);
  }
  await assertChain(chain);
  const flags = constants.O_NOFOLLOW | (replacement === undefined ? constants.O_RDONLY : constants.O_RDWR)
    | (expected === null ? constants.O_CREAT | constants.O_EXCL : 0);
  const handle = await open(path, flags, 0o644);
  try {
    const actual = await handle.stat({ bigint: true });
    if (!actual.isFile() || (expected && (actual.dev !== expected.dev || actual.ino !== expected.ino))
      || (replacement !== undefined && actual.nlink !== 1n)) {
      throw new Error(`Deployment file identity changed: ${path}`);
    }
    await assertChain(chain);
    if (replacement !== undefined) {
      await handle.truncate(0);
      await handle.writeFile(replacement, "utf8");
      await handle.sync();
    }
    const result = replacement ?? await handle.readFile("utf8");
    const final = await lstat(path, { bigint: true });
    if (!final.isFile() || final.dev !== actual.dev || final.ino !== actual.ino) throw new Error(`Deployment file identity changed: ${path}`);
    await assertChain(chain);
    return { text: result, stat: actual };
  } finally {
    await handle.close();
  }
}

function expectedVersion(sha: string | null): DeploymentVersion {
  if (sha !== null && !isDeploymentCommitSha(sha)) throw new Error("Invalid deployment source commit SHA");
  return { sourceCommitSha: sha };
}

export async function stampDeploymentVersion(root: string, sha: string | null): Promise<void> {
  const version = expectedVersion(sha);
  const chain = await directoryChain(root);
  const path = join(resolve(root), "index.html");
  const original = await regularFile(path, chain);
  const html = original.text;
  const { headEnd, meta } = inspectHtml(html);
  const tag = `<meta name="${META_NAME}" content="${sha ?? ""}">`;
  const stamped = meta
    ? html.slice(0, meta.startOffset) + tag + html.slice(meta.endOffset)
    : html.slice(0, headEnd) + tag + html.slice(headEnd);
  await regularFile(join(resolve(root), "version.json"), chain, `${JSON.stringify(version)}\n`);
  await regularFile(path, chain, stamped, original.stat);
}

export async function validateDeploymentVersion(root: string, sha: string | null): Promise<void> {
  expectedVersion(sha);
  const chain = await directoryChain(root);
  const { meta, content } = inspectHtml((await regularFile(join(resolve(root), "index.html"), chain)).text);
  const version = parseDeploymentVersion(JSON.parse((await regularFile(join(resolve(root), "version.json"), chain)).text));
  const dataChain = await directoryChain(join(resolve(root), "data"));
  const library = JSON.parse((await regularFile(join(resolve(root), "data/library.json"), dataChain)).text);
  if (!meta || content !== (sha ?? "") || version.sourceCommitSha !== sha || library?.sourceCommitSha !== sha) {
    throw new Error("Deployment HTML, version.json and library provenance must match the build SHA");
  }
  await assertChain(chain);
}
