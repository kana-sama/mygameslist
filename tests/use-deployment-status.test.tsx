// @vitest-environment-options { "url": "https://fixture.example.test/library/" }
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const A = "a".repeat(40), B = "b".repeat(40);
const input = { ready: true, dataCommitSha: A, token: null };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function meta(sha = A) { document.head.innerHTML = `<meta name="mygameslist-deployment-commit" content="${sha}">`; }
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(0); vi.stubEnv("DEV", false);
  fetchMock = vi.fn<typeof fetch>(async () => new Response(A)); vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  meta();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); document.head.innerHTML = ""; });

it("survives StrictMode replay with one initial poll and retains document SHA across data/route updates", async () => {
  const { useDeploymentStatus } = await import("../src/state/useDeploymentStatus");
  const { result, rerender } = renderHook(useDeploymentStatus, { initialProps: input, wrapper: StrictMode });
  await flush();
  expect(result.current.state).toBe("current"); expect(fetchMock).toHaveBeenCalledTimes(1);
  meta(B); rerender({ ...input, dataCommitSha: B }); await flush();
  expect(result.current).toMatchObject({ documentCommitSha: A, dataCommitSha: B });
  expect(result.current.state).not.toBe("current"); expect(fetchMock).toHaveBeenCalledTimes(1);
  await flush(300_000); expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/commits/main"))).toHaveLength(2);
});

it("keeps the same document metadata even across a component remount", async () => {
  const { useDeploymentStatus } = await import("../src/state/useDeploymentStatus");
  const first = renderHook(() => useDeploymentStatus(input)); await flush(); first.unmount();
  meta(B);
  const second = renderHook(() => useDeploymentStatus(input)); await flush();
  expect(second.result.current.documentCommitSha).toBe(A);
});

it.each([0, 2])("rejects %i production meta elements", async (count) => {
  document.head.innerHTML = Array.from({ length: count }, () => `<meta name="mygameslist-deployment-commit" content="${A}">`).join("");
  const { useDeploymentStatus } = await import("../src/state/useDeploymentStatus");
  const { result } = renderHook(() => useDeploymentStatus(input)); await flush(900_000);
  expect(result.current.state).toBe("unknown-version"); expect(fetchMock).not.toHaveBeenCalled();
});

it("does not poll a development runtime even with valid metadata", async () => {
  vi.stubEnv("DEV", true);
  const { useDeploymentStatus } = await import("../src/state/useDeploymentStatus");
  const { result } = renderHook(() => useDeploymentStatus(input)); await flush(900_000);
  expect(result.current.state).toBe("development"); expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["localhost", "127.0.0.1", "[::1]", "demo.localhost"])("does not poll loopback host %s", async (hostname) => {
  vi.stubGlobal("location", { hostname });
  const { useDeploymentStatus } = await import("../src/state/useDeploymentStatus");
  const { result } = renderHook(() => useDeploymentStatus(input)); await flush(900_000);
  expect(result.current.state).toBe("development"); expect(fetchMock).not.toHaveBeenCalled();
});

it("pauses for visibility/network changes and removes subscriptions and requests on unmount", async () => {
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const removeWindow = vi.spyOn(window, "removeEventListener");
  const { useDeploymentStatus } = await import("../src/state/useDeploymentStatus");
  const { result, unmount } = renderHook(() => useDeploymentStatus(input)); await flush();
  act(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await flush(300_001); expect(fetchMock).toHaveBeenCalledTimes(1);
  act(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current.state).toBe("checking"); await flush(); expect(fetchMock).toHaveBeenCalledTimes(2);
  act(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); });
  expect(result.current.state).toBe("error"); await flush(300_001); expect(fetchMock).toHaveBeenCalledTimes(2);
  act(() => { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); });
  await flush(); expect(fetchMock).toHaveBeenCalledTimes(3);
  unmount(); await flush(900_000); expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(removeDocument.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
  expect(removeWindow.mock.calls.some(([type]) => type === "online")).toBe(true);
  expect(removeWindow.mock.calls.some(([type]) => type === "offline")).toBe(true);
});
