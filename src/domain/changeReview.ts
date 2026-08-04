import { referencedAssetIds } from "./assetReferences";
import {
  createMarkdownDiff,
  deriveMarkdownTitle,
  summarizeMarkdownDiff,
  type MarkdownDiffModel,
} from "./markdownDiff";
import type {
  Asset,
  Game,
  LibraryDatabase,
  Note,
  PatchEnvelope,
  PatchOperation,
  StatusId,
  TierId,
} from "./types";
import { parsePatchPath, type EntityMapName } from "./validation";

export type ChangeKind = "added" | "changed" | "deleted" | "moved" | "asset";

export type ChangeEvidence =
  | { type: "scalar"; before: string; after: string }
  | { type: "chips"; added: string[]; removed: string[] }
  | { type: "move"; before: string; after: string }
  | { type: "markdown"; before: string; after: string; diff: MarkdownDiffModel }
  | { type: "asset"; assetId: string; originalName: string; mime: string; byteLength: number; width?: number; height?: number };

export interface ReviewChange {
  id: string;
  selectionId: string;
  entity: { map: "games" | "notes" | "assets"; id: string };
  kind: ChangeKind;
  title: string;
  summary: string;
  changedAt: string;
  operationPaths: string[];
  gameIds: string[];
  evidence: ChangeEvidence[];
}

export interface GameChangeGroup {
  id: string;
  gameId: string | null;
  title: string;
  coverAssetId: string | null;
  newestChangedAt: string;
  changes: ReviewChange[];
}

export interface ChangeReviewModel {
  groups: GameChangeGroup[];
  changesById: Record<string, ReviewChange>;
  changesBySelectionId: Record<string, ReviewChange[]>;
  uniqueSelectionIds: string[];
}

interface ParsedOperation {
  path: string;
  operation: PatchOperation;
  map: EntityMapName;
  id: string;
  field?: string;
}

interface SemanticUnit {
  key: string;
  transactionId: string;
  map: EntityMapName;
  entityId: string;
  operations: ParsedOperation[];
  foldedAssets: SemanticUnit[];
  gameIds: string[];
  ordering: boolean;
  selectionId: string;
}

const STATUS_LABELS: Record<StatusId, string> = {
  wishlist: "Хочу поиграть",
  playing: "Играю",
  played: "Играл",
  completed: "Пройдено",
  platinum: "Платина",
  dropped: "Брошено",
};

const TIER_LABELS: Record<TierId, string> = {
  s: "S",
  a: "A",
  b: "B",
  c: "C",
  d: "D",
  f: "F",
  unranked: "Без оценки",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Название",
  coverAssetId: "Обложка",
  platforms: "Платформы",
  tags: "Теги",
  status: "Статус",
  placement: "Место в тирлисте",
  reviewMarkdown: "Отзыв",
  bodyMarkdown: "Текст заметки",
  attachments: "Вложения",
  collapsedChecklistSections: "Свёрнутые разделы",
  doubleHeight: "Высота заметки",
  doubleWidth: "Ширина заметки",
  groupRank: "Группа заметки",
  rank: "Порядок",
};

const FIELD_ORDER = [
  "title",
  "bodyMarkdown",
  "reviewMarkdown",
  "placement",
  "rank",
  "groupRank",
  "platforms",
  "tags",
  "status",
  "coverAssetId",
  "attachments",
  "collapsedChecklistSections",
  "doubleHeight",
  "doubleWidth",
];

const MAP_ORDER: Record<EntityMapName, number> = { games: 0, notes: 1, assets: 2 };

function compareRussian(left: string, right: string): number {
  return left.localeCompare(right, "ru");
}

function entity(database: LibraryDatabase, map: EntityMapName, id: string): Game | Note | Asset | undefined {
  return database[map][id] as Game | Note | Asset | undefined;
}

function operationFields(unit: SemanticUnit): string[] {
  if (unit.operations.some((item) => item.field === undefined)) {
    if (unit.map === "games") return ["title", "platforms", "tags", "status", "placement", "reviewMarkdown", "coverAssetId"];
    if (unit.map === "notes") return ["bodyMarkdown", "attachments", "groupRank", "rank", "collapsedChecklistSections", "doubleHeight", "doubleWidth"];
    return [];
  }
  return [...new Set(unit.operations.map((item) => item.field).filter((field): field is string => Boolean(field)))]
    .sort((left, right) => {
      const leftIndex = FIELD_ORDER.indexOf(left);
      const rightIndex = FIELD_ORDER.indexOf(right);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex) || left.localeCompare(right);
    });
}

function referencedAssets(value: Game | Note | Asset | undefined): Set<string> {
  const result = new Set<string>();
  if (!value) return result;
  if ("coverAssetId" in value && value.coverAssetId) result.add(value.coverAssetId);
  if ("attachments" in value) {
    for (const attachment of value.attachments) {
      if (attachment.type !== "link") result.add(attachment.assetId);
    }
  }
  return result;
}

function buildAssetGameIndex(database: LibraryDatabase): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const referenced = referencedAssetIds(database);
  const add = (assetId: string, gameId: string): void => {
    if (!referenced.has(assetId)) return;
    const gameIds = index.get(assetId) ?? new Set<string>();
    gameIds.add(gameId);
    index.set(assetId, gameIds);
  };
  for (const game of Object.values(database.games)) {
    if (game.coverAssetId) add(game.coverAssetId, game.id);
  }
  for (const note of Object.values(database.notes)) {
    for (const attachment of note.attachments) {
      if (attachment.type !== "link") add(attachment.assetId, note.gameId);
    }
  }
  return index;
}

function ownershipForUnit(
  unit: SemanticUnit,
  base: LibraryDatabase,
  effective: LibraryDatabase,
  baseAssetOwners: Map<string, Set<string>>,
  effectiveAssetOwners: Map<string, Set<string>>,
): string[] {
  if (unit.map === "games") return effective.games[unit.entityId] || base.games[unit.entityId] ? [unit.entityId] : [];
  if (unit.map === "notes") {
    const note = effective.notes[unit.entityId] ?? base.notes[unit.entityId];
    return note ? [note.gameId] : [];
  }
  const effectiveOwners = effectiveAssetOwners.get(unit.entityId);
  const owners = effectiveOwners?.size ? effectiveOwners : baseAssetOwners.get(unit.entityId);
  return owners ? [...owners].sort() : [];
}

function parseOperations(patch: PatchEnvelope): ParsedOperation[] {
  const parsed: ParsedOperation[] = [];
  for (const path of Object.keys(patch.operations).sort()) {
    const location = parsePatchPath(path);
    if (!location) continue;
    parsed.push({ path, operation: patch.operations[path], ...location });
  }
  return parsed;
}

function makeUnits(operations: ParsedOperation[]): SemanticUnit[] {
  const units = new Map<string, SemanticUnit>();
  for (const item of operations) {
    const transactionId = item.operation.transactionId?.trim() ?? "";
    const transactionKey = transactionId || "legacy";
    const key = `${transactionKey}\u0000${item.map}\u0000${item.id}`;
    let unit = units.get(key);
    if (!unit) {
      unit = {
        key,
        transactionId,
        map: item.map,
        entityId: item.id,
        operations: [],
        foldedAssets: [],
        gameIds: [],
        ordering: false,
        selectionId: "",
      };
      units.set(key, unit);
    }
    unit.operations.push(item);
  }
  return [...units.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function foldAssets(units: SemanticUnit[], base: LibraryDatabase, effective: LibraryDatabase): SemanticUnit[] {
  const folded = new Set<string>();
  for (const assetUnit of units.filter((unit) => unit.map === "assets")) {
    const owners = units.filter((candidate) => {
      if (candidate.map === "assets" || candidate.transactionId !== assetUnit.transactionId) return false;
      const before = entity(base, candidate.map, candidate.entityId);
      const after = entity(effective, candidate.map, candidate.entityId);
      return referencedAssets(before).has(assetUnit.entityId) || referencedAssets(after).has(assetUnit.entityId);
    });
    if (owners.length !== 1) continue;
    owners[0].foldedAssets.push(assetUnit);
    folded.add(assetUnit.key);
  }
  return units.filter((unit) => !folded.has(unit.key));
}

function assignSelectionIds(units: SemanticUnit[]): void {
  const byTransaction = new Map<string, SemanticUnit[]>();
  for (const unit of units) {
    unit.ordering = unit.operations.some((item) => ["placement", "rank", "groupRank"].includes(item.field ?? ""));
    if (!unit.transactionId || !unit.ordering) continue;
    const transactionUnits = byTransaction.get(unit.transactionId) ?? [];
    transactionUnits.push(unit);
    byTransaction.set(unit.transactionId, transactionUnits);
  }
  const crossGameTransactions = new Set<string>();
  for (const [transactionId, transactionUnits] of byTransaction) {
    const gameIds = new Set(transactionUnits.flatMap((unit) => unit.gameIds));
    if (gameIds.size > 1) crossGameTransactions.add(transactionId);
  }
  for (const unit of units) {
    if (unit.ordering && crossGameTransactions.has(unit.transactionId)) {
      unit.selectionId = `tx:${unit.transactionId}`;
    } else if (unit.transactionId) {
      unit.selectionId = `tx:${unit.transactionId}:${unit.map}:${unit.entityId}`;
    } else {
      unit.selectionId = `path:${unit.operations.map((item) => item.path).sort().join("|")}`;
    }
  }
}

function displayScalar(field: string, value: unknown, database: LibraryDatabase): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "status" && typeof value === "string" && value in STATUS_LABELS) return STATUS_LABELS[value as StatusId];
  if (field === "coverAssetId" && typeof value === "string") return database.assets[value]?.originalName ?? value;
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function scalarEvidence(label: string, before: unknown, after: unknown, base: LibraryDatabase, effective: LibraryDatabase): ChangeEvidence {
  return {
    type: "scalar",
    before: displayScalar(label, before, base),
    after: displayScalar(label, after, effective),
  };
}

function placementLabel(database: LibraryDatabase, gameId: string): string {
  const placement = database.games[gameId]?.placement;
  return placement ? `${TIER_LABELS[placement.tierId]} · позиция ${placement.rank}` : "—";
}

function noteOrderLabel(database: LibraryDatabase, noteId: string, field: string): string {
  const note = database.notes[noteId];
  if (!note) return "—";
  const value = field === "groupRank" ? note.groupRank : note.rank;
  return value === undefined ? "Без группы" : `позиция ${value}`;
}

function stringChips(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function attachmentChips(value: unknown, database: LibraryDatabase): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return String(item);
    const attachment = item as Record<string, unknown>;
    if (attachment.type === "link") return String(attachment.label ?? attachment.url ?? "Ссылка");
    const assetId = String(attachment.assetId ?? "");
    return String(attachment.label ?? attachment.alt ?? database.assets[assetId]?.originalName ?? assetId);
  });
}

function chipEvidence(before: string[], after: string[]): ChangeEvidence {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    type: "chips",
    added: after.filter((item) => !beforeSet.has(item)),
    removed: before.filter((item) => !afterSet.has(item)),
  };
}

function assetEvidence(assetId: string, base: LibraryDatabase, effective: LibraryDatabase): ChangeEvidence | null {
  const asset = effective.assets[assetId] ?? base.assets[assetId];
  if (!asset) return null;
  return {
    type: "asset",
    assetId,
    originalName: asset.originalName,
    mime: asset.mime,
    byteLength: asset.byteLength,
    ...(asset.kind === "image" ? { width: asset.width, height: asset.height } : {}),
  };
}

function markdownEvidence(before: unknown, after: unknown): ChangeEvidence {
  const beforeText = typeof before === "string" ? before : "";
  const afterText = typeof after === "string" ? after : "";
  return { type: "markdown", before: beforeText, after: afterText, diff: createMarkdownDiff(beforeText, afterText) };
}

function evidenceForUnit(unit: SemanticUnit, base: LibraryDatabase, effective: LibraryDatabase): ChangeEvidence[] {
  if (unit.map === "assets") {
    const evidence = assetEvidence(unit.entityId, base, effective);
    return evidence ? [evidence] : [];
  }
  const beforeEntity = entity(base, unit.map, unit.entityId);
  const afterEntity = entity(effective, unit.map, unit.entityId);
  const result: ChangeEvidence[] = [];
  for (const field of operationFields(unit)) {
    const before = beforeEntity ? (beforeEntity as unknown as Record<string, unknown>)[field] : undefined;
    const after = afterEntity ? (afterEntity as unknown as Record<string, unknown>)[field] : undefined;
    if (field === "bodyMarkdown" || field === "reviewMarkdown") {
      result.push(markdownEvidence(before, after));
    } else if (field === "platforms" || field === "tags" || field === "collapsedChecklistSections") {
      result.push(chipEvidence(stringChips(before), stringChips(after)));
    } else if (field === "attachments") {
      result.push(chipEvidence(attachmentChips(before, base), attachmentChips(after, effective)));
    } else if (field === "placement" && unit.map === "games") {
      result.push({ type: "move", before: placementLabel(base, unit.entityId), after: placementLabel(effective, unit.entityId) });
    } else if ((field === "rank" || field === "groupRank") && unit.map === "notes") {
      result.push({ type: "move", before: noteOrderLabel(base, unit.entityId, field), after: noteOrderLabel(effective, unit.entityId, field) });
    } else {
      result.push(scalarEvidence(field, before, after, base, effective));
    }
  }
  for (const foldedAsset of unit.foldedAssets.sort((left, right) => left.entityId.localeCompare(right.entityId))) {
    const evidence = assetEvidence(foldedAsset.entityId, base, effective);
    if (evidence) result.push(evidence);
  }
  return result;
}

function createdNoteSummary(title: string): string {
  return `Создана заметка «${title}»`;
}

function deletedNoteSummary(title: string): string {
  return `Удалена заметка «${title}»`;
}

function unitKind(unit: SemanticUnit, base: LibraryDatabase, effective: LibraryDatabase): ChangeKind {
  if (unit.map === "assets") return "asset";
  const before = entity(base, unit.map, unit.entityId);
  const after = entity(effective, unit.map, unit.entityId);
  if (!before && after) return "added";
  if (before && !after) return "deleted";
  if (unit.ordering) return "moved";
  return "changed";
}

function unitTitle(unit: SemanticUnit, base: LibraryDatabase, effective: LibraryDatabase): string {
  if (unit.map === "games") return effective.games[unit.entityId]?.title ?? base.games[unit.entityId]?.title ?? "Игра без названия";
  if (unit.map === "notes") {
    const markdown = effective.notes[unit.entityId]?.bodyMarkdown ?? base.notes[unit.entityId]?.bodyMarkdown ?? "";
    return deriveMarkdownTitle(markdown);
  }
  return effective.assets[unit.entityId]?.originalName ?? base.assets[unit.entityId]?.originalName ?? "Файл без имени";
}

function compactSecondary(evidence: ChangeEvidence): string | null {
  if (evidence.type === "chips") {
    const parts = [
      evidence.added.length ? `+${evidence.added.slice(0, 2).join(", ")}` : "",
      evidence.removed.length ? `−${evidence.removed.slice(0, 2).join(", ")}` : "",
    ].filter(Boolean);
    return parts.join("; ") || null;
  }
  if (evidence.type === "scalar") return `${evidence.before} → ${evidence.after}`;
  if (evidence.type === "asset") return evidence.originalName;
  return null;
}

function unitSummary(
  unit: SemanticUnit,
  kind: ChangeKind,
  title: string,
  evidence: ChangeEvidence[],
  base: LibraryDatabase,
  effective: LibraryDatabase,
): string {
  if (unit.map === "notes" && kind === "added") return createdNoteSummary(title);
  if (unit.map === "notes" && kind === "deleted") return deletedNoteSummary(title);
  if (unit.map === "games" && kind === "added") return `Добавлена игра «${title}»`;
  if (unit.map === "games" && kind === "deleted") return `Удалена игра «${title}»`;
  if (unit.map === "assets") {
    if (!base.assets[unit.entityId] && effective.assets[unit.entityId]) return `Добавлен файл «${title}»`;
    if (base.assets[unit.entityId] && !effective.assets[unit.entityId]) return `Удалён файл «${title}»`;
    return `Изменён файл «${title}»`;
  }
  const move = evidence.find((item): item is Extract<ChangeEvidence, { type: "move" }> => item.type === "move");
  if (move) return `Перемещено: ${move.before} → ${move.after}`;
  const markdown = evidence.find((item): item is Extract<ChangeEvidence, { type: "markdown" }> => item.type === "markdown");
  if (markdown) return summarizeMarkdownDiff(markdown.diff);
  const first = evidence[0];
  if (!first) return `Изменено «${title}»`;
  const detail = compactSecondary(first);
  const field = operationFields(unit)[0];
  return detail ? `${FIELD_LABELS[field] ?? "Изменение"}: ${detail}` : `Изменено «${title}»`;
}

function allOperationPaths(unit: SemanticUnit): string[] {
  return [
    ...unit.operations.map((item) => item.path),
    ...unit.foldedAssets.flatMap((asset) => asset.operations.map((item) => item.path)),
  ].sort();
}

function latestChangedAt(unit: SemanticUnit): string {
  return [
    ...unit.operations.map((item) => item.operation.changedAt),
    ...unit.foldedAssets.flatMap((asset) => asset.operations.map((item) => item.operation.changedAt)),
  ].sort().at(-1) ?? "";
}

function makeOccurrence(
  unit: SemanticUnit,
  gameId: string | null,
  base: LibraryDatabase,
  effective: LibraryDatabase,
): ReviewChange {
  const evidence = evidenceForUnit(unit, base, effective);
  const kind = unitKind(unit, base, effective);
  const title = unitTitle(unit, base, effective);
  return {
    id: `${unit.selectionId}:row:${unit.map}:${unit.entityId}:game:${gameId ?? "orphan"}`,
    selectionId: unit.selectionId,
    entity: { map: unit.map, id: unit.entityId },
    kind,
    title,
    summary: unitSummary(unit, kind, title, evidence, base, effective),
    changedAt: latestChangedAt(unit),
    operationPaths: allOperationPaths(unit),
    gameIds: [...unit.gameIds],
    evidence,
  };
}

function compareRows(left: ReviewChange, right: ReviewChange): number {
  return right.changedAt.localeCompare(left.changedAt)
    || MAP_ORDER[left.entity.map] - MAP_ORDER[right.entity.map]
    || compareRussian(left.title, right.title)
    || left.entity.id.localeCompare(right.entity.id)
    || left.id.localeCompare(right.id);
}

export function buildChangeReview(
  base: LibraryDatabase,
  effective: LibraryDatabase,
  patch: PatchEnvelope,
): ChangeReviewModel {
  const baseAssetOwners = buildAssetGameIndex(base);
  const effectiveAssetOwners = buildAssetGameIndex(effective);
  let units = makeUnits(parseOperations(patch));
  units = foldAssets(units, base, effective);
  for (const unit of units) {
    unit.gameIds = ownershipForUnit(unit, base, effective, baseAssetOwners, effectiveAssetOwners);
  }
  assignSelectionIds(units);

  const grouped = new Map<string | null, ReviewChange[]>();
  for (const unit of units) {
    const ownerIds: (string | null)[] = unit.gameIds.length ? unit.gameIds : [null];
    for (const gameId of ownerIds) {
      const changes = grouped.get(gameId) ?? [];
      changes.push(makeOccurrence(unit, gameId, base, effective));
      grouped.set(gameId, changes);
    }
  }

  const groups: GameChangeGroup[] = [...grouped.entries()].map(([gameId, changes]) => {
    changes.sort(compareRows);
    const game = gameId ? effective.games[gameId] ?? base.games[gameId] : undefined;
    return {
      id: gameId ? `game:${gameId}` : "orphan",
      gameId,
      title: game?.title ?? "Без привязки к игре",
      coverAssetId: game?.coverAssetId ?? null,
      newestChangedAt: changes[0]?.changedAt ?? "",
      changes,
    };
  }).sort((left, right) =>
    right.newestChangedAt.localeCompare(left.newestChangedAt)
      || compareRussian(left.title, right.title)
      || (left.gameId ?? "").localeCompare(right.gameId ?? ""),
  );

  const changesById: Record<string, ReviewChange> = {};
  const changesBySelectionId: Record<string, ReviewChange[]> = {};
  const uniqueSelectionIds: string[] = [];
  for (const change of groups.flatMap((group) => group.changes)) {
    changesById[change.id] = change;
    if (!changesBySelectionId[change.selectionId]) {
      changesBySelectionId[change.selectionId] = [];
      uniqueSelectionIds.push(change.selectionId);
    }
    changesBySelectionId[change.selectionId].push(change);
  }

  return { groups, changesById, changesBySelectionId, uniqueSelectionIds };
}
