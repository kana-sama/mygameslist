import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "./Icon";
import { formatBytes } from "./libraryUi";

export type DiffGroupId = "added" | "changed" | "deleted" | "moved" | "assets";

export interface DiffItem {
  id: string;
  group: DiffGroupId;
  title: string;
  detail?: string;
  meta?: string[];
  transactionId?: string;
}

export interface DiffConflictItem {
  id: string;
  path: string;
  label: string;
  staticValue: unknown;
  localValue: unknown;
  canMergeManually?: boolean;
}

export interface DiffDialogProps {
  open: boolean;
  items: DiffItem[];
  conflicts?: DiffConflictItem[];
  patchBytes: number;
  payload: string;
  payloadPreparing?: boolean;
  publishCommand: string;
  error?: string;
  onClose: () => void;
  onUndoItem?: (itemId: string) => void;
  onUndoGroup?: (groupId: DiffGroupId) => void;
  onClearAll?: () => void;
  onExport: () => void;
  onImport: (text: string, fileName: string) => void | Promise<void>;
  onResolveConflict?: (conflictId: string, resolution: "static" | "local", manualValue?: unknown) => void;
  onDownloadCorruptedRaw?: () => void;
  onDismissError?: () => void;
  copyPatch?: () => Promise<boolean>;
}

const groupLabels: Record<DiffGroupId, string> = {
  added: "Добавлено",
  changed: "Изменено",
  deleted: "Удалено",
  moved: "Перемещено",
  assets: "Изображения",
};

const groupIcons: Record<DiffGroupId, "plus" | "edit" | "trash" | "drag" | "image"> = {
  added: "plus",
  changed: "edit",
  deleted: "trash",
  moved: "drag",
  assets: "image",
};

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
  items,
  conflicts = [],
  patchBytes,
  payload,
  payloadPreparing = false,
  publishCommand,
  error,
  onClose,
  onUndoItem,
  onUndoGroup,
  onClearAll,
  onExport,
  onImport,
  onResolveConflict,
  onDownloadCorruptedRaw,
  onDismissError,
  copyPatch,
}: DiffDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyAttemptRef = useRef(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fallback">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [manualConflict, setManualConflict] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");
  const grouped = useMemo(() => {
    const result = new Map<DiffGroupId, DiffItem[]>();
    for (const item of items) result.set(item.group, [...(result.get(item.group) ?? []), item]);
    return result;
  }, [items]);

  useEffect(() => {
    if (!open) return;
    setCopyState("idle");
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
    copyAttemptRef.current += 1;
    setCopyState("idle");
  }, [payload]);

  if (!open) return null;

  const copy = async () => {
    const attempt = ++copyAttemptRef.current;
    try {
      const success = copyPatch ? await copyPatch() : await navigator.clipboard.writeText(payload).then(() => true);
      if (attempt === copyAttemptRef.current) setCopyState(success ? "copied" : "fallback");
    } catch {
      if (attempt === copyAttemptRef.current) setCopyState("fallback");
    }
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
            <p>{items.length} {items.length === 1 ? "изменение" : "изменений"} · {formatBytes(patchBytes)}</p>
          </div>
          <button aria-label="Закрыть" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </header>

        <div className="diff-dialog__body">
          {error ? <div className="inline-alert inline-alert--error" role="alert"><Icon name="warning" /><span>{error}</span>{onDismissError ? <button onClick={onDismissError} type="button">Скрыть</button> : null}</div> : null}
          <div className="diff-toolbar">
            <button className="button button--secondary" onClick={onExport} type="button"><Icon name="download" size={17} />Экспорт</button>
            <button className="button button--secondary" onClick={() => fileInputRef.current?.click()} type="button"><Icon name="upload" size={17} />Импорт</button>
            <input accept="application/json,.json,.patch" onChange={(event) => void importFile(event)} ref={fileInputRef} type="file" />
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

          {items.length ? (
            <div className="diff-groups">
              {Array.from(grouped.entries()).map(([groupId, groupItems]) => (
                <section className="diff-group" key={groupId}>
                  <header>
                    <div><span className={`section-icon section-icon--${groupId}`}><Icon name={groupIcons[groupId]} /></span><h3>{groupLabels[groupId]}</h3><span>{groupItems.length}</span></div>
                    {onUndoGroup ? <button onClick={() => onUndoGroup(groupId)} type="button">Отменить группу</button> : null}
                  </header>
                  <ul>
                    {groupItems.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          {item.detail ? <span>{item.detail}</span> : null}
                          {item.meta?.length ? <small>{item.meta.join(" · ")}</small> : null}
                        </div>
                        {onUndoItem ? <button aria-label={`Отменить: ${item.title}`} className="icon-button" onClick={() => onUndoItem(item.id)} title="Отменить" type="button"><Icon name="close" size={17} /></button> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state--compact">
              <span className="empty-state__icon"><Icon name="check" /></span>
              <h3>Всё опубликовано</h3>
              <p>Локальный патч пуст — копировать и применять нечего.</p>
            </div>
          )}

          {items.length ? (
            <section className="publish-panel">
              <div className="section-heading">
                <div><span className="section-icon section-icon--publish"><Icon name="clipboard" /></span><div><h3>Опубликовать</h3><p>Скопируйте патч и сразу запустите постоянную команду в локальном клоне.</p></div></div>
              </div>
              {conflicts.length ? <p className="publish-panel__blocked"><Icon name="warning" size={17} />Сначала разрешите все конфликты.</p> : null}
              <code className="publish-panel__command">{publishCommand}</code>
              <button className="button button--primary button--wide" disabled={Boolean(conflicts.length) || payloadPreparing || !payload} onClick={() => void copy()} type="button">
                <Icon name={copyState === "copied" ? "check" : "clipboard"} size={18} />
                {copyState === "copied" ? "Патч скопирован" : payloadPreparing ? "Подготавливаем патч…" : "Скопировать патч"}
              </button>
              {copyState === "fallback" ? (
                <div className="copy-fallback">
                  <label htmlFor="publish-payload">Safari не разрешил доступ к буферу. Скопируйте патч вручную; в терминал его вставлять не нужно:</label>
                  <textarea id="publish-payload" onFocus={(event) => event.currentTarget.select()} readOnly rows={5} value={payload} />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        {(items.length || onDownloadCorruptedRaw) && onClearAll ? (
          <footer className="diff-dialog__footer">
            <button className="button button--ghost button--danger-text" onClick={onClearAll} type="button"><Icon name="trash" size={17} />{items.length ? "Отменить все правки" : "Сбросить повреждённый патч"}</button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
