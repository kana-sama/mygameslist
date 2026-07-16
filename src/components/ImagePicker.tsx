import { useId, useRef, useState, type DragEvent } from "react";
import { optimizeCover, optimizeNoteImage } from "../domain/assets";
import { Icon } from "./Icon";

export interface PreparedImage {
  clientId: string;
  mime: "image/webp";
  width: number;
  height: number;
  base64: string;
  alt: string;
  originalName: string;
  byteLength: number;
}

export interface ImagePickerProps {
  mode: "cover" | "note";
  label?: string;
  alt?: string;
  currentPreviewUrl?: string | null;
  onPrepare: (image: PreparedImage) => boolean | void | Promise<boolean | void>;
  onDraftChange?: (dirty: boolean) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

function containsFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function ImagePicker({
  mode,
  label = mode === "cover" ? "Обложка" : "Изображение",
  alt = "",
  currentPreviewUrl,
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

  const processFile = async (file: File | undefined) => {
    if (!file || disabled || processing.current) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Выберите изображение, а не другой тип файла.");
      return;
    }

    processing.current = true;
    setBusy(true);
    onDraftChange?.(true);
    try {
      const imageAlt = alt.trim() || file.name.replace(/\.[^.]+$/, "");
      const optimized = mode === "cover" ? await optimizeCover(file, imageAlt) : await optimizeNoteImage(file, imageAlt);
      const prepared: PreparedImage = {
        clientId: crypto.randomUUID(),
        mime: "image/webp",
        width: optimized.asset.width,
        height: optimized.asset.height,
        base64: optimized.asset.base64,
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
          {currentPreviewUrl && onRemove ? (
            <button className="button button--ghost button--danger-text" disabled={disabled || busy} onClick={onRemove} type="button">
              <Icon name="trash" size={17} />Удалить
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
