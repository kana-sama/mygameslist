// @vitest-environment node

import { EventEmitter } from "node:events";
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Plugin, UserConfig, ViteDevServer } from "vite";
import viteConfig from "../vite.config";
import type { LibraryDatabase } from "../src/domain";
import { projectSourceTree, type SourceAssembly } from "../src/source";
import { createRuntimeArtifactSnapshot } from "../scripts/artifact-root";
import {
  librarySourcePlugin,
  type LibrarySourcePluginOptions,
} from "../scripts/vite-library-source-plugin";
import { materializeProjectedSourceTree } from "../scripts/source-tree-fs";
import { validateSourceTree } from "../scripts/validate-source";
import {
  FILE_BYTES,
  FILE_ID,
  GAME_A_ID,
  IMAGE_BYTES,
  IMAGE_ID,
  NOTE_ATTACHMENTS_ID,
  fixtureDatabase,
} from "./fixtures/source-tree";

type TestMiddleware = (
  request: { method?: string; url?: string },
  response: TestResponse,
  next: () => void,
) => void;

interface TestResponse {
  statusCode: number;
  headers: Map<string, string>;
  body: Uint8Array;
  setHeader(name: string, value: string | number | readonly string[]): void;
  end(body?: string | Uint8Array): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

class FakeWatcher extends EventEmitter {
  readonly added: string[] = [];

  add(path: string): this {
    this.added.push(path);
    return this;
  }
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createResponse(): TestResponse {
  const response: TestResponse = {
    statusCode: 200,
    headers: new Map(),
    body: new Uint8Array(),
    setHeader(name, value) {
      response.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
    },
    end(body) {
      response.body = body === undefined
        ? new Uint8Array()
        : typeof body === "string"
          ? new TextEncoder().encode(body)
          : Uint8Array.from(body);
    },
  };
  return response;
}

function invoke(
  middleware: TestMiddleware,
  method: string,
  url: string,
): { response: TestResponse; nextCalls: number } {
  const response = createResponse();
  let nextCalls = 0;
  middleware({ method, url }, response, () => {
    nextCalls += 1;
  });
  return { response, nextCalls };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function tick(): Promise<void> {
  return new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function hookHandler(plugin: Plugin): (server: ViteDevServer) => unknown {
  const hook = plugin.configureServer;
  if (hook === undefined) throw new Error("Plugin has no configureServer hook");
  return typeof hook === "function" ? hook : hook.handler;
}

function pluginWithLoader(
  sourceRoot: string,
  loadAssembly: (generation: number) => Promise<SourceAssembly>,
  coalesceDelayMs = 0,
): Plugin {
  const internalOptions = {
    sourceRoot,
    loadAssembly,
    coalesceDelayMs,
  } as LibrarySourcePluginOptions;
  return librarySourcePlugin(internalOptions);
}

function createFakeServer(): {
  server: ViteDevServer;
  watcher: FakeWatcher;
  hotPayloads: unknown[];
  loggerErrors: unknown[][];
  getMiddleware(): TestMiddleware;
} {
  const watcher = new FakeWatcher();
  const hotPayloads: unknown[] = [];
  const loggerErrors: unknown[][] = [];
  let middleware: TestMiddleware | undefined;
  const server = {
    middlewares: {
      use(candidate: TestMiddleware) {
        middleware = candidate;
      },
    },
    watcher,
    hot: {
      send(payload: unknown) {
        hotPayloads.push(payload);
      },
    },
    config: {
      logger: {
        error(...arguments_: unknown[]) {
          loggerErrors.push(arguments_);
        },
      },
    },
  } as unknown as ViteDevServer;
  return {
    server,
    watcher,
    hotPayloads,
    loggerErrors,
    getMiddleware() {
      if (middleware === undefined) throw new Error("Middleware was not installed");
      return middleware;
    },
  };
}

async function configure(plugin: Plugin, server: ViteDevServer): Promise<void> {
  const result = await hookHandler(plugin).call({}, server);
  expect(result, "configureServer must not return a Vite post-hook cleanup").toBeUndefined();
}

async function closePlugin(plugin: Plugin): Promise<void> {
  const hook = plugin.closeBundle;
  if (hook === undefined) throw new Error("Plugin has no closeBundle cleanup hook");
  const handler = typeof hook === "function" ? hook : hook.handler;
  await handler.call({} as never);
}

describe("Vite library source plugin", () => {
  let sandbox = "";

  beforeEach(async () => {
    sandbox = await mkdtemp(join(await realpath("/tmp"), "mgl-vite-source-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(sandbox, { recursive: true, force: true });
  });

  async function createAssembly(name: string, database: LibraryDatabase = fixtureDatabase()): Promise<{
    sourceRoot: string;
    assembly: SourceAssembly;
  }> {
    const sourceRoot = join(sandbox, name, "data");
    await mkdir(join(sandbox, name), { recursive: true });
    const projection = await projectSourceTree(database);
    await materializeProjectedSourceTree({
      targetSourceRoot: sourceRoot,
      projection,
      async resolveAssetBytes(leaf) {
        return leaf.assetId === IMAGE_ID ? IMAGE_BYTES.slice() : FILE_BYTES.slice();
      },
    });
    return {
      sourceRoot,
      assembly: await validateSourceTree({ sourceRoot, sourceCommitSha: null }),
    };
  }

  test("has exact Vite metadata and is configured before React without running during build", () => {
    const plugin = librarySourcePlugin({ sourceRoot: join(sandbox, "data") });
    expect({ name: plugin.name, apply: plugin.apply, enforce: plugin.enforce }).toEqual({
      name: "mygameslist-library-source",
      apply: "serve",
      enforce: "pre",
    });

    const configuredPlugins = ((viteConfig as UserConfig).plugins ?? []).flat(Infinity) as Plugin[];
    const sourceIndex = configuredPlugins.findIndex((candidate) => candidate.name === "mygameslist-library-source");
    const reactIndex = configuredPlugins.findIndex((candidate) => candidate.name.startsWith("vite:react"));
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(reactIndex).toBeGreaterThan(sourceIndex);
  });

  test("installs actual middleware immediately and serves one real filesystem snapshot with exact GET and HEAD semantics", async () => {
    const { sourceRoot, assembly } = await createAssembly("real-source");
    const expected = createRuntimeArtifactSnapshot(assembly);
    const fake = createFakeServer();
    const plugin = librarySourcePlugin({ sourceRoot });
    const configuring = configure(plugin, fake.server);
    const middleware = fake.getMiddleware();
    const initializing = invoke(middleware, "GET", "/data/library.json");
    expect(initializing.response.statusCode).toBe(503);
    await configuring;

    expect(fake.watcher.added).toEqual([resolve(sourceRoot)]);
    expect(fake.hotPayloads).toEqual([]);
    expect(fake.loggerErrors).toEqual([]);

    for (const method of ["GET", "HEAD"]) {
      const library = invoke(middleware, method, "/data/library.json?fresh=1");
      expect(library.nextCalls).toBe(0);
      expect(library.response.statusCode).toBe(200);
      expect(library.response.headers).toEqual(new Map([
        ["cache-control", "no-store"],
        ["content-type", "application/json; charset=utf-8"],
        ["content-length", String(expected.libraryJson.byteLength)],
      ]));
      expect(library.response.body).toEqual(method === "GET" ? expected.libraryJson : new Uint8Array());

      for (const [filename, artifact] of expected.media) {
        const media = invoke(middleware, method, `/media/${filename}`);
        expect(media.nextCalls).toBe(0);
        expect(media.response.statusCode).toBe(200);
        expect(media.response.headers).toEqual(new Map([
          ["cache-control", "no-store"],
          ["content-type", artifact.contentType],
          ["content-length", String(artifact.bytes.byteLength)],
        ]));
        expect(media.response.body).toEqual(method === "GET" ? artifact.bytes : new Uint8Array());
      }
    }

    const parsed = JSON.parse(text(invoke(middleware, "GET", "/data/library.json").response.body));
    expect(parsed.sourceCommitSha).toBeNull();
    expect(await pathExists(join(sandbox, "public"))).toBe(false);
    await closePlugin(plugin);
  });

  test("serves video files under their exact runtime extension and validated MIME", async () => {
    const database = fixtureDatabase();
    const file = database.assets[FILE_ID];
    if (file.kind !== "file") throw new Error("Fixture file asset changed kind");
    file.mime = "video/mp4";
    file.originalName = "playthrough.mp4";
    const { sourceRoot, assembly } = await createAssembly("video-source", database);
    const fake = createFakeServer();
    const plugin = pluginWithLoader(sourceRoot, async () => assembly);
    await configure(plugin, fake.server);

    const video = invoke(fake.getMiddleware(), "GET", `/media/${FILE_ID}.mp4`);
    expect(video.response.statusCode).toBe(200);
    expect(video.response.headers.get("content-type")).toBe("video/mp4");
    expect(video.response.body).toEqual(FILE_BYTES);
    expect(invoke(fake.getMiddleware(), "GET", `/media/${FILE_ID}.bin`).response.statusCode).toBe(404);
    await closePlugin(plugin);
  });

  test("shadows every generated path with exact 404, 405, and unavailable 503 behavior", async () => {
    const { assembly } = await createAssembly("routes");
    const sourceRoot = join(sandbox, "routes", "data");
    const fake = createFakeServer();
    await configure(pluginWithLoader(sourceRoot, async () => assembly), fake.server);
    const middleware = fake.getMiddleware();

    for (const url of [
      "/data", "/data/", "/data/Library.json", "/data/unknown.json",
      "/media", "/media/", `/media/${IMAGE_ID.toUpperCase()}.webp`, "/media/nested/file.bin",
    ]) {
      const result = invoke(middleware, "GET", url);
      expect(result.response.statusCode, url).toBe(404);
      expect(result.response.headers).toEqual(new Map([["cache-control", "no-store"]]));
      expect(result.nextCalls).toBe(0);
    }
    for (const method of ["POST", "PUT"]) {
      const result = invoke(middleware, method, "/media/legacy.bin");
      expect(result.response.statusCode).toBe(405);
      expect(result.response.headers).toEqual(new Map([
        ["cache-control", "no-store"],
        ["allow", "GET, HEAD"],
      ]));
      expect(result.nextCalls).toBe(0);
    }
    expect(invoke(middleware, "GET", "/src/main.tsx").nextCalls).toBe(1);

    const next = deferred<SourceAssembly>();
    let call = 0;
    const racing = createFakeServer();
    await configure(pluginWithLoader(sourceRoot, async () => call++ === 0 ? assembly : next.promise), racing.server);
    racing.watcher.emit("all", "change", join(sourceRoot, "manifest.yaml"));
    for (const method of ["GET", "HEAD"]) {
      for (const url of ["/data/library.json", `/media/${IMAGE_ID}.webp`, "/media/unknown.bin"]) {
        const unavailable = invoke(racing.getMiddleware(), method, url);
        expect(unavailable.response.statusCode, `${method} ${url}`).toBe(503);
        expect(unavailable.response.headers.get("cache-control")).toBe("no-store");
        expect(unavailable.response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(Number(unavailable.response.headers.get("content-length"))).toBeGreaterThan(0);
        expect(unavailable.response.body.byteLength).toBe(method === "GET" ? text(unavailable.response.body).length : 0);
        expect(unavailable.nextCalls).toBe(0);
      }
    }
    next.resolve(assembly);
  });

  test("invalidates synchronously, atomically publishes only the latest generation, and coalesces bursts", async () => {
    const first = await createAssembly("generation-one");
    const changedDatabase = fixtureDatabase();
    changedDatabase.games[GAME_A_ID].title = "Latest generation";
    changedDatabase.notes[NOTE_ATTACHMENTS_ID].attachments = changedDatabase.notes[NOTE_ATTACHMENTS_ID].attachments
      .filter((attachment) => attachment.type !== "file");
    delete changedDatabase.assets[FILE_ID];
    const latest = await createAssembly("generation-two", changedDatabase);
    const oldCandidate = deferred<SourceAssembly>();
    const latestCandidate = deferred<SourceAssembly>();
    const calls: number[] = [];
    const fake = createFakeServer();
    const plugin = pluginWithLoader(first.sourceRoot, async (generation) => {
      calls.push(generation);
      if (generation === 0) return first.assembly;
      if (generation === 1) return oldCandidate.promise;
      return latestCandidate.promise;
    });
    await configure(plugin, fake.server);
    const middleware = fake.getMiddleware();

    fake.watcher.emit("all", "change", join(first.sourceRoot, "manifest.yaml"));
    expect(invoke(middleware, "GET", "/data/library.json").response.statusCode).toBe(503);
    expect(invoke(middleware, "GET", `/media/${FILE_ID}.bin`).response.statusCode).toBe(503);
    await tick();
    expect(calls).toEqual([0, 1]);

    fake.watcher.emit("all", "unlink", join(first.sourceRoot, "games", "removed.yaml"));
    await tick();
    expect(calls).toEqual([0, 1, 2]);
    latestCandidate.resolve(latest.assembly);
    await tick();
    expect(invoke(middleware, "GET", "/data/library.json").response.statusCode).toBe(200);
    expect(text(invoke(middleware, "GET", "/data/library.json").response.body)).toContain("Latest generation");
    expect(invoke(middleware, "GET", `/media/${FILE_ID}.bin`).response.statusCode).toBe(404);
    expect(fake.hotPayloads).toEqual([{ type: "full-reload" }]);

    oldCandidate.resolve(first.assembly);
    await tick();
    expect(text(invoke(middleware, "GET", "/data/library.json").response.body)).toContain("Latest generation");
    expect(fake.hotPayloads).toEqual([{ type: "full-reload" }]);

    fake.watcher.emit("all", "add", join(first.sourceRoot, "burst-a.yaml"));
    fake.watcher.emit("all", "change", join(first.sourceRoot, "burst-b.yaml"));
    fake.watcher.emit("all", "unlinkDir", join(first.sourceRoot, "burst-directory"));
    await tick();
    expect(calls.at(-1)).toBe(5);
    expect(calls).not.toContain(3);
    expect(calls).not.toContain(4);
    await tick();
    expect(fake.hotPayloads).toEqual([{ type: "full-reload" }, { type: "full-reload" }]);
    await closePlugin(plugin);
  });

  test("latest failure sends one exact overlay, remains unavailable, and a valid edit full-reloads", async () => {
    const { sourceRoot, assembly } = await createAssembly("failure-recovery");
    const failure = new Error(`Malformed source at ${join(sourceRoot, "manifest.yaml")}`);
    const loads: Array<() => Promise<SourceAssembly>> = [
      async () => assembly,
      async () => { throw failure; },
      async () => assembly,
    ];
    const fake = createFakeServer();
    await configure(pluginWithLoader(sourceRoot, async () => loads.shift()!()), fake.server);

    fake.watcher.emit("all", "change", join(sourceRoot, "manifest.yaml"));
    await tick();
    await tick();
    expect(fake.hotPayloads).toEqual([{
      type: "error",
      err: {
        message: failure.message,
        stack: failure.stack,
        plugin: "mygameslist-library-source",
      },
    }]);
    expect(invoke(fake.getMiddleware(), "GET", "/data/library.json").response.statusCode).toBe(503);
    expect(invoke(fake.getMiddleware(), "GET", `/media/${IMAGE_ID}.webp`).response.statusCode).toBe(503);

    fake.watcher.emit("all", "change", join(sourceRoot, "manifest.yaml"));
    await tick();
    await tick();
    expect(invoke(fake.getMiddleware(), "GET", "/data/library.json").response.statusCode).toBe(200);
    expect(fake.hotPayloads.at(-1)).toEqual({ type: "full-reload" });
  });

  test("initial failure keeps middleware at 503, ignores outside paths, recovers, and cleans up only its listener", async () => {
    const { sourceRoot, assembly } = await createAssembly("initial-failure");
    const initialFailure = new Error(`Source root unavailable: ${sourceRoot}`);
    let calls = 0;
    const fake = createFakeServer();
    const plugin = pluginWithLoader(sourceRoot, async () => {
      calls += 1;
      if (calls === 1) throw initialFailure;
      return assembly;
    });
    await configure(plugin, fake.server);
    const middleware = fake.getMiddleware();

    expect(fake.loggerErrors.flat().join(" ")).toContain(initialFailure.message);
    expect(invoke(middleware, "GET", "/data/library.json").response.statusCode).toBe(503);
    fake.watcher.emit("all", "change", `${sourceRoot}-similar/manifest.yaml`);
    fake.watcher.emit("all", "change", join(dirname(sourceRoot), "outside.yaml"));
    await tick();
    expect(calls).toBe(1);

    fake.watcher.emit("all", "add", sourceRoot);
    expect(invoke(middleware, "GET", "/media/anything.bin").response.statusCode).toBe(503);
    await tick();
    await tick();
    expect(calls).toBe(2);
    expect(invoke(middleware, "GET", "/data/library.json").response.statusCode).toBe(200);
    expect(fake.hotPayloads.at(-1)).toEqual({ type: "full-reload" });

    const listenersBefore = fake.watcher.listenerCount("all");
    expect(listenersBefore).toBe(1);
    await closePlugin(plugin);
    expect(fake.watcher.listenerCount("all")).toBe(0);
    fake.watcher.emit("all", "change", join(sourceRoot, "manifest.yaml"));
    await tick();
    expect(calls).toBe(2);
  });
});
