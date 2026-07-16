import { useId, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { formatBytes } from "./libraryUi";

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

interface SourceImage {
  dataUrl: string;
  fileName: string;
  width: number;
  height: number;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать файл"));
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Safari не смог прочитать это изображение"));
    image.src = source;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Не удалось преобразовать изображение в WebP")),
      "image/webp",
      0.82,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await readFile(new File([blob], "image.webp", { type: "image/webp" }));
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
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
  const [source, setSource] = useState<SourceImage | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSize, setLastSize] = useState<number | null>(null);

  const previewStyle = useMemo(() => {
    if (!source || mode !== "cover") return undefined;
    return {
      transform: `scale(${zoom}) translate(${offsetX / zoom}%, ${offsetY / zoom}%)`,
    };
  }, [mode, offsetX, offsetY, source, zoom]);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Выберите изображение, а не другой тип файла.");
      return;
    }
    try {
      const dataUrl = await readFile(file);
      const image = await loadImage(dataUrl);
      setSource({ dataUrl, fileName: file.name, width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setLastSize(null);
      onDraftChange?.(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть изображение");
    }
  };

  const prepare = async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const image = await loadImage(source.dataUrl);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("В Safari недоступна обработка изображений");

      if (mode === "cover") {
        canvas.width = 512;
        canvas.height = 512;
        const baseScale = Math.max(512 / image.naturalWidth, 512 / image.naturalHeight);
        const scale = baseScale * zoom;
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        const overflowX = Math.max(0, width - 512);
        const overflowY = Math.max(0, height - 512);
        const x = (512 - width) / 2 + (offsetX / 100) * overflowX / 2;
        const y = (512 - height) / 2 + (offsetY / 100) * overflowY / 2;
        context.drawImage(image, x, y, width, height);
      } else {
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }

      const blob = await canvasToWebp(canvas);
      const base64 = await blobToBase64(blob);
      const prepared: PreparedImage = {
        clientId: crypto.randomUUID(),
        mime: "image/webp",
        width: canvas.width,
        height: canvas.height,
        base64,
        alt: alt.trim() || source.fileName.replace(/\.[^.]+$/, ""),
        originalName: source.fileName,
        byteLength: blob.size,
      };
      setLastSize(blob.size);
      const accepted = await onPrepare(prepared);
      if (accepted !== false) { setSource(null); onDraftChange?.(false); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить изображение");
    } finally {
      setBusy(false);
    }
  };

  const previewUrl = source?.dataUrl ?? currentPreviewUrl;
  return (
    <div className={`image-picker image-picker--${mode}`}>
      <span className="field-label">{label}</span>
      <div className="image-picker__workspace">
        <div className="image-picker__preview">
          {previewUrl ? (
            <img alt="Предпросмотр" src={previewUrl} style={source ? previewStyle : undefined} />
          ) : (
            <div className="image-picker__empty">
              <Icon name="image" size={30} />
              <span>{mode === "cover" ? "Квадрат 512 × 512" : "До 1280 px"}</span>
            </div>
          )}
        </div>
        <div className="image-picker__actions">
          <label className="button button--secondary" htmlFor={inputId} aria-disabled={disabled}>
            <Icon name="upload" size={18} />
            {previewUrl ? "Заменить" : "Выбрать файл"}
          </label>
          <input
            accept="image/*"
            disabled={disabled}
            id={inputId}
            onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
            type="file"
          />
          {(currentPreviewUrl || lastSize) && onRemove ? (
            <button className="button button--ghost button--danger-text" onClick={onRemove} type="button">
              <Icon name="trash" size={17} />Удалить
            </button>
          ) : null}
        </div>
      </div>

      {source ? (
        <div className="image-picker__settings">
          <p>{source.width} × {source.height} px · после обработки будет показан точный размер.</p>
          {mode === "cover" ? (
            <div className="crop-controls">
              <label>Масштаб <input max="3" min="1" onChange={(event) => setZoom(Number(event.currentTarget.value))} step="0.05" type="range" value={zoom} /></label>
              <label>По горизонтали <input max="100" min="-100" onChange={(event) => setOffsetX(Number(event.currentTarget.value))} step="1" type="range" value={offsetX} /></label>
              <label>По вертикали <input max="100" min="-100" onChange={(event) => setOffsetY(Number(event.currentTarget.value))} step="1" type="range" value={offsetY} /></label>
            </div>
          ) : null}
          <button className="button button--primary" disabled={busy} onClick={() => void prepare()} type="button">
            <Icon name="sparkles" size={18} />{busy ? "Обрабатываем…" : "Подготовить WebP"}
          </button>
        </div>
      ) : null}
      {lastSize !== null ? (
        <p className="image-picker__result" role="status">
          Готово: {formatBytes(lastSize)} · около {formatBytes(Math.ceil(lastSize * 4 / 3) * 2)} в localStorage Safari.
        </p>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
