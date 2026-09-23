import type { GraphDocument } from "../../domain/graph";
import { graphLayoutKey } from "./layout";
import type {
  GraphGeometry,
  GraphLayoutRequest,
  GraphLayoutResponse,
} from "./layoutTypes";

type Port = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror">;
const cache = new Map<string, GraphGeometry>();
const clients = new Set<Port>();
let sharedWorker: Worker | null = null;
let sequence = 0;
function sharedPort(): Port {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
      type: "module",
    });
    sharedWorker.onmessage = (event) => {
      for (const client of clients)
        client.onmessage?.call(sharedWorker!, event);
    };
    sharedWorker.onerror = (event) => {
      const active = sharedWorker;
      sharedWorker = null;
      active?.terminate();
      for (const client of [...clients]) client.onerror?.call(active!, event);
    };
  }
  const port: Port = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => sharedWorker!.postMessage(message),
    terminate: () => {
      clients.delete(port);
      if (!clients.size) {
        sharedWorker?.terminate();
        sharedWorker = null;
      }
    },
  };
  clients.add(port);
  return port;
}
function stopSharedEngine() {
  const active = sharedWorker;
  sharedWorker = null;
  active?.terminate();
  for (const client of [...clients])
    client.onerror?.call(active!, new Event("error") as ErrorEvent);
}

/** One application engine, explicit request ownership, and a bounded shared cache. */
export class GraphLayoutClient {
  private worker: Port | null = null;
  private pending: {
    id: number;
    key: string;
    resolve: (geometry: GraphGeometry) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private disposed = false;
  constructor(private readonly factory: () => Port = sharedPort) {}
  layout(
    graph: GraphDocument,
    width: number,
    font?: string,
  ): Promise<GraphGeometry> {
    if (this.disposed)
      return Promise.reject(new Error("Layout client disposed"));
    this.cancel("Layout request superseded");
    const key = graphLayoutKey(graph, width, font);
    const existing = cache.get(key);
    if (existing) {
      cache.delete(key);
      cache.set(key, existing);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          this.worker = this.factory();
          this.worker.onmessage = (event) => {
            const result = event.data as GraphLayoutResponse;
            const pending = this.pending;
            if (
              !pending ||
              result.id !== pending.id ||
              result.key !== pending.key
            )
              return;
            clearTimeout(pending.timer);
            this.pending = null;
            if ("error" in result) {
              pending.reject(new Error(result.error));
              return;
            }
            cache.set(keyFor(result), result.geometry);
            while (cache.size > 24) cache.delete(cache.keys().next().value!);
            pending.resolve(result.geometry);
          };
          this.worker.onerror = () => {
            this.cancel(
              "Не удалось загрузить движок графа. Повторите попытку.",
            );
            this.worker?.terminate();
            this.worker = null;
          };
        }
        const id = ++sequence;
        const timer = setTimeout(() => {
          this.cancel("Граф не отобразился за 5 секунд. Повторите попытку.");
          if (this.factory === sharedPort) stopSharedEngine();
          this.worker?.terminate();
          this.worker = null;
        }, 5000);
        this.pending = { id, key, resolve, reject, timer };
        const request: GraphLayoutRequest = { id, key, graph, width, font };
        this.worker.postMessage(request);
      } catch (error) {
        this.cancel(error instanceof Error ? error.message : String(error));
        reject(error instanceof Error ? error : new Error(String(error)));
        this.worker?.terminate();
        this.worker = null;
      }
    });
  }
  private cancel(message: string) {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel("Layout client disposed");
    this.worker?.terminate();
    this.worker = null;
  }
}
function keyFor(response: GraphLayoutResponse) {
  return response.key;
}
