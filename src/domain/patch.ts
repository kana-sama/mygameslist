import { canonicalHash, canonicalStringify, MISSING_VALUE_HASH, withComputedRevision } from "./canonical";
import type { LibraryDatabase, PatchConflict, PatchEnvelope, PatchOperation, ReconciledPatch } from "./types";
import { assertValidLibrary, assertValidPatch, LOCALLY_PATCHABLE_FIELDS, parsePatchPath, type EntityMapName } from "./validation";

type Entity = LibraryDatabase[EntityMapName][string];

export interface DiffOptions {
  changedAt?: string;
  transactionId?: string;
  previousPatch?: PatchEnvelope;
}

export interface ApplyPatchOptions {
  checkBaseRevision?: boolean;
  checkBaseHashes?: boolean;
  validateResult?: boolean;
}

function clone<T>(value: T): T { return structuredClone(value); }
function hasOwn(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
function same(a: unknown, b: unknown): boolean { return canonicalStringify(a) === canonicalStringify(b); }
function pointerToken(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }
export function entityPath(map: EntityMapName, id: string, field?: string): string {
  return `/${map}/${pointerToken(id)}${field === undefined ? "" : `/${pointerToken(field)}`}`;
}

export function readPatchPath(database: LibraryDatabase, path: string): { exists: boolean; value?: unknown } {
  const parsed = parsePatchPath(path);
  if (!parsed) throw new Error(`Недопустимый путь патча: ${path}`);
  const map = database[parsed.map] as Record<string, unknown>;
  if (!hasOwn(map, parsed.id)) return { exists: false };
  const entity = map[parsed.id] as Record<string, unknown>;
  if (parsed.field === undefined) return { exists: true, value: entity };
  return hasOwn(entity, parsed.field) ? { exists: true, value: entity[parsed.field] } : { exists: false };
}

function opTargetMatches(operation: PatchOperation, actual: { exists: boolean; value?: unknown }): boolean {
  return operation.operation === "delete" ? !actual.exists : actual.exists && same(actual.value, operation.value);
}

function baseMatches(operation: PatchOperation, actual: { exists: boolean; value?: unknown }): boolean {
  if (operation.baseExists !== actual.exists) return false;
  return !actual.exists ? operation.baseHash === MISSING_VALUE_HASH : canonicalHash(actual.value) === operation.baseHash;
}

function freshOperation(base: { exists: boolean; value?: unknown }, operation: "set" | "delete", value: unknown, changedAt: string, transactionId: string): PatchOperation {
  return {
    operation,
    ...(operation === "set" ? { value: clone(value) } : {}),
    baseExists: base.exists,
    baseHash: base.exists ? canonicalHash(base.value) : MISSING_VALUE_HASH,
    changedAt,
    transactionId,
  };
}

function retainTimestamp(candidate: PatchOperation, previous: PatchOperation | undefined): PatchOperation {
  if (!previous || previous.operation !== candidate.operation || previous.baseExists !== candidate.baseExists || previous.baseHash !== candidate.baseHash) return candidate;
  if (candidate.operation === "set" && !same(candidate.value, previous.value)) return candidate;
  return clone(previous);
}

/** Produces a sparse, stable-ID patch and drops derived updatedAt noise. */
export function diffLibrary(base: LibraryDatabase, current: LibraryDatabase, options: DiffOptions = {}): PatchEnvelope {
  assertValidLibrary(base); assertValidLibrary(current);
  const changedAt = options.changedAt ?? new Date().toISOString();
  const transactionId = options.transactionId ?? globalThis.crypto?.randomUUID?.() ?? `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const operations: Record<string, PatchOperation> = {};
  const maps: EntityMapName[] = ["games", "notes", "collections", "collectionItems", "assets"];
  for (const mapName of maps) {
    const baseMap = base[mapName] as Record<string, Entity>;
    const currentMap = current[mapName] as Record<string, Entity>;
    for (const id of new Set([...Object.keys(baseMap), ...Object.keys(currentMap)])) {
      const rootPath = entityPath(mapName, id);
      if (!(id in currentMap)) {
        const candidate = freshOperation({ exists: true, value: baseMap[id] }, "delete", undefined, changedAt, transactionId);
        operations[rootPath] = retainTimestamp(candidate, options.previousPatch?.operations[rootPath]);
      } else if (!(id in baseMap)) {
        const candidate = freshOperation({ exists: false }, "set", currentMap[id], changedAt, transactionId);
        operations[rootPath] = retainTimestamp(candidate, options.previousPatch?.operations[rootPath]);
      } else if (mapName === "assets") {
        if (!same(baseMap[id], currentMap[id])) {
          const candidate = freshOperation({ exists: true, value: baseMap[id] }, "set", currentMap[id], changedAt, transactionId);
          operations[rootPath] = retainTimestamp(candidate, options.previousPatch?.operations[rootPath]);
        }
      } else {
        for (const field of LOCALLY_PATCHABLE_FIELDS[mapName]) {
          const before = (baseMap[id] as unknown as Record<string, unknown>)[field];
          const after = (currentMap[id] as unknown as Record<string, unknown>)[field];
          if (same(before, after)) continue;
          const path = entityPath(mapName, id, field);
          const candidate = freshOperation({ exists: true, value: before }, "set", after, changedAt, transactionId);
          operations[path] = retainTimestamp(candidate, options.previousPatch?.operations[path]);
        }
      }
    }
  }
  return { patchVersion: 1, schemaVersion: 1, baseRevision: base.revision, operations };
}

function latest(current: string | undefined, candidate: string): string { return !current || candidate > current ? candidate : current; }

function mutateAtPath(database: LibraryDatabase, path: string, operation: PatchOperation): void {
  const parsed = parsePatchPath(path);
  if (!parsed) throw new Error(`Недопустимый путь патча: ${path}`);
  const map = database[parsed.map] as unknown as Record<string, unknown>;
  if (parsed.field === undefined) {
    if (operation.operation === "delete") delete map[parsed.id];
    else map[parsed.id] = clone(operation.value);
    return;
  }
  const entity = map[parsed.id];
  if (!entity || typeof entity !== "object") throw new Error(`Сущность для ${path} отсутствует`);
  if (operation.operation === "delete") delete (entity as Record<string, unknown>)[parsed.field];
  else (entity as Record<string, unknown>)[parsed.field] = clone(operation.value);
}

function applyUpdatedAt(database: LibraryDatabase, original: LibraryDatabase, operations: Record<string, PatchOperation>): void {
  const games: Record<string, string> = {}; const notes: Record<string, string> = {}; const collections: Record<string, string> = {};
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path); if (!parsed) continue;
    if (parsed.map === "games") games[parsed.id] = latest(games[parsed.id], operation.changedAt);
    if (parsed.map === "notes") {
      notes[parsed.id] = latest(notes[parsed.id], operation.changedAt);
      const note = database.notes[parsed.id] ?? original.notes[parsed.id];
      if (note) games[note.gameId] = latest(games[note.gameId], operation.changedAt);
    }
    if (parsed.map === "collections") collections[parsed.id] = latest(collections[parsed.id], operation.changedAt);
    if (parsed.map === "collectionItems") {
      const item = database.collectionItems[parsed.id] ?? original.collectionItems[parsed.id];
      if (item) {
        collections[item.collectionId] = latest(collections[item.collectionId], operation.changedAt);
        games[item.gameId] = latest(games[item.gameId], operation.changedAt);
      }
    }
  }
  for (const [id, changedAt] of Object.entries(games)) if (database.games[id]) database.games[id].updatedAt = changedAt;
  for (const [id, changedAt] of Object.entries(notes)) if (database.notes[id]) database.notes[id].updatedAt = changedAt;
  for (const [id, changedAt] of Object.entries(collections)) if (database.collections[id]) database.collections[id].updatedAt = changedAt;
}

export function applyPatch(base: LibraryDatabase, patch: PatchEnvelope, options: ApplyPatchOptions = {}): LibraryDatabase {
  assertValidLibrary(base); assertValidPatch(patch);
  if ((options.checkBaseRevision ?? true) && patch.baseRevision !== base.revision) throw new Error("Патч создан для другой revision базы");
  if (options.checkBaseHashes ?? true) for (const [path, operation] of Object.entries(patch.operations)) {
    if (!baseMatches(operation, readPatchPath(base, path))) throw new Error(`Base hash не совпадает: ${path}`);
  }
  const result = clone(base);
  for (const [path, operation] of Object.entries(patch.operations).sort(([a], [b]) => a.localeCompare(b))) mutateAtPath(result, path, operation);
  applyUpdatedAt(result, base, patch.operations);
  if (options.validateResult ?? true) assertValidLibrary(result);
  return result;
}

function applyBestEffort(base: LibraryDatabase, operations: Record<string, PatchOperation>): LibraryDatabase {
  const result = clone(base); const applied: Record<string, PatchOperation> = {};
  for (const [path, operation] of Object.entries(operations).sort(([a], [b]) => a.localeCompare(b))) {
    try { mutateAtPath(result, path, operation); applied[path] = operation; } catch { /* conflict remains visible, static value wins */ }
  }
  applyUpdatedAt(result, base, applied); return result;
}

/** Rebases clean operations, prunes already-published values, and reports same-field conflicts. */
export function reconcilePatch(staticDatabase: LibraryDatabase, incoming: PatchEnvelope): ReconciledPatch {
  assertValidLibrary(staticDatabase); assertValidPatch(incoming);
  const operations: Record<string, PatchOperation> = {}; const applicable: Record<string, PatchOperation> = {}; const conflicts: PatchConflict[] = []; let prunedCount = 0;
  for (const [path, operation] of Object.entries(incoming.operations)) {
    const actual = readPatchPath(staticDatabase, path);
    if (opTargetMatches(operation, actual)) { prunedCount += 1; continue; }
    operations[path] = clone(operation);
    if (!baseMatches(operation, actual)) conflicts.push({ path, operation: clone(operation), staticValue: clone(actual.value), staticExists: actual.exists });
    else applicable[path] = clone(operation);
  }
  const patch: PatchEnvelope = { ...clone(incoming), baseRevision: staticDatabase.revision, operations };
  return { patch, effective: applyBestEffort(staticDatabase, applicable), conflicts, prunedCount };
}

export type ConflictResolution = { choice: "static" } | { choice: "local" } | { choice: "manual"; value?: unknown; delete?: boolean };

export function resolveConflict(staticDatabase: LibraryDatabase, patch: PatchEnvelope, path: string, resolution: ConflictResolution): ReconciledPatch {
  const next = clone(patch); const operation = next.operations[path];
  if (!operation) throw new Error(`Операция ${path} не найдена`);
  const actual = readPatchPath(staticDatabase, path);
  if (resolution.choice === "static") delete next.operations[path];
  else {
    if (resolution.choice === "manual" && !resolution.delete && !("value" in resolution)) throw new Error("Для ручного разрешения нужно значение либо delete=true");
    const target: PatchOperation = resolution.choice === "manual"
      ? freshOperation(actual, resolution.delete ? "delete" : "set", resolution.value, new Date().toISOString(), operation.transactionId)
      : { ...operation, baseExists: actual.exists, baseHash: actual.exists ? canonicalHash(actual.value) : MISSING_VALUE_HASH };
    next.operations[path] = target;
  }
  return reconcilePatch(staticDatabase, next);
}

export function discardTransaction(patch: PatchEnvelope, transactionId: string): PatchEnvelope {
  return { ...clone(patch), operations: Object.fromEntries(Object.entries(patch.operations).filter(([, operation]) => operation.transactionId !== transactionId)) };
}

export function discardOperation(patch: PatchEnvelope, path: string): PatchEnvelope {
  const next = clone(patch); delete next.operations[path]; return next;
}

export function finalizePublishedDatabase(database: LibraryDatabase, publicationId: string): LibraryDatabase {
  const result = clone(database); result.publicationId = publicationId; return withComputedRevision(result);
}
