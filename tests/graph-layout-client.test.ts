import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphLayoutClient } from "../src/components/graph/layoutClient";
import { parseGraph } from "../src/domain/graph";
const graph = parseGraph("digraph { a; }");
const geometry = { width: 300, height: 52, nodes: [], groups: [], edges: [] };
function worker() {
  return {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}
afterEach(() => vi.useRealTimers());
describe("layout worker ownership", () => {
  it("rejects superseded results and only resolves the latest request", async () => {
    const w = worker();
    const client = new GraphLayoutClient(() => w as unknown as Worker);
    const first = client.layout(graph, 300);
    const rejected = expect(first).rejects.toThrow("superseded");
    const second = client.layout(graph, 400);
    const [a, b] = w.postMessage.mock.calls.map((call) => call[0]);
    w.onmessage!({ data: { id: a.id, key: a.key, geometry } } as MessageEvent);
    w.onmessage!({ data: { id: b.id, key: b.key, geometry } } as MessageEvent);
    await rejected;
    expect(await second).toEqual(geometry);
    client.dispose();
    expect(w.terminate).toHaveBeenCalled();
  });
  it("times out, terminates the stalled engine, and can retry with a new worker", async () => {
    vi.useFakeTimers();
    const workers = [worker(), worker()];
    let i = 0;
    const client = new GraphLayoutClient(
      () => workers[i++] as unknown as Worker,
    );
    const pending = client.layout(graph, 310);
    const rejected = expect(pending).rejects.toThrow("5 секунд");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(workers[0].terminate).toHaveBeenCalled();
    const retry = client.layout(graph, 310);
    const request = workers[1].postMessage.mock.calls[0][0];
    workers[1].onmessage!({
      data: { id: request.id, key: request.key, geometry },
    } as MessageEvent);
    expect(await retry).toEqual(geometry);
    client.dispose();
  });
  it("reports factory errors and worker load errors without a hanging promise", async () => {
    const failed = new GraphLayoutClient(() => {
      throw new Error("load failed");
    });
    await expect(failed.layout(graph, 311)).rejects.toThrow("load failed");
    failed.dispose();
    const w = worker();
    const client = new GraphLayoutClient(() => w as unknown as Worker);
    const pending = client.layout(graph, 312);
    w.onerror!();
    await expect(pending).rejects.toThrow("загрузить");
    client.dispose();
  });
  it("shares successful cached geometry across clients and ignores state-only changes", async () => {
    const w = worker();
    const first = new GraphLayoutClient(() => w as unknown as Worker);
    const pending = first.layout(graph, 313);
    const request = w.postMessage.mock.calls[0][0];
    w.onmessage!({
      data: { id: request.id, key: request.key, geometry },
    } as MessageEvent);
    await pending;
    first.dispose();
    const factory = vi.fn();
    const second = new GraphLayoutClient(factory);
    expect(
      await second.layout(parseGraph("digraph { a[state=done]; }"), 313),
    ).toEqual(geometry);
    expect(factory).not.toHaveBeenCalled();
    second.dispose();
  });
});
