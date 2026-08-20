import { useEffect, useMemo, useRef, useState } from "react";
import {
  HashRouter,
  matchRoutes,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  AppShell,
  DiffDialog,
  LocalChangesIndicator,
  type AppRoute,
  type DiffSyncController,
  type StorageSummary,
} from "./components";
import {
  PATCH_STORAGE_KEY,
  buildChangeReview,
  describeAssetChange,
  parsePatchPath,
  resolvePatchSelection,
  webkitStringBytes,
  type Asset,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchSelectionSeed,
  type PatchOperation,
} from "./domain";
import { CatalogPage, GamePage, TierListPage, type NoteInteractionSnapshot, type NoteInteractionSource } from "./pages";
import { LibraryProvider, useLibrarySelector, type LibraryContextValue } from "./state/LibraryContext";
import {
  GITHUB_REPOSITORY_NAME,
  GITHUB_REPOSITORY_OWNER,
  clearGitHubPat,
  getGitHubPatCreationUrl,
  loadGitHubPat,
  saveGitHubPat,
  type GitHubPatPersistence,
} from "./state/githubPat";

const fieldLabels: Record<string, string> = {
  title: "Название",
  coverAssetId: "Обложка",
  platforms: "Платформы",
  tags: "Теги",
  status: "Статус",
  placement: "Позиция в тирлисте",
  reviewMarkdown: "Заметка",
  bodyMarkdown: "Текст заметки",
  attachments: "Вложения",
  collapsedChecklistSections: "Свёрнутые чеклисты",
  groupRank: "Группа",
  rank: "Порядок",
  gameId: "Игра",
};

function routeKind(pathname: string): AppRoute {
  if (pathname === "/") return "tiers";
  if (pathname === "/games") return "catalog";
  if (pathname === "/games/new") return "new";
  return "game";
}

export function activeGameIdForRoute(pathname: string, games: Readonly<Record<string, { id: string }>>): string | undefined {
  const gameId = matchRoutes([
    { path: "/games/new" },
    { path: "/games/:id" },
  ], pathname)?.at(-1)?.params.id;
  return gameId ? games[gameId]?.id : undefined;
}

function entityName(
  map: string,
  id: string,
  operation: PatchOperation,
  effective: LibraryContextValue["effective"],
  base: LibraryContextValue["base"],
): string {
  const rootValue = operation.operation === "set" && operation.value && typeof operation.value === "object"
    ? operation.value as Record<string, unknown>
    : undefined;
  if (map === "games") return String(effective.games[id]?.title ?? base.games[id]?.title ?? rootValue?.title ?? "Игра");
  if (map === "notes") {
    const note = effective.notes[id] ?? base.notes[id];
    const gameId = note?.gameId ?? (typeof rootValue?.gameId === "string" ? rootValue.gameId : undefined);
    const game = gameId ? effective.games[gameId] ?? base.games[gameId] : undefined;
    return `Заметка${game ? ` · ${game.title}` : ""}`;
  }
  if (map === "assets") {
    const asset = effective.assets[id] ?? base.assets[id] ?? rootValue as Asset | undefined;
    const database = effective.assets[id] ? effective : base.assets[id] ? base : effective;
    return describeAssetChange(database, id, asset?.originalName);
  }
  return "Изображение";
}

function assetSummary(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const asset = value as Partial<Asset>;
  return {
    kind: asset.kind ?? "image",
    type: asset.mime ?? "application/octet-stream",
    width: asset.width,
    height: asset.height,
    bytes: typeof asset.byteLength === "number" ? asset.byteLength : undefined,
    alt: asset.alt,
    originalName: asset.originalName,
  };
}

function sameStructuralGame(left: Game, right: Game): boolean {
  return Object.is(left, right) || (
    left.id === right.id
    && left.title === right.title
    && left.coverAssetId === right.coverAssetId
    && left.progressItems === right.progressItems
    && left.platforms === right.platforms
    && left.tags === right.tags
    && left.status === right.status
    && left.placement === right.placement
    && left.reviewMarkdown === right.reviewMarkdown
    && left.createdAt === right.createdAt
  );
}

function sameStructuralNote(left: Note, right: Note): boolean {
  return Object.is(left, right) || (
    left.id === right.id
    && left.gameId === right.gameId
    && left.attachments === right.attachments
    && left.doubleHeight === right.doubleHeight
    && left.doubleWidth === right.doubleWidth
    && left.groupRank === right.groupRank
    && left.rank === right.rank
    && left.createdAt === right.createdAt
  );
}

function sameStructuralRecord<T>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>,
  isEqual: (left: T, right: T) => boolean,
): boolean {
  if (Object.is(left, right)) return true;
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return leftIds.length === rightIds.length
    && leftIds.every((id) => right[id] !== undefined && isEqual(left[id], right[id]));
}

function sameStructuralDatabase(left: LibraryDatabase, right: LibraryDatabase): boolean {
  return Object.is(left, right) || (
    left.schemaVersion === right.schemaVersion
    && left.revision === right.revision
    && left.publicationId === right.publicationId
    && sameStructuralRecord(left.games, right.games, sameStructuralGame)
    && sameStructuralRecord(left.notes, right.notes, sameStructuralNote)
    && Object.is(left.assets, right.assets)
  );
}

function samePublicationBoundary(left: LibraryContextValue["publicationState"], right: LibraryContextValue["publicationState"]): boolean {
  if (Object.is(left, right)) return true;
  if (left.status !== right.status) return false;
  if (left.status !== "valid" || right.status !== "valid") return false;
  return left.durability === right.durability
    && left.journal.phase === right.journal.phase
    && left.journal.sourceCommitSha === right.journal.sourceCommitSha
    && left.journal.targetCommitSha === right.journal.targetCommitSha
    && left.journal.targetRevision === right.journal.targetRevision
    && left.recoveryBase === right.recoveryBase
    && left.check === right.check
    && left.exportCompleted === right.exportCompleted;
}

function sameLibraryRouteBoundary(left: LibraryContextValue, right: LibraryContextValue): boolean {
  return Object.is(left, right) || (
    left.sourceCommitSha === right.sourceCommitSha
    && Object.is(left.base, right.base)
    && sameStructuralDatabase(left.effective, right.effective)
    && Object.is(left.conflicts, right.conflicts)
    && samePublicationBoundary(left.publicationState, right.publicationState)
    && Object.is(left.retainedLocalAssetIds, right.retainedLocalAssetIds)
    && left.loading === right.loading
    && left.fatalError === right.fatalError
    && left.corruptedPatchRaw === right.corruptedPatchRaw
    && Object.is(left.storageEstimate, right.storageEstimate)
    && Object.is(left.quotaStatus, right.quotaStatus)
    && left.persistentStorage === right.persistentStorage
    && left.attachmentsBlocked === right.attachmentsBlocked
    && Object.is(left.localAssets, right.localAssets)
    && left.localAssetBytes === right.localAssetBytes
  );
}

function identityLibrary(library: LibraryContextValue): LibraryContextValue {
  return library;
}

function sameStorageSummary(left: StorageSummary, right: StorageSummary): boolean {
  return left.bytes === right.bytes
    && left.budgetBytes === right.budgetBytes
    && left.localAssetCount === right.localAssetCount
    && left.localAssetBytes === right.localAssetBytes
    && left.quotaLevel === right.quotaLevel
    && left.persistent === right.persistent
    && left.oldestLocalAssetAt === right.oldestLocalAssetAt
    && left.operationCount === right.operationCount
    && left.conflictCount === right.conflictCount
    && left.error === right.error;
}

function SubscribedLocalChangesIndicator({ actionError, onOpenDiff }: { actionError: string | null; onOpenDiff: () => void }) {
  const storage = useLibrarySelector<StorageSummary>((library) => ({
    bytes: library.usage.bytes,
    budgetBytes: library.usage.budget,
    localAssetCount: library.localAssets.length,
    localAssetBytes: library.localAssetBytes,
    quotaLevel: library.attachmentsBlocked ? "blocked" : library.quotaStatus.level,
    persistent: library.persistentStorage,
    oldestLocalAssetAt: library.localAssets[0]?.createdAt ?? null,
    operationCount: Object.keys(library.patch.operations).length,
    conflictCount: library.conflicts.length,
    error: actionError ?? library.persistenceError ?? undefined,
  }), sameStorageSummary);
  return <LocalChangesIndicator onOpenDiff={onOpenDiff} storage={storage} />;
}

function LibraryRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [diffOpen, setDiffOpen] = useState(false);
  const library = useLibrarySelector(identityLibrary, diffOpen ? Object.is : sameLibraryRouteBoundary);
  const [selectionMode, setSelectionMode] = useState(false);
  const [explicitSelectionIds, setExplicitSelectionIds] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const githubPatRef = useRef<string | null>(null);
  const [githubPatPersistence, setGitHubPatPersistence] = useState<GitHubPatPersistence | null>(null);
  const [githubSyncState, setGitHubSyncState] = useState<{
    busy: boolean;
    stage: DiffSyncController["stage"];
    error: string | null;
    commitUrl?: string;
  }>({ busy: false, stage: "idle", error: null });
  const previousPendingCommitRef = useRef<string | null>(null);

  useEffect(() => {
    const loaded = loadGitHubPat();
    if (loaded.ok) {
      githubPatRef.current = loaded.token;
      setGitHubPatPersistence(loaded.persistence);
    } else {
      setGitHubSyncState((current) => ({ ...current, error: loaded.error === "invalid-token" ? "Сохранённый PAT повреждён" : "Safari не разрешил прочитать сохранённый PAT" }));
    }
  }, []);

  const games = useMemo(() => Object.values(library.effective.games), [library.effective.games]);
  const gameId = activeGameIdForRoute(location.pathname, library.effective.games);
  const operationEntries = useMemo(() => Object.entries(library.patch.operations), [library.patch.operations]);
  const review = useMemo(
    () => buildChangeReview(library.base, library.effective, library.patch),
    [library.base, library.effective, library.patch],
  );
  const patchBytes = useMemo(
    () => webkitStringBytes(PATCH_STORAGE_KEY, JSON.stringify(library.patch)),
    [library.patch],
  );

  useEffect(() => {
    const commitSha = library.publicationState.status === "valid" ? library.publicationState.journal.targetCommitSha : null;
    if (previousPendingCommitRef.current && !commitSha) {
      setGitHubSyncState((current) => ({ ...current, stage: "idle", commitUrl: undefined }));
    }
    previousPendingCommitRef.current = commitSha;
  }, [library.publicationState]);

  useEffect(() => {
    if (!library.conflicts.length) return;
    setSelectionMode(false);
    setExplicitSelectionIds((current) => current.size ? new Set() : current);
  }, [library.conflicts.length]);

  const seedsForSelectionIds = (selectionIds: Iterable<string>): PatchSelectionSeed[] => [...selectionIds].map((selectionId) => ({
    changeId: selectionId,
    operationPaths: [...new Set((review.changesBySelectionId[selectionId] ?? []).flatMap((change) => change.operationPaths))].sort(),
  }));
  const activeExplicitSelectionIds = useMemo(
    () => new Set([...explicitSelectionIds].filter((selectionId) => Boolean(review.changesBySelectionId[selectionId]))),
    [explicitSelectionIds, review.changesBySelectionId],
  );
  const selectionResult = useMemo(() => !library.conflicts.length && activeExplicitSelectionIds.size
    ? resolvePatchSelection(library.base, library.effective, library.patch, seedsForSelectionIds(activeExplicitSelectionIds))
    : null,
  [activeExplicitSelectionIds, library.base, library.conflicts.length, library.effective, library.patch, review.changesBySelectionId]);
  const selectedSelectionIds = useMemo(() => {
    if (!selectionResult) return new Set<string>();
    const paths = new Set(selectionResult.selectedPaths);
    return new Set(review.uniqueSelectionIds.filter((selectionId) =>
      (review.changesBySelectionId[selectionId] ?? []).some((change) => change.operationPaths.some((path) => paths.has(path))),
    ));
  }, [review.changesBySelectionId, review.uniqueSelectionIds, selectionResult]);
  const dependencySelectionIds = useMemo(
    () => new Set([...selectedSelectionIds].filter((selectionId) => !activeExplicitSelectionIds.has(selectionId))),
    [activeExplicitSelectionIds, selectedSelectionIds],
  );
  const dependencyLabels = useMemo(() => {
    if (!selectionResult) return {};
    const labels: Record<string, string> = {};
    for (const reason of selectionResult.dependencyReasons) {
      const dependencyId = review.uniqueSelectionIds.find((selectionId) =>
        (review.changesBySelectionId[selectionId] ?? []).some((change) => change.operationPaths.includes(reason.requiredPath)),
      );
      if (!dependencyId || !dependencySelectionIds.has(dependencyId)) continue;
      const requiredBy = review.changesBySelectionId[reason.requiredByChangeId]?.[0]?.title;
      labels[dependencyId] = requiredBy ? `связано с «${requiredBy}»` : reason.message;
    }
    return labels;
  }, [dependencySelectionIds, review.changesBySelectionId, review.uniqueSelectionIds, selectionResult]);

  const conflictItems = useMemo(() => library.conflicts.map((conflict) => {
    const parsed = parsePatchPath(conflict.path);
    return {
      id: conflict.path,
      path: conflict.path,
      label: parsed
        ? `${entityName(parsed.map, parsed.id, conflict.operation, library.effective, library.base)}${parsed.field ? ` · ${fieldLabels[parsed.field] ?? parsed.field}` : ""}`
        : conflict.path,
      staticValue: conflict.staticExists ? (parsed?.map === "assets" ? assetSummary(conflict.staticValue) : conflict.staticValue) : "(отсутствует)",
      localValue: conflict.operation.operation === "delete" ? "(удалено локально)" : parsed?.map === "assets" ? assetSummary(conflict.operation.value) : conflict.operation.value,
      canMergeManually: parsed?.map !== "assets",
    };
  }), [library.base, library.conflicts, library.effective]);

  const showError = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));
  const navigateHref = (href: string) => navigate(href.startsWith("#") ? href.slice(1) || "/" : href);
  const exportPatch = () => { void library.exportRecoveryArchive().catch(showError); };
  const freeLocalAssetSpace = () => {
    if (!window.confirm("Удалить все локальные копии вложений? Неопубликованные ссылки на них также будут удалены; текст сохранится.")) return;
    void library.deleteAllLocalAssets().catch(showError);
  };
  const syncWithGitHub = async (token: string, selectedPaths?: readonly string[]) => {
    setGitHubSyncState((current) => ({ ...current, busy: true, stage: "connecting", error: null }));
    try {
      const result = await library.syncToGitHub(token, {
        selectedPaths,
        onStage: (stage) => {
          setGitHubSyncState((current) => ({ ...current, busy: true, stage }));
        },
      });
      setGitHubSyncState({ busy: false, stage: "complete", error: null, commitUrl: result.commitUrl });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Не удалось синхронизировать библиотеку";
      if (message.startsWith("GitHub отклонил PAT")) {
        clearGitHubPat();
        githubPatRef.current = null;
        setGitHubPatPersistence(null);
      }
      setGitHubSyncState((current) => ({ ...current, busy: false, stage: "idle", error: message }));
      throw reason;
    }
  };

  const connectGitHubWithoutSync = async (token: string) => {
    setGitHubSyncState((current) => ({ ...current, busy: true, stage: "connecting", error: null, commitUrl: undefined }));
    try {
      await library.verifyGitHubAccess(token);
      setGitHubSyncState({ busy: false, stage: "idle", error: null });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Не удалось проверить доступ к GitHub";
      setGitHubSyncState((current) => ({ ...current, busy: false, stage: "idle", error: message }));
      throw reason;
    }
  };

  const connectAndSyncGitHub = async (token: string, remember: boolean, selectedPaths?: readonly string[]) => {
    const saved = saveGitHubPat(token, remember);
    if (!saved.ok) {
      throw new Error(saved.error === "invalid-token"
        ? "Нужен fine-grained PAT в формате github_pat_…"
        : "Safari не разрешил сохранить PAT");
    }
    const loaded = loadGitHubPat();
    if (!loaded.ok || !loaded.token || !loaded.persistence) {
      clearGitHubPat();
      throw new Error("Не удалось прочитать сохранённый PAT");
    }
    if (library.publicationState.status !== "none") {
      githubPatRef.current = loaded.token;
      setGitHubPatPersistence(loaded.persistence);
      await library.retryPublicationCheck(loaded.token);
    } else if (operationEntries.length) {
      githubPatRef.current = loaded.token;
      setGitHubPatPersistence(loaded.persistence);
      await syncWithGitHub(loaded.token, selectedPaths);
    } else {
      try { await connectGitHubWithoutSync(loaded.token); }
      catch (reason) {
        clearGitHubPat();
        throw reason;
      }
      githubPatRef.current = loaded.token;
      setGitHubPatPersistence(loaded.persistence);
    }
  };

  const disconnectGitHub = async () => {
    const cleared = clearGitHubPat();
    if (!cleared.ok) throw new Error("Safari не разрешил удалить сохранённый PAT");
    githubPatRef.current = null;
    setGitHubPatPersistence(null);
    setGitHubSyncState({ busy: false, stage: "idle", error: null });
  };

  const githubSyncController: DiffSyncController = {
    connected: githubPatRef.current !== null,
    persistence: githubPatPersistence ?? "none",
    busy: githubSyncState.busy,
    stage: githubSyncState.stage,
    error: githubSyncState.error,
    commitUrl: githubSyncState.commitUrl,
    pagesPending: false,
    connectMode: library.publicationState.status !== "none" ? "recovery" : operationEntries.length ? "sync" : "verify",
    publication: library.publicationState.status === "none" ? undefined : {
      status: library.publicationState.status === "valid"
        ? library.publicationState.durability === "memory-only"
          ? "memory-only"
          : library.publicationState.journal.phase === "recovery-required"
            ? "recovery"
            : library.publicationState.check === null || library.publicationState.check === "waiting-source" || library.publicationState.check === "checking"
              ? "waiting"
              : "problem"
        : library.publicationState.status,
      check: library.publicationState.status === "valid" ? library.publicationState.check : undefined,
      targetCommitUrl: library.publicationState.status === "valid"
        ? `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}/commit/${library.publicationState.journal.targetCommitSha}`
        : undefined,
      exportCompleted: library.publicationState.exportCompleted,
      onRetryPersistence: library.retryPublicationPersistence,
      onRetryCheck: () => library.retryPublicationCheck(githubPatRef.current ?? undefined),
      onExport: library.exportPublicationRecovery,
      onDiscard: library.discardPublicationAfterExport,
      onReload: library.reloadPage,
    },
    repository: `${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME} · main`,
    patCreationHref: getGitHubPatCreationUrl(),
    onConnect: connectAndSyncGitHub,
    onDisconnect: disconnectGitHub,
    onSync: async (selectedPaths) => {
      const token = githubPatRef.current;
      if (!token) throw new Error("Сначала подключите fine-grained PAT");
      await syncWithGitHub(token, selectedPaths);
    },
    onDismissError: () => setGitHubSyncState((current) => ({ ...current, error: null })),
  };

  const discardSelectionIds = async (selectionIds: Iterable<string>) => {
    const result = resolvePatchSelection(
      library.base,
      library.effective,
      library.patch,
      seedsForSelectionIds(selectionIds),
    );
    await library.discardPaths(result.selectedPaths);
  };

  const closeDiff = () => {
    setDiffOpen(false);
    setSelectionMode(false);
    setExplicitSelectionIds(new Set());
  };
  const openDiff = () => {
    setSelectionMode(false);
    setExplicitSelectionIds(new Set());
    setDiffOpen(true);
  };

  if (library.loading) {
    return <div className="boot-screen"><span className="boot-screen__spinner" /><p>Открываем библиотеку…</p></div>;
  }
  if (library.fatalError) {
    return <div className="boot-screen boot-screen--error"><h1>Не удалось открыть библиотеку</h1><p>{library.fatalError}</p><button className="button button--primary" onClick={() => window.location.reload()} type="button">Попробовать снова</button></div>;
  }

  return (
    <AppShell
      gameId={gameId}
      games={games}
      localChangesIndicator={<SubscribedLocalChangesIndicator actionError={actionError} onOpenDiff={openDiff} />}
      onNavigate={navigateHref}
      onOpenDiff={openDiff}
      resolveAssetUrl={library.resolveAssetUrl}
      route={routeKind(location.pathname)}
      storage={{
        bytes: library.usage.bytes,
        budgetBytes: library.usage.budget,
        localAssetCount: library.localAssets.length,
        localAssetBytes: library.localAssetBytes,
        quotaLevel: library.attachmentsBlocked ? "blocked" : library.quotaStatus.level,
        persistent: library.persistentStorage,
        oldestLocalAssetAt: library.localAssets[0]?.createdAt ?? null,
        operationCount: operationEntries.length,
        conflictCount: library.conflicts.length,
        error: actionError ?? library.persistenceError ?? undefined,
      }}
    >
      <Routes>
        <Route
          path="/"
          element={<TierListPage
            assets={library.effective.assets}
            games={games}
            onMoveGame={(gameId, target) => {
              void library.moveGame(gameId, target.tierId, target.index).catch(showError);
            }}
            onOpenGame={(id) => navigate(`/games/${id}`)}
            resolveAssetUrl={library.resolveAssetUrl}
          />}
        />
        <Route
          path="/games"
          element={<CatalogPage
            assets={library.effective.assets}
            games={games}
            onOpenGame={(id) => navigate(`/games/${id}`)}
            resolveAssetUrl={library.resolveAssetUrl}
          />}
        />
        <Route path="/games/new" element={<GameRoute mode="new" />} />
        <Route path="/games/:id" element={<GameRoute mode="game" />} />
        <Route path="*" element={<div className="empty-state empty-state--hero"><h1>Страница не найдена</h1><p>Такого раздела в библиотеке нет.</p><a className="button button--primary" href="#/">Вернуться в тирлист</a></div>} />
      </Routes>

      <DiffDialog
        conflicts={conflictItems}
        error={actionError ?? library.persistenceError ?? undefined}
        localAssets={{
          bytes: library.localAssetBytes,
          count: library.localAssets.length,
          oldestCreatedAt: library.localAssets[0]?.createdAt ?? null,
          onFreeSpace: freeLocalAssetSpace,
          persistent: library.persistentStorage,
          quotaLevel: library.attachmentsBlocked ? "blocked" : library.quotaStatus.level,
        }}
        onClearAll={() => {
          if (!window.confirm("Отменить все локальные правки?")) return;
          void library.clearPatch().catch(showError);
        }}
        onClose={closeDiff}
        onDownloadCorruptedRaw={library.corruptedPatchRaw === null ? undefined : library.downloadCorruptedPatch}
        onDismissError={actionError ? () => setActionError(null) : undefined}
        onEnterSelection={() => setSelectionMode(true)}
        onExport={exportPatch}
        onImport={(text) => { void library.importPatch(text).catch(showError); }}
        onResolveConflict={(id, resolution, manualValue) => {
          void library.resolvePatchConflict(id, resolution, manualValue).catch(showError);
        }}
        onToggleChange={(selectionId) => setExplicitSelectionIds((current) => {
          const next = new Set(current);
          if (next.has(selectionId)) next.delete(selectionId);
          else next.add(selectionId);
          return next;
        })}
        onToggleGame={(gameId) => setExplicitSelectionIds((current) => {
          const group = review.groups.find((candidate) => candidate.gameId === gameId);
          const selectionIds = [...new Set(group?.changes.map((change) => change.selectionId) ?? [])];
          const next = new Set(current);
          if (selectionIds.every((selectionId) => selectedSelectionIds.has(selectionId))) {
            selectionIds.forEach((selectionId) => next.delete(selectionId));
          } else {
            selectionIds.forEach((selectionId) => next.add(selectionId));
          }
          return next;
        })}
        onUndoGame={(gameId) => {
          const group = review.groups.find((candidate) => candidate.gameId === gameId);
          const selectionIds = new Set(group?.changes.map((change) => change.selectionId) ?? []);
          void discardSelectionIds(selectionIds).catch(showError);
        }}
        onUndoChange={(selectionId) => {
          void discardSelectionIds([selectionId]).catch(showError);
        }}
        open={diffOpen}
        patchBytes={patchBytes}
        review={review}
        resolveAssetUrl={library.resolveAssetUrl}
        selection={{
          enabled: selectionMode,
          explicitSelectionIds: activeExplicitSelectionIds,
          selectedSelectionIds,
          dependencySelectionIds,
          dependencyLabels,
          selectedPaths: selectionResult?.selectedPaths,
        }}
        sync={githubSyncController}
      />
    </AppShell>
  );
}

interface GameRouteSelection {
  assets: LibraryDatabase["assets"];
  game?: Game;
  gameSuggestions: Game[];
  notes: Note[];
  attachmentsBlocked: boolean;
  canAddBlob: LibraryContextValue["canAddBlob"];
  deleteGame: LibraryContextValue["deleteGame"];
  resolveAssetUrl: LibraryContextValue["resolveAssetUrl"];
  saveGame: LibraryContextValue["saveGame"];
  readNoteInteractionSnapshot: LibraryContextValue["readNoteInteractionSnapshot"];
  saveNoteInteraction: LibraryContextValue["saveNoteInteraction"];
}

function sameStructuralArray<T>(left: readonly T[], right: readonly T[], isEqual: (left: T, right: T) => boolean): boolean {
  return left.length === right.length && left.every((value, index) => isEqual(value, right[index]));
}

function sameGameRouteSelection(left: GameRouteSelection, right: GameRouteSelection): boolean {
  return Object.is(left.assets, right.assets)
    && (left.game === undefined ? right.game === undefined : right.game !== undefined && sameStructuralGame(left.game, right.game))
    && sameStructuralArray(left.gameSuggestions, right.gameSuggestions, sameStructuralGame)
    && sameStructuralArray(left.notes, right.notes, sameStructuralNote)
    && left.attachmentsBlocked === right.attachmentsBlocked
    && left.canAddBlob === right.canAddBlob
    && left.deleteGame === right.deleteGame
    && left.resolveAssetUrl === right.resolveAssetUrl
    && left.saveGame === right.saveGame
    && left.readNoteInteractionSnapshot === right.readNoteInteractionSnapshot
    && left.saveNoteInteraction === right.saveNoteInteraction;
}

function sameNoteInteractionSnapshot(left: NoteInteractionSnapshot | undefined, right: NoteInteractionSnapshot | undefined): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || left.bodyMarkdown !== right.bodyMarkdown) return false;
  const leftSections = left.collapsedChecklistSections ?? [];
  const rightSections = right.collapsedChecklistSections ?? [];
  return leftSections.length === rightSections.length
    && leftSections.every((section, index) => section === rightSections[index]);
}

function useRouteNoteInteractionSnapshot(noteId: string): NoteInteractionSnapshot | undefined {
  return useLibrarySelector((library) => {
    const note = library.effective.notes[noteId];
    return note ? {
      bodyMarkdown: note.bodyMarkdown,
      collapsedChecklistSections: note.collapsedChecklistSections,
    } : undefined;
  }, sameNoteInteractionSnapshot);
}

function GameRoute({ mode }: { mode: "new" | "game" }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const selection = useLibrarySelector<GameRouteSelection>((library) => ({
    assets: library.effective.assets,
    game: id ? library.effective.games[id] : undefined,
    gameSuggestions: Object.values(library.effective.games),
    notes: id ? Object.values(library.effective.notes).filter((note) => note.gameId === id) : [],
    attachmentsBlocked: library.attachmentsBlocked,
    canAddBlob: library.canAddBlob,
    deleteGame: library.deleteGame,
    resolveAssetUrl: library.resolveAssetUrl,
    saveGame: library.saveGame,
    readNoteInteractionSnapshot: library.readNoteInteractionSnapshot,
    saveNoteInteraction: library.saveNoteInteraction,
  }), sameGameRouteSelection);
  const { assets, game, gameSuggestions, notes } = selection;
  const noteInteractionSource = useMemo<NoteInteractionSource>(() => ({
    useNoteInteractionSnapshot: useRouteNoteInteractionSnapshot,
    readNoteInteractionSnapshot: selection.readNoteInteractionSnapshot,
    saveNoteInteraction: selection.saveNoteInteraction,
  }), [selection.readNoteInteractionSnapshot, selection.saveNoteInteraction]);
  const platformSuggestions = [...new Set(gameSuggestions.flatMap((item) => item.platforms))];
  const tagSuggestions = [...new Set(gameSuggestions.flatMap((item) => item.tags))];

  if (mode === "game" && !game) {
    return <div className="empty-state empty-state--hero"><h1>Игра не найдена</h1><p>Возможно, она была удалена локально.</p></div>;
  }

  return <GamePage
    assets={assets}
    canAddBlob={selection.canAddBlob}
    game={game}
    gameSuggestions={gameSuggestions}
    key={game?.id ?? "new"}
    mode={mode}
    notes={notes}
    noteInteractionSource={noteInteractionSource}
    onCancel={() => navigate("/games")}
    onDelete={game ? async (gameId) => { await selection.deleteGame(gameId); navigate("/games"); } : undefined}
    onSave={async (input) => {
      const gameId = await selection.saveGame(input);
      if (mode === "new") navigate(`/games/${gameId}`, { replace: true });
    }}
    platformSuggestions={platformSuggestions}
    resolveAssetUrl={selection.resolveAssetUrl}
    storageLocked={selection.attachmentsBlocked}
    tagSuggestions={tagSuggestions}
  />;
}

export default function App() {
  return <HashRouter><LibraryProvider><LibraryRoutes /></LibraryProvider></HashRouter>;
}
