import { useEffect, useMemo, useState } from "react";
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
  type DiffGroupId,
  type DiffItem,
} from "./components";
import {
  PATCH_STORAGE_KEY,
  parsePatchPath,
  webkitStringBytes,
  type Asset,
  type PatchEnvelope,
  type PatchOperation,
} from "./domain";
import { CatalogPage, GamePage, TierListPage } from "./pages";
import { formatBytes } from "./components/libraryUi";
import { LibraryProvider, useLibrary } from "./state/LibraryContext";
import {
  PUBLISH_CLIPBOARD_COMMAND,
  copyText,
  createPublishPayload,
  downloadPatch,
} from "./state/publishCommand";

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
    return asset?.kind === "file" ? asset.originalName || "Файл" : "Изображение";
  }
  return "Изображение";
}

function classifyDiff(path: string, operation: PatchOperation): DiffGroupId {
  const parsed = parsePatchPath(path);
  if (!parsed) return "changed";
  if (parsed.map === "assets") return "assets";
  if (parsed.field === "placement" || parsed.field === "rank") return "moved";
  if (!parsed.field && operation.operation === "set" && !operation.baseExists) return "added";
  if (!parsed.field && operation.operation === "delete") return "deleted";
  return "changed";
}

function assetMeta(asset: Asset | undefined): string[] | undefined {
  if (!asset) return undefined;
  if (asset.kind === "file") return [asset.mime, formatBytes(asset.byteLength)];
  return [`${asset.width}×${asset.height}`, formatBytes(Math.max(0, asset.byteLength)), "WebP"];
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
  const [preparedPayload, setPreparedPayload] = useState<{ patch: PatchEnvelope; payload: string } | null>(null);
  const [publishFailure, setPublishFailure] = useState<{ patch: PatchEnvelope; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const games = useMemo(() => Object.values(library.effective.games), [library.effective.games]);
  const operationEntries = useMemo(() => Object.entries(library.patch.operations), [library.patch.operations]);
  const publishPayload = preparedPayload?.patch === library.patch ? preparedPayload.payload : "";
  const publishError = publishFailure?.patch === library.patch ? publishFailure.message : null;
  const publishPayloadPreparing = operationEntries.length > 0 && !publishPayload && !publishError;
  const patchBytes = useMemo(
    () => webkitStringBytes(PATCH_STORAGE_KEY, JSON.stringify(library.patch)),
    [library.patch],
  );

  useEffect(() => {
    let active = true;
    if (!operationEntries.length) {
      setPreparedPayload(null);
      setPublishFailure(null);
      return () => { active = false; };
    }
    const patch = library.patch;
    void createPublishPayload(patch).then((payload) => {
      if (!active) return;
      setPreparedPayload({ patch, payload });
      setPublishFailure(null);
    }).catch((error) => {
      if (!active) return;
      setPreparedPayload(null);
      setPublishFailure({
        patch,
        message: `Не удалось подготовить патч: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    return () => { active = false; };
  }, [library.patch, operationEntries.length]);

  const items = useMemo<DiffItem[]>(() => operationEntries.map(([path, operation]) => {
    const parsed = parsePatchPath(path);
    const name = parsed ? entityName(parsed.map, parsed.id, operation, library.effective, library.base) : path;
    const field = parsed?.field ? fieldLabels[parsed.field] ?? parsed.field : undefined;
    const asset = parsed?.map === "assets"
      ? (operation.operation === "set" ? operation.value as Asset : library.base.assets[parsed.id])
      : undefined;
    return {
      id: path,
      group: classifyDiff(path, operation),
      title: name,
      detail: field ?? (operation.operation === "delete" ? "Удаление" : operation.baseExists ? "Замена" : "Новая запись"),
      meta: assetMeta(asset),
      transactionId: operation.transactionId,
    };
  }), [library.base, library.effective, operationEntries]);

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
  const exportPatch = () => downloadPatch(library.patch);
  const copyPatch = async () => {
    try {
      await copyText(publishPayload);
      return true;
    } catch {
      return false;
    }
  };

  const expandedDiscardPaths = (paths: string[]): string[] => {
    const selected = new Set(paths);
    for (const path of paths) {
      const parsed = parsePatchPath(path);
      const operation = library.patch.operations[path];
      const dependencyRoot = parsed && !parsed.field && operation && (
        parsed.map === "games"
        || parsed.map === "notes" && operation.operation === "delete"
        || parsed.map === "assets" && operation.operation === "set" && !operation.baseExists
      );
      const dependencyField = parsed?.field === "coverAssetId" || parsed?.field === "attachments";
      if (!dependencyRoot && !dependencyField) continue;
      if (!operation) continue;
      for (const [candidatePath, candidate] of operationEntries) {
        if (candidate.transactionId === operation.transactionId) selected.add(candidatePath);
      }
    }
    return [...selected];
  };

  if (library.loading) {
    return <div className="boot-screen"><span className="boot-screen__spinner" /><p>Открываем библиотеку…</p></div>;
  }
  if (library.fatalError) {
    return <div className="boot-screen boot-screen--error"><h1>Не удалось открыть библиотеку</h1><p>{library.fatalError}</p><button className="button button--primary" onClick={() => window.location.reload()} type="button">Попробовать снова</button></div>;
  }

  return (
    <AppShell
      onNavigate={navigateHref}
      onOpenDiff={() => setDiffOpen(true)}
      route={routeKind(location.pathname)}
      storage={{
        bytes: library.usage.bytes,
        budgetBytes: library.usage.budget,
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
        copyPatch={copyPatch}
        error={actionError ?? publishError ?? library.persistenceError ?? undefined}
        items={items}
        onClearAll={() => {
          if (!window.confirm("Отменить все локальные правки?")) return;
          try { library.clearPatch(); } catch (error) { showError(error); }
        }}
        onClose={() => setDiffOpen(false)}
        onDownloadCorruptedRaw={library.corruptedPatchRaw === null ? undefined : library.downloadCorruptedPatch}
        onDismissError={actionError ? () => setActionError(null) : undefined}
        onExport={exportPatch}
        onImport={(text) => library.importPatch(text)}
        onResolveConflict={(id, resolution, manualValue) => {
          try { library.resolvePatchConflict(id, resolution, manualValue); } catch (error) { showError(error); }
        }}
        onUndoGroup={(group) => {
          const groupPaths = items.filter((item) => item.group === group).map((item) => item.id);
          try { library.discardPaths(expandedDiscardPaths(groupPaths)); } catch (error) { showError(error); }
        }}
        onUndoItem={(id) => {
          try { library.discardPaths(expandedDiscardPaths([id])); } catch (error) { showError(error); }
        }}
        open={diffOpen}
        patchBytes={patchBytes}
        payload={publishPayload}
        payloadPreparing={publishPayloadPreparing}
        publishCommand={PUBLISH_CLIPBOARD_COMMAND}
      />
    </AppShell>
  );
}

function GameRoute({ mode }: { mode: "new" | "game" }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const { id } = useParams();
  const game = id ? library.effective.games[id] : undefined;
  const notes = useMemo(
    () => id ? Object.values(library.effective.notes).filter((note) => note.gameId === id) : [],
    [id, library.effective.notes],
  );
  const platformSuggestions = [...new Set(Object.values(library.effective.games).flatMap((item) => item.platforms))];
  const tagSuggestions = [...new Set(Object.values(library.effective.games).flatMap((item) => item.tags))];

  if (mode === "game" && !game) {
    return <div className="empty-state empty-state--hero"><h1>Игра не найдена</h1><p>Возможно, она была удалена локально.</p></div>;
  }

  return <GamePage
    assets={library.effective.assets}
    canAddBlob={library.canAddBlob}
    game={game}
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
    storageLocked={library.usage.level === "blocked"}
    tagSuggestions={tagSuggestions}
  />;
}

export default function App() {
  return <HashRouter><LibraryProvider><LibraryRoutes /></LibraryProvider></HashRouter>;
}
