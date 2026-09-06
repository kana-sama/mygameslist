import { useEffect, useState, useSyncExternalStore } from "react";
import { isDeploymentCommitSha } from "../shared/deploymentVersion";
import { GITHUB_REPOSITORY_NAME, GITHUB_REPOSITORY_OWNER } from "./githubPat";
import { createDeploymentStatusClient } from "./deploymentStatusClient";
import { createDeploymentStatusMonitor, type DeploymentStatusMonitor } from "./deploymentStatusMonitor";
import { deriveDeploymentStatus, emptyDeploymentObservation, type DeploymentStatusSnapshot } from "./deploymentStatusModel";

type LocalInput = { ready: boolean; dataCommitSha: string | null; token: string | null };
const documentVersions = new WeakMap<Document, string | null>();

function documentVersion(document: Document): string | null {
  if (!documentVersions.has(document)) {
    const matches = document.querySelectorAll('meta[name="mygameslist-deployment-commit"]');
    const value = matches.length === 1 ? matches[0].getAttribute("content") : null;
    documentVersions.set(document, isDeploymentCommitSha(value) ? value : null);
  }
  return documentVersions.get(document) ?? null;
}

function localRuntime(): boolean {
  const hostname = location.hostname.toLowerCase();
  return import.meta.env.DEV || hostname === "localhost" || hostname.endsWith(".localhost")
    || /^127\./.test(hostname) || hostname === "[::1]" || hostname === "::1";
}

function browserInput(input: LocalInput) {
  return { ...input, visible: document.visibilityState === "visible", online: navigator.onLine };
}

function createHookStore(initial: LocalInput) {
  const development = localRuntime();
  const documentCommitSha = documentVersion(document);
  let localInput = initial;
  let monitor: DeploymentStatusMonitor | null = null;
  let snapshot = deriveDeploymentStatus({ ...initial, development, documentCommitSha }, emptyDeploymentObservation(), Date.now());
  const listeners = new Set<() => void>();
  const relay = () => {
    const next = monitor?.getSnapshot();
    if (next !== undefined && next !== snapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    }
  };
  const refresh = () => { monitor?.update(browserInput(localInput)); };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(input: LocalInput) { localInput = input; refresh(); },
    connect() {
      // Create effect-owned resources here so StrictMode's cleanup/replay never
      // leaves the hook holding a permanently disposed controller.
      monitor = createDeploymentStatusMonitor({
        development, documentCommitSha, now: Date.now,
        client: createDeploymentStatusClient({
          owner: GITHUB_REPOSITORY_OWNER, repo: GITHUB_REPOSITORY_NAME,
          pagesBaseUrl: new URL(import.meta.env.BASE_URL, document.baseURI),
          fetch: (...args) => globalThis.fetch(...args), now: Date.now,
        }),
      });
      const unsubscribe = monitor.subscribe(relay);
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("online", refresh);
      window.addEventListener("offline", refresh);
      refresh();
      relay();
      return () => {
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("online", refresh);
        window.removeEventListener("offline", refresh);
        unsubscribe();
        monitor?.dispose();
        monitor = null;
      };
    },
  };
}

export function useDeploymentStatus(input: LocalInput): DeploymentStatusSnapshot {
  const [store] = useState(() => createHookStore(input));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => store.connect(), [store]);
  useEffect(() => store.update(input), [store, input.ready, input.dataCommitSha, input.token]);
  return snapshot;
}
