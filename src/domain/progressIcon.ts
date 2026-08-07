import {
  canvasToLosslessWebPBytes,
  loadImageElement,
  makeImageAssetMetadata,
  MAX_WEBP_DIMENSION,
  type OptimizedImage,
} from "./assets";

export interface PixelBounds { x: number; y: number; width: number; height: number }

export interface ProgressIconPlacement {
  source: PixelBounds;
  destination: PixelBounds;
}

export function nonTransparentPixelBounds(image: ImageData): PixelBounds | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] === 0) continue;
    const pixel = (offset - 3) / 4;
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function progressIconPlacement(bounds: PixelBounds): ProgressIconPlacement {
  const scale = Math.min(1, 64 / bounds.width, 64 / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  return {
    source: bounds,
    destination: { x: Math.floor((64 - width) / 2), y: Math.floor((64 - height) / 2), width, height },
  };
}

export async function optimizeProgressIcon(file: File, alt = ""): Promise<OptimizedImage> {
  const image = await loadImageElement(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width < 1 || height < 1 || width > MAX_WEBP_DIMENSION || height > MAX_WEBP_DIMENSION) {
    throw new Error(`WebP поддерживает размеры только до ${MAX_WEBP_DIMENSION}×${MAX_WEBP_DIMENSION} px; прикрепите это изображение как файл`);
  }

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("Canvas недоступен");
  sourceContext.drawImage(image, 0, 0, width, height);
  const bounds = nonTransparentPixelBounds(sourceContext.getImageData(0, 0, width, height));
  if (!bounds) throw new Error("Изображение полностью прозрачное.");

  const { source, destination } = progressIconPlacement(bounds);
  const destinationCanvas = document.createElement("canvas");
  destinationCanvas.width = 64;
  destinationCanvas.height = 64;
  const destinationContext = destinationCanvas.getContext("2d");
  if (!destinationContext) throw new Error("Canvas недоступен");
  destinationContext.imageSmoothingEnabled = true;
  destinationContext.imageSmoothingQuality = "high";
  destinationContext.drawImage(
    sourceCanvas,
    source.x,
    source.y,
    source.width,
    source.height,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  );
  const bytes = await canvasToLosslessWebPBytes(destinationCanvas);
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/webp" });
  return {
    asset: makeImageAssetMetadata(bytes, 64, 64, alt, file.name),
    blob,
    byteLength: bytes.byteLength,
  };
}
