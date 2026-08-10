/// <reference lib="dom" />

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { SourceAssembly } from "../src/source";
import {
  createRuntimeArtifactSnapshot,
  type RuntimeArtifactSnapshot,
} from "./artifact-root";
import { validateSourceTree } from "./validate-source";

const PLUGIN_NAME = "mygameslist-library-source";
const WATCHED_EVENTS = new Set(["add", "addDir", "change", "unlink", "unlinkDir", "rename"]);

export interface LibrarySourcePluginOptions {
  /** Physical directory mounted as logical `data`. */
  sourceRoot: string;
}

interface InternalLibrarySourcePluginOptions {
  loadAssembly?: (generation: number) => Promise<SourceAssembly>;
  coalesceDelayMs?: number;
}

type DevArtifactState =
  | { kind: "ready"; generation: number; snapshot: RuntimeArtifactSnapshot }
  | { kind: "unavailable"; generation: number; error: Error };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isGeneratedPath(pathname: string): boolean {
  return pathname === "/data"
    || pathname.startsWith("/data/")
    || pathname === "/media"
    || pathname.startsWith("/media/");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === ""
    || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function setNoStore(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
}

function endBytes(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  bytes: Uint8Array,
  contentType: string,
): void {
  response.statusCode = statusCode;
  setNoStore(response);
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", String(bytes.byteLength));
  response.end(request.method === "HEAD" ? undefined : bytes);
}

function createMiddleware(readState: () => DevArtifactState) {
  return (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): void => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://mygameslist.invalid").pathname;
    } catch {
      next();
      return;
    }
    if (!isGeneratedPath(pathname)) {
      next();
      return;
    }

    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.statusCode = 405;
      setNoStore(response);
      response.setHeader("Allow", "GET, HEAD");
      response.end();
      return;
    }

    const state = readState();
    if (state.kind === "unavailable") {
      const bytes = new TextEncoder().encode(`Library source unavailable: ${state.error.message}\n`);
      endBytes(request, response, 503, bytes, "text/plain; charset=utf-8");
      return;
    }

    if (pathname === "/data/library.json") {
      endBytes(request, response, 200, state.snapshot.libraryJson, "application/json; charset=utf-8");
      return;
    }
    if (pathname.startsWith("/media/")) {
      const filename = pathname.slice("/media/".length);
      const artifact = state.snapshot.media.get(filename);
      if (artifact !== undefined && filename !== "" && !filename.includes("/")) {
        endBytes(request, response, 200, artifact.bytes, artifact.contentType);
        return;
      }
    }

    response.statusCode = 404;
    setNoStore(response);
    response.end();
  };
}

function overlayPayload(error: Error) {
  return {
    type: "error" as const,
    err: {
      message: error.message,
      stack: error.stack ?? error.message,
      plugin: PLUGIN_NAME,
    },
  };
}

export function librarySourcePlugin(
  options: LibrarySourcePluginOptions,
): Plugin {
  const sourceRoot = resolve(options.sourceRoot);
  const internal = options as LibrarySourcePluginOptions & InternalLibrarySourcePluginOptions;
  const loadAssembly = internal.loadAssembly
    ?? (async () => validateSourceTree({ sourceRoot, sourceCommitSha: null }));
  const coalesceDelayMs = internal.coalesceDelayMs ?? 0;
  let activeCleanup: (() => void) | undefined;

  return {
    name: PLUGIN_NAME,
    apply: "serve",
    enforce: "pre",
    async configureServer(server: ViteDevServer) {
      activeCleanup?.();
      let requestedGeneration = 0;
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let state: DevArtifactState = {
        kind: "unavailable",
        generation: 0,
        error: new Error(`Library source is initializing: ${sourceRoot}`),
      };

      server.middlewares.use(createMiddleware(() => state));
      server.watcher.add(sourceRoot);

      const rebuild = async (generation: number, initial: boolean): Promise<void> => {
        try {
          const assembly = await loadAssembly(generation);
          const snapshot = createRuntimeArtifactSnapshot(assembly);
          if (disposed || generation !== requestedGeneration) return;
          state = { kind: "ready", generation, snapshot };
          if (!initial) server.hot.send({ type: "full-reload" });
        } catch (error) {
          const normalized = asError(error);
          if (disposed || generation !== requestedGeneration) return;
          state = { kind: "unavailable", generation, error: normalized };
          server.config.logger.error(normalized.stack ?? normalized.message);
          server.hot.send(overlayPayload(normalized));
        }
      };

      const scheduleRebuild = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void rebuild(requestedGeneration, false);
        }, coalesceDelayMs);
      };

      const onSourceEvent = (eventName: string, changedPath: string): void => {
        if (disposed || !WATCHED_EVENTS.has(eventName)) return;
        const path = resolve(changedPath);
        if (!isInsideRoot(sourceRoot, path)) return;
        requestedGeneration += 1;
        state = {
          kind: "unavailable",
          generation: requestedGeneration,
          error: new Error(`Library source is rebuilding after ${eventName}: ${path}`),
        };
        scheduleRebuild();
      };

      const cleanup = (): void => {
        if (disposed) return;
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        server.watcher.off("all", onSourceEvent);
        server.httpServer?.off("close", cleanup);
        if (activeCleanup === cleanup) activeCleanup = undefined;
      };

      server.watcher.on("all", onSourceEvent);
      server.httpServer?.once("close", cleanup);
      activeCleanup = cleanup;
      await rebuild(0, true);
    },
    closeBundle() {
      activeCleanup?.();
    },
  };
}
