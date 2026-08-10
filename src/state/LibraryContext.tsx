import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GameSaveInput, EditableAttachment } from "../pages/GamePage";
import {
  PATCH_STORAGE_KEY,
  SAFARI_SAFE_BUDGET_BYTES,
  applyPatch,
  assertSourceRepresentable,
  assertValidLibrary,
  base64ToBytes,
  classifyStorageUsage,
  deleteLocalAssetsAtomic,
  deleteSafeOrphans,
  describeAssetForRecovery,
  diffLibrary,
  discardOperation,
  estimateOriginStorage,
  garbageCollectUnreferencedAssets,
  inspectLocalAssetIntegrity,
  isQuotaExceededError,
  listLocalAssets,
  localAssetWritePreflight,
  loadPatch,
  makeLocalAsset,
  mergePatchEnvelopes,
  moveGameToTier,
  normalizeLibraryDatabase,
  normalizePatchEnvelope,
  parsePatchPath,
  projectedStorageUsage,
  publishedAssetUrl,
  readLocalAssets,
  reconcilePatch,
  referencedAssetIds,
  requestPersistentOriginStorage,
  rebasePostClickOverlaps,
  resolveConflict,
  resolvePatchSelection,
  savePatch,
  sha256Bytes,
  storageIsPersisted,
  updateLocalAssetState,
  validatePatch,
  webkitStorageBytes,
  webkitStringBytes,
  writeLocalAssetsAtomic,
  DEFAULT_NOTE_GROUP_RANK,
  LIBRARY_SCHEMA_VERSION,
  type Asset,
  type LibraryDatabase,
  type LocalAsset,
  type NoteAttachment,
  type OriginStorageStatus,
  type PatchConflict,
  type PatchEnvelope,
  type ReconciledPatch,
  type StorageUsage,
  type TierId,
} from "../domain";
import { parsePublishedLibraryEnvelope, type PublishedLibraryEnvelope } from "../source";
import {
  PENDING_PUBLICATION_STORAGE_KEY,
  discardPendingPublicationAfterRecoveryExport,
  finalizePendingPublicationJournal,
  installPendingPublicationJournal,
  loadPendingPublicationJournal,
  type LegacyPendingPublicationRecovery,
  type PendingPublicationJournalV3,
} from "./pendingPublication";
import { createRecoveryArchive, downloadRecoveryArchive } from "./recoveryExport";
import {
  GitHubGitDatabaseSyncClient,
  GitHubSyncError,
  type GitHubSyncStage,
} from "./githubGitDatabaseSync";
import {
  GITHUB_REPOSITORY_NAME,
  GITHUB_REPOSITORY_OWNER,
  loadGitHubPat,
} from "./githubPat";

function emptyPatch(baseRevision: string): PatchEnvelope {
  return { patchVersion: 2, schemaVersion: LIBRARY_SCHEMA_VERSION, baseRevision, operations: {}, blobs: {} };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase("ru");
    if (!trimmed || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

function maxRank(items: Array<{ rank: number }>): number {
  return items.reduce((maximum, item) => Math.max(maximum, item.rank), 0);
}

function assetFromPrepared(image: { assetId: string; width: number; height: number; alt: string; originalName: string; byteLength: number }): Asset {
  return { id: image.assetId, kind: "image", mime: "image/webp", width: image.width, height: image.height, byteLength: image.byteLength, alt: image.alt, originalName: image.originalName };
}

function retainLocalAsset(database: LibraryDatabase, asset: Asset, expectedKind: "image" | "file"): string {
  const existing = database.assets[asset.id];
  if (existing) {
    const compatible = expectedKind === "file" ? existing.kind === "file" : existing.kind !== "file";
    if (!compatible) throw new Error("Файл с тем же содержимым уже сохранён как другой тип asset");
    return existing.id;
  }
  database.assets[asset.id] = asset;
  return asset.id;
}

function preparedLocalAssets(input: GameSaveInput, base: LibraryDatabase): LocalAsset[] {
  const result = new Map<string, LocalAsset>();
  const add = (id: string, blob: Blob, mimeType: string, expectedBytes: number) => {
    if (Object.prototype.hasOwnProperty.call(base.assets, id)) return;
    if (blob.size !== expectedBytes) throw new Error("Размер подготовленного вложения не совпадает с Blob");
    result.set(id, makeLocalAsset(id, blob, mimeType));
  };
  if (input.pendingCover) add(input.pendingCover.assetId, input.pendingCover.blob, input.pendingCover.mime, input.pendingCover.byteLength);
  for (const item of input.progressItems) {
    if (item.pendingIcon) add(item.pendingIcon.assetId, item.pendingIcon.blob, item.pendingIcon.mime, item.pendingIcon.byteLength);
  }
  for (const note of input.notes) for (const attachment of note.attachments) {
    if (attachment.type === "pending-image") add(attachment.image.assetId, attachment.image.blob, attachment.image.mime, attachment.image.byteLength);
    if (attachment.type === "pending-file") add(attachment.file.assetId, attachment.file.blob, attachment.file.mime, attachment.file.byteLength);
  }
  return [...result.values()];
}

function localAssetsFromLegacyBlobs(blobs: Record<string, string>, assets: Record<string, Asset>): LocalAsset[] {
  return Object.entries(blobs).map(([id, encoded]) => {
    const asset = assets[id];
    if (!asset) throw new Error(`Для legacy Blob ${id} отсутствует metadata`);
    const bytes = base64ToBytes(encoded);
    if (bytes.byteLength !== asset.byteLength) throw new Error(`Размер legacy Blob ${id} не совпадает с metadata`);
    const mime = asset.kind === "image" ? "image/webp" : asset.mime;
    return makeLocalAsset(id, new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }), mime);
  });
}

function patchAssetMetadata(patch: PatchEnvelope): Record<string, Asset> {
  return Object.fromEntries(Object.entries(patch.operations).flatMap(([path, operation]) => {
    const match = /^\/assets\/([0-9a-f]{64})$/.exec(path);
    return match && operation.operation === "set" && operation.value && typeof operation.value === "object"
      ? [[match[1], operation.value as Asset]]
      : [];
  }));
}

function patchLocalAssetIds(patch: PatchEnvelope): string[] {
  return Object.keys(patchAssetMetadata(patch))
    .filter((id) => patch.operations[`/assets/${id}`]?.baseExists === false)
    .sort();
}

export function requiredLocalAssetIds(patch: PatchEnvelope, database: LibraryDatabase): string[] {
  const referenced = referencedAssetIds(database);
  return patchLocalAssetIds(patch).filter((id) => referenced.has(id));
}

function patchUsage(patch: PatchEnvelope): StorageUsage {
  try {
    return projectedStorageUsage(localStorage, PATCH_STORAGE_KEY, JSON.stringify(patch));
  } catch {
    return classifyStorageUsage(webkitStringBytes(PATCH_STORAGE_KEY, JSON.stringify(patch)));
  }
}

function garbageCollectReconciledAssets(base: LibraryDatabase, reconciled: ReconciledPatch): ReconciledPatch {
  if (reconciled.conflicts.length) return reconciled;
  const effective = structuredClone(reconciled.effective);
  if (!garbageCollectUnreferencedAssets(effective).length) return reconciled;
  return reconcilePatch(base, diffLibrary(base, effective, { previousPatch: reconciled.patch }));
}

export async function verifyPublishedLocalAssets(ids: string[], database: LibraryDatabase): Promise<void> {
  for (const id of ids) {
    const asset = database.assets[id];
    if (!asset) throw new Error(`Опубликованная база не содержит asset ${id}`);
    const url = publishedAssetUrl(asset, import.meta.env.BASE_URL);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Опубликованный файл ${id} пока недоступен: HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size !== asset.byteLength) throw new Error(`Размер опубликованного файла ${id} не совпадает`);
    if (sha256Bytes(new Uint8Array(await blob.arrayBuffer())) !== id) throw new Error(`SHA-256 опубликованного файла ${id} не совпадает`);
  }
}

export async function verifyAndDeletePublishedLocalAssets(ids: string[], database: LibraryDatabase): Promise<void> {
  await verifyPublishedLocalAssets(ids, database);
  await deleteLocalAssetsAtomic(ids);
}

export type PublicationCheck =
  | "waiting-source"
  | "checking"
  | "asset-verification"
  | "non-current"
  | "unrelated"
  | "unverifiable"
  | "revision-mismatch"
  | "finalize-failed"
  | null;

export interface DeployedObservation {
  sourceCommitSha: string;
  database: LibraryDatabase;
}

export type PublicationState =
  | { status: "none"; exportCompleted: false }
  | {
      status: "valid";
      durability: "durable";
      journal: PendingPublicationJournalV3;
      raw: string;
      expectedRaw: string;
      recoveryBase: DeployedObservation | null;
      check: PublicationCheck;
      exportCompleted: boolean;
    }
  | {
      status: "valid";
      durability: "memory-only";
      journal: PendingPublicationJournalV3;
      raw: null;
      expectedRaw: string | null;
      recoveryBase: DeployedObservation | null;
      check: PublicationCheck;
      exportCompleted: boolean;
    }
  | { status: "corrupt"; raw: string; error: string; exportCompleted: boolean }
  | { status: "legacy"; raw: string; recovery: LegacyPendingPublicationRecovery | null; error: string; exportCompleted: boolean }
  | { status: "read-failure"; error: string; exportCompleted: false };

export async function promoteMemoryOnlyPublicationForDiscard(
  storage: Storage,
  authority: Extract<PublicationState, { status: "valid"; durability: "memory-only" }>,
) {
  return installPendingPublicationJournal(storage, authority.journal, {
    expectedRaw: authority.expectedRaw,
    ...(authority.journal.phase === "recovery-required" && authority.recoveryBase
      ? { recoveryBaseDatabase: authority.recoveryBase.database }
      : {}),
  });
}

interface LibraryState {
  sourceCommitSha: string | null;
  base: LibraryDatabase;
  effective: LibraryDatabase;
  patch: PatchEnvelope;
  conflicts: PatchConflict[];
  publicationState: PublicationState;
  retainedLocalAssetIds: readonly string[];
}

export interface LibraryGitHubSyncResult {
  status: "committed" | "up-to-date";
  commitSha: string;
  commitUrl: string;
  pagesPending: boolean;
}

export interface LibraryGitHubSyncOptions {
  onStage?: (stage: GitHubSyncStage) => void;
  selectedPaths?: readonly string[];
}

export interface LibraryContextValue extends LibraryState {
  loading: boolean;
  fatalError: string | null;
  persistenceError: string | null;
  corruptedPatchRaw: string | null;
  usage: StorageUsage;
  storageEstimate: { usage?: number; quota?: number } | null;
  quotaStatus: OriginStorageStatus;
  persistentStorage: boolean;
  attachmentsBlocked: boolean;
  localAssets: LocalAsset[];
  localAssetBytes: number;
  games: LibraryDatabase["games"];
  canAddBlob: (byteLength: number) => Promise<string | null>;
  resolveAssetUrl: (assetId: string) => string | null;
  saveGame: (input: GameSaveInput) => Promise<string>;
  deleteGame: (gameId: string) => Promise<void>;
  moveGame: (gameId: string, tierId: TierId, index: number) => Promise<void>;
  discardPath: (path: string) => Promise<void>;
  discardPaths: (paths: string[]) => Promise<void>;
  clearPatch: () => Promise<void>;
  resolvePatchConflict: (path: string, choice: "static" | "local", manualValue?: unknown) => Promise<void>;
  importPatch: (raw: string) => Promise<void>;
  undoLast: () => Promise<boolean>;
  downloadCorruptedPatch: () => void;
  exportRecoveryArchive: () => Promise<void>;
  retryPublicationPersistence: () => Promise<void>;
  retryPublicationCheck: (token?: string) => Promise<void>;
  exportPublicationRecovery: () => Promise<void>;
  discardPublicationAfterExport: () => Promise<void>;
  reloadPage: () => void;
  deleteAllLocalAssets: () => Promise<void>;
  verifyGitHubAccess: (token: string) => Promise<void>;
  syncToGitHub: (token: string, options?: LibraryGitHubSyncOptions) => Promise<LibraryGitHubSyncResult>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LibraryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [corruptedPatchRaw, setCorruptedPatchRaw] = useState<string | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [quotaStatus, setQuotaStatus] = useState<OriginStorageStatus>({ usage: null, quota: null, remaining: null, ratio: null, level: "unknown" });
  const [persistentStorage, setPersistentStorage] = useState(false);
  const [attachmentWriteBlocked, setAttachmentWriteBlocked] = useState(false);
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>([]);
  const [localAssetUrls, setLocalAssetUrls] = useState<Record<string, string>>({});
  const [storageChangeVersion, setStorageChangeVersion] = useState(0);
  const localAssetUrlsRef = useRef<Record<string, string>>({});
  const undoStack = useRef<PatchEnvelope[]>([]);
  const stateRef = useRef<LibraryState | null>(null);
  const installedStorageChangeVersionRef = useRef(0);
  const localAssetsRef = useRef<LocalAsset[]>([]);
  const persistRequestedRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const deployedEnvelopeRef = useRef<PublishedLibraryEnvelope | null>(null);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const checkPublicationRef = useRef<(token?: string) => Promise<void>>(async () => undefined);

  const setLibraryState = useCallback((next: LibraryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const installLocalAssets = useCallback((assets: LocalAsset[]) => {
    localAssetsRef.current = assets;
    setLocalAssets(assets);
    const previous = localAssetUrlsRef.current;
    const next = typeof URL.createObjectURL === "function"
      ? Object.fromEntries(assets.map((asset) => [asset.id, previous[asset.id] ?? URL.createObjectURL(asset.blob)]))
      : {};
    for (const [id, url] of Object.entries(previous)) {
      if (!Object.prototype.hasOwnProperty.call(next, id)) URL.revokeObjectURL?.(url);
    }
    localAssetUrlsRef.current = next;
    setLocalAssetUrls(next);
  }, []);

  useEffect(() => () => {
    Object.values(localAssetUrlsRef.current).forEach((url) => URL.revokeObjectURL?.(url));
    localAssetUrlsRef.current = {};
  }, []);

  const refreshLocalAssets = useCallback(async () => {
    try { installLocalAssets(await listLocalAssets()); }
    catch { installLocalAssets([]); }
  }, [installLocalAssets]);

  const refreshQuota = useCallback(async () => {
    const next = await estimateOriginStorage();
    setQuotaStatus(next);
    setStorageEstimate(next.usage === null && next.quota === null ? null : { usage: next.usage ?? undefined, quota: next.quota ?? undefined });
    return next;
  }, []);

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const protectedPublicationAssetIds = useCallback((publicationState: PublicationState): string[] => (
    publicationState.status === "valid"
      ? [...new Set(publicationState.journal.localAssetIdsAwaitingVerification)].sort()
      : []
  ), []);

  const installLoadedAuthority = useCallback((
    loadResult: ReturnType<typeof loadPendingPublicationJournal>,
    deployed: PublishedLibraryEnvelope,
    bridge?: LibraryState,
  ): LibraryState => {
    if (loadResult.status === "valid") {
      const journal = loadResult.journal;
      const sameRepository = journal.owner === GITHUB_REPOSITORY_OWNER
        && journal.repo === GITHUB_REPOSITORY_NAME
        && journal.branch === "main";
      if (!sameRepository) {
        return {
          sourceCommitSha: deployed.sourceCommitSha,
          base: deployed.database,
          effective: deployed.database,
          patch: emptyPatch(deployed.database.revision),
          conflicts: [],
          retainedLocalAssetIds: bridge?.retainedLocalAssetIds ?? [],
          publicationState: { status: "corrupt", raw: loadResult.raw, error: "Ожидающая публикация относится к другому репозиторию", exportCompleted: false },
        };
      }
      const publicationState: PublicationState = {
        status: "valid",
        durability: "durable",
        journal,
        raw: loadResult.raw,
        expectedRaw: loadResult.raw,
        recoveryBase: null,
        check: null,
        exportCompleted: false,
      };
      if (journal.phase === "awaiting-deployment") {
        const reconciled = reconcilePatch(journal.targetDatabase, journal.remainderPatch);
        return {
          sourceCommitSha: deployed.sourceCommitSha,
          base: journal.targetDatabase,
          effective: reconciled.effective,
          patch: reconciled.patch,
          conflicts: reconciled.conflicts,
          retainedLocalAssetIds: bridge?.retainedLocalAssetIds ?? [],
          publicationState,
        };
      }
      return {
        sourceCommitSha: deployed.sourceCommitSha,
        base: deployed.database,
        effective: deployed.database,
        patch: emptyPatch(deployed.database.revision),
        conflicts: [],
        retainedLocalAssetIds: bridge?.retainedLocalAssetIds ?? [],
        publicationState,
      };
    }
    const safeState = {
      sourceCommitSha: deployed.sourceCommitSha,
      base: deployed.database,
      effective: deployed.database,
      patch: emptyPatch(deployed.database.revision),
      conflicts: [],
      retainedLocalAssetIds: bridge?.retainedLocalAssetIds ?? [],
    };
    if (loadResult.status === "absent") return { ...safeState, publicationState: { status: "none", exportCompleted: false } };
    if (loadResult.status === "corrupt") return { ...safeState, publicationState: { status: "corrupt", raw: loadResult.raw, error: loadResult.error.message, exportCompleted: false } };
    if (loadResult.status === "legacy") return { ...safeState, publicationState: { status: "legacy", raw: loadResult.raw, recovery: loadResult.recovery, error: loadResult.error.message, exportCompleted: false } };
    return { ...safeState, publicationState: { status: "read-failure", error: loadResult.error.message, exportCompleted: false } };
  }, []);

  const reloadPublicationAuthority = useCallback(async (keepBridgeOnAbsent = false) => {
    const current = stateRef.current;
    const deployed = deployedEnvelopeRef.current;
    if (!current || !deployed) return;
    const loaded = loadPendingPublicationJournal(localStorage);
    if (loaded.status === "absent" && keepBridgeOnAbsent && current.publicationState.status === "valid") {
      await checkPublicationRef.current();
      return;
    }
    const next = installLoadedAuthority(loaded, deployed, current);
    setLibraryState(next);
    if (next.publicationState.status === "valid") await checkPublicationRef.current();
  }, [installLoadedAuthority, setLibraryState]);

  const persistReconciled = useCallback(async ({
    base,
    reconciled,
    remember = false,
    sourceCommitSha,
    publicationState,
    reason = "mutation",
  }: {
    base: LibraryDatabase;
    reconciled: ReconciledPatch;
    remember?: boolean;
    sourceCommitSha?: string | null;
    publicationState?: PublicationState;
    reason?: "mutation" | "import" | "discard" | "conflict-resolution" | "undo" | "publication";
  }): Promise<void> => {
    const normalized = garbageCollectReconciledAssets(base, reconciled);
    assertValidLibrary(normalized.effective);
    assertSourceRepresentable(normalized.effective);
    const current = stateRef.current;
    const authority = publicationState ?? current?.publicationState ?? { status: "none", exportCompleted: false };
    if (authority.status === "corrupt" || authority.status === "legacy" || authority.status === "read-failure") {
      throw new Error("Сначала экспортируйте и восстановите состояние публикации");
    }
    let installedAuthority = authority;
    if (authority.status === "none") {
      const written = savePatch(localStorage, normalized.patch);
      if (!written.ok) {
        const message = written.error?.message ?? "Safari не сохранил локальный патч";
        setPersistenceError(message);
        throw new Error(message);
      }
    } else {
      const journal: PendingPublicationJournalV3 = { ...authority.journal, remainderPatch: structuredClone(normalized.patch) };
      if (authority.durability === "memory-only") {
        installedAuthority = { ...authority, journal, recoveryBase: authority.recoveryBase, exportCompleted: false };
      } else {
        const result = await installPendingPublicationJournal(localStorage, journal, {
          expectedRaw: authority.raw,
          ...(journal.phase === "recovery-required" && authority.recoveryBase
            ? { recoveryBaseDatabase: authority.recoveryBase.database }
            : {}),
        });
        if (result.status === "changed") {
          await reloadPublicationAuthority();
          return;
        }
        installedAuthority = result.status === "durable"
          ? { ...authority, durability: "durable", journal: result.journal, raw: result.raw, expectedRaw: result.raw, exportCompleted: false }
          : { ...authority, durability: "memory-only", journal: result.journal, raw: null, expectedRaw: authority.raw, exportCompleted: false };
      }
    }
    if (remember && current) undoStack.current = [...undoStack.current.slice(-49), structuredClone(current.patch)];
    setPersistenceError(null);
    const nextState: LibraryState = {
      sourceCommitSha: sourceCommitSha === undefined ? current?.sourceCommitSha ?? null : sourceCommitSha,
      base,
      effective: normalized.effective,
      patch: normalized.patch,
      conflicts: normalized.conflicts,
      retainedLocalAssetIds: current?.retainedLocalAssetIds ?? [],
      publicationState: installedAuthority,
    };
    setLibraryState(nextState);
    if (
      installedAuthority.status === "valid"
      && installedAuthority.durability === "durable"
      && installedAuthority.journal.phase === "recovery-required"
      && installedAuthority.recoveryBase
      && normalized.conflicts.length === 0
    ) {
      const recoveryBase = installedAuthority.recoveryBase;
      const presentIds = installedAuthority.journal.localAssetIdsAwaitingVerification
        .filter((id) => id in recoveryBase.database.assets);
      const absentIds = installedAuthority.journal.localAssetIdsAwaitingVerification
        .filter((id) => !(id in recoveryBase.database.assets));
      await verifyPublishedLocalAssets(presentIds, recoveryBase.database);
      const finalized = await finalizePendingPublicationJournal(localStorage, {
        deployedBaseDatabase: recoveryBase.database,
        reconciledRemainderPatch: normalized.patch,
        expectedJournalRaw: installedAuthority.raw,
      });
      if (finalized.status === "changed") {
        await reloadPublicationAuthority();
        return;
      }
      if (finalized.status === "failure") {
        setPersistenceError(finalized.error.message);
        return;
      }
      const finalizedState: LibraryState = {
        ...nextState,
        sourceCommitSha: recoveryBase.sourceCommitSha,
        base: recoveryBase.database,
        retainedLocalAssetIds: [...new Set([...nextState.retainedLocalAssetIds, ...absentIds])].sort(),
        publicationState: { status: "none", exportCompleted: false },
      };
      setLibraryState(finalizedState);
      if (presentIds.length) {
        await deleteLocalAssetsAtomic(presentIds);
        await refreshLocalAssets();
        await refreshQuota();
      }
      return;
    }
    if (reason !== "publication") {
      const protectedIds = new Set([
        ...protectedPublicationAssetIds(installedAuthority),
        ...(current?.retainedLocalAssetIds ?? []),
      ]);
      const referenced = referencedAssetIds(normalized.effective);
      const removed = await deleteSafeOrphans(referenced, Date.now(), localStorage, protectedIds);
      if (removed.length) {
        await refreshLocalAssets();
        await refreshQuota();
      }
    }
  }, [protectedPublicationAssetIds, refreshLocalAssets, refreshQuota, reloadPublicationAuthority, setLibraryState]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const dataUrl = new URL(`${import.meta.env.BASE_URL}data/library.json`, document.baseURI);
        dataUrl.searchParams.set("_", String(Date.now()));
        const response = await fetch(dataUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Не удалось загрузить библиотеку: HTTP ${response.status}`);
        const envelope = parsePublishedLibraryEnvelope(await response.json());
        deployedEnvelopeRef.current = envelope;
        const loadedPublication = loadPendingPublicationJournal(localStorage);
        let initial = installLoadedAuthority(loadedPublication, envelope);
        let patch = initial.patch;
        let patchIsCorrupted = false;
        let patchHadLegacyBlobs = false;
        if (loadedPublication.status === "absent") try {
          const loaded = loadPatch(localStorage);
          if (loaded.error) {
            patchIsCorrupted = true;
            setCorruptedPatchRaw(loaded.raw);
            setPersistenceError("Локальный патч повреждён. Его можно скачать из окна правок.");
          } else if (loaded.patch) {
            patch = loaded.patch;
            patchHadLegacyBlobs = Object.keys(patch.blobs).length > 0;
            if (patchHadLegacyBlobs) {
              await writeLocalAssetsAtomic(localAssetsFromLegacyBlobs(patch.blobs, patchAssetMetadata(patch)));
              patch = { ...patch, blobs: {} };
            }
          }
        } catch (error) {
          setPersistenceError(error instanceof Error ? error.message : "localStorage недоступен");
        }
        let reconciled = reconcilePatch(initial.base, patch);
        try {
          reconciled = garbageCollectReconciledAssets(initial.base, reconciled);
          assertValidLibrary(reconciled.effective);
        } catch (error) {
          patchIsCorrupted = true;
          let raw: string | null = null;
          try { raw = localStorage.getItem(PATCH_STORAGE_KEY); } catch { /* localStorage may be unavailable */ }
          setCorruptedPatchRaw(raw);
          setPersistenceError(error instanceof Error ? `Локальный патч нельзя применить: ${error.message}` : "Локальный патч нельзя применить");
          reconciled = reconcilePatch(initial.base, emptyPatch(initial.base.revision));
        }
        if (!active) return;
        if (!patchIsCorrupted && loadedPublication.status === "absent") {
          try {
            const written = savePatch(localStorage, reconciled.patch);
            if (!written.ok) setPersistenceError(written.error?.message ?? "Safari не сохранил патч");
          } catch (error) {
            setPersistenceError(error instanceof Error ? error.message : "localStorage недоступен");
          }
        }
        try {
          const protectedIds = protectedPublicationAssetIds(initial.publicationState);
          const localIds = new Set([
            ...Object.keys(reconciled.effective.assets).filter((id) => !Object.prototype.hasOwnProperty.call(initial.base.assets, id)),
            ...protectedIds,
          ]);
          const integrity = await inspectLocalAssetIntegrity(localIds);
          if (integrity.corrupt.length || integrity.missing.length) {
            const details = [...integrity.missing.map((id) => `нет локального файла ${id}`), ...integrity.corrupt.map(({ asset }) => `повреждён локальный файл ${asset.id}`)].join(", ");
            setPersistenceError(`Проверка локальных вложений не пройдена: ${details}`);
          }
          const removedOrphans = loadedPublication.status === "corrupt" || loadedPublication.status === "legacy" || loadedPublication.status === "read_failure"
            ? []
            : await deleteSafeOrphans(localIds, Date.now(), localStorage, protectedIds);
          const removedIds = new Set(removedOrphans);
          if (patchHadLegacyBlobs || integrity.valid.length) installLocalAssets(integrity.valid.filter((asset) => !removedIds.has(asset.id)));
          if (removedOrphans.length) await refreshQuota();
        } catch (reason) {
          if (Object.keys(reconciled.effective.assets).some((id) => !Object.prototype.hasOwnProperty.call(initial.base.assets, id))) {
            setPersistenceError(reason instanceof Error ? reason.message : "localStorage недоступен для локальных вложений");
          }
        }
        initial = { ...initial, effective: reconciled.effective, patch: reconciled.patch, conflicts: reconciled.conflicts };
        setLibraryState(initial);
        if (initial.publicationState.status === "valid") window.setTimeout(() => void checkPublicationRef.current(), 0);
      } catch (error) {
        if (active) setFatalError(error instanceof Error ? error.message : "Не удалось открыть библиотеку");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  // corruptedPatchRaw must not restart the initial fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installLoadedAuthority, installLocalAssets, protectedPublicationAssetIds, refreshLocalAssets, refreshQuota, setLibraryState]);

  useEffect(() => {
    let active = true;
    void refreshQuota();
    void storageIsPersisted().then((persisted) => { if (active) setPersistentStorage(persisted); });
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshQuota();
      void refreshLocalAssets();
    };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; document.removeEventListener("visibilitychange", visible); };
  }, [refreshLocalAssets, refreshQuota]);

  useEffect(() => {
    let timer: number | undefined;
    const receive = (event: StorageEvent) => {
      if (event.key !== PATCH_STORAGE_KEY && event.key !== PENDING_PUBLICATION_STORAGE_KEY) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        setStorageChangeVersion((version) => version + 1);
      }, 0);
    };
    window.addEventListener("storage", receive);
    return () => {
      window.removeEventListener("storage", receive);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!state || installedStorageChangeVersionRef.current === storageChangeVersion) return;
    const version = storageChangeVersion;
    void enqueue(async () => {
      const current = stateRef.current;
      if (!current) return;
      if (current.publicationState.status === "valid" && current.publicationState.durability === "memory-only") {
        installedStorageChangeVersionRef.current = version;
        return;
      }
      const loadedPublication = loadPendingPublicationJournal(localStorage);
      if (loadedPublication.status !== "absent" || current.publicationState.status !== "none") {
        await reloadPublicationAuthority(current.publicationState.status === "valid");
        installedStorageChangeVersionRef.current = version;
        return;
      }
      const loaded = loadPatch(localStorage);
      if (loaded.patch) {
        try {
          const reconciled = garbageCollectReconciledAssets(current.base, reconcilePatch(current.base, loaded.patch));
          assertValidLibrary(reconciled.effective);
          setCorruptedPatchRaw(null);
          setLibraryState({ ...current, effective: reconciled.effective, patch: reconciled.patch, conflicts: reconciled.conflicts });
        } catch (error) {
          setCorruptedPatchRaw(loaded.raw);
          setPersistenceError(error instanceof Error ? `Патч из другой вкладки повреждён: ${error.message}` : "Патч из другой вкладки повреждён");
        }
      } else if (loaded.error) {
        setCorruptedPatchRaw(loaded.raw);
        setPersistenceError("Патч из другой вкладки повреждён. Скачайте raw-значение перед сбросом.");
      } else {
        const patch = emptyPatch(current.base.revision);
        setCorruptedPatchRaw(null);
        setLibraryState({ ...current, effective: current.base, patch, conflicts: [] });
      }
      installedStorageChangeVersionRef.current = version;
    });
  }, [enqueue, reloadPublicationAuthority, setLibraryState, state, storageChangeVersion]);

  const performPublicationCheck = useCallback(async (token?: string): Promise<void> => {
    const current = stateRef.current;
    if (!current || current.publicationState.status !== "valid") return;
    if (current.publicationState.durability !== "durable") return;
    setLibraryState({ ...current, publicationState: { ...current.publicationState, check: "checking" } });
    try {
      const dataUrl = new URL(`${import.meta.env.BASE_URL}data/library.json`, document.baseURI);
      dataUrl.searchParams.set("_", String(Date.now()));
      const response = await fetch(dataUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const envelope = parsePublishedLibraryEnvelope(await response.json());
      deployedEnvelopeRef.current = envelope;
      const latest = stateRef.current;
      if (!latest || latest.publicationState.status !== "valid") return;
      if (latest.publicationState.durability !== "durable") return;
      const authority = latest.publicationState;
      const journal = authority.journal;
      if (envelope.sourceCommitSha === journal.sourceCommitSha) {
        setLibraryState({ ...latest, publicationState: { ...latest.publicationState, check: "waiting-source" } });
        return;
      }

      const finalizeAdoption = async (
        deployed: PublishedLibraryEnvelope & { sourceCommitSha: string },
        reconciled: ReconciledPatch,
        verifiedPresentIds: string[],
        retainedAbsentIds: string[],
      ) => {
        if (reconciled.conflicts.length) throw new Error("Остаточный патч конфликтует с опубликованной базой");
        await verifyPublishedLocalAssets(verifiedPresentIds, deployed.database);
        const finalized = await finalizePendingPublicationJournal(localStorage, {
          deployedBaseDatabase: deployed.database,
          reconciledRemainderPatch: reconciled.patch,
          expectedJournalRaw: authority.raw,
        });
        if (finalized.status === "changed") {
          await reloadPublicationAuthority();
          return;
        }
        if (finalized.status === "failure") {
          setPersistenceError(finalized.error.message);
          setLibraryState({ ...latest, publicationState: { ...authority, check: "finalize-failed" } });
          return;
        }
        const adopted: LibraryState = {
          sourceCommitSha: deployed.sourceCommitSha,
          base: deployed.database,
          effective: reconciled.effective,
          patch: reconciled.patch,
          conflicts: [],
          retainedLocalAssetIds: [...new Set([...latest.retainedLocalAssetIds, ...retainedAbsentIds])].sort(),
          publicationState: { status: "none", exportCompleted: false },
        };
        setPersistenceError(null);
        setLibraryState(adopted);
        if (verifiedPresentIds.length) {
          await deleteLocalAssetsAtomic(verifiedPresentIds);
          await refreshLocalAssets();
          await refreshQuota();
        }
      };

      if (journal.phase === "awaiting-deployment" && envelope.sourceCommitSha === journal.targetCommitSha) {
        if (envelope.database.revision !== journal.targetRevision) {
          setLibraryState({ ...latest, publicationState: { ...authority, check: "revision-mismatch" } });
          return;
        }
        setLibraryState({ ...latest, publicationState: { ...authority, check: "asset-verification" } });
        await finalizeAdoption(
          envelope as PublishedLibraryEnvelope & { sourceCommitSha: string },
          reconcilePatch(envelope.database, journal.remainderPatch),
          [...journal.localAssetIdsAwaitingVerification],
          [],
        );
        return;
      }

      const storedPat = token === undefined ? loadGitHubPat() : null;
      const ancestryToken = token ?? (storedPat?.ok ? storedPat.token ?? undefined : undefined);
      if (!ancestryToken || envelope.sourceCommitSha === null) {
        setLibraryState({ ...latest, publicationState: { ...authority, check: "unverifiable" } });
        return;
      }
      const client = new GitHubGitDatabaseSyncClient({
        owner: GITHUB_REPOSITORY_OWNER,
        repo: GITHUB_REPOSITORY_NAME,
        branch: "main",
        token: ancestryToken,
      });
      const relation = await client.classifyDeploymentCommit(envelope.sourceCommitSha, journal.targetCommitSha);
      if (relation.status === "non_current" || relation.status === "unrelated") {
        setLibraryState({ ...latest, publicationState: { ...authority, check: relation.status === "non_current" ? "non-current" : "unrelated" } });
        return;
      }
      if (relation.status !== "descendant") {
        setLibraryState({ ...latest, publicationState: { ...authority, check: "unverifiable" } });
        return;
      }

      const recoveryBase: DeployedObservation = { sourceCommitSha: envelope.sourceCommitSha, database: envelope.database };
      const reconciled = reconcilePatch(envelope.database, journal.remainderPatch);
      const presentIds = journal.localAssetIdsAwaitingVerification.filter((id) => id in envelope.database.assets);
      const absentIds = journal.localAssetIdsAwaitingVerification.filter((id) => !(id in envelope.database.assets));
      await verifyPublishedLocalAssets(presentIds, envelope.database);
      if (reconciled.conflicts.length === 0) {
        await finalizeAdoption(
          envelope as PublishedLibraryEnvelope & { sourceCommitSha: string },
          reconciled,
          presentIds,
          absentIds,
        );
        return;
      }

      const recoveryJournal: PendingPublicationJournalV3 = {
        ...journal,
        remainderPatch: reconciled.patch,
        phase: "recovery-required",
      };
      const installed = await installPendingPublicationJournal(localStorage, recoveryJournal, {
        expectedRaw: authority.raw,
        recoveryBaseDatabase: envelope.database,
      });
      if (installed.status === "changed") {
        await reloadPublicationAuthority();
        return;
      }
      const publicationState: PublicationState = installed.status === "durable"
        ? {
          ...authority,
          durability: "durable",
          journal: installed.journal,
          raw: installed.raw,
          expectedRaw: installed.raw,
          recoveryBase,
          check: null,
          exportCompleted: false,
        }
        : {
          ...authority,
          durability: "memory-only",
          journal: installed.journal,
          raw: null,
          expectedRaw: authority.raw,
          recoveryBase,
          check: null,
          exportCompleted: false,
        };
      setLibraryState({
        ...latest,
        sourceCommitSha: envelope.sourceCommitSha,
        base: envelope.database,
        effective: reconciled.effective,
        patch: reconciled.patch,
        conflicts: reconciled.conflicts,
        publicationState,
      });
    } catch (reason) {
      const latest = stateRef.current;
      if (!latest || latest.publicationState.status !== "valid") return;
      setPersistenceError(reason instanceof Error ? `Не удалось проверить публикацию: ${reason.message}` : "Не удалось проверить публикацию");
      setLibraryState({ ...latest, publicationState: { ...latest.publicationState, check: "unverifiable" } });
    }
  }, [refreshLocalAssets, refreshQuota, reloadPublicationAuthority, setLibraryState]);

  checkPublicationRef.current = performPublicationCheck;

  useEffect(() => {
    if (state?.publicationState.status !== "valid") return;
    const timer = window.setTimeout(() => void enqueue(() => performPublicationCheck()), 2_000);
    return () => window.clearTimeout(timer);
  }, [enqueue, performPublicationCheck, state?.publicationState]);

  const mutate = useCallback((mutator: (database: LibraryDatabase, base: LibraryDatabase) => void) => enqueue(async () => {
    const current = stateRef.current;
    if (!current) throw new Error("Библиотека ещё загружается");
    if (corruptedPatchRaw !== null) throw new Error("Сначала экспортируйте или сбросьте повреждённый локальный патч");
    if (current.publicationState.status === "corrupt" || current.publicationState.status === "legacy" || current.publicationState.status === "read-failure") {
      throw new Error("Сначала экспортируйте и восстановите состояние публикации");
    }
    if (current.conflicts.length) throw new Error("Сначала разрешите конфликты локального патча");
    const next = structuredClone(current.effective);
    mutator(next, current.base);
    const normalizedNext = normalizeLibraryDatabase(next);
    assertSourceRepresentable(normalizedNext);
    const patch = diffLibrary(current.base, normalizedNext, { previousPatch: current.patch });
    await persistReconciled({ base: current.base, reconciled: reconcilePatch(current.base, patch), remember: true });
  }), [corruptedPatchRaw, enqueue, persistReconciled]);

  const saveGame = useCallback(async (input: GameSaveInput): Promise<string> => {
    const id = input.id ?? crypto.randomUUID();
    const current = stateRef.current;
    if (!current) throw new Error("Библиотека ещё загружается");
    if (current.publicationState.status === "corrupt" || current.publicationState.status === "legacy" || current.publicationState.status === "read-failure") {
      throw new Error("Сначала экспортируйте и восстановите состояние публикации");
    }
    const preparedAssets = preparedLocalAssets(input, current.base);
    if (preparedAssets.length) {
      if (!persistRequestedRef.current) {
        persistRequestedRef.current = true;
        const granted = await requestPersistentOriginStorage();
        setPersistentStorage(granted || await storageIsPersisted());
      }
      const storageError = localAssetWritePreflight(localStorage, preparedAssets.reduce((total, asset) => total + asset.byteLength, 0));
      if (storageError) throw new Error(storageError);
      try {
        await writeLocalAssetsAtomic(preparedAssets);
        setAttachmentWriteBlocked(false);
      } catch (reason) {
        await refreshQuota();
        if (isQuotaExceededError(reason)) {
          setAttachmentWriteBlocked(true);
          setPersistenceError("localStorage отклонил запись из-за квоты. Текст не потерян: закоммитьте, экспортируйте или удалите локальные вложения.");
          throw new Error("Недостаточно места в localStorage. Закоммитьте, экспортируйте или удалите локальные вложения.");
        }
        throw reason;
      }
      await refreshLocalAssets();
      await refreshQuota();
    }
    await mutate((database) => {
      const now = new Date().toISOString();
      const previous = database.games[id];
      let coverAssetId = input.coverAssetId;
      if (input.pendingCover) {
        coverAssetId = retainLocalAsset(database, assetFromPrepared(input.pendingCover), "image");
      }
      const progressItems = input.progressItems.map((item) => {
        const iconAssetId = item.pendingIcon
          ? retainLocalAsset(database, assetFromPrepared(item.pendingIcon), "image")
          : item.iconAssetId;
        if (!iconAssetId) throw new Error("Выберите иконку прогресса");
        return { id: item.id, iconAssetId, noteId: item.noteId };
      });
      const tierChanged = previous && previous.placement.tierId !== input.tierId;
      const placementRank = previous && !tierChanged
        ? previous.placement.rank
        : maxRank(Object.values(database.games).filter((game) => game.id !== id && game.placement.tierId === input.tierId).map((game) => game.placement)) + 1024;
      database.games[id] = {
        id,
        title: input.title.trim(),
        coverAssetId,
        ...(progressItems.length ? { progressItems } : {}),
        platforms: uniqueStrings(input.platforms),
        tags: uniqueStrings(input.tags),
        status: input.status,
        placement: { tierId: input.tierId, rank: placementRank },
        reviewMarkdown: input.reviewMarkdown,
        createdAt: previous?.createdAt ?? now,
        updatedAt: previous?.updatedAt ?? now,
      };

      const retainedNoteIds = new Set<string>();
      input.notes.forEach((draft, index) => {
        if (!draft.bodyMarkdown.trim() && !draft.attachments.length) return;
        const noteId = draft.id && database.notes[draft.id]?.gameId === id ? draft.id : crypto.randomUUID();
        retainedNoteIds.add(noteId);
        const attachments: NoteAttachment[] = draft.attachments.map((attachment: EditableAttachment) => {
          if (attachment.type === "pending-image") {
            const prepared = assetFromPrepared(attachment.image);
            const assetId = retainLocalAsset(database, prepared, "image");
            const asset = database.assets[assetId];
            return { type: "image", assetId, alt: attachment.alt || (asset.kind === "file" ? "" : asset.alt) };
          }
          if (attachment.type === "pending-file") {
            if (attachment.file.blob.size !== attachment.file.byteLength) throw new Error("Размер файла не совпадает с содержимым");
            const prepared: Asset = { id: attachment.file.assetId, kind: "file", mime: attachment.file.mime, byteLength: attachment.file.byteLength, originalName: attachment.file.originalName };
            const assetId = retainLocalAsset(database, prepared, "file");
            return { type: "file", assetId, label: attachment.label || attachment.file.originalName };
          }
          return attachment;
        });
        const previousNote = database.notes[noteId];
        const groupRank = draft.groupRank ?? DEFAULT_NOTE_GROUP_RANK;
        database.notes[noteId] = {
          id: noteId,
          gameId: id,
          bodyMarkdown: draft.bodyMarkdown,
          attachments,
          ...(draft.collapsedChecklistSections?.length ? { collapsedChecklistSections: [...new Set(draft.collapsedChecklistSections)] } : {}),
          ...(draft.doubleHeight ? { doubleHeight: true } : {}),
          ...(draft.doubleWidth ? { doubleWidth: true } : {}),
          ...(groupRank === DEFAULT_NOTE_GROUP_RANK ? {} : { groupRank }),
          rank: draft.rank,
          createdAt: previousNote?.createdAt ?? now,
          updatedAt: previousNote?.updatedAt ?? now,
        };
      });
      Object.values(database.notes).forEach((note) => {
        if (note.gameId === id && !retainedNoteIds.has(note.id)) delete database.notes[note.id];
      });

    });
    return id;
  }, [mutate, refreshLocalAssets, refreshQuota]);

  const deleteGame = useCallback(async (gameId: string) => mutate((database) => {
    delete database.games[gameId];
    Object.values(database.notes).forEach((note) => note.gameId === gameId && delete database.notes[note.id]);
  }), [mutate]);

  const moveGame = useCallback(async (gameId: string, tierId: TierId, index: number) => mutate((database) => {
    const moved = moveGameToTier(database, gameId, tierId, index);
    database.games = moved.games;
  }), [mutate]);

  const installPatch = useCallback((patch: PatchEnvelope, remember = true) => enqueue(async () => {
    const current = stateRef.current;
    if (!current) return;
    await persistReconciled({ base: current.base, reconciled: reconcilePatch(current.base, patch), remember });
  }), [enqueue, persistReconciled]);

  const discardPath = useCallback(async (path: string) => {
    if (!state) return;
    await installPatch(discardOperation(state.patch, path));
  }, [installPatch, state]);

  const discardPaths = useCallback(async (paths: string[]) => {
    if (!state) return;
    const blocked = new Set(paths);
    const patch = structuredClone(state.patch);
    Object.keys(patch.operations).forEach((path) => blocked.has(path) && delete patch.operations[path]);
    await installPatch(patch);
  }, [installPatch, state]);

  const clearPatch = useCallback(async () => {
    if (!state) return;
    await installPatch(emptyPatch(state.base.revision));
    setCorruptedPatchRaw(null);
    const current = stateRef.current;
    if (!current) return;
    const protectedIds = new Set([...protectedPublicationAssetIds(current.publicationState), ...current.retainedLocalAssetIds]);
    const removable = localAssetsRef.current
      .filter((asset) => asset.state === "local" && !protectedIds.has(asset.id) && !Object.prototype.hasOwnProperty.call(current.base.assets, asset.id))
      .map((asset) => asset.id);
    if (removable.length) {
      await deleteLocalAssetsAtomic(removable);
      await refreshLocalAssets();
      await refreshQuota();
    }
  }, [installPatch, protectedPublicationAssetIds, refreshLocalAssets, refreshQuota, state]);

  const resolvePatchConflict = useCallback((path: string, choice: "static" | "local", manualValue?: unknown) => enqueue(async () => {
    const current = stateRef.current;
    if (!current) return;
    const result = resolveConflict(current.base, current.patch, path, manualValue === undefined ? { choice } : { choice: "manual", value: manualValue });
    await persistReconciled({ base: current.base, reconciled: result, remember: true, reason: "conflict-resolution" });
  }), [enqueue, persistReconciled]);

  const importPatch = useCallback(async (raw: string) => {
    const parsed = normalizePatchEnvelope(JSON.parse(raw));
    const validation = validatePatch(parsed);
    if (!validation.ok || !validation.value) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
    let patch = validation.value;
    const current = stateRef.current;
    if (!current) throw new Error("Библиотека ещё загружается");
    reconcilePatch(current.base, patch);
    if (Object.keys(patch.blobs).length) {
      const assets = localAssetsFromLegacyBlobs(patch.blobs, patchAssetMetadata(patch));
      const storageError = localAssetWritePreflight(localStorage, assets.reduce((total, asset) => total + asset.byteLength, 0));
      if (storageError) throw new Error(storageError);
      try { await writeLocalAssetsAtomic(assets); }
      catch (reason) {
        if (isQuotaExceededError(reason)) {
          setAttachmentWriteBlocked(true);
          setPersistenceError("localStorage отклонил импорт из-за квоты. Исходный файл импорта не изменён.");
        }
        throw reason;
      }
      patch = { ...patch, blobs: {} };
      await refreshLocalAssets();
      await refreshQuota();
    }
    await installPatch(patch);
    setCorruptedPatchRaw(null);
  }, [installPatch, refreshLocalAssets, refreshQuota]);

  const undoLast = useCallback(() => enqueue(async () => {
    const previous = undoStack.current.pop();
    const current = stateRef.current;
    if (!previous || !current) return false;
    try {
      await persistReconciled({ base: current.base, reconciled: reconcilePatch(current.base, previous), remember: false, reason: "undo" });
      return true;
    } catch (reason) {
      undoStack.current.push(previous);
      throw reason;
    }
  }), [enqueue, persistReconciled]);

  const downloadCorruptedPatch = useCallback(() => {
    if (corruptedPatchRaw === null) return;
    const url = URL.createObjectURL(new Blob([corruptedPatchRaw], { type: "text/plain" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mylib-corrupted-local-patch.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [corruptedPatchRaw]);

  const verifyGitHubAccess = useCallback(async (token: string): Promise<void> => {
    if (syncInFlightRef.current) throw new Error("Операция с GitHub уже выполняется");
    syncInFlightRef.current = true;
    try {
      const client = new GitHubGitDatabaseSyncClient({
        owner: GITHUB_REPOSITORY_OWNER,
        repo: GITHUB_REPOSITORY_NAME,
        branch: "main",
        token,
      });
      await client.verifyWriteAccessWithTemporaryBranch();
    } catch (reason) {
      if (reason instanceof GitHubSyncError) {
        if (reason.status === 401) throw new Error("GitHub отклонил PAT. Создайте новый fine-grained PAT.");
        if (reason.status === 403) throw new Error("PAT не имеет права Contents: write либо GitHub запретил создание или удаление временной проверочной ветки.");
        if (reason.status === 404) throw new Error("GitHub не нашёл репозиторий. Проверьте, что PAT выдан только для kana-sama/mygameslist.");
      }
      throw reason;
    } finally {
      syncInFlightRef.current = false;
    }
  }, []);

  const syncToGitHub = useCallback((
    token: string,
    options?: LibraryGitHubSyncOptions,
  ): Promise<LibraryGitHubSyncResult> => enqueue(async () => {
    if (syncInFlightRef.current) throw new Error("Синхронизация уже выполняется");
    const snapshot = stateRef.current;
    if (!snapshot) throw new Error("Библиотека ещё загружается");
    if (corruptedPatchRaw !== null) throw new Error("Сначала восстановите или сбросьте повреждённый патч");
    if (snapshot.publicationState.status !== "none") throw new Error("Предыдущая публикация ещё не завершена");
    if (snapshot.sourceCommitSha === null) throw new Error("Нет подтверждённой GitHub-версии загруженной базы");
    if (snapshot.conflicts.length) throw new Error("Сначала разрешите конфликты локального патча");
    if (!Object.keys(snapshot.patch.operations).length) throw new Error("Нет локальных правок для синхронизации");
    if (options?.selectedPaths && options.selectedPaths.length === 0) throw new Error("Не выбрано ни одного изменения");

    const clickSourceCommitSha = snapshot.sourceCommitSha;
    const snapshotBase = structuredClone(snapshot.base);
    const snapshotEffective = structuredClone(snapshot.effective);
    const snapshotPatch = structuredClone(snapshot.patch);
    const partition = options?.selectedPaths
      ? resolvePatchSelection(snapshotBase, snapshotEffective, snapshotPatch, [{
        changeId: "github-sync-selection",
        operationPaths: options.selectedPaths,
      }])
      : {
        publishPatch: snapshotPatch,
        deferredPatch: emptyPatch(snapshotPatch.baseRevision),
      };
    const snapshotPublishPatch = partition.publishPatch;
    const snapshotDeferredPatch = partition.deferredPatch;
    const snapshotPublishEffective = applyPatch(snapshotBase, snapshotPublishPatch);
    const snapshotLocalAssetIds = requiredLocalAssetIds(snapshotPublishPatch, snapshotPublishEffective);
    syncInFlightRef.current = true;
    let mediaRecords: LocalAsset[] = [];
    let publicationAccepted = false;
    try {
      mediaRecords = await readLocalAssets(snapshotLocalAssetIds);
      const availableMediaIds = new Set(mediaRecords.map((record) => record.id));
      const missingMedia = snapshotLocalAssetIds.filter((id) => !availableMediaIds.has(id));
      if (missingMedia.length) throw new Error(`В localStorage отсутствуют локальные файлы: ${missingMedia.map((id) => describeAssetForRecovery(snapshotPublishEffective, id)).join("; ")}. Удалите указанные обложки или вложения и загрузите исходные файлы заново.`);
      for (const record of mediaRecords) if (record.byteLength !== record.blob.size) throw new Error(`Локальный файл ${describeAssetForRecovery(snapshotPublishEffective, record.id)} повреждён: сохранённый размер не совпадает с Blob. Удалите указанную обложку или вложение и загрузите исходный файл заново.`);
      await updateLocalAssetState(snapshotLocalAssetIds, "publishing");
      await refreshLocalAssets();
      const client = new GitHubGitDatabaseSyncClient({
        owner: GITHUB_REPOSITORY_OWNER,
        repo: GITHUB_REPOSITORY_NAME,
        branch: "main",
        token,
        onStage: options?.onStage,
      });
      const result = await client.publishSourceTree({
        deployed: { sourceCommitSha: clickSourceCommitSha, database: snapshotBase },
        selectedPatch: snapshotPublishPatch,
        localAssets: new Map(mediaRecords.map((asset) => [asset.id, asset.blob])),
      });
      const reconcileLatestRemainder = (): ReconciledPatch => {
        const latest = stateRef.current;
        if (!latest) throw new Error("Локальное состояние закрылось во время синхронизации");
        const postClickPatch = diffLibrary(snapshotEffective, latest.effective);
        const rebasedPostClickPatch = rebasePostClickOverlaps(snapshotDeferredPatch, postClickPatch);
        return reconcilePatch(result.database, mergePatchEnvelopes(snapshotDeferredPatch, rebasedPostClickPatch));
      };
      const remaining = reconcileLatestRemainder();
      if (result.status === "up_to_date") {
        publicationAccepted = true;
        if (snapshotLocalAssetIds.length) await updateLocalAssetState(snapshotLocalAssetIds, "local");
        await persistReconciled({
          base: result.database,
          reconciled: remaining,
          remember: false,
          sourceCommitSha: result.sourceCommitSha,
          publicationState: { status: "none", exportCompleted: false },
          reason: "publication",
        });
        undoStack.current = [];
        await refreshLocalAssets();
        return {
          status: "up-to-date",
          commitSha: result.sourceCommitSha,
          commitUrl: `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}/commit/${result.sourceCommitSha}`,
          pagesPending: false,
        };
      }

      if (result.sourceCommitSha !== clickSourceCommitSha) throw new Error("GitHub вернул публикацию для другой исходной версии");
      publicationAccepted = true;
      const awaitedIds = [...new Set(result.uploadedLocalAssetIds)].sort();
      const journal: PendingPublicationJournalV3 = {
        version: 3,
        sourceCommitSha: result.sourceCommitSha,
        targetCommitSha: result.targetCommitSha,
        targetRevision: result.database.revision,
        targetDatabase: result.database,
        remainderPatch: remaining.patch,
        localAssetIdsAwaitingVerification: awaitedIds,
        owner: GITHUB_REPOSITORY_OWNER,
        repo: GITHUB_REPOSITORY_NAME,
        branch: "main",
        createdAt: new Date().toISOString(),
        phase: "awaiting-deployment",
      };
      const installed = await installPendingPublicationJournal(localStorage, journal, { expectedRaw: null });
      if (installed.status === "changed") {
        await reloadPublicationAuthority();
        throw new Error("Другая вкладка уже сохранила состояние публикации");
      }
      const publicationState: PublicationState = installed.status === "durable"
        ? {
          status: "valid",
          durability: "durable",
          journal: installed.journal,
          raw: installed.raw,
          expectedRaw: installed.raw,
          recoveryBase: null,
          check: "waiting-source",
          exportCompleted: false,
        }
        : {
          status: "valid",
          durability: "memory-only",
          journal: installed.journal,
          raw: null,
          expectedRaw: null,
          recoveryBase: null,
          check: "waiting-source",
          exportCompleted: false,
        };
      setLibraryState({
        ...(stateRef.current ?? snapshot),
        sourceCommitSha: clickSourceCommitSha,
        base: result.database,
        effective: remaining.effective,
        patch: remaining.patch,
        conflicts: remaining.conflicts,
        publicationState,
      });
      undoStack.current = [];
      try {
        if (awaitedIds.length) await updateLocalAssetState(awaitedIds, "awaiting-verification");
        const reusedIds = snapshotLocalAssetIds.filter((id) => !awaitedIds.includes(id));
        if (reusedIds.length) await updateLocalAssetState(reusedIds, "local");
        await refreshLocalAssets();
      } catch (reason) {
        setPersistenceError(reason instanceof Error ? reason.message : "Не удалось обновить состояние локальных файлов");
      }
      return {
        status: "committed",
        commitSha: result.targetCommitSha,
        commitUrl: `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}/commit/${result.targetCommitSha}`,
        pagesPending: true,
      };
    } catch (reason) {
      if (reason instanceof GitHubSyncError) {
        if (reason.status === 401) throw new Error("GitHub отклонил PAT. Создайте новый fine-grained PAT.");
        if (reason.status === 403) throw new Error("PAT не имеет права Contents: write либо запись в main запрещена правилами репозитория.");
        if (reason.status === 404) throw new Error("GitHub не нашёл репозиторий. Проверьте доступ к репозиторию.");
        if (reason.code === "stale_deployment") throw new Error("На сайте загружена не самая свежая версия main. Перезагрузите страницу и повторите попытку.");
        if (reason.code === "concurrent_update") throw new Error("Ветка main изменилась во время синхронизации. Перезагрузите страницу и повторите попытку.");
      }
      throw reason;
    } finally {
      if (!publicationAccepted && snapshotLocalAssetIds.length) {
        await updateLocalAssetState(snapshotLocalAssetIds, "local").catch(() => undefined);
        await refreshLocalAssets();
      }
      syncInFlightRef.current = false;
    }
  }), [corruptedPatchRaw, enqueue, persistReconciled, refreshLocalAssets, reloadPublicationAuthority, setLibraryState]);

  const fallbackBase = useMemo<LibraryDatabase>(() => ({ schemaVersion: LIBRARY_SCHEMA_VERSION, revision: "", publicationId: null, games: {}, notes: {}, assets: {} }), []);
  const resolvedState = state ?? { sourceCommitSha: null, base: fallbackBase, effective: fallbackBase, patch: emptyPatch(""), conflicts: [], publicationState: { status: "none", exportCompleted: false } as PublicationState, retainedLocalAssetIds: [] };
  const usage = state ? patchUsage(state.patch) : classifyStorageUsage(typeof localStorage === "undefined" ? 0 : (() => { try { return webkitStorageBytes(localStorage); } catch { return 0; } })(), SAFARI_SAFE_BUDGET_BYTES);
  const canAddBlob = useCallback(async (byteLength: number): Promise<string | null> => {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return "Некорректный размер файла";
    if (attachmentWriteBlocked) return "Новые вложения заблокированы после отказа localStorage. Закоммитьте, экспортируйте или освободите место.";
    if (!persistRequestedRef.current) {
      persistRequestedRef.current = true;
      const granted = await requestPersistentOriginStorage();
      setPersistentStorage(granted || await storageIsPersisted());
    }
    const storageError = localAssetWritePreflight(localStorage, byteLength);
    await refreshQuota();
    return storageError;
  }, [attachmentWriteBlocked, refreshQuota]);
  const resolveAssetUrl = useCallback((assetId: string): string | null => {
    const asset = resolvedState.effective.assets[assetId];
    if (!asset) return null;
    return localAssetUrls[assetId] ?? publishedAssetUrl(asset, import.meta.env.BASE_URL);
  }, [localAssetUrls, resolvedState.effective.assets]);
  const retryPublicationPersistence = useCallback(() => enqueue(async () => {
    const current = stateRef.current;
    if (!current || current.publicationState.status !== "valid" || current.publicationState.durability !== "memory-only") return;
    const authority = current.publicationState;
    const installed = await installPendingPublicationJournal(localStorage, authority.journal, {
      expectedRaw: authority.expectedRaw,
      ...(authority.journal.phase === "recovery-required" && authority.recoveryBase
        ? { recoveryBaseDatabase: authority.recoveryBase.database }
        : {}),
    });
    if (installed.status === "changed") {
      await reloadPublicationAuthority();
      return;
    }
    if (installed.status === "memory_only") {
      setPersistenceError(`${installed.error.message}. Не закрывайте вкладку; экспортируйте локальную копию.`);
      setLibraryState({ ...current, publicationState: { ...authority, journal: installed.journal } });
      return;
    }
    setPersistenceError(null);
    setLibraryState({
      ...current,
      publicationState: { ...authority, durability: "durable", journal: installed.journal, raw: installed.raw, expectedRaw: installed.raw },
    });
  }), [enqueue, reloadPublicationAuthority, setLibraryState]);

  const retryPublicationCheck = useCallback((token?: string) => enqueue(async () => {
    await checkPublicationRef.current(token);
  }), [enqueue]);

  const exportPublicationRecovery = useCallback(() => enqueue(async () => {
    const current = stateRef.current;
    if (!current) throw new Error("Библиотека ещё загружается");
    const assets = await listLocalAssets();
    let ordinaryPatchRaw: string | null = null;
    try { ordinaryPatchRaw = localStorage.getItem(PATCH_STORAGE_KEY); }
    catch { /* The explicit pending state still remains exportable. */ }
    const pending = current.publicationState.status === "none"
      ? { status: "none" as const }
      : current.publicationState.status === "valid"
        ? current.publicationState.durability === "durable"
          ? { status: "durable" as const, journal: current.publicationState.journal, raw: current.publicationState.raw }
          : { status: "memory-only" as const, journal: current.publicationState.journal }
        : current.publicationState.status === "corrupt" || current.publicationState.status === "legacy"
          ? { status: current.publicationState.status, raw: current.publicationState.raw }
          : { status: "read-failure" as const };
    const archive = await createRecoveryArchive({
      database: current.effective,
      patch: current.patch,
      ordinaryPatchRaw,
      localAssets: assets,
      deployedSourceCommitSha: deployedEnvelopeRef.current?.sourceCommitSha ?? current.sourceCommitSha,
      pending,
    });
    downloadRecoveryArchive(archive);
    const latest = stateRef.current;
    if (!latest || latest.publicationState.status === "none" || latest.publicationState.status === "read-failure") return;
    setLibraryState({ ...latest, publicationState: { ...latest.publicationState, exportCompleted: true } });
  }), [enqueue, setLibraryState]);

  const exportRecoveryArchive = exportPublicationRecovery;
  const discardPublicationAfterExport = useCallback(() => enqueue(async () => {
    const current = stateRef.current;
    if (!current || current.publicationState.status === "none") return;
    if (current.publicationState.status === "read-failure") throw new Error("Safari не разрешил проверить recovery journal");
    if (!current.publicationState.exportCompleted) throw new Error("Сначала экспортируйте локальную копию");
    if (
      current.publicationState.status === "valid"
      && current.publicationState.journal.phase !== "recovery-required"
    ) throw new Error("Ожидающую публикацию нельзя отбросить до проверки deployment");

    const deployed = deployedEnvelopeRef.current;
    if (!deployed) throw new Error("Нет подтверждённой опубликованной базы");
    const awaitedIds = current.publicationState.status === "valid"
      ? [...current.publicationState.journal.localAssetIdsAwaitingVerification]
      : [];
    let expectedRaw = current.publicationState.status === "valid"
      ? current.publicationState.durability === "durable"
        ? current.publicationState.raw
        : current.publicationState.expectedRaw
      : current.publicationState.raw;
    if (current.publicationState.status === "valid" && current.publicationState.durability === "memory-only") {
      const promoted = await promoteMemoryOnlyPublicationForDiscard(localStorage, current.publicationState);
      if (promoted.status === "changed") {
        await reloadPublicationAuthority();
        return;
      }
      if (promoted.status === "memory_only") throw promoted.error;
      expectedRaw = promoted.raw;
    }

    const neutralized = savePatch(localStorage, emptyPatch(deployed.database.revision));
    if (!neutralized.ok) throw neutralized.error ?? new Error("Не удалось нейтрализовать старый локальный патч");
    const confirmedNeutralized = loadPatch(localStorage);
    if (confirmedNeutralized.error || confirmedNeutralized.raw !== null || confirmedNeutralized.patch !== null) {
      throw new Error("Safari не подтвердил удаление старого локального патча");
    }

    if (expectedRaw !== null) {
      const discarded = await discardPendingPublicationAfterRecoveryExport(localStorage, expectedRaw);
      if (discarded.status === "changed") {
        await reloadPublicationAuthority();
        return;
      }
      if (discarded.status === "failure") throw discarded.error;
      if (discarded.status === "not_recoverable") throw new Error("Это состояние нельзя отбросить через recovery flow");
    }
    if (awaitedIds.length) await updateLocalAssetState(awaitedIds, "local");
    setPersistenceError(null);
    setLibraryState({
      sourceCommitSha: deployed.sourceCommitSha,
      base: deployed.database,
      effective: deployed.database,
      patch: emptyPatch(deployed.database.revision),
      conflicts: [],
      retainedLocalAssetIds: [...new Set([...current.retainedLocalAssetIds, ...awaitedIds])].sort(),
      publicationState: { status: "none", exportCompleted: false },
    });
    await refreshLocalAssets();
    await refreshQuota();
  }), [enqueue, refreshLocalAssets, refreshQuota, reloadPublicationAuthority, setLibraryState]);
  const reloadPage = useCallback(() => window.location.reload(), []);

  useEffect(() => {
    if (state?.publicationState.status !== "valid" || state.publicationState.durability !== "memory-only") return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state?.publicationState]);
  const deleteAllLocalAssets = useCallback(async () => {
    const current = stateRef.current;
    if (!current) throw new Error("Библиотека ещё загружается");
    const records = await listLocalAssets();
    const protectedIds = new Set([...protectedPublicationAssetIds(current.publicationState), ...current.retainedLocalAssetIds]);
    const deletable = records.filter((asset) => asset.state === "local" && !protectedIds.has(asset.id));
    const unpublished = new Set(deletable.filter((asset) => !Object.prototype.hasOwnProperty.call(current.base.assets, asset.id)).map((asset) => asset.id));
    if (unpublished.size) await mutate((database) => {
      Object.values(database.games).forEach((game) => {
        if (game.coverAssetId && unpublished.has(game.coverAssetId)) game.coverAssetId = null;
        if (game.progressItems) {
          game.progressItems = game.progressItems.filter((item) => !unpublished.has(item.iconAssetId));
          if (!game.progressItems.length) delete game.progressItems;
        }
      });
      Object.values(database.notes).forEach((note) => { note.attachments = note.attachments.filter((attachment) => attachment.type === "link" || !unpublished.has(attachment.assetId)); });
      unpublished.forEach((id) => delete database.assets[id]);
    });
    if (deletable.length) await deleteLocalAssetsAtomic(deletable.map((asset) => asset.id));
    if (deletable.length !== records.length) setPersistenceError(`Сохранено защищённых локальных файлов: ${records.length - deletable.length}`);
    setAttachmentWriteBlocked(false);
    await refreshLocalAssets();
    await refreshQuota();
  }, [mutate, protectedPublicationAssetIds, refreshLocalAssets, refreshQuota]);
  const localAssetBytes = localAssets.reduce((total, asset) => total + asset.byteLength, 0);
  const value = useMemo<LibraryContextValue>(() => ({
    ...resolvedState,
    loading,
    fatalError,
    persistenceError,
    corruptedPatchRaw,
    usage,
    storageEstimate,
    quotaStatus,
    persistentStorage,
    attachmentsBlocked: attachmentWriteBlocked || quotaStatus.level === "blocked",
    localAssets,
    localAssetBytes,
    games: resolvedState.effective.games,
    canAddBlob,
    resolveAssetUrl,
    saveGame,
    deleteGame,
    moveGame,
    discardPath,
    discardPaths,
    clearPatch,
    resolvePatchConflict,
    importPatch,
    undoLast,
    downloadCorruptedPatch,
    exportRecoveryArchive,
    retryPublicationPersistence,
    retryPublicationCheck,
    exportPublicationRecovery,
    discardPublicationAfterExport,
    reloadPage,
    deleteAllLocalAssets,
    verifyGitHubAccess,
    syncToGitHub,
  }), [resolvedState, loading, fatalError, persistenceError, corruptedPatchRaw, usage, storageEstimate, quotaStatus, persistentStorage, attachmentWriteBlocked, localAssets, localAssetBytes, canAddBlob, resolveAssetUrl, saveGame, deleteGame, moveGame, discardPath, discardPaths, clearPatch, resolvePatchConflict, importPatch, undoLast, downloadCorruptedPatch, exportRecoveryArchive, retryPublicationPersistence, retryPublicationCheck, exportPublicationRecovery, discardPublicationAfterExport, reloadPage, deleteAllLocalAssets, verifyGitHubAccess, syncToGitHub]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary must be used inside LibraryProvider");
  return value;
}

export function operationLocalValue(database: LibraryDatabase, path: string): unknown {
  const parsed = parsePatchPath(path);
  if (!parsed) return undefined;
  const entity = database[parsed.map][parsed.id] as unknown as Record<string, unknown> | undefined;
  return parsed.field ? entity?.[parsed.field] : entity;
}
