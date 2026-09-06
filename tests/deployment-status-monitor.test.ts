import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeploymentStatusClient } from "../src/state/deploymentStatusClient";
import { createDeploymentStatusMonitor, type DeploymentMonitorInput, type DeploymentStatusMonitor } from "../src/state/deploymentStatusMonitor";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const base: DeploymentMonitorInput = { ready: true, dataCommitSha: A, token: null, visible: true, online: true };
const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { headers });
const version = (sha = A) => json({ sourceCommitSha: sha });
function workflow(sha = B, status = "in_progress", conclusion: string | null = null, headers?: HeadersInit) {
  return json({ total_count: 1, workflow_runs: [{ id: 1, name: "Deploy GitHub Pages", path: ".github/workflows/deploy.yml", head_branch: "main", head_sha: sha, event: "push", run_started_at: "2026-01-01T00:00:00Z", run_attempt: 1, status, conclusion }] }, headers);
}
const absent = () => json({ total_count: 0, workflow_runs: [] });
const siteChanges = () => json({ status: "ahead", files: [{ filename: "src/fixture.ts", status: "modified" }] });
let monitors: DeploymentStatusMonitor[] = [];
function setup(fetchMock = vi.fn<typeof fetch>(async () => new Response(A)), input = base, documentCommitSha: string | null = A, development = false) {
  const client = createDeploymentStatusClient({ owner: "fixture-owner", repo: "fixture-repo", pagesBaseUrl: new URL("https://example.test/"), fetch: fetchMock, now: Date.now });
  const monitor = createDeploymentStatusMonitor({ development, documentCommitSha, client, now: Date.now });
  monitors.push(monitor);
  monitor.update(input);
  return { monitor, fetchMock };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { monitors.forEach((m) => m.dispose()); monitors = []; vi.useRealTimers(); });

describe("deployment monitor", () => {
  it.each([[null, 300_000], ["fixture-pat", 30_000]] as const)("polls current pages on the %s schedule", async (token, interval) => {
    const { monitor, fetchMock } = setup(undefined, { ...base, token });
    await flush();
    expect(monitor.getSnapshot()).toMatchObject({ state: "current", lastCheckedAt: 0 });
    expect(monitor.getSnapshot()).toBe(monitor.getSnapshot());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(interval - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls confirmed yellow with a PAT every 15 seconds and keeps its state during a repeat", async () => {
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(B)).mockResolvedValueOnce(workflow()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(workflow());
    const { monitor } = setup(fetchMock, { ...base, token: "fixture-pat" });
    await flush();
    expect(monitor.getSnapshot().state).toBe("building");
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(monitor.getSnapshot().state).toBe("building");
    finish(new Response(B)); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    [{ ...base, ready: false }, A, false, "checking"],
    [base, null, false, "unknown-version"],
    [{ ...base, dataCommitSha: null }, A, false, "unknown-version"],
    [base, A, true, "development"],
    [{ ...base, visible: false }, A, false, "checking"],
    [{ ...base, online: false }, A, false, "error"],
  ] as const)("does not poll ineligible input %#", async (input, documentSha, development, state) => {
    const { monitor, fetchMock } = setup(undefined, input, documentSha, development);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(monitor.getSnapshot().state).toBe(state);
  });

  it("resumes a fresh observation at its deadline and marks a stale one checking", async () => {
    const { monitor, fetchMock } = setup(); await flush();
    monitor.update({ ...base, visible: false });
    await vi.advanceTimersByTimeAsync(100_000);
    monitor.update(base);
    expect(monitor.getSnapshot().state).toBe("current"); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    monitor.update({ ...base, visible: false });
    await vi.advanceTimersByTimeAsync(300_001);
    monitor.update(base);
    expect(monitor.getSnapshot().state).toBe("checking"); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(monitor.getSnapshot().state).toBe("current");
  });

  it("updates the installed data version without replacing the document SHA or forcing a GET", async () => {
    const { monitor, fetchMock } = setup(); await flush();
    monitor.update({ ...base, dataCommitSha: B });
    await flush();
    expect(monitor.getSnapshot()).toMatchObject({ documentCommitSha: A, dataCommitSha: B });
    expect(monitor.getSnapshot().state).not.toBe("current");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not overlap requests and aborts on disposal", async () => {
    let signal!: AbortSignal;
    const fetchMock = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => { signal = init!.signal!; signal.addEventListener("abort", () => reject(signal.reason)); }));
    const { monitor } = setup(fetchMock, { ...base, token: "fixture-pat" }); await flush();
    monitor.update({ ...base, token: "fixture-pat" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    monitor.dispose(); expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a PAT in memory and waits 300 seconds before anonymous reads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValue(new Response(A));
    const { monitor } = setup(fetchMock, { ...base, token: "rejected-fixture" }); await flush();
    expect(monitor.getSnapshot().state).toBe("error");
    monitor.update({ ...base, token: "rejected-fixture" });
    await vi.advanceTimersByTimeAsync(299_999); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1][1]!.headers).has("Authorization")).toBe(false);
    expect(monitor.getSnapshot().state).toBe("current");
  });

  it("ignores an old PAT response and does not start its workflow after replacement", async () => {
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(new Response(A));
    const { monitor } = setup(fetchMock, { ...base, token: "old-fixture" }); await flush();
    const oldSignal = fetchMock.mock.calls[0][1]!.signal!;
    monitor.update({ ...base, token: "new-fixture" }); expect(oldSignal.aborted).toBe(true);
    finish(new Response(B)); await flush();
    expect(monitor.getSnapshot().headCommitSha).not.toBe(B);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitor.getSnapshot().state).toBe("current");
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/runs"))).toBe(true);
    expect(new Headers(fetchMock.mock.calls.at(-1)![1]!.headers).get("Authorization")).toBe("Bearer new-fixture");
  });

  it.each([
    [200, { "X-Poll-Interval": "90" }, 90_000],
    [200, { "Retry-After": "120" }, 120_000],
    [200, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "180" }, 180_000],
    [503, { "Retry-After": "1200" }, 1_200_000],
    [429, {}, 60_000],
  ])("respects success/error server hints %#", async (status, headers, delay) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(status === 200 ? A : null, { status: status as number, headers: headers as HeadersInit })).mockResolvedValue(new Response(A));
    setup(fetchMock, { ...base, token: "fixture-pat" }); await flush();
    await vi.advanceTimersByTimeAsync((delay as number) - 1); expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops a chain when the head response exhausts its API budget", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(B, { headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "120" } }));
    const { monitor } = setup(fetchMock, { ...base, token: "fixture-pat" }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(monitor.getSnapshot()).toMatchObject({ state: "error", lastCheckedAt: null });
  });

  it("retains the workflow endpoint minimum when main changes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(B)).mockResolvedValueOnce(workflow(B, "in_progress", null, { "X-Poll-Interval": "90" })).mockResolvedValueOnce(new Response(C)).mockResolvedValueOnce(workflow(C)).mockResolvedValue(new Response(C));
    const { monitor } = setup(fetchMock, { ...base, token: "fixture-pat" }); await flush();
    await vi.advanceTimersByTimeAsync(90_000); expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(monitor.getSnapshot().headCommitSha).toBe(C);
    await vi.advanceTimersByTimeAsync(89_999); expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("backs off failures to fifteen minutes and resets after success", async () => {
    let failing = true;
    const fetchMock = vi.fn<typeof fetch>(async () => { if (failing) throw new TypeError("fixture failure"); return new Response(A); });
    const { monitor } = setup(fetchMock, { ...base, token: "fixture-pat" }); await flush();
    let count = 1;
    for (const delay of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1); expect(fetchMock).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(++count);
    }
    failing = false;
    await vi.advanceTimersByTimeAsync(900_000); expect(monitor.getSnapshot().state).toBe("current");
    await vi.advanceTimersByTimeAsync(29_999); expect(fetchMock).toHaveBeenCalledTimes(++count);
    await vi.advanceTimersByTimeAsync(1); expect(fetchMock).toHaveBeenCalledTimes(++count);
  });

  it("expires missing-run grace locally and compares each SHA pair only once", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/commits/")) return new Response(B);
      if (String(url).includes("/runs?")) return absent();
      if (String(url).includes("/compare/")) return siteChanges();
      return version();
    });
    const { monitor } = setup(fetchMock); await flush();
    expect(monitor.getSnapshot().state).toBe("waiting-run"); expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(monitor.getSnapshot().state).toBe("unconfirmed"); expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(monitor.getSnapshot().state).toBe("unconfirmed"); expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("keeps the first publication deadline through repeated responses and resets it for a new head", async () => {
    let head = B;
    const fetchMock = vi.fn<typeof fetch>(async (url) => String(url).includes("/commits/") ? new Response(head) : String(url).includes("/runs?") ? workflow(head, "completed", "success") : version());
    const { monitor } = setup(fetchMock); await flush();
    expect(monitor.getSnapshot().state).toBe("propagating");
    await vi.advanceTimersByTimeAsync(300_000);
    monitor.update({ ...base, visible: false });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(monitor.getSnapshot().state).toBe("unconfirmed"); expect(fetchMock).toHaveBeenCalledTimes(6);
    head = C; monitor.update(base); await flush();
    expect(monitor.getSnapshot()).toMatchObject({ state: "propagating", headCommitSha: C });
  });

  it("preserves the last successful check on failure and never exposes server content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(A)).mockResolvedValue(new Response("secret-server-fixture", { status: 503 }));
    const { monitor } = setup(fetchMock, { ...base, token: "secret-pat-fixture" }); await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitor.getSnapshot()).toMatchObject({ state: "error", lastCheckedAt: 0 });
    expect(JSON.stringify(monitor.getSnapshot())).not.toMatch(/secret-/);
  });
  it("does not cache a Compare attempt that a server deadline prevented from starting", async () => {
    let pages = 0;
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/commits/")) return new Response(B);
      if (String(url).includes("/runs?")) return absent();
      if (String(url).includes("/compare/")) return json({ status: "ahead", files: [{ filename: "docs/fixture.md", status: "modified" }] });
      return json({ sourceCommitSha: A }, ++pages === 1 ? { "Retry-After": "60" } : undefined);
    });
    const { monitor } = setup(fetchMock); await flush();
    expect(monitor.getSnapshot().state).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(monitor.getSnapshot().state).toBe("docs-only");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/compare/"))).toHaveLength(1);
  });

  it("preserves a partial cycle's workflow minimum after PAT replacement and discards its late Pages result", async () => {
    let heads = 0;
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/commits/")) return new Response(++heads === 1 ? A : B);
      if (String(url).includes("/runs?")) return workflow(B, "completed", "success", { "X-Poll-Interval": "90" });
      return new Promise((resolve) => { finish = resolve; });
    });
    const { monitor } = setup(fetchMock, { ...base, token: "old-fixture" }); await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    monitor.update({ ...base, token: "new-fixture" });
    finish(version(B)); await flush();
    expect(monitor.getSnapshot().state).toBe("current");
    await vi.advanceTimersByTimeAsync(89_999);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    finish(version(B)); await flush();
    expect(monitor.getSnapshot().state).toBe("update-available");
  });

  it("retains a physical workflow page's minimum when PAT replacement aborts later pagination", async () => {
    let finish!: (r: Response) => void;
    let workflowReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/commits/")) return new Response(B);
      if (String(url).includes("page=2")) return new Promise((resolve) => { finish = resolve; });
      if (++workflowReads === 1) {
        const run = (await workflow().json()).workflow_runs[0];
        return json({ total_count: 2, workflow_runs: [run] }, {
          "X-Poll-Interval": "90",
          Link: '<https://api.github.com/repos/fixture-owner/fixture-repo/actions/workflows/deploy.yml/runs?page=2>; rel="next"',
        });
      }
      return workflow();
    });
    const { monitor } = setup(fetchMock, { ...base, token: "old-fixture" }); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const pageSignal = fetchMock.mock.calls[2][1]!.signal!;
    monitor.update({ ...base, token: "new-fixture" });
    expect(pageSignal.aborted).toBe(true);
    finish(json({ total_count: 2, workflow_runs: [(await workflow().json()).workflow_runs[0]] }));
    await flush();
    expect(monitor.getSnapshot().state).toBe("checking");
    await vi.advanceTimersByTimeAsync(89_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(monitor.getSnapshot().state).toBe("building");
    expect(new Headers(fetchMock.mock.calls[3][1]!.headers).get("Authorization")).toBe("Bearer new-fixture");
  });

});
