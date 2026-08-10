import {
  applyPatch,
  assertValidPatch,
  canonicalStringify,
  describeAssetForRecovery,
  finalizePublishedDatabase,
  sha256Bytes,
  type LibraryDatabase,
  type PatchConflict,
  type PatchEnvelope,
  type ReconciledPatch,
} from "../domain";
import {
  parsePublishedLibraryEnvelope,
  projectSourceTree,
  validateProjectedSourceInventory,
  type ProjectedGameBundle,
  type ProjectedSourceLeaf,
  type PublishedLibraryEnvelope,
  type SourceProjection,
  type SourceTreeEntry,
} from "../source";
import { buildCommitMessage } from "../shared/commitMessage.js";

export const GITHUB_API_VERSION = "2026-03-10";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GIT_OBJECT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ASSET_ID = /^[0-9a-f]{64}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY = /^[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCESS_CHECK_BRANCH_PREFIX = "mylib-pat-check/";
const ACCESS_CHECK_COMMIT_MESSAGE = "Verify mylib GitHub access";
const LEGACY_UNAVAILABLE = "Legacy aggregate GitHub sync is unavailable";

type JsonObject = Record<string, unknown>;
type GitObjectType = "blob" | "tree" | "commit";
type FlatTreeMutation = { path: string; mode: "100644"; type: "blob"; sha: string | null };

export type GitHubFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type GitHubCommitMessage = string | ((before: LibraryDatabase, after: LibraryDatabase) => string);
export type GitHubSyncStage = "reading" | "validating" | "uploading" | "committing" | "updating";

export interface GitHubGitDatabaseSyncOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  fetch?: GitHubFetch;
  commitMessage?: GitHubCommitMessage;
  createPublicationId?: () => string;
  onStage?: (stage: GitHubSyncStage) => void;
}

export interface GitHubPublishSourceTreeOptions {
  deployed: PublishedLibraryEnvelope & { sourceCommitSha: string };
  selectedPatch: PatchEnvelope;
  localAssets: ReadonlyMap<string, Blob>;
}

export type GitHubSourceTreePublishResult =
  | {
      status: "up_to_date";
      sourceCommitSha: string;
      database: LibraryDatabase;
    }
  | {
      status: "published";
      sourceCommitSha: string;
      targetCommitSha: string;
      database: LibraryDatabase;
      uploadedLocalAssetIds: readonly string[];
      lostResponseConfirmed: boolean;
    };

export type GitHubDeploymentCommitRelation =
  | { status: "target"; currentHeadSha: string }
  | { status: "descendant"; currentHeadSha: string }
  | { status: "non_current"; currentHeadSha: string }
  | { status: "unrelated"; currentHeadSha: string };

export interface GitHubWriteAccessCheckResult {
  branch: string;
  commitSha: string;
}

export type GitHubSyncErrorCode =
  | "invalid_config"
  | "invalid_response"
  | "api_error"
  | "stale_deployment"
  | "concurrent_update";

export class GitHubSyncError extends Error {
  readonly code: GitHubSyncErrorCode;
  readonly status?: number;
  readonly responseMessage?: string;

  constructor(code: GitHubSyncErrorCode, message: string, status?: number, responseMessage?: string) {
    super(message);
    this.name = "GitHubSyncError";
    this.code = code;
    this.status = status;
    this.responseMessage = responseMessage;
  }
}

// @deprecated Temporary Task 11 compile bridge. Aggregate reads are unavailable.
export interface GitHubLibrarySnapshot {
  database: LibraryDatabase;
  headSha: string;
  treeSha: string;
  libraryBlobSha: string;
  mediaPaths: string[];
}

// @deprecated Temporary Task 11 compile bridge. Aggregate publication is unavailable.
export interface GitHubSyncResult {
  status: "committed" | "up-to-date";
  database: LibraryDatabase;
  previousHeadSha: string;
  commitSha: string;
  treeSha: string;
  mediaPaths: string[];
  reconciledPatch: PatchEnvelope;
  prunedOperationCount: number;
}

// @deprecated Temporary Task 11 shape bridge. The source-tree publisher never creates it.
export class GitHubPatchConflictError extends Error {
  readonly conflicts: PatchConflict[];
  readonly latestDatabase: LibraryDatabase;
  readonly latestSnapshot: GitHubLibrarySnapshot;
  readonly reconciliation: ReconciledPatch;

  constructor(latestSnapshot: GitHubLibrarySnapshot, reconciliation: ReconciledPatch) {
    super("Legacy aggregate GitHub conflict");
    this.name = "GitHubPatchConflictError";
    this.latestSnapshot = structuredClone(latestSnapshot);
    this.latestDatabase = structuredClone(latestSnapshot.database);
    this.reconciliation = structuredClone(reconciliation);
    this.conflicts = structuredClone(reconciliation.conflicts);
  }
}

interface ParsedGitTreeEntry {
  path: string;
  mode: string;
  type: GitObjectType;
  sha: string;
}

interface ValidatedRemoteSource {
  headSha: string;
  treeSha: string;
  projection: SourceProjection;
  blobShaByPath: ReadonlyMap<string, string>;
  blobShaByAssetId: ReadonlyMap<string, string>;
}

interface PreparedLocalAsset {
  assetId: string;
  base64: string;
}

interface PlannedDesiredLeaf {
  leaf: ProjectedSourceLeaf;
  reusedSha?: string;
  upload: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function redact(value: string, token: string): string {
  return token ? value.split(token).join("[redacted]") : value;
}

function reasonMessage(reason: unknown, token: string): string {
  if (reason instanceof Error) return redact(reason.message, token);
  return redact(String(reason), token);
}

function invalidResponse(message: string): never {
  throw new GitHubSyncError("invalid_response", message);
}

function expectObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) invalidResponse(`GitHub returned an invalid ${label}`);
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) invalidResponse(`GitHub returned an invalid ${label}`);
  return value;
}

function expectGitSha(value: unknown, label: string, expectedLength?: number): string {
  const sha = expectString(value, label);
  if (!GIT_OBJECT_SHA.test(sha) || expectedLength !== undefined && sha.length !== expectedLength) {
    invalidResponse(`GitHub returned an invalid ${label}`);
  }
  return sha;
}

function expectNonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalidResponse(`GitHub returned an invalid ${label}`);
  }
  return value as number;
}

function validateOptions(options: GitHubGitDatabaseSyncOptions): void {
  if (!OWNER.test(options.owner)) throw new GitHubSyncError("invalid_config", "GitHub owner is invalid");
  if (!REPOSITORY.test(options.repo) || options.repo === "." || options.repo === "..") {
    throw new GitHubSyncError("invalid_config", "GitHub repository is invalid");
  }
  if (
    !BRANCH.test(options.branch)
    || options.branch.startsWith("/")
    || options.branch.endsWith("/")
    || options.branch.includes("//")
    || options.branch.includes("..")
    || options.branch.endsWith(".")
    || options.branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) throw new GitHubSyncError("invalid_config", "GitHub branch is invalid");
  if (!options.token.trim()) throw new GitHubSyncError("invalid_config", "GitHub token is required");
  if (options.fetch !== undefined && typeof options.fetch !== "function") {
    throw new GitHubSyncError("invalid_config", "GitHub fetch implementation is invalid");
  }
  if (options.onStage !== undefined && typeof options.onStage !== "function") {
    throw new GitHubSyncError("invalid_config", "GitHub stage callback is invalid");
  }
  if (
    options.createPublicationId !== undefined
    && typeof options.createPublicationId !== "function"
  ) throw new GitHubSyncError("invalid_config", "Publication id generator is invalid");
  if (
    options.commitMessage !== undefined
    && typeof options.commitMessage !== "function"
    && typeof options.commitMessage !== "string"
  ) throw new GitHubSyncError("invalid_config", "GitHub commit message is invalid");
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function assertSafeRepositoryPath(path: string, diagnosticPath = path): void {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    invalidResponse(`GitHub tree contains an unsafe path: ${diagnosticPath}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    invalidResponse(`GitHub tree contains an unsafe path: ${diagnosticPath}`);
  }
}

function isValidGitTreeTuple(mode: string, type: GitObjectType): boolean {
  return (mode === "040000" && type === "tree")
    || (mode === "100644" || mode === "100755" || mode === "120000") && type === "blob"
    || (mode === "160000" && type === "commit");
}

function isReferenceUpdateRace(reason: GitHubSyncError): boolean {
  if (reason.status === 409) return true;
  if (reason.status !== 422 || reason.responseMessage === undefined) return false;
  return /(?:non[- ]fast[- ]forward|not (?:a )?fast[- ]forward|reference (?:was )?(?:updated|changed|moved)|ref(?:erence)? (?:update )?(?:conflict|race))/i
    .test(reason.responseMessage);
}

function resolveCommitMessage(
  value: GitHubCommitMessage | undefined,
  before: LibraryDatabase,
  after: LibraryDatabase,
  token: string,
): string {
  let candidate: unknown;
  try {
    candidate = typeof value === "function"
      ? value(structuredClone(before), structuredClone(after))
      : value ?? buildCommitMessage(before, after).message;
  } catch (reason) {
    throw new GitHubSyncError(
      "invalid_config",
      `GitHub commit message builder failed: ${reasonMessage(reason, token)}`,
    );
  }
  if (typeof candidate !== "string") {
    throw new GitHubSyncError("invalid_config", "GitHub commit message is invalid");
  }
  const message = candidate.trim();
  if (!message || message.length > 65_536 || message.includes("\u0000")) {
    throw new GitHubSyncError("invalid_config", "GitHub commit message is invalid");
  }
  if (message.includes(token)) {
    throw new GitHubSyncError("invalid_config", "GitHub commit message contains an authentication secret");
  }
  return message;
}

function bytesToCanonicalBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)),
    );
  }
  return btoa(binary);
}

function comparableBundle(bundle: ProjectedGameBundle | undefined): unknown {
  if (!bundle) return null;
  return {
    gameId: bundle.gameId,
    directoryPath: bundle.directoryPath,
    leaves: bundle.leaves,
    assetOccurrences: bundle.assetOccurrences,
  };
}

function affectedGameIds(before: SourceProjection, after: SourceProjection): string[] {
  const ids = new Set([...before.gameBundles.keys(), ...after.gameBundles.keys()]);
  return [...ids].sort().filter((id) => (
    canonicalStringify(comparableBundle(before.gameBundles.get(id)))
    !== canonicalStringify(comparableBundle(after.gameBundles.get(id)))
  ));
}

function leafContentIsEqual(left: ProjectedSourceLeaf, right: ProjectedSourceLeaf): boolean {
  if (left.kind !== right.kind || left.logicalId !== right.logicalId) return false;
  if (left.kind === "text" && right.kind === "text") return left.text === right.text;
  return left.kind === "binary"
    && right.kind === "binary"
    && left.assetId === right.assetId
    && left.byteLength === right.byteLength;
}

function manifestLeaf(projection: SourceProjection): ProjectedSourceLeaf {
  const leaves = projection.leaves.filter((leaf) => leaf.logicalId === "manifest");
  if (leaves.length !== 1 || leaves[0].kind !== "text") {
    invalidResponse("Source projection did not contain exactly one manifest");
  }
  return leaves[0];
}

function selectedLeaves(projection: SourceProjection, gameIds: readonly string[]): ProjectedSourceLeaf[] {
  const leaves = [manifestLeaf(projection)];
  for (const gameId of gameIds) {
    const bundle = projection.gameBundles.get(gameId);
    if (bundle) leaves.push(...bundle.leaves);
  }
  return leaves;
}

function mapUniqueByPath(leaves: readonly ProjectedSourceLeaf[]): Map<string, ProjectedSourceLeaf> {
  const result = new Map<string, ProjectedSourceLeaf>();
  for (const leaf of leaves) {
    if (result.has(leaf.path)) invalidResponse(`Duplicate projected source path ${leaf.path}`);
    result.set(leaf.path, leaf);
  }
  return result;
}

function mapUniqueByLogicalId(leaves: readonly ProjectedSourceLeaf[]): Map<string, ProjectedSourceLeaf> {
  const result = new Map<string, ProjectedSourceLeaf>();
  for (const leaf of leaves) {
    if (result.has(leaf.logicalId)) invalidResponse(`Duplicate projected logical leaf ${leaf.logicalId}`);
    result.set(leaf.logicalId, leaf);
  }
  return result;
}

function assertFlatLeafMutations(entries: readonly FlatTreeMutation[]): void {
  const paths = new Set<string>();
  for (const entry of entries) {
    assertSafeRepositoryPath(entry.path);
    if (!entry.path.startsWith("data/") || entry.path.endsWith("/")) {
      invalidResponse(`Source mutation is outside the data leaf allowlist: ${entry.path}`);
    }
    if (paths.has(entry.path)) invalidResponse(`Duplicate source mutation path ${entry.path}`);
    paths.add(entry.path);
  }
  const sorted = [...paths].sort();
  for (let index = 0; index < sorted.length; index += 1) {
    for (let other = index + 1; other < sorted.length; other += 1) {
      if (sorted[other].startsWith(`${sorted[index]}/`)) {
        invalidResponse("Git tree mutation contains ancestor and descendant entries");
      }
    }
  }
}

function validatePublishInput(value: unknown): {
  deployed: PublishedLibraryEnvelope & { sourceCommitSha: string };
  selectedPatch: PatchEnvelope;
  localAssets: Map<string, Blob>;
} {
  if (!isObject(value) || !hasExactKeys(value, ["deployed", "selectedPatch", "localAssets"])) {
    invalidResponse("GitHub source publication options are invalid");
  }
  let deployed: PublishedLibraryEnvelope;
  try {
    deployed = parsePublishedLibraryEnvelope(value.deployed);
  } catch (reason) {
    invalidResponse(`Deployed source envelope is invalid: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  if (deployed.sourceCommitSha === null) {
    invalidResponse("Deployed source commit SHA is required for GitHub publication");
  }
  try {
    assertValidPatch(value.selectedPatch);
  } catch (reason) {
    invalidResponse(`Selected patch is invalid: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  if (!(value.localAssets instanceof Map)) {
    invalidResponse("Local assets must be a Blob map");
  }
  const localAssets = new Map<string, Blob>();
  for (const [assetId, blob] of value.localAssets.entries()) {
    if (typeof assetId !== "string" || !ASSET_ID.test(assetId) || !(blob instanceof Blob)) {
      invalidResponse("Local assets contain an invalid SHA or Blob");
    }
    localAssets.set(assetId, blob);
  }
  return {
    deployed: {
      sourceCommitSha: deployed.sourceCommitSha,
      database: deployed.database,
    },
    selectedPatch: structuredClone(value.selectedPatch),
    localAssets,
  };
}

export class GitHubGitDatabaseSyncClient {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;

  private readonly token: string;
  private readonly fetchImplementation: GitHubFetch;
  private readonly commitMessage?: GitHubCommitMessage;
  private readonly createPublicationId: () => string;
  private readonly onStage?: (stage: GitHubSyncStage) => void;
  private readonly repositoryPath: string;

  constructor(options: GitHubGitDatabaseSyncOptions) {
    validateOptions(options);
    this.owner = options.owner;
    this.repo = options.repo;
    this.branch = options.branch;
    this.token = options.token;
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.commitMessage = options.commitMessage;
    this.createPublicationId = options.createPublicationId ?? (() => globalThis.crypto.randomUUID());
    this.onStage = options.onStage;
    this.repositoryPath = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  private stage(stage: GitHubSyncStage): void {
    try {
      this.onStage?.(stage);
    } catch (reason) {
      throw new GitHubSyncError(
        "invalid_config",
        `GitHub sync stage callback failed: ${reasonMessage(reason, this.token)}`,
      );
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const method = (init.method ?? "GET").toUpperCase();
    const isGet = method === "GET";
    let response: Response;
    try {
      response = await this.fetchImplementation(`${GITHUB_API_ORIGIN}${path}`, {
        ...init,
        cache: isGet ? "no-store" : init.cache,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          ...init.headers,
        },
      });
    } catch (reason) {
      throw new GitHubSyncError(
        "api_error",
        `GitHub API ${method} request failed: ${reasonMessage(reason, this.token)}`,
      );
    }

    let payload: unknown = null;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) {
        throw new GitHubSyncError(
          "invalid_response",
          `GitHub API ${method} returned invalid JSON`,
          response.status,
        );
      }
    }

    if (!response.ok) {
      const responseMessage = isObject(payload) && typeof payload.message === "string"
        ? redact(payload.message, this.token)
        : undefined;
      const remoteMessage = responseMessage === undefined ? "" : `: ${responseMessage}`;
      throw new GitHubSyncError(
        "api_error",
        `GitHub API ${method} failed with HTTP ${response.status}${remoteMessage}`,
        response.status,
        responseMessage,
      );
    }
    return payload;
  }

  private async fetchHeadSha(branch = this.branch, expectedLength?: number): Promise<string> {
    const reference = expectObject(
      await this.request(`${this.repositoryPath}/git/ref/${encodePath(`heads/${branch}`)}`),
      "branch reference",
    );
    const referenceObject = expectObject(reference.object, "branch reference object");
    if (referenceObject.type !== "commit") invalidResponse("GitHub branch does not point to a commit");
    return expectGitSha(referenceObject.sha, "branch commit SHA", expectedLength);
  }

  private createAccessCheckBranch(): string {
    let identifier: unknown;
    try {
      identifier = globalThis.crypto.randomUUID();
    } catch (reason) {
      throw new GitHubSyncError(
        "invalid_config",
        `Temporary branch id generator failed: ${reasonMessage(reason, this.token)}`,
      );
    }
    if (typeof identifier !== "string" || !UUID.test(identifier.toLowerCase())) {
      throw new GitHubSyncError("invalid_config", "Temporary branch id generator returned an invalid UUID");
    }
    const branch = `${ACCESS_CHECK_BRANCH_PREFIX}${identifier.toLowerCase()}`;
    if (branch === "main" || branch === this.branch) {
      throw new GitHubSyncError(
        "invalid_config",
        "Temporary access-check branch must not be the publication branch",
      );
    }
    return branch;
  }

  async verifyWriteAccessWithTemporaryBranch(): Promise<GitHubWriteAccessCheckResult> {
    const headSha = await this.fetchHeadSha();
    const objectIdLength = headSha.length;
    const headCommit = expectObject(
      await this.request(`${this.repositoryPath}/git/commits/${headSha}`),
      "commit",
    );
    const treeSha = expectGitSha(
      expectObject(headCommit.tree, "commit tree").sha,
      "commit tree SHA",
      objectIdLength,
    );
    const branch = this.createAccessCheckBranch();
    const createdCommit = expectObject(await this.request(`${this.repositoryPath}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: ACCESS_CHECK_COMMIT_MESSAGE,
        tree: treeSha,
        parents: [headSha],
      }),
    }), "created access-check commit");
    const commitSha = expectGitSha(
      createdCommit.sha,
      "created access-check commit SHA",
      objectIdLength,
    );
    let branchCreated = false;

    try {
      await this.request(`${this.repositoryPath}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
      });
      branchCreated = true;
    } catch (reason) {
      try {
        branchCreated = await this.fetchHeadSha(branch, objectIdLength) === commitSha;
      } catch {
        // Keep the original creation failure.
      }
      if (!branchCreated) throw reason;
    }

    try {
      await this.request(
        `${this.repositoryPath}/git/refs/${encodePath(`heads/${branch}`)}`,
        { method: "DELETE" },
      );
    } catch (reason) {
      let branchMissing = false;
      try {
        await this.fetchHeadSha(branch, objectIdLength);
      } catch (checkReason) {
        branchMissing = checkReason instanceof GitHubSyncError && checkReason.status === 404;
      }
      if (!branchMissing) throw reason;
    }
    return { branch, commitSha };
  }

  // @deprecated Temporary Task 11 compile bridge.
  async fetchLatestLibrary(): Promise<GitHubLibrarySnapshot> {
    throw new GitHubSyncError("invalid_config", LEGACY_UNAVAILABLE);
  }

  // @deprecated Temporary Task 11 compile bridge.
  async publishPatch(
    _patch: PatchEnvelope,
    _localMedia: Record<string, Blob> = {},
  ): Promise<GitHubSyncResult> {
    throw new GitHubSyncError("invalid_config", LEGACY_UNAVAILABLE);
  }

  private parseRecursiveTree(
    value: unknown,
    treeSha: string,
    objectIdLength: number,
  ): { entries: ParsedGitTreeEntry[]; sourceEntries: SourceTreeEntry[] } {
    const tree = expectObject(value, "recursive tree");
    if (expectGitSha(tree.sha, "recursive tree SHA", objectIdLength) !== treeSha) {
      invalidResponse("GitHub returned a recursive tree for a different object");
    }
    if (tree.truncated !== false || !Array.isArray(tree.tree)) {
      invalidResponse("GitHub repository tree is truncated or malformed");
    }
    const entries: ParsedGitTreeEntry[] = [];
    const exactPaths = new Set<string>();
    const casePaths = new Map<string, string>();
    for (const rawEntry of tree.tree) {
      const entry = expectObject(rawEntry, "repository tree entry");
      const path = expectString(entry.path, "repository tree path");
      const diagnosticPath = redact(path, this.token);
      assertSafeRepositoryPath(path, diagnosticPath);
      if (exactPaths.has(path)) {
        invalidResponse(`GitHub tree contains duplicate path ${diagnosticPath}`);
      }
      exactPaths.add(path);
      const caseKey = path.toLocaleLowerCase("en-US");
      const previous = casePaths.get(caseKey);
      if (previous !== undefined && previous !== path) {
        invalidResponse(
          `GitHub tree contains case-colliding paths ${redact(previous, this.token)} and ${diagnosticPath}`,
        );
      }
      casePaths.set(caseKey, path);
      const mode = expectString(entry.mode, `mode for ${diagnosticPath}`);
      const type = expectString(entry.type, `type for ${diagnosticPath}`);
      if (type !== "blob" && type !== "tree" && type !== "commit") {
        invalidResponse(`GitHub tree contains an invalid type for ${diagnosticPath}`);
      }
      if (!isValidGitTreeTuple(mode, type)) {
        invalidResponse(`GitHub tree contains an invalid mode/type for ${diagnosticPath}`);
      }
      const sha = expectGitSha(entry.sha, `object ID for ${diagnosticPath}`, objectIdLength);
      entries.push({ path, mode, type, sha });
    }

    const sourceEntries = entries
      .filter((entry) => entry.path === "data" || entry.path.startsWith("data/"))
      .map((entry): SourceTreeEntry => {
        const git = { mode: entry.mode, type: entry.type, objectId: entry.sha };
        if (entry.mode === "040000" && entry.type === "tree") {
          return { kind: "directory", path: entry.path, git };
        }
        if (entry.mode === "100644" && entry.type === "blob") {
          return { kind: "file", path: entry.path, git };
        }
        if (entry.mode === "120000" && entry.type === "blob") {
          return { kind: "symlink", path: entry.path, git };
        }
        return { kind: "unsupported", path: entry.path, git };
      });
    return { entries, sourceEntries };
  }

  private async readValidatedRemoteSource(
    deployed: PublishedLibraryEnvelope & { sourceCommitSha: string },
  ): Promise<ValidatedRemoteSource> {
    this.stage("reading");
    const objectIdLength = deployed.sourceCommitSha.length;
    const headSha = await this.fetchHeadSha(this.branch, objectIdLength);
    if (headSha !== deployed.sourceCommitSha) {
      throw new GitHubSyncError(
        "stale_deployment",
        "GitHub branch is newer than the deployed source commit",
      );
    }
    const commit = expectObject(
      await this.request(`${this.repositoryPath}/git/commits/${headSha}`),
      "matched commit",
    );
    if (expectGitSha(commit.sha, "matched commit SHA", objectIdLength) !== headSha) {
      invalidResponse("GitHub returned a different matched commit");
    }
    const treeSha = expectGitSha(
      expectObject(commit.tree, "matched commit tree").sha,
      "matched commit tree SHA",
      objectIdLength,
    );
    const recursive = await this.request(
      `${this.repositoryPath}/git/trees/${treeSha}?recursive=1`,
    );
    const { sourceEntries } = this.parseRecursiveTree(recursive, treeSha, objectIdLength);
    let projection: SourceProjection;
    let inventory: ReturnType<typeof validateProjectedSourceInventory>;
    try {
      projection = await projectSourceTree(deployed.database);
      inventory = validateProjectedSourceInventory(projection, sourceEntries);
    } catch (reason) {
      invalidResponse(
        `GitHub data/** source inventory failed validation: ${reasonMessage(reason, this.token)}`,
      );
    }
    const blobShaByAssetId = new Map<string, string>();
    for (const leaf of projection.leaves) {
      if (leaf.kind !== "binary") continue;
      const blobSha = inventory.blobShasByPath.get(leaf.path);
      if (!blobSha) invalidResponse(`Trusted Git blob is missing for ${leaf.path}`);
      const previous = blobShaByAssetId.get(leaf.assetId);
      if (previous !== undefined && previous !== blobSha) {
        invalidResponse(`Source asset ${leaf.assetId} has divergent trusted Git blobs`);
      }
      blobShaByAssetId.set(leaf.assetId, blobSha);
    }
    return {
      headSha,
      treeSha,
      projection,
      blobShaByPath: inventory.blobShasByPath,
      blobShaByAssetId,
    };
  }

  private async compareKnownHeadToTarget(
    currentHeadSha: string,
    targetCommitSha: string,
  ): Promise<"target" | "descendant" | "unrelated"> {
    if (currentHeadSha.length !== targetCommitSha.length) {
      invalidResponse("Git object ID lengths do not match");
    }
    if (currentHeadSha === targetCommitSha) return "target";
    const comparison = expectObject(
      await this.request(
        `${this.repositoryPath}/compare/${encodePath(`${targetCommitSha}...${currentHeadSha}`)}`,
      ),
      "commit comparison",
    );
    const status = expectString(comparison.status, "commit comparison status");
    const aheadBy = expectNonnegativeInteger(comparison.ahead_by, "commit comparison ahead count");
    const behindBy = expectNonnegativeInteger(comparison.behind_by, "commit comparison behind count");
    const totalCommits = expectNonnegativeInteger(
      comparison.total_commits,
      "commit comparison total commits",
    );
    const mergeBaseSha = expectGitSha(
      expectObject(comparison.merge_base_commit, "commit comparison merge base").sha,
      "commit comparison merge-base SHA",
      targetCommitSha.length,
    );
    if (totalCommits !== aheadBy) {
      invalidResponse("GitHub returned inconsistent commit comparison counts");
    }

    if (status === "ahead") {
      if (
        aheadBy < 1
        || behindBy !== 0
        || mergeBaseSha !== targetCommitSha
      ) invalidResponse("GitHub returned an inconsistent ahead comparison");
      return "descendant";
    }
    if (status === "behind") {
      if (aheadBy !== 0 || behindBy < 1 || mergeBaseSha !== currentHeadSha) {
        invalidResponse("GitHub returned an inconsistent behind comparison");
      }
      return "unrelated";
    }
    if (status === "diverged") {
      if (
        aheadBy < 1
        || behindBy < 1
        || mergeBaseSha === currentHeadSha
        || mergeBaseSha === targetCommitSha
      ) {
        invalidResponse("GitHub returned an inconsistent diverged comparison");
      }
      return "unrelated";
    }
    invalidResponse("GitHub returned an unsupported commit relationship");
  }

  async classifyDeploymentCommit(
    deployedSourceCommitSha: string,
    targetCommitSha: string,
  ): Promise<GitHubDeploymentCommitRelation> {
    if (
      !GIT_OBJECT_SHA.test(deployedSourceCommitSha)
      || !GIT_OBJECT_SHA.test(targetCommitSha)
      || deployedSourceCommitSha.length !== targetCommitSha.length
    ) invalidResponse("Deployment commit IDs are invalid or use mixed lengths");
    const currentHeadSha = await this.fetchHeadSha(
      this.branch,
      deployedSourceCommitSha.length,
    );
    if (currentHeadSha !== deployedSourceCommitSha) {
      return { status: "non_current", currentHeadSha };
    }
    const relation = await this.compareKnownHeadToTarget(currentHeadSha, targetCommitSha);
    if (relation === "target") return { status: "target", currentHeadSha };
    if (relation === "descendant") return { status: "descendant", currentHeadSha };
    return { status: "unrelated", currentHeadSha };
  }

  private createFinalPublicationId(currentPublicationId: string | null): string {
    let publicationId: unknown;
    try {
      publicationId = this.createPublicationId();
    } catch (reason) {
      throw new GitHubSyncError(
        "invalid_config",
        `Publication id generator failed: ${reasonMessage(reason, this.token)}`,
      );
    }
    if (
      typeof publicationId !== "string"
      || !UUID.test(publicationId)
      || publicationId === currentPublicationId
    ) {
      throw new GitHubSyncError(
        "invalid_config",
        "Publication id generator returned a non-fresh canonical UUID",
      );
    }
    return publicationId;
  }

  private async prepareNewLocalAssets(
    targetDatabase: LibraryDatabase,
    desiredLeaves: readonly ProjectedSourceLeaf[],
    trustedAssetShas: ReadonlyMap<string, string>,
    localAssets: ReadonlyMap<string, Blob>,
  ): Promise<PreparedLocalAsset[]> {
    const newAssetIds = [...new Set(
      desiredLeaves.flatMap((leaf) => (
        leaf.kind === "binary" && !trustedAssetShas.has(leaf.assetId)
          ? [leaf.assetId]
          : []
      )),
    )].sort();
    const prepared: PreparedLocalAsset[] = [];
    for (const assetId of newAssetIds) {
      const asset = targetDatabase.assets[assetId];
      if (!asset) invalidResponse(`Projected local asset ${assetId} is missing from the target database`);
      const blob = localAssets.get(assetId);
      const description = redact(
        describeAssetForRecovery(targetDatabase, assetId),
        this.token,
      );
      if (!blob) {
        invalidResponse(`Local bytes are missing for ${description}`);
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await blob.arrayBuffer());
      } catch (reason) {
        invalidResponse(
          `Local bytes are unreadable for ${description}: ${reasonMessage(reason, this.token)}`,
        );
      }
      if (bytes.byteLength !== asset.byteLength || sha256Bytes(bytes) !== assetId) {
        invalidResponse(`Local bytes do not match target metadata for ${description}`);
      }
      prepared.push({ assetId, base64: bytesToCanonicalBase64(bytes) });
    }
    return prepared;
  }

  async publishSourceTree(options: GitHubPublishSourceTreeOptions): Promise<GitHubSourceTreePublishResult> {
    const input = validatePublishInput(options);
    const remote = await this.readValidatedRemoteSource(input.deployed);
    this.stage("validating");

    let selectedDatabase: LibraryDatabase;
    let selectedProjection: SourceProjection;
    try {
      selectedDatabase = applyPatch(input.deployed.database, input.selectedPatch);
      selectedProjection = await projectSourceTree(selectedDatabase);
      selectedDatabase = selectedProjection.database;
    } catch (reason) {
      invalidResponse(
        `Selected patch cannot be projected: ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      );
    }
    const affected = affectedGameIds(remote.projection, selectedProjection);
    if (affected.length === 0) {
      return {
        status: "up_to_date",
        sourceCommitSha: remote.headSha,
        database: structuredClone(selectedDatabase),
      };
    }

    const publicationId = this.createFinalPublicationId(selectedDatabase.publicationId);
    let finalProjection: SourceProjection;
    try {
      finalProjection = await projectSourceTree(
        finalizePublishedDatabase(selectedDatabase, publicationId),
      );
    } catch (reason) {
      invalidResponse(
        `Final publication cannot be projected: ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      );
    }
    const finalDatabase = finalProjection.database;
    const commitMessage = resolveCommitMessage(
      this.commitMessage,
      input.deployed.database,
      finalDatabase,
      this.token,
    );

    const oldLeaves = selectedLeaves(remote.projection, affected);
    const desiredLeaves = selectedLeaves(finalProjection, affected);
    const oldByPath = mapUniqueByPath(oldLeaves);
    const oldByLogicalId = mapUniqueByLogicalId(oldLeaves);
    const desiredByPath = mapUniqueByPath(desiredLeaves);
    const preparedLocalAssets = await this.prepareNewLocalAssets(
      finalDatabase,
      desiredLeaves,
      remote.blobShaByAssetId,
      input.localAssets,
    );

    const planned: PlannedDesiredLeaf[] = desiredLeaves
      .slice()
      .sort((left, right) => compareText(left.path, right.path))
      .map((leaf) => {
        const samePath = oldByPath.get(leaf.path);
        if (samePath && leafContentIsEqual(samePath, leaf)) {
          return {
            leaf,
            reusedSha: remote.blobShaByPath.get(samePath.path),
            upload: false,
          };
        }
        const sameLogicalLeaf = oldByLogicalId.get(leaf.logicalId);
        if (sameLogicalLeaf && leafContentIsEqual(sameLogicalLeaf, leaf)) {
          const reusedSha = remote.blobShaByPath.get(sameLogicalLeaf.path);
          if (!reusedSha) invalidResponse(`Trusted Git blob is missing for ${sameLogicalLeaf.path}`);
          return { leaf, reusedSha, upload: false };
        }
        if (leaf.kind === "binary") {
          const reusedSha = remote.blobShaByAssetId.get(leaf.assetId);
          return reusedSha
            ? { leaf, reusedSha, upload: false }
            : { leaf, upload: true };
        }
        return { leaf, upload: true };
      });

    const uploadedBinaryShas = new Map<string, string>();
    const uploadedTextShas = new Map<string, string>();
    this.stage("uploading");
    for (const asset of preparedLocalAssets) {
      const created = expectObject(await this.request(`${this.repositoryPath}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: asset.base64, encoding: "base64" }),
      }), "created source asset blob");
      uploadedBinaryShas.set(
        asset.assetId,
        expectGitSha(
          created.sha,
          "created source asset blob SHA",
          remote.headSha.length,
        ),
      );
    }
    for (const item of planned) {
      if (!item.upload || item.leaf.kind !== "text") continue;
      const created = expectObject(await this.request(`${this.repositoryPath}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: item.leaf.text, encoding: "utf-8" }),
      }), "created source text blob");
      uploadedTextShas.set(
        item.leaf.path,
        expectGitSha(
          created.sha,
          "created source text blob SHA",
          remote.headSha.length,
        ),
      );
    }

    const mutationByPath = new Map<string, FlatTreeMutation>();
    for (const item of planned) {
      const samePath = oldByPath.get(item.leaf.path);
      if (samePath && leafContentIsEqual(samePath, item.leaf)) continue;
      const sha = item.reusedSha
        ?? (item.leaf.kind === "binary"
          ? uploadedBinaryShas.get(item.leaf.assetId)
          : uploadedTextShas.get(item.leaf.path));
      if (!sha) invalidResponse(`No Git blob was resolved for ${item.leaf.path}`);
      mutationByPath.set(item.leaf.path, {
        path: item.leaf.path,
        mode: "100644",
        type: "blob",
        sha,
      });
    }
    for (const oldLeaf of oldLeaves) {
      if (!desiredByPath.has(oldLeaf.path)) {
        mutationByPath.set(oldLeaf.path, {
          path: oldLeaf.path,
          mode: "100644",
          type: "blob",
          sha: null,
        });
      }
    }
    const treeMutations = [...mutationByPath.values()]
      .sort((left, right) => compareText(left.path, right.path));
    assertFlatLeafMutations(treeMutations);
    if (treeMutations.length === 0) {
      invalidResponse("A nonempty semantic publication produced no source mutations");
    }

    this.stage("committing");
    const createdTree = expectObject(await this.request(`${this.repositoryPath}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: remote.treeSha, tree: treeMutations }),
    }), "created source tree");
    const targetTreeSha = expectGitSha(
      createdTree.sha,
      "created source tree SHA",
      remote.headSha.length,
    );
    const createdCommit = expectObject(await this.request(`${this.repositoryPath}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: targetTreeSha,
        parents: [remote.headSha],
      }),
    }), "created source commit");
    const targetCommitSha = expectGitSha(
      createdCommit.sha,
      "created source commit SHA",
      remote.headSha.length,
    );
    let lostResponseConfirmed = false;

    this.stage("updating");
    try {
      const updatedReference = expectObject(await this.request(
        `${this.repositoryPath}/git/refs/${encodePath(`heads/${this.branch}`)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: targetCommitSha, force: false }),
        },
      ), "updated branch reference");
      if (updatedReference.ref !== `refs/heads/${this.branch}`) {
        invalidResponse("GitHub returned an updated reference for a different branch");
      }
      const updatedObject = expectObject(
        updatedReference.object,
        "updated branch reference object",
      );
      if (updatedObject.type !== "commit") {
        invalidResponse("GitHub updated branch reference does not point to a commit");
      }
      if (
        expectGitSha(
          updatedObject.sha,
          "updated branch commit SHA",
          targetCommitSha.length,
        ) !== targetCommitSha
      ) {
        invalidResponse("GitHub updated branch reference points to a different commit");
      }
    } catch (reason) {
      if (reason instanceof GitHubSyncError && isReferenceUpdateRace(reason)) {
        throw new GitHubSyncError(
          "concurrent_update",
          "GitHub branch rejected the non-force update",
          reason.status,
        );
      }
      if (
        reason instanceof GitHubSyncError
        && reason.code === "api_error"
        && reason.status === undefined
      ) {
        try {
          const currentHeadSha = await this.fetchHeadSha(
            this.branch,
            targetCommitSha.length,
          );
          const relation = await this.compareKnownHeadToTarget(
            currentHeadSha,
            targetCommitSha,
          );
          if (relation === "target" || relation === "descendant") {
            lostResponseConfirmed = true;
          } else {
            throw reason;
          }
        } catch {
          throw reason;
        }
      } else {
        throw reason;
      }
    }

    return {
      status: "published",
      sourceCommitSha: remote.headSha,
      targetCommitSha,
      database: structuredClone(finalDatabase),
      uploadedLocalAssetIds: preparedLocalAssets.map((asset) => asset.assetId),
      lostResponseConfirmed,
    };
  }
}
