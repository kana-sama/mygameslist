import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";
import {
  GAME_STYLES_VIRTUAL_MODULE_ID,
  compileGameStyles,
  gameStylesPlugin,
} from "../scripts/game-styles-plugin";

const ALPHA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NUMERIC_ID = "22222222-2222-4222-8222-222222222222";

async function addGameStyles(
  gamesRoot: string,
  directoryName: string,
  css: string,
): Promise<string> {
  const directory = join(gamesRoot, directoryName);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "styles.css");
  await writeFile(path, css);
  return path;
}

function selectors(css: string): string[] {
  const result: string[] = [];
  postcss.parse(css).walkRules((rule) => result.push(rule.selector));
  return result;
}

describe("per-game stylesheet compilation", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function gamesRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "mygameslist-game-styles-"));
    roots.push(root);
    return root;
  }

  it("discovers optional stylesheets in deterministic game-directory order", async () => {
    const root = await gamesRoot();
    await mkdir(join(root, `middle_${ALPHA_ID}`));
    await addGameStyles(root, `zulu_${NUMERIC_ID}`, ".zulu { order: 2; }");
    await addGameStyles(root, `alpha_${ALPHA_ID}`, ".alpha { order: 1; }");

    const result = await compileGameStyles(root);

    expect(selectors(result.css)).toEqual([
      `#${ALPHA_ID} .alpha`,
      "#\\32 2222222-2222-4222-8222-222222222222 .zulu",
    ]);
    expect(result.sourceFiles).toEqual([
      resolve(root, `alpha_${ALPHA_ID}`, "styles.css"),
      resolve(root, `zulu_${NUMERIC_ID}`, "styles.css"),
    ]);
  });

  it("scopes comma lists and maps a leading :scope to the raw-id shell", async () => {
    const root = await gamesRoot();
    await addGameStyles(root, `fixture_${ALPHA_ID}`, `
:scope, :scope[data-ready] > .panel, .card:is(.wide, .tall) { color: teal; }
`);

    const result = await compileGameStyles(root);

    expect(selectors(result.css)).toEqual([
      `#${ALPHA_ID}, #${ALPHA_ID}[data-ready] > .panel, #${ALPHA_ID} .card:is(.wide, .tall)`,
    ]);
  });

  it("maps a case-insensitive leading :scope pseudo-class to the shell", async () => {
    const root = await gamesRoot();
    await addGameStyles(root, `fixture_${ALPHA_ID}`, ":SCOPE > .panel { color: teal; }");

    const result = await compileGameStyles(root);

    expect(selectors(result.css)).toEqual([`#${ALPHA_ID} > .panel`]);
  });

  it.each([
    ["direct adjacent sibling", ":scope+.outside { color: red; }"],
    ["spaced adjacent sibling", ":scope + .outside { color: red; }"],
    ["commented adjacent sibling", ":scope/* gap */+ .outside { color: red; }"],
    ["direct general sibling", ":scope~.outside { color: red; }"],
    ["spaced general sibling", ":scope ~ .outside { color: red; }"],
    ["commented general sibling", ":scope/* gap */~ .outside { color: red; }"],
    ["direct column sibling", ":scope||.outside { color: red; }"],
    ["spaced column sibling", ":scope || .outside { color: red; }"],
    ["commented column sibling", ":scope/* gap */|| .outside { color: red; }"],
    ["unsafe comma-list member", ".inside, :scope.active + .outside { color: red; }"],
  ])("rejects a root-level %s escape", async (_label, css) => {
    const root = await gamesRoot();
    await addGameStyles(root, `fixture_${ALPHA_ID}`, css);

    await expect(compileGameStyles(root)).rejects.toThrow(/scope|sibling|column|escape|unsupported/i);
  });

  it("allows scoped child and descendant structure without treating nested combinators as escapes", async () => {
    const root = await gamesRoot();
    await addGameStyles(root, `fixture_${ALPHA_ID}`, `
:scope > .child + .sibling,
:scope .row ~ .row,
:scope:is(.active + .selected):not([data-operator="||"]) > .panel,
:scope[data-operator="~"] .inside { color: teal; }
`);

    const result = await compileGameStyles(root);

    expect(selectors(result.css)).toEqual([
      `#${ALPHA_ID} > .child + .sibling, `
        + `#${ALPHA_ID} .row ~ .row, `
        + `#${ALPHA_ID}:is(.active + .selected):not([data-operator="||"]) > .panel, `
        + `#${ALPHA_ID}[data-operator="~"] .inside`,
    ]);
  });

  it("scopes rules recursively through supported conditional grouping at-rules", async () => {
    const root = await gamesRoot();
    await addGameStyles(root, `fixture_${ALPHA_ID}`, `
@media (width > 40rem) { .wide { display: grid; } }
@supports (display: subgrid) { @container card (width > 10rem) { :scope > .grid { display: subgrid; } } }
@layer game { .layered { color: rebeccapurple; } }
`);

    const result = await compileGameStyles(root);

    expect(selectors(result.css)).toEqual([
      `#${ALPHA_ID} .wide`,
      `#${ALPHA_ID} > .grid`,
      `#${ALPHA_ID} .layered`,
    ]);
  });

  it.each([
    ["imports", '@import url("outside.css");'],
    ["global keyframes", "@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }"],
    ["global font faces", '@font-face { font-family: fixture; src: url("fixture.woff2"); }'],
    ["global selector escapes", ":global(.outside) { color: red; }"],
    ["unsupported grouping", "@scope (.card) { .child { color: red; } }"],
    ["nested selectors", ".card { & .child { color: red; } }"],
  ])("rejects %s instead of emitting unscoped CSS", async (_label, css) => {
    const root = await gamesRoot();
    await addGameStyles(root, `fixture_${ALPHA_ID}`, css);

    await expect(compileGameStyles(root)).rejects.toThrow(/unsupported|global|nested|import/i);
  });

  it("exposes the combined result through one watched virtual CSS module", async () => {
    const root = await gamesRoot();
    const sourceFile = await addGameStyles(root, `fixture_${ALPHA_ID}`, ".card { color: teal; }");
    const plugin = gameStylesPlugin({ gamesRoot: root });
    const resolvedId = await (plugin.resolveId as (id: string) => string | null)(GAME_STYLES_VIRTUAL_MODULE_ID);
    const watched: string[] = [];

    const css = await (plugin.load as (this: { addWatchFile(path: string): void }, id: string) => Promise<string | null>)
      .call({ addWatchFile: (path) => watched.push(path) }, resolvedId!);

    expect(selectors(css!)).toEqual([`#${ALPHA_ID} .card`]);
    expect(watched).toEqual([resolve(root), resolve(sourceFile)]);
  });

  it("invalidates and reloads only root game stylesheet events and removes its handler on cleanup", async () => {
    const root = await gamesRoot();
    const plugin = gameStylesPlugin({ gamesRoot: root });
    const watcher = new EventEmitter() as EventEmitter & { add(path: string): void };
    const watched: string[] = [];
    watcher.add = (path) => watched.push(path);
    const httpServer = new EventEmitter();
    const virtualModule = {};
    const invalidated: unknown[] = [];
    const hotMessages: unknown[] = [];
    const server = {
      watcher,
      httpServer,
      moduleGraph: {
        getModuleById: () => virtualModule,
        invalidateModule: (module: unknown) => invalidated.push(module),
      },
      hot: { send: (message: unknown) => hotMessages.push(message) },
    };

    (plugin.configureServer as (server: unknown) => void)(server);
    const stylesheet = resolve(root, `fixture_${ALPHA_ID}`, "styles.css");
    for (const event of ["add", "change", "unlink", "rename"]) watcher.emit("all", event, stylesheet);
    watcher.emit("all", "change", resolve(root, `fixture_${ALPHA_ID}`, "theme.css"));
    watcher.emit("all", "change", resolve(root, `fixture_${ALPHA_ID}`, "nested", "styles.css"));
    watcher.emit("all", "addDir", stylesheet);

    expect(watched).toEqual([resolve(root)]);
    expect(invalidated).toEqual([virtualModule, virtualModule, virtualModule, virtualModule]);
    expect(hotMessages).toEqual(Array.from({ length: 4 }, () => ({ type: "full-reload" })));
    expect(watcher.listenerCount("all")).toBe(1);

    httpServer.emit("close");
    watcher.emit("all", "change", stylesheet);

    expect(watcher.listenerCount("all")).toBe(0);
    expect(invalidated).toHaveLength(4);
    expect(hotMessages).toHaveLength(4);
  });
});
