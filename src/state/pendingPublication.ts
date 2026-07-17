import {
  PATCH_STORAGE_KEY,
  SAFARI_SAFE_BUDGET_BYTES,
  STORAGE_BLOCK_RATIO,
  assertValidPatch,
  assertValidPublishedLibrary,
  base64ToBytes,
  isCanonicalBase64,
  sha256Bytes,
  webkitStorageBytes,
  webkitStringBytes,
  type LibraryDatabase,
  type PatchEnvelope,
} from "../domain";

export const PENDING_PUBLICATION_STORAGE_KEY = "my-game-library.pending-publication.v1";

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface PendingPublicationReceipt {
  version: 1;
  owner: string;
  repo: string;
  branch: string;
  sourceRevision: string;
  commitSha: string;
  createdAt: string;
  database: LibraryDatabase;
  blobs: Record<string, string>;
}

export interface PendingPublicationLoadResult {
  receipt: PendingPublicationReceipt | null;
  raw: string | null;
  error: Error | null;
}

type PublicationStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function assertValidPendingPublication(value: unknown): asserts value is PendingPublicationReceipt {
  if (!isObject(value) || !exactKeys(value, ["version", "owner", "repo", "branch", "sourceRevision", "commitSha", "createdAt", "database", "blobs"])) {
    throw new Error("Некорректная запись ожидающей публикации");
  }
  if (value.version !== 1) throw new Error("Неподдерживаемая версия ожидающей публикации");
  if (typeof value.owner !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value.owner)) throw new Error("Некорректный владелец репозитория");
  if (typeof value.repo !== "string" || !/^[A-Za-z0-9._-]+$/.test(value.repo)) throw new Error("Некорректный репозиторий");
  if (typeof value.branch !== "string" || !/^[A-Za-z0-9._/-]+$/.test(value.branch)) throw new Error("Некорректная ветка");
  if (typeof value.sourceRevision !== "string" || value.sourceRevision !== "" && !SHA256.test(value.sourceRevision)) throw new Error("Некорректная исходная revision");
  if (typeof value.commitSha !== "string" || !GIT_OBJECT_SHA.test(value.commitSha)) throw new Error("Некорректный SHA коммита");
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) throw new Error("Некорректная дата публикации");
  assertValidPublishedLibrary(value.database);
  if (value.database.publicationId === null) throw new Error("У ожидающей публикации отсутствует publicationId");
  if (!isObject(value.blobs)) throw new Error("Некорректный кеш файлов публикации");
  for (const [id, encoded] of Object.entries(value.blobs)) {
    if (!SHA256.test(id) || typeof encoded !== "string" || !isCanonicalBase64(encoded)) throw new Error("Некорректный файл ожидающей публикации");
    const bytes = base64ToBytes(encoded);
    const asset = value.database.assets[id];
    if (!asset || sha256Bytes(bytes) !== id || asset.byteLength !== bytes.byteLength) throw new Error("Файл ожидающей публикации не совпадает с базой");
  }
}

export function loadPendingPublication(storage: Pick<Storage, "getItem">): PendingPublicationLoadResult {
  let raw: string | null;
  try { raw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY); }
  catch { return { receipt: null, raw: null, error: new Error("Safari не разрешил прочитать ожидающую публикацию") }; }
  if (raw === null) return { receipt: null, raw, error: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    assertValidPendingPublication(parsed);
    return { receipt: parsed, raw, error: null };
  } catch {
    return { receipt: null, raw, error: new Error("Ожидающая публикация повреждена") };
  }
}

function restore(storage: PublicationStorage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Best effort. The caller receives a sanitized storage error.
  }
}

/**
 * Replaces the published part of a patch and its temporary media cache as one
 * best-effort Web Storage transaction. The old valid values are restored when
 * Safari rejects either write.
 */
export function installPendingPublication(
  storage: PublicationStorage,
  receipt: PendingPublicationReceipt,
  remainingPatch: PatchEnvelope,
): { ok: true } | { ok: false; error: Error } {
  try {
    assertValidPendingPublication(receipt);
    assertValidPatch(remainingPatch);
  } catch {
    return { ok: false, error: new Error("Нельзя сохранить некорректное состояние синхронизации") };
  }

  let previousPatch: string | null;
  let previousPending: string | null;
  try {
    previousPatch = storage.getItem(PATCH_STORAGE_KEY);
    previousPending = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
  } catch {
    return { ok: false, error: new Error("Safari не разрешил доступ к localStorage") };
  }

  const pendingRaw = JSON.stringify(receipt);
  const patchIsEmpty = Object.keys(remainingPatch.operations).length === 0 && Object.keys(remainingPatch.blobs).length === 0;
  const patchRaw = patchIsEmpty ? null : JSON.stringify(remainingPatch);
  try {
    const currentBytes = webkitStorageBytes(storage);
    const previousBytes = (previousPatch === null ? 0 : webkitStringBytes(PATCH_STORAGE_KEY, previousPatch))
      + (previousPending === null ? 0 : webkitStringBytes(PENDING_PUBLICATION_STORAGE_KEY, previousPending));
    const nextBytes = currentBytes - previousBytes
      + webkitStringBytes(PENDING_PUBLICATION_STORAGE_KEY, pendingRaw)
      + (patchRaw === null ? 0 : webkitStringBytes(PATCH_STORAGE_KEY, patchRaw));
    if (nextBytes > currentBytes && nextBytes >= SAFARI_SAFE_BUDGET_BYTES * STORAGE_BLOCK_RATIO) {
      return { ok: false, error: new Error("Ожидающая публикация не помещается в безопасный бюджет Safari") };
    }

    storage.removeItem(PATCH_STORAGE_KEY);
    storage.removeItem(PENDING_PUBLICATION_STORAGE_KEY);
    storage.setItem(PENDING_PUBLICATION_STORAGE_KEY, pendingRaw);
    if (patchRaw !== null) storage.setItem(PATCH_STORAGE_KEY, patchRaw);
    return { ok: true };
  } catch {
    restore(storage, PENDING_PUBLICATION_STORAGE_KEY, previousPending);
    restore(storage, PATCH_STORAGE_KEY, previousPatch);
    return { ok: false, error: new Error("Safari не сохранил состояние после синхронизации") };
  }
}

export function clearPendingPublication(storage: Pick<Storage, "removeItem">): boolean {
  try { storage.removeItem(PENDING_PUBLICATION_STORAGE_KEY); return true; }
  catch { return false; }
}
