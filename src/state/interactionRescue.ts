import {
  PATCH_STORAGE_KEY,
  canonicalHash,
  canonicalStringify,
  classifyStorageUsage,
  entityPath,
  saveValidatedInteractionPatch,
  storageIncreaseAllowed,
  storedInteractionPatchRaw,
  validateInteractiveNoteField,
  validateInteractiveNoteOperationMetadata,
  webkitStorageBytes,
  webkitStringBytes,
  type InteractiveNoteFieldUpdate,
  type PatchEnvelope,
  type StorageUsage,
  type ValidatedInteractionPatchWriteResult,
} from "../domain";
import {
  LOCAL_LIBRARY_AUTHORITY_LOCK_NAME,
  PENDING_PUBLICATION_STORAGE_KEY,
  type PendingPublicationLockManager,
} from "./pendingPublication";

export const INTERACTION_RESCUE_STORAGE_KEY = "my-game-library.note-interaction-rescue.v1";

type InteractionRescueStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export type RescuedNoteInteraction = {
  noteId: string;
  field: "bodyMarkdown" | "collapsedChecklistSections";
  source: "patch" | "fallback";
  fallbackOperation: "set" | "delete" | null;
  fallbackValue?: string | string[];
  changedAt: string;
  transactionId: string;
};

interface InteractionRescueGeneration {
  ordinaryPatchHash: string;
  baseRevision: string;
  supersedingJournalHash: string | null;
  entries: RescuedNoteInteraction[];
}

interface InteractionRescueRecordV1 {
  version: 1;
  generations: InteractionRescueGeneration[];
}

export type ActiveInteractionRescueLoadResult =
  | { status: "absent" | "inactive" }
  | { status: "active"; entries: RescuedNoteInteraction[]; supersedingJournalHash: string | null }
  | { status: "corrupt" | "read_failure"; error: Error };

export type AdvanceInteractionRescueJournalWatermarkResult =
  | { status: "durable" | "absent" | "inactive" }
  | { status: "changed" | "failure"; error: Error };

export type PersistInteractionPatchResult = ValidatedInteractionPatchWriteResult
  | { status: "authority_changed"; currentJournalRaw: string | null; usage: StorageUsage };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function ordinaryPatchHash(raw: string | null): string {
  return canonicalHash({ ordinaryPatchRaw: raw });
}

export function pendingJournalRawHash(raw: string): string {
  return canonicalHash({ pendingPublicationJournalRaw: raw });
}

function parseEntry(value: unknown): RescuedNoteInteraction {
  if (!isObject(value)) throw new Error("Некорректная rescue-запись взаимодействия");
  const setFallback = value.source === "fallback" && value.fallbackOperation === "set";
  const expectedKeys = setFallback
    ? ["noteId", "field", "source", "fallbackOperation", "fallbackValue", "changedAt", "transactionId"]
    : ["noteId", "field", "source", "fallbackOperation", "changedAt", "transactionId"];
  if (!exactKeys(value, expectedKeys)) throw new Error("Некорректные поля rescue-записи взаимодействия");
  if (typeof value.noteId !== "string" || value.noteId.length === 0) throw new Error("Некорректный noteId rescue-записи");
  if (value.field !== "bodyMarkdown" && value.field !== "collapsedChecklistSections") throw new Error("Некорректное поле rescue-записи");
  if (value.source !== "patch" && value.source !== "fallback") throw new Error("Некорректный источник rescue-записи");
  if (value.source === "patch" && value.fallbackOperation !== null) throw new Error("Patch rescue-запись содержит fallback");
  if (value.source === "fallback" && value.fallbackOperation !== "set" && value.fallbackOperation !== "delete") {
    throw new Error("Некорректная fallback-операция rescue-записи");
  }
  if (typeof value.changedAt !== "string" || typeof value.transactionId !== "string") throw new Error("Некорректные метаданные rescue-записи");
  if (validateInteractiveNoteOperationMetadata(value.changedAt, value.transactionId).length) throw new Error("Некорректные метаданные rescue-записи");
  if (value.source === "fallback") {
    let fallbackValue: string | string[] | undefined;
    if (value.fallbackOperation === "set") {
      if (value.field === "bodyMarkdown") {
        if (typeof value.fallbackValue !== "string") throw new Error("Некорректное fallback-значение rescue-записи");
        fallbackValue = value.fallbackValue;
      } else {
        if (!Array.isArray(value.fallbackValue) || value.fallbackValue.some((item) => typeof item !== "string")) {
          throw new Error("Некорректное fallback-значение rescue-записи");
        }
        fallbackValue = value.fallbackValue as string[];
      }
    }
    if (validateInteractiveNoteField(value.field, fallbackValue).length) throw new Error("Некорректное fallback-значение rescue-записи");
  }
  return structuredClone(value) as unknown as RescuedNoteInteraction;
}

function parseRecord(raw: string): InteractionRescueRecordV1 {
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || !exactKeys(value, ["version", "generations"]) || value.version !== 1 || !Array.isArray(value.generations)) {
    throw new Error("Некорректный interaction rescue record");
  }
  const generations = value.generations.map((generation): InteractionRescueGeneration => {
    if (!isObject(generation) || !exactKeys(generation, ["ordinaryPatchHash", "baseRevision", "supersedingJournalHash", "entries"])) {
      throw new Error("Некорректное поколение interaction rescue");
    }
    if (typeof generation.ordinaryPatchHash !== "string" || !/^[0-9a-f]{64}$/.test(generation.ordinaryPatchHash)) {
      throw new Error("Некорректный hash interaction rescue");
    }
    if (typeof generation.baseRevision !== "string" || !/^[0-9a-f]{64}$/.test(generation.baseRevision)) {
      throw new Error("Некорректная base revision interaction rescue");
    }
    if (generation.supersedingJournalHash !== null && (
      typeof generation.supersedingJournalHash !== "string"
      || !/^[0-9a-f]{64}$/.test(generation.supersedingJournalHash)
    )) throw new Error("Некорректный journal watermark interaction rescue");
    if (!Array.isArray(generation.entries)) throw new Error("Некорректный список interaction rescue");
    const entries = generation.entries.map(parseEntry);
    const paths = entries.map((entry) => `${entry.noteId}/${entry.field}`);
    if (new Set(paths).size !== paths.length) throw new Error("Interaction rescue содержит повторяющееся поле");
    return {
      ordinaryPatchHash: generation.ordinaryPatchHash,
      baseRevision: generation.baseRevision,
      supersedingJournalHash: generation.supersedingJournalHash,
      entries,
    };
  });
  if (generations.length === 0) throw new Error("Interaction rescue не содержит поколений");
  const canonical: InteractionRescueRecordV1 = { version: 1, generations };
  if (raw !== canonicalStringify(canonical)) throw new Error("Interaction rescue имеет неканонические bytes");
  return canonical;
}

function activeGeneration(
  record: InteractionRescueRecordV1 | null,
  ordinaryRaw: string | null,
  baseRevision: string,
): InteractionRescueGeneration | null {
  const hash = ordinaryPatchHash(ordinaryRaw);
  if (!record) return null;
  for (let index = record.generations.length - 1; index >= 0; index -= 1) {
    if (record.generations[index].ordinaryPatchHash === hash && record.generations[index].baseRevision === baseRevision) {
      return record.generations[index];
    }
  }
  return null;
}

function rescueEntry(
  update: InteractiveNoteFieldUpdate,
  patch: PatchEnvelope,
  changedAt: string,
  transactionId: string,
): RescuedNoteInteraction {
  const rootOperation = patch.operations[entityPath("notes", update.noteId)];
  const fieldOperation = patch.operations[entityPath("notes", update.noteId, update.field)];
  if (rootOperation?.operation === "set" || fieldOperation !== undefined) {
    return {
      noteId: update.noteId,
      field: update.field,
      source: "patch",
      fallbackOperation: null,
      changedAt,
      transactionId,
    };
  }
  return {
    noteId: update.noteId,
    field: update.field,
    source: "fallback",
    fallbackOperation: update.value === undefined ? "delete" : "set",
    ...(update.value === undefined ? {} : { fallbackValue: structuredClone(update.value) }),
    changedAt,
    transactionId,
  };
}

function mergedEntries(
  previous: readonly RescuedNoteInteraction[],
  next: RescuedNoteInteraction,
): RescuedNoteInteraction[] {
  const key = `${next.noteId}/${next.field}`;
  return [
    ...previous.filter((entry) => `${entry.noteId}/${entry.field}` !== key),
    next,
  ].map((entry) => structuredClone(entry));
}

function productionLockManager(provided: PendingPublicationLockManager | null | undefined): PendingPublicationLockManager | null {
  if (provided !== undefined) return provided;
  try { return typeof navigator === "undefined" ? null : navigator.locks ?? null; }
  catch { return null; }
}

function currentUsage(storage: Pick<Storage, "length" | "key" | "getItem">): StorageUsage {
  try { return classifyStorageUsage(webkitStorageBytes(storage)); }
  catch { return classifyStorageUsage(0); }
}

function rescueFailure(storage: InteractionRescueStorage, message: string): PersistInteractionPatchResult {
  return { status: "failure", error: new Error(message), usage: currentUsage(storage) };
}

function persistInteractionPatchLocked(
  storage: InteractionRescueStorage,
  previousPatch: PatchEnvelope,
  nextPatch: PatchEnvelope,
  update: InteractiveNoteFieldUpdate,
  changedAt: string,
  transactionId: string,
): PersistInteractionPatchResult {
  const previousOrdinaryRaw = storedInteractionPatchRaw(previousPatch);
  const nextOrdinaryRaw = storedInteractionPatchRaw(nextPatch);
  let journalRaw: string | null;
  let previousRescueRaw: string | null;
  let previousRecord: InteractionRescueRecordV1 | null;
  let bytes: number;
  try {
    journalRaw = storage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
    if (journalRaw !== null) return { status: "authority_changed", currentJournalRaw: journalRaw, usage: currentUsage(storage) };
    const currentOrdinaryRaw = storage.getItem(PATCH_STORAGE_KEY);
    if (currentOrdinaryRaw !== previousOrdinaryRaw) {
      return { status: "changed", currentRaw: currentOrdinaryRaw, usage: currentUsage(storage) };
    }
    previousRescueRaw = storage.getItem(INTERACTION_RESCUE_STORAGE_KEY);
    previousRecord = previousRescueRaw === null ? null : parseRecord(previousRescueRaw);
    bytes = webkitStorageBytes(storage);
  } catch (reason) {
    return rescueFailure(storage, reason instanceof Error ? reason.message : "Safari не прочитал interaction rescue");
  }

  const previousGeneration = activeGeneration(previousRecord, previousOrdinaryRaw, previousPatch.baseRevision);
  const nextGeneration: InteractionRescueGeneration = {
    ordinaryPatchHash: ordinaryPatchHash(nextOrdinaryRaw),
    baseRevision: nextPatch.baseRevision,
    supersedingJournalHash: null,
    entries: mergedEntries(previousGeneration?.entries ?? [], rescueEntry(update, nextPatch, changedAt, transactionId)),
  };
  const stagedRecord: InteractionRescueRecordV1 = {
    version: 1,
    generations: previousGeneration === null || previousGeneration.ordinaryPatchHash === nextGeneration.ordinaryPatchHash
      ? [nextGeneration]
      : [structuredClone(previousGeneration), nextGeneration],
  };
  const stagedRaw = canonicalStringify(stagedRecord);
  const previousRescueBytes = previousRescueRaw === null ? 0 : webkitStringBytes(INTERACTION_RESCUE_STORAGE_KEY, previousRescueRaw);
  const projectedBytes = bytes - previousRescueBytes + webkitStringBytes(INTERACTION_RESCUE_STORAGE_KEY, stagedRaw);
  if (!storageIncreaseAllowed(bytes, projectedBytes)) {
    return { status: "failure", blocked: true, usage: classifyStorageUsage(projectedBytes), error: new Error("Локальное хранилище Safari заполнено на 95%") };
  }
  try {
    if (storage.getItem(PENDING_PUBLICATION_STORAGE_KEY) !== null) {
      return { status: "authority_changed", currentJournalRaw: storage.getItem(PENDING_PUBLICATION_STORAGE_KEY), usage: currentUsage(storage) };
    }
    if (storage.getItem(PATCH_STORAGE_KEY) !== previousOrdinaryRaw || storage.getItem(INTERACTION_RESCUE_STORAGE_KEY) !== previousRescueRaw) {
      return { status: "changed", currentRaw: storage.getItem(PATCH_STORAGE_KEY), usage: currentUsage(storage) };
    }
    storage.setItem(INTERACTION_RESCUE_STORAGE_KEY, stagedRaw);
    if (storage.getItem(INTERACTION_RESCUE_STORAGE_KEY) !== stagedRaw) return rescueFailure(storage, "Safari не подтвердил interaction rescue");
  } catch (reason) {
    return rescueFailure(storage, reason instanceof Error ? reason.message : "Safari не сохранил interaction rescue");
  }

  const written = saveValidatedInteractionPatch(storage, previousPatch, nextPatch);
  if (written.status !== "durable") return written;

  const compactRaw = canonicalStringify({ version: 1, generations: [nextGeneration] } satisfies InteractionRescueRecordV1);
  if (compactRaw !== stagedRaw) try {
    if (storage.getItem(INTERACTION_RESCUE_STORAGE_KEY) === stagedRaw) {
      storage.setItem(INTERACTION_RESCUE_STORAGE_KEY, compactRaw);
      storage.getItem(INTERACTION_RESCUE_STORAGE_KEY);
    }
  } catch { /* The staged record already protects both the previous and next durable patch. */ }
  return written;
}

export async function persistInteractionPatchWithRescue(
  storage: InteractionRescueStorage,
  previousPatch: PatchEnvelope,
  nextPatch: PatchEnvelope,
  update: InteractiveNoteFieldUpdate,
  changedAt: string,
  transactionId: string,
  options: { lockManager?: PendingPublicationLockManager | null } = {},
): Promise<PersistInteractionPatchResult> {
  const lockManager = productionLockManager(options.lockManager);
  if (lockManager === null) return persistInteractionPatchLocked(storage, previousPatch, nextPatch, update, changedAt, transactionId);
  try {
    return await lockManager.request(LOCAL_LIBRARY_AUTHORITY_LOCK_NAME, { mode: "exclusive" }, () => (
      persistInteractionPatchLocked(storage, previousPatch, nextPatch, update, changedAt, transactionId)
    ));
  } catch {
    return rescueFailure(storage, "Safari не предоставил Web Lock локального состояния");
  }
}

export function loadActiveInteractionRescue(
  storage: Pick<Storage, "getItem">,
  ordinaryRaw: string | null,
  baseRevision: string,
): ActiveInteractionRescueLoadResult {
  let raw: string | null;
  try { raw = storage.getItem(INTERACTION_RESCUE_STORAGE_KEY); }
  catch { return { status: "read_failure", error: new Error("Safari не прочитал interaction rescue") }; }
  if (raw === null) return { status: "absent" };
  let record: InteractionRescueRecordV1;
  try { record = parseRecord(raw); }
  catch { return { status: "corrupt", error: new Error("Interaction rescue повреждён") }; }
  const generation = activeGeneration(record, ordinaryRaw, baseRevision);
  return generation === null
    ? { status: "inactive" }
    : {
      status: "active",
      entries: generation.entries.map((entry) => structuredClone(entry)),
      supersedingJournalHash: generation.supersedingJournalHash,
    };
}

/** Caller must hold LOCAL_LIBRARY_AUTHORITY_LOCK_NAME while replacing the journal. */
export function advanceInteractionRescueJournalWatermarkLocked(
  storage: InteractionRescueStorage,
  ordinaryRaw: string | null,
  baseRevision: string,
  previousJournalRaw: string | null,
  nextJournalRaw: string,
): AdvanceInteractionRescueJournalWatermarkResult {
      let raw: string | null;
      let record: InteractionRescueRecordV1;
      let currentBytes: number;
      try {
        if (storage.getItem(PENDING_PUBLICATION_STORAGE_KEY) !== previousJournalRaw) {
          return { status: "changed", error: new Error("Journal изменился до записи rescue watermark") };
        }
        raw = storage.getItem(INTERACTION_RESCUE_STORAGE_KEY);
        if (raw === null) return { status: "absent" };
        record = parseRecord(raw);
        currentBytes = webkitStorageBytes(storage);
      } catch {
        return { status: "failure", error: new Error("Safari не прочитал interaction rescue watermark") };
      }
      const generation = activeGeneration(record, ordinaryRaw, baseRevision);
      if (generation === null) return { status: "inactive" };
      const previousHash = previousJournalRaw === null ? null : pendingJournalRawHash(previousJournalRaw);
      const nextHash = pendingJournalRawHash(nextJournalRaw);
      if (generation.supersedingJournalHash === nextHash) return { status: "durable" };
      if (generation.supersedingJournalHash !== previousHash) {
        return { status: "changed", error: new Error("Interaction rescue watermark изменился") };
      }
      const nextRecord: InteractionRescueRecordV1 = {
        version: 1,
        generations: record.generations.map((candidate) => (
          candidate.ordinaryPatchHash === generation.ordinaryPatchHash
          && candidate.baseRevision === generation.baseRevision
            ? { ...candidate, supersedingJournalHash: nextHash }
            : structuredClone(candidate)
        )),
      };
      const nextRaw = canonicalStringify(nextRecord);
      const projectedBytes = currentBytes
        - webkitStringBytes(INTERACTION_RESCUE_STORAGE_KEY, raw)
        + webkitStringBytes(INTERACTION_RESCUE_STORAGE_KEY, nextRaw);
      if (!storageIncreaseAllowed(currentBytes, projectedBytes)) {
        return { status: "failure", error: new Error("Interaction rescue watermark не помещается в безопасный бюджет Safari") };
      }
      try {
        if (
          storage.getItem(PENDING_PUBLICATION_STORAGE_KEY) !== previousJournalRaw
          || storage.getItem(INTERACTION_RESCUE_STORAGE_KEY) !== raw
        ) return { status: "changed", error: new Error("Authority изменилась до записи rescue watermark") };
        storage.setItem(INTERACTION_RESCUE_STORAGE_KEY, nextRaw);
        if (storage.getItem(INTERACTION_RESCUE_STORAGE_KEY) !== nextRaw) {
          return { status: "failure", error: new Error("Safari не подтвердил interaction rescue watermark") };
        }
        return { status: "durable" };
      } catch {
        return { status: "failure", error: new Error("Safari не сохранил interaction rescue watermark") };
      }
}

export function resolveRescuedNoteInteraction(
  entry: RescuedNoteInteraction,
  ordinaryPatch: PatchEnvelope | null,
): InteractiveNoteFieldUpdate | null {
  if (entry.source === "fallback") {
    return entry.field === "bodyMarkdown"
      ? { noteId: entry.noteId, field: entry.field, value: String(entry.fallbackValue ?? "") }
      : {
        noteId: entry.noteId,
        field: entry.field,
        value: entry.fallbackOperation === "delete" ? undefined : structuredClone(entry.fallbackValue as string[]),
      };
  }
  if (!ordinaryPatch) return null;
  const root = ordinaryPatch.operations[entityPath("notes", entry.noteId)];
  if (root?.operation === "set" && isObject(root.value)) {
    const value = root.value[entry.field];
    return entry.field === "bodyMarkdown"
      ? typeof value === "string" ? { noteId: entry.noteId, field: entry.field, value } : null
      : { noteId: entry.noteId, field: entry.field, value: value === undefined ? undefined : structuredClone(value as string[]) };
  }
  const operation = ordinaryPatch.operations[entityPath("notes", entry.noteId, entry.field)];
  if (!operation) return null;
  if (entry.field === "bodyMarkdown") {
    return operation.operation === "set" && typeof operation.value === "string"
      ? { noteId: entry.noteId, field: entry.field, value: operation.value }
      : null;
  }
  return {
    noteId: entry.noteId,
    field: entry.field,
    value: operation.operation === "delete" ? undefined : structuredClone(operation.value as string[]),
  };
}
