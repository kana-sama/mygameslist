import { sha256Bytes } from "./canonical";

export const LOCAL_ASSET_DATABASE_NAME = "my-game-library.local-assets";
export const LOCAL_ASSET_DATABASE_VERSION = 1;
export const LOCAL_ASSET_STORE_NAME = "assets";

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

const SHA256 = /^[0-9a-f]{64}$/;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException("IndexedDB transaction aborted", "AbortError"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

export function isQuotaExceededError(reason: unknown): boolean {
  if (reason instanceof DOMException && (reason.name === "QuotaExceededError" || reason.name === "NS_ERROR_DOM_QUOTA_REACHED" || reason.code === 22 || reason.code === 1014)) return true;
  if (reason instanceof Error && reason.cause && reason.cause !== reason) return isQuotaExceededError(reason.cause);
  return false;
}

export function openLocalAssetDatabase(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error("IndexedDB недоступен"));
  return new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_ASSET_DATABASE_NAME, LOCAL_ASSET_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LOCAL_ASSET_STORE_NAME)) database.createObjectStore(LOCAL_ASSET_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть IndexedDB"));
    request.onblocked = () => reject(new Error("Обновление IndexedDB заблокировано другой вкладкой"));
  });
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

export async function writeLocalAssetsAtomic(assets: LocalAsset[], database?: IDBDatabase): Promise<LocalAsset[]> {
  if (!assets.length) return [];
  const unique = new Map<string, LocalAsset>();
  for (const asset of assets) {
    await assertLocalAssetContent(asset);
    const previous = unique.get(asset.id);
    if (previous && (previous.byteLength !== asset.byteLength || previous.mimeType !== asset.mimeType)) throw new Error("Один assetId связан с разными файлами");
    unique.set(asset.id, asset);
  }
  const ownedDatabase = database === undefined;
  const db = database ?? await openLocalAssetDatabase();
  try {
    const transaction = db.transaction(LOCAL_ASSET_STORE_NAME, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(LOCAL_ASSET_STORE_NAME);
    try {
      for (const asset of unique.values()) store.put(asset);
    } catch (reason) {
      transaction.abort();
      await transactionDone(transaction).catch(() => undefined);
      throw reason;
    }
    await transactionDone(transaction);
    const stored = await readLocalAssets([...unique.keys()], db);
    for (const asset of stored) await assertLocalAssetContent(asset);
    if (stored.length !== unique.size) throw new Error("IndexedDB не вернул все записанные assets");
    return stored;
  } catch (reason) {
    if (isQuotaExceededError(reason)) throw new DOMException("Недостаточно места для локальных вложений", "QuotaExceededError");
    throw reason;
  } finally {
    if (ownedDatabase) db.close();
  }
}

export async function readLocalAsset(id: string, database?: IDBDatabase): Promise<LocalAsset | null> {
  const ownedDatabase = database === undefined;
  const db = database ?? await openLocalAssetDatabase();
  try {
    const transaction = db.transaction(LOCAL_ASSET_STORE_NAME, "readonly");
    const result = await requestResult(transaction.objectStore(LOCAL_ASSET_STORE_NAME).get(id) as IDBRequest<LocalAsset | undefined>);
    await transactionDone(transaction);
    return result ?? null;
  } finally {
    if (ownedDatabase) db.close();
  }
}

export async function readLocalAssets(ids: string[], database?: IDBDatabase): Promise<LocalAsset[]> {
  if (!ids.length) return [];
  const ownedDatabase = database === undefined;
  const db = database ?? await openLocalAssetDatabase();
  try {
    const transaction = db.transaction(LOCAL_ASSET_STORE_NAME, "readonly");
    const store = transaction.objectStore(LOCAL_ASSET_STORE_NAME);
    const results = await Promise.all(ids.map((id) => requestResult(store.get(id) as IDBRequest<LocalAsset | undefined>)));
    await transactionDone(transaction);
    return results.filter((asset): asset is LocalAsset => asset !== undefined);
  } finally {
    if (ownedDatabase) db.close();
  }
}

export async function listLocalAssets(database?: IDBDatabase): Promise<LocalAsset[]> {
  const ownedDatabase = database === undefined;
  const db = database ?? await openLocalAssetDatabase();
  try {
    const transaction = db.transaction(LOCAL_ASSET_STORE_NAME, "readonly");
    const result = await requestResult(transaction.objectStore(LOCAL_ASSET_STORE_NAME).getAll() as IDBRequest<LocalAsset[]>);
    await transactionDone(transaction);
    return result.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  } finally {
    if (ownedDatabase) db.close();
  }
}

export async function updateLocalAssetState(ids: string[], state: LocalAssetState, database?: IDBDatabase): Promise<void> {
  if (!ids.length) return;
  const ownedDatabase = database === undefined;
  const db = database ?? await openLocalAssetDatabase();
  try {
    const transaction = db.transaction(LOCAL_ASSET_STORE_NAME, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(LOCAL_ASSET_STORE_NAME);
    for (const id of ids) {
      const asset = await requestResult(store.get(id) as IDBRequest<LocalAsset | undefined>);
      if (asset) store.put({ ...asset, state });
    }
    await transactionDone(transaction);
  } finally {
    if (ownedDatabase) db.close();
  }
}

export async function deleteLocalAssetsAtomic(ids: string[], database?: IDBDatabase): Promise<void> {
  if (!ids.length) return;
  const ownedDatabase = database === undefined;
  const db = database ?? await openLocalAssetDatabase();
  try {
    const transaction = db.transaction(LOCAL_ASSET_STORE_NAME, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(LOCAL_ASSET_STORE_NAME);
    ids.forEach((id) => store.delete(id));
    await transactionDone(transaction);
  } finally {
    if (ownedDatabase) db.close();
  }
}

export async function inspectLocalAssetIntegrity(referencedIds: Iterable<string>, database?: IDBDatabase): Promise<LocalAssetIntegrityReport> {
  const referenced = new Set(referencedIds);
  const assets = await listLocalAssets(database);
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

export async function deleteSafeOrphans(referencedIds: Iterable<string>, olderThan: number, database?: IDBDatabase): Promise<string[]> {
  const referenced = new Set(referencedIds);
  const orphans = (await listLocalAssets(database)).filter((asset) => !referenced.has(asset.id) && asset.createdAt <= olderThan && asset.state === "local");
  await deleteLocalAssetsAtomic(orphans.map((asset) => asset.id), database);
  return orphans.map((asset) => asset.id);
}
