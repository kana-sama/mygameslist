import {
  applyPatch,
  assertValidPatch,
  assertValidPublishedLibrary,
  base64ToBytes,
  describeAssetForRecovery,
  diffLibrary,
  finalizePublishedDatabase,
  garbageCollectUnreferencedAssets,
  isCanonicalBase64,
  reconcilePatch,
  sha256Bytes,
  type Asset,
  type LibraryDatabase,
  type PatchConflict,
  type PatchEnvelope,
  type ReconciledPatch,
} from "../domain";
import { buildCommitMessage } from "../shared/commitMessage.js";

export const GITHUB_API_VERSION = "2026-03-10";
export const GITHUB_LIBRARY_PATH = "public/data/library.json";
export const GITHUB_MEDIA_PATH = /^public\/media\/[0-9a-f]{64}\.(?:webp|mp4|bin)$/;

const GITHUB_API_ORIGIN = "https://api.github.com";
const GIT_OBJECT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ASSET_ID = /^[0-9a-f]{64}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY = /^[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;
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

export interface GitHubLibrarySnapshot {
  database: LibraryDatabase;
  headSha: string;
  treeSha: string;
  libraryBlobSha: string;
  mediaPaths: string[];
}

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

export type GitHubSyncErrorCode =
  | "invalid_config"
  | "invalid_response"
  | "api_error"
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

export class GitHubPatchConflictError extends Error {
  readonly conflicts: PatchConflict[];
  readonly latestDatabase: LibraryDatabase;
  readonly latestSnapshot: GitHubLibrarySnapshot;
  readonly reconciliation: ReconciledPatch;

  constructor(latestSnapshot: GitHubLibrarySnapshot, reconciliation: ReconciledPatch) {
    super("GitHub library and local patch change the same fields");
    this.name = "GitHubPatchConflictError";
    this.latestSnapshot = structuredClone(latestSnapshot);
    this.latestDatabase = structuredClone(latestSnapshot.database);
    this.reconciliation = structuredClone(reconciliation);
    this.conflicts = structuredClone(reconciliation.conflicts);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(value: string, token: string): string {
  return token ? value.split(token).join("[redacted]") : value;
}

function reasonMessage(reason: unknown, token: string): string {
  if (reason instanceof Error) return redact(reason.message, token);
  return redact(String(reason), token);
}

function isReferenceUpdateRace(reason: GitHubSyncError): boolean {
  if (reason.status === 409) return true;
  if (reason.status !== 422 || reason.responseMessage === undefined) return false;
  return /(?:non[- ]fast[- ]forward|not (?:a )?fast[- ]forward|reference (?:was )?(?:updated|changed|moved)|ref(?:erence)? (?:update )?(?:conflict|race))/i
    .test(reason.responseMessage);
}

function expectObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new GitHubSyncError("invalid_response", `GitHub returned an invalid ${label}`);
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new GitHubSyncError("invalid_response", `GitHub returned an invalid ${label}`);
  return value;
}

function expectGitSha(value: unknown, label: string): string {
  const sha = expectString(value, label);
  if (!GIT_OBJECT_SHA.test(sha)) throw new GitHubSyncError("invalid_response", `GitHub returned an invalid ${label}`);
  return sha;
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
  if (options.fetch !== undefined && typeof options.fetch !== "function") throw new GitHubSyncError("invalid_config", "GitHub fetch implementation is invalid");
  if (options.onStage !== undefined && typeof options.onStage !== "function") throw new GitHubSyncError("invalid_config", "GitHub stage callback is invalid");
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function decodeGitHubBase64(value: string): Uint8Array {
  const canonical = value.replace(/[\t\n\r ]/g, "");
  if (!isCanonicalBase64(canonical)) throw new GitHubSyncError("invalid_response", "GitHub library blob is not valid base64");
  return base64ToBytes(canonical);
}

function mediaPath(id: string, asset: Asset): string {
  if (!ASSET_ID.test(id) || asset.id !== id) throw new GitHubSyncError("invalid_response", "Patch contains an invalid media asset id");
  const extension = asset.kind === "image" ? "webp" : asset.mime.toLowerCase() === "video/mp4" ? "mp4" : "bin";
  const result = `public/media/${id}.${extension}`;
  if (!GITHUB_MEDIA_PATH.test(result)) throw new GitHubSyncError("invalid_response", "Patch produced a media path outside the allowlist");
  return result;
}

function assertWritablePath(value: string): void {
  if (value !== GITHUB_LIBRARY_PATH && !GITHUB_MEDIA_PATH.test(value)) {
    throw new GitHubSyncError("invalid_response", "GitHub tree contains a path outside the publication allowlist");
  }
}

function resolveCommitMessage(value: GitHubCommitMessage | undefined, before: LibraryDatabase, after: LibraryDatabase, token: string): string {
  let candidate: unknown;
  try {
    candidate = typeof value === "function"
      ? value(structuredClone(before), structuredClone(after))
      : value ?? buildCommitMessage(before, after).message;
  } catch (reason) {
    throw new GitHubSyncError("invalid_config", `GitHub commit message builder failed: ${reasonMessage(reason, token)}`);
  }
  if (typeof candidate !== "string") throw new GitHubSyncError("invalid_config", "GitHub commit message is invalid");
  const message = candidate.trim();
  if (!message || message.length > 65_536 || message.includes("\u0000")) {
    throw new GitHubSyncError("invalid_config", "GitHub commit message is invalid");
  }
  if (message.includes(token)) throw new GitHubSyncError("invalid_config", "GitHub commit message contains an authentication secret");
  return message;
}

interface MediaWrite {
  id: string;
  path: string;
  source: string | Blob;
}

function localAssetOperationIds(patch: PatchEnvelope): string[] {
  return Object.entries(patch.operations).flatMap(([path, operation]) => {
    const match = /^\/assets\/([0-9a-f]{64})$/.exec(path);
    return match && operation.operation === "set" && operation.baseExists === false ? [match[1]] : [];
  });
}

function bytesToCanonicalBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  return btoa(binary);
}

function materializeMedia(database: LibraryDatabase, patch: PatchEnvelope, localMedia: Record<string, Blob>): MediaWrite[] {
  return localAssetOperationIds(patch).sort().map((id) => {
    const asset = database.assets[id];
    if (!asset) throw new GitHubSyncError("invalid_response", "Patch blob has no matching published asset");
    const source = localMedia[id] ?? patch.blobs[id];
    if (!source) throw new GitHubSyncError("invalid_response", `В localStorage отсутствует файл для ${describeAssetForRecovery(database, id)}. Удалите указанную обложку или вложение и загрузите исходный файл заново.`);
    return { id, path: mediaPath(id, asset), source };
  });
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
    try { this.onStage?.(stage); }
    catch (reason) {
      throw new GitHubSyncError("invalid_config", `GitHub sync stage callback failed: ${reasonMessage(reason, this.token)}`);
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
      throw new GitHubSyncError("api_error", `GitHub API ${method} request failed: ${reasonMessage(reason, this.token)}`);
    }

    let payload: unknown = null;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok) throw new GitHubSyncError("invalid_response", `GitHub API ${method} returned invalid JSON`, response.status);
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

  private async fetchHeadSha(): Promise<string> {
    const ref = expectObject(await this.request(`${this.repositoryPath}/git/ref/${encodePath(`heads/${this.branch}`)}`), "branch reference");
    const refObject = expectObject(ref.object, "branch reference object");
    if (refObject.type !== "commit") throw new GitHubSyncError("invalid_response", "GitHub branch does not point to a commit");
    return expectGitSha(refObject.sha, "branch commit SHA");
  }

  async fetchLatestLibrary(): Promise<GitHubLibrarySnapshot> {
    this.stage("reading");
    const headSha = await this.fetchHeadSha();

    const commit = expectObject(await this.request(`${this.repositoryPath}/git/commits/${headSha}`), "commit");
    const treeSha = expectGitSha(expectObject(commit.tree, "commit tree").sha, "commit tree SHA");
    const tree = expectObject(await this.request(`${this.repositoryPath}/git/trees/${treeSha}?recursive=1`), "tree");
    if (tree.truncated === true) throw new GitHubSyncError("invalid_response", "GitHub repository tree is truncated");
    if (!Array.isArray(tree.tree)) throw new GitHubSyncError("invalid_response", "GitHub returned an invalid repository tree");
    const libraryEntries = tree.tree.filter((entry) => isObject(entry) && entry.path === GITHUB_LIBRARY_PATH);
    if (libraryEntries.length !== 1) throw new GitHubSyncError("invalid_response", "GitHub tree must contain exactly one library file");
    const libraryEntry = libraryEntries[0];
    if (libraryEntry.type !== "blob") throw new GitHubSyncError("invalid_response", "GitHub library path is not a blob");
    const libraryBlobSha = expectGitSha(libraryEntry.sha, "library blob SHA");
    const mediaPaths = tree.tree.flatMap((entry) => {
      if (!isObject(entry) || typeof entry.path !== "string" || !entry.path.startsWith("public/media/")) return [];
      if (!GITHUB_MEDIA_PATH.test(entry.path)) throw new GitHubSyncError("invalid_response", "GitHub media directory contains an unexpected path");
      if (entry.type !== "blob") throw new GitHubSyncError("invalid_response", "GitHub media path is not a blob");
      return [entry.path];
    });
    if (new Set(mediaPaths).size !== mediaPaths.length) throw new GitHubSyncError("invalid_response", "GitHub tree contains duplicate media paths");

    const blob = expectObject(await this.request(`${this.repositoryPath}/git/blobs/${libraryBlobSha}`), "library blob");
    if (blob.encoding !== "base64") throw new GitHubSyncError("invalid_response", "GitHub library blob is not base64 encoded");
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(decodeGitHubBase64(expectString(blob.content, "library blob content")));
    } catch (reason) {
      if (reason instanceof GitHubSyncError) throw reason;
      throw new GitHubSyncError("invalid_response", "GitHub library blob is not valid UTF-8");
    }
    let database: unknown;
    try { database = JSON.parse(source); }
    catch { throw new GitHubSyncError("invalid_response", "GitHub library blob is not valid JSON"); }
    try { assertValidPublishedLibrary(database); }
    catch { throw new GitHubSyncError("invalid_response", "GitHub library data failed validation"); }
    const publishedMedia = new Set(mediaPaths);
    if (Object.entries(database.assets).some(([id, asset]) => !publishedMedia.has(mediaPath(id, asset)))) {
      throw new GitHubSyncError("invalid_response", "GitHub library references a missing media file");
    }

    return { database: structuredClone(database), headSha, treeSha, libraryBlobSha, mediaPaths: mediaPaths.sort() };
  }

  async publishPatch(patch: PatchEnvelope, localMedia: Record<string, Blob> = {}): Promise<GitHubSyncResult> {
    const latest = await this.fetchLatestLibrary();
    this.stage("validating");
    assertValidPatch(patch);
    const reconciliation = reconcilePatch(latest.database, patch);
    if (reconciliation.conflicts.length) throw new GitHubPatchConflictError(latest, reconciliation);
    if (!Object.keys(reconciliation.patch.operations).length) {
      return {
        status: "up-to-date",
        database: latest.database,
        previousHeadSha: latest.headSha,
        commitSha: latest.headSha,
        treeSha: latest.treeSha,
        mediaPaths: [],
        reconciledPatch: reconciliation.patch,
        prunedOperationCount: reconciliation.prunedCount,
      };
    }

    const applied = applyPatch(latest.database, reconciliation.patch, { validateResult: false });
    garbageCollectUnreferencedAssets(applied);
    const normalizedPatch = diffLibrary(latest.database, applied, { previousPatch: reconciliation.patch });
    let publicationId: string;
    try { publicationId = this.createPublicationId(); }
    catch (reason) {
      throw new GitHubSyncError("invalid_config", `Publication id generator failed: ${reasonMessage(reason, this.token)}`);
    }
    if (!UUID.test(publicationId)) throw new GitHubSyncError("invalid_config", "Publication id generator returned an invalid UUID");
    const published = finalizePublishedDatabase(applied, publicationId);
    assertValidPublishedLibrary(published);
    const message = resolveCommitMessage(this.commitMessage, latest.database, published, this.token);
    const mediaWrites = materializeMedia(published, normalizedPatch, localMedia);
    const expectedMediaPaths = new Set(Object.entries(published.assets).map(([id, asset]) => mediaPath(id, asset)));
    const mediaDeletes = latest.mediaPaths.filter((path) => !expectedMediaPaths.has(path));
    const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = mediaDeletes.map((path) => ({ path, mode: "100644", type: "blob", sha: null }));

    this.stage("uploading");
    for (const media of mediaWrites) {
      assertWritablePath(media.path);
      let base64: string;
      if (typeof media.source === "string") base64 = media.source;
      else {
        const asset = published.assets[media.id];
        const description = describeAssetForRecovery(published, media.id);
        let bytes: Uint8Array;
        try { bytes = new Uint8Array(await media.source.arrayBuffer()); }
        catch (reason) {
          throw new GitHubSyncError("invalid_response", `Safari не может прочитать локальный файл ${description}. Данные в localStorage повреждены. Удалите указанную обложку или вложение и загрузите исходный файл заново. Техническая причина: ${reasonMessage(reason, this.token)}`);
        }
        if (bytes.byteLength !== asset.byteLength || sha256Bytes(bytes) !== media.id) throw new GitHubSyncError("invalid_response", `Локальный файл ${description} не совпадает с сохранёнными metadata. Удалите указанную обложку или вложение и загрузите исходный файл заново.`);
        base64 = bytesToCanonicalBase64(bytes);
      }
      const created = expectObject(await this.request(`${this.repositoryPath}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: base64, encoding: "base64" }),
      }), "created media blob");
      treeEntries.push({ path: media.path, mode: "100644", type: "blob", sha: expectGitSha(created.sha, "created media blob SHA") });
    }

    const librarySource = `${JSON.stringify(published, null, 2)}\n`;
    const libraryBlob = expectObject(await this.request(`${this.repositoryPath}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: librarySource, encoding: "utf-8" }),
    }), "created library blob");
    treeEntries.push({ path: GITHUB_LIBRARY_PATH, mode: "100644", type: "blob", sha: expectGitSha(libraryBlob.sha, "created library blob SHA") });
    treeEntries.sort((left, right) => left.path.localeCompare(right.path));
    treeEntries.forEach((entry) => assertWritablePath(entry.path));

    this.stage("committing");
    const createdTree = expectObject(await this.request(`${this.repositoryPath}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: latest.treeSha, tree: treeEntries }),
    }), "created tree");
    const createdTreeSha = expectGitSha(createdTree.sha, "created tree SHA");
    const createdCommit = expectObject(await this.request(`${this.repositoryPath}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: createdTreeSha, parents: [latest.headSha] }),
    }), "created commit");
    const commitSha = expectGitSha(createdCommit.sha, "created commit SHA");
    const result: GitHubSyncResult = {
      status: "committed",
      database: published,
      previousHeadSha: latest.headSha,
      commitSha,
      treeSha: createdTreeSha,
      mediaPaths: [...mediaWrites.map((media) => media.path), ...mediaDeletes].sort(),
      reconciledPatch: normalizedPatch,
      prunedOperationCount: reconciliation.prunedCount,
    };

    this.stage("updating");
    try {
      await this.request(`${this.repositoryPath}/git/refs/${encodePath(`heads/${this.branch}`)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commitSha, force: false }),
      });
    } catch (reason) {
      if (reason instanceof GitHubSyncError && isReferenceUpdateRace(reason)) {
        throw new GitHubSyncError("concurrent_update", "GitHub branch rejected the fast-forward update", reason.status);
      }
      if (reason instanceof GitHubSyncError && reason.code === "api_error" && reason.status === undefined) {
        try {
          if (await this.fetchHeadSha() === commitSha) return result;
        } catch { /* The original network error remains the most useful failure. */ }
      }
      throw reason;
    }

    return result;
  }
}
