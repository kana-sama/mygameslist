import type { PatchEnvelope } from "./types";
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

export function loadPatch(storage: Pick<Storage, "getItem">, key = PATCH_STORAGE_KEY): PatchLoadResult {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch (error) { return { patch: null, raw: null, error: error instanceof Error ? error : new Error(String(error)) }; }
  if (raw === null) return { patch: null, raw, error: null };
  try {
    const parsed: unknown = JSON.parse(raw); const result = validatePatch(parsed);
    if (!result.ok || !result.value) return { patch: null, raw, error: new Error(result.issues.map((item) => `${item.path}: ${item.message}`).join("\n")) };
    return { patch: result.value, raw, error: null };
  } catch (error) { return { patch: null, raw, error: error instanceof Error ? error : new Error(String(error)) }; }
}

export interface PatchWriteResult { ok: boolean; usage: StorageUsage; error?: Error; blocked?: boolean }

/** Keeps the previous valid value on all quota/access failures. */
export function savePatch(storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">, patch: PatchEnvelope, key = PATCH_STORAGE_KEY): PatchWriteResult {
  try {
    const result = validatePatch(patch);
    if (!result.ok) return { ok: false, usage: classifyStorageUsage(webkitStorageBytes(storage)), error: new Error("Патч не прошёл проверку") };
    const raw = JSON.stringify(patch);
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
