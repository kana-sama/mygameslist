import { sha256Bytes } from "./canonical";
import { SAFARI_SAFE_BUDGET_BYTES, STORAGE_BLOCK_RATIO, storageIncreaseAllowed, webkitStorageBytes, webkitStringBytes } from "./storage";

export const LOCAL_ASSET_STORAGE_PREFIX = "my-game-library.local-assets.v1";
export const LOCAL_ASSET_METADATA_PREFIX = `${LOCAL_ASSET_STORAGE_PREFIX}.metadata.`;
export const LOCAL_ASSET_DATA_PREFIX = `${LOCAL_ASSET_STORAGE_PREFIX}.data.`;

export type LocalAssetState = "local" | "publishing" | "awaiting-verification";

export interface LocalAsset {
  id: string;
  blob: Blob;
  byteLength: number;
  mimeType: string;
  createdAt: number;
  state: LocalAssetState;
}

export interface LocalAssetIntegrityReport {
  valid: LocalAsset[];
  corrupt: Array<{ asset: LocalAsset; reason: string }>;
  missing: string[];
  orphans: LocalAsset[];
  totalBytes: number;
}

interface StoredLocalAssetMetadata {
  version: 1;
  id: string;
  byteLength: number;
  mimeType: string;
  createdAt: number;
  state: LocalAssetState;
}

const SHA256 = /^[0-9a-f]{64}$/;
const STATES = new Set<LocalAssetState>(["local", "publishing", "awaiting-verification"]);
const STRING_CHUNK_SIZE = 0x8000;
const STORAGE_RECORD_OVERHEAD_BYTES = 1024;

function localAssetMetadataKey(id: string): string { return `${LOCAL_ASSET_METADATA_PREFIX}${id}`; }
export function localAssetDataKey(id: string): string { return `${LOCAL_ASSET_DATA_PREFIX}${id}`; }

function defaultStorage(): Storage {
  try {
    if (!globalThis.localStorage) throw new Error("localStorage недоступен");
    return globalThis.localStorage;
  } catch (reason) {
    throw reason instanceof Error ? reason : new Error("localStorage недоступен");
  }
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

/** Packs 15 bits per UTF-16 code unit and stays below the surrogate range. */
function bytesToStorageString(bytes: Uint8Array): string {
  let value = "";
  let codeUnits: number[] = [];
  let buffer = 0;
  let bitCount = 0;
  const flush = () => {
    if (!codeUnits.length) return;
    value += String.fromCharCode(...codeUnits);
    codeUnits = [];
  };
  for (const byte of bytes) {
    buffer = buffer << 8 | byte;
    bitCount += 8;
    while (bitCount >= 15) {
      bitCount -= 15;
      codeUnits.push(buffer >>> bitCount & 0x7fff);
      buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
      if (codeUnits.length === STRING_CHUNK_SIZE) flush();
    }
  }
  if (bitCount > 0) codeUnits.push(buffer << 15 - bitCount & 0x7fff);
  flush();
  return value;
}

function invalidStoredBytes(valueLength: number, expectedByteLength: number): Uint8Array {
  return new Uint8Array(valueLength === expectedByteLength ? valueLength + 1 : valueLength);
}

function storageStringToBytes(value: string, expectedByteLength: number): Uint8Array {
  const expectedCodeUnits = Math.ceil(expectedByteLength * 8 / 15);
  if (!Number.isSafeInteger(expectedCodeUnits) || value.length !== expectedCodeUnits) return invalidStoredBytes(value.length, expectedByteLength);
  const bytes = new Uint8Array(expectedByteLength);
  let offset = 0;
  let buffer = 0;
  let bitCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit > 0x7fff) return invalidStoredBytes(value.length, expectedByteLength);
    buffer = buffer << 15 | codeUnit;
    bitCount += 15;
    while (bitCount >= 8 && offset < bytes.length) {
      bitCount -= 8;
      bytes[offset] = buffer >>> bitCount & 0xff;
      offset += 1;
      buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
    }
  }
  const expectedPaddingBits = value.length * 15 - expectedByteLength * 8;
  if (offset !== expectedByteLength || bitCount !== expectedPaddingBits || buffer !== 0) return invalidStoredBytes(value.length, expectedByteLength);
  return bytes;
}

function metadataFor(asset: LocalAsset): StoredLocalAssetMetadata {
  return { version: 1, id: asset.id, byteLength: asset.byteLength, mimeType: asset.mimeType, createdAt: asset.createdAt, state: asset.state };
}

function parseMetadata(raw: string, expectedId: string): StoredLocalAssetMetadata | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const metadata = value as Partial<StoredLocalAssetMetadata>;
    if (metadata.version !== 1 || metadata.id !== expectedId || !SHA256.test(metadata.id)) return null;
    if (!Number.isSafeInteger(metadata.byteLength) || (metadata.byteLength ?? -1) < 0) return null;
    if (typeof metadata.mimeType !== "string" || !metadata.mimeType.trim()) return null;
    if (typeof metadata.createdAt !== "number" || !Number.isFinite(metadata.createdAt)) return null;
    if (!metadata.state || !STATES.has(metadata.state)) return null;
    return metadata as StoredLocalAssetMetadata;
  } catch {
    return null;
  }
}

function storedAssetIds(storage: Pick<Storage, "length" | "key">): string[] {
  const ids = new Set<string>();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const prefix = key.startsWith(LOCAL_ASSET_METADATA_PREFIX)
      ? LOCAL_ASSET_METADATA_PREFIX
      : key.startsWith(LOCAL_ASSET_DATA_PREFIX)
        ? LOCAL_ASSET_DATA_PREFIX
        : null;
    if (!prefix) continue;
    const id = key.slice(prefix.length);
    if (SHA256.test(id)) ids.add(id);
  }
  return [...ids].sort();
}

function readStoredAsset(id: string, storage: Pick<Storage, "getItem">): LocalAsset | null {
  if (!SHA256.test(id)) return null;
  const metadataRaw = storage.getItem(localAssetMetadataKey(id));
  const data = storage.getItem(localAssetDataKey(id));
  if (metadataRaw === null || data === null) return null;
  const metadata = parseMetadata(metadataRaw, id);
  if (!metadata) return null;
  const bytes = storageStringToBytes(data, metadata.byteLength);
  return { ...metadata, blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: metadata.mimeType }) };
}

function restore(storage: Pick<Storage, "removeItem" | "setItem">, entries: Map<string, string | null>): void {
  for (const [key, value] of entries) {
    try {
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    } catch { /* Keep the original storage failure. */ }
  }
}

function projectedAssetWriteBytes(storage: Pick<Storage, "length" | "key" | "getItem">, records: Array<{ id: string; metadata: string; data: string }>): { current: number; projected: number } {
  const current = webkitStorageBytes(storage);
  let projected = current;
  for (const record of records) {
    const metadataKey = localAssetMetadataKey(record.id);
    const dataKey = localAssetDataKey(record.id);
    const previousMetadata = storage.getItem(metadataKey);
    const previousData = storage.getItem(dataKey);
    if (previousMetadata !== null) projected -= webkitStringBytes(metadataKey, previousMetadata);
    if (previousData !== null) projected -= webkitStringBytes(dataKey, previousData);
    projected += webkitStringBytes(metadataKey, record.metadata) + webkitStringBytes(dataKey, record.data);
  }
  return { current, projected };
}

export function estimatedLocalAssetStorageIncrease(byteLength: number): number {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(byteLength * 8 / 15) * 2 + STORAGE_RECORD_OVERHEAD_BYTES;
}

export function localAssetWritePreflight(storage: Pick<Storage, "length" | "key" | "getItem">, byteLength: number): string | null {
  const current = webkitStorageBytes(storage);
  const projected = current + estimatedLocalAssetStorageIncrease(byteLength);
  return storageIncreaseAllowed(current, projected)
    ? null
    : `Файл не помещается в localStorage Safari: безопасный бюджет ${Math.round(SAFARI_SAFE_BUDGET_BYTES / 1024 / 1024)} МиБ заполнен на ${Math.round(STORAGE_BLOCK_RATIO * 100)}%`;
}

export function isQuotaExceededError(reason: unknown): boolean {
  if (reason instanceof DOMException && (reason.name === "QuotaExceededError" || reason.name === "NS_ERROR_DOM_QUOTA_REACHED" || reason.code === 22 || reason.code === 1014)) return true;
  if (reason instanceof Error && reason.cause && reason.cause !== reason) return isQuotaExceededError(reason.cause);
  return false;
}

export function makeLocalAsset(id: string, blob: Blob, mimeType: string, state: LocalAssetState = "local", createdAt = Date.now()): LocalAsset {
  if (!SHA256.test(id)) throw new Error("Некорректный assetId");
  return { id, blob, byteLength: blob.size, mimeType: mimeType.trim() || blob.type || "application/octet-stream", createdAt, state };
}

export async function assertLocalAssetContent(asset: LocalAsset): Promise<void> {
  if (!SHA256.test(asset.id)) throw new Error("Некорректный assetId");
  if (!asset.blob || typeof asset.blob.size !== "number" || typeof asset.blob.slice !== "function") throw new Error("Локальный asset не содержит Blob");
  if (asset.byteLength !== asset.blob.size) throw new Error("Размер локального asset не совпадает с Blob");
  if (sha256Bytes(await blobBytes(asset.blob)) !== asset.id) throw new Error("SHA-256 локального asset не совпадает с assetId");
}

export async function writeLocalAssetsAtomic(assets: LocalAsset[], storage: Storage = defaultStorage()): Promise<LocalAsset[]> {
  if (!assets.length) return [];
  const unique = new Map<string, LocalAsset>();
  for (const asset of assets) {
    await assertLocalAssetContent(asset);
    const previous = unique.get(asset.id);
    if (previous && (previous.byteLength !== asset.byteLength || previous.mimeType !== asset.mimeType)) throw new Error("Один assetId связан с разными файлами");
    unique.set(asset.id, asset);
  }
  const records = await Promise.all([...unique.values()].map(async (asset) => ({
    id: asset.id,
    metadata: JSON.stringify(metadataFor(asset)),
    data: bytesToStorageString(await blobBytes(asset.blob)),
  })));
  const usage = projectedAssetWriteBytes(storage, records);
  if (!storageIncreaseAllowed(usage.current, usage.projected)) throw new DOMException("Недостаточно места для локальных вложений", "QuotaExceededError");
  const previous = new Map<string, string | null>();
  for (const record of records) {
    previous.set(localAssetDataKey(record.id), storage.getItem(localAssetDataKey(record.id)));
    previous.set(localAssetMetadataKey(record.id), storage.getItem(localAssetMetadataKey(record.id)));
  }
  try {
    for (const record of records) {
      storage.setItem(localAssetDataKey(record.id), record.data);
      storage.setItem(localAssetMetadataKey(record.id), record.metadata);
    }
    const stored = await readLocalAssets([...unique.keys()], storage);
    for (const asset of stored) await assertLocalAssetContent(asset);
    if (stored.length !== unique.size) throw new Error("localStorage не вернул все записанные assets");
    return stored;
  } catch (reason) {
    restore(storage, previous);
    if (isQuotaExceededError(reason)) throw new DOMException("Недостаточно места для локальных вложений", "QuotaExceededError");
    throw reason;
  }
}

export async function readLocalAsset(id: string, storage: Storage = defaultStorage()): Promise<LocalAsset | null> {
  return readStoredAsset(id, storage);
}

export async function readLocalAssets(ids: string[], storage: Storage = defaultStorage()): Promise<LocalAsset[]> {
  return ids.map((id) => readStoredAsset(id, storage)).filter((asset): asset is LocalAsset => asset !== null);
}

export async function listLocalAssets(storage: Storage = defaultStorage()): Promise<LocalAsset[]> {
  return storedAssetIds(storage)
    .map((id) => readStoredAsset(id, storage))
    .filter((asset): asset is LocalAsset => asset !== null)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export async function updateLocalAssetState(ids: string[], state: LocalAssetState, storage: Storage = defaultStorage()): Promise<void> {
  if (!ids.length) return;
  const previous = new Map<string, string | null>();
  try {
    for (const id of ids) {
      const key = localAssetMetadataKey(id);
      const raw = storage.getItem(key);
      previous.set(key, raw);
      if (raw === null) continue;
      const metadata = parseMetadata(raw, id);
      if (metadata) storage.setItem(key, JSON.stringify({ ...metadata, state }));
    }
  } catch (reason) {
    restore(storage, previous);
    throw reason;
  }
}

export async function deleteLocalAssetsAtomic(ids: string[], storage: Storage = defaultStorage()): Promise<void> {
  if (!ids.length) return;
  const previous = new Map<string, string | null>();
  for (const id of ids) {
    previous.set(localAssetMetadataKey(id), storage.getItem(localAssetMetadataKey(id)));
    previous.set(localAssetDataKey(id), storage.getItem(localAssetDataKey(id)));
  }
  try {
    for (const id of ids) {
      storage.removeItem(localAssetMetadataKey(id));
      storage.removeItem(localAssetDataKey(id));
    }
  } catch (reason) {
    restore(storage, previous);
    throw reason;
  }
}

export async function inspectLocalAssetIntegrity(referencedIds: Iterable<string>, storage: Storage = defaultStorage()): Promise<LocalAssetIntegrityReport> {
  const referenced = new Set(referencedIds);
  const assets = await listLocalAssets(storage);
  const valid: LocalAsset[] = [];
  const corrupt: Array<{ asset: LocalAsset; reason: string }> = [];
  for (const asset of assets) {
    try { await assertLocalAssetContent(asset); valid.push(asset); }
    catch (reason) { corrupt.push({ asset, reason: reason instanceof Error ? reason.message : String(reason) }); }
  }
  const present = new Set(assets.map((asset) => asset.id));
  return {
    valid,
    corrupt,
    missing: [...referenced].filter((id) => !present.has(id)),
    orphans: valid.filter((asset) => !referenced.has(asset.id)),
    totalBytes: valid.reduce((total, asset) => total + asset.byteLength, 0),
  };
}

export async function deleteSafeOrphans(referencedIds: Iterable<string>, olderThan: number, storage: Storage = defaultStorage()): Promise<string[]> {
  const referenced = new Set(referencedIds);
  const assets = await listLocalAssets(storage);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const orphans = storedAssetIds(storage).filter((id) => {
    if (referenced.has(id)) return false;
    const asset = byId.get(id);
    return !asset || asset.createdAt <= olderThan;
  });
  await deleteLocalAssetsAtomic(orphans, storage);
  return orphans;
}
