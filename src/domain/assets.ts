import { sha256Bytes } from "./canonical";
import type { Asset } from "./types";

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    for (let index = 0; index < chunk.length; index += 1) binary += String.fromCharCode(chunk[index]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function base64DecodedBytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

export function isWebP(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

export function makeWebPAsset(bytes: Uint8Array, width: number, height: number, alt = "", originalName = "image.webp"): Asset {
  if (!isWebP(bytes)) throw new Error("Файл не является WebP");
  return { id: sha256Bytes(bytes), mime: "image/webp", width, height, base64: bytesToBase64(bytes), alt, originalName };
}

export function assetDataUrl(asset: Asset): string { return `data:${asset.mime};base64,${asset.base64}`; }

export interface CropRect { x: number; y: number; width: number; height: number }
export interface OptimizedImage { asset: Asset; blob: Blob; byteLength: number }

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.decoding = "async";
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Safari не смог декодировать изображение")); image.src = url; });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function webpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Safari не смог создать WebP")), "image/webp", quality));
}

async function render(file: File, outputWidth: number, outputHeight: number, source: CropRect, alt: string): Promise<OptimizedImage> {
  const image = await loadImage(file); const canvas = document.createElement("canvas"); canvas.width = outputWidth; canvas.height = outputHeight;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas недоступен");
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, outputWidth, outputHeight);
  const blob = await webpBlob(canvas, 0.82); const bytes = new Uint8Array(await blob.arrayBuffer());
  return { asset: makeWebPAsset(bytes, outputWidth, outputHeight, alt, file.name), blob, byteLength: bytes.byteLength };
}

export async function optimizeCover(file: File, crop?: CropRect, alt = ""): Promise<OptimizedImage> {
  const image = await loadImage(file); const size = Math.min(image.naturalWidth, image.naturalHeight);
  const source = crop ?? { x: (image.naturalWidth - size) / 2, y: (image.naturalHeight - size) / 2, width: size, height: size };
  return render(file, 512, 512, source, alt);
}

export async function optimizeNoteImage(file: File, alt = ""): Promise<OptimizedImage> {
  const image = await loadImage(file); const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
  return render(file, width, height, { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }, alt);
}
