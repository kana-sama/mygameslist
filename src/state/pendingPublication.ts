import {
  PATCH_STORAGE_KEY,
  applyPatch,
  assertSourceRepresentable,
  assertValidPatch,
  assertValidPublishedLibrary,
  base64ToBytes,
  isCanonicalBase64,
  normalizeLibraryDatabase,
  patchOperationSourceIssues,
  canonicalStringify,
  reconcilePatch,
  sha256Bytes,
  storageIncreaseAllowed,
  webkitStorageBytes,
  webkitStringBytes,
  type LibraryDatabase,
  type PatchEnvelope,
} from "../domain";

/** The v3 schema intentionally reuses the historical key so legacy bytes remain recoverable. */
export const PENDING_PUBLICATION_STORAGE_KEY = "my-game-library.pending-publication.v1";
export const PENDING_PUBLICATION_INTERACTION_COMMIT_KEY = "my-game-library.pending-publication-interaction-commit.v1";

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY = /^[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const JOURNAL_KEYS = [
  "version",
  "sourceCommitSha",
  "targetCommitSha",
  "targetRevision",
  "targetDatabase",
  "remainderPatch",
  "localAssetIdsAwaitingVerification",
  "owner",
  "repo",
  "branch",
  "createdAt",
  "phase",
] as const;

type PublicationStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

interface PendingPublicationInteractionCommitV1 {
  version: 1;
  previousRaw: string | null;
  attemptedRawHash: string;
}

export type PendingPublicationLockManager = Pick<LockManager, "request">;

export const LOCAL_LIBRARY_AUTHORITY_LOCK_NAME = "my-game-library.pending-publication-journal.v3";

export interface PendingPublicationJournalV3 {
  version: 3;
  sourceCommitSha: string;
  targetCommitSha: string;
  targetRevision: string;
  targetDatabase: LibraryDatabase;
  remainderPatch: PatchEnvelope;
  localAssetIdsAwaitingVerification: readonly string[];
  owner: string;
  repo: string;
  branch: string;
  createdAt: string;
  phase: "awaiting-deployment" | "recovery-required";
}

export interface LegacyPendingPublicationRecovery {
  version: 1 | 2;
  database: LibraryDatabase;
  assetIds: readonly string[];
  owner: string;
  repo: string;
  branch: string;
  sourceRevision: string;
  commitSha: string;
  createdAt: string;
}

export type PendingPublicationJournalLoadResult =
  | { status: "absent" }
  | { status: "valid"; journal: PendingPublicationJournalV3; raw: string }
  | { status: "corrupt"; raw: string; error: Error }
  | { status: "legacy"; raw: string; recovery: LegacyPendingPublicationRecovery | null; error: Error }
  | { status: "read_failure"; error: Error };

export type InstallPendingPublicationJournalResult =
  | { status: "durable"; journal: PendingPublicationJournalV3; raw: string }
  | { status: "memory_only"; journal: PendingPublicationJournalV3; error: Error }
  | { status: "changed"; currentRaw: string | null; currentOrdinaryRaw?: string | null };

export interface InstallPendingPublicationJournalOptions {
  expectedRaw: string | null;
  expectedOrdinaryRaw?: string | null;
  recoveryBaseDatabase?: LibraryDatabase;
  lockManager?: PendingPublicationLockManager | null;
  replaceRescueLineage?: (
    previousJournalRaw: string | null,
    nextJournalRaw: string,
  ) => { status: "durable" | "absent" | "inactive" } | { status: "changed" | "failure"; error: Error };
}

export interface FinalizePendingPublicationJournalOptions {
  deployedBaseDatabase: LibraryDatabase;
  reconciledRemainderPatch: PatchEnvelope;
  expectedJournalRaw: string;
  lockManager?: PendingPublicationLockManager | null;
}

export type FinalizePendingPublicationJournalResult =
  | { status: "finalized"; patchRaw: string | null; idempotent: boolean }
  | { status: "changed"; currentRaw: string | null }
  | {
      status: "failure";
      stage: "validation" | "lock" | "journal-read" | "patch-write" | "patch-read" | "journal-remove" | "journal-remove-read";
      error: Error;
    };

export type DiscardPendingPublicationResult =
  | { status: "cleared" }
  | { status: "not_recoverable" }
  | { status: "changed"; currentRaw: string | null }
  | { status: "failure"; error: Error };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_TIMESTAMP.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertRepositoryCoordinates(owner: unknown, repo: unknown, branch: unknown): void {
  if (typeof owner !== "string" || !OWNER.test(owner)) throw new Error("Некорректный владелец репозитория");
  if (typeof repo !== "string" || !REPOSITORY.test(repo) || repo === "." || repo === "..") throw new Error("Некорректный репозиторий");
  if (
    typeof branch !== "string"
    || !BRANCH.test(branch)
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.includes("//")
    || branch.includes("..")
    || branch.endsWith(".")
    || branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) throw new Error("Некорректная ветка");
}

function assertStandalonePatchSourcePayloads(patch: PatchEnvelope): void {
  const issues = Object.entries(patch.operations).flatMap(([path, operation]) => patchOperationSourceIssues(path, operation));
  if (issues.length) throw new Error(`Патч содержит данные, не представимые в source tree: ${issues[0].path}`);
}

function assertNormalizedPublishedDatabase(database: unknown, label: string): asserts database is LibraryDatabase {
  assertValidPublishedLibrary(database);
  assertSourceRepresentable(database);
  if (canonicalStringify(database) !== canonicalStringify(normalizeLibraryDatabase(database))) {
    throw new Error(`${label} не нормализована`);
  }
}

function assertDeterministicRemainder(base: LibraryDatabase, patch: PatchEnvelope): void {
  const reconciled = reconcilePatch(base, patch);
  if (reconciled.conflicts.length !== 0 || canonicalStringify(reconciled.patch) !== canonicalStringify(patch)) {
    throw new Error("Remainder patch не совпадает с детерминированной reconciliation");
  }
}

function cloneJournal(value: PendingPublicationJournalV3): PendingPublicationJournalV3 {
  return {
    version: 3,
    sourceCommitSha: value.sourceCommitSha,
    targetCommitSha: value.targetCommitSha,
    targetRevision: value.targetRevision,
    targetDatabase: structuredClone(value.targetDatabase),
    remainderPatch: structuredClone(value.remainderPatch),
    localAssetIdsAwaitingVerification: [...value.localAssetIdsAwaitingVerification],
    owner: value.owner,
    repo: value.repo,
    branch: value.branch,
    createdAt: value.createdAt,
    phase: value.phase,
  };
}

function assertJournalValue(
  value: unknown,
  options: { recoveryBaseDatabase?: LibraryDatabase; requireRecoveryBase?: boolean } = {},
): asserts value is PendingPublicationJournalV3 {
  if (!isObject(value) || !exactKeys(value, JOURNAL_KEYS) || value.version !== 3) {
    throw new Error("Некорректная запись ожидающей публикации v3");
  }
  if (typeof value.sourceCommitSha !== "string" || !GIT_OBJECT_SHA.test(value.sourceCommitSha)) throw new Error("Некорректный source commit SHA");
  if (typeof value.targetCommitSha !== "string" || !GIT_OBJECT_SHA.test(value.targetCommitSha)) throw new Error("Некорректный target commit SHA");
  if (value.sourceCommitSha.length !== value.targetCommitSha.length) throw new Error("Git object ID имеют разную длину");
  if (typeof value.targetRevision !== "string" || !SHA256.test(value.targetRevision)) throw new Error("Некорректная target revision");
  const targetDatabase = value.targetDatabase;
  assertNormalizedPublishedDatabase(targetDatabase, "Target database");
  if (targetDatabase.publicationId === null) throw new Error("У target database отсутствует publicationId");
  if (targetDatabase.revision !== value.targetRevision) throw new Error("Target revision не совпадает с target database");
  assertValidPatch(value.remainderPatch);
  assertStandalonePatchSourcePayloads(value.remainderPatch);
  if (value.phase !== "awaiting-deployment" && value.phase !== "recovery-required") throw new Error("Некорректная фаза pending publication");

  if (value.phase === "awaiting-deployment") {
    if (value.remainderPatch.baseRevision !== value.targetRevision) throw new Error("Awaiting patch создан для другой target revision");
    assertDeterministicRemainder(targetDatabase, value.remainderPatch);
  } else {
    if (!SHA256.test(value.remainderPatch.baseRevision)) throw new Error("Recovery patch не содержит revision descendant base");
    if (options.requireRecoveryBase && options.recoveryBaseDatabase === undefined) throw new Error("Recovery install требует proven descendant base");
    if (options.recoveryBaseDatabase !== undefined) {
      assertNormalizedPublishedDatabase(options.recoveryBaseDatabase, "Recovery base database");
      if (options.recoveryBaseDatabase.revision !== value.remainderPatch.baseRevision) throw new Error("Recovery base revision не совпадает с patch base");
      assertDeterministicRemainder(options.recoveryBaseDatabase, value.remainderPatch);
    }
  }

  if (!Array.isArray(value.localAssetIdsAwaitingVerification)) throw new Error("Некорректный список asset IDs");
  const assetIds = value.localAssetIdsAwaitingVerification;
  if (assetIds.some((id) => typeof id !== "string" || !SHA256.test(id))) throw new Error("Некорректный asset ID");
  if (new Set(assetIds).size !== assetIds.length) throw new Error("Список asset IDs содержит повторы");
  if (assetIds.some((id, index) => index > 0 && assetIds[index - 1].localeCompare(id) >= 0)) throw new Error("Список asset IDs не отсортирован");
  if (assetIds.some((id) => !(id in targetDatabase.assets))) throw new Error("Awaited asset отсутствует в target database");
  assertRepositoryCoordinates(value.owner, value.repo, value.branch);
  if (!canonicalTimestamp(value.createdAt)) throw new Error("Некорректная canonical дата pending publication");
}

export function assertValidPendingPublicationJournal(value: unknown): asserts value is PendingPublicationJournalV3 {
  assertJournalValue(value);
}

function parseJournalRaw(raw: string): PendingPublicationJournalV3 {
  const parsed: unknown = JSON.parse(raw);
  assertJournalValue(parsed);
  const journal = cloneJournal(parsed);
  if (raw !== canonicalStringify(journal)) throw new Error("Pending publication journal имеет неканонические bytes");
  return journal;
}

function interactionJournalRawHash(raw: string): string {
  return sha256Bytes(new TextEncoder().encode(raw));
}

function parseInteractionCommit(raw: string): PendingPublicationInteractionCommitV1 {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || !exactKeys(value, ["version", "previousRaw", "attemptedRawHash"]) || value.version !== 1) {
    throw new Error("Некорректный marker interaction journal");
  }
  if (value.previousRaw !== null && typeof value.previousRaw !== "string") throw new Error("Некорректный previous journal marker");
  if (typeof value.attemptedRawHash !== "string" || !SHA256.test(value.attemptedRawHash)) throw new Error("Некорректный hash interaction journal");
  if (value.previousRaw !== null) parseJournalRaw(value.previousRaw);
  const marker = value as unknown as PendingPublicationInteractionCommitV1;
  if (raw !== canonicalStringify(marker)) throw new Error("Marker interaction journal имеет неканонические bytes");
  return marker;
}

function previousRawForIncompleteInteraction(storage: Pick<Storage, "getItem">, currentRaw: string | null): string | null {
  if (currentRaw === null) return currentRaw;
  try {
    const markerRaw = storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY);
    if (markerRaw === null) return currentRaw;
    const marker = parseInteractionCommit(markerRaw);
    const confirmedCurrentRaw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    const confirmedMarkerRaw = storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY);
    if (confirmedCurrentRaw !== currentRaw || confirmedMarkerRaw !== markerRaw) return confirmedCurrentRaw;
    return interactionJournalRawHash(currentRaw) === marker.attemptedRawHash ? marker.previousRaw : currentRaw;
  } catch {
    return currentRaw;
  }
}

function legacyExpectedKeys(version: 1 | 2): readonly string[] {
  return version === 1
    ? ["version", "owner", "repo", "branch", "sourceRevision", "commitSha", "createdAt", "database", "blobs"]
    : ["version", "owner", "repo", "branch", "sourceRevision", "commitSha", "createdAt", "database", "assetIds"];
}

function parseLegacyRecovery(value: Record<string, unknown>): LegacyPendingPublicationRecovery {
  if (value.version !== 1 && value.version !== 2 || !exactKeys(value, legacyExpectedKeys(value.version))) throw new Error("Некорректная legacy pending publication");
  assertRepositoryCoordinates(value.owner, value.repo, value.branch);
  if (typeof value.sourceRevision !== "string" || value.sourceRevision !== "" && !SHA256.test(value.sourceRevision)) throw new Error("Некорректная legacy revision");
  if (typeof value.commitSha !== "string" || !GIT_OBJECT_SHA.test(value.commitSha)) throw new Error("Некорректный legacy commit SHA");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("Некорректная legacy дата");
  assertValidPublishedLibrary(value.database);
  if (value.database.publicationId === null) throw new Error("Legacy database не опубликована");
  const assetIds: string[] = [];
  if (value.version === 1) {
    if (!isObject(value.blobs)) throw new Error("Некорректный legacy blob cache");
    for (const [id, encoded] of Object.entries(value.blobs)) {
      if (!SHA256.test(id) || typeof encoded !== "string" || !isCanonicalBase64(encoded)) throw new Error("Некорректный legacy blob");
      const bytes = base64ToBytes(encoded);
      const asset = value.database.assets[id];
      if (!asset || sha256Bytes(bytes) !== id || asset.byteLength !== bytes.byteLength) throw new Error("Legacy blob не совпадает с database");
      assetIds.push(id);
    }
  } else {
    if (!Array.isArray(value.assetIds) || new Set(value.assetIds).size !== value.assetIds.length) throw new Error("Некорректный legacy asset list");
    for (const id of value.assetIds) {
      if (typeof id !== "string" || !SHA256.test(id) || !value.database.assets[id]) throw new Error("Legacy asset отсутствует в database");
      assetIds.push(id);
    }
  }
  return {
    version: value.version,
    database: structuredClone(value.database),
    assetIds: assetIds.sort(),
    owner: value.owner as string,
    repo: value.repo as string,
    branch: value.branch as string,
    sourceRevision: value.sourceRevision,
    commitSha: value.commitSha,
    createdAt: value.createdAt,
  };
}

export function loadPendingPublicationJournal(storage: Pick<Storage, "getItem">): PendingPublicationJournalLoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return { status: "read_failure", error: new Error("Safari не разрешил прочитать ожидающую публикацию") };
  }
  raw = previousRawForIncompleteInteraction(storage, raw);
  if (raw === null) return { status: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt", raw, error: new Error("Ожидающая публикация повреждена") };
  }
  if (isObject(parsed) && (parsed.version === 1 || parsed.version === 2)) {
    let recovery: LegacyPendingPublicationRecovery | null = null;
    try { recovery = parseLegacyRecovery(parsed); } catch { /* Preserve malformed legacy bytes for export. */ }
    return { status: "legacy", raw, recovery, error: new Error("Legacy pending publication требует экспорта и восстановления") };
  }
  try {
    return { status: "valid", journal: parseJournalRaw(raw), raw };
  } catch {
    return { status: "corrupt", raw, error: new Error("Ожидающая публикация повреждена") };
  }
}

function memoryOnly(journal: PendingPublicationJournalV3, message: string): InstallPendingPublicationJournalResult {
  return { status: "memory_only", journal: cloneJournal(journal), error: new Error(message) };
}

function productionLockManager(provided: PendingPublicationLockManager | null | undefined): PendingPublicationLockManager | null {
  if (provided !== undefined) return provided;
  try { return typeof navigator === "undefined" ? null : navigator.locks ?? null; }
  catch { return null; }
}

export async function installPendingPublicationJournal(
  storage: PublicationStorage,
  journal: PendingPublicationJournalV3,
  options: InstallPendingPublicationJournalOptions,
): Promise<InstallPendingPublicationJournalResult> {
  assertJournalValue(journal, {
    recoveryBaseDatabase: options.recoveryBaseDatabase,
    requireRecoveryBase: journal.phase === "recovery-required",
  });
  const canonical = cloneJournal(journal);
  const raw = canonicalStringify(canonical);
  const lockManager = productionLockManager(options.lockManager);
  if (lockManager === null) return memoryOnly(canonical, "Web Lock ожидающей публикации недоступен");
  try {
    return await lockManager.request(LOCAL_LIBRARY_AUTHORITY_LOCK_NAME, { mode: "exclusive" }, () => (
      installPendingPublicationJournalLocked(storage, canonical, raw, options)
    ));
  } catch {
    return memoryOnly(canonical, "Safari не предоставил Web Lock ожидающей публикации");
  }
}

function interactionMemoryOnly(
  journal: PendingPublicationJournalV3,
  message: string,
): InstallPendingPublicationJournalResult {
  return { status: "memory_only", journal, error: new Error(message) };
}

/**
 * CAS-persist a journal whose unchanged authority and new remainder have
 * already been validated by trusted provider/domain paths. Bootstrap, import,
 * publication, and recovery flows must continue to use the full installer.
 */
export async function installValidatedInteractionJournal(
  storage: PublicationStorage,
  journal: PendingPublicationJournalV3,
  options: Pick<InstallPendingPublicationJournalOptions, "expectedRaw" | "lockManager" | "replaceRescueLineage">,
): Promise<InstallPendingPublicationJournalResult> {
  let raw: string;
  try { raw = canonicalStringify(journal); }
  catch { return interactionMemoryOnly(journal, "Не удалось сериализовать ожидающую публикацию"); }
  const lockManager = productionLockManager(options.lockManager);
  if (lockManager === null) return interactionMemoryOnly(journal, "Web Lock ожидающей публикации недоступен");
  try {
    return await lockManager.request(LOCAL_LIBRARY_AUTHORITY_LOCK_NAME, { mode: "exclusive" }, () => {
      let previousPending: string | null;
      let ordinaryPatch: string | null;
      let previousMarkerRaw: string | null;
      try {
        previousPending = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
        previousMarkerRaw = storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY);
        if (previousMarkerRaw !== null) {
          const previousMarker = parseInteractionCommit(previousMarkerRaw);
          if (previousPending !== null && interactionJournalRawHash(previousPending) === previousMarker.attemptedRawHash) {
            if (storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY) !== previousMarkerRaw) {
              return interactionMemoryOnly(journal, "Marker незавершённого journal изменился");
            }
            if (previousMarker.previousRaw === null) storage.removeItem(PENDING_PUBLICATION_STORAGE_KEY);
            else storage.setItem(PENDING_PUBLICATION_STORAGE_KEY, previousMarker.previousRaw);
            if (storage.getItem(PENDING_PUBLICATION_STORAGE_KEY) !== previousMarker.previousRaw) {
              return interactionMemoryOnly(journal, "Safari не подтвердил rollback незавершённого journal");
            }
            previousPending = previousMarker.previousRaw;
          }
        }
        if (previousPending !== options.expectedRaw) return { status: "changed", currentRaw: previousPending };
        ordinaryPatch = storage.getItem(PATCH_STORAGE_KEY);
        webkitStorageBytes(storage);
      } catch {
        return interactionMemoryOnly(journal, "Safari не разрешил прочитать localStorage перед сохранением journal");
      }
      const marker = canonicalStringify({
        version: 1,
        previousRaw: previousPending,
        attemptedRawHash: interactionJournalRawHash(raw),
      } satisfies PendingPublicationInteractionCommitV1);
      try {
        const beforeWrite = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
        if (beforeWrite !== options.expectedRaw) return { status: "changed", currentRaw: beforeWrite };
        if (storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY) !== previousMarkerRaw) {
          return interactionMemoryOnly(journal, "Marker незавершённого journal изменился");
        }
        const lineage = options.replaceRescueLineage?.(previousPending, raw);
        if (lineage?.status === "changed") return { status: "changed", currentRaw: previousPending };
        if (lineage?.status === "failure") return interactionMemoryOnly(journal, lineage.error.message);
        const currentBytes = webkitStorageBytes(storage);
        const previousPendingBytes = previousPending === null ? 0 : webkitStringBytes(PENDING_PUBLICATION_STORAGE_KEY, previousPending);
        const ordinaryPatchBytes = ordinaryPatch === null ? 0 : webkitStringBytes(PATCH_STORAGE_KEY, ordinaryPatch);
        const previousMarkerBytes = previousMarkerRaw === null ? 0 : webkitStringBytes(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY, previousMarkerRaw);
        const projectedBytes = currentBytes
          - previousPendingBytes
          - previousMarkerBytes
          + webkitStringBytes(PENDING_PUBLICATION_STORAGE_KEY, raw)
          + webkitStringBytes(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY, marker);
        if (ordinaryPatchBytes > currentBytes || !storageIncreaseAllowed(currentBytes, projectedBytes)) {
          return interactionMemoryOnly(journal, "Ожидающая публикация не помещается в безопасный бюджет Safari");
        }
        storage.setItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY, marker);
        if (storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY) !== marker) {
          return interactionMemoryOnly(journal, "Safari не подтвердил marker незавершённого journal");
        }
        storage.setItem(PENDING_PUBLICATION_STORAGE_KEY, raw);
        if (storage.getItem(PENDING_PUBLICATION_STORAGE_KEY) !== raw) {
          return interactionMemoryOnly(journal, "Safari не подтвердил точные bytes ожидающей публикации");
        }
        if (storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY) !== marker) {
          return interactionMemoryOnly(journal, "Marker незавершённого journal изменился");
        }
        storage.removeItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY);
        if (storage.getItem(PENDING_PUBLICATION_INTERACTION_COMMIT_KEY) !== null) {
          return interactionMemoryOnly(journal, "Safari не подтвердил завершение journal commit");
        }
        return { status: "durable", journal, raw };
      } catch {
        return interactionMemoryOnly(journal, "Safari не сохранил ожидающую публикацию");
      }
    });
  } catch {
    return interactionMemoryOnly(journal, "Safari не предоставил Web Lock ожидающей публикации");
  }
}

function installPendingPublicationJournalLocked(
  storage: PublicationStorage,
  canonical: PendingPublicationJournalV3,
  raw: string,
  options: InstallPendingPublicationJournalOptions,
): InstallPendingPublicationJournalResult {
  let previousPending: string | null;
  let ordinaryPatch: string | null;
  try {
    previousPending = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    if (previousPending !== options.expectedRaw) return { status: "changed", currentRaw: previousPending };
    if (previousPending !== null) {
      try { parseJournalRaw(previousPending); }
      catch { return { status: "changed", currentRaw: previousPending }; }
    }
    ordinaryPatch = storage.getItem(PATCH_STORAGE_KEY);
    if (Object.prototype.hasOwnProperty.call(options, "expectedOrdinaryRaw") && ordinaryPatch !== options.expectedOrdinaryRaw) {
      return { status: "changed", currentRaw: previousPending, currentOrdinaryRaw: ordinaryPatch };
    }
    webkitStorageBytes(storage);
  } catch {
    return memoryOnly(canonical, "Safari не разрешил прочитать localStorage перед сохранением journal");
  }
  try {
    const currentRaw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    if (currentRaw !== options.expectedRaw) return { status: "changed", currentRaw };
    if (currentRaw !== null) {
      try { parseJournalRaw(currentRaw); }
      catch { return { status: "changed", currentRaw }; }
    }
    if (Object.prototype.hasOwnProperty.call(options, "expectedOrdinaryRaw")) {
      const currentOrdinaryRaw = storage.getItem(PATCH_STORAGE_KEY);
      if (currentOrdinaryRaw !== options.expectedOrdinaryRaw) {
        return { status: "changed", currentRaw, currentOrdinaryRaw };
      }
    }
    const lineage = options.replaceRescueLineage?.(currentRaw, raw);
    if (lineage?.status === "changed") return { status: "changed", currentRaw };
    if (lineage?.status === "failure") return memoryOnly(canonical, lineage.error.message);
    const currentBytes = webkitStorageBytes(storage);
    const previousPendingBytes = previousPending === null ? 0 : webkitStringBytes(PENDING_PUBLICATION_STORAGE_KEY, previousPending);
    const ordinaryPatchBytes = ordinaryPatch === null ? 0 : webkitStringBytes(PATCH_STORAGE_KEY, ordinaryPatch);
    const projectedBytes = currentBytes - previousPendingBytes + webkitStringBytes(PENDING_PUBLICATION_STORAGE_KEY, raw);
    if (ordinaryPatchBytes > currentBytes || !storageIncreaseAllowed(currentBytes, projectedBytes)) {
      return memoryOnly(canonical, "Ожидающая публикация не помещается в безопасный бюджет Safari");
    }
    storage.setItem(PENDING_PUBLICATION_STORAGE_KEY, raw);
  } catch {
    return memoryOnly(canonical, "Safari не сохранил ожидающую публикацию");
  }
  try {
    const readback = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    if (readback !== raw) return memoryOnly(canonical, "Safari не подтвердил точные bytes ожидающей публикации");
    const verified = parseJournalRaw(readback);
    if (verified.phase === "recovery-required") {
      assertJournalValue(verified, { recoveryBaseDatabase: options.recoveryBaseDatabase, requireRecoveryBase: true });
    }
    return { status: "durable", journal: cloneJournal(verified), raw };
  } catch {
    return memoryOnly(canonical, "Safari не прочитал сохранённую ожидающую публикацию");
  }
}

function prepareOrdinaryPatch(base: LibraryDatabase, patch: PatchEnvelope): string | null {
  assertNormalizedPublishedDatabase(base, "Deployed base database");
  assertValidPatch(patch);
  assertStandalonePatchSourcePayloads(patch);
  if (patch.baseRevision !== base.revision) throw new Error("Remainder patch создан для другой deployed base revision");
  applyPatch(base, patch);
  if (Object.keys(patch.operations).length === 0) return null;
  const stored: PatchEnvelope = { ...structuredClone(patch), blobs: {} };
  assertValidPatch(stored);
  return JSON.stringify(stored);
}

function failure(
  stage: Extract<FinalizePendingPublicationJournalResult, { status: "failure" }>["stage"],
  message: string,
): FinalizePendingPublicationJournalResult {
  return { status: "failure", stage, error: new Error(message) };
}

export async function finalizePendingPublicationJournal(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  options: FinalizePendingPublicationJournalOptions,
): Promise<FinalizePendingPublicationJournalResult> {
  let patchRaw: string | null;
  try {
    const journal = parseJournalRaw(options.expectedJournalRaw);
    assertNormalizedPublishedDatabase(options.deployedBaseDatabase, "Deployed base database");
    if (journal.phase === "recovery-required" && options.deployedBaseDatabase.revision !== journal.remainderPatch.baseRevision) {
      throw new Error("Recovery journal можно финализировать только на его proven descendant base");
    }
    const expectedReconciliation = reconcilePatch(options.deployedBaseDatabase, journal.remainderPatch);
    if (expectedReconciliation.conflicts.length !== 0) throw new Error("Journal remainder конфликтует с deployed base");
    if (canonicalStringify(expectedReconciliation.patch) !== canonicalStringify(options.reconciledRemainderPatch)) {
      throw new Error("Supplied remainder не является reconciliation exact journal intent");
    }
    patchRaw = prepareOrdinaryPatch(options.deployedBaseDatabase, options.reconciledRemainderPatch);
  } catch {
    return failure("validation", "Нельзя финализировать некорректное состояние публикации");
  }

  const lockManager = productionLockManager(options.lockManager);
  if (lockManager === null) return failure("lock", "Web Lock ожидающей публикации недоступен");
  try {
    return await lockManager.request(LOCAL_LIBRARY_AUTHORITY_LOCK_NAME, { mode: "exclusive" }, () => (
      finalizePendingPublicationJournalLocked(storage, options, patchRaw)
    ));
  } catch {
    return failure("lock", "Safari не предоставил Web Lock ожидающей публикации");
  }
}

function finalizePendingPublicationJournalLocked(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  options: FinalizePendingPublicationJournalOptions,
  patchRaw: string | null,
): FinalizePendingPublicationJournalResult {
  let initialJournalRaw: string | null;
  try {
    initialJournalRaw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return failure("journal-read", "Safari не прочитал journal перед финализацией");
  }
  if (initialJournalRaw === null) {
    try {
      return storage.getItem(PATCH_STORAGE_KEY) === patchRaw
        ? { status: "finalized", patchRaw, idempotent: true }
        : { status: "changed", currentRaw: null };
    } catch {
      return failure("patch-read", "Safari не подтвердил ordinary patch после предыдущей финализации");
    }
  }
  if (initialJournalRaw !== options.expectedJournalRaw) return { status: "changed", currentRaw: initialJournalRaw };

  try {
    if (patchRaw === null) storage.removeItem(PATCH_STORAGE_KEY);
    else storage.setItem(PATCH_STORAGE_KEY, patchRaw);
  } catch {
    return failure("patch-write", "Safari не сохранил reconciled ordinary patch");
  }
  try {
    if (storage.getItem(PATCH_STORAGE_KEY) !== patchRaw) return failure("patch-read", "Safari не подтвердил reconciled ordinary patch");
  } catch {
    return failure("patch-read", "Safari не прочитал reconciled ordinary patch");
  }

  let currentJournalRaw: string | null;
  try {
    currentJournalRaw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return failure("journal-read", "Safari не прочитал journal для compare-and-clear");
  }
  if (currentJournalRaw !== options.expectedJournalRaw) return { status: "changed", currentRaw: currentJournalRaw };
  try {
    storage.removeItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return failure("journal-remove", "Safari не удалил финализированный journal");
  }
  try {
    const afterRemoval = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    if (afterRemoval === options.expectedJournalRaw) {
      return failure("journal-remove-read", "Safari не подтвердил удаление финализированного journal");
    }
    if (afterRemoval !== null) return { status: "changed", currentRaw: afterRemoval };
  } catch {
    return failure("journal-remove-read", "Safari не подтвердил удаление финализированного journal");
  }
  return { status: "finalized", patchRaw, idempotent: false };
}

function exportedRawCanBeDiscarded(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isObject(parsed) && (parsed.version === 1 || parsed.version === 2)) return true;
    return parseJournalRaw(raw).phase === "recovery-required";
  } catch {
    return true;
  }
}

export async function discardPendingPublicationAfterRecoveryExport(
  storage: Pick<Storage, "getItem" | "removeItem">,
  expectedRaw: string,
  options: { lockManager?: PendingPublicationLockManager | null } = {},
): Promise<DiscardPendingPublicationResult> {
  if (!exportedRawCanBeDiscarded(expectedRaw)) return { status: "not_recoverable" };
  const lockManager = productionLockManager(options.lockManager);
  if (lockManager === null) return { status: "failure", error: new Error("Web Lock ожидающей публикации недоступен") };
  try {
    return await lockManager.request(LOCAL_LIBRARY_AUTHORITY_LOCK_NAME, { mode: "exclusive" }, () => (
      discardPendingPublicationAfterRecoveryExportLocked(storage, expectedRaw)
    ));
  } catch {
    return { status: "failure", error: new Error("Safari не предоставил Web Lock ожидающей публикации") };
  }
}

function discardPendingPublicationAfterRecoveryExportLocked(
  storage: Pick<Storage, "getItem" | "removeItem">,
  expectedRaw: string,
): DiscardPendingPublicationResult {
  let currentRaw: string | null;
  try {
    currentRaw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return { status: "failure", error: new Error("Safari не прочитал recovery journal") };
  }
  if (currentRaw !== expectedRaw) return { status: "changed", currentRaw };
  try {
    storage.removeItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return { status: "failure", error: new Error("Safari не удалил exported recovery journal") };
  }
  try {
    const afterRemoval = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    if (afterRemoval === null) return { status: "cleared" };
    if (afterRemoval !== expectedRaw) return { status: "changed", currentRaw: afterRemoval };
    return { status: "failure", error: new Error("Safari не подтвердил удаление recovery journal") };
  } catch {
    return { status: "failure", error: new Error("Safari не подтвердил удаление recovery journal") };
  }
}

/** @deprecated Compile-only Task 7 bridge. Task 11 removes this receipt type. */
export interface PendingPublicationReceipt {
  version: 1 | 2;
  owner: string;
  repo: string;
  branch: string;
  sourceRevision: string;
  commitSha: string;
  createdAt: string;
  database: LibraryDatabase;
  assetIds?: string[];
  blobs?: Record<string, string>;
}

/** @deprecated Compile-only Task 7 bridge. */
export interface PendingPublicationLoadResult {
  receipt: PendingPublicationReceipt | null;
  raw: string | null;
  error: Error | null;
}

/** @deprecated Compile-only Task 7 bridge; no storage parsing occurs. */
export function loadPendingPublication(_storage: Pick<Storage, "getItem">): PendingPublicationLoadResult {
  return { receipt: null, raw: null, error: new Error("Legacy pending publication API недоступен; используйте v3 journal API") };
}

/** @deprecated Compile-only Task 7 bridge. */
export function pendingPublicationAssetIds(receipt: PendingPublicationReceipt): string[] {
  return [...(receipt.assetIds ?? Object.keys(receipt.blobs ?? {}))];
}

/** @deprecated Compile-only Task 7 bridge; always fails with zero storage mutation. */
export function installPendingPublication(
  _storage: PublicationStorage,
  _receipt: PendingPublicationReceipt,
  _remainingPatch: PatchEnvelope,
): { ok: true } | { ok: false; error: Error } {
  return { ok: false, error: new Error("Legacy pending publication API недоступен; используйте v3 journal API") };
}

/** @deprecated Compile-only Task 7 bridge; always fails with zero storage mutation. */
export function clearPendingPublication(_storage: Pick<Storage, "removeItem">): boolean {
  return false;
}
