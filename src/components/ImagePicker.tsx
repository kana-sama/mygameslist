import { useId, useRef, useState, type DragEvent } from "react";
import { optimizeCover, optimizeNoteImage } from "../domain/assets";
import { Icon } from "./Icon";

export interface PreparedImage {
  clientId: string;
  assetId: string;
  mime: "image/webp";
  width: number;
  height: number;
  blob: Blob;
  alt: string;
  originalName: string;
  byteLength: number;
}

export interface ImagePickerProps {
  mode: "cover" | "note";
  label?: string;
  alt?: string;
  currentPreviewUrl?: string | null;
  canAddBlob?: (byteLength: number) => string | null | Promise<string | null>;
  onPrepare: (image: PreparedImage) => boolean | void | Promise<boolean | void>;
  onDraftChange?: (dirty: boolean) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

function containsFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function clipboardImageName(mime: string): string {
  const extension = mime.toLowerCase() === "image/jpeg"
    ? "jpg"
    : /^image\/(?:png|webp|gif)$/.test(mime.toLowerCase())
      ? mime.slice("image/".length).toLowerCase()
      : "png";
  return `clipboard-image.${extension}`;
}

async function readClipboardImage(): Promise<File> {
  if (typeof navigator.clipboard?.read !== "function") {
    throw new Error("Этот браузер не умеет читать изображения из буфера обмена.");
  }
  let items: ClipboardItems;
  try { items = await navigator.clipboard.read(); }
  catch (reason) {
    if (reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "SecurityError")) {
      throw new Error("Safari не разрешил доступ к буферу обмена. Разрешите доступ и попробуйте ещё раз.");
    }
    throw new Error(reason instanceof Error ? `Не удалось прочитать буфер обмена: ${reason.message}` : "Не удалось прочитать буфер обмена.");
  }
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.toLowerCase().startsWith("image/"));
    if (!type) continue;
    let blob: Blob;
    try { blob = await item.getType(type); }
    catch (reason) {
      throw new Error(reason instanceof Error ? `Не удалось прочитать изображение из буфера обмена: ${reason.message}` : "Не удалось прочитать изображение из буфера обмена.");
    }
    const mime = blob.type || type;
    return new File([blob], clipboardImageName(mime), { type: mime, lastModified: Date.now() });
  }
  throw new Error("В буфере обмена нет изображения.");
}

export function ImagePicker({
  mode,
  label = mode === "cover" ? "Обложка" : "Изображение",
  alt = "",
  currentPreviewUrl,
  canAddBlob,
  onPrepare,
  onDraftChange,
  onRemove,
  disabled = false,
}: ImagePickerProps) {
  const inputId = useId();
  const dragDepth = useRef(0);
  const processing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processImage = async (loadFile: () => File | Promise<File>) => {
    if (disabled || processing.current) return;
    setError(null);
    processing.current = true;
    setBusy(true);
    onDraftChange?.(true);
    try {
      const file = await loadFile();
      if (file.type && !file.type.startsWith("image/")) {
        setError("Выберите изображение, а не другой тип файла.");
        return;
      }
      const imageAlt = alt.trim() || file.name.replace(/\.[^.]+$/, "");
      const optimized = mode === "cover" ? await optimizeCover(file, imageAlt) : await optimizeNoteImage(file, imageAlt);
      const storageError = await canAddBlob?.(optimized.byteLength);
      if (storageError) {
        setError(storageError);
        return;
      }
      const prepared: PreparedImage = {
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
      const accepted = await onPrepare(prepared);
      if (accepted === false) setError("Не удалось сохранить изображение.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить изображение");
    } finally {
      processing.current = false;
      setBusy(false);
      onDraftChange?.(false);
    }
  };

  const processFile = async (file: File | undefined) => {
    if (!file) return;
    await processImage(() => file);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || processing.current || !containsFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || processing.current || !containsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/")) ?? event.dataTransfer.files[0];
    void processFile(file);
  };

  return (
    <div aria-busy={busy} className={`image-picker image-picker--${mode}`}>
      <span className="field-label">{label}</span>
      <div className="image-picker__workspace">
        <div className={`image-picker__preview${dragOver ? " is-drag-over" : ""}`} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
          {currentPreviewUrl ? (
            <img alt="Предпросмотр" src={currentPreviewUrl} />
          ) : (
            <div className="image-picker__empty">
              <Icon name="image" size={30} />
              <span>{busy ? "Обрабатываем…" : "Перетащите изображение"}</span>
            </div>
          )}
          {busy && currentPreviewUrl ? <span className="image-picker__busy">Обрабатываем…</span> : null}
        </div>
        <div className="image-picker__actions">
          <label aria-disabled={disabled || busy} className="button button--secondary" htmlFor={inputId}>
            <Icon name="upload" size={18} />
            {busy ? "Обрабатываем…" : currentPreviewUrl ? "Заменить" : "Выбрать файл"}
          </label>
          <input
            accept="image/*"
            disabled={disabled || busy}
            id={inputId}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void processFile(file);
            }}
            type="file"
          />
          {mode === "cover" ? (
            <button className="button button--secondary" disabled={disabled || busy} onClick={() => void processImage(readClipboardImage)} type="button">
              <Icon name="clipboard" size={17} />{busy ? "Обрабатываем…" : "Вставить из буфера обмена"}
            </button>
          ) : null}
          {currentPreviewUrl && onRemove ? (
            <button className="button button--ghost button--danger-text" disabled={busy} onClick={onRemove} type="button">
              <Icon name="trash" size={17} />Удалить
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
