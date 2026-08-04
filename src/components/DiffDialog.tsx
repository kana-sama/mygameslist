import { useEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import type { ChangeEvidence, ChangeReviewModel, GameChangeGroup, ReviewChange } from "../domain";
import { Icon } from "./Icon";
import { MarkdownDiffPreview } from "./MarkdownDiffPreview";
import {
  DiffSyncButton,
  DiffSyncPanel,
  isDiffSyncBusy,
  type DiffSyncController,
} from "./DiffSyncPanel";
import { formatBytes } from "./libraryUi";

export interface DiffConflictItem {
  id: string;
  path: string;
  label: string;
  staticValue: unknown;
  localValue: unknown;
  canMergeManually?: boolean;
}

export interface LocalAssetsSummary {
  count: number;
  bytes: number;
  quotaLevel: "unknown" | "ok" | "warning" | "critical" | "blocked";
  persistent: boolean;
  oldestCreatedAt?: number | null;
  onFreeSpace?: () => void;
}

export interface DiffSelectionState {
  enabled: boolean;
  explicitSelectionIds: ReadonlySet<string>;
  selectedSelectionIds: ReadonlySet<string>;
  dependencySelectionIds: ReadonlySet<string>;
  dependencyLabels: Readonly<Record<string, string>>;
  selectedPaths: readonly string[] | undefined;
}

export interface DiffDialogProps {
  open: boolean;
  review: ChangeReviewModel;
  selection: DiffSelectionState;
  conflicts?: DiffConflictItem[];
  patchBytes: number;
  error?: string;
  onEnterSelection: () => void;
  onToggleChange: (selectionId: string) => void;
  onToggleGame: (gameId: string | null) => void;
  onUndoChange?: (selectionId: string) => void;
  onUndoGame?: (gameId: string | null) => void;
  onClose: () => void;
  onClearAll?: () => void;
  onExport: () => void;
  onImport: (text: string, fileName: string) => void | Promise<void>;
  onResolveConflict?: (conflictId: string, resolution: "static" | "local", manualValue?: unknown) => void;
  onDownloadCorruptedRaw?: () => void;
  onDismissError?: () => void;
  sync?: DiffSyncController;
  localAssets?: LocalAssetsSummary;
  resolveAssetUrl?: (assetId: string) => string | null;
}

const kindLabels: Record<ReviewChange["kind"], string> = {
  added: "Добавлено",
  changed: "Изменено",
  deleted: "Удалено",
  moved: "Перемещено",
  asset: "Файл",
};

function TriStateCheckbox({ checked, indeterminate, ...props }: {
  checked: boolean;
  indeterminate: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "type">) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input {...props} aria-checked={indeterminate ? "mixed" : checked} checked={checked} ref={ref} type="checkbox" />;
}

function ChangeEvidenceView({ evidence, resolveAssetUrl }: { evidence: ChangeEvidence; resolveAssetUrl?: (assetId: string) => string | null }) {
  if (evidence.type === "scalar" || evidence.type === "move") {
    return <p className={`game-diff-evidence game-diff-evidence--${evidence.type}`}>{evidence.before} → {evidence.after}</p>;
  }
  if (evidence.type === "chips") {
    return (
      <div className="game-diff-evidence game-diff-evidence--chips">
        {evidence.added.length ? <div aria-label={`Добавлено: ${evidence.added.join(", ")}`}><span>Добавлено</span>{evidence.added.map((item) => <em className="game-diff-chip game-diff-chip--added" key={`added:${item}`}>{item}</em>)}</div> : null}
        {evidence.removed.length ? <div aria-label={`Удалено: ${evidence.removed.join(", ")}`}><span>Удалено</span>{evidence.removed.map((item) => <em className="game-diff-chip game-diff-chip--removed" key={`removed:${item}`}>{item}</em>)}</div> : null}
      </div>
    );
  }
  if (evidence.type === "asset") {
    const dimensions = evidence.width && evidence.height ? `${evidence.width}×${evidence.height}` : null;
    const thumbnailUrl = evidence.mime.startsWith("image/") ? resolveAssetUrl?.(evidence.assetId) ?? null : null;
    return (
      <div className="game-diff-evidence game-diff-evidence--asset">
        <span className="game-diff-evidence__file">
          {thumbnailUrl ? <img alt={`Превью: ${evidence.originalName}`} src={thumbnailUrl} /> : <Icon aria-hidden="true" name={evidence.mime.startsWith("image/") ? "image" : "note"} size={18} />}
        </span>
        <div><strong>{evidence.originalName}</strong><small>{[dimensions, evidence.mime, formatBytes(evidence.byteLength)].filter(Boolean).join(" · ")}</small></div>
      </div>
    );
  }
  return <MarkdownDiffPreview model={evidence.diff} />;
}

function uniqueGroupSelectionIds(group: GameChangeGroup): string[] {
  return [...new Set(group.changes.map((change) => change.selectionId))];
}

function visibleSummary(change: ReviewChange): string {
  if (!change.evidence.some((evidence) => evidence.type === "chips")) return change.summary;
  return change.summary
    .replace(/\+([^;]+)/gu, "добавлено $1")
    .replace(/−([^;]+)/gu, "удалено $1")
    .replace(/~([^;]+)/gu, "изменено $1");
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DiffDialog({
  open,
  review,
  selection,
  conflicts = [],
  patchBytes,
  error,
  onEnterSelection,
  onToggleChange,
  onToggleGame,
  onUndoChange,
  onUndoGame,
  onClose,
  onClearAll,
  onExport,
  onImport,
  onResolveConflict,
  onDownloadCorruptedRaw,
  onDismissError,
  sync,
  localAssets,
  resolveAssetUrl,
}: DiffDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [manualConflict, setManualConflict] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncScope, setSyncScope] = useState<{
    actionLabel: string;
    partialScopeUnavailable: boolean;
    selectedPaths?: readonly string[];
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const syncToggleRef = useRef<HTMLButtonElement>(null);
  const partialScopeUnavailable = selection.explicitSelectionIds.size > 0
    && (!selection.selectedPaths || selection.selectedPaths.length === 0);
  const selectedPaths = selection.explicitSelectionIds.size
    ? selection.selectedPaths
    : undefined;
  const actionLabel = selection.explicitSelectionIds.size
    ? `Синхронизировать выбранное · ${selection.selectedSelectionIds.size}`
    : "Синхронизировать всё";
  const activeSyncScope = syncOpen && syncScope
    ? syncScope
    : { actionLabel, partialScopeUnavailable, selectedPaths };
  const scopedSync = useMemo<DiffSyncController | undefined>(() => sync ? {
    ...sync,
    actionLabel: activeSyncScope.actionLabel,
    onConnect: (token, remember) => sync.onConnect(token, remember, activeSyncScope.selectedPaths),
    onSync: () => sync.onSync(activeSyncScope.selectedPaths),
  } : undefined, [activeSyncScope.actionLabel, activeSyncScope.selectedPaths, sync]);

  useEffect(() => {
    if (!open) return;
    const element = dialogRef.current;
    const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex='0']") ?? []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) return;
    setSyncOpen(false);
    setSyncSubmitting(false);
    setSyncScope(null);
    setCollapsedGroups(new Set());
  }, [open]);

  useEffect(() => {
    if (syncOpen && sync?.stage === "complete") setSyncScope(null);
  }, [sync?.stage, syncOpen]);

  if (!open) return null;

  const syncBlockedReason = !review.uniqueSelectionIds.length
    ? "Нет локальных изменений для синхронизации."
    : conflicts.length
      ? "Сначала разрешите все конфликты."
      : activeSyncScope.partialScopeUnavailable
        ? "Не удалось определить состав выбранных изменений."
        : undefined;
  const syncBusy = syncSubmitting || Boolean(scopedSync?.busy) || isDiffSyncBusy(scopedSync?.stage);
  const oldestLocalAssetAgeDays = localAssets?.oldestCreatedAt
    ? Math.floor((Date.now() - localAssets.oldestCreatedAt) / (24 * 60 * 60 * 1000))
    : 0;
  const localAssetsLevel = localAssets?.quotaLevel === "blocked"
    ? "blocked"
    : localAssets?.quotaLevel === "critical" || (localAssets?.bytes ?? 0) >= 250 * 1024 * 1024
      ? "critical"
      : localAssets && localAssets.count > 0 && (localAssets.quotaLevel === "warning" || !localAssets.persistent || localAssets.bytes >= 100 * 1024 * 1024 || oldestLocalAssetAgeDays >= 7)
        ? "warning"
        : "ok";

  const closeSyncPanel = () => {
    setSyncOpen(false);
    setSyncScope(null);
    requestAnimationFrame(() => syncToggleRef.current?.focus());
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      await onImport(await file.text(), file.name);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Не удалось импортировать патч");
    } finally {
      event.currentTarget.value = "";
    }
  };

  const beginManual = (conflict: DiffConflictItem) => {
    setManualConflict(conflict.id);
    setManualValue(stringifyValue(conflict.localValue));
  };

  const resolveManual = (conflict: DiffConflictItem) => {
    if (!onResolveConflict) return;
    let value: unknown = manualValue;
    if (typeof conflict.localValue !== "string") {
      try {
        value = JSON.parse(manualValue);
      } catch {
        return;
      }
    }
    onResolveConflict(conflict.id, "local", value);
    setManualConflict(null);
  };

  return (
    <div className="modal-layer modal-layer--right" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="diff-title" aria-modal="true" className="diff-dialog" ref={dialogRef} role="dialog">
        <header className="modal-header diff-dialog__header">
          <div>
            <h2 id="diff-title">Локальные правки</h2>
            <p>{review.uniqueSelectionIds.length} {review.uniqueSelectionIds.length === 1 ? "изменение" : "изменений"} · {formatBytes(patchBytes)}</p>
          </div>
          <div className="diff-dialog__header-actions">
            {review.uniqueSelectionIds.length && !selection.enabled ? <button className="button button--secondary diff-selection-button" onClick={onEnterSelection} type="button">Выбрать часть</button> : null}
            {scopedSync ? <DiffSyncButton actionLabel={syncOpen ? activeSyncScope.actionLabel : actionLabel} busy={syncBusy} expanded={syncOpen} onClick={() => {
              if (syncOpen) closeSyncPanel();
              else {
                setSyncScope({ actionLabel, partialScopeUnavailable, selectedPaths });
                setSyncOpen(true);
              }
            }} ref={syncToggleRef} /> : null}
            <button aria-label="Закрыть" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
          </div>
        </header>

        <div className="diff-dialog__body">
          {scopedSync ? <DiffSyncPanel blockedReason={syncBlockedReason} controller={scopedSync} onBusyChange={setSyncSubmitting} onClose={closeSyncPanel} open={syncOpen} /> : null}
          {error ? <div className="inline-alert inline-alert--error" role="alert"><Icon name="warning" /><span>{error}</span>{onDismissError ? <button onClick={onDismissError} type="button">Скрыть</button> : null}</div> : null}
          {localAssets ? (
            <section aria-labelledby="local-assets-title" className={`local-assets-panel local-assets-panel--${localAssetsLevel}`}>
              <div className="local-assets-panel__heading">
                <div>
                  <h3 id="local-assets-title">Локальные вложения</h3>
                  <strong>Только на этом устройстве: {localAssets.count} {localAssets.count === 1 ? "файл" : localAssets.count > 1 && localAssets.count < 5 ? "файла" : "файлов"}, {formatBytes(localAssets.bytes)}</strong>
                </div>
                <span>{localAssets.quotaLevel === "unknown" ? "Лимит неизвестен" : localAssets.quotaLevel === "blocked" ? "Новые вложения заблокированы" : localAssets.quotaLevel === "critical" ? "Хранилище почти заполнено" : localAssets.quotaLevel === "warning" ? "Мало свободного места" : "Квота в норме"}</span>
              </div>
              {localAssets.count > 0 && !localAssets.persistent ? <p>Браузер не гарантирует постоянное хранение. Закоммитьте или экспортируйте данные.</p> : null}
              {oldestLocalAssetAgeDays >= 7 ? <p>Самому старому локальному файлу {oldestLocalAssetAgeDays} дн.</p> : null}
            </section>
          ) : null}
          <div className="diff-toolbar">
            <button className="button button--secondary" onClick={onExport} type="button"><Icon name="download" size={17} />Экспортировать локальную копию</button>
            {localAssets?.onFreeSpace ? <button className="button button--secondary button--danger-text" disabled={!localAssets.count} onClick={localAssets.onFreeSpace} type="button"><Icon name="trash" size={17} />Освободить место</button> : null}
            <button className="button button--secondary" onClick={() => fileInputRef.current?.click()} type="button"><Icon name="upload" size={17} />Импорт</button>
            <input accept="application/json,.json,.patch" hidden onChange={(event) => void importFile(event)} ref={fileInputRef} type="file" />
          </div>
          {importError ? (
            <div className="inline-alert inline-alert--error" role="alert">
              <Icon name="warning" />
              <span>{importError}</span>
              {onDownloadCorruptedRaw ? <button onClick={onDownloadCorruptedRaw} type="button">Скачать исходное значение</button> : null}
            </div>
          ) : null}
          {onDownloadCorruptedRaw ? (
            <div className="inline-alert inline-alert--error" role="alert">
              <Icon name="warning" />
              <span>В localStorage найдено повреждённое raw-значение. Скачайте его перед сбросом или импортом.</span>
              <button onClick={onDownloadCorruptedRaw} type="button">Скачать raw</button>
            </div>
          ) : null}

          {conflicts.length ? (
            <section className="conflicts-panel" aria-labelledby="conflicts-title">
              <div className="section-heading">
                <div><span className="section-icon section-icon--warning"><Icon name="warning" /></span><div><h3 id="conflicts-title">Нужно разрешить конфликты</h3><p>Эти поля изменились и в опубликованной базе, и локально.</p></div></div>
              </div>
              {conflicts.map((conflict) => (
                <article className="conflict-card" key={conflict.id}>
                  <strong>{conflict.label}</strong>
                  <code>{conflict.path}</code>
                  <div className="conflict-card__compare">
                    <div><span>На сайте</span><pre>{stringifyValue(conflict.staticValue)}</pre></div>
                    <div><span>Локально</span><pre>{stringifyValue(conflict.localValue)}</pre></div>
                  </div>
                  {manualConflict === conflict.id ? (
                    <div className="conflict-card__manual">
                      <label>Объединённое значение<textarea onChange={(event) => setManualValue(event.currentTarget.value)} rows={5} value={manualValue} /></label>
                      <button className="button button--primary" onClick={() => resolveManual(conflict)} type="button">Применить</button>
                    </div>
                  ) : (
                    <div className="conflict-card__actions">
                      <button onClick={() => onResolveConflict?.(conflict.id, "static")} type="button">Оставить с сайта</button>
                      <button onClick={() => onResolveConflict?.(conflict.id, "local")} type="button">Оставить локальное</button>
                      {conflict.canMergeManually === false ? null : <button onClick={() => beginManual(conflict)} type="button">Объединить вручную</button>}
                    </div>
                  )}
                </article>
              ))}
            </section>
          ) : null}

          {review.groups.length ? (
            <div className="diff-groups">
              {review.groups.map((group) => {
                const groupSelectionIds = uniqueGroupSelectionIds(group);
                const selectedCount = groupSelectionIds.filter((selectionId) => selection.selectedSelectionIds.has(selectionId)).length;
                const collapsed = collapsedGroups.has(group.id);
                const coverUrl = group.coverAssetId ? resolveAssetUrl?.(group.coverAssetId) ?? null : null;
                return (
                  <section className="game-diff-group" key={group.id}>
                    <header>
                      <div className="game-diff-group__identity">
                        {selection.enabled ? (
                          <TriStateCheckbox
                            aria-label={`Выбрать игру: ${group.title}`}
                            checked={selectedCount === groupSelectionIds.length}
                            indeterminate={selectedCount > 0 && selectedCount < groupSelectionIds.length}
                            onChange={() => onToggleGame(group.gameId)}
                          />
                        ) : null}
                        <span className="game-diff-group__cover" data-cover-asset-id={group.coverAssetId ?? undefined}>
                          {coverUrl ? <img alt={`Обложка: ${group.title}`} src={coverUrl} /> : <Icon aria-hidden="true" name={group.coverAssetId ? "image" : "gamepad"} size={15} />}
                        </span>
                        <div><h3>{group.title}</h3><span>{group.changes.length}</span></div>
                      </div>
                      <div className="game-diff-group__actions">
                        {onUndoGame ? <button aria-label={`Отменить игру: ${group.title}`} className="icon-button" onClick={() => onUndoGame(group.gameId)} title="Отменить изменения игры" type="button"><Icon name="close" size={15} /></button> : null}
                        <button
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? "Развернуть" : "Свернуть"}: ${group.title}`}
                          className={`icon-button game-diff-group__collapse${collapsed ? " is-collapsed" : ""}`}
                          onClick={() => setCollapsedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })}
                          type="button"
                        ><Icon name="chevron-down" size={15} /></button>
                      </div>
                    </header>
                    {!collapsed ? (
                      <ul>
                        {group.changes.map((change) => {
                          const checked = selection.selectedSelectionIds.has(change.selectionId);
                          const dependencyOnly = selection.dependencySelectionIds.has(change.selectionId)
                            && !selection.explicitSelectionIds.has(change.selectionId);
                          return (
                            <li className={`game-diff-row game-diff-row--${change.kind}${dependencyOnly ? " is-dependency" : ""}`} data-change-kind={change.kind} key={change.id}>
                              {selection.enabled ? (
                                <input
                                  aria-label={`Выбрать изменение: ${change.title}`}
                                  checked={checked}
                                  className="game-diff-row__selection"
                                  disabled={dependencyOnly}
                                  onChange={() => onToggleChange(change.selectionId)}
                                  type="checkbox"
                                />
                              ) : null}
                              <div className="game-diff-row__content">
                                <div className="game-diff-row__heading">
                                  <span aria-label={`Тип изменения: ${kindLabels[change.kind]}`} className={`game-diff-kind game-diff-kind--${change.kind}`}>{kindLabels[change.kind]}</span>
                                  <strong>{change.title}</strong>
                                </div>
                                <p className="game-diff-row__summary">{visibleSummary(change)}</p>
                                {dependencyOnly ? <small className="game-diff-row__dependency">{selection.dependencyLabels[change.selectionId] ?? "связано с выбранным изменением"}</small> : null}
                                <div className="game-diff-row__evidence">{change.evidence.map((evidence, index) => <ChangeEvidenceView evidence={evidence} key={`${change.id}:evidence:${index}`} resolveAssetUrl={resolveAssetUrl} />)}</div>
                              </div>
                              {onUndoChange ? <button aria-label={`Отменить: ${change.title}`} className="icon-button game-diff-row__undo" onClick={() => onUndoChange(change.selectionId)} title="Отменить" type="button"><Icon name="close" size={15} /></button> : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="empty-state empty-state--compact">
              <span className="empty-state__icon"><Icon name="check" /></span>
              <h3>Всё опубликовано</h3>
              <p>Локальный патч пуст — синхронизировать нечего.</p>
            </div>
          )}

        </div>

        {(review.uniqueSelectionIds.length || onDownloadCorruptedRaw) && onClearAll ? (
          <footer className="diff-dialog__footer">
            <button className="button button--ghost button--danger-text" onClick={onClearAll} type="button"><Icon name="trash" size={17} />{review.uniqueSelectionIds.length ? "Отменить все правки" : "Сбросить повреждённый патч"}</button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
