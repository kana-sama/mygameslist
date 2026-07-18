export const ORIGIN_STORAGE_WARNING_RATIO = 0.7;
export const ORIGIN_STORAGE_CRITICAL_RATIO = 0.85;
export const ORIGIN_STORAGE_BLOCK_RATIO = 0.9;
export const STORAGE_SAFETY_RESERVE_BYTES = 100 * 1024 * 1024;
export const LOCAL_ASSET_WARNING_BYTES = 100 * 1024 * 1024;
export const LOCAL_ASSET_CRITICAL_BYTES = 250 * 1024 * 1024;
export const LOCAL_ASSET_AGE_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export type QuotaLevel = "unknown" | "ok" | "warning" | "critical" | "blocked";

export interface OriginStorageStatus {
  usage: number | null;
  quota: number | null;
  remaining: number | null;
  ratio: number | null;
  level: QuotaLevel;
}

export function classifyOriginStorage(usage: number | undefined, quota: number | undefined): OriginStorageStatus {
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || (quota ?? 0) <= 0) return { usage: null, quota: null, remaining: null, ratio: null, level: "unknown" };
  const normalizedUsage = Math.max(0, usage ?? 0);
  const normalizedQuota = Math.max(0, quota ?? 0);
  const ratio = normalizedUsage / normalizedQuota;
  const level: QuotaLevel = ratio >= ORIGIN_STORAGE_BLOCK_RATIO ? "blocked" : ratio >= ORIGIN_STORAGE_CRITICAL_RATIO ? "critical" : ratio >= ORIGIN_STORAGE_WARNING_RATIO ? "warning" : "ok";
  return { usage: normalizedUsage, quota: normalizedQuota, remaining: Math.max(0, normalizedQuota - normalizedUsage), ratio, level };
}

export function attachmentPreflight(status: OriginStorageStatus, incomingBytes: number): { allowed: boolean; requiredBytes: number; reason: string | null } {
  const requiredBytes = Math.max(0, incomingBytes) * 2 + STORAGE_SAFETY_RESERVE_BYTES;
  if (status.level === "blocked") return { allowed: false, requiredBytes, reason: "Хранилище браузера заполнено более чем на 90%. Новые вложения заблокированы." };
  if (status.remaining === null) return { allowed: true, requiredBytes, reason: null };
  if (status.remaining < requiredBytes) return { allowed: false, requiredBytes, reason: "Недостаточно безопасного запаса хранилища для новых вложений." };
  return { allowed: true, requiredBytes, reason: null };
}

export async function estimateOriginStorage(manager: StorageManager | undefined = navigator.storage): Promise<OriginStorageStatus> {
  try {
    const estimate = await manager?.estimate?.();
    return classifyOriginStorage(estimate?.usage, estimate?.quota);
  } catch {
    return classifyOriginStorage(undefined, undefined);
  }
}

export async function storageIsPersisted(manager: StorageManager | undefined = navigator.storage): Promise<boolean> {
  try { return await manager?.persisted?.() ?? false; }
  catch { return false; }
}

export async function requestPersistentOriginStorage(manager: StorageManager | undefined = navigator.storage): Promise<boolean> {
  try { return await manager?.persist?.() ?? false; }
  catch { return false; }
}
