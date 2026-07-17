export const GITHUB_PAT_STORAGE_KEY = "my-game-library.github-pat.v1";

export const GITHUB_REPOSITORY_OWNER = "kana-sama";
export const GITHUB_REPOSITORY_NAME = "mygameslist";
export const GITHUB_PAT_NAME = "Publish mygameslist";
export const GITHUB_PAT_DESCRIPTION =
  "Publish library changes to kana-sama/mygameslist from My Game Library";

const GITHUB_PAT_CREATION_ENDPOINT =
  "https://github.com/settings/personal-access-tokens/new";

const FINE_GRAINED_PAT_PREFIX = "github_pat_";
const MIN_FINE_GRAINED_PAT_LENGTH = 20;
const MAX_FINE_GRAINED_PAT_LENGTH = 256;
const PRINTABLE_ASCII_WITHOUT_SPACES = /^[\x21-\x7e]+$/;

export type GitHubPatPersistence = "session" | "persistent";
export type GitHubPatStorageError = "invalid-token" | "storage-unavailable";

type CredentialStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface GitHubPatStorages {
  session: CredentialStorage;
  persistent: CredentialStorage;
}

export type GitHubPatLoadResult =
  | {
      ok: true;
      token: string | null;
      persistence: GitHubPatPersistence | null;
    }
  | {
      ok: false;
      token: null;
      persistence: null;
      error: GitHubPatStorageError;
    };

export type GitHubPatWriteResult =
  | { ok: true; persistence: GitHubPatPersistence }
  | { ok: false; error: GitHubPatStorageError };

export type GitHubPatClearResult =
  | { ok: true }
  | { ok: false; error: "storage-unavailable" };

type StorageReadResult =
  | { status: "empty" }
  | { status: "value"; token: string }
  | { status: "invalid" }
  | { status: "unavailable" };

/** Trims copy/paste whitespace and accepts opaque GitHub fine-grained PATs. */
export function normalizeGitHubPat(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (
    !token.startsWith(FINE_GRAINED_PAT_PREFIX)
    || token.length < MIN_FINE_GRAINED_PAT_LENGTH
    || token.length > MAX_FINE_GRAINED_PAT_LENGTH
    || !PRINTABLE_ASCII_WITHOUT_SPACES.test(token)
  ) return null;
  return token;
}

export function getGitHubPatCreationUrl(): string {
  const url = new URL(GITHUB_PAT_CREATION_ENDPOINT);
  url.searchParams.set("name", GITHUB_PAT_NAME);
  url.searchParams.set("description", GITHUB_PAT_DESCRIPTION);
  url.searchParams.set("target_name", GITHUB_REPOSITORY_OWNER);
  url.searchParams.set("expires_in", "30");
  url.searchParams.set("contents", "write");
  return url.toString();
}

function browserStorages(): GitHubPatStorages | null {
  try {
    if (typeof window === "undefined") return null;
    return {
      session: window.sessionStorage,
      persistent: window.localStorage,
    };
  } catch {
    return null;
  }
}

function resolveStorages(
  storages: GitHubPatStorages | undefined,
): GitHubPatStorages | null {
  return storages ?? browserStorages();
}

function readStoredPat(storage: CredentialStorage): StorageReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(GITHUB_PAT_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "empty" };
  const token = normalizeGitHubPat(raw);
  return token === null
    ? { status: "invalid" }
    : { status: "value", token };
}

/** Session credentials intentionally take precedence over remembered ones. */
export function loadGitHubPat(
  storages?: GitHubPatStorages,
): GitHubPatLoadResult {
  const resolved = resolveStorages(storages);
  if (resolved === null) {
    return {
      ok: false,
      token: null,
      persistence: null,
      error: "storage-unavailable",
    };
  }

  const session = readStoredPat(resolved.session);
  if (session.status === "value") {
    return { ok: true, token: session.token, persistence: "session" };
  }
  if (session.status === "invalid") {
    return {
      ok: false,
      token: null,
      persistence: null,
      error: "invalid-token",
    };
  }

  const persistent = readStoredPat(resolved.persistent);
  if (persistent.status === "value") {
    return { ok: true, token: persistent.token, persistence: "persistent" };
  }
  if (persistent.status === "invalid") {
    return {
      ok: false,
      token: null,
      persistence: null,
      error: "invalid-token",
    };
  }
  if (
    session.status === "unavailable" ||
    persistent.status === "unavailable"
  ) {
    return {
      ok: false,
      token: null,
      persistence: null,
      error: "storage-unavailable",
    };
  }
  return { ok: true, token: null, persistence: null };
}

function restoreStorageValue(
  storage: CredentialStorage,
  previousValue: string | null,
): void {
  try {
    if (previousValue === null) storage.removeItem(GITHUB_PAT_STORAGE_KEY);
    else storage.setItem(GITHUB_PAT_STORAGE_KEY, previousValue);
  } catch {
    // Best effort only. The public result stays sanitized and never exposes a token.
  }
}

/**
 * Stores a PAT in exactly one browser storage. The previous state is preserved
 * when Safari rejects the selected storage or clearing the other one.
 */
export function saveGitHubPat(
  value: unknown,
  remember: boolean,
  storages?: GitHubPatStorages,
): GitHubPatWriteResult {
  const token = normalizeGitHubPat(value);
  if (token === null) return { ok: false, error: "invalid-token" };

  const resolved = resolveStorages(storages);
  if (resolved === null) return { ok: false, error: "storage-unavailable" };

  const persistence: GitHubPatPersistence = remember
    ? "persistent"
    : "session";
  const selected = remember ? resolved.persistent : resolved.session;
  const other = remember ? resolved.session : resolved.persistent;

  let previousSelected: string | null;
  try {
    previousSelected = selected.getItem(GITHUB_PAT_STORAGE_KEY);
    // Reading both first avoids mutating either storage if Safari denies access.
    other.getItem(GITHUB_PAT_STORAGE_KEY);
  } catch {
    return { ok: false, error: "storage-unavailable" };
  }

  try {
    selected.setItem(GITHUB_PAT_STORAGE_KEY, token);
  } catch {
    return { ok: false, error: "storage-unavailable" };
  }

  try {
    other.removeItem(GITHUB_PAT_STORAGE_KEY);
  } catch {
    restoreStorageValue(selected, previousSelected);
    return { ok: false, error: "storage-unavailable" };
  }

  return { ok: true, persistence };
}

/** Attempts both removals even if one Safari storage is unavailable. */
export function clearGitHubPat(
  storages?: GitHubPatStorages,
): GitHubPatClearResult {
  const resolved = resolveStorages(storages);
  if (resolved === null) return { ok: false, error: "storage-unavailable" };

  let failed = false;
  for (const storage of [resolved.session, resolved.persistent]) {
    try {
      storage.removeItem(GITHUB_PAT_STORAGE_KEY);
    } catch {
      failed = true;
    }
  }
  return failed ? { ok: false, error: "storage-unavailable" } : { ok: true };
}
