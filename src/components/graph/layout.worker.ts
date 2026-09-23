import { layoutGraph } from "./layout";
import type { GraphLayoutRequest, GraphLayoutResponse } from "./layoutTypes";

// Import and instantiate the WASM engine only when a graph actually needs layout.
let engine: Promise<import("@viz-js/viz").Viz> | undefined;
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<GraphLayoutRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: GraphLayoutResponse;
    try {
      engine ??= import("@viz-js/viz").then((module) => module.instance());
      const geometry = await layoutGraph(
        request.graph,
        request.width,
        await engine,
        request.font,
      );
      response = { id: request.id, key: request.key, geometry };
    } catch (error) {
      engine = undefined;
      response = {
        id: request.id,
        key: request.key,
        error:
          error instanceof Error
            ? error.message
            : "Не удалось отобразить граф.",
      };
    }
    self.postMessage(response);
  });
};
