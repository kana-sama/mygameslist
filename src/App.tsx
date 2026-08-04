import { useEffect, useMemo, useRef, useState } from "react";
import {
  HashRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  AppShell,
  DiffDialog,
  type AppRoute,
  type DiffSyncController,
} from "./components";
import {
  PATCH_STORAGE_KEY,
  buildChangeReview,
  describeAssetChange,
  parsePatchPath,
  resolvePatchSelection,
  webkitStringBytes,
  type Asset,
  type PatchSelectionSeed,
  type PatchOperation,
} from "./domain";
import { CatalogPage, GamePage, TierListPage } from "./pages";
import { LibraryProvider, useLibrary } from "./state/LibraryContext";
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

function entityName(
  map: string,
  id: string,
  operation: PatchOperation,
  effective: ReturnType<typeof useLibrary>["effective"],
  base: ReturnType<typeof useLibrary>["base"],
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

function LibraryRoutes() {
  const library = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const [diffOpen, setDiffOpen] = useState(false);
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
    if (githubSyncState.stage !== "complete" || !operationEntries.length) return;
    setGitHubSyncState((current) => ({ ...current, stage: "idle", commitUrl: undefined }));
  }, [githubSyncState.stage, library.patch, operationEntries.length]);

  useEffect(() => {
    const commitSha = library.pendingPublication?.commitSha ?? null;
    if (previousPendingCommitRef.current && !commitSha) {
      setGitHubSyncState((current) => ({ ...current, stage: "idle", commitUrl: undefined }));
    }
    previousPendingCommitRef.current = commitSha;
  }, [library.pendingPublication]);

  const seedsForSelectionIds = (selectionIds: Iterable<string>): PatchSelectionSeed[] => [...selectionIds].map((selectionId) => ({
    changeId: selectionId,
    operationPaths: [...new Set((review.changesBySelectionId[selectionId] ?? []).flatMap((change) => change.operationPaths))].sort(),
  }));
  const activeExplicitSelectionIds = useMemo(
    () => new Set([...explicitSelectionIds].filter((selectionId) => Boolean(review.changesBySelectionId[selectionId]))),
    [explicitSelectionIds, review.changesBySelectionId],
  );
  const selectionResult = useMemo(() => activeExplicitSelectionIds.size
    ? resolvePatchSelection(library.base, library.effective, library.patch, seedsForSelectionIds(activeExplicitSelectionIds))
    : null,
  [activeExplicitSelectionIds, library.base, library.effective, library.patch, review.changesBySelectionId]);
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
    if (operationEntries.length) {
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
    commitUrl: githubSyncState.commitUrl ?? (library.pendingPublication
      ? `https://github.com/${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}/commit/${library.pendingPublication.commitSha}`
      : undefined),
    pagesPending: library.pendingPublication !== null,
    connectMode: operationEntries.length ? "sync" : "verify",
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

  const discardSelectionIds = (selectionIds: Iterable<string>) => {
    const result = resolvePatchSelection(
      library.base,
      library.effective,
      library.patch,
      seedsForSelectionIds(selectionIds),
    );
    library.discardPaths(result.selectedPaths);
  };

  const closeDiff = () => {
    setDiffOpen(false);
    setSelectionMode(false);
    setExplicitSelectionIds(new Set());
  };

  if (library.loading) {
    return <div className="boot-screen"><span className="boot-screen__spinner" /><p>Открываем библиотеку…</p></div>;
  }
  if (library.fatalError) {
    return <div className="boot-screen boot-screen--error"><h1>Не удалось открыть библиотеку</h1><p>{library.fatalError}</p><button className="button button--primary" onClick={() => window.location.reload()} type="button">Попробовать снова</button></div>;
  }

  return (
    <AppShell
      games={games}
      onNavigate={navigateHref}
      onOpenDiff={() => {
        setSelectionMode(false);
        setExplicitSelectionIds(new Set());
        setDiffOpen(true);
      }}
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
              try {
                library.moveGame(gameId, target.tierId, target.index);
              } catch (error) { showError(error); }
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
          try { library.clearPatch(); } catch (error) { showError(error); }
        }}
        onClose={closeDiff}
        onDownloadCorruptedRaw={library.corruptedPatchRaw === null ? undefined : library.downloadCorruptedPatch}
        onDismissError={actionError ? () => setActionError(null) : undefined}
        onEnterSelection={() => setSelectionMode(true)}
        onExport={exportPatch}
        onImport={(text) => { void library.importPatch(text).catch(showError); }}
        onResolveConflict={(id, resolution, manualValue) => {
          try { library.resolvePatchConflict(id, resolution, manualValue); } catch (error) { showError(error); }
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
          try { discardSelectionIds(selectionIds); } catch (error) { showError(error); }
        }}
        onUndoChange={(selectionId) => {
          try { discardSelectionIds([selectionId]); } catch (error) { showError(error); }
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

function GameRoute({ mode }: { mode: "new" | "game" }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const { id } = useParams();
  const gameSuggestions = useMemo(() => Object.values(library.effective.games), [library.effective.games]);
  const game = id ? library.effective.games[id] : undefined;
  const notes = useMemo(
    () => id ? Object.values(library.effective.notes).filter((note) => note.gameId === id) : [],
    [id, library.effective.notes],
  );
  const platformSuggestions = [...new Set(gameSuggestions.flatMap((item) => item.platforms))];
  const tagSuggestions = [...new Set(gameSuggestions.flatMap((item) => item.tags))];

  if (mode === "game" && !game) {
    return <div className="empty-state empty-state--hero"><h1>Игра не найдена</h1><p>Возможно, она была удалена локально.</p></div>;
  }

  return <GamePage
    assets={library.effective.assets}
    canAddBlob={library.canAddBlob}
    game={game}
    gameSuggestions={gameSuggestions}
    key={game?.id ?? "new"}
    mode={mode}
    notes={notes}
    onCancel={() => navigate("/games")}
    onDelete={game ? async (gameId) => { library.deleteGame(gameId); navigate("/games"); } : undefined}
    onSave={async (input) => {
      const gameId = await library.saveGame(input);
      if (mode === "new") navigate(`/games/${gameId}`, { replace: true });
    }}
    platformSuggestions={platformSuggestions}
    resolveAssetUrl={library.resolveAssetUrl}
    storageLocked={library.attachmentsBlocked}
    tagSuggestions={tagSuggestions}
  />;
}

export default function App() {
  return <HashRouter><LibraryProvider><LibraryRoutes /></LibraryProvider></HashRouter>;
}
