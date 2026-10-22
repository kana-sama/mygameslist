import { parseTierList, tierListImageAssetIds, validateTierListImageAttachments } from "./tierList";
import { canonicalHash, canonicalStringify, MISSING_VALUE_HASH, withComputedRevision } from "./canonical";
import { LIBRARY_SCHEMA_VERSION, type LibraryDatabase, type PatchConflict, type PatchEnvelope, type PatchOperation, type ReconciledPatch, type NoteFormat, type NoteAttachment } from "./types";
import { DomainValidationError, assertSourceRepresentable, assertValidLibrary, assertValidPatch, LOCALLY_PATCHABLE_FIELDS, parsePatchPath, patchOperationSourceIssues, validateInteractiveNoteField, validateInteractiveNoteOperationMetadata, type EntityMapName } from "./validation";
import { deriveImageAssetAlt } from "./assetOwnership";
import { normalizeLibraryDatabase } from "./libraryNormalization";

type Entity = LibraryDatabase[EntityMapName][string];


/** Website mutations may change smart state and placement, never the repository program. */
export function assertSmartNoteMutationBoundary(base: LibraryDatabase, current: LibraryDatabase): void {
  for (const id of new Set([...Object.keys(base.notes), ...Object.keys(current.notes)])) {
    const before = base.notes[id], after = current.notes[id];
    if (before?.format !== "smart" && after?.format !== "smart") continue;
    if (!before || before.format !== "smart") throw new Error("Cannot create or convert a smart note from the website");
    if (!after) {
      if (current.games[before.gameId]) throw new Error("Cannot delete an individual smart note");
      continue;
    }
    for (const field of ["id", "gameId", "format", "smart", "bodyMarkdown", "createdAt", "collapsedChecklistSections"] as const) {
      if (before[field] === undefined || after[field] === undefined ? before[field] !== after[field] : !same(before[field], after[field])) throw new Error(`Immutable smart note field: ${field}`);
    }
  }
}

function incompatibleSmartStatePaths(base: LibraryDatabase, operations: Record<string, PatchOperation>): Set<string> {
  const incompatibleNotes = new Set<string>();
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "notes" || parsed.field !== "state" && parsed.field !== "attachments") continue;
    const note = base.notes[parsed.id];
    if (note?.format === "smart" && (operation.smartProgramHash === undefined || (operation.smartStateVersion ?? 1) !== (note.smart?.stateVersion ?? 1))) incompatibleNotes.add(parsed.id);
  }
  const imageIds = new Set<string>();
  for (const id of incompatibleNotes) {
    for (const attachment of base.notes[id]?.attachments ?? []) if (attachment.type === "image") imageIds.add(attachment.assetId);
    const pool = operations[entityPath("notes", id, "attachments")];
    if (pool?.operation === "set" && Array.isArray(pool.value)) for (const attachment of pool.value) {
      if (attachment?.type === "image") imageIds.add(attachment.assetId);
    }
  }
  return new Set(Object.keys(operations).filter(path => {
    const parsed = parsePatchPath(path);
    return parsed?.map === "assets" && imageIds.has(parsed.id) || parsed?.map === "notes" && incompatibleNotes.has(parsed.id) && (parsed.field === "state" || parsed.field === "attachments");
  }));
}

export interface DiffOptions {
  changedAt?: string;
  transactionId?: string;
  previousPatch?: PatchEnvelope;
  blobs?: Record<string, string>;
}

export interface ApplyPatchOptions {
  checkBaseRevision?: boolean;
  checkBaseHashes?: boolean;
  validateResult?: boolean;
}

export type InteractiveNoteFieldUpdate = {
  expectedBodyMarkdown?: string;
  expectedFormat?: NoteFormat;
} & (
  | { noteId: string; field: "bodyMarkdown"; value: string }
  | { noteId: string; field: "collapsedChecklistSections"; value: string[] | undefined });

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

function isCreatedDatedEntity(path: string, operation: PatchOperation): boolean {
  const parsed = parsePatchPath(path);
  if (!parsed) return false;
  return operation.operation === "set"
    && !operation.baseExists
    && parsed.field === undefined
    && (parsed.map === "games" || parsed.map === "notes");
}

function withoutUpdatedAt(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  delete result.updatedAt;
  return result;
}

function sameTargetValue(path: string, operation: PatchOperation, left: unknown, right: unknown): boolean {
  if (same(left, right)) return true;
  return isCreatedDatedEntity(path, operation) && same(withoutUpdatedAt(left), withoutUpdatedAt(right));
}

function opTargetMatches(path: string, operation: PatchOperation, actual: { exists: boolean; value?: unknown }): boolean {
  return operation.operation === "delete" ? !actual.exists : actual.exists && sameTargetValue(path, operation, actual.value, operation.value);
}

function baseMatches(operation: PatchOperation, actual: { exists: boolean; value?: unknown }): boolean {
  if (operation.baseExists !== actual.exists) return false;
  return !actual.exists ? operation.baseHash === MISSING_VALUE_HASH : canonicalHash(actual.value) === operation.baseHash;
}

function assetKind(value: unknown): "image" | "file" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "file") return "file";
  if (kind === "image" || kind === undefined && "base64" in value) return "image";
  return null;
}

function isCompatiblePublishedAsset(path: string, operation: PatchOperation, actual: { exists: boolean; value?: unknown }): boolean {
  const parsed = parsePatchPath(path);
  if (parsed?.map !== "assets" || parsed.field !== undefined || operation.operation !== "set" || operation.baseExists || !actual.exists) return false;
  const localKind = assetKind(operation.value);
  return localKind !== null && localKind === assetKind(actual.value);
}

function freshOperation(base: { exists: boolean; value?: unknown }, operation: "set" | "delete", value: unknown, changedAt: string, transactionId: string, noteFormat?: NoteFormat): PatchOperation {
  return {
    operation,
    ...(noteFormat !== undefined && noteFormat !== "markdown" ? { noteFormat } : {}),
    ...(operation === "set" ? { value: clone(value) } : {}),
    baseExists: base.exists,
    baseHash: base.exists ? canonicalHash(base.value) : MISSING_VALUE_HASH,
    changedAt,
    transactionId,
  };
}

function assertInteractiveNoteFieldIsValid(update: InteractiveNoteFieldUpdate, format?: NoteFormat): void {
  const issues = validateInteractiveNoteField(update.field, update.value, format);
  if (issues.length) throw new DomainValidationError(issues, "Некорректное значение интерактивной заметки");
}

function assertInteractiveNoteOperationMetadataIsValid(changedAt: string, transactionId: string): void {
  const issues = validateInteractiveNoteOperationMetadata(changedAt, transactionId);
  if (issues.length) throw new DomainValidationError(issues, "Некорректные метаданные операции интерактивной заметки");
}

function assertTargetOperationIsSourceRepresentable(path: string, operation: PatchOperation): void {
  const issues = patchOperationSourceIssues(path, operation);
  if (issues.length) throw new DomainValidationError(issues, "Локальный патч содержит данные, не представимые в source tree");
}

function hasOverlappingInteractiveNoteConflict(conflicts: readonly PatchConflict[], rootPath: string, fieldPath: string): boolean {
  return conflicts.some((conflict) => conflict.path === rootPath || conflict.path === fieldPath || conflict.path === `${rootPath}/format`);
}

/** Applies one note interaction without reprocessing the rest of the library. */
export function updateInteractiveNoteField(input: {
  base: LibraryDatabase;
  effective: LibraryDatabase;
  patch: PatchEnvelope;
  conflicts: readonly PatchConflict[];
  update: InteractiveNoteFieldUpdate;
  changedAt: string;
  transactionId: string;
}): { effective: LibraryDatabase; patch: PatchEnvelope } {
  const { base, effective, patch, conflicts, update, changedAt, transactionId } = input;
  assertInteractiveNoteOperationMetadataIsValid(changedAt, transactionId);
  const rootPath = entityPath("notes", update.noteId);
  const fieldPath = entityPath("notes", update.noteId, update.field);
  if (hasOverlappingInteractiveNoteConflict(conflicts, rootPath, fieldPath)) {
    throw new Error(`Нельзя изменить заметку с неразрешённым конфликтом: ${update.noteId}`);
  }

  const effectiveNote = effective.notes[update.noteId];
  if (!effectiveNote) throw new Error(`Заметка не найдена: ${update.noteId}`);
  if (update.expectedBodyMarkdown !== undefined && update.expectedBodyMarkdown !== effectiveNote.bodyMarkdown
    || update.expectedFormat !== undefined && update.expectedFormat !== (effectiveNote.format ?? "markdown")) {
    throw new Error("Заметка изменилась. Повторите действие с актуальным содержимым.");
  }
  assertInteractiveNoteFieldIsValid(update, effectiveNote.format);
  if (update.field === "bodyMarkdown" && effectiveNote.format === "tierlist") {
    const errors = validateTierListImageAttachments(update.value as string, effectiveNote.attachments);
    if (errors.length) throw new Error(errors.join("; "));
  }
  const baseNote = base.notes[update.noteId];
  const baseFieldExists = baseNote !== undefined && hasOwn(baseNote, update.field);
  const baseValue = baseNote?.[update.field];
  const matchesBase = update.value === undefined
    ? !baseFieldExists
    : baseFieldExists && same(update.value, baseValue);
  const createdRoot = patch.operations[rootPath];
  const isLocallyCreatedRoot = createdRoot?.operation === "set"
    && !createdRoot.baseExists
    && createdRoot.baseHash === MISSING_VALUE_HASH
    && baseNote === undefined;
  if (createdRoot && !isLocallyCreatedRoot) {
    throw new Error(`Нельзя изменить заметку с корневой операцией: ${update.noteId}`);
  }

  const nextNote = update.field === "collapsedChecklistSections" && update.value === undefined
    ? (() => { const { collapsedChecklistSections: _removed, ...withoutField } = effectiveNote; return { ...withoutField, updatedAt: changedAt }; })()
    : { ...effectiveNote, [update.field]: clone(update.value), updatedAt: changedAt };
  const nextEffective = {
    ...effective,
    games: {
      ...effective.games,
      [effectiveNote.gameId]: {
        ...effective.games[effectiveNote.gameId],
        updatedAt: changedAt,
      },
    },
    notes: { ...effective.notes, [update.noteId]: nextNote },
  };

  let operations: Record<string, PatchOperation>;
  if (isLocallyCreatedRoot) {
    const operation: PatchOperation = {
      ...createdRoot,
      value: clone(nextNote),
      changedAt,
      transactionId,
    };
    assertTargetOperationIsSourceRepresentable(rootPath, operation);
    operations = { ...patch.operations, [rootPath]: operation };
  } else if (matchesBase && !(update.field === "bodyMarkdown" && patch.operations[entityPath("notes", update.noteId, "format")])) {
    operations = { ...patch.operations };
    delete operations[fieldPath];
  } else {
    const operation = freshOperation(
      { exists: baseFieldExists, ...(baseFieldExists ? { value: baseValue } : {}) },
      update.value === undefined ? "delete" : "set",
      update.value,
      changedAt,
      transactionId,
      update.field === "bodyMarkdown" ? effectiveNote.format : undefined,
    );
    assertTargetOperationIsSourceRepresentable(fieldPath, operation);
    operations = { ...patch.operations, [fieldPath]: operation };
  }

  if (update.field === "bodyMarkdown" && effectiveNote.format === "tierlist") {
    const poolPath = entityPath("notes", update.noteId, "attachments");
    const poolOperation = operations[poolPath];
    const isSnapshot = poolOperation?.operation === "set" && poolOperation.baseExists && poolOperation.baseHash === canonicalHash(poolOperation.value);
    if (!operations[fieldPath] && isSnapshot) delete operations[poolPath];
    else if (operations[fieldPath] && !poolOperation && baseNote && tierListImageAssetIds(parseTierList(update.value as string)).size > 0) {
      operations[poolPath] = freshOperation({ exists: true, value: baseNote.attachments }, "set", effectiveNote.attachments, changedAt, transactionId);
    }
  }
  return { effective: nextEffective, patch: { ...patch, operations } };
}

function retainTimestamp(path: string, candidate: PatchOperation, previous: PatchOperation | undefined): PatchOperation {
  if (!previous || previous.operation !== candidate.operation || previous.baseExists !== candidate.baseExists || previous.baseHash !== candidate.baseHash) return candidate;
  if (candidate.operation === "set" && !sameTargetValue(path, candidate, candidate.value, previous.value)) return candidate;
  if ((previous.noteFormat ?? "markdown") !== (candidate.noteFormat ?? "markdown") || (previous.smartStateVersion ?? 1) !== (candidate.smartStateVersion ?? 1)) return candidate;
  if (previous.smartProgramHash !== candidate.smartProgramHash || previous.smartStateVersion !== candidate.smartStateVersion) {
    return { ...clone(candidate), changedAt: previous.changedAt, transactionId: previous.transactionId };
  }
  return clone(previous);
}

function createdEntityValue(mapName: EntityMapName, entity: Entity, changedAt: string): Entity {
  const value = clone(entity);
  if (mapName !== "assets") (value as unknown as Record<string, unknown>).updatedAt = changedAt;
  return value;
}

/** Blobs live only as long as their metadata-only asset set operation survives. */
export function prunePatchBlobs(patch: PatchEnvelope): PatchEnvelope {
  const blobs: Record<string, string> = {};
  for (const [path, operation] of Object.entries(patch.operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "assets" || parsed.field !== undefined || operation.operation !== "set") continue;
    const asset = operation.value;
    if (!asset || typeof asset !== "object" || !("kind" in asset)) continue;
    const blob = patch.blobs[parsed.id];
    if (blob !== undefined) blobs[parsed.id] = blob;
  }
  return { ...clone(patch), blobs };
}

/** Produces a sparse, stable-ID patch and drops derived updatedAt noise. */
export function diffLibrary(base: LibraryDatabase, current: LibraryDatabase, options: DiffOptions = {}): PatchEnvelope {
  assertSmartNoteMutationBoundary(base, current);
  assertValidLibrary(base); assertValidLibrary(current);
  const normalizedBase = normalizeLibraryDatabase(base);
  const normalizedCurrent = normalizeLibraryDatabase(current);
  const changedAt = options.changedAt ?? new Date().toISOString();
  const transactionId = options.transactionId ?? globalThis.crypto?.randomUUID?.() ?? `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const operations: Record<string, PatchOperation> = {};
  const maps: EntityMapName[] = ["games", "notes", "assets"];
  for (const mapName of maps) {
    const baseMap = normalizedBase[mapName] as Record<string, Entity>;
    const currentMap = normalizedCurrent[mapName] as Record<string, Entity>;
    for (const id of new Set([...Object.keys(baseMap), ...Object.keys(currentMap)])) {
      const rootPath = entityPath(mapName, id);
      if (!(id in currentMap)) {
        const candidate = freshOperation({ exists: true, value: baseMap[id] }, "delete", undefined, changedAt, transactionId);
        operations[rootPath] = retainTimestamp(rootPath, candidate, options.previousPatch?.operations[rootPath]);
      } else if (!(id in baseMap)) {
        const candidate = freshOperation({ exists: false }, "set", createdEntityValue(mapName, currentMap[id], changedAt), changedAt, transactionId);
        operations[rootPath] = retainTimestamp(rootPath, candidate, options.previousPatch?.operations[rootPath]);
      } else if (mapName === "assets") {
        if (!same(baseMap[id], currentMap[id])) {
          const candidate = freshOperation({ exists: true, value: baseMap[id] }, "set", currentMap[id], changedAt, transactionId);
          operations[rootPath] = retainTimestamp(rootPath, candidate, options.previousPatch?.operations[rootPath]);
        }
      } else {
        for (const field of LOCALLY_PATCHABLE_FIELDS[mapName]) {
          const baseEntity = baseMap[id] as unknown as Record<string, unknown>;
          const currentEntity = currentMap[id] as unknown as Record<string, unknown>;
          const beforeExists = hasOwn(baseEntity, field);
          const afterExists = hasOwn(currentEntity, field);
          const before = baseEntity[field];
          const after = currentEntity[field];
          const requiredContentSnapshot = mapName === "notes" && field === "bodyMarkdown" && baseEntity.format !== currentEntity.format;
          const requiredPoolSnapshot = mapName === "notes" && field === "attachments" && currentEntity.format === "tierlist"
            && (baseEntity.format !== currentEntity.format || baseEntity.bodyMarkdown !== currentEntity.bodyMarkdown)
            && tierListImageAssetIds(parseTierList(currentEntity.bodyMarkdown as string)).size > 0;
          if (!requiredContentSnapshot && !requiredPoolSnapshot && beforeExists === afterExists && (!beforeExists || same(before, after))) continue;
          const path = entityPath(mapName, id, field);
          const candidate = freshOperation(
            { exists: beforeExists, ...(beforeExists ? { value: before } : {}) },
            afterExists ? "set" : "delete",
            after,
            changedAt,
            transactionId,
            mapName === "notes" && field === "bodyMarkdown" ? currentEntity.format as NoteFormat | undefined : undefined,
          );
          if (mapName === "notes" && currentEntity.format === "smart" && (field === "state" || field === "attachments")) {
            candidate.smartProgramHash = normalizedCurrent.notes[id].smart!.program.hash;
            candidate.smartStateVersion = normalizedCurrent.notes[id].smart!.stateVersion ?? 1;
          }
          operations[path] = retainTimestamp(path, candidate, options.previousPatch?.operations[path]);
        }
      }
    }
  }
  const previousBlobs = options.previousPatch?.blobs ?? {};
  return prunePatchBlobs({
    patchVersion: 2,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    baseRevision: base.revision,
    operations,
    blobs: { ...previousBlobs, ...options.blobs },
  });
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
  const games: Record<string, string> = {}; const notes: Record<string, string> = {};
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path); if (!parsed) continue;
    if (parsed.map === "games") games[parsed.id] = latest(games[parsed.id], operation.changedAt);
    if (parsed.map === "notes") {
      notes[parsed.id] = latest(notes[parsed.id], operation.changedAt);
      const note = database.notes[parsed.id] ?? original.notes[parsed.id];
      if (note) games[note.gameId] = latest(games[note.gameId], operation.changedAt);
    }
  }
  for (const [id, changedAt] of Object.entries(games)) if (database.games[id]) database.games[id].updatedAt = changedAt;
  for (const [id, changedAt] of Object.entries(notes)) if (database.notes[id]) database.notes[id].updatedAt = changedAt;
}

function assertDirectImageAssetAltsAreDerived(base: LibraryDatabase, database: LibraryDatabase, operations: Record<string, PatchOperation>): void {
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "assets" || parsed.field !== undefined || operation.operation !== "set") continue;
    const asset = operation.value;
    if (!asset || typeof asset !== "object" || !("kind" in asset) || asset.kind !== "image" || !("alt" in asset) || typeof asset.alt !== "string") continue;
    if (operation.baseExists) {
      const previous = base.assets[parsed.id];
      if (previous?.kind !== "image" || !same({ ...previous, alt: asset.alt }, asset)) throw new Error(`Существующий image asset допускает только owner-derived alt: ${path}`);
    }
    if (asset.alt !== deriveImageAssetAlt(database, parsed.id)) throw new Error(`Global image alt не совпадает с owner-derived значением: ${path}`);
  }
}

function assertOperationPayloadsSourceRepresentable(operations: Record<string, PatchOperation>, message: string): void {
  const issues = Object.entries(operations).flatMap(([path, operation]) => patchOperationSourceIssues(path, operation));
  if (issues.length) throw new DomainValidationError(issues, message);
}

function removeUncoupledDerivedAssetOperations(database: LibraryDatabase, operations: Record<string, PatchOperation>): void {
  const candidate = applyBestEffort(database, operations);
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "assets" || parsed.field !== undefined || operation.operation !== "set") continue;
    const asset = operation.value;
    if (!asset || typeof asset !== "object" || !("kind" in asset) || asset.kind !== "image" || !("alt" in asset) || typeof asset.alt !== "string") continue;
    if (asset.alt !== deriveImageAssetAlt(candidate, parsed.id)) delete operations[path];
  }
}

export function applyPatch(base: LibraryDatabase, patch: PatchEnvelope, options: ApplyPatchOptions = {}): LibraryDatabase {
  assertValidLibrary(base); assertValidPatch(patch);
  const normalizedBase = normalizeLibraryDatabase(base);
  if ((options.checkBaseRevision ?? true) && patch.baseRevision !== base.revision) throw new Error("Патч создан для другой revision базы");
  if (options.checkBaseHashes ?? true) for (const [path, operation] of Object.entries(patch.operations)) {
    if (!baseMatches(operation, readPatchPath(normalizedBase, path))) throw new Error(`Base hash не совпадает: ${path}`);
  }
  const result = clone(normalizedBase);
  for (const [path, operation] of Object.entries(patch.operations).sort(([a], [b]) => a.localeCompare(b))) mutateAtPath(result, path, operation);
  applyUpdatedAt(result, normalizedBase, patch.operations);
  if (options.validateResult ?? true) assertOperationPayloadsSourceRepresentable(patch.operations, "Локальный патч содержит данные, не представимые в source tree");
  assertSmartNoteMutationBoundary(normalizedBase, result);
  if (incompatibleSmartStatePaths(normalizedBase, patch.operations).size) throw new Error("Smart note state version conflict");
  const normalizedResult = normalizeLibraryDatabase(result);
  if (options.validateResult ?? true) {
    assertNoteSourceFormats(normalizedResult, patch.operations);
    assertDirectImageAssetAltsAreDerived(normalizedBase, result, patch.operations);
    assertSourceRepresentable(normalizedResult);
  }
  return normalizedResult;
}

function assertNoteSourceFormats(database: LibraryDatabase, operations: Record<string, PatchOperation>): void {
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "notes" || parsed.field !== "bodyMarkdown" || operation.operation !== "set") continue;
    const pairedFormat = operations[entityPath("notes", parsed.id, "format")];
    const expected = operation.noteFormat ?? (pairedFormat?.operation === "set" ? pairedFormat.value : "markdown");
    if (expected !== (database.notes[parsed.id]?.format ?? "markdown")) {
      throw new DomainValidationError([{ path, message: "Формат заметки отличается от формата сохранённого текста" }]);
    }
  }
}

function applyBestEffort(base: LibraryDatabase, operations: Record<string, PatchOperation>): LibraryDatabase {
  const result = clone(base); const applied: Record<string, PatchOperation> = {};
  for (const [path, operation] of Object.entries(operations).sort(([a], [b]) => a.localeCompare(b))) {
    try { mutateAtPath(result, path, operation); applied[path] = operation; } catch { /* conflict remains visible, static value wins */ }
  }
  applyUpdatedAt(result, base, applied); return result;
}

/** Metadata snapshots cannot resurrect globally removed image bytes. Keep those note candidates explicit conflicts. */
function unavailableTierListImages(database: LibraryDatabase): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const note of Object.values(database.notes)) {
    if (note.format !== "tierlist") continue;
    const missing = [...tierListImageAssetIds(parseTierList(note.bodyMarkdown))].filter(id => !database.assets[id]);
    if (missing.length) result.set(note.id, missing);
  }
  return result;
}

/** Dependency groups preserve a complete source/format/image-pool candidate during conflicts. */
function noteContentOperationGroups(database: LibraryDatabase, intended: LibraryDatabase, operations: Record<string, PatchOperation>): Map<string, string[]> {
  const edges = new Map<string, Set<string>>();
  const connect = (paths: string[]) => {
    for (const path of paths) {
      const adjacent = edges.get(path) ?? new Set<string>();
      paths.forEach(partner => adjacent.add(partner)); edges.set(path, adjacent);
    }
  };
  for (const id of new Set([...Object.keys(database.notes), ...Object.keys(intended.notes)])) {
    const root = entityPath("notes", id), body = entityPath("notes", id, "bodyMarkdown"), format = entityPath("notes", id, "format"), pool = entityPath("notes", id, "attachments");
    const contentPaths = [body, format].filter(path => hasOwn(operations, path));
    if (contentPaths.length > 1) connect(contentPaths);
    const before = database.notes[id], after = intended.notes[id];
    if (before?.format === "smart" || after?.format === "smart") {
      connect([entityPath("notes", id, "state"), pool].filter(path => hasOwn(operations, path)));
    }
    const missingBefore = before?.format === "tierlist" && validateTierListImageAttachments(before.bodyMarkdown, after?.attachments ?? []).length > 0;
    const missingAfter = after?.format === "tierlist" && validateTierListImageAttachments(after.bodyMarkdown, before?.attachments ?? []).length > 0;
    if (hasOwn(operations, pool) && contentPaths.length && (missingBefore || missingAfter)) connect([...contentPaths, pool]);
    if (after?.format === "tierlist" && [...tierListImageAssetIds(parseTierList(after.bodyMarkdown))].some(assetId => !intended.assets[assetId])) {
      connect([root, ...contentPaths, pool].filter(path => hasOwn(operations, path)));
    }
    const ownerPaths = hasOwn(operations, root) ? [root] : hasOwn(operations, pool) ? [pool] : [];
    if (!ownerPaths.length) continue;
    const beforeImages = before?.format === "tierlist" ? tierListImageAssetIds(parseTierList(before.bodyMarkdown)) : new Set((before?.format === "smart" ? before.attachments : []).filter(item => item.type === "image").map(item => item.assetId));
    const afterImages = after?.format === "tierlist" ? tierListImageAssetIds(parseTierList(after.bodyMarkdown)) : new Set((after?.format === "smart" ? after.attachments : []).filter(item => item.type === "image").map(item => item.assetId));
    for (const assetId of new Set([...beforeImages, ...afterImages])) {
      const assetPath = entityPath("assets", assetId), operation = operations[assetPath];
      if (operation?.operation === "delete" && beforeImages.has(assetId)
        || operation?.operation === "set" && afterImages.has(assetId) && !operation.baseExists) connect([...ownerPaths, assetPath]);
    }
  }
  const groups = new Map<string, string[]>();
  for (const path of edges.keys()) {
    if (groups.has(path)) continue;
    const visited = new Set<string>(), pending = [path];
    while (pending.length) { const next = pending.pop()!; if (visited.has(next)) continue; visited.add(next); pending.push(...(edges.get(next) ?? [])); }
    const group = [...visited]; group.forEach(member => groups.set(member, group));
  }
  return groups;
}

/** Unchanged pools accompany image-bearing body writes as ownership snapshots.
 * Keep authoritative unrelated attachments; restore only missing required image entries.
 */
function adaptTierListPoolSnapshots(database: LibraryDatabase, operations: Record<string, PatchOperation>): void {
  for (const [path, operation] of Object.entries(operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "notes" || parsed.field !== "attachments" || operation.operation !== "set"
      || !operation.baseExists || operation.baseHash !== canonicalHash(operation.value)) continue;
    const body = operations[entityPath("notes", parsed.id, "bodyMarkdown")];
    if (body?.operation !== "set" || body.noteFormat !== "tierlist" || typeof body.value !== "string" || !Array.isArray(operation.value)) continue;
    const note = database.notes[parsed.id];
    if (!note) continue;
    const needed = tierListImageAssetIds(parseTierList(body.value));
    const pool = new Set(note.attachments.filter(item => item.type === "image").map(item => item.assetId));
    const missing = operation.value.filter((item): item is NoteAttachment => !!item && typeof item === "object" && item.type === "image" && needed.has(item.assetId) && !pool.has(item.assetId));
    if (!missing.length) { delete operations[path]; continue; }
    operation.value = [...clone(note.attachments), ...clone(missing)];
  }
}

/** Rebases clean operations, prunes already-published values, and reports same-field conflicts. */
export function reconcilePatch(staticDatabase: LibraryDatabase, incoming: PatchEnvelope): ReconciledPatch {
  const normalizedIncoming = prunePatchBlobs(incoming);
  assertValidLibrary(staticDatabase); assertValidPatch(normalizedIncoming);
  const normalizedStatic = normalizeLibraryDatabase(staticDatabase);
  assertOperationPayloadsSourceRepresentable(normalizedIncoming.operations, "Патч содержит данные, не представимые в source tree");
  // Body-only edits retain their original interpretation across a remote mode change.
  for (const [path, operation] of Object.entries(normalizedIncoming.operations)) {
    const parsed = parsePatchPath(path);
    if (parsed?.map !== "notes" || parsed.field !== "bodyMarkdown" || operation.operation !== "set") continue;
    const formatPath = entityPath("notes", parsed.id, "format");
    const note = normalizedStatic.notes[parsed.id];
    if (!note || hasOwn(normalizedIncoming.operations, formatPath)) continue;
    const format = operation.noteFormat ?? "markdown";
    if (format === (note.format ?? "markdown")) continue;
    const original = format !== "markdown" ? { exists: true, value: format } : { exists: false };
    normalizedIncoming.operations[formatPath] = freshOperation(original, format !== "markdown" ? "set" : "delete", format !== "markdown" ? format : undefined, operation.changedAt, operation.transactionId);
  }
  adaptTierListPoolSnapshots(normalizedStatic, normalizedIncoming.operations);
  const intended = applyBestEffort(normalizedStatic, normalizedIncoming.operations);
  assertSmartNoteMutationBoundary(normalizedStatic, intended);
  const incompatibleSmartPaths = incompatibleSmartStatePaths(normalizedStatic, normalizedIncoming.operations);
  assertDirectImageAssetAltsAreDerived(normalizedStatic, intended, normalizedIncoming.operations);
  const unavailable = unavailableTierListImages(intended);
  const unavailablePaths = new Set(Object.keys(normalizedIncoming.operations).filter(path => {
    const parsed = parsePatchPath(path);
    return parsed?.map === "notes" && unavailable.has(parsed.id)
      && (parsed.field === undefined || parsed.field === "bodyMarkdown" || parsed.field === "format" || parsed.field === "attachments");
  }));
  const unsafePaths = new Set([...unavailablePaths, ...incompatibleSmartPaths]);
  const representableIntended = unsafePaths.size
    ? applyBestEffort(normalizedStatic, Object.fromEntries(Object.entries(normalizedIncoming.operations).filter(([path]) => !unsafePaths.has(path))))
    : intended;
  assertSourceRepresentable(normalizeLibraryDatabase(representableIntended));
  const operations: Record<string, PatchOperation> = {}; const applicable: Record<string, PatchOperation> = {}; const conflicts: PatchConflict[] = []; let prunedCount = 0;
  const contentGroups = noteContentOperationGroups(normalizedStatic, intended, normalizedIncoming.operations);
  const contentConflicts = new Set<string>(unsafePaths);
  const pendingContent = new Set<string>();
  for (const path of Object.keys(normalizedIncoming.operations)) {
    const coupled = contentGroups.get(path) ?? [path];
    if (coupled.length < 2) continue;
    if (coupled.some(candidate => !opTargetMatches(candidate, normalizedIncoming.operations[candidate], readPatchPath(normalizedStatic, candidate)))) {
      coupled.forEach(candidate => pendingContent.add(candidate));
    }
    if (coupled.some(candidate => {
      const operation = normalizedIncoming.operations[candidate];
      const actual = readPatchPath(normalizedStatic, candidate);
      return !opTargetMatches(candidate, operation, actual) && !baseMatches(operation, actual);
    })) coupled.forEach(candidate => contentConflicts.add(candidate));
  }
  for (const [path, operation] of Object.entries(normalizedIncoming.operations)) {
    const actual = readPatchPath(normalizedStatic, path);
    if (!contentConflicts.has(path) && !pendingContent.has(path) && (opTargetMatches(path, operation, actual) || isCompatiblePublishedAsset(path, operation, actual))) { prunedCount += 1; continue; }
    operations[path] = clone(operation);
    if (contentConflicts.has(path) || (!opTargetMatches(path, operation, actual) && !baseMatches(operation, actual))) conflicts.push({ path, operation: clone(operation), staticValue: clone(actual.value), staticExists: actual.exists });
    else applicable[path] = clone(operation);
  }
  let patch = prunePatchBlobs({ ...clone(normalizedIncoming), baseRevision: staticDatabase.revision, operations });
  removeUncoupledDerivedAssetOperations(normalizedStatic, applicable);
  const effective = applyBestEffort(normalizedStatic, applicable);
  assertDirectImageAssetAltsAreDerived(normalizedStatic, effective, applicable);
  const normalizedEffective = normalizeLibraryDatabase(effective);
  assertSourceRepresentable(normalizedEffective);
  const latestApplicable = Object.values(applicable).sort((left, right) => left.changedAt.localeCompare(right.changedAt)).at(-1);
  if (latestApplicable) {
    const canonicalApplicable = diffLibrary(normalizedStatic, normalizedEffective, {
      previousPatch: patch,
      changedAt: latestApplicable.changedAt,
      transactionId: latestApplicable.transactionId,
      blobs: patch.blobs,
    });
    // Keep a matching partner as a source/format snapshot until the complete candidate is published.
    for (const [path, operation] of Object.entries(applicable)) {
      if (pendingContent.has(path) && !hasOwn(canonicalApplicable.operations, path)) {
        const actual = readPatchPath(normalizedStatic, path);
        canonicalApplicable.operations[path] = { ...clone(operation), baseExists: actual.exists, baseHash: actual.exists ? canonicalHash(actual.value) : MISSING_VALUE_HASH };
      }
    }
    const conflicted = Object.fromEntries(Object.entries(operations).filter(([path]) => !(path in applicable)));
    patch = prunePatchBlobs({ ...patch, operations: { ...canonicalApplicable.operations, ...conflicted } });
  }
  return { patch, effective: normalizedEffective, conflicts, prunedCount };
}

export type ConflictResolution = { choice: "static" } | { choice: "local" } | { choice: "manual"; value?: unknown; delete?: boolean };

export function resolveConflict(staticDatabase: LibraryDatabase, patch: PatchEnvelope, path: string, resolution: ConflictResolution): ReconciledPatch {
  const next = clone(patch); const operation = next.operations[path];
  if (!operation) throw new Error(`Операция ${path} не найдена`);
  const normalizedStatic = normalizeLibraryDatabase(staticDatabase);
  const intended = applyBestEffort(normalizedStatic, next.operations);
  const coupledPaths = noteContentOperationGroups(normalizedStatic, intended, next.operations).get(path) ?? [path];
  if (resolution.choice !== "static" && coupledPaths.some(candidate => incompatibleSmartStatePaths(normalizedStatic, next.operations).has(candidate))) throw new Error("Smart note state version changed; export incompatible state and resolve against the published state version");
  const actual = readPatchPath(normalizedStatic, path);
  if (resolution.choice === "local") {
    const unavailable = unavailableTierListImages(intended);
    const noteIds = coupledPaths.flatMap(candidate => { const parsed = parsePatchPath(candidate); return parsed?.map === "notes" ? [parsed.id] : []; });
    const missing = noteIds.flatMap(id => unavailable.get(id) ?? []);
    if (missing.length) throw new Error(`Изображение тирлиста недоступно: ${[...new Set(missing)].join(", ")}. Восстановите его через загрузку или восстановление ресурсов.`);
  }
  if (resolution.choice === "static") coupledPaths.forEach(candidate => { delete next.operations[candidate]; });
  else {
    if (resolution.choice === "manual" && !resolution.delete && !("value" in resolution)) throw new Error("Для ручного разрешения нужно значение либо delete=true");
    const target: PatchOperation = resolution.choice === "manual"
      ? freshOperation(actual, resolution.delete ? "delete" : "set", resolution.value, new Date().toISOString(), operation.transactionId, resolution.delete ? undefined : operation.noteFormat)
      : { ...operation, baseExists: actual.exists, baseHash: actual.exists ? canonicalHash(actual.value) : MISSING_VALUE_HASH };
    if (operation.smartProgramHash !== undefined) target.smartProgramHash = operation.smartProgramHash;
    if (operation.smartStateVersion !== undefined) target.smartStateVersion = operation.smartStateVersion;
    next.operations[path] = target;
    for (const candidate of coupledPaths) {
      if (candidate === path) continue;
      const partnerActual = readPatchPath(normalizedStatic, candidate);
      next.operations[candidate] = { ...next.operations[candidate], baseExists: partnerActual.exists, baseHash: partnerActual.exists ? canonicalHash(partnerActual.value) : MISSING_VALUE_HASH };
    }
  }
  return reconcilePatch(staticDatabase, next);
}

export function discardTransaction(patch: PatchEnvelope, transactionId: string): PatchEnvelope {
  return prunePatchBlobs({ ...clone(patch), operations: Object.fromEntries(Object.entries(patch.operations).filter(([, operation]) => operation.transactionId !== transactionId)) });
}

export function discardOperation(patch: PatchEnvelope, path: string): PatchEnvelope {
  const next = clone(patch); delete next.operations[path]; return prunePatchBlobs(next);
}

export function finalizePublishedDatabase(database: LibraryDatabase, publicationId: string): LibraryDatabase {
  const result = clone(database); result.publicationId = publicationId; return withComputedRevision(result);
}
