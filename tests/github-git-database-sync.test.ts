import {
  bytesToBase64,
  diffLibrary,
  makeFileAsset,
  withComputedRevision,
  type Game,
  type LibraryDatabase,
} from "../src/domain";
import {
  GITHUB_API_VERSION,
  GITHUB_LIBRARY_PATH,
  GitHubGitDatabaseSyncClient,
  GitHubPatchConflictError,
  GitHubSyncError,
  type GitHubFetch,
  type GitHubSyncStage,
} from "../src/state/githubGitDatabaseSync";

const TOKEN = "github_pat_do-not-leak";
const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const PUBLICATION_ID = "33333333-3333-4333-8333-333333333333";
const CHANGED_AT = "2026-07-17T08:00:00.000Z";
const HEAD_SHA = "1".repeat(40);
const TREE_SHA = "2".repeat(40);
const LIBRARY_BLOB_SHA = "3".repeat(40);
const CREATED_LIBRARY_BLOB_SHA = "4".repeat(40);
const CREATED_TREE_SHA = "5".repeat(40);
const CREATED_COMMIT_SHA = "6".repeat(40);
const CREATED_MEDIA_BLOB_SHA = "7".repeat(40);
const API_ROOT = "https://api.github.com/repos/kana/mylib";

function empty(): LibraryDatabase {
  return { schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} };
}

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: GAME_ID,
    title: "DuckTales",
    coverAssetId: null,
    platforms: ["NES"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: "2026-07-16T08:00:00.000Z",
    updatedAt: "2026-07-16T08:00:00.000Z",
    ...overrides,
  };
}

function databaseWithGame(overrides: Partial<Game> = {}): LibraryDatabase {
  const database = empty();
  database.games[GAME_ID] = game(overrides);
  return withComputedRevision(database);
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RecordedRequest {
  url: URL;
  method: string;
  cache?: RequestCache;
  headers: Headers;
  body: Record<string, unknown> | null;
}

interface ApiMockOptions {
  tree?: unknown;
  onRequest?: (request: RecordedRequest) => Response | undefined;
}

function apiMock(database: LibraryDatabase, options: ApiMockOptions = {}): {
  fetch: GitHubFetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn<GitHubFetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const rawBody = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    const request = { url, method, cache: init.cache, headers: new Headers(init.headers), body: rawBody };
    requests.push(request);
    const overridden = options.onRequest?.(request);
    if (overridden) return overridden;

    if (method === "GET" && url.pathname === "/repos/kana/mylib/git/ref/heads/main") {
      return response({ ref: "refs/heads/main", object: { type: "commit", sha: HEAD_SHA } });
    }
    if (method === "GET" && url.pathname === `/repos/kana/mylib/git/commits/${HEAD_SHA}`) {
      return response({ sha: HEAD_SHA, tree: { sha: TREE_SHA } });
    }
    if (method === "GET" && url.pathname === `/repos/kana/mylib/git/trees/${TREE_SHA}`) {
      return response(options.tree ?? {
        sha: TREE_SHA,
        truncated: false,
        tree: [{ path: GITHUB_LIBRARY_PATH, mode: "100644", type: "blob", sha: LIBRARY_BLOB_SHA }],
      });
    }
    if (method === "GET" && url.pathname === `/repos/kana/mylib/git/blobs/${LIBRARY_BLOB_SHA}`) {
      const base64 = bytesToBase64(new TextEncoder().encode(JSON.stringify(database)));
      return response({ sha: LIBRARY_BLOB_SHA, encoding: "base64", content: `${base64.slice(0, 16)}\n${base64.slice(16)}` });
    }
    if (method === "POST" && url.pathname === "/repos/kana/mylib/git/blobs") {
      return response({ sha: rawBody?.encoding === "utf-8" ? CREATED_LIBRARY_BLOB_SHA : CREATED_MEDIA_BLOB_SHA }, 201);
    }
    if (method === "POST" && url.pathname === "/repos/kana/mylib/git/trees") {
      return response({ sha: CREATED_TREE_SHA }, 201);
    }
    if (method === "POST" && url.pathname === "/repos/kana/mylib/git/commits") {
      return response({ sha: CREATED_COMMIT_SHA }, 201);
    }
    if (method === "PATCH" && url.pathname === "/repos/kana/mylib/git/refs/heads/main") {
      return response({ ref: "refs/heads/main", object: { type: "commit", sha: CREATED_COMMIT_SHA } });
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url}`);
  });
  return { fetch, requests };
}

function client(
  fetch: GitHubFetch,
  commitMessage?: string | ((before: LibraryDatabase, after: LibraryDatabase) => string),
  onStage?: (stage: GitHubSyncStage) => void,
): GitHubGitDatabaseSyncClient {
  return new GitHubGitDatabaseSyncClient({
    owner: "kana",
    repo: "mylib",
    branch: "main",
    token: TOKEN,
    fetch,
    commitMessage,
    createPublicationId: () => PUBLICATION_ID,
    onStage,
  });
}

function titlePatch(base: LibraryDatabase, title = "DuckTales Remastered") {
  const local = structuredClone(base);
  local.games[GAME_ID].title = title;
  return diffLibrary(base, local, { changedAt: CHANGED_AT, transactionId: "rename-game" });
}

describe("GitHub Git Database publication", () => {
  it("reads the fixed branch and creates a non-forced commit from the latest tree", async () => {
    const base = databaseWithGame();
    const api = apiMock(base);
    const buildMessage = vi.fn((_before: LibraryDatabase, after: LibraryDatabase) => `Update ${after.games[GAME_ID].title}\n\nGames:\n- Rename game`);
    const stages: GitHubSyncStage[] = [];

    const result = await client(api.fetch, buildMessage, (stage) => stages.push(stage)).publishPatch(titlePatch(base));

    expect(result).toMatchObject({
      status: "committed",
      previousHeadSha: HEAD_SHA,
      commitSha: CREATED_COMMIT_SHA,
      treeSha: CREATED_TREE_SHA,
      mediaPaths: [],
    });
    expect(result.database.games[GAME_ID]).toMatchObject({ title: "DuckTales Remastered", updatedAt: CHANGED_AT });
    expect(result.database.publicationId).toBe(PUBLICATION_ID);
    expect(result.database.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(buildMessage).toHaveBeenCalledWith(base, result.database);
    expect(stages).toEqual(["reading", "validating", "uploading", "committing", "updating"]);

    expect(api.requests.map(({ method, url }) => `${method} ${url.pathname}${url.search}`)).toEqual([
      "GET /repos/kana/mylib/git/ref/heads/main",
      `GET /repos/kana/mylib/git/commits/${HEAD_SHA}`,
      `GET /repos/kana/mylib/git/trees/${TREE_SHA}?recursive=1`,
      `GET /repos/kana/mylib/git/blobs/${LIBRARY_BLOB_SHA}`,
      "POST /repos/kana/mylib/git/blobs",
      "POST /repos/kana/mylib/git/trees",
      "POST /repos/kana/mylib/git/commits",
      "PATCH /repos/kana/mylib/git/refs/heads/main",
    ]);
    for (const request of api.requests) {
      expect(request.url.origin).toBe("https://api.github.com");
      expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
      expect(request.headers.get("X-GitHub-Api-Version")).toBe(GITHUB_API_VERSION);
      if (request.method === "GET") {
        expect(request.cache).toBe("no-store");
        expect(request.headers.has("Cache-Control")).toBe(false);
        expect(request.headers.has("Pragma")).toBe(false);
      } else {
        expect(request.cache).toBeUndefined();
      }
    }

    const libraryWrite = api.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/git/blobs"));
    expect(libraryWrite?.body?.encoding).toBe("utf-8");
    const publishedSource = libraryWrite?.body?.content;
    expect(typeof publishedSource).toBe("string");
    expect(JSON.parse(publishedSource as string)).toEqual(result.database);

    const treeWrite = api.requests.find((request) => request.url.pathname.endsWith("/git/trees") && request.method === "POST");
    expect(treeWrite?.body).toEqual({
      base_tree: TREE_SHA,
      tree: [{ path: GITHUB_LIBRARY_PATH, mode: "100644", type: "blob", sha: CREATED_LIBRARY_BLOB_SHA }],
    });
    const commitWrite = api.requests.find((request) => request.url.pathname.endsWith("/git/commits") && request.method === "POST");
    expect(commitWrite?.body).toEqual({
      message: "Update DuckTales Remastered\n\nGames:\n- Rename game",
      tree: CREATED_TREE_SHA,
      parents: [HEAD_SHA],
    });
    const refWrite = api.requests.find((request) => request.method === "PATCH");
    expect(refWrite?.body).toEqual({ sha: CREATED_COMMIT_SHA, force: false });
  });

  it("rebases clean fields onto a remotely changed library", async () => {
    const base = databaseWithGame();
    const patch = titlePatch(base);
    const latest = structuredClone(base);
    latest.games[GAME_ID].tags = ["remote-tag"];
    const publishedLatest = withComputedRevision(latest);
    const api = apiMock(publishedLatest);

    const result = await client(api.fetch).publishPatch(patch);

    expect(result.status).toBe("committed");
    expect(result.database.games[GAME_ID]).toMatchObject({
      title: "DuckTales Remastered",
      tags: ["remote-tag"],
      updatedAt: CHANGED_AT,
    });
    expect(result.reconciledPatch.baseRevision).toBe(publishedLatest.revision);
  });

  it("reports same-field conflicts before creating any Git objects", async () => {
    const base = databaseWithGame();
    const latest = structuredClone(base);
    latest.games[GAME_ID].title = "Remote title";
    const api = apiMock(withComputedRevision(latest));

    const promise = client(api.fetch).publishPatch(titlePatch(base, "Local title"));

    await expect(promise).rejects.toBeInstanceOf(GitHubPatchConflictError);
    await expect(promise).rejects.toMatchObject({
      conflicts: [{ path: `/games/${GAME_ID}/title` }],
      latestSnapshot: { headSha: HEAD_SHA, treeSha: TREE_SHA, libraryBlobSha: LIBRARY_BLOB_SHA },
    });
    expect(api.requests).toHaveLength(4);
    expect(api.requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("returns up-to-date when the latest library already contains every operation", async () => {
    const base = databaseWithGame();
    const patch = titlePatch(base);
    const alreadyPublished = structuredClone(base);
    alreadyPublished.games[GAME_ID].title = "DuckTales Remastered";
    alreadyPublished.games[GAME_ID].updatedAt = CHANGED_AT;
    const api = apiMock(withComputedRevision(alreadyPublished));

    const result = await client(api.fetch).publishPatch(patch);

    expect(result).toMatchObject({ status: "up-to-date", commitSha: HEAD_SHA, prunedOperationCount: 1 });
    expect(api.requests).toHaveLength(4);
    expect(api.requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("stores local MP4 bytes at a content-addressed allowlisted path", async () => {
    const base = databaseWithGame();
    const mediaBytes = new TextEncoder().encode("test mp4 bytes");
    const prepared = makeFileAsset(mediaBytes, "video/mp4", "../../escape.mp4");
    const local = structuredClone(base);
    local.assets[prepared.asset.id] = prepared.asset;
    local.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "",
      attachments: [{ type: "file", assetId: prepared.asset.id, label: "Video" }],
      rank: 1024,
      createdAt: CHANGED_AT,
      updatedAt: CHANGED_AT,
    };
    const patch = diffLibrary(base, local, {
      changedAt: CHANGED_AT,
      transactionId: "add-video",
    });
    const api = apiMock(base);

    const result = await client(api.fetch).publishPatch(patch, { [prepared.asset.id]: new Blob([mediaBytes], { type: "video/mp4" }) });

    const expectedPath = `public/media/${prepared.asset.id}.mp4`;
    expect(result.mediaPaths).toEqual([expectedPath]);
    const blobWrites = api.requests.filter((request) => request.method === "POST" && request.url.pathname.endsWith("/git/blobs"));
    expect(blobWrites).toHaveLength(2);
    expect(blobWrites[0].body).toEqual({ content: prepared.base64, encoding: "base64" });
    const treeWrite = api.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/git/trees"));
    expect(treeWrite?.body?.tree).toEqual([
      { path: GITHUB_LIBRARY_PATH, mode: "100644", type: "blob", sha: CREATED_LIBRARY_BLOB_SHA },
      { path: expectedPath, mode: "100644", type: "blob", sha: CREATED_MEDIA_BLOB_SHA },
    ]);
    expect(JSON.stringify(treeWrite?.body)).not.toContain("../");
  });

  it("rejects missing or truncated library trees without writes", async () => {
    const base = databaseWithGame();
    const cases = [
      { sha: TREE_SHA, truncated: true, tree: [] },
      { sha: TREE_SHA, truncated: false, tree: [] },
    ];

    for (const tree of cases) {
      const api = apiMock(base, { tree });
      await expect(client(api.fetch).publishPatch(titlePatch(base))).rejects.toMatchObject({ code: "invalid_response" });
      expect(api.requests.every((request) => request.method === "GET")).toBe(true);
    }
  });

  it("never exposes the token in API, callback, or fast-forward errors", async () => {
    const base = databaseWithGame();
    const failedFetch: GitHubFetch = async (_input, init) => {
      throw new Error(`network rejected ${new Headers(init?.headers).get("Authorization")}`);
    };
    const fetchFailure = client(failedFetch).fetchLatestLibrary().catch((reason: unknown) => reason);
    const fetchError = await fetchFailure;
    expect(fetchError).toBeInstanceOf(GitHubSyncError);
    expect(String(fetchError)).toContain("[redacted]");
    expect(String(fetchError)).not.toContain(TOKEN);

    const callbackApi = apiMock(base);
    const callbackFailure = client(callbackApi.fetch, () => { throw new Error(`bad ${TOKEN}`); })
      .publishPatch(titlePatch(base)).catch((reason: unknown) => reason);
    const callbackError = await callbackFailure;
    expect(String(callbackError)).toContain("[redacted]");
    expect(String(callbackError)).not.toContain(TOKEN);
    expect(callbackApi.requests.every((request) => request.method === "GET")).toBe(true);

    const refApi = apiMock(base, {
      onRequest: ({ method, url }) => method === "PATCH" && url.pathname === "/repos/kana/mylib/git/refs/heads/main"
        ? response({ message: `non-fast-forward ${TOKEN}` }, 422)
        : undefined,
    });
    const refError = await client(refApi.fetch).publishPatch(titlePatch(base)).catch((reason: unknown) => reason);
    expect(refError).toMatchObject({ code: "concurrent_update", status: 422 });
    expect(String(refError)).not.toContain(TOKEN);
  });

  it("confirms the new head after a lost ref-update response", async () => {
    const base = databaseWithGame();
    let refReads = 0;
    const api = apiMock(base, {
      onRequest: ({ method, url }) => {
        if (method === "GET" && url.pathname === "/repos/kana/mylib/git/ref/heads/main") {
          refReads += 1;
          if (refReads === 2) return response({
            ref: "refs/heads/main",
            object: { type: "commit", sha: CREATED_COMMIT_SHA },
          });
        }
        if (method === "PATCH" && url.pathname === "/repos/kana/mylib/git/refs/heads/main") {
          throw new Error(`Safari lost the response ${TOKEN}`);
        }
        return undefined;
      },
    });

    const result = await client(api.fetch).publishPatch(titlePatch(base));

    expect(result).toMatchObject({ status: "committed", commitSha: CREATED_COMMIT_SHA });
    expect(refReads).toBe(2);
    expect(api.requests.at(-2)?.method).toBe("PATCH");
    expect(api.requests.at(-1)?.url.pathname).toBe("/repos/kana/mylib/git/ref/heads/main");
  });

  it("keeps unrelated 422 ref validation failures as API errors", async () => {
    const base = databaseWithGame();
    const api = apiMock(base, {
      onRequest: ({ method, url }) => method === "PATCH" && url.pathname === "/repos/kana/mylib/git/refs/heads/main"
        ? response({ message: "Validation Failed", errors: [{ resource: "Reference", field: "sha", code: "invalid" }] }, 422)
        : undefined,
    });

    const error = await client(api.fetch).publishPatch(titlePatch(base)).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "api_error", status: 422, responseMessage: "Validation Failed" });
    expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    expect(api.requests.filter((request) => request.method === "GET")).toHaveLength(4);
  });
});
