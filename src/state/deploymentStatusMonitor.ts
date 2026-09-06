import { isDeploymentCommitSha } from "../shared/deploymentVersion";
import {
  ACTIVE_POLL_MS, ANONYMOUS_POLL_MS, AUTH_POLL_MS, MAX_BACKOFF_MS,
  PUBLICATION_GRACE_MS, RUN_GRACE_MS, deriveDeploymentStatus, emptyDeploymentObservation,
  type DeploymentObservation, type DeploymentStatusSnapshot,
} from "./deploymentStatusModel";
import {
  DeploymentStatusRequestError, type DeploymentStatusClient, type RateHints, type RateHintsObserver, type StatusRead,
} from "./deploymentStatusClient";

export interface DeploymentMonitorInput {
  ready: boolean;
  dataCommitSha: string | null;
  token: string | null;
  visible: boolean;
  online: boolean;
}

export interface DeploymentStatusMonitor {
  getSnapshot(): DeploymentStatusSnapshot;
  subscribe(listener: () => void): () => void;
  update(input: DeploymentMonitorInput): void;
  dispose(): void;
}

type Endpoint = "head" | "workflow" | "published" | "compare";

export function createDeploymentStatusMonitor(options: {
  development: boolean;
  documentCommitSha: string | null;
  client: DeploymentStatusClient;
  now: () => number;
}): DeploymentStatusMonitor {
  let input: DeploymentMonitorInput = { ready: false, dataCommitSha: null, token: null, visible: false, online: true };
  let observation = emptyDeploymentObservation();
  const listeners = new Set<() => void>();
  const rejectedTokens = new Set<string>();
  // Endpoint identities deliberately exclude the query SHA and credential value.
  const intervals = new Map<Endpoint, number>();
  let needed = new Set<Endpoint>(["head"]);
  let serverNotBefore = 0;
  let anonymousNotBefore = 0;
  let cycleStartedAt: number | null = null;
  let failureCount = 0;
  let backoffMs = 0;
  let generation = 0;
  let active: AbortController | null = null;
  let disposed = false;
  let cycleTimer: ReturnType<typeof setTimeout> | undefined;
  let localTimer: ReturnType<typeof setTimeout> | undefined;
  let checking = false;
  let targetSha: string | null = null;
  let targetDiscoveredAt: number | null = null;
  let publicationWaitingSince: number | null = null;
  const comparisons = new Map<string, boolean | null>();
  let snapshot = derive();

  function credential() {
    return input.token !== null && !rejectedTokens.has(input.token) ? input.token : null;
  }

  function eligible() {
    return !disposed && !options.development && input.ready && input.visible && input.online
      && isDeploymentCommitSha(options.documentCommitSha) && isDeploymentCommitSha(input.dataCommitSha);
  }

  function derive() {
    const visibleObservation = !input.online
      ? { ...observation, error: "Нет подключения к сети" }
      : checking
        ? { ...emptyDeploymentObservation(), lastCheckedAt: observation.lastCheckedAt }
        : observation;
    return deriveDeploymentStatus({
      development: options.development, documentCommitSha: options.documentCommitSha,
      ready: input.ready, dataCommitSha: input.dataCommitSha,
    }, visibleObservation, options.now());
  }

  function publish() {
    const next = derive();
    if (Object.keys(next).some((key) => next[key as keyof DeploymentStatusSnapshot] !== snapshot[key as keyof DeploymentStatusSnapshot])) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  }

  function nominalInterval() {
    if (credential() === null) return ANONYMOUS_POLL_MS;
    return deriveDeploymentStatus({ development: options.development, documentCommitSha: options.documentCommitSha, ready: input.ready, dataCommitSha: input.dataCommitSha }, observation, options.now()).color === "yellow"
      ? ACTIVE_POLL_MS : AUTH_POLL_MS;
  }

  function effectiveInterval() {
    return Math.max(nominalInterval(), backoffMs, ...[...needed].map((endpoint) => intervals.get(endpoint) ?? 0));
  }

  function nextAllowedAt() {
    return Math.max(cycleStartedAt === null ? 0 : cycleStartedAt + effectiveInterval(), serverNotBefore, anonymousNotBefore);
  }

  function schedule() {
    clearTimeout(cycleTimer);
    clearTimeout(localTimer);
    cycleTimer = undefined;
    localTimer = undefined;
    if (disposed) return;
    // These deadlines only reclassify known observations; they never start a GET.
    const deadlines = [
      observation.workflow?.kind === "absent" && observation.missingRunSince !== null ? observation.missingRunSince + RUN_GRACE_MS : 0,
      observation.workflow?.kind === "success" && observation.publicationWaitingSince !== null ? observation.publicationWaitingSince + PUBLICATION_GRACE_MS : 0,
    ].filter((deadline) => deadline > options.now());
    if (deadlines.length > 0) {
      localTimer = setTimeout(() => { publish(); schedule(); }, Math.min(...deadlines) - options.now());
    }
    if (eligible() && active === null) {
      cycleTimer = setTimeout(() => { void runCycle(); }, Math.max(0, nextAllowedAt() - options.now()));
    }
  }

  function mergeLimits(endpoint: Endpoint, limits: RateHints) {
    intervals.set(endpoint, Math.max(intervals.get(endpoint) ?? 0, limits.minIntervalMs));
    serverNotBefore = Math.max(serverNotBefore, limits.notBefore ?? 0);
  }

  async function runCycle() {
    if (!eligible() || active !== null) return;
    const controller = new AbortController();
    active = controller;
    const ownGeneration = generation;
    const token = credential();
    cycleStartedAt = options.now();
    const used = new Set<Endpoint>();
    const requestContext: { endpoint: Endpoint } = { endpoint: "head" };
    const guard = () => {
      if (disposed || ownGeneration !== generation || controller.signal.aborted) throw new DOMException("Observation cancelled", "AbortError");
      if (serverNotBefore > options.now()) {
        throw new DeploymentStatusRequestError("rate-limit", "Лимит запросов временно ограничивает проверку", { minIntervalMs: 0, notBefore: serverNotBefore, remaining: null });
      }
    };
    const read = async <T>(name: Endpoint, operation: (onRateHints: RateHintsObserver) => Promise<StatusRead<T>>): Promise<T> => {
      requestContext.endpoint = name;
      guard();
      used.add(name);
      needed.add(name);
      const result = await operation((limits) => {
        // Server restrictions are transport facts, independent of whether this
        // cycle can still publish a value. No notification or GET occurs here.
        if (!disposed) mergeLimits(name, limits);
      });
      // The generation guard precedes every observable mutation and every next GET.
      if (disposed || ownGeneration !== generation || controller.signal.aborted) throw new DOMException("Observation cancelled", "AbortError");
      mergeLimits(name, result.limits);
      return result.value;
    };
    try {
      const head = await read("head", (onRateHints) => options.client.readHead(token, controller.signal, onRateHints));
      if (head !== targetSha) {
        targetSha = head;
        targetDiscoveredAt = options.now();
        publicationWaitingSince = null;
        comparisons.clear();
      }
      const next: DeploymentObservation = {
        ...emptyDeploymentObservation(), headCommitSha: head,
        lastCheckedAt: observation.lastCheckedAt,
      };
      if (head !== options.documentCommitSha || head !== input.dataCommitSha) {
        next.workflow = await read("workflow", (onRateHints) => options.client.readWorkflow(head, token, controller.signal, onRateHints));
        if (next.workflow.kind === "absent" || next.workflow.kind === "success") {
          next.missingRunSince = targetDiscoveredAt;
          if (next.workflow.kind === "success") publicationWaitingSince ??= options.now();
          next.publishedCommitSha = await read("published", (onRateHints) => options.client.readPublishedVersion(controller.signal, onRateHints));
          if (next.workflow.kind === "success") {
            next.publicationWaitingSince = publicationWaitingSince;
          } else {
            const published = next.publishedCommitSha;
            const pair = `${published}:${head}`;
            if (!comparisons.has(pair)) {
              // An unsuccessful comparison is also attempted only once per pair.
              const docsOnly = await read("compare", (onRateHints) => {
                comparisons.set(pair, null);
                return options.client.readDocsOnly(published, head, token, controller.signal, onRateHints);
              });
              comparisons.set(pair, docsOnly);
            }
            next.docsOnly = comparisons.get(pair) ?? null;
          }
        }
      }
      next.lastCheckedAt = options.now();
      observation = next;
      checking = false;
      failureCount = 0;
      backoffMs = 0;
      needed = used;
      publish();
    } catch (error) {
      if (disposed || ownGeneration !== generation || controller.signal.aborted) return;
      if (error instanceof DeploymentStatusRequestError) {
        mergeLimits(requestContext.endpoint, error.limits);
        if (error.kind === "unauthorized" && requestContext.endpoint !== "published" && token !== null) {
          rejectedTokens.add(token);
          options.client.clearCredentialCache();
          anonymousNotBefore = options.now() + ANONYMOUS_POLL_MS;
        }
        if (error.kind === "network" || error.kind === "timeout" || error.kind === "http") {
          failureCount += 1;
          backoffMs = Math.min(MAX_BACKOFF_MS, (credential() === null ? ANONYMOUS_POLL_MS : AUTH_POLL_MS) * 2 ** Math.min(failureCount, 10));
        }
      }
      // Only client-owned normalized messages are accepted; arbitrary failures never leak details.
      observation = { ...observation, error: error instanceof DeploymentStatusRequestError ? error.message : "Не удалось получить сведения о версии" };
      checking = false;
      needed = new Set([...needed, ...used]);
      publish();
    } finally {
      if (active === controller) active = null;
      schedule();
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next) {
      if (disposed) return;
      const wasEligible = eligible();
      const previous = input;
      input = { ...next };
      const tokenChanged = previous.token !== next.token;
      if (tokenChanged || (wasEligible && !eligible())) {
        generation += 1;
        active?.abort();
        if (tokenChanged) options.client.clearCredentialCache();
      }
      const resumed = (!previous.visible && next.visible) || (!previous.online && next.online);
      if (resumed && observation.lastCheckedAt !== null
        && options.now() - observation.lastCheckedAt > Math.max(effectiveInterval(), serverNotBefore - observation.lastCheckedAt)) {
        checking = true;
      }
      publish();
      schedule();
    },
    dispose() {
      disposed = true;
      generation += 1;
      active?.abort();
      clearTimeout(cycleTimer);
      clearTimeout(localTimer);
      listeners.clear();
    },
  };
}
