import { canonicalStringify } from "./canonical";
import { deriveImageAssetAlt, indexAssetOwners, type AssetOwner } from "./assetOwnership";
import { normalizeLibraryDatabase } from "./libraryNormalization";
import { deriveMarkdownTitle } from "./markdownDiff";
import { applyPatch, prunePatchBlobs } from "./patch";
import type { Game, LibraryDatabase, Note, PatchEnvelope, PatchOperation } from "./types";
import { assertValidLibrary, parsePatchPath, type EntityMapName } from "./validation";

export interface PatchSelectionSeed {
  changeId: string;
  operationPaths: readonly string[];
}

export interface PatchDependencyReason {
  requiredPath: string;
  requiredByChangeId: string;
  message: string;
}

export interface PatchSelectionResult {
  publishPatch: PatchEnvelope;
  deferredPatch: PatchEnvelope;
  selectedPaths: string[];
  explicitPaths: string[];
  dependencyReasons: PatchDependencyReason[];
}

export class PatchSelectionError extends Error {
  constructor(public readonly changeId: string, message: string) {
    super(message);
    this.name = "PatchSelectionError";
  }
}

interface LocatedOperation {
  path: string;
  operation: PatchOperation;
  map: EntityMapName;
  id: string;
  field?: string;
}

const ORDERING_FIELDS = new Set(["placement", "rank", "groupRank"]);
const REFERENCE_FIELDS = new Set(["coverAssetId", "progressItems", "attachments"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function entityAt(database: LibraryDatabase, map: EntityMapName, id: string): Game | Note | LibraryDatabase["assets"][string] | undefined {
  return database[map][id] as Game | Note | LibraryDatabase["assets"][string] | undefined;
}

function referencedAssets(value: unknown): Set<string> {
  const result = new Set<string>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  if ("coverAssetId" in value && typeof value.coverAssetId === "string") result.add(value.coverAssetId);
  if ("progressItems" in value && Array.isArray(value.progressItems)) {
    for (const item of value.progressItems) {
      if (item && typeof item === "object" && "iconAssetId" in item && typeof item.iconAssetId === "string") result.add(item.iconAssetId);
    }
  }
  if ("attachments" in value && Array.isArray(value.attachments)) {
    for (const attachment of value.attachments) {
      if (!attachment || typeof attachment !== "object" || !("assetId" in attachment)) continue;
      if (typeof attachment.assetId === "string") result.add(attachment.assetId);
    }
  }
  return result;
}

function noteTitle(note: Note | undefined): string {
  return deriveMarkdownTitle(note?.bodyMarkdown ?? "") || "Заметка";
}

function locatedOperations(patch: PatchEnvelope): LocatedOperation[] {
  const result: LocatedOperation[] = [];
  for (const [path, operation] of Object.entries(patch.operations)) {
    const parsed = parsePatchPath(path);
    if (parsed) result.push({ path, operation, ...parsed });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function operationChangesReferences(operation: LocatedOperation): boolean {
  return operation.field === undefined && (operation.map === "games" || operation.map === "notes")
    || operation.field !== undefined && REFERENCE_FIELDS.has(operation.field);
}

function operationReferencedAssets(operation: LocatedOperation, database: LibraryDatabase): Set<string> {
  const value = entityAt(database, operation.map, operation.id);
  if (operation.field === undefined) return referencedAssets(value);
  if (!value || typeof value !== "object") return new Set();
  return referencedAssets({ [operation.field]: (value as unknown as Record<string, unknown>)[operation.field] });
}

function targetReferences(operation: LocatedOperation, effective: LibraryDatabase): Set<string> {
  if (!operationChangesReferences(operation) || operation.operation.operation === "delete") return new Set();
  return operationReferencedAssets(operation, effective);
}

function baseReferences(operation: LocatedOperation, base: LibraryDatabase): Set<string> {
  if (!operationChangesReferences(operation)) return new Set();
  return operationReferencedAssets(operation, base);
}

function operationMayAffectDerivedImageAlt(operation: LocatedOperation): boolean {
  if (operation.map === "games") return operation.field === undefined || operation.field === "coverAssetId";
  if (operation.map === "notes") return operation.field === undefined || operation.field === "attachments";
  return false;
}

function ownerAffectedImageIds(operation: LocatedOperation, base: LibraryDatabase, effective: LibraryDatabase): string[] {
  if (!operationMayAffectDerivedImageAlt(operation)) return [];
  return [...new Set([
    ...operationReferencedAssets(operation, base),
    ...operationReferencedAssets(operation, effective),
  ])]
    .filter((assetId) => base.assets[assetId]?.kind === "image" || effective.assets[assetId]?.kind === "image")
    .sort();
}

type DerivedAltOwner =
  | Extract<AssetOwner, { role: "cover" }>
  | Extract<AssetOwner, { role: "note-image" }>;

function derivedAltOwners(database: LibraryDatabase, assetId: string): DerivedAltOwner[] {
  return (indexAssetOwners(database).get(assetId) ?? [])
    .filter((owner): owner is DerivedAltOwner => owner.role === "cover" || owner.role === "note-image");
}

function winningImageOwner(database: LibraryDatabase, assetId: string): DerivedAltOwner | undefined {
  const owners = derivedAltOwners(database, assetId);
  return owners.find((owner): owner is Extract<AssetOwner, { role: "cover" }> => owner.role === "cover")
    ?? owners.find((owner): owner is Extract<AssetOwner, { role: "note-image" }> => owner.role === "note-image");
}

function derivedAltOwnerState(database: LibraryDatabase, assetId: string): unknown[] {
  return derivedAltOwners(database, assetId).map((owner) => owner.role === "cover"
    ? { role: owner.role, gameId: owner.gameId, alt: owner.alt }
    : { role: owner.role, gameId: owner.gameId, noteId: owner.noteId, index: owner.index, alt: owner.alt });
}

function ownerOperationPath(
  owner: DerivedAltOwner | undefined,
  operationsByPath: ReadonlyMap<string, LocatedOperation>,
): string | undefined {
  if (!owner) return undefined;
  const candidates = owner.role === "cover"
    ? [`/games/${owner.gameId}`, `/games/${owner.gameId}/coverAssetId`]
    : [`/notes/${owner.noteId}`, `/notes/${owner.noteId}/attachments`];
  return candidates.find((path) => operationsByPath.has(path));
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

function filterEnvelope(patch: PatchEnvelope, include: (path: string) => boolean): PatchEnvelope {
  return prunePatchBlobs({
    ...clone(patch),
    operations: Object.fromEntries(Object.entries(patch.operations).filter(([path]) => include(path))),
  });
}

function selectedOwnerDatabase(
  base: LibraryDatabase,
  patch: PatchEnvelope,
  selectedPaths: ReadonlySet<string>,
  operationsByPath: ReadonlyMap<string, LocatedOperation>,
): LibraryDatabase | null {
  const ownerPatch = filterEnvelope(patch, (path) => {
    if (!selectedPaths.has(path)) return false;
    const operation = operationsByPath.get(path);
    if (!operation) return false;
    if (operationMayAffectDerivedImageAlt(operation)) return true;
    return operation.map === "assets"
      && operation.field === undefined
      && operation.operation.operation === "set"
      && !operation.operation.baseExists;
  });
  try {
    return applyPatch(base, ownerPatch, { validateResult: false });
  } catch {
    return null;
  }
}

export function mergePatchEnvelopes(earlier: PatchEnvelope, later: PatchEnvelope): PatchEnvelope {
  return prunePatchBlobs({
    ...clone(earlier),
    ...clone(later),
    baseRevision: later.baseRevision ?? earlier.baseRevision,
    operations: { ...clone(earlier.operations), ...clone(later.operations) },
    blobs: { ...clone(earlier.blobs), ...clone(later.blobs) },
  });
}

export function rebasePostClickOverlaps(deferred: PatchEnvelope, postClick: PatchEnvelope): PatchEnvelope {
  return {
    ...clone(postClick),
    operations: Object.fromEntries(Object.entries(postClick.operations).map(([path, operation]) => {
      const deferredOperation = deferred.operations[path];
      // The later target wins, but conflicts are still measured from the
      // published value that the deferred operation originally observed.
      return [path, deferredOperation
        ? {
          ...clone(operation),
          baseExists: deferredOperation.baseExists,
          baseHash: deferredOperation.baseHash,
        }
        : clone(operation)];
    })),
  };
}

export function resolvePatchSelection(
  base: LibraryDatabase,
  effective: LibraryDatabase,
  patch: PatchEnvelope,
  seeds: readonly PatchSelectionSeed[],
): PatchSelectionResult {
  const normalizedBase = normalizeLibraryDatabase(base);
  const normalizedEffective = normalizeLibraryDatabase(effective);
  const selectedPaths = new Set<string>();
  const explicitPaths = new Set<string>();
  const pathOrigins = new Map<string, string>();
  const dependencyReasons: PatchDependencyReason[] = [];
  const operations = locatedOperations(patch);
  const operationsByPath = new Map(operations.map((operation) => [operation.path, operation]));
  const fallbackChangeId = seeds[0]?.changeId ?? "";

  for (const seed of seeds) {
    for (const path of seed.operationPaths) {
      if (!Object.prototype.hasOwnProperty.call(patch.operations, path)) {
        throw new PatchSelectionError(seed.changeId, `Операция ${path} не найдена в локальном патче`);
      }
      explicitPaths.add(path);
      selectedPaths.add(path);
      if (!pathOrigins.has(path)) pathOrigins.set(path, seed.changeId);
    }
  }

  const addDependency = (requiredPath: string, requiredByPath: string, message: string): boolean => {
    if (selectedPaths.has(requiredPath)) return false;
    const changeId = pathOrigins.get(requiredByPath) ?? fallbackChangeId;
    if (!operationsByPath.has(requiredPath)) {
      throw new PatchSelectionError(changeId, `${message}: операция ${requiredPath} отсутствует`);
    }
    selectedPaths.add(requiredPath);
    pathOrigins.set(requiredPath, changeId);
    dependencyReasons.push({ requiredPath, requiredByChangeId: changeId, message });
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const path of [...selectedPaths].sort()) {
      const current = operationsByPath.get(path);
      const changeId = pathOrigins.get(path) ?? fallbackChangeId;
      if (!current) throw new PatchSelectionError(changeId, `Операция ${path} не найдена в локальном патче`);

      if (current.field !== undefined && !entityAt(normalizedBase, current.map, current.id)) {
        const rootPath = `/${current.map}/${current.id}`;
        const root = operationsByPath.get(rootPath);
        if (!root || root.operation.operation !== "set") {
          throw new PatchSelectionError(changeId, `Сущность для ${path} отсутствует в базе и не создаётся патчем`);
        }
        changed = addDependency(rootPath, path, `Нужно создать сущность для ${path}`) || changed;
      }

      if (current.map === "notes" && current.field === undefined && current.operation.operation === "set") {
        const note = normalizedEffective.notes[current.id];
        if (note && !normalizedBase.games[note.gameId]) {
          changed = addDependency(
            `/games/${note.gameId}`,
            path,
            `Нужно создать игру для заметки «${noteTitle(note)}»`,
          ) || changed;
        }
      }

      if (current.map === "games" && current.field === undefined && current.operation.operation === "delete") {
        for (const candidate of operations) {
          if (candidate.operation.transactionId !== current.operation.transactionId
            || candidate.map !== "notes"
            || candidate.field !== undefined
            || candidate.operation.operation !== "delete"
            || normalizedBase.notes[candidate.id]?.gameId !== current.id) continue;
          changed = addDependency(
            candidate.path,
            path,
            `Нужно удалить заметку игры «${normalizedBase.games[current.id]?.title ?? current.id}»`,
          ) || changed;
        }
      }

      if (current.field !== undefined && ORDERING_FIELDS.has(current.field)) {
        for (const candidate of operations) {
          if (candidate.operation.transactionId !== current.operation.transactionId
            || candidate.field === undefined
            || !ORDERING_FIELDS.has(candidate.field)) continue;
          changed = addDependency(candidate.path, path, "Нужно сохранить целостность порядка") || changed;
        }
      }

      const selectedOwnerState = selectedOwnerDatabase(normalizedBase, patch, selectedPaths, operationsByPath);
      if (selectedOwnerState) {
        for (const assetId of ownerAffectedImageIds(current, normalizedBase, normalizedEffective)) {
          if (deriveImageAssetAlt(normalizedBase, assetId) === deriveImageAssetAlt(selectedOwnerState, assetId)) continue;
          changed = addDependency(
            `/assets/${assetId}`,
            path,
            `Нужно сохранить owner-derived alt asset ${assetId}`,
          ) || changed;
        }
      }

      for (const assetId of targetReferences(current, normalizedEffective)) {
        if (normalizedBase.assets[assetId]) continue;
        const note = current.map === "notes" ? normalizedEffective.notes[current.id] : undefined;
        const message = note
          ? `Нужно для вложения заметки «${noteTitle(note)}»`
          : current.field === "progressItems"
            ? `Нужно для иконки прогресса игры «${normalizedEffective.games[current.id]?.title ?? current.id}»`
            : `Нужно для изображения игры «${normalizedEffective.games[current.id]?.title ?? current.id}»`;
        changed = addDependency(`/assets/${assetId}`, path, message) || changed;
      }

      if (current.map === "assets" && current.field === undefined && current.operation.operation === "set") {
        const targetAsset = normalizedEffective.assets[current.id];
        if (current.operation.baseExists && targetAsset?.kind === "image") {
          if (!selectedOwnerState) continue;
          const selectedAlt = deriveImageAssetAlt(selectedOwnerState, current.id);
          const selectedWinner = winningImageOwner(selectedOwnerState, current.id);
          const targetWinner = winningImageOwner(normalizedEffective, current.id);
          const directCoverOwnedAlt = selectedWinner?.role === "cover" && targetWinner?.role === "cover";
          if (selectedAlt === targetAsset.alt || directCoverOwnedAlt) continue;
          const selectedOwnerStateProgressed = canonicalStringify(derivedAltOwnerState(normalizedBase, current.id))
            !== canonicalStringify(derivedAltOwnerState(selectedOwnerState, current.id));
          if (explicitPaths.has(path) && !selectedOwnerStateProgressed) {
            throw new PatchSelectionError(changeId, `Derived global alt asset ${current.id} требует выбранного owner-изменения`);
          }
          const targetWinnerPath = ownerOperationPath(targetWinner, operationsByPath);
          const selectedWinnerPath = ownerOperationPath(selectedWinner, operationsByPath);
          const requiredOwnerPath = [targetWinnerPath, selectedWinnerPath]
            .find((candidate): candidate is string => candidate !== undefined && !selectedPaths.has(candidate));
          if (!requiredOwnerPath) {
            throw new PatchSelectionError(changeId, `Не найдено owner-изменение, объясняющее derived global alt asset ${current.id}`);
          }
          changed = addDependency(
            requiredOwnerPath,
            path,
            `Нужно выбрать winning owner для asset ${current.id}`,
          ) || changed;
          continue;
        }

        const alreadyReferenced = [...selectedPaths].some((selectedPath) => {
          if (selectedPath === path) return false;
          const selectedOperation = operationsByPath.get(selectedPath);
          return selectedOperation ? targetReferences(selectedOperation, normalizedEffective).has(current.id) : false;
        });
        if (alreadyReferenced) continue;
        for (const candidate of operations) {
          if (candidate.operation.transactionId !== current.operation.transactionId
            || !targetReferences(candidate, normalizedEffective).has(current.id)) continue;
          if (addDependency(candidate.path, path, `Нужно добавить ссылку на asset ${current.id}`)) {
            changed = true;
            break;
          }
        }
      }

      if (current.map === "assets" && current.field === undefined && current.operation.operation === "delete") {
        for (const candidate of operations) {
          if (!baseReferences(candidate, normalizedBase).has(current.id)
            || targetReferences(candidate, normalizedEffective).has(current.id)) continue;
          changed = addDependency(candidate.path, path, `Нужно удалить ссылку на asset ${current.id}`) || changed;
        }
      }

      for (const assetId of difference(baseReferences(current, normalizedBase), targetReferences(current, normalizedEffective))) {
        if (normalizedEffective.assets[assetId]) continue;
        const assetPath = `/assets/${assetId}`;
        const assetOperation = operationsByPath.get(assetPath);
        if (!assetOperation || assetOperation.operation.transactionId !== current.operation.transactionId) continue;
        changed = addDependency(assetPath, path, `Нужно удалить больше не используемый asset ${assetId}`) || changed;
      }
    }
  }

  const publishPatch = filterEnvelope(patch, (path) => selectedPaths.has(path));
  const deferredPatch = filterEnvelope(patch, (path) => !selectedPaths.has(path));
  const originatingChangeId = dependencyReasons[0]?.requiredByChangeId ?? fallbackChangeId;

  try {
    const selectedEffective = applyPatch(normalizedBase, publishPatch);
    assertValidLibrary(selectedEffective);
    const union = mergePatchEnvelopes(publishPatch, deferredPatch);
    if (canonicalStringify(applyPatch(normalizedBase, union)) !== canonicalStringify(normalizedEffective)) {
      throw new PatchSelectionError(originatingChangeId, "Выбранные зависимости не восстанавливают локальное состояние");
    }
  } catch (error) {
    if (error instanceof PatchSelectionError) throw error;
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new PatchSelectionError(originatingChangeId, `Выбранные зависимости не образуют допустимый патч${detail}`);
  }

  return {
    publishPatch,
    deferredPatch,
    selectedPaths: [...selectedPaths].sort(),
    explicitPaths: [...explicitPaths].sort(),
    dependencyReasons,
  };
}
