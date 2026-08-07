import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent } from "react";
import { firstMarkdownHeading, resolveNoteChecklistProgress } from "../domain/markdownChecklist";
import { optimizeProgressIcon } from "../domain/progressIcon";
import { DEFAULT_NOTE_GROUP_RANK, type Asset, type Note } from "../domain/types";
import type { EditableGameProgressItem } from "../pages/GamePage";
import { clipboardImageFile, readClipboardImage } from "./clipboardImage";
import { Icon } from "./Icon";
import type { PreparedImage } from "./ImagePicker";
import { getAssetUrl } from "./libraryUi";

export interface GameProgressItemDialogProps {
  gameId: string;
  item: EditableGameProgressItem;
  notes: readonly Note[];
  assets: Record<string, Asset>;
  storageLocked: boolean;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  resolveAssetUrl?: (assetId: string) => string | null;
  onCancel(): void;
  onDelete?: () => void | Promise<void>;
  onSave(item: EditableGameProgressItem): void | Promise<void>;
}

function preparedImage(optimized: Awaited<ReturnType<typeof optimizeProgressIcon>>): PreparedImage {
  return {
    clientId: crypto.randomUUID(),
    assetId: optimized.asset.id,
    mime: "image/webp",
    width: optimized.asset.width,
    height: optimized.asset.height,
    blob: optimized.blob,
    alt: optimized.asset.alt,
    originalName: optimized.asset.originalName,
    byteLength: optimized.byteLength,
  };
}

function orderedNotes(notes: readonly Note[], gameId: string): Note[] {
  return notes
    .filter((note) => note.gameId === gameId)
    .sort((left, right) => (left.groupRank ?? DEFAULT_NOTE_GROUP_RANK) - (right.groupRank ?? DEFAULT_NOTE_GROUP_RANK)
      || left.rank - right.rank
      || left.id.localeCompare(right.id));
}

export function GameProgressItemDialog({
  gameId,
  item,
  notes,
  assets,
  storageLocked,
  canAddBlob,
  resolveAssetUrl,
  onCancel,
  onDelete,
  onSave,
}: GameProgressItemDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const processing = useRef(false);
  const [draft, setDraft] = useState<EditableGameProgressItem>(() => ({ ...item }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const onCancelRef = useRef(onCancel);
  busyRef.current = busy;
  dirtyRef.current = dirty;
  onCancelRef.current = onCancel;
  const availableNotes = useMemo(() => orderedNotes(notes, gameId), [gameId, notes]);
  const linkedNote = availableNotes.find((note) => note.id === draft.noteId);
  const resolution = linkedNote ? resolveNoteChecklistProgress(linkedNote.bodyMarkdown) : { status: "error" as const };
  const hasIcon = Boolean(draft.pendingIcon || draft.iconAssetId);
  const valid = hasIcon && resolution.status === "ok" && Number.isFinite(resolution.checked) && Number.isFinite(resolution.total);
  const currentAsset = draft.iconAssetId ? assets[draft.iconAssetId] : undefined;
  const currentUrl = pendingUrl ?? (draft.iconAssetId ? resolveAssetUrl?.(draft.iconAssetId) ?? getAssetUrl(currentAsset) : null);

  useEffect(() => {
    if (!draft.pendingIcon) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(draft.pendingIcon.blob);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.pendingIcon]);

  const requestClose = useCallback(() => {
    if (processing.current || busyRef.current) return;
    if (dirtyRef.current && !window.confirm("Закрыть без сохранения изменений?")) return;
    onCancelRef.current();
  }, []);

  useEffect(() => {
    const element = dialogRef.current;
    const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex='0']") ?? []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
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
  }, [requestClose]);

  const processImage = async (loadFile: () => File | Promise<File>) => {
    if (storageLocked || processing.current) return;
    processing.current = true;
    setBusy(true);
    setError(null);
    try {
      const file = await loadFile();
      if (file.type && !file.type.startsWith("image/")) {
        setError("Выберите изображение, а не другой тип файла.");
        return;
      }
      const optimized = await optimizeProgressIcon(file, "");
      const storageError = await canAddBlob?.(optimized.byteLength);
      if (storageError) {
        setError(storageError);
        return;
      }
      setDraft((current) => ({ ...current, iconAssetId: null, pendingIcon: preparedImage(optimized) }));
      setDirty(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить изображение");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };

  const processFile = (file: File) => processImage(() => file);

  const pasteFromClipboard = () => processImage(readClipboardImage);

  const onPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const file = clipboardImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void processFile(file);
  };

  const save = async () => {
    if (!valid || busy) {
      setError(!hasIcon ? "Выберите иконку прогресса." : "Выберите заметку с конечным прогрессом.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить элемент прогресса");
      setBusy(false);
    }
  };

  const remove = () => {
    setDraft((current) => ({ ...current, iconAssetId: null, pendingIcon: null }));
    setDirty(true);
    setError(null);
  };

  const deleteItem = async () => {
    if (!onDelete || busy || !window.confirm("Удалить элемент прогресса?")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось удалить элемент прогресса");
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer game-progress-dialog-layer" onMouseDown={(event) => event.target === event.currentTarget && requestClose()} role="presentation">
      <section aria-busy={busy} aria-labelledby={titleId} aria-modal="true" className="game-progress-dialog" onPaste={onPaste} ref={dialogRef} role="dialog">
        <header className="modal-header game-progress-dialog__header">
          <h2 id={titleId}>Элемент прогресса</h2>
          <button aria-label="Закрыть" className="icon-button" disabled={busy} onClick={requestClose} type="button"><Icon name="close" /></button>
        </header>
        <div className="game-progress-dialog__body">
          <div className="game-progress-dialog__preview">
            {currentUrl ? <img alt="Предпросмотр иконки прогресса" height={64} src={currentUrl} width={64} /> : <span><Icon name="image" size={24} /></span>}
          </div>
          {hasIcon ? <p className="game-progress-dialog__preview-meta">64×64 WebP</p> : null}
          <div className="game-progress-dialog__image-actions">
            <label aria-disabled={storageLocked || busy} className="button button--secondary">
              <Icon name="upload" size={16} />Выбрать файл
              <input accept="image/*" aria-label="Выбрать файл" disabled={storageLocked || busy} onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void processFile(file);
              }} type="file" />
            </label>
            <button className="button button--secondary" disabled={storageLocked || busy} onClick={() => void pasteFromClipboard()} type="button"><Icon name="clipboard" size={16} />Вставить</button>
            {currentUrl ? <button className="button button--ghost button--danger-text" disabled={busy} onClick={remove} type="button"><Icon name="trash" size={16} />Убрать</button> : null}
          </div>
          <label className="field-group">
            <span className="field-label">Заметка</span>
            <select aria-label="Заметка" disabled={busy} onChange={(event) => {
              const noteId = event.currentTarget.value;
              setDraft((current) => ({ ...current, noteId }));
              setDirty(true);
              setError(null);
            }} value={draft.noteId}>
              <option value="">Выберите заметку</option>
              {availableNotes.map((note, index) => <option key={note.id} value={note.id}>{firstMarkdownHeading(note.bodyMarkdown) ?? `Заметка ${index + 1}`}</option>)}
            </select>
          </label>
          <div aria-live="polite" className={`game-progress-dialog__progress${resolution.status === "ok" && resolution.checked === resolution.total ? " is-complete" : ""}${resolution.status === "error" ? " is-error" : ""}`}>
            <span>Прогресс</span>
            <strong>{resolution.status === "ok" ? `${resolution.checked}/${resolution.total}` : "ошибка"}</strong>
          </div>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <footer className="game-progress-dialog__footer">
          {onDelete ? <button className="button button--ghost button--danger-text game-progress-dialog__delete" disabled={busy} onClick={() => void deleteItem()} type="button">Удалить</button> : null}
          <button className="button button--secondary" disabled={busy} onClick={requestClose} type="button">Отмена</button>
          <button className="button button--primary" disabled={!valid || busy} onClick={() => void save()} type="button">Сохранить</button>
        </footer>
      </section>
    </div>
  );
}
