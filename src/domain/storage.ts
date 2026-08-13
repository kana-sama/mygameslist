import { externalizeWebPAsset } from "./assets";
import { LIBRARY_SCHEMA_VERSION, type LegacyImageAsset, type PatchEnvelope } from "./types";
import { validatePatch } from "./validation";

export const PATCH_STORAGE_KEY = "my-game-library.patch.v1";
export const SAFARI_SAFE_BUDGET_BYTES = 4 * 1024 * 1024;
export const STORAGE_WARNING_RATIO = 0.7;
export const STORAGE_CRITICAL_RATIO = 0.85;
export const STORAGE_BLOCK_RATIO = 0.95;

export type StorageLevel = "ok" | "warning" | "critical" | "blocked";
export interface StorageUsage { bytes: number; budget: number; ratio: number; level: StorageLevel; remainingBytes: number }

/** WebKit Web Storage strings are accounted as UTF-16 (two bytes per code unit). */
export function webkitStringBytes(key: string, value: string): number { return 2 * (key.length + value.length); }

export function webkitStorageBytes(storage: Pick<Storage, "length" | "key" | "getItem">): number {
  let bytes = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index); if (key === null) continue;
    bytes += webkitStringBytes(key, storage.getItem(key) ?? "");
  }
  return bytes;
}

export function classifyStorageUsage(bytes: number, budget = SAFARI_SAFE_BUDGET_BYTES): StorageUsage {
  const ratio = budget <= 0 ? 1 : bytes / budget;
  const level: StorageLevel = ratio >= STORAGE_BLOCK_RATIO ? "blocked" : ratio >= STORAGE_CRITICAL_RATIO ? "critical" : ratio >= STORAGE_WARNING_RATIO ? "warning" : "ok";
  return { bytes, budget, ratio, level, remainingBytes: Math.max(0, budget - bytes) };
}

export function projectedStorageUsage(storage: Pick<Storage, "length" | "key" | "getItem">, key: string, nextValue: string): StorageUsage {
  const oldValue = storage.getItem(key);
  const current = webkitStorageBytes(storage);
  const next = current - (oldValue === null ? 0 : webkitStringBytes(key, oldValue)) + webkitStringBytes(key, nextValue);
  return classifyStorageUsage(next);
}

export function storageIncreaseAllowed(currentBytes: number, projectedBytes: number, budget = SAFARI_SAFE_BUDGET_BYTES): boolean {
  return projectedBytes <= currentBytes || projectedBytes < budget * STORAGE_BLOCK_RATIO;
}

export function isStorageAccessError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.name === "SecurityError" || error.code === 22 || error.code === 1014;
}

export interface PatchLoadResult { patch: PatchEnvelope | null; raw: string | null; error: Error | null }

export function normalizePatchEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const patch = value as Record<string, unknown>;
  if (patch.patchVersion === 2) return value;
  if (patch.patchVersion !== 1 || !patch.operations || typeof patch.operations !== "object" || Array.isArray(patch.operations)) return value;
  const migratesSchemaV1 = patch.patchVersion === 1 && patch.schemaVersion === 1;
  if (!migratesSchemaV1 && patch.schemaVersion !== LIBRARY_SCHEMA_VERSION) return value;
  const blobs: Record<string, string> = {};
  const operations = Object.fromEntries(Object.entries(patch.operations as Record<string, unknown>).flatMap(([path, rawOperation]) => {
    if (migratesSchemaV1 && (path.startsWith("/collections/") || path.startsWith("/collectionItems/"))) return [];
    if (!/^\/assets\/[0-9a-f]{64}$/.test(path) || !rawOperation || typeof rawOperation !== "object" || Array.isArray(rawOperation)) return [[path, rawOperation]];
    const operation = rawOperation as Record<string, unknown>;
    const value = operation.value;
    if (operation.operation !== "set" || operation.baseExists !== false || !value || typeof value !== "object" || Array.isArray(value) || !("base64" in value)) return [[path, rawOperation]];
    const externalized = externalizeWebPAsset(value as unknown as LegacyImageAsset);
    blobs[externalized.asset.id] = externalized.base64;
    return [[path, { ...operation, value: externalized.asset }]];
  }));
  return { ...patch, patchVersion: 2, schemaVersion: migratesSchemaV1 ? LIBRARY_SCHEMA_VERSION : patch.schemaVersion, operations, blobs };
}

export function loadPatch(storage: Pick<Storage, "getItem">, key = PATCH_STORAGE_KEY): PatchLoadResult {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch (error) { return { patch: null, raw: null, error: error instanceof Error ? error : new Error(String(error)) }; }
  if (raw === null) return { patch: null, raw, error: null };
  try {
    const parsed = normalizePatchEnvelope(JSON.parse(raw)); const result = validatePatch(parsed);
    if (!result.ok || !result.value) return { patch: null, raw, error: new Error(result.issues.map((item) => `${item.path}: ${item.message}`).join("\n")) };
    return { patch: result.value, raw, error: null };
  } catch (error) { return { patch: null, raw, error: error instanceof Error ? error : new Error(String(error)) }; }
}

export interface PatchWriteResult { ok: boolean; usage: StorageUsage; error?: Error; blocked?: boolean }

export type ValidatedInteractionPatchWriteResult =
  | { status: "durable"; raw: string | null; usage: StorageUsage }
  | { status: "changed"; currentRaw: string | null; usage: StorageUsage }
  | { status: "failure"; error: Error; usage: StorageUsage; blocked?: boolean };

export function storedInteractionPatchRaw(patch: PatchEnvelope): string | null {
  if (Object.keys(patch.operations).length === 0) return null;
  return JSON.stringify({ ...patch, blobs: {} });
}

/**
 * Persists a patch produced by the targeted interaction transition. The caller
 * must supply the previously authoritative patch and the already-validated
 * next patch; untrusted/bootstrap paths must continue to use savePatch.
 */
export function saveValidatedInteractionPatch(
  storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">,
  previousPatch: PatchEnvelope,
  nextPatch: PatchEnvelope,
  key = PATCH_STORAGE_KEY,
): ValidatedInteractionPatchWriteResult {
  let usage = classifyStorageUsage(0);
  try {
    const expectedRaw = storedInteractionPatchRaw(previousPatch);
    const raw = storedInteractionPatchRaw(nextPatch);
    const currentRaw = storage.getItem(key);
    const currentBytes = webkitStorageBytes(storage);
    usage = classifyStorageUsage(currentBytes);
    if (currentRaw !== expectedRaw) return { status: "changed", currentRaw, usage };

    const previousBytes = currentRaw === null ? 0 : webkitStringBytes(key, currentRaw);
    const nextBytes = raw === null ? 0 : webkitStringBytes(key, raw);
    const projectedBytes = currentBytes - previousBytes + nextBytes;
    usage = classifyStorageUsage(projectedBytes);
    if (previousBytes > currentBytes || !storageIncreaseAllowed(currentBytes, projectedBytes)) {
      return { status: "failure", blocked: true, usage, error: new Error("Локальное хранилище Safari заполнено на 95%") };
    }

    const beforeWrite = storage.getItem(key);
    if (beforeWrite !== expectedRaw) return { status: "changed", currentRaw: beforeWrite, usage: classifyStorageUsage(currentBytes) };
    if (raw === null) storage.removeItem(key);
    else storage.setItem(key, raw);
    const readback = storage.getItem(key);
    if (readback !== raw) {
      return { status: "failure", usage, error: new Error("Safari не подтвердил точные bytes локального патча") };
    }
    return { status: "durable", raw, usage: classifyStorageUsage(webkitStorageBytes(storage)) };
  } catch (reason) {
    try { usage = classifyStorageUsage(webkitStorageBytes(storage)); } catch { /* Preserve the last computable usage. */ }
    return { status: "failure", usage, error: reason instanceof Error ? reason : new Error(String(reason)) };
  }
}

/** Keeps the previous valid value on all quota/access failures. */
export function savePatch(storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">, patch: PatchEnvelope, key = PATCH_STORAGE_KEY): PatchWriteResult {
  try {
    const result = validatePatch(patch);
    if (!result.ok) return { ok: false, usage: classifyStorageUsage(webkitStorageBytes(storage)), error: new Error("Патч не прошёл проверку") };
    const storedPatch: PatchEnvelope = { ...patch, blobs: {} };
    const raw = JSON.stringify(storedPatch);
    const currentBytes = webkitStorageBytes(storage); const usage = projectedStorageUsage(storage, key, raw);
    if (!storageIncreaseAllowed(currentBytes, usage.bytes)) return { ok: false, blocked: true, usage, error: new Error("Локальное хранилище Safari заполнено на 95%") };
    if (Object.keys(patch.operations).length === 0) storage.removeItem(key); else storage.setItem(key, raw);
    return { ok: true, usage: classifyStorageUsage(webkitStorageBytes(storage)) };
  } catch (error) {
    let usage: StorageUsage;
    try { usage = classifyStorageUsage(webkitStorageBytes(storage)); } catch { usage = classifyStorageUsage(0); }
    return { ok: false, usage, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try { return await navigator.storage?.persist?.() ?? false; } catch { return false; }
}
