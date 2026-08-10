import {
  base64ToBytes,
  computeLibraryRevision,
  diffLibrary,
  makeFileAsset,
  normalizePublishedLibrary,
  sha256Text,
  type LibraryDatabase,
  type PatchEnvelope,
} from "../src/domain";
import {
  assembleSourceTree,
  projectSourceTree,
  type SourceProjection,
  type SourceTreeEntry,
  type SourceTreeReader,
} from "../src/source";
import {
  GITHUB_API_VERSION,
  GitHubGitDatabaseSyncClient,
  GitHubPatchConflictError,
  GitHubSyncError,
  type GitHubDeploymentCommitRelation,
  type GitHubFetch,
  type GitHubPublishSourceTreeOptions,
  type GitHubSyncStage,
} from "../src/state/githubGitDatabaseSync";
import {
  FILE_BYTES,
  FILE_ID,
  FILE_PATH,
  GAME_A_DIRECTORY,
  GAME_A_ID,
  GAME_B_DIRECTORY,
  GAME_B_ID,
  IMAGE_A_PATH,
  IMAGE_B_PATH,
  IMAGE_BYTES,
  IMAGE_ID,
  NOTE_ATTACHMENTS_ID,
  NOTE_ATTACHMENTS_PATH,
  NOTE_EMPTY_ID,
  NOTE_EMPTY_PATH,
  NOTE_SHARED_ID,
  NOTE_SHARED_PATH,
  NOW,
  fixtureDatabase,
} from "./fixtures/source-tree";

const TOKEN = "github_pat_do-not-leak";
const CHANGED_AT = "2026-08-12T08:00:00.000Z";
const NEXT_PUBLICATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const API_ROOT = "https://api.github.com/repos/kana/mylib";

type ObjectIdLength = 40 | 64;

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

interface RecordedRequest {
  url: URL;
  method: string;
  cache?: RequestCache;
  headers: Headers;
  body: Record<string, unknown> | null;
}

interface RemoteRepository {
  database: LibraryDatabase;
  projection: SourceProjection;
  headSha: string;
  treeSha: string;
  targetCommitSha: string;
  targetTreeSha: string;
  entries: GitTreeEntry[];
  blobShaByPath: Map<string, string>;
  blobBytesBySha: Map<string, Uint8Array>;
  objectIdLength: ObjectIdLength;
}

interface ApiMockOptions {
  tree?: unknown;
  compare?: unknown;
  onRequest?: (request: RecordedRequest) => Response | undefined;
}

interface ApiMock {
  fetch: GitHubFetch;
  requests: RecordedRequest[];
  createdBlobBytes: Map<string, Uint8Array>;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function objectId(character: string, length: ObjectIdLength): string {
  return character.repeat(length);
}

function contentObjectId(seed: string, length: ObjectIdLength): string {
  return sha256Text(seed).slice(0, length);
}

function projectedDirectories(leaves: readonly { path: string }[]): string[] {
  const directories = new Set<string>();
  for (const leaf of leaves) {
    const parts = leaf.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return [...directories].sort();
}

async function remoteRepository(
  database: LibraryDatabase,
  options: {
    objectIdLength?: ObjectIdLength;
    assetBytes?: ReadonlyMap<string, Uint8Array>;
    unrelatedEntries?: readonly GitTreeEntry[];
  } = {},
): Promise<RemoteRepository> {
  const objectIdLength = options.objectIdLength ?? 40;
  const projection = await projectSourceTree(database);
  const assetBytes = options.assetBytes ?? new Map([
    [IMAGE_ID, IMAGE_BYTES],
    [FILE_ID, FILE_BYTES],
  ]);
  const blobShaByPath = new Map<string, string>();
  const blobBytesBySha = new Map<string, Uint8Array>();
  const fileEntries = projection.leaves.map((leaf): GitTreeEntry => {
    const blobSha = leaf.kind === "binary"
      ? contentObjectId(`asset:${leaf.assetId}`, objectIdLength)
      : contentObjectId(`text:${leaf.logicalId}:${leaf.text}`, objectIdLength);
    blobShaByPath.set(leaf.path, blobSha);
    const bytes = leaf.kind === "binary"
      ? assetBytes.get(leaf.assetId)
      : new TextEncoder().encode(leaf.text);
    if (!bytes) throw new Error(`Missing test bytes for ${leaf.assetId}`);
    const previous = blobBytesBySha.get(blobSha);
    if (previous && previous.some((value, index) => value !== bytes[index])) {
      throw new Error(`Test fixture produced a Git blob collision for ${leaf.path}`);
    }
    blobBytesBySha.set(blobSha, bytes.slice());
    return { path: leaf.path, mode: "100644", type: "blob", sha: blobSha };
  });
  const directoryEntries = projectedDirectories(projection.leaves).map((path): GitTreeEntry => ({
    path,
    mode: "040000",
    type: "tree",
    sha: contentObjectId(`directory:${path}`, objectIdLength),
  }));
  return {
    database,
    projection,
    headSha: objectId("1", objectIdLength),
    treeSha: objectId("2", objectIdLength),
    targetTreeSha: objectId("5", objectIdLength),
    targetCommitSha: objectId("6", objectIdLength),
    entries: [...directoryEntries, ...fileEntries, ...(options.unrelatedEntries ?? [])]
      .sort((left, right) => left.path.localeCompare(right.path)),
    blobShaByPath,
    blobBytesBySha,
    objectIdLength,
  };
}

function createdBlobId(body: Record<string, unknown>, length: ObjectIdLength): string {
  return contentObjectId(`created:${String(body.encoding)}:${String(body.content)}`, length);
}

function apiMock(repository: RemoteRepository, options: ApiMockOptions = {}): ApiMock {
  const requests: RecordedRequest[] = [];
  const createdBlobBytes = new Map<string, Uint8Array>();
  const fetch = vi.fn<GitHubFetch>(async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
    const request = { url, method, cache: init.cache, headers: new Headers(init.headers), body };
    requests.push(request);
    const overridden = options.onRequest?.(request);
    if (overridden) return overridden;

    if (method === "GET" && url.pathname === "/repos/kana/mylib/git/ref/heads/main") {
      return response({
        ref: "refs/heads/main",
        object: { type: "commit", sha: repository.headSha },
      });
    }
    if (method === "GET" && url.pathname === `/repos/kana/mylib/git/commits/${repository.headSha}`) {
      return response({
        sha: repository.headSha,
        tree: { sha: repository.treeSha },
      });
    }
    if (
      method === "GET"
      && url.pathname === `/repos/kana/mylib/git/trees/${repository.treeSha}`
      && url.search === "?recursive=1"
    ) {
      return response(options.tree ?? {
        sha: repository.treeSha,
        truncated: false,
        tree: repository.entries,
      });
    }
    if (method === "GET" && url.pathname.startsWith("/repos/kana/mylib/compare/")) {
      return response(options.compare ?? {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        merge_base_commit: { sha: repository.targetCommitSha },
      });
    }
    if (method === "POST" && url.pathname === "/repos/kana/mylib/git/blobs" && body) {
      const sha = createdBlobId(body, repository.objectIdLength);
      const bytes = body.encoding === "base64"
        ? base64ToBytes(String(body.content))
        : new TextEncoder().encode(String(body.content));
      createdBlobBytes.set(sha, bytes);
      return response({ sha }, 201);
    }
    if (method === "POST" && url.pathname === "/repos/kana/mylib/git/trees") {
      return response({ sha: repository.targetTreeSha }, 201);
    }
    if (method === "POST" && url.pathname === "/repos/kana/mylib/git/commits") {
      return response({ sha: repository.targetCommitSha }, 201);
    }
    if (method === "PATCH" && url.pathname === "/repos/kana/mylib/git/refs/heads/main") {
      return response({
        ref: "refs/heads/main",
        object: { type: "commit", sha: repository.targetCommitSha },
      });
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url.pathname}${url.search}`);
  });
  return { fetch, requests, createdBlobBytes };
}

function client(
  fetch: GitHubFetch,
  options: {
    commitMessage?: string | ((before: LibraryDatabase, after: LibraryDatabase) => string);
    createPublicationId?: () => string;
    onStage?: (stage: GitHubSyncStage) => void;
  } = {},
): GitHubGitDatabaseSyncClient {
  return new GitHubGitDatabaseSyncClient({
    owner: "kana",
    repo: "mylib",
    branch: "main",
    token: TOKEN,
    fetch,
    commitMessage: options.commitMessage,
    createPublicationId: options.createPublicationId ?? (() => NEXT_PUBLICATION_ID),
    onStage: options.onStage,
  });
}

function publicationOptions(
  database: LibraryDatabase,
  selectedPatch: PatchEnvelope,
  localAssets: ReadonlyMap<string, Blob> = new Map(),
  sourceCommitSha = objectId("1", 40),
): GitHubPublishSourceTreeOptions {
  return {
    deployed: { sourceCommitSha, database },
    selectedPatch,
    localAssets,
  };
}

function patchTo(
  base: LibraryDatabase,
  mutate: (database: LibraryDatabase) => void,
  transactionId = "test-change",
): PatchEnvelope {
  const current = structuredClone(base);
  mutate(current);
  return diffLibrary(base, current, { changedAt: CHANGED_AT, transactionId });
}

function titlePatch(base: LibraryDatabase, title = "Alpha Journey"): PatchEnvelope {
  return patchTo(base, (database) => {
    database.games[GAME_A_ID].title = title;
  }, "rename-game");
}

function writeRequests(requests: readonly RecordedRequest[]): RecordedRequest[] {
  return requests.filter((request) => request.method === "POST" || request.method === "PATCH" || request.method === "DELETE");
}

function blobWrites(api: ApiMock, encoding?: "base64" | "utf-8"): RecordedRequest[] {
  return api.requests.filter((request) => (
    request.method === "POST"
    && request.url.pathname === "/repos/kana/mylib/git/blobs"
    && (encoding === undefined || request.body?.encoding === encoding)
  ));
}

function treeMutationEntries(api: ApiMock): Array<{
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}> {
  const request = api.requests.find((candidate) => (
    candidate.method === "POST"
    && candidate.url.pathname === "/repos/kana/mylib/git/trees"
  ));
  if (!request || !Array.isArray(request.body?.tree)) throw new Error("Missing created tree request");
  return request.body.tree as Array<{ path: string; mode: string; type: string; sha: string | null }>;
}

function entryMap(api: ApiMock): Map<string, {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}> {
  return new Map(treeMutationEntries(api).map((entry) => [entry.path, entry]));
}

function sourceTreeReaderAfterPublication(repository: RemoteRepository, api: ApiMock): SourceTreeReader {
  const files = new Map(
    repository.projection.leaves.map((leaf) => [
      leaf.path,
      repository.blobShaByPath.get(leaf.path)!,
    ]),
  );
  for (const entry of treeMutationEntries(api)) {
    if (entry.sha === null) files.delete(entry.path);
    else files.set(entry.path, entry.sha);
  }
  const leaves = [...files.keys()].sort();
  const entries: SourceTreeEntry[] = [
    ...projectedDirectories(leaves.map((path) => ({ path })))
      .map((path): SourceTreeEntry => ({ kind: "directory", path })),
    ...leaves.map((path): SourceTreeEntry => ({ kind: "file", path })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const bytesBySha = new Map([...repository.blobBytesBySha, ...api.createdBlobBytes]);
  return {
    async listEntries() {
      return entries;
    },
    async readFile(path: string) {
      const sha = files.get(path);
      const bytes = sha ? bytesBySha.get(sha) : undefined;
      if (!bytes) throw new Error(`Missing reconstructed bytes for ${path}`);
      return bytes.slice();
    },
  };
}

async function canonicalFixture(): Promise<LibraryDatabase> {
  return normalizePublishedLibrary(fixtureDatabase());
}

describe("strict GitHub source-tree publication", () => {
  it("keeps legacy provider shims compile-only and performs zero requests", async () => {
    const fetch = vi.fn<GitHubFetch>();
    const sync = client(fetch);
    const base = await canonicalFixture();
    const patch = titlePatch(base);

    await expect(sync.fetchLatestLibrary()).rejects.toMatchObject({
      code: "invalid_config",
      message: "Legacy aggregate GitHub sync is unavailable",
    });
    await expect(sync.publishPatch(patch, {})).rejects.toMatchObject({
      code: "invalid_config",
      message: "Legacy aggregate GitHub sync is unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(GitHubPatchConflictError).toBeTypeOf("function");
  });

  it("rejects invalid configuration before making a request", () => {
    const fetch = vi.fn<GitHubFetch>();
    expect(() => new GitHubGitDatabaseSyncClient({
      owner: "bad owner",
      repo: "mylib",
      branch: "main",
      token: TOKEN,
      fetch,
    })).toThrowError(GitHubSyncError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verifies write access through a disposable branch and removes it", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository, {
      onRequest: ({ method, url, body }) => {
        if (method === "POST" && url.pathname === "/repos/kana/mylib/git/refs") {
          return response({ ref: body?.ref, object: { type: "commit", sha: body?.sha } }, 201);
        }
        if (method === "DELETE" && url.pathname.startsWith("/repos/kana/mylib/git/refs/heads/mylib-pat-check/")) {
          return new Response(null, { status: 204 });
        }
        return undefined;
      },
    });

    const result = await client(api.fetch).verifyWriteAccessWithTemporaryBranch();

    expect(result.branch).toMatch(/^mylib-pat-check\/[0-9a-f-]{36}$/);
    expect(result.branch).not.toBe("main");
    expect(result.commitSha).toBe(repository.targetCommitSha);
    expect(api.requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
      "GET /repos/kana/mylib/git/ref/heads/main",
      `GET /repos/kana/mylib/git/commits/${repository.headSha}`,
      "POST /repos/kana/mylib/git/commits",
      "POST /repos/kana/mylib/git/refs",
      `DELETE /repos/kana/mylib/git/refs/heads/${result.branch}`,
    ]);
    expect(api.requests[2].body).toEqual({
      message: "Verify mylib GitHub access",
      tree: repository.treeSha,
      parents: [repository.headSha],
    });
  });

  it("removes the temporary branch after a lost creation response", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    let temporaryBranch = "";
    let branchExists = false;
    const api = apiMock(repository, {
      onRequest: ({ method, url, body }) => {
        if (method === "POST" && url.pathname === "/repos/kana/mylib/git/refs") {
          temporaryBranch = String(body?.ref).replace(/^refs\/heads\//, "");
          branchExists = true;
          throw new Error("Safari lost branch creation response");
        }
        if (method === "GET" && temporaryBranch && url.pathname === `/repos/kana/mylib/git/ref/heads/${temporaryBranch}`) {
          return branchExists
            ? response({ object: { type: "commit", sha: repository.targetCommitSha } })
            : response({ message: "Not Found" }, 404);
        }
        if (method === "DELETE" && temporaryBranch && url.pathname === `/repos/kana/mylib/git/refs/heads/${temporaryBranch}`) {
          branchExists = false;
          return new Response(null, { status: 204 });
        }
        return undefined;
      },
    });

    await client(api.fetch).verifyWriteAccessWithTemporaryBranch();

    expect(branchExists).toBe(false);
    expect(api.requests.map(({ method }) => method)).toEqual(["GET", "GET", "POST", "POST", "GET", "DELETE"]);
  });

  it.each([40, 64] as const)("rejects a stale %s-hex HEAD before reading the tree or writing objects", async (length) => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base, { objectIdLength: length });
    repository.headSha = objectId("9", length);
    const deployedSha = objectId("1", length);
    const api = apiMock(repository);

    await expect(client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base), new Map(), deployedSha),
    )).rejects.toMatchObject({ code: "stale_deployment" });

    expect(api.requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
      "GET /repos/kana/mylib/git/ref/heads/main",
    ]);
    expect(writeRequests(api.requests)).toEqual([]);
  });

  it("validates the complete recursive data inventory before writes", async () => {
    const base = await canonicalFixture();
    const source = await remoteRepository(base);
    const manifest = source.entries.find((entry) => entry.path === "data/manifest.yaml")!;
    const dataDirectory = source.entries.find((entry) => entry.path === "data")!;
    const extraSha = objectId("a", 40);
    const cases: Array<{ name: string; tree: unknown }> = [
      {
        name: "truncated",
        tree: { sha: source.treeSha, truncated: true, tree: source.entries },
      },
      {
        name: "missing source leaf",
        tree: { sha: source.treeSha, truncated: false, tree: source.entries.filter((entry) => entry !== manifest) },
      },
      {
        name: "extra source leaf",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: [...source.entries, { path: "data/extra.txt", mode: "100644", type: "blob", sha: extraSha }],
        },
      },
      {
        name: "executable source file",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: source.entries.map((entry) => entry === manifest ? { ...entry, mode: "100755" } : entry),
        },
      },
      {
        name: "source file reported as a tree",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: source.entries.map((entry) => entry === manifest ? { ...entry, mode: "040000", type: "tree" } : entry),
        },
      },
      {
        name: "source directory reported as a blob",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: source.entries.map((entry) => entry === dataDirectory ? { ...entry, mode: "100644", type: "blob" } : entry),
        },
      },
      {
        name: "duplicate",
        tree: { sha: source.treeSha, truncated: false, tree: [...source.entries, { ...manifest }] },
      },
      {
        name: "case collision",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: [...source.entries, { ...manifest, path: "DATA/MANIFEST.YAML" }],
        },
      },
      {
        name: "unsafe path",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: [...source.entries, { path: "../README.md", mode: "100644", type: "blob", sha: extraSha }],
        },
      },
      {
        name: "mixed object id lengths",
        tree: {
          sha: source.treeSha,
          truncated: false,
          tree: source.entries.map((entry) => entry === manifest ? { ...entry, sha: objectId("a", 64) } : entry),
        },
      },
      {
        name: "malformed entry",
        tree: { sha: source.treeSha, truncated: false, tree: [...source.entries, null] },
      },
    ];

    for (const testCase of cases) {
      const repository = await remoteRepository(base);
      const api = apiMock(repository, { tree: testCase.tree });
      const error = await client(api.fetch).publishSourceTree(
        publicationOptions(base, titlePatch(base)),
      ).catch((reason: unknown) => reason);
      expect(error, testCase.name).toMatchObject({ code: "invalid_response" });
      expect(writeRequests(api.requests), testCase.name).toEqual([]);
    }
  });

  it("redacts the token from every recursive-tree path diagnostic before writes", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const maliciousPath = `secrets/${TOKEN}`;
    const blob = { path: maliciousPath, mode: "100644", type: "blob", sha: objectId("a", 40) };
    const cases: Array<{ name: string; entries: unknown[] }> = [
      {
        name: "unsafe path",
        entries: [...repository.entries, { ...blob, path: `../${TOKEN}` }],
      },
      {
        name: "duplicate path",
        entries: [...repository.entries, blob, { ...blob }],
      },
      {
        name: "case-colliding path",
        entries: [...repository.entries, blob, { ...blob, path: maliciousPath.toUpperCase() }],
      },
      {
        name: "invalid mode",
        entries: [...repository.entries, { ...blob, mode: "invalid" }],
      },
      {
        name: "invalid type",
        entries: [...repository.entries, { ...blob, type: "tag" }],
      },
      {
        name: "invalid object ID",
        entries: [...repository.entries, { ...blob, sha: "invalid" }],
      },
      {
        name: "invalid source inventory",
        entries: [...repository.entries, { ...blob, path: `data/${TOKEN}` }],
      },
    ];

    for (const testCase of cases) {
      const api = apiMock(repository, {
        tree: { sha: repository.treeSha, truncated: false, tree: testCase.entries },
      });
      const failure = await client(api.fetch).publishSourceTree(
        publicationOptions(base, titlePatch(base)),
      ).catch((reason: unknown) => reason);

      expect(failure, testCase.name).toMatchObject({ code: "invalid_response" });
      expect(String(failure), testCase.name).toContain("[redacted]");
      expect(String(failure), testCase.name).not.toContain(TOKEN);
      expect(writeRequests(api.requests), testCase.name).toEqual([]);
    }
  });

  it("preserves unrelated repository leaves without interpreting or rewriting them", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base, {
      unrelatedEntries: [
        { path: "README.md", mode: "100755", type: "blob", sha: objectId("a", 40) },
        { path: "scripts", mode: "040000", type: "tree", sha: objectId("b", 40) },
        { path: "scripts/tool.sh", mode: "100755", type: "blob", sha: objectId("c", 40) },
        { path: "latest", mode: "120000", type: "blob", sha: objectId("d", 40) },
        { path: "vendor/module", mode: "160000", type: "commit", sha: objectId("e", 40) },
      ],
    });
    const api = apiMock(repository);

    await client(api.fetch).publishSourceTree(publicationOptions(base, titlePatch(base)));

    expect(treeMutationEntries(api).some((entry) => !entry.path.startsWith("data/"))).toBe(false);
    const treeRequest = api.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/git/trees"));
    expect(treeRequest?.body?.base_tree).toBe(repository.treeSha);
  });

  it.each([
    { mode: "040000", type: "blob" },
    { mode: "000000", type: "blob" },
  ])("rejects an impossible unrelated Git tuple $mode/$type before writes", async ({ mode, type }) => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base, {
      unrelatedEntries: [
        { path: "README.md", mode, type, sha: objectId("a", 40) },
      ],
    });
    const api = apiMock(repository);

    await expect(client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base)),
    )).rejects.toMatchObject({ code: "invalid_response" });
    expect(writeRequests(api.requests)).toEqual([]);
  });

  it("returns a semantic no-op before UUID, messages, Blob reads, or writes", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const createPublicationId = vi.fn(() => NEXT_PUBLICATION_ID);
    const commitMessage = vi.fn(() => "unexpected");
    const blob = new Blob([IMAGE_BYTES]);
    const read = vi.spyOn(blob, "arrayBuffer");
    const result = await client(api.fetch, { createPublicationId, commitMessage }).publishSourceTree(
      publicationOptions(base, diffLibrary(base, base), new Map([[IMAGE_ID, blob]])),
    );

    expect(result).toEqual({
      status: "up_to_date",
      sourceCommitSha: repository.headSha,
      database: base,
    });
    expect(createPublicationId).not.toHaveBeenCalled();
    expect(commitMessage).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(writeRequests(api.requests)).toEqual([]);
  });

  it("moves an entire renamed game folder and reuses unchanged note and binary Git blobs", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const stages: GitHubSyncStage[] = [];
    const commitMessage = vi.fn((_before: LibraryDatabase, after: LibraryDatabase) => `Update ${after.games[GAME_A_ID].title}`);

    const result = await client(api.fetch, {
      commitMessage,
      onStage: (stage) => stages.push(stage),
    }).publishSourceTree(publicationOptions(base, titlePatch(base)));

    expect(result).toMatchObject({
      status: "published",
      sourceCommitSha: repository.headSha,
      targetCommitSha: repository.targetCommitSha,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    expect(result.database.games[GAME_A_ID]).toMatchObject({
      title: "Alpha Journey",
      updatedAt: CHANGED_AT,
    });
    expect(stages).toEqual(["reading", "validating", "uploading", "committing", "updating"]);
    expect(commitMessage).toHaveBeenCalledWith(base, result.database);
    expect(blobWrites(api, "base64")).toEqual([]);
    expect(blobWrites(api, "utf-8")).toHaveLength(2);

    const movedDirectory = `data/games/alpha-journey_${GAME_A_ID}`;
    const mutations = entryMap(api);
    const oldLeaves = repository.projection.gameBundles.get(GAME_A_ID)!.leaves;
    for (const leaf of oldLeaves) {
      expect(mutations.get(leaf.path)?.sha).toBeNull();
      const relative = leaf.path.slice(GAME_A_DIRECTORY.length);
      const moved = `${movedDirectory}${relative}`;
      const created = mutations.get(moved);
      expect(created).toBeDefined();
      if (leaf.logicalId.startsWith("note:") || leaf.kind === "binary") {
        expect(created?.sha).toBe(repository.blobShaByPath.get(leaf.path));
      }
    }
    expect(mutations.get("data/manifest.yaml")?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(treeMutationEntries(api).every((entry) => entry.mode === "100644" && entry.type === "blob")).toBe(true);
    const commit = api.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/git/commits"));
    expect(commit?.body).toEqual({
      message: "Update Alpha Journey",
      tree: repository.targetTreeSha,
      parents: [repository.headSha],
    });
    const ref = api.requests.find((request) => request.method === "PATCH");
    expect(ref?.body).toEqual({ sha: repository.targetCommitSha, force: false });
  });

  it("atomically replaces a body-derived note filename and uploads its changed bytes", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const patch = patchTo(base, (database) => {
      database.notes[NOTE_SHARED_ID].bodyMarkdown = "# Secret route\n\n\n";
    }, "rename-note");

    await client(api.fetch).publishSourceTree(publicationOptions(base, patch));

    const renamedPath = `${GAME_B_DIRECTORY}/notes/secret-route_${NOTE_SHARED_ID}.md`;
    const mutations = entryMap(api);
    expect(mutations.get(NOTE_SHARED_PATH)?.sha).toBeNull();
    expect(mutations.get(renamedPath)?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(mutations.get(renamedPath)?.sha).not.toBe(repository.blobShaByPath.get(NOTE_SHARED_PATH));
    expect(blobWrites(api, "base64")).toEqual([]);
    expect(blobWrites(api, "utf-8").some((request) => (
      String(request.body?.content).includes("# Secret route")
    ))).toBe(true);
  });

  it("deletes exactly a removed note and its final within-game asset leaf", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const patch = patchTo(base, (database) => {
      delete database.notes[NOTE_ATTACHMENTS_ID];
      delete database.assets[FILE_ID];
    }, "delete-note");

    const result = await client(api.fetch).publishSourceTree(publicationOptions(base, patch));

    expect(result.database.notes).not.toHaveProperty(NOTE_ATTACHMENTS_ID);
    expect(result.database.assets).not.toHaveProperty(FILE_ID);
    const deletions = treeMutationEntries(api)
      .filter((entry) => entry.sha === null)
      .map((entry) => entry.path)
      .sort();
    expect(deletions).toEqual([FILE_PATH, NOTE_ATTACHMENTS_PATH].sort());
    expect(deletions).not.toContain(IMAGE_A_PATH);
    expect(deletions).not.toContain(IMAGE_B_PATH);
    expect(deletions).not.toContain(NOTE_EMPTY_PATH);
  });

  it("deletes one game bundle without collecting another game's shared asset", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const patch = patchTo(base, (database) => {
      delete database.games[GAME_A_ID];
      delete database.notes[NOTE_EMPTY_ID];
      delete database.notes[NOTE_ATTACHMENTS_ID];
      delete database.assets[FILE_ID];
    }, "delete-game");

    const result = await client(api.fetch).publishSourceTree(publicationOptions(base, patch));

    expect(result.database.games).not.toHaveProperty(GAME_A_ID);
    expect(result.database.games).toHaveProperty(GAME_B_ID);
    expect(result.database.assets).toHaveProperty(IMAGE_ID);
    const expected = repository.projection.gameBundles.get(GAME_A_ID)!.leaves
      .map((leaf) => leaf.path)
      .sort();
    const deletions = treeMutationEntries(api)
      .filter((entry) => entry.sha === null)
      .map((entry) => entry.path)
      .sort();
    expect(deletions).toEqual(expected);
    expect(deletions).not.toContain(IMAGE_B_PATH);
    expect(treeMutationEntries(api).some((entry) => entry.path.startsWith(GAME_B_DIRECTORY))).toBe(false);
  });

  it("reuses a deployed shared asset SHA for a new owner without blob GET or POST", async () => {
    const draft = fixtureDatabase();
    delete draft.notes[NOTE_SHARED_ID];
    const base = await normalizePublishedLibrary(draft);
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const patch = patchTo(base, (database) => {
      database.notes[NOTE_SHARED_ID] = {
        id: NOTE_SHARED_ID,
        gameId: GAME_B_ID,
        bodyMarkdown: "# Shared route\n\n\n",
        attachments: [{ type: "image", assetId: IMAGE_ID, alt: "Second-game map" }],
        rank: 1024,
        createdAt: NOW,
        updatedAt: NOW,
      };
    }, "share-existing-image");

    await client(api.fetch).publishSourceTree(publicationOptions(base, patch));

    expect(entryMap(api).get(IMAGE_B_PATH)?.sha).toBe(repository.blobShaByPath.get(IMAGE_A_PATH));
    expect(blobWrites(api, "base64")).toEqual([]);
    expect(api.requests.some((request) => request.method === "GET" && request.url.pathname.includes("/git/blobs/"))).toBe(false);
  });

  it("preflights every new local byte and uploads one SHA once for multiple owner paths", async () => {
    const base = await canonicalFixture();
    const bytes = new TextEncoder().encode("shared save bytes");
    const prepared = makeFileAsset(bytes, "application/x-shared-save", "shared-save.gct");
    const patch = patchTo(base, (database) => {
      database.assets[prepared.asset.id] = prepared.asset;
      database.notes[NOTE_EMPTY_ID].attachments.push({
        type: "file",
        assetId: prepared.asset.id,
        label: "Save A",
      });
      database.notes[NOTE_SHARED_ID].attachments.push({
        type: "file",
        assetId: prepared.asset.id,
        label: "Save B",
      });
    }, "share-new-file");
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const localBlob = new Blob([bytes], { type: "image/webp" });

    const result = await client(api.fetch).publishSourceTree(
      publicationOptions(base, patch, new Map([[prepared.asset.id, localBlob]])),
    );

    expect(result.status).toBe("published");
    expect(result.uploadedLocalAssetIds).toEqual([prepared.asset.id]);
    const binaryWrites = blobWrites(api, "base64");
    expect(binaryWrites).toHaveLength(1);
    const binaryGitSha = createdBlobId(binaryWrites[0].body!, repository.objectIdLength);
    const filename = `shared-save_${prepared.asset.id}.gct`;
    expect(entryMap(api).get(`${GAME_A_DIRECTORY}/assets/${filename}`)?.sha).toBe(binaryGitSha);
    expect(entryMap(api).get(`${GAME_B_DIRECTORY}/assets/${filename}`)?.sha).toBe(binaryGitSha);
    const noteWrites = blobWrites(api, "utf-8").map((request) => String(request.body?.content));
    expect(noteWrites.some((text) => text.includes('mime: "application/x-shared-save"'))).toBe(true);
    expect(noteWrites.join("\n")).not.toContain('mime: "image/webp"');
  });

  it("fails missing, unreadable, wrong-length, and wrong-SHA local bytes before the first POST", async () => {
    const base = await canonicalFixture();
    const bytes = new TextEncoder().encode("new local save");
    const prepared = makeFileAsset(bytes, "application/octet-stream", "save.dat");
    const makePatch = (byteLength = prepared.asset.byteLength) => patchTo(base, (database) => {
      database.assets[prepared.asset.id] = { ...prepared.asset, byteLength };
      database.notes[NOTE_EMPTY_ID].attachments.push({
        type: "file",
        assetId: prepared.asset.id,
        label: "Save",
      });
    }, "new-local-save");
    const unreadable = new Blob([bytes]);
    vi.spyOn(unreadable, "arrayBuffer").mockRejectedValue(new DOMException("Not found", "NotFoundError"));
    const wrongSha = new Uint8Array(bytes.length).fill(9);
    const cases: Array<{
      name: string;
      patch: PatchEnvelope;
      localAssets: ReadonlyMap<string, Blob>;
    }> = [
      { name: "missing", patch: makePatch(), localAssets: new Map() },
      { name: "unreadable", patch: makePatch(), localAssets: new Map([[prepared.asset.id, unreadable]]) },
      { name: "wrong SHA", patch: makePatch(), localAssets: new Map([[prepared.asset.id, new Blob([wrongSha])]]) },
      { name: "wrong length", patch: makePatch(bytes.length + 1), localAssets: new Map([[prepared.asset.id, new Blob([bytes])]]) },
    ];

    for (const testCase of cases) {
      const repository = await remoteRepository(base);
      const api = apiMock(repository);
      const failure = await client(api.fetch).publishSourceTree(
        publicationOptions(base, testCase.patch, testCase.localAssets),
      ).catch((reason: unknown) => reason);
      expect(failure, testCase.name).toMatchObject({ code: "invalid_response" });
      expect(blobWrites(api), testCase.name).toEqual([]);
      expect(writeRequests(api.requests), testCase.name).toEqual([]);
    }

    const laterBytes = new TextEncoder().encode("later local save");
    const laterPrepared = makeFileAsset(laterBytes, "application/octet-stream", "later.dat");
    const [firstAsset, laterAsset] = [prepared.asset, laterPrepared.asset]
      .sort((left, right) => left.id.localeCompare(right.id));
    const firstBytes = firstAsset.id === prepared.asset.id ? bytes : laterBytes;
    const firstBlob = new Blob([firstBytes]);
    const firstRead = vi.spyOn(firstBlob, "arrayBuffer");
    const laterMissingPatch = patchTo(base, (database) => {
      database.assets[firstAsset.id] = firstAsset;
      database.assets[laterAsset.id] = laterAsset;
      database.notes[NOTE_EMPTY_ID].attachments.push(
        { type: "file", assetId: firstAsset.id, label: "First" },
        { type: "file", assetId: laterAsset.id, label: "Later" },
      );
    }, "two-new-local-saves");
    const laterRepository = await remoteRepository(base);
    const laterApi = apiMock(laterRepository);

    const laterFailure = await client(laterApi.fetch).publishSourceTree(
      publicationOptions(base, laterMissingPatch, new Map([[firstAsset.id, firstBlob]])),
    ).catch((reason: unknown) => reason);

    expect(laterFailure).toMatchObject({ code: "invalid_response" });
    expect(firstRead).toHaveBeenCalledOnce();
    expect(writeRequests(laterApi.requests)).toEqual([]);
  });

  it("rejects divergent trusted Git blobs for the same source asset SHA", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const corruptEntries = repository.entries.map((entry) => (
      entry.path === IMAGE_B_PATH
        ? { ...entry, sha: objectId("e", repository.objectIdLength) }
        : entry
    ));
    const api = apiMock(repository, {
      tree: { sha: repository.treeSha, truncated: false, tree: corruptEntries },
    });

    await expect(client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base)),
    )).rejects.toMatchObject({ code: "invalid_response" });
    expect(writeRequests(api.requests)).toEqual([]);
  });

  it.each([40, 64] as const)("publishes with uniform %s-character Git object IDs", async (length) => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base, { objectIdLength: length });
    const api = apiMock(repository);

    const result = await client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base), new Map(), repository.headSha),
    );

    expect(result).toMatchObject({
      status: "published",
      sourceCommitSha: objectId("1", length),
      targetCommitSha: objectId("6", length),
    });
    expect(treeMutationEntries(api).every((entry) => entry.sha === null || entry.sha.length === length)).toBe(true);
  });

  it("sets publication UUID before revision and committed source reassembles to the returned database", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);

    const result = await client(api.fetch).publishSourceTree(publicationOptions(base, titlePatch(base)));

    expect(result.status).toBe("published");
    expect(result.database.publicationId).toBe(NEXT_PUBLICATION_ID);
    expect(result.database.revision).toBe(computeLibraryRevision(result.database));
    const assembly = await assembleSourceTree(
      sourceTreeReaderAfterPublication(repository, api),
      { sourceCommitSha: repository.targetCommitSha },
    );
    expect(assembly.database).toEqual(result.database);
  });

  it("uses the deployed base and finalized selected target only for the commit message", async () => {
    const base = await canonicalFixture();
    const patch = patchTo(base, (database) => {
      database.games[GAME_A_ID].title = "Selected title";
    }, "selected-only");
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    const builder = vi.fn((before: LibraryDatabase, after: LibraryDatabase) => {
      expect(before).toEqual(base);
      expect(after.games[GAME_A_ID].title).toBe("Selected title");
      expect(after.games[GAME_B_ID].title).toBe(base.games[GAME_B_ID].title);
      expect(after.publicationId).toBe(NEXT_PUBLICATION_ID);
      expect(after.revision).toBe(computeLibraryRevision(after));
      return "Update selected title";
    });

    await client(api.fetch, { commitMessage: builder }).publishSourceTree(
      publicationOptions(base, patch),
    );

    expect(builder).toHaveBeenCalledTimes(1);
  });

  it("redacts request, stage, and commit-message failures", async () => {
    const base = await canonicalFixture();
    const failedFetch: GitHubFetch = async (_input, init) => {
      throw new Error(`network rejected ${new Headers(init?.headers).get("Authorization")}`);
    };
    const requestFailure = await client(failedFetch).classifyDeploymentCommit(
      objectId("1", 40),
      objectId("2", 40),
    ).catch((reason: unknown) => reason);
    expect(String(requestFailure)).toContain("[redacted]");
    expect(String(requestFailure)).not.toContain(TOKEN);

    const repository = await remoteRepository(base);
    const callbackApi = apiMock(repository);
    const callbackFailure = await client(callbackApi.fetch, {
      commitMessage: () => { throw new Error(`bad ${TOKEN}`); },
    }).publishSourceTree(publicationOptions(base, titlePatch(base))).catch((reason: unknown) => reason);
    expect(String(callbackFailure)).toContain("[redacted]");
    expect(String(callbackFailure)).not.toContain(TOKEN);
    expect(writeRequests(callbackApi.requests)).toEqual([]);

    const stageApi = apiMock(repository);
    const stageFailure = await client(stageApi.fetch, {
      onStage: () => { throw new Error(`bad stage ${TOKEN}`); },
    }).publishSourceTree(publicationOptions(base, titlePatch(base))).catch((reason: unknown) => reason);
    expect(String(stageFailure)).toContain("[redacted]");
    expect(String(stageFailure)).not.toContain(TOKEN);
    expect(writeRequests(stageApi.requests)).toEqual([]);
  });

  it("uses no-store GETs, versioned authenticated requests, and no cache headers", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);

    await client(api.fetch).publishSourceTree(publicationOptions(base, titlePatch(base)));

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
    expect(api.requests.every((request) => request.url.href.startsWith(API_ROOT))).toBe(true);
  });

  it.each([
    { name: "empty payload", payload: {} },
    {
      name: "wrong ref",
      payload: { ref: "refs/heads/other", object: { type: "commit", sha: objectId("6", 40) } },
    },
    {
      name: "wrong object type",
      payload: { ref: "refs/heads/main", object: { type: "tree", sha: objectId("6", 40) } },
    },
    {
      name: "wrong target SHA",
      payload: { ref: "refs/heads/main", object: { type: "commit", sha: objectId("7", 40) } },
    },
    {
      name: "wrong object-ID width",
      payload: { ref: "refs/heads/main", object: { type: "commit", sha: objectId("6", 64) } },
    },
  ])("rejects a successful ref update response with $name", async ({ payload }) => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository, {
      onRequest: ({ method, url }) => (
        method === "PATCH" && url.pathname.endsWith("/git/refs/heads/main")
          ? response(payload)
          : undefined
      ),
    });

    await expect(client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base)),
    )).rejects.toMatchObject({ code: "invalid_response" });
    expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    expect(api.requests.filter((request) => request.method === "GET")).toHaveLength(3);
  });

  it("maps a non-fast-forward race once and never retries", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository, {
      onRequest: ({ method, url }) => (
        method === "PATCH" && url.pathname.endsWith("/git/refs/heads/main")
          ? response({ message: `non-fast-forward ${TOKEN}` }, 422)
          : undefined
      ),
    });

    const failure = await client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base)),
    ).catch((reason: unknown) => reason);

    expect(failure).toMatchObject({ code: "concurrent_update", status: 422 });
    expect(String(failure)).not.toContain(TOKEN);
    expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    expect(api.requests.filter((request) => request.method === "GET")).toHaveLength(3);
  });

  it("keeps an unrelated HTTP 422 as an API error", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository, {
      onRequest: ({ method, url }) => (
        method === "PATCH" && url.pathname.endsWith("/git/refs/heads/main")
          ? response({ message: "Validation Failed" }, 422)
          : undefined
      ),
    });

    const failure = await client(api.fetch).publishSourceTree(
      publicationOptions(base, titlePatch(base)),
    ).catch((reason: unknown) => reason);

    expect(failure).toMatchObject({
      code: "api_error",
      status: 422,
      responseMessage: "Validation Failed",
    });
    expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
  });

  it.each([
    { name: "target", followup: "target", compare: undefined, succeeds: true },
    {
      name: "proven descendant",
      followup: "descendant",
      compare: { status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1 },
      succeeds: true,
    },
    {
      name: "unrelated",
      followup: "descendant",
      compare: { status: "diverged", ahead_by: 1, behind_by: 1, total_commits: 1 },
      succeeds: false,
    },
    {
      name: "unverifiable",
      followup: "descendant",
      compare: { status: "ahead", ahead_by: "one", behind_by: 0, total_commits: 1 },
      succeeds: false,
    },
  ])("handles a lost ref response followed by $name", async ({ followup, compare, succeeds }) => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const descendantSha = objectId("7", repository.objectIdLength);
    let refReads = 0;
    const api = apiMock(repository, {
      onRequest: ({ method, url }) => {
        if (method === "GET" && url.pathname.endsWith("/git/ref/heads/main")) {
          refReads += 1;
          if (refReads === 2) {
            return response({
              object: {
                type: "commit",
                sha: followup === "target" ? repository.targetCommitSha : descendantSha,
              },
            });
          }
        }
        if (method === "PATCH" && url.pathname.endsWith("/git/refs/heads/main")) {
          throw new Error(`Safari lost ${TOKEN}`);
        }
        if (method === "GET" && url.pathname.startsWith("/repos/kana/mylib/compare/")) {
          return response({
            ...compare,
            merge_base_commit: { sha: repository.targetCommitSha },
          });
        }
        return undefined;
      },
    });

    const promise = client(api.fetch).publishSourceTree(publicationOptions(base, titlePatch(base)));
    if (succeeds) {
      await expect(promise).resolves.toMatchObject({
        status: "published",
        lostResponseConfirmed: true,
      });
    } else {
      const failure = await promise.catch((reason: unknown) => reason);
      expect(failure).toBeInstanceOf(GitHubSyncError);
      expect(String(failure)).not.toContain(TOKEN);
    }
    expect(refReads).toBe(2);
    expect(api.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    expect(api.requests.filter((request) => request.url.pathname.startsWith("/repos/kana/mylib/compare/")))
      .toHaveLength(followup === "target" ? 0 : 1);
  });

  it("validates publication inputs and local Blob maps before network mutation", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const cases: unknown[] = [
      {
        deployed: { sourceCommitSha: "A".repeat(40), database: base },
        selectedPatch: titlePatch(base),
        localAssets: new Map(),
      },
      {
        deployed: { sourceCommitSha: repository.headSha, database: base, extra: true },
        selectedPatch: titlePatch(base),
        localAssets: new Map(),
      },
      {
        deployed: { sourceCommitSha: repository.headSha, database: base },
        selectedPatch: { ...titlePatch(base), patchVersion: 99 },
        localAssets: new Map(),
      },
      {
        deployed: { sourceCommitSha: repository.headSha, database: base },
        selectedPatch: titlePatch(base),
        localAssets: new Map([["not-a-sha", new Blob()]]),
      },
      {
        deployed: { sourceCommitSha: repository.headSha, database: base },
        selectedPatch: titlePatch(base),
        localAssets: new Map([[IMAGE_ID, "not-a-blob"]]),
      },
    ];
    for (const value of cases) {
      const api = apiMock(repository);
      await expect(client(api.fetch).publishSourceTree(
        value as GitHubPublishSourceTreeOptions,
      )).rejects.toBeInstanceOf(Error);
      expect(api.requests).toEqual([]);
    }
  });
});

describe("deployment commit classification", () => {
  async function classify(
    repository: RemoteRepository,
    deployed: string,
    target: string,
    options: ApiMockOptions = {},
  ): Promise<{ relation: GitHubDeploymentCommitRelation; api: ApiMock }> {
    const api = apiMock(repository, options);
    const relation = await client(api.fetch).classifyDeploymentCommit(deployed, target);
    return { relation, api };
  }

  it("returns target without a compare request", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const { relation, api } = await classify(repository, repository.headSha, repository.headSha);

    expect(relation).toEqual({ status: "target", currentHeadSha: repository.headSha });
    expect(api.requests).toHaveLength(1);
  });

  it("returns a strict current descendant", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const target = repository.targetCommitSha;
    const { relation, api } = await classify(repository, repository.headSha, target, {
      compare: {
        status: "ahead",
        ahead_by: 3,
        behind_by: 0,
        total_commits: 3,
        merge_base_commit: { sha: target },
      },
    });

    expect(relation).toEqual({ status: "descendant", currentHeadSha: repository.headSha });
    expect(api.requests.map(({ url }) => url.pathname)).toEqual([
      "/repos/kana/mylib/git/ref/heads/main",
      `/repos/kana/mylib/compare/${target}...${repository.headSha}`,
    ]);
  });

  it.each([
    {
      status: "behind",
      ahead_by: 0,
      behind_by: 2,
      total_commits: 0,
    },
    {
      status: "diverged",
      ahead_by: 1,
      behind_by: 1,
      total_commits: 1,
    },
  ])("returns unrelated for a valid $status relation", async (compare) => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const target = repository.targetCommitSha;
    const { relation } = await classify(repository, repository.headSha, target, {
      compare: {
        ...compare,
        merge_base_commit: {
          sha: compare.status === "behind" ? repository.headSha : objectId("a", 40),
        },
      },
    });

    expect(relation).toEqual({ status: "unrelated", currentHeadSha: repository.headSha });
  });

  it("returns non_current without compare when Pages provenance is not HEAD", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const deployed = objectId("8", 40);
    const { relation, api } = await classify(repository, deployed, repository.targetCommitSha);

    expect(relation).toEqual({ status: "non_current", currentHeadSha: repository.headSha });
    expect(api.requests).toHaveLength(1);
  });

  it("rejects invalid object IDs, mixed lengths, and malformed compare payloads", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository);
    await expect(client(api.fetch).classifyDeploymentCommit("A".repeat(40), repository.targetCommitSha))
      .rejects.toMatchObject({ code: "invalid_response" });
    await expect(client(api.fetch).classifyDeploymentCommit(repository.headSha, objectId("6", 64)))
      .rejects.toMatchObject({ code: "invalid_response" });
    expect(api.requests).toEqual([]);

    const malformedComparisons = [
      {
        status: "ahead",
        ahead_by: 1,
        behind_by: 1,
        total_commits: 1,
        merge_base_commit: { sha: repository.targetCommitSha },
      },
      {
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 2,
        merge_base_commit: { sha: repository.targetCommitSha },
      },
      {
        status: "behind",
        ahead_by: 0,
        behind_by: 1,
        total_commits: 0,
        merge_base_commit: { sha: objectId("a", 40) },
      },
      {
        status: "diverged",
        ahead_by: 1,
        behind_by: 1,
        total_commits: 1,
        merge_base_commit: { sha: repository.targetCommitSha },
      },
    ];
    for (const compare of malformedComparisons) {
      const malformed = apiMock(repository, { compare });
      await expect(client(malformed.fetch).classifyDeploymentCommit(
        repository.headSha,
        repository.targetCommitSha,
      )).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("redacts compare transport failures", async () => {
    const base = await canonicalFixture();
    const repository = await remoteRepository(base);
    const api = apiMock(repository, {
      onRequest: ({ method, url }) => {
        if (method === "GET" && url.pathname.startsWith("/repos/kana/mylib/compare/")) {
          throw new Error(`compare failed ${TOKEN}`);
        }
        return undefined;
      },
    });

    const failure = await client(api.fetch).classifyDeploymentCommit(
      repository.headSha,
      repository.targetCommitSha,
    ).catch((reason: unknown) => reason);

    expect(failure).toMatchObject({ code: "api_error" });
    expect(String(failure)).toContain("[redacted]");
    expect(String(failure)).not.toContain(TOKEN);
  });
});
