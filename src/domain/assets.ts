import { sha256Bytes } from "./canonical";
import type { Asset, FileAsset, ImageAsset, LegacyImageAsset } from "./types";

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

export function isCanonicalBase64(value: string): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  try { return bytesToBase64(base64ToBytes(value)) === value; }
  catch { return false; }
}

export function base64DecodedBytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

export function isWebP(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

export function makeWebPAsset(bytes: Uint8Array, width: number, height: number, alt = "", originalName = "image.webp"): LegacyImageAsset {
  if (!isWebP(bytes)) throw new Error("Файл не является WebP");
  return { id: sha256Bytes(bytes), mime: "image/webp", width, height, base64: bytesToBase64(bytes), alt, originalName };
}

export function externalizeWebPAsset(asset: LegacyImageAsset): { asset: ImageAsset; base64: string } {
  const bytes = base64ToBytes(asset.base64);
  if (!isWebP(bytes) || sha256Bytes(bytes) !== asset.id) throw new Error("Изображение повреждено");
  return {
    asset: {
      id: asset.id,
      kind: "image",
      mime: "image/webp",
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      alt: asset.alt,
      originalName: asset.originalName,
    },
    base64: asset.base64,
  };
}

export function makeExternalWebPAsset(bytes: Uint8Array, width: number, height: number, alt = "", originalName = "image.webp"): { asset: ImageAsset; base64: string } {
  return externalizeWebPAsset(makeWebPAsset(bytes, width, height, alt, originalName));
}

export function makeFileAsset(bytes: Uint8Array, mime: string, originalName: string): { asset: FileAsset; base64: string } {
  const normalizedMime = mime.trim() || "application/octet-stream";
  return {
    asset: { id: sha256Bytes(bytes), kind: "file", mime: normalizedMime, byteLength: bytes.byteLength, originalName },
    base64: bytesToBase64(bytes),
  };
}

export function isImageAsset(asset: Asset): asset is ImageAsset { return asset.kind === "image"; }

export function isMp4FileMetadata(file: Pick<FileAsset, "mime" | "originalName">): boolean {
  return file.mime.toLowerCase() === "video/mp4";
}

/** Adds WebKit's preview-frame hint to seekable URLs without breaking local data URLs. */
export function withVideoPreviewFragment(href: string): string {
  if (/^data:/i.test(href)) return href;
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return `${href}#t=0.001`;
  const base = href.slice(0, hashIndex);
  const fragments = href.slice(hashIndex + 1).split("&").filter((fragment) => fragment && !/^t=/i.test(fragment));
  return `${base}#${[...fragments, "t=0.001"].join("&")}`;
}

export function assetDataUrl(asset: Asset, blobBase64?: string): string | null {
  if (blobBase64 === undefined) return null;
  const mime = asset.kind === "image" ? "image/webp" : asset.mime;
  return `data:${mime};base64,${blobBase64}`;
}

export function publishedAssetUrl(asset: Asset, baseUrl: string): string {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const extension = asset.kind === "image" ? "webp" : isMp4FileMetadata(asset) ? "mp4" : "bin";
  return `${root}media/${asset.id}.${extension}`;
}

export interface OptimizedImage { asset: LegacyImageAsset; blob: Blob; byteLength: number }

interface CropRect { x: number; y: number; width: number; height: number }
export type WebPEncoder = (image: ImageData, quality: number) => Promise<Uint8Array>;

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.decoding = "async";
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Safari не смог декодировать изображение")); image.src = url; });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function nativeWebPBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try { canvas.toBlob(resolve, "image/webp", quality); }
    catch { resolve(null); }
  });
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return isWebP(bytes) ? bytes : null;
}

async function wasmWebPBytes(image: ImageData, quality: number): Promise<Uint8Array> {
  const { default: encode } = await import("@jsquash/webp/encode");
  const bytes = new Uint8Array(await encode(image, { quality: Math.round(quality * 100) }));
  if (!isWebP(bytes)) throw new Error("WebP-кодировщик вернул повреждённый файл");
  return bytes;
}

export async function canvasToWebPBytes(canvas: HTMLCanvasElement, quality = 0.82, fallback: WebPEncoder = wasmWebPBytes): Promise<Uint8Array> {
  const nativeBytes = await nativeWebPBytes(canvas, quality);
  if (nativeBytes) return nativeBytes;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas недоступен");
  try { return await fallback(context.getImageData(0, 0, canvas.width, canvas.height), quality); }
  catch (reason) { throw new Error("Safari не смог создать WebP", { cause: reason }); }
}

async function render(file: File, image: HTMLImageElement, outputWidth: number, outputHeight: number, source: CropRect, alt: string): Promise<OptimizedImage> {
  const canvas = document.createElement("canvas"); canvas.width = outputWidth; canvas.height = outputHeight;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas недоступен");
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, outputWidth, outputHeight);
  const bytes = await canvasToWebPBytes(canvas); const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/webp" });
  return { asset: makeWebPAsset(bytes, outputWidth, outputHeight, alt, file.name), blob, byteLength: bytes.byteLength };
}

export async function optimizeCover(file: File, alt = ""): Promise<OptimizedImage> {
  const image = await loadImage(file); const size = Math.min(image.naturalWidth, image.naturalHeight);
  const source = { x: (image.naturalWidth - size) / 2, y: (image.naturalHeight - size) / 2, width: size, height: size };
  return render(file, image, 512, 512, source, alt);
}

export async function optimizeNoteImage(file: File, alt = ""): Promise<OptimizedImage> {
  const image = await loadImage(file); const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
  return render(file, image, width, height, { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }, alt);
}
