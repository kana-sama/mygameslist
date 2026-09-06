import {
  DeploymentStatusRequestError,
  createDeploymentStatusClient,
  type RateHints,
} from "../src/state/deploymentStatusClient";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const API = "https://api.github.com/repos/fixture-owner/fixture-repo";

function makeClient(fetchMock: typeof fetch, now = () => 0) {
  return createDeploymentStatusClient({
    owner: "fixture-owner",
    repo: "fixture-repo",
    pagesBaseUrl: new URL("https://example.test/library/"),
    fetch: fetchMock,
    now,
  });
}

function workflowRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: "Deploy GitHub Pages",
    path: ".github/workflows/deploy.yml",
    head_branch: "main",
    head_sha: SHA_A,
    event: "push",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    run_started_at: "2026-09-07T10:00:00Z",
    created_at: "2026-09-07T09:59:00Z",
    ...overrides,
  };
}

function runsResponse(runs: unknown[], init?: ResponseInit): Response {
  return new Response(JSON.stringify({ total_count: runs.length, workflow_runs: runs }), {
    status: 200,
    ...init,
  });
}

async function expectRequestError(
  promise: Promise<unknown>,
  kind: DeploymentStatusRequestError["kind"],
  limits?: Partial<RateHints>,
) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(DeploymentStatusRequestError);
  expect(error).toMatchObject({ kind, ...(limits === undefined ? {} : { limits }) });
  return error as DeploymentStatusRequestError;
}

describe("deployment status HTTP client", () => {
  it("revalidates a checked head SHA with an endpoint-specific ETag", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(SHA_A, { headers: { ETag: '"head-a"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = makeClient(fetchMock);
    const signal = new AbortController().signal;

    expect((await client.readHead(null, signal)).value).toBe(SHA_A);
    expect((await client.readHead(null, signal)).value).toBe(SHA_A);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/commits/main`);
    const first = fetchMock.mock.calls[0][1];
    const second = fetchMock.mock.calls[1][1];
    expect(first?.method).toBe("GET");
    expect(new Headers(first?.headers).get("Accept")).toBe("application/vnd.github.sha");
    expect(new Headers(first?.headers).get("Authorization")).toBeNull();
    expect(new Headers(second?.headers).get("If-None-Match")).toBe('"head-a"');
  });

  it("rejects malformed head values and a 304 without a validated cached body", async () => {
    const signal = new AbortController().signal;

    for (const body of ["not-a-sha", SHA_A.toUpperCase(), `${SHA_A}\n`]) {
      const malformed = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(body)));
      await expectRequestError(malformed.readHead(null, signal), "invalid-response");
    }

    const uncached = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304 })));
    await expectRequestError(uncached.readHead(null, signal), "invalid-response");
  });

  it("separates validators when the credential generation changes or is cleared", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(SHA_A, { headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response(SHA_A, { headers: { ETag: '"two"' } }))
      .mockResolvedValueOnce(new Response(SHA_A));
    const client = makeClient(fetchMock);
    const signal = new AbortController().signal;

    await client.readHead("first-secret", signal);
    await client.readHead("second-secret", signal);
    client.clearCredentialCache();
    await client.readHead("second-secret", signal);

    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer first-secret");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer second-secret");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("If-None-Match")).toBeNull();
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("If-None-Match")).toBeNull();
  });

  it("does not rotate the GitHub credential namespace when Pages is read between PAT requests", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(SHA_A, { headers: { ETag: '"pat-head"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sourceCommitSha: SHA_A })))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = makeClient(fetchMock);
    const signal = new AbortController().signal;

    await client.readHead("private-value", signal);
    await client.readPublishedVersion(signal);
    await client.readHead("private-value", signal);

    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("If-None-Match")).toBe('"pat-head"');
  });

  it("reads rate headers before returning or classifying an HTTP failure", async () => {
    const resetSeconds = 321;
    const limited = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 403,
      headers: {
        "X-Poll-Interval": "12",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
      },
    })));
    const throttled = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 429,
      headers: { "Retry-After": "7" },
    })), () => 1_000);
    const forbidden = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })));
    const signal = new AbortController().signal;

    await expectRequestError(limited.readHead(null, signal), "rate-limit", {
      minIntervalMs: 12_000,
      remaining: 0,
      notBefore: resetSeconds * 1_000,
    });
    await expectRequestError(throttled.readHead(null, signal), "rate-limit", { notBefore: 8_000 });
    await expectRequestError(forbidden.readHead(null, signal), "http");

    const unhinted429 = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 })), () => 2_000);
    await expectRequestError(unhinted429.readHead(null, signal), "rate-limit", { notBefore: 62_000 });
  });

  it("classifies authorization, server, malformed JSON, and network failures without response bodies or tokens", async () => {
    const signal = new AbortController().signal;
    const cases = [
      { response: new Response("secret body", { status: 401 }), kind: "unauthorized" },
      { response: new Response("secret body", { status: 503 }), kind: "http" },
      { response: new Response("{", { status: 200 }), kind: "invalid-response" },
    ] as const;

    for (const { response, kind } of cases) {
      const error = await expectRequestError(
        makeClient(vi.fn<typeof fetch>().mockResolvedValue(response)).readWorkflow(SHA_A, "token-value", signal),
        kind,
      );
      expect(error.message).not.toContain("secret body");
      expect(error.message).not.toContain("token-value");
    }

    const network = makeClient(vi.fn<typeof fetch>().mockRejectedValue(new Error("token-value escaped")));
    const error = await expectRequestError(network.readHead("token-value", signal), "network");
    expect(error.message).not.toContain("token-value");
  });

  it("uses an independent 15-second timeout and preserves an external abort", async () => {
    vi.useFakeTimers();
    try {
      const hangingFetch = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
      const client = makeClient(hangingFetch);
      const timeoutPromise = client.readHead(null, new AbortController().signal);
      const timeoutResult = expectRequestError(timeoutPromise, "timeout");
      await vi.advanceTimersByTimeAsync(15_000);
      await timeoutResult;

      const external = new AbortController();
      const abortPromise = client.readHead(null, external.signal);
      external.abort(new DOMException("Caller stopped", "AbortError"));
      await expect(abortPromise).rejects.toMatchObject({ name: "AbortError", message: "Caller stopped" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps timeout and caller-abort classification while reading a response body", async () => {
    vi.useFakeTimers();
    try {
      const bodyFetch = vi.fn<typeof fetch>(async (_input, init) => ({
        ok: true,
        status: 200,
        headers: new Headers({ "X-Poll-Interval": "11" }),
        text: () => new Promise<string>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("Body aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Body aborted", "AbortError")), { once: true });
        }),
      }) as Response);
      const client = makeClient(bodyFetch);

      const timeoutResult = expectRequestError(
        client.readHead(null, new AbortController().signal),
        "timeout",
        { minIntervalMs: 11_000 },
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await timeoutResult;

      const external = new AbortController();
      const abortPromise = client.readHead(null, external.signal);
      external.abort(new DOMException("Caller stopped body", "AbortError"));
      await expect(abortPromise).rejects.toMatchObject({ name: "AbortError", message: "Caller stopped body" });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["queued", null, "pending", "Деплой поставлен в очередь"],
    ["in_progress", null, "pending", "Деплой выполняется"],
    ["waiting", null, "pending", "Деплой ожидает продолжения"],
    ["pending", null, "pending", "Деплой ожидает запуска"],
    ["requested", null, "pending", "Деплой запрошен"],
    ["completed", "success", "success", undefined],
    ["completed", "failure", "failed", "Деплой завершился ошибкой"],
    ["completed", "cancelled", "failed", "Деплой отменён"],
    ["completed", "skipped", "failed", "Деплой пропущен"],
    ["completed", "action_required", "failed", "Деплой требует действия"],
    ["completed", "neutral", "failed", "Деплой завершён без публикации"],
    ["completed", "stale", "failed", "Деплой устарел"],
    ["completed", "timed_out", "failed", "Деплой превысил время ожидания"],
    ["completed", "startup_failure", "failed", "Деплой не удалось запустить"],
  ])("normalizes workflow status %s/%s", async (status, conclusion, kind, reason) => {
    const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(runsResponse([
      workflowRun({ status, conclusion }),
    ])));

    await expect(client.readWorkflow(SHA_A, null, new AbortController().signal)).resolves.toMatchObject({
      value: reason === undefined ? { kind } : { kind, reason },
    });
  });

  it("accepts a manual run and picks the newest started attempt over an older success", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(runsResponse([
      workflowRun({ id: 1, status: "completed", conclusion: "success", run_started_at: "2026-09-07T10:00:00Z" }),
      workflowRun({
        id: 1,
        event: "workflow_dispatch",
        status: "in_progress",
        conclusion: null,
        run_attempt: 2,
        run_started_at: "2026-09-07T10:05:00Z",
      }),
    ]));

    await expect(makeClient(fetchMock).readWorkflow(SHA_A, null, new AbortController().signal)).resolves.toMatchObject({
      value: { kind: "pending", reason: "Деплой выполняется" },
    });
  });

  it("returns absent for no runs and invalid for an untrusted run or unknown state", async () => {
    const signal = new AbortController().signal;
    const empty = makeClient(vi.fn<typeof fetch>().mockResolvedValue(runsResponse([])));
    await expect(empty.readWorkflow(SHA_A, null, signal)).resolves.toMatchObject({ value: { kind: "absent" } });

    for (const run of [
      workflowRun({ head_sha: SHA_B }),
      workflowRun({ head_branch: "feature" }),
      workflowRun({ path: ".github/workflows/other.yml" }),
      workflowRun({ name: "Build" }),
      workflowRun({ status: "mystery", conclusion: null }),
    ]) {
      const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(runsResponse([run])));
      await expect(client.readWorkflow(SHA_A, null, signal)).resolves.toMatchObject({ value: { kind: "invalid" } });
    }
  });

  it("follows trusted pagination and accumulates every page's rate hints before choosing the latest attempt", async () => {
    const page2 = `${API}/actions/workflows/deploy.yml/runs?branch=main&head_sha=${SHA_A}&per_page=30&page=2`;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(runsResponse([
        workflowRun({ status: "completed", conclusion: "success", run_started_at: "2026-09-07T10:00:00Z" }),
      ], {
        headers: {
          Link: `<${page2}>; rel="next"`,
          "X-Poll-Interval": "5",
          "X-RateLimit-Remaining": "49",
        },
      }))
      .mockResolvedValueOnce(runsResponse([
        workflowRun({ status: "in_progress", conclusion: null, run_attempt: 2, run_started_at: "2026-09-07T10:05:00Z" }),
      ], {
        headers: {
          "X-Poll-Interval": "8",
          "X-RateLimit-Remaining": "48",
        },
      }));

    const result = await makeClient(fetchMock).readWorkflow(SHA_A, null, new AbortController().signal);

    expect(result).toEqual({
      value: { kind: "pending", reason: "Деплой выполняется" },
      limits: { minIntervalMs: 8_000, notBefore: null, remaining: 48 },
    });
    expect(fetchMock.mock.calls[1][0]).toBe(page2);
  });

  it("stops pagination when accumulated headers prohibit the next request", async () => {
    const page2 = `${API}/actions/workflows/deploy.yml/runs?page=2`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(runsResponse([workflowRun()], {
      headers: {
        Link: `<${page2}>; rel="next"`,
        "Retry-After": "10",
        "X-RateLimit-Remaining": "2",
      },
    }));

    await expectRequestError(
      makeClient(fetchMock, () => 4_000).readWorkflow(SHA_A, null, new AbortController().signal),
      "rate-limit",
      { notBefore: 14_000, remaining: 2 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps earlier page hints when a later workflow page is rate limited", async () => {
    const page2 = `${API}/actions/workflows/deploy.yml/runs?page=2`;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(runsResponse([workflowRun()], {
        headers: {
          Link: `<${page2}>; rel="next"`,
          "X-Poll-Interval": "9",
          "X-RateLimit-Remaining": "5",
        },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { "Retry-After": "7", "X-RateLimit-Remaining": "4" },
      }));

    await expectRequestError(
      makeClient(fetchMock, () => 1_000).readWorkflow(SHA_A, null, new AbortController().signal),
      "rate-limit",
      { minIntervalMs: 9_000, notBefore: 8_000, remaining: 4 },
    );
  });

  it("rejects an untrusted next link and an incomplete workflow listing", async () => {
    const signal = new AbortController().signal;
    const hostile = makeClient(vi.fn<typeof fetch>().mockResolvedValue(runsResponse([workflowRun()], {
      headers: { Link: '<https://evil.test/runs?page=2>; rel="next"' },
    })));
    await expectRequestError(hostile.readWorkflow(SHA_A, "never-leak", signal), "invalid-response");

    const incomplete = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      total_count: 31,
      workflow_runs: [workflowRun()],
    }))));
    await expectRequestError(incomplete.readWorkflow(SHA_A, null, signal), "invalid-response");
  });

  it("classifies a malformed pagination URL as an invalid response with its rate hints", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(runsResponse([workflowRun()], {
      headers: {
        Link: '<not a url>; rel="next"',
        "X-Poll-Interval": "13",
        "X-RateLimit-Remaining": "7",
      },
    }));

    await expectRequestError(
      makeClient(fetchMock).readWorkflow(SHA_A, null, new AbortController().signal),
      "invalid-response",
      { minIntervalMs: 13_000, remaining: 7 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads Pages version metadata from the application base without credentials or browser cache", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ sourceCommitSha: SHA_A })));
    const result = await makeClient(fetchMock).readPublishedVersion(new AbortController().signal);

    expect(result.value).toBe(SHA_A);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/library/version.json");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBeNull();
  });

  it("rejects malformed or development-only Pages version metadata", async () => {
    const signal = new AbortController().signal;
    for (const body of [{ sourceCommitSha: null }, { sourceCommitSha: SHA_A, extra: true }, { sourceCommitSha: "bad" }]) {
      const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body))));
      await expectRequestError(client.readPublishedVersion(signal), "invalid-response");
    }
  });

  it.each([
    {
      name: "all changed and prior rename paths are within docs",
      payload: {
        status: "ahead",
        files: [
          { filename: "docs/a.md", status: "modified" },
          { filename: "docs/new.md", previous_filename: "docs/old.md", status: "renamed" },
        ],
      },
      expected: true,
    },
    {
      name: "a current path is outside docs",
      payload: { status: "ahead", files: [{ filename: "src/app.ts", status: "modified" }] },
      expected: false,
    },
    {
      name: "a renamed prior path is outside docs",
      payload: {
        status: "ahead",
        files: [{ filename: "docs/app.ts", previous_filename: "src/app.ts", status: "renamed" }],
      },
      expected: false,
    },
    { name: "history is not ahead", payload: { status: "behind", files: [{ filename: "docs/a.md", status: "modified" }] }, expected: null },
    { name: "the changed file list is empty", payload: { status: "ahead", files: [] }, expected: null },
    { name: "the changed file list is absent", payload: { status: "ahead" }, expected: null },
    {
      name: "the changed file list hits GitHub's truncation boundary",
      payload: { status: "ahead", files: Array.from({ length: 300 }, (_, index) => ({ filename: `docs/${index}.md`, status: "added" })) },
      expected: null,
    },
    {
      name: "a rename lacks its prior path",
      payload: { status: "ahead", files: [{ filename: "docs/new.md", status: "renamed" }] },
      expected: null,
    },
    {
      name: "a changed path is not a safe relative repository path",
      payload: { status: "ahead", files: [{ filename: "docs/../src/app.ts", status: "modified" }] },
      expected: null,
    },
  ])("returns strict compare evidence when $name", async ({ payload, expected }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
    const result = await makeClient(fetchMock).readDocsOnly(SHA_A, SHA_B, "token", new AbortController().signal);

    expect(result.value).toBe(expected);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/compare/${SHA_A}...${SHA_B}`);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Accept")).toBe("application/vnd.github+json");
  });
  it("reports physical response headers before body completion while preserving caller abort identity", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Caller ended fixture", "AbortError");
    let enteredBody!: () => void;
    const bodyStarted = new Promise<void>((resolve) => { enteredBody = resolve; });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const response = new Response(null, { headers: { "X-Poll-Interval": "90", "Retry-After": "120" } });
      response.text = () => {
        enteredBody();
        return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
      };
      return response;
    });
    const client = makeClient(fetchMock);
    const onRateHints = vi.fn();
    const result = client.readHead("fixture-pat", controller.signal, onRateHints).catch((error: unknown) => error);
    await bodyStarted;
    try {
      expect(onRateHints).toHaveBeenCalledExactlyOnceWith({ minIntervalMs: 90_000, notBefore: 120_000, remaining: null });
    } finally {
      controller.abort(reason);
      expect(await result).toBe(reason);
    }
  });

});
