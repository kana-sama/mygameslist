export interface ChecklistSearchHistoryRecord {
  gameId: string;
  itemId: string;
  noteId: string;
  touchedAt: number;
}

export interface ChecklistSearchHistoryStore {
  list(gameId: string, validItemIds: ReadonlySet<string>): readonly ChecklistSearchHistoryRecord[];
  record(record: ChecklistSearchHistoryRecord): void;
}

const STORAGE_KEY = "mygameslist:checklist-search-history:v1";
const VERSION = 1;
const MAX_PER_GAME = 8;
const MAX_RECORDS = 24;
const MAX_SERIALIZED_BYTES = 8 * 1024;

type HistoryEnvelope = {
  version: typeof VERSION;
  records: ChecklistSearchHistoryRecord[];
};

function isRecord(value: unknown): value is ChecklistSearchHistoryRecord {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 4
    && typeof candidate.gameId === "string"
    && typeof candidate.itemId === "string"
    && typeof candidate.noteId === "string"
    && typeof candidate.touchedAt === "number"
    && Number.isFinite(candidate.touchedAt);
}

function parseEnvelope(serialized: string | null): ChecklistSearchHistoryRecord[] {
  if (serialized === null) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed === null || typeof parsed !== "object") return [];
    const envelope = parsed as Record<string, unknown>;
    if (Object.keys(envelope).length !== 2 || envelope.version !== VERSION || !Array.isArray(envelope.records)) return [];
    if (!envelope.records.every(isRecord)) return [];
    return envelope.records.map((record) => ({ ...record }));
  } catch {
    return [];
  }
}

function envelopeFor(records: readonly ChecklistSearchHistoryRecord[]): HistoryEnvelope {
  return { version: VERSION, records: records.map((record) => ({ ...record })) };
}

function serializedBytes(records: readonly ChecklistSearchHistoryRecord[]): number {
  return new TextEncoder().encode(JSON.stringify(envelopeFor(records))).byteLength;
}

function bounded(records: readonly ChecklistSearchHistoryRecord[]): ChecklistSearchHistoryRecord[] {
  const newestFirst = records
    .map((record, index) => ({ index, record }))
    .sort((left, right) => right.record.touchedAt - left.record.touchedAt || left.index - right.index)
    .map(({ record }) => record);
  const unique: ChecklistSearchHistoryRecord[] = [];
  const identities = new Set<string>();
  const perGame = new Map<string, number>();

  for (const record of newestFirst) {
    const identity = JSON.stringify([record.gameId, record.itemId]);
    const count = perGame.get(record.gameId) ?? 0;
    if (identities.has(identity) || count >= MAX_PER_GAME || unique.length >= MAX_RECORDS) continue;
    identities.add(identity);
    perGame.set(record.gameId, count + 1);
    unique.push({ ...record });
  }

  while (unique.length > 0 && serializedBytes(unique) > MAX_SERIALIZED_BYTES) unique.pop();
  return unique;
}

function sameRecords(
  left: readonly ChecklistSearchHistoryRecord[],
  right: readonly ChecklistSearchHistoryRecord[],
): boolean {
  return left.length === right.length && left.every((record, index) => {
    const other = right[index];
    return record.gameId === other.gameId
      && record.itemId === other.itemId
      && record.noteId === other.noteId
      && record.touchedAt === other.touchedAt;
  });
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createChecklistSearchHistoryStore(storage?: Storage | null): ChecklistSearchHistoryStore {
  const target = storage ?? defaultStorage();
  let records: ChecklistSearchHistoryRecord[];
  let loaded: ChecklistSearchHistoryRecord[] = [];
  try {
    loaded = parseEnvelope(target?.getItem(STORAGE_KEY) ?? null);
    records = bounded(loaded);
  } catch {
    records = [];
  }

  const persist = () => {
    try {
      target?.setItem(STORAGE_KEY, JSON.stringify(envelopeFor(records)));
    } catch {
      // Persistence is optional; this store remains usable for the page session.
    }
  };

  if (!sameRecords(records, loaded)) persist();

  return {
    list(gameId, validItemIds) {
      try {
        const next = records.filter((record) => record.gameId !== gameId || validItemIds.has(record.itemId));
        if (next.length !== records.length) {
          records = next;
          persist();
        }
        return records
          .filter((record) => record.gameId === gameId && validItemIds.has(record.itemId))
          .map((record) => ({ ...record }));
      } catch {
        return [];
      }
    },
    record(record) {
      try {
        if (!isRecord(record)) return;
        records = bounded([
          { ...record },
          ...records.filter((existing) => existing.gameId !== record.gameId || existing.itemId !== record.itemId),
        ]);
        persist();
      } catch {
        // Invalid runtime input or unavailable browser APIs cannot disrupt saves.
      }
    },
  };
}
