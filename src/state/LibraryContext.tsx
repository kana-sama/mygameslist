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
  assertValidLibrary,
  assetDataUrl,
  base64ToBytes,
  classifyStorageUsage,
  computeLibraryRevision,
  diffLibrary,
  discardOperation,
  loadPatch,
  makeExternalWebPAsset,
  makeFileAsset,
  moveGameToTier,
  normalizePatchEnvelope,
  parsePatchPath,
  projectedStorageUsage,
  publishedAssetUrl,
  reconcilePatch,
  resolveConflict,
  savePatch,
  validatePatch,
  webkitStorageBytes,
  webkitStringBytes,
  DEFAULT_NOTE_GROUP_RANK,
  LIBRARY_SCHEMA_VERSION,
  type Asset,
  type LibraryDatabase,
  type NoteAttachment,
  type PatchConflict,
  type PatchEnvelope,
  type ReconciledPatch,
  type StorageUsage,
  type TierId,
} from "../domain";
import {
  PENDING_PUBLICATION_STORAGE_KEY,
  clearPendingPublication,
  installPendingPublication,
  loadPendingPublication,
  type PendingPublicationReceipt,
} from "./pendingPublication";
import {
  GitHubGitDatabaseSyncClient,
  GitHubPatchConflictError,
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

function assetFromPrepared(image: { base64: string; width: number; height: number; alt: string; originalName: string }) {
  return makeExternalWebPAsset(base64ToBytes(image.base64), image.width, image.height, image.alt, image.originalName);
}

function retainLocalAsset(database: LibraryDatabase, base: LibraryDatabase, blobs: Record<string, string>, prepared: { asset: Asset; base64: string }, expectedKind: "image" | "file"): string {
  const existing = database.assets[prepared.asset.id];
  if (existing) {
    const compatible = expectedKind === "file" ? existing.kind === "file" : existing.kind !== "file";
    if (!compatible) throw new Error("Файл с тем же содержимым уже сохранён как другой тип asset");
    return existing.id;
  }
  database.assets[prepared.asset.id] = prepared.asset;
  if (!Object.prototype.hasOwnProperty.call(base.assets, prepared.asset.id)) blobs[prepared.asset.id] = prepared.base64;
  return prepared.asset.id;
}

function garbageCollectAssets(database: LibraryDatabase, staticAssets: LibraryDatabase["assets"]): void {
  const referenced = new Set<string>();
  Object.values(database.games).forEach((game) => game.coverAssetId && referenced.add(game.coverAssetId));
  Object.values(database.notes).forEach((note) => note.attachments.forEach((attachment) => {
    if (attachment.type === "image" || attachment.type === "file") referenced.add(attachment.assetId);
  }));
  Object.keys(database.assets).forEach((id) => {
    if (!referenced.has(id) && !Object.prototype.hasOwnProperty.call(staticAssets, id)) delete database.assets[id];
  });
}

function patchUsage(patch: PatchEnvelope): StorageUsage {
  try {
    return projectedStorageUsage(localStorage, PATCH_STORAGE_KEY, JSON.stringify(patch));
  } catch {
    return classifyStorageUsage(webkitStringBytes(PATCH_STORAGE_KEY, JSON.stringify(patch)));
  }
}

function samePublishedVersion(left: LibraryDatabase, right: LibraryDatabase): boolean {
  return left.revision === right.revision
    || left.publicationId !== null && left.publicationId === right.publicationId;
}

async function deployedVersionIsGitHubHead(deployed: LibraryDatabase): Promise<boolean> {
  const credential = loadGitHubPat();
  if (!credential.ok || !credential.token) return false;
  try {
    const client = new GitHubGitDatabaseSyncClient({
      owner: GITHUB_REPOSITORY_OWNER,
      repo: GITHUB_REPOSITORY_NAME,
      branch: "main",
      token: credential.token,
    });
    const latest = await client.fetchLatestLibrary();
    return samePublishedVersion(deployed, latest.database);
  } catch {
    return false;
  }
}

interface LibraryState {
  base: LibraryDatabase;
  effective: LibraryDatabase;
  patch: PatchEnvelope;
  conflicts: PatchConflict[];
  pendingPublication: PendingPublicationReceipt | null;
}

export interface LibraryGitHubSyncResult {
  status: "committed" | "up-to-date";
  commitSha: string;
  commitUrl: string;
  pagesPending: boolean;
}

export interface LibraryContextValue extends LibraryState {
  loading: boolean;
  fatalError: string | null;
  persistenceError: string | null;
  corruptedPatchRaw: string | null;
  usage: StorageUsage;
  storageEstimate: { usage?: number; quota?: number } | null;
  games: LibraryDatabase["games"];
  canAddBlob: (byteLength: number) => string | null;
  resolveAssetUrl: (assetId: string) => string | null;
  saveGame: (input: GameSaveInput) => Promise<string>;
  deleteGame: (gameId: string) => void;
  moveGame: (gameId: string, tierId: TierId, index: number) => void;
  discardPath: (path: string) => void;
  discardPaths: (paths: string[]) => void;
  clearPatch: () => void;
  resolvePatchConflict: (path: string, choice: "static" | "local", manualValue?: unknown) => void;
  importPatch: (raw: string) => void;
  undoLast: () => boolean;
  downloadCorruptedPatch: () => void;
  syncToGitHub: (token: string, onStage?: (stage: GitHubSyncStage) => void) => Promise<LibraryGitHubSyncResult>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LibraryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [corruptedPatchRaw, setCorruptedPatchRaw] = useState<string | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const undoStack = useRef<PatchEnvelope[]>([]);
  const stateRef = useRef<LibraryState | null>(null);
  const syncInFlightRef = useRef(false);

  const setLibraryState = useCallback((next: LibraryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const installReconciled = useCallback((
    base: LibraryDatabase,
    reconciled: ReconciledPatch,
    remember = false,
    pendingPublication = stateRef.current?.pendingPublication ?? null,
  ) => {
    assertValidLibrary(reconciled.effective);
    let written;
    try {
      written = savePatch(localStorage, reconciled.patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Safari не разрешил доступ к localStorage";
      setPersistenceError(message);
      throw new Error(message);
    }
    if (!written.ok) {
      const message = written.error?.message ?? "Safari не сохранил локальный патч";
      setPersistenceError(message);
      throw new Error(message);
    }
    const current = stateRef.current;
    if (remember && current) undoStack.current = [...undoStack.current.slice(-49), structuredClone(current.patch)];
    setPersistenceError(null);
    setLibraryState({ base, effective: reconciled.effective, patch: reconciled.patch, conflicts: reconciled.conflicts, pendingPublication });
  }, [setLibraryState]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const dataUrl = new URL(`${import.meta.env.BASE_URL}data/library.json`, document.baseURI);
        dataUrl.searchParams.set("_", String(Date.now()));
        const response = await fetch(dataUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`Не удалось загрузить библиотеку: HTTP ${response.status}`);
        const parsed: unknown = await response.json();
        assertValidLibrary(parsed);
        const deployedBase = structuredClone(parsed);
        const computedRevision = computeLibraryRevision(deployedBase);
        if (deployedBase.revision && deployedBase.revision !== computedRevision) throw new Error("Revision опубликованной базы не совпадает с её содержимым");
        deployedBase.revision = computedRevision;

        let base = deployedBase;
        let pendingPublication: PendingPublicationReceipt | null = null;
        try {
          const pending = loadPendingPublication(localStorage);
          if (pending.error) {
            setPersistenceError(pending.error.message);
          } else if (pending.receipt) {
            const sameTarget = pending.receipt.owner === GITHUB_REPOSITORY_OWNER
              && pending.receipt.repo === GITHUB_REPOSITORY_NAME
              && pending.receipt.branch === "main";
            const publicationArrived = sameTarget && samePublishedVersion(deployedBase, pending.receipt.database);
            const pagesStillAtSource = sameTarget && deployedBase.revision === pending.receipt.sourceRevision;
            const pagesAtCurrentHead = sameTarget && !publicationArrived && !pagesStillAtSource
              ? await deployedVersionIsGitHubHead(deployedBase)
              : false;
            if (publicationArrived || pagesAtCurrentHead) {
              clearPendingPublication(localStorage);
            } else if (sameTarget) {
              base = structuredClone(pending.receipt.database);
              pendingPublication = pending.receipt;
            } else {
              setPersistenceError("Ожидающая публикация относится к другому репозиторию");
            }
          }
        } catch {
          setPersistenceError("Safari не разрешил прочитать состояние синхронизации");
        }

        let patch = emptyPatch(base.revision);
        let patchIsCorrupted = false;
        try {
          const loaded = loadPatch(localStorage);
          if (loaded.error) {
            patchIsCorrupted = true;
            setCorruptedPatchRaw(loaded.raw);
            setPersistenceError("Локальный патч повреждён. Его можно скачать из окна правок.");
          } else if (loaded.patch) patch = loaded.patch;
        } catch (error) {
          setPersistenceError(error instanceof Error ? error.message : "localStorage недоступен");
        }
        let reconciled: ReconciledPatch;
        try {
          reconciled = reconcilePatch(base, patch);
          assertValidLibrary(reconciled.effective);
        } catch (error) {
          patchIsCorrupted = true;
          let raw: string | null = null;
          try { raw = localStorage.getItem(PATCH_STORAGE_KEY); } catch { /* localStorage may be unavailable */ }
          setCorruptedPatchRaw(raw);
          setPersistenceError(error instanceof Error ? `Локальный патч нельзя применить: ${error.message}` : "Локальный патч нельзя применить");
          reconciled = reconcilePatch(base, emptyPatch(base.revision));
        }
        if (!active) return;
        if (!patchIsCorrupted) {
          try {
            const written = savePatch(localStorage, reconciled.patch);
            if (!written.ok) setPersistenceError(written.error?.message ?? "Safari не сохранил патч");
          } catch (error) {
            setPersistenceError(error instanceof Error ? error.message : "localStorage недоступен");
          }
        }
        setLibraryState({ base, effective: reconciled.effective, patch: reconciled.patch, conflicts: reconciled.conflicts, pendingPublication });
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
  }, [setLibraryState]);

  useEffect(() => {
    let active = true;
    void navigator.storage?.estimate?.().then((estimate) => {
      if (active) setStorageEstimate({ usage: estimate.usage, quota: estimate.quota });
    }).catch(() => { /* This is diagnostics only; localStorage uses the fixed WebKit budget. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!state) return;
    let timer: number | undefined;
    const installStoredState = () => {
      const current = stateRef.current;
      if (!current) return;
      const pending = loadPendingPublication(localStorage);
      if (pending.error) {
        setPersistenceError(pending.error.message);
        return;
      }
      if (pending.receipt) {
        const sameTarget = pending.receipt.owner === GITHUB_REPOSITORY_OWNER
          && pending.receipt.repo === GITHUB_REPOSITORY_NAME
          && pending.receipt.branch === "main";
        if (!sameTarget) {
          setPersistenceError("Ожидающая публикация относится к другому репозиторию");
          return;
        }
        const loaded = loadPatch(localStorage);
        if (loaded.error) {
          setCorruptedPatchRaw(loaded.raw);
          setPersistenceError("Патч из другой вкладки повреждён. Скачайте raw-значение перед сбросом.");
          return;
        }
        try {
          const base = structuredClone(pending.receipt.database);
          const patch = loaded.patch ?? emptyPatch(base.revision);
          const reconciled = reconcilePatch(base, patch);
          assertValidLibrary(reconciled.effective);
          setCorruptedPatchRaw(null);
          setPersistenceError(null);
          setLibraryState({ base, effective: reconciled.effective, patch: reconciled.patch, conflicts: reconciled.conflicts, pendingPublication: pending.receipt });
        } catch (error) {
          setCorruptedPatchRaw(loaded.raw);
          setPersistenceError(error instanceof Error ? `Патч из другой вкладки повреждён: ${error.message}` : "Патч из другой вкладки повреждён");
        }
        return;
      }

      // The tab that observed Pages clears the receipt first; other tabs keep
      // their in-memory bridge until their own poll fetches the deployed base.
      if (current.pendingPublication) return;
      const loaded = loadPatch(localStorage);
      if (loaded.patch) {
        try {
          const reconciled = reconcilePatch(current.base, loaded.patch);
          assertValidLibrary(reconciled.effective);
          setCorruptedPatchRaw(null);
          setLibraryState({ base: current.base, effective: reconciled.effective, patch: reconciled.patch, conflicts: reconciled.conflicts, pendingPublication: null });
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
        setLibraryState({ base: current.base, effective: current.base, patch, conflicts: [], pendingPublication: null });
      }
    };
    const receive = (event: StorageEvent) => {
      if (event.key !== PATCH_STORAGE_KEY && event.key !== PENDING_PUBLICATION_STORAGE_KEY) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(installStoredState, 0);
    };
    window.addEventListener("storage", receive);
    return () => {
      window.removeEventListener("storage", receive);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [setLibraryState, state?.base]);

  useEffect(() => {
    const pending = state?.pendingPublication;
    if (!pending) return;
    let active = true;
    let timer: number | undefined;
    const checkedNonTargetRevisions = new Set<string>();
    const check = async () => {
      try {
        const dataUrl = new URL(`${import.meta.env.BASE_URL}data/library.json`, document.baseURI);
        dataUrl.searchParams.set("_", String(Date.now()));
        const response = await fetch(dataUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const deployed: unknown = await response.json();
        assertValidLibrary(deployed);
        const deployedBase = structuredClone(deployed);
        const revision = computeLibraryRevision(deployedBase);
        if (deployedBase.revision && deployedBase.revision !== revision) throw new Error("Некорректная revision");
        deployedBase.revision = revision;
        if (!active) return;
        let publicationArrived = samePublishedVersion(deployedBase, pending.database);
        if (
          !publicationArrived
          && deployedBase.revision !== pending.sourceRevision
          && !checkedNonTargetRevisions.has(deployedBase.revision)
        ) {
          checkedNonTargetRevisions.add(deployedBase.revision);
          publicationArrived = await deployedVersionIsGitHubHead(deployedBase);
        }
        if (!publicationArrived) {
          timer = window.setTimeout(() => void check(), 5_000);
          return;
        }
        const current = stateRef.current;
        if (!current || current.pendingPublication?.commitSha !== pending.commitSha) return;
        const reconciled = reconcilePatch(deployedBase, current.patch);
        installReconciled(deployedBase, reconciled, false, null);
        clearPendingPublication(localStorage);
      } catch {
        if (active) timer = window.setTimeout(() => void check(), 10_000);
      }
    };
    timer = window.setTimeout(() => void check(), 2_000);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [installReconciled, state?.pendingPublication]);

  const mutate = useCallback((mutator: (database: LibraryDatabase, base: LibraryDatabase, blobs: Record<string, string>) => void) => {
    const current = stateRef.current;
    if (!current) throw new Error("Библиотека ещё загружается");
    if (corruptedPatchRaw !== null) throw new Error("Сначала экспортируйте или сбросьте повреждённый локальный патч");
    if (current.conflicts.length) throw new Error("Сначала разрешите конфликты локального патча");
    const next = structuredClone(current.effective);
    const blobs = structuredClone(current.patch.blobs);
    mutator(next, current.base, blobs);
    assertValidLibrary(next);
    const patch = diffLibrary(current.base, next, { previousPatch: current.patch, blobs });
    installReconciled(current.base, reconcilePatch(current.base, patch), true, current.pendingPublication);
  }, [corruptedPatchRaw, installReconciled]);

  const saveGame = useCallback(async (input: GameSaveInput): Promise<string> => {
    const id = input.id ?? crypto.randomUUID();
    mutate((database, base, blobs) => {
      const now = new Date().toISOString();
      const previous = database.games[id];
      let coverAssetId = input.coverAssetId;
      if (input.pendingCover) {
        coverAssetId = retainLocalAsset(database, base, blobs, assetFromPrepared(input.pendingCover), "image");
      }
      const tierChanged = previous && previous.placement.tierId !== input.tierId;
      const placementRank = previous && !tierChanged
        ? previous.placement.rank
        : maxRank(Object.values(database.games).filter((game) => game.id !== id && game.placement.tierId === input.tierId).map((game) => game.placement)) + 1024;
      database.games[id] = {
        id,
        title: input.title.trim(),
        coverAssetId,
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
            const assetId = retainLocalAsset(database, base, blobs, prepared, "image");
            const asset = database.assets[assetId];
            return { type: "image", assetId, alt: attachment.alt || (asset.kind === "file" ? "" : asset.alt) };
          }
          if (attachment.type === "pending-file") {
            const bytes = base64ToBytes(attachment.file.base64);
            if (bytes.byteLength !== attachment.file.byteLength) throw new Error("Размер файла не совпадает с содержимым");
            const assetId = retainLocalAsset(database, base, blobs, makeFileAsset(bytes, attachment.file.mime, attachment.file.originalName), "file");
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
          ...(groupRank === DEFAULT_NOTE_GROUP_RANK ? {} : { groupRank }),
          rank: draft.rank,
          createdAt: previousNote?.createdAt ?? now,
          updatedAt: previousNote?.updatedAt ?? now,
        };
      });
      Object.values(database.notes).forEach((note) => {
        if (note.gameId === id && !retainedNoteIds.has(note.id)) delete database.notes[note.id];
      });

      garbageCollectAssets(database, base.assets);
    });
    return id;
  }, [mutate]);

  const deleteGame = useCallback((gameId: string) => mutate((database, base) => {
    delete database.games[gameId];
    Object.values(database.notes).forEach((note) => note.gameId === gameId && delete database.notes[note.id]);
    garbageCollectAssets(database, base.assets);
  }), [mutate]);

  const moveGame = useCallback((gameId: string, tierId: TierId, index: number) => mutate((database) => {
    const moved = moveGameToTier(database, gameId, tierId, index);
    database.games = moved.games;
  }), [mutate]);

  const installPatch = useCallback((patch: PatchEnvelope, remember = true) => {
    if (!state) return;
    installReconciled(state.base, reconcilePatch(state.base, patch), remember);
  }, [installReconciled, state]);

  const discardPath = useCallback((path: string) => {
    if (!state) return;
    installPatch(discardOperation(state.patch, path));
  }, [installPatch, state]);

  const discardPaths = useCallback((paths: string[]) => {
    if (!state) return;
    const blocked = new Set(paths);
    const patch = structuredClone(state.patch);
    Object.keys(patch.operations).forEach((path) => blocked.has(path) && delete patch.operations[path]);
    installPatch(patch);
  }, [installPatch, state]);

  const clearPatch = useCallback(() => {
    if (!state) return;
    installPatch(emptyPatch(state.base.revision));
    setCorruptedPatchRaw(null);
  }, [installPatch, state]);

  const resolvePatchConflict = useCallback((path: string, choice: "static" | "local", manualValue?: unknown) => {
    if (!state) return;
    const result = resolveConflict(state.base, state.patch, path, manualValue === undefined ? { choice } : { choice: "manual", value: manualValue });
    installReconciled(state.base, result, true);
  }, [installReconciled, state]);

  const importPatch = useCallback((raw: string) => {
    const parsed = normalizePatchEnvelope(JSON.parse(raw));
    const validation = validatePatch(parsed);
    if (!validation.ok || !validation.value) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
    installPatch(validation.value);
    setCorruptedPatchRaw(null);
  }, [installPatch]);

  const undoLast = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous || !state) return false;
    installReconciled(state.base, reconcilePatch(state.base, previous), false);
    return true;
  }, [installReconciled, state]);

  const downloadCorruptedPatch = useCallback(() => {
    if (corruptedPatchRaw === null) return;
    const url = URL.createObjectURL(new Blob([corruptedPatchRaw], { type: "text/plain" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mylib-corrupted-local-patch.txt"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [corruptedPatchRaw]);

  const syncToGitHub = useCallback(async (
    token: string,
    onStage?: (stage: GitHubSyncStage) => void,
  ): Promise<LibraryGitHubSyncResult> => {
    if (syncInFlightRef.current) throw new Error("Синхронизация уже выполняется");
    const snapshot = stateRef.current;
    if (!snapshot) throw new Error("Библиотека ещё загружается");
    if (corruptedPatchRaw !== null) throw new Error("Сначала восстановите или сбросьте повреждённый патч");
    if (snapshot.conflicts.length) throw new Error("Сначала разрешите конфликты локального патча");
    if (!Object.keys(snapshot.patch.operations).length) throw new Error("Нет локальных правок для синхронизации");

    syncInFlightRef.current = true;
    const snapshotEffective = structuredClone(snapshot.effective);
    const snapshotPatch = structuredClone(snapshot.patch);
    try {
      const client = new GitHubGitDatabaseSyncClient({
        owner: GITHUB_REPOSITORY_OWNER,
        repo: GITHUB_REPOSITORY_NAME,
        branch: "main",
        token,
        onStage,
      });

      let result;
      for (let attempt = 0; ; attempt += 1) {
        try {
          result = await client.publishPatch(snapshotPatch);
          break;
        } catch (reason) {
          if (reason instanceof GitHubSyncError && reason.code === "concurrent_update" && attempt === 0) continue;
          if (reason instanceof GitHubPatchConflictError) {
            const current = stateRef.current;
            if (current) {
              const reconciliation = reconcilePatch(reason.latestDatabase, current.patch);
              const existingPendingBlobs = current.pendingPublication?.blobs ?? {};
              const receiptBlobs = Object.fromEntries(Object.entries(existingPendingBlobs).filter(([id]) => id in reason.latestDatabase.assets));
              if (reason.latestDatabase.publicationId !== null && reason.latestDatabase.revision !== current.base.revision) {
                const receipt: PendingPublicationReceipt = {
                  version: 1,
                  owner: GITHUB_REPOSITORY_OWNER,
                  repo: GITHUB_REPOSITORY_NAME,
                  branch: "main",
                  sourceRevision: current.pendingPublication?.sourceRevision ?? current.base.revision,
                  commitSha: reason.latestSnapshot.headSha,
                  createdAt: new Date().toISOString(),
                  database: reason.latestDatabase,
                  blobs: receiptBlobs,
                };
                const installed = installPendingPublication(localStorage, receipt, reconciliation.patch);
                if (installed.ok) {
                  undoStack.current = [];
                  setPersistenceError(null);
                  setLibraryState({ base: reason.latestDatabase, effective: reconciliation.effective, patch: reconciliation.patch, conflicts: reconciliation.conflicts, pendingPublication: receipt });
                } else {
                  setPersistenceError(`${installed.error.message}. Конфликты сохранятся только до перезагрузки.`);
                  setLibraryState({ base: reason.latestDatabase, effective: reconciliation.effective, patch: reconciliation.patch, conflicts: reconciliation.conflicts, pendingPublication: receipt });
                }
              } else {
                installReconciled(reason.latestDatabase, reconciliation, false, current.pendingPublication);
              }
            }
            throw new Error("В main изменились те же поля. Разрешите появившиеся конфликты и повторите синхронизацию.");
          }
          if (reason instanceof GitHubSyncError) {
            if (reason.status === 401) throw new Error("GitHub отклонил PAT. Создайте новый fine-grained PAT.");
            if (reason.status === 403) throw new Error("PAT не имеет права Contents: write либо запись в main запрещена правилами репозитория.");
            if (reason.status === 404) throw new Error("GitHub не нашёл репозиторий. Проверьте, что PAT выдан только для kana-sama/mygameslist.");
            if (reason.code === "concurrent_update") throw new Error("Ветка main снова изменилась во время синхронизации. Повторите попытку.");
          }
          throw reason;
        }
      }

      const current = stateRef.current;
      if (!current) throw new Error("Локальное состояние закрылось во время синхронизации");
      const postClickPatch = diffLibrary(snapshotEffective, current.effective, {
        previousPatch: current.patch,
        blobs: current.patch.blobs,
      });
      const remaining = reconcilePatch(result.database, postClickPatch);
      const pagesPending = result.status === "committed"
        || result.database.revision !== snapshot.base.revision
        || snapshot.pendingPublication !== null;

      if (pagesPending) {
        const mergedBlobCandidates = {
          ...(snapshot.pendingPublication?.blobs ?? {}),
          ...snapshotPatch.blobs,
          ...result.reconciledPatch.blobs,
        };
        const receiptBlobs = Object.fromEntries(Object.entries(mergedBlobCandidates).filter(([id]) => id in result.database.assets));
        const receipt: PendingPublicationReceipt = {
          version: 1,
          owner: GITHUB_REPOSITORY_OWNER,
          repo: GITHUB_REPOSITORY_NAME,
          branch: "main",
          sourceRevision: snapshot.pendingPublication?.sourceRevision ?? snapshot.base.revision,
          commitSha: result.commitSha,
          createdAt: new Date().toISOString(),
          database: result.database,
          blobs: receiptBlobs,
        };
        const installed = installPendingPublication(localStorage, receipt, remaining.patch);
        if (installed.ok) {
          undoStack.current = [];
          setPersistenceError(null);
          setLibraryState({ base: result.database, effective: remaining.effective, patch: remaining.patch, conflicts: remaining.conflicts, pendingPublication: receipt });
        } else {
          setPersistenceError(`${installed.error.message}. Коммит уже создан; локальный патч очистится после обновления Pages.`);
          setLibraryState({ ...current, pendingPublication: receipt });
        }
      } else {
        installReconciled(result.database, remaining, false, null);
        clearPendingPublication(localStorage);
        undoStack.current = [];
      }

      return {
        status: result.status,
        commitSha: result.commitSha,
        commitUrl: `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}/commit/${result.commitSha}`,
        pagesPending,
      };
    } finally {
      syncInFlightRef.current = false;
    }
  }, [corruptedPatchRaw, installReconciled, setLibraryState]);

  const fallbackBase = useMemo<LibraryDatabase>(() => ({ schemaVersion: LIBRARY_SCHEMA_VERSION, revision: "", publicationId: null, games: {}, notes: {}, assets: {} }), []);
  const resolvedState = state ?? { base: fallbackBase, effective: fallbackBase, patch: emptyPatch(""), conflicts: [], pendingPublication: null };
  const usage = state ? patchUsage(state.patch) : classifyStorageUsage(typeof localStorage === "undefined" ? 0 : (() => { try { return webkitStorageBytes(localStorage); } catch { return 0; } })(), SAFARI_SAFE_BUDGET_BYTES);
  const canAddBlob = useCallback((byteLength: number): string | null => {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return "Некорректный размер файла";
    const base64CodeUnits = 4 * Math.ceil(byteLength / 3);
    const conservativeMetadataCodeUnits = 4_096;
    const projectedBytes = usage.bytes + 2 * (base64CodeUnits + conservativeMetadataCodeUnits);
    return projectedBytes >= SAFARI_SAFE_BUDGET_BYTES * 0.95 ? "Файл не помещается в локальное хранилище Safari" : null;
  }, [usage.bytes]);
  const resolveAssetUrl = useCallback((assetId: string): string | null => {
    const asset = resolvedState.effective.assets[assetId];
    if (!asset) return null;
    return assetDataUrl(asset, resolvedState.patch.blobs[assetId] ?? resolvedState.pendingPublication?.blobs[assetId]) ?? publishedAssetUrl(asset, import.meta.env.BASE_URL);
  }, [resolvedState.effective.assets, resolvedState.patch.blobs, resolvedState.pendingPublication]);
  const value = useMemo<LibraryContextValue>(() => ({
    ...resolvedState,
    loading,
    fatalError,
    persistenceError,
    corruptedPatchRaw,
    usage,
    storageEstimate,
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
    syncToGitHub,
  }), [resolvedState, loading, fatalError, persistenceError, corruptedPatchRaw, usage, storageEstimate, canAddBlob, resolveAssetUrl, saveGame, deleteGame, moveGame, discardPath, discardPaths, clearPatch, resolvePatchConflict, importPatch, undoLast, downloadCorruptedPatch, syncToGitHub]);

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
