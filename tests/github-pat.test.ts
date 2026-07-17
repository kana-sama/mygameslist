import { PATCH_STORAGE_KEY } from "../src/domain";
import {
  GITHUB_PAT_DESCRIPTION,
  GITHUB_PAT_NAME,
  GITHUB_PAT_STORAGE_KEY,
  GITHUB_REPOSITORY_NAME,
  GITHUB_REPOSITORY_OWNER,
  clearGitHubPat,
  getGitHubPatCreationUrl,
  loadGitHubPat,
  normalizeGitHubPat,
  saveGitHubPat,
  type GitHubPatStorages,
} from "../src/state/githubPat";

const TOKEN = `github_pat_${"a".repeat(22)}_${"B".repeat(59)}`;
const OTHER_TOKEN = `github_pat_${"c".repeat(22)}_${"D".repeat(59)}`;

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  getError: DOMException | null = null;
  setError: DOMException | null = null;
  removeError: DOMException | null = null;

  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    if (this.getError) throw this.getError;
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    if (this.removeError) throw this.removeError;
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.setError) throw this.setError;
    this.values.set(key, value);
  }
}

function makeStorages(): GitHubPatStorages & {
  session: MemoryStorage;
  persistent: MemoryStorage;
} {
  return { session: new MemoryStorage(), persistent: new MemoryStorage() };
}

describe("GitHub fine-grained PAT credentials", () => {
  it("trims and validates the stable prefix without pinning GitHub's token length", () => {
    const futureLengthToken = `github_pat_${"a".repeat(82)}`;
    const printableOpaqueToken = `github_pat_${"future-format-2026_".repeat(2)}`;

    expect(normalizeGitHubPat(`  \n${TOKEN}\t`)).toBe(TOKEN);
    expect(normalizeGitHubPat(futureLengthToken)).toBe(futureLengthToken);
    expect(normalizeGitHubPat(printableOpaqueToken)).toBe(printableOpaqueToken);
    expect(normalizeGitHubPat("ghp_" + "a".repeat(36))).toBeNull();
    expect(normalizeGitHubPat("github_pat_short")).toBeNull();
    expect(normalizeGitHubPat("github_pat_" + "a".repeat(246))).toBeNull();
    expect(normalizeGitHubPat(`github_pat_${"a".repeat(20)} bad`)).toBeNull();
    expect(normalizeGitHubPat(`github_pat_${"a".repeat(20)}ы`)).toBeNull();
    expect(normalizeGitHubPat(`${TOKEN}\n${OTHER_TOKEN}`)).toBeNull();
    expect(normalizeGitHubPat(null)).toBeNull();
  });

  it("stores a session-only token and removes a remembered token", () => {
    const storages = makeStorages();
    storages.persistent.setItem(GITHUB_PAT_STORAGE_KEY, OTHER_TOKEN);

    expect(saveGitHubPat(` ${TOKEN} `, false, storages)).toEqual({
      ok: true,
      persistence: "session",
    });
    expect(storages.session.getItem(GITHUB_PAT_STORAGE_KEY)).toBe(TOKEN);
    expect(storages.persistent.getItem(GITHUB_PAT_STORAGE_KEY)).toBeNull();
    expect(loadGitHubPat(storages)).toEqual({
      ok: true,
      token: TOKEN,
      persistence: "session",
    });
  });

  it("stores a remembered token and removes a session-only token", () => {
    const storages = makeStorages();
    storages.session.setItem(GITHUB_PAT_STORAGE_KEY, OTHER_TOKEN);

    expect(saveGitHubPat(TOKEN, true, storages)).toEqual({
      ok: true,
      persistence: "persistent",
    });
    expect(storages.persistent.getItem(GITHUB_PAT_STORAGE_KEY)).toBe(TOKEN);
    expect(storages.session.getItem(GITHUB_PAT_STORAGE_KEY)).toBeNull();
    expect(loadGitHubPat(storages)).toEqual({
      ok: true,
      token: TOKEN,
      persistence: "persistent",
    });
  });

  it("prefers sessionStorage and can fall back to localStorage", () => {
    const storages = makeStorages();
    storages.session.setItem(GITHUB_PAT_STORAGE_KEY, TOKEN);
    storages.persistent.setItem(GITHUB_PAT_STORAGE_KEY, OTHER_TOKEN);
    expect(loadGitHubPat(storages)).toEqual({
      ok: true,
      token: TOKEN,
      persistence: "session",
    });

    storages.session.clear();
    expect(loadGitHubPat(storages)).toEqual({
      ok: true,
      token: OTHER_TOKEN,
      persistence: "persistent",
    });
  });

  it("keeps existing credentials when Safari rejects a write", () => {
    const storages = makeStorages();
    storages.session.setItem(GITHUB_PAT_STORAGE_KEY, OTHER_TOKEN);
    storages.persistent.setError = new DOMException(
      "The attempted value is secret",
      "QuotaExceededError",
    );

    expect(saveGitHubPat(TOKEN, true, storages)).toEqual({
      ok: false,
      error: "storage-unavailable",
    });
    expect(storages.session.getItem(GITHUB_PAT_STORAGE_KEY)).toBe(OTHER_TOKEN);
  });

  it("does not overwrite a stored credential with invalid input", () => {
    const storages = makeStorages();
    storages.persistent.setItem(GITHUB_PAT_STORAGE_KEY, OTHER_TOKEN);

    expect(saveGitHubPat("ghp_not-a-fine-grained-token", true, storages)).toEqual({
      ok: false,
      error: "invalid-token",
    });
    expect(storages.persistent.getItem(GITHUB_PAT_STORAGE_KEY)).toBe(
      OTHER_TOKEN,
    );
  });

  it("sanitizes a storage error while loading", () => {
    const storages = makeStorages();
    storages.session.getError = new DOMException(
      `Denied ${TOKEN}`,
      "SecurityError",
    );

    const result = loadGitHubPat(storages);
    expect(result).toEqual({
      ok: false,
      token: null,
      persistence: null,
      error: "storage-unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("sanitizes SecurityError and never throws or logs a token", () => {
    const storages = makeStorages();
    storages.session.setError = new DOMException(
      `Denied ${TOKEN}`,
      "SecurityError",
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = saveGitHubPat(TOKEN, false, storages);
    expect(result).toEqual({ ok: false, error: "storage-unavailable" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("rolls back the selected storage if clearing the other one fails", () => {
    const storages = makeStorages();
    storages.session.setItem(GITHUB_PAT_STORAGE_KEY, OTHER_TOKEN);
    storages.session.removeError = new DOMException("denied", "SecurityError");

    expect(saveGitHubPat(TOKEN, true, storages)).toEqual({
      ok: false,
      error: "storage-unavailable",
    });
    expect(storages.persistent.getItem(GITHUB_PAT_STORAGE_KEY)).toBeNull();
    expect(storages.session.getItem(GITHUB_PAT_STORAGE_KEY)).toBe(OTHER_TOKEN);
  });

  it("clears both stores and still attempts localStorage after a session error", () => {
    const storages = makeStorages();
    storages.session.setItem(GITHUB_PAT_STORAGE_KEY, TOKEN);
    storages.persistent.setItem(GITHUB_PAT_STORAGE_KEY, TOKEN);
    storages.session.removeError = new DOMException("denied", "SecurityError");

    expect(clearGitHubPat(storages)).toEqual({
      ok: false,
      error: "storage-unavailable",
    });
    expect(storages.persistent.getItem(GITHUB_PAT_STORAGE_KEY)).toBeNull();

    storages.session.removeError = null;
    expect(clearGitHubPat(storages)).toEqual({ ok: true });
    expect(loadGitHubPat(storages)).toEqual({
      ok: true,
      token: null,
      persistence: null,
    });
  });

  it("keeps the credential outside the patch key and patch export value", () => {
    const storages = makeStorages();
    const patchExport = JSON.stringify({
      patchVersion: 2,
      operations: {},
      blobs: {},
    });
    storages.persistent.setItem(PATCH_STORAGE_KEY, patchExport);

    expect(GITHUB_PAT_STORAGE_KEY).not.toBe(PATCH_STORAGE_KEY);
    expect(saveGitHubPat(TOKEN, true, storages).ok).toBe(true);
    expect(storages.persistent.getItem(PATCH_STORAGE_KEY)).toBe(patchExport);
    expect(storages.persistent.getItem(PATCH_STORAGE_KEY)).not.toContain(TOKEN);
  });

  it("builds the least-privilege PAT creation link for the configured repo", () => {
    const url = new URL(getGitHubPatCreationUrl());
    expect(url.origin + url.pathname).toBe(
      "https://github.com/settings/personal-access-tokens/new",
    );
    expect(url.searchParams.get("target_name")).toBe(GITHUB_REPOSITORY_OWNER);
    expect(url.searchParams.get("expires_in")).toBe("30");
    expect(url.searchParams.get("contents")).toBe("write");
    expect(url.searchParams.get("name")).toBe(GITHUB_PAT_NAME);
    expect(url.searchParams.get("description")).toBe(GITHUB_PAT_DESCRIPTION);
    expect(GITHUB_PAT_NAME).toContain(GITHUB_REPOSITORY_NAME);
    expect(GITHUB_PAT_DESCRIPTION).toContain(
      `${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}`,
    );
  });
});
