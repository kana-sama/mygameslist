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
  base64DecodedBytes,
  parsePatchPath,
  webkitStringBytes,
  type Asset,
  type PatchOperation,
} from "./domain";
import { CatalogPage, GamePage, TierListPage } from "./pages";
import { LibraryProvider, useLibrary } from "./state/LibraryContext";
import {
  copyText,
  createDownloadedPatchCommand,
  createPublishCommand,
  downloadPatch,
} from "./state/publishCommand";

const fieldLabels: Record<string, string> = {
  title: "Название",
  coverAssetId: "Обложка",
  platforms: "Платформы",
  tags: "Теги",
  status: "Статус",
  placement: "Позиция в тирлисте",
  reviewMarkdown: "Отзыв",
  bodyMarkdown: "Текст заметки",
  attachments: "Вложения",
  rank: "Порядок",
  descriptionMarkdown: "Описание",
  collectionId: "Коллекция",
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
  if (map === "collections") return String(effective.collections[id]?.title ?? base.collections[id]?.title ?? rootValue?.title ?? "Коллекция");
  if (map === "notes") {
    const note = effective.notes[id] ?? base.notes[id];
    const gameId = note?.gameId ?? (typeof rootValue?.gameId === "string" ? rootValue.gameId : undefined);
    const game = gameId ? effective.games[gameId] ?? base.games[gameId] : undefined;
    return `Заметка${game ? ` · ${game.title}` : ""}`;
  }
  if (map === "collectionItems") return "Состав коллекции";
  return "Изображение";
}

function classifyDiff(path: string, operation: PatchOperation): DiffGroupId {
  const parsed = parsePatchPath(path);
  if (!parsed) return "changed";
  if (parsed.map === "assets") return "assets";
  if (parsed.map === "collections" || parsed.map === "collectionItems") return "collections";
  if (parsed.field === "placement" || parsed.field === "rank") return "moved";
  if (!parsed.field && operation.operation === "set" && !operation.baseExists) return "added";
  if (!parsed.field && operation.operation === "delete") return "deleted";
  return "changed";
}

function assetMeta(asset: Asset | undefined): string[] | undefined {
  if (!asset || typeof asset.base64 !== "string" || typeof asset.width !== "number" || typeof asset.height !== "number") return undefined;
  return [`${asset.width}×${asset.height}`, `${Math.max(0, base64DecodedBytes(asset.base64)).toLocaleString("ru-RU")} Б`, "WebP"];
}

function assetSummary(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const asset = value as Partial<Asset>;
  return {
    type: asset.mime ?? "image/webp",
    width: asset.width,
    height: asset.height,
    bytes: typeof asset.base64 === "string" ? base64DecodedBytes(asset.base64) : undefined,
    alt: asset.alt,
  };
}

function LibraryRoutes() {
  const library = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const [diffOpen, setDiffOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [commandIsLarge, setCommandIsLarge] = useState(false);
  const [toast, setToast] = useState<{ message: string; undo?: boolean } | null>(null);

  const games = useMemo(() => Object.values(library.effective.games), [library.effective.games]);
  const collections = useMemo(() => Object.values(library.effective.collections), [library.effective.collections]);
  const collectionItems = useMemo(() => Object.values(library.effective.collectionItems), [library.effective.collectionItems]);
  const operationEntries = useMemo(() => Object.entries(library.patch.operations), [library.patch.operations]);
  const patchBytes = useMemo(
    () => webkitStringBytes(PATCH_STORAGE_KEY, JSON.stringify(library.patch)),
    [library.patch],
  );

  useEffect(() => {
    let active = true;
    if (!operationEntries.length) {
      setCommand("");
      setCommandIsLarge(false);
      return () => { active = false; };
    }
    void createPublishCommand(library.patch).then((result) => {
      if (!active) return;
      setCommand(result.command);
      setCommandIsLarge(result.isLarge);
    }).catch(() => {
      if (active) setCommand("");
    });
    return () => { active = false; };
  }, [library.patch, operationEntries.length]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  const showError = (error: unknown) => setToast({ message: error instanceof Error ? error.message : String(error) });
  const navigateHref = (href: string) => navigate(href.startsWith("#") ? href.slice(1) || "/" : href);
  const exportPatch = () => downloadPatch(library.patch);
  const copyCommand = async (value: string) => {
    try {
      await copyText(value);
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
        || parsed.map === "collections"
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
      onDismissLocalOnlyNotice={library.dismissLocalNotice}
      onExportPatch={exportPatch}
      onNavigate={navigateHref}
      onOpenDiff={() => setDiffOpen(true)}
      onRequestPersistentStorage={() => {
        void library.persistStorage().then((accepted) => setToast({ message: accepted ? "Safari принял запрос на долговременное хранение." : "Safari не подтвердил долговременное хранение. Экспорт остаётся самым надёжным backup." }));
      }}
      route={routeKind(location.pathname)}
      showLocalOnlyNotice={library.showLocalNotice}
      storage={{
        bytes: library.usage.bytes,
        budgetBytes: library.usage.budget,
        operationCount: operationEntries.length,
        conflictCount: library.conflicts.length,
      }}
    >
      {library.persistenceError ? <div className="inline-alert inline-alert--error app-error" role="alert"><span>{library.persistenceError}</span><button onClick={() => setDiffOpen(true)} type="button">Открыть правки</button></div> : null}
      <Routes>
        <Route
          path="/"
          element={<TierListPage
            assets={library.effective.assets}
            games={games}
            onMoveGame={(gameId, target) => {
              try {
                library.moveGame(gameId, target.tierId, target.index);
                setToast({ message: "Игра перемещена.", undo: true });
              } catch (error) { showError(error); }
            }}
            onOpenGame={(id) => navigate(`/games/${id}`)}
          />}
        />
        <Route
          path="/games"
          element={<CatalogPage
            assets={library.effective.assets}
            collectionItems={collectionItems}
            collections={collections}
            games={games}
            onAddGamesToCollection={(collectionId, ids) => { try { library.addGamesToCollection(collectionId, ids); } catch (error) { showError(error); } }}
            onCreateCollection={(input) => { try { library.createCollection(input); } catch (error) { showError(error); } }}
            onDeleteCollection={(id) => { try { library.deleteCollection(id); } catch (error) { showError(error); } }}
            onOpenGame={(id) => navigate(`/games/${id}`)}
            onRenameCollection={(id, title) => { try { library.renameCollection(id, title); } catch (error) { showError(error); } }}
          />}
        />
        <Route path="/games/new" element={<GameRoute mode="new" />} />
        <Route path="/games/:id" element={<GameRoute mode="game" />} />
        <Route path="*" element={<div className="empty-state empty-state--hero"><h1>Страница не найдена</h1><p>Такого раздела в библиотеке нет.</p><a className="button button--primary" href="#/">Вернуться в тирлист</a></div>} />
      </Routes>

      <DiffDialog
        alternateCommand={commandIsLarge ? createDownloadedPatchCommand() : undefined}
        command={command}
        conflicts={conflictItems}
        copyAlternateCommand={commandIsLarge ? () => copyCommand(createDownloadedPatchCommand()) : undefined}
        copyCommand={() => copyCommand(command)}
        items={items}
        onClearAll={() => {
          if (!window.confirm("Отменить все локальные правки?")) return;
          try { library.clearPatch(); } catch (error) { showError(error); }
        }}
        onClose={() => setDiffOpen(false)}
        onDownloadCorruptedRaw={library.corruptedPatchRaw === null ? undefined : library.downloadCorruptedPatch}
        onExport={exportPatch}
        onImport={(text) => {
          library.importPatch(text);
          setToast({ message: "Патч импортирован." });
        }}
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
        payloadIsLarge={commandIsLarge}
        storageEstimate={library.storageEstimate}
      />

      {toast ? <div className="toast" role="status"><span>{toast.message}</span>{toast.undo ? <button onClick={() => { try { library.undoLast(); setToast(null); } catch (error) { showError(error); } }} type="button">Отменить</button> : null}<button aria-label="Закрыть" onClick={() => setToast(null)} type="button">×</button></div> : null}
    </AppShell>
  );
}

function GameRoute({ mode }: { mode: "new" | "game" }) {
  const library = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const game = id ? library.effective.games[id] : undefined;
  const editing = mode === "new" || new URLSearchParams(location.search).get("edit") === "1";
  const notes = game
    ? Object.values(library.effective.notes).filter((note) => note.gameId === game.id)
    : [];
  const collections = Object.values(library.effective.collections);
  const collectionItems = Object.values(library.effective.collectionItems);
  const platformSuggestions = [...new Set(Object.values(library.effective.games).flatMap((item) => item.platforms))];
  const tagSuggestions = [...new Set(Object.values(library.effective.games).flatMap((item) => item.tags))];

  if (mode === "game" && !game) {
    return <div className="empty-state empty-state--hero"><h1>Игра не найдена</h1><p>Возможно, она была удалена локально.</p><a className="button button--primary" href="#/games">К каталогу</a></div>;
  }

  return <GamePage
    assets={library.effective.assets}
    collectionItems={collectionItems}
    collections={collections}
    game={game}
    mode={mode === "new" ? "new" : editing ? "edit" : "view"}
    notes={notes}
    onCancel={() => navigate(game ? `/games/${game.id}` : "/games")}
    onDelete={game ? async (gameId) => { library.deleteGame(gameId); navigate("/games"); } : undefined}
    onSave={async (input) => {
      const gameId = await library.saveGame(input);
      navigate(`/games/${gameId}`);
    }}
    onStartEdit={game ? () => navigate(`/games/${game.id}?edit=1`) : undefined}
    platformSuggestions={platformSuggestions}
    storageLocked={library.usage.level === "blocked"}
    tagSuggestions={tagSuggestions}
  />;
}

export default function App() {
  return <HashRouter><LibraryProvider><LibraryRoutes /></LibraryProvider></HashRouter>;
}
