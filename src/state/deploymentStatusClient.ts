import { REQUEST_TIMEOUT_MS, type WorkflowObservation } from "./deploymentStatusModel";
import { isDeploymentCommitSha, parseDeploymentVersion } from "../shared/deploymentVersion";

export interface RateHints {
  minIntervalMs: number;
  notBefore: number | null;
  remaining: number | null;
}

// Delivered for each physical response before its body is read. These limits
// remain authoritative even when cancellation discards the observation value.
export type RateHintsObserver = (limits: RateHints) => void;

export interface StatusRead<T> {
  value: T;
  limits: RateHints;
}

export type StatusRequestFailure =
  | "unauthorized"
  | "rate-limit"
  | "network"
  | "timeout"
  | "http"
  | "invalid-response";

export class DeploymentStatusRequestError extends Error {
  kind: StatusRequestFailure;
  limits: RateHints;

  constructor(kind: StatusRequestFailure, message: string, limits: RateHints) {
    super(message);
    this.name = "DeploymentStatusRequestError";
    this.kind = kind;
    this.limits = limits;
  }
}

export interface DeploymentStatusClient {
  readHead(token: string | null, signal: AbortSignal, onRateHints?: RateHintsObserver): Promise<StatusRead<string>>;
  readWorkflow(
    sha: string,
    token: string | null,
    signal: AbortSignal,
    onRateHints?: RateHintsObserver,
  ): Promise<StatusRead<WorkflowObservation>>;
  readPublishedVersion(signal: AbortSignal, onRateHints?: RateHintsObserver): Promise<StatusRead<string>>;
  readDocsOnly(
    base: string,
    head: string,
    token: string | null,
    signal: AbortSignal,
    onRateHints?: RateHintsObserver,
  ): Promise<StatusRead<boolean | null>>;
  clearCredentialCache(): void;
}

interface RequestCacheEntry<T> {
  etag: string;
  value: T;
}

interface WorkflowPage {
  totalCount: number;
  runs: WorkflowRun[];
  nextUrl: string | null;
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  runAttempt: number;
  startedAt: number;
}

interface RequestOptions<T> {
  url: string;
  accept: string;
  token: string | null;
  credentialGeneration: number;
  signal: AbortSignal;
  cacheMode?: RequestCache;
  onRateHints?: RateHintsObserver;
  parse(response: Response): Promise<T>;
}

const EMPTY_LIMITS: RateHints = {
  minIntervalMs: 0,
  notBefore: null,
  remaining: null,
};

const GITHUB_ORIGIN = "https://api.github.com";
const JSON_ACCEPT = "application/vnd.github+json";

export function createDeploymentStatusClient(options: {
  owner: string;
  repo: string;
  pagesBaseUrl: URL;
  fetch: typeof fetch;
  now: () => number;
}): DeploymentStatusClient {
  const repositoryPath = `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
  const headPath = `${repositoryPath}/commits/main`;
  const runsPath = `${repositoryPath}/actions/workflows/deploy.yml/runs`;
  const pagesVersionUrl = new URL("version.json", options.pagesBaseUrl).toString();
  const requestCache = new Map<string, RequestCacheEntry<unknown>>();
  let credentialGeneration = 0;
  let currentCredential: string | null | undefined;

  function generationFor(token: string | null): number {
    if (currentCredential !== token) {
      currentCredential = token;
      credentialGeneration += 1;
    }
    return credentialGeneration;
  }

  function requestError(
    kind: StatusRequestFailure,
    message: string,
    limits: RateHints = EMPTY_LIMITS,
  ): DeploymentStatusRequestError {
    return new DeploymentStatusRequestError(kind, message, { ...limits });
  }

  async function request<T>({
    url,
    accept,
    token,
    credentialGeneration: requestGeneration,
    signal,
    cacheMode,
    parse,
    onRateHints,
  }: RequestOptions<T>): Promise<StatusRead<T>> {
    signal.throwIfAborted();

    const cacheKey = `${requestGeneration}\n${accept}\n${url}`;
    const cached = requestCache.get(cacheKey) as RequestCacheEntry<T> | undefined;
    const headers = new Headers({ Accept: accept });
    if (token !== null) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (cached !== undefined) {
      headers.set("If-None-Match", cached.etag);
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await options.fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
        ...(cacheMode === undefined ? {} : { cache: cacheMode }),
      });
      const limits = readRateHints(response.headers, options.now());
      onRateHints?.(limits);

      if (response.status === 401) {
        throw requestError("unauthorized", "Токен GitHub отклонён", limits);
      }

      if (isRateLimited(response.status, response.headers, limits)) {
        const restricted = limits.notBefore === null
          ? { ...limits, notBefore: options.now() + 60_000 }
          : limits;
        throw requestError("rate-limit", "Лимит запросов GitHub исчерпан", restricted);
      }

      if (response.status === 304) {
        if (cached === undefined) {
          throw requestError("invalid-response", "Получен неполный кешированный ответ", limits);
        }
        const nextEtag = response.headers.get("ETag");
        if (nextEtag !== null) {
          requestCache.set(cacheKey, { etag: nextEtag, value: cached.value });
        }
        return { value: cached.value, limits };
      }

      if (!response.ok) {
        throw requestError("http", "Сервис проверки версии недоступен", limits);
      }

      let value: T;
      try {
        value = await parse(response);
      } catch (error) {
        if (error instanceof DeploymentStatusRequestError) {
          throw error;
        }
        if (signal.aborted) {
          throw signal.reason;
        }
        if (timedOut) {
          throw requestError("timeout", "Превышено время ожидания ответа", limits);
        }
        if (error instanceof TypeError || error instanceof DOMException) {
          throw requestError("network", "Нет подключения к сети", limits);
        }
        throw requestError("invalid-response", "Получен некорректный ответ сервиса", limits);
      }

      const etag = response.headers.get("ETag");
      if (etag !== null) {
        requestCache.set(cacheKey, { etag, value });
      }
      return { value, limits };
    } catch (error) {
      if (error instanceof DeploymentStatusRequestError) {
        throw error;
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      if (timedOut) {
        throw requestError("timeout", "Превышено время ожидания ответа");
      }
      throw requestError("network", "Нет подключения к сети");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
    }
  }

  function githubRequest<T>(
    url: string,
    token: string | null,
    signal: AbortSignal,
    accept: string,
    parse: (response: Response) => Promise<T>,
    onRateHints?: RateHintsObserver,
  ): Promise<StatusRead<T>> {
    return request({
      url,
      token,
      credentialGeneration: generationFor(token),
      signal,
      accept,
      parse,
      onRateHints,
    });
  }

  return {
    async readHead(token, signal, onRateHints) {
      return githubRequest(
        `${GITHUB_ORIGIN}${headPath}`,
        token,
        signal,
        "application/vnd.github.sha",
        async (response) => {
          const sha = await response.text();
          if (!isDeploymentCommitSha(sha)) {
            throw new Error("invalid SHA");
          }
          return sha;
        },
        onRateHints,
      );
    },

    async readWorkflow(sha, token, signal, onRateHints) {
      if (!isDeploymentCommitSha(sha)) {
        throw requestError("invalid-response", "Некорректный SHA целевого деплоя");
      }

      const initialUrl = `${GITHUB_ORIGIN}${runsPath}?branch=main&head_sha=${encodeURIComponent(sha)}&per_page=30`;
      let nextUrl: string | null = initialUrl;
      let limits = { ...EMPTY_LIMITS };
      let expectedTotal: number | null = null;
      const runs: WorkflowRun[] = [];
      const visited = new Set<string>();

      while (nextUrl !== null) {
        if (limits.notBefore !== null && limits.notBefore > options.now()) {
          throw requestError("rate-limit", "Лимит запросов GitHub исчерпан", limits);
        }
        if (visited.has(nextUrl)) {
          throw requestError("invalid-response", "Получена циклическая пагинация GitHub", limits);
        }
        visited.add(nextUrl);

        let pageRead: StatusRead<WorkflowPage>;
        try {
          pageRead = await githubRequest(
            nextUrl,
            token,
            signal,
            JSON_ACCEPT,
            (response) => parseWorkflowPage(response, sha, runsPath),
            onRateHints,
          );
        } catch (error) {
          if (error instanceof DeploymentStatusRequestError) {
            throw requestError(error.kind, error.message, mergeRateHints(limits, error.limits));
          }
          throw error;
        }
        limits = mergeRateHints(limits, pageRead.limits);
        if (expectedTotal === null) {
          expectedTotal = pageRead.value.totalCount;
        } else if (pageRead.value.totalCount !== expectedTotal) {
          throw requestError("invalid-response", "GitHub изменил список запусков во время чтения", limits);
        }
        runs.push(...pageRead.value.runs);
        nextUrl = pageRead.value.nextUrl;
      }

      if (expectedTotal === null || runs.length < expectedTotal) {
        throw requestError("invalid-response", "GitHub вернул неполный список запусков", limits);
      }

      return { value: observeWorkflowRuns(runs), limits };
    },

    async readPublishedVersion(signal, onRateHints) {
      return request({
        url: pagesVersionUrl,
        accept: "application/json",
        token: null,
        credentialGeneration: 0,
        signal,
        cacheMode: "no-store",
        onRateHints,
        async parse(response) {
          const parsed = parseDeploymentVersion(await response.json());
          if (!isDeploymentCommitSha(parsed.sourceCommitSha)) {
            throw new Error("missing deployment SHA");
          }
          return parsed.sourceCommitSha;
        },
      });
    },

    async readDocsOnly(base, head, token, signal, onRateHints) {
      if (!isDeploymentCommitSha(base) || !isDeploymentCommitSha(head)) {
        throw requestError("invalid-response", "Некорректная пара SHA для сравнения");
      }
      return githubRequest(
        `${GITHUB_ORIGIN}${repositoryPath}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
        token,
        signal,
        JSON_ACCEPT,
        async (response) => classifyCompare(await response.json()),
        onRateHints,
      );
    },

    clearCredentialCache() {
      requestCache.clear();
      currentCredential = undefined;
      credentialGeneration += 1;
    },
  };
}

function readRateHints(headers: Headers, now: number): RateHints {
  const pollSeconds = parseNonNegativeInteger(headers.get("X-Poll-Interval"));
  const remaining = parseNonNegativeInteger(headers.get("X-RateLimit-Remaining"));
  const resetSeconds = parseNonNegativeInteger(headers.get("X-RateLimit-Reset"));
  const retryDeadline = parseRetryAfter(headers.get("Retry-After"), now);
  const resetDeadline = remaining === 0 && resetSeconds !== null ? resetSeconds * 1_000 : null;

  return {
    minIntervalMs: pollSeconds === null ? 0 : pollSeconds * 1_000,
    notBefore: maxNullable(retryDeadline, resetDeadline),
    remaining,
  };
}

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) {
    return null;
  }
  const seconds = parseNonNegativeInteger(value);
  if (seconds !== null) {
    return now + seconds * 1_000;
  }
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(now, deadline) : null;
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function isRateLimited(status: number, headers: Headers, limits: RateHints): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return limits.remaining === 0 || parseRetryAfter(headers.get("Retry-After"), 0) !== null;
}

function mergeRateHints(accumulated: RateHints, next: RateHints): RateHints {
  return {
    minIntervalMs: Math.max(accumulated.minIntervalMs, next.minIntervalMs),
    notBefore: maxNullable(accumulated.notBefore, next.notBefore),
    remaining: next.remaining ?? accumulated.remaining,
  };
}

async function parseWorkflowPage(
  response: Response,
  targetSha: string,
  expectedPath: string,
): Promise<WorkflowPage> {
  const value = await response.json() as unknown;
  if (!isRecord(value)
    || !Number.isSafeInteger(value.total_count)
    || (value.total_count as number) < 0
    || !Array.isArray(value.workflow_runs)) {
    throw new Error("invalid workflow listing");
  }

  const runs = value.workflow_runs.map((run) => parseWorkflowRun(run, targetSha));
  return {
    totalCount: value.total_count as number,
    runs,
    nextUrl: parseTrustedNextLink(response.headers.get("Link"), expectedPath),
  };
}

function parseWorkflowRun(value: unknown, targetSha: string): WorkflowRun {
  if (!isRecord(value)) {
    return invalidWorkflowRun();
  }
  const startedAt = typeof value.run_started_at === "string" ? Date.parse(value.run_started_at) : Number.NaN;
  const eventIsValid = value.event === "push" || value.event === "workflow_dispatch";
  if (value.name !== "Deploy GitHub Pages"
    || value.path !== ".github/workflows/deploy.yml"
    || value.head_branch !== "main"
    || value.head_sha !== targetSha
    || !eventIsValid
    || !Number.isSafeInteger(value.id)
    || !Number.isSafeInteger(value.run_attempt)
    || (value.run_attempt as number) < 1
    || typeof value.status !== "string"
    || (value.conclusion !== null && typeof value.conclusion !== "string")
    || !Number.isFinite(startedAt)) {
    return invalidWorkflowRun();
  }

  return {
    id: value.id as number,
    status: value.status,
    conclusion: value.conclusion as string | null,
    runAttempt: value.run_attempt as number,
    startedAt,
  };
}

function invalidWorkflowRun(): WorkflowRun {
  return { id: -1, status: "invalid", conclusion: null, runAttempt: 0, startedAt: Number.NEGATIVE_INFINITY };
}

function parseTrustedNextLink(link: string | null, expectedPath: string): string | null {
  if (link === null || link.trim() === "") {
    return null;
  }
  const matches = [...link.matchAll(/<([^>]+)>\s*;\s*rel="([^"]+)"/g)];
  const next = matches.find((match) => match[2].split(/\s+/).includes("next"));
  if (next === undefined) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(next[1]);
  } catch {
    throw new Error("malformed pagination URL");
  }
  if (url.origin !== GITHUB_ORIGIN || url.pathname !== expectedPath) {
    throw new Error("untrusted pagination URL");
  }
  return url.toString();
}

function observeWorkflowRuns(runs: WorkflowRun[]): WorkflowObservation {
  if (runs.length === 0) {
    return { kind: "absent" };
  }
  if (runs.some((run) => run.status === "invalid")) {
    return { kind: "invalid" };
  }

  const latest = runs.reduce((selected, candidate) => {
    if (candidate.startedAt !== selected.startedAt) {
      return candidate.startedAt > selected.startedAt ? candidate : selected;
    }
    if (candidate.runAttempt !== selected.runAttempt) {
      return candidate.runAttempt > selected.runAttempt ? candidate : selected;
    }
    return candidate.id > selected.id ? candidate : selected;
  });
  return classifyWorkflowRun(latest);
}

function classifyWorkflowRun(run: WorkflowRun): WorkflowObservation {
  const pendingReasons: Record<string, string> = {
    queued: "Деплой поставлен в очередь",
    in_progress: "Деплой выполняется",
    waiting: "Деплой ожидает продолжения",
    pending: "Деплой ожидает запуска",
    requested: "Деплой запрошен",
  };
  const failedReasons: Record<string, string> = {
    failure: "Деплой завершился ошибкой",
    cancelled: "Деплой отменён",
    skipped: "Деплой пропущен",
    action_required: "Деплой требует действия",
    neutral: "Деплой завершён без публикации",
    stale: "Деплой устарел",
    timed_out: "Деплой превысил время ожидания",
    startup_failure: "Деплой не удалось запустить",
  };

  if (run.status in pendingReasons && run.conclusion === null) {
    return { kind: "pending", reason: pendingReasons[run.status] };
  }
  if (run.status !== "completed") {
    return { kind: "invalid" };
  }
  if (run.conclusion === "success") {
    return { kind: "success" };
  }
  if (run.conclusion !== null && run.conclusion in failedReasons) {
    return { kind: "failed", reason: failedReasons[run.conclusion] };
  }
  return { kind: "invalid" };
}

function classifyCompare(value: unknown): boolean | null {
  if (!isRecord(value) || value.status !== "ahead" || !Array.isArray(value.files)) {
    return null;
  }
  if (value.files.length === 0 || value.files.length >= 300) {
    return null;
  }

  let docsOnly = true;
  for (const file of value.files) {
    if (!isRecord(file)
      || typeof file.filename !== "string"
      || typeof file.status !== "string"
      || !isRepositoryPath(file.filename)) {
      return null;
    }
    const previous = file.previous_filename;
    if (previous !== undefined && (typeof previous !== "string" || !isRepositoryPath(previous))) {
      return null;
    }
    if (file.status === "renamed" && typeof previous !== "string") {
      return null;
    }
    if (!isKnownFileStatus(file.status)) {
      return null;
    }
    if (!isDocsPath(file.filename) || (typeof previous === "string" && !isDocsPath(previous))) {
      docsOnly = false;
    }
  }
  return docsOnly;
}

function isKnownFileStatus(status: string): boolean {
  return ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"].includes(status);
}

function isRepositoryPath(path: string): boolean {
  return path !== ""
    && !path.startsWith("/")
    && !path.includes("\\")
    && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isDocsPath(path: string): boolean {
  return path.startsWith("docs/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
