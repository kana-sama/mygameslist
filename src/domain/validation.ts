import { MAX_WEBP_DIMENSION, base64ToBytes, isCanonicalBase64 } from "./assets";
import { LIBRARY_SCHEMA_VERSION, STATUS_IDS, TIER_IDS, type Asset, type LibraryDatabase, type PatchEnvelope } from "./types";
import { computeLibraryRevision, MISSING_VALUE_HASH, sha256Bytes } from "./canonical";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  issues: ValidationIssue[];
}

const ENTITY_MAPS = ["games", "notes", "assets"] as const;
export type EntityMapName = (typeof ENTITY_MAPS)[number];

export const ENTITY_FIELDS: Record<EntityMapName, readonly string[]> = {
  games: ["id", "title", "coverAssetId", "platforms", "tags", "status", "placement", "reviewMarkdown", "createdAt", "updatedAt"],
  notes: ["id", "gameId", "bodyMarkdown", "attachments", "groupRank", "rank", "createdAt", "updatedAt"],
  assets: ["id", "kind", "mime", "width", "height", "byteLength", "alt", "originalName"],
};

export const LOCALLY_PATCHABLE_FIELDS: Record<EntityMapName, readonly string[]> = {
  games: ["title", "coverAssetId", "platforms", "tags", "status", "placement", "reviewMarkdown"],
  notes: ["bodyMarkdown", "attachments", "groupRank", "rank"],
  assets: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, issues: ValidationIssue[], optionalKeys: readonly string[] = []): void {
  const expected = new Set([...keys, ...optionalKeys]);
  for (const key of Object.keys(value)) if (!expected.has(key)) issue(issues, `${path}/${key}`, "Неизвестное поле");
  for (const key of keys) if (!(key in value)) issue(issues, `${path}/${key}`, "Обязательное поле отсутствует");
}

function string(value: unknown, path: string, issues: ValidationIssue[], allowEmpty = true, maxLength = Number.POSITIVE_INFINITY): value is string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    issue(issues, path, allowEmpty ? "Ожидалась строка" : "Ожидалась непустая строка");
    return false;
  }
  if (value.length > maxLength) { issue(issues, path, `Строка длиннее ${maxLength} символов`); return false; }
  return true;
}

function uuid(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (!string(value, path, issues, false)) return false;
  if (!UUID.test(value)) { issue(issues, path, "Ожидался UUID"); return false; }
  return true;
}

function isoDate(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (!string(value, path, issues)) return false;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) { issue(issues, path, "Ожидалась дата ISO 8601 в UTC"); return false; }
  return true;
}

function rank(value: unknown, path: string, issues: ValidationIssue[]): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issue(issues, path, "Ранг должен быть неотрицательным безопасным целым числом");
    return false;
  }
  return true;
}

function stringList(value: unknown, path: string, issues: ValidationIssue[]): value is string[] {
  if (!Array.isArray(value)) { issue(issues, path, "Ожидался массив строк"); return false; }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!string(item, `${path}/${index}`, issues, false, 200)) return;
    const normalized = item.trim().toLocaleLowerCase("ru");
    if (seen.has(normalized)) issue(issues, `${path}/${index}`, "Повторяющееся значение");
    seen.add(normalized);
  });
  return true;
}

export function isSafeLink(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  if (trimmed.startsWith("#") || trimmed.startsWith("/") && !trimmed.startsWith("//") || trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Rejects raw HTML and unsafe inline Markdown URLs; text and fenced code remain valid. */
export function validateMarkdown(value: string): string[] {
  const errors: string[] = [];
  const withoutCode = value.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const withoutAutolinks = withoutCode.replace(/<https?:\/\/[^>]+>/gi, "");
  if (/<\/?[a-z][^>]*>/i.test(withoutAutolinks) || /<!--/.test(withoutAutolinks)) errors.push("Raw HTML запрещён");
  const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  for (const match of withoutCode.matchAll(linkPattern)) {
    const url = match[1] ?? match[2] ?? "";
    if (!isSafeLink(url)) errors.push(`Небезопасная ссылка: ${url}`);
  }
  return errors;
}

function markdown(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!string(value, path, issues, true, 2_000_000)) return;
  for (const message of validateMarkdown(value)) issue(issues, path, message);
}

function record(value: unknown, path: string, issues: ValidationIssue[]): value is Record<string, unknown> {
  if (!isObject(value)) { issue(issues, path, "Ожидался объект-словарь"); return false; }
  return true;
}

function validateGame(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) { issue(issues, path, "Ожидался объект игры"); return; }
  exactKeys(value, ENTITY_FIELDS.games, path, issues);
  uuid(value.id, `${path}/id`, issues);
  string(value.title, `${path}/title`, issues, false, 500);
  if (value.coverAssetId !== null && !(typeof value.coverAssetId === "string" && SHA256.test(value.coverAssetId))) issue(issues, `${path}/coverAssetId`, "Ожидался SHA-256 asset id или null");
  stringList(value.platforms, `${path}/platforms`, issues);
  stringList(value.tags, `${path}/tags`, issues);
  if (!STATUS_IDS.includes(value.status as never)) issue(issues, `${path}/status`, "Неизвестный статус");
  if (!isObject(value.placement)) issue(issues, `${path}/placement`, "Ожидалось размещение");
  else {
    exactKeys(value.placement, ["tierId", "rank"], `${path}/placement`, issues);
    if (!TIER_IDS.includes(value.placement.tierId as never)) issue(issues, `${path}/placement/tierId`, "Неизвестный тир");
    rank(value.placement.rank, `${path}/placement/rank`, issues);
  }
  markdown(value.reviewMarkdown, `${path}/reviewMarkdown`, issues);
  isoDate(value.createdAt, `${path}/createdAt`, issues);
  isoDate(value.updatedAt, `${path}/updatedAt`, issues);
}

function validateNote(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) { issue(issues, path, "Ожидался объект заметки"); return; }
  exactKeys(value, ENTITY_FIELDS.notes.filter((field) => field !== "groupRank"), path, issues, ["groupRank"]);
  uuid(value.id, `${path}/id`, issues); uuid(value.gameId, `${path}/gameId`, issues);
  markdown(value.bodyMarkdown, `${path}/bodyMarkdown`, issues);
  if (!Array.isArray(value.attachments)) issue(issues, `${path}/attachments`, "Ожидался массив вложений");
  else value.attachments.forEach((attachment, index) => {
    const attachmentPath = `${path}/attachments/${index}`;
    if (!isObject(attachment)) { issue(issues, attachmentPath, "Ожидалось вложение"); return; }
    if (attachment.type === "image") {
      exactKeys(attachment, ["type", "assetId", "alt"], attachmentPath, issues);
      if (typeof attachment.assetId !== "string" || !SHA256.test(attachment.assetId)) issue(issues, `${attachmentPath}/assetId`, "Ожидался SHA-256 asset id");
      string(attachment.alt, `${attachmentPath}/alt`, issues, true, 1_000);
    } else if (attachment.type === "link") {
      exactKeys(attachment, ["type", "url", "label"], attachmentPath, issues);
      if (!string(attachment.url, `${attachmentPath}/url`, issues, false) || !isSafeLink(attachment.url)) issue(issues, `${attachmentPath}/url`, "Разрешены только http(s) и безопасные относительные ссылки");
      string(attachment.label, `${attachmentPath}/label`, issues, false, 1_000);
    } else if (attachment.type === "file") {
      exactKeys(attachment, ["type", "assetId", "label"], attachmentPath, issues);
      if (typeof attachment.assetId !== "string" || !SHA256.test(attachment.assetId)) issue(issues, `${attachmentPath}/assetId`, "Ожидался SHA-256 asset id");
      string(attachment.label, `${attachmentPath}/label`, issues, false, 1_000);
    } else issue(issues, `${attachmentPath}/type`, "Неизвестный тип вложения");
  });
  if (value.groupRank !== undefined) rank(value.groupRank, `${path}/groupRank`, issues);
  rank(value.rank, `${path}/rank`, issues);
  isoDate(value.createdAt, `${path}/createdAt`, issues); isoDate(value.updatedAt, `${path}/updatedAt`, issues);
}

function validateAsset(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) { issue(issues, path, "Ожидался объект asset"); return; }
  if (typeof value.id !== "string" || !SHA256.test(value.id)) issue(issues, `${path}/id`, "Asset id должен быть SHA-256");
  if (value.kind === undefined) {
    issue(issues, `${path}/kind`, "Статичный asset должен ссылаться на файл в public/media");
    if ("base64" in value) issue(issues, `${path}/base64`, "Base64 разрешён только в patch.blobs");
    return;
  }
  if (value.kind === "image") {
    exactKeys(value, ["id", "kind", "mime", "width", "height", "byteLength", "alt", "originalName"], path, issues);
    if (value.mime !== "image/webp") issue(issues, `${path}/mime`, "Изображение должно быть image/webp");
    for (const field of ["width", "height"] as const) if (typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > MAX_WEBP_DIMENSION) issue(issues, `${path}/${field}`, `Размер изображения должен быть от 1 до ${MAX_WEBP_DIMENSION} px`);
    if (typeof value.byteLength !== "number" || !Number.isSafeInteger(value.byteLength) || value.byteLength < 12) issue(issues, `${path}/byteLength`, "Некорректный размер файла");
    string(value.alt, `${path}/alt`, issues, true, 1_000); string(value.originalName, `${path}/originalName`, issues, true, 2_000);
    return;
  }
  if (value.kind === "file") {
    exactKeys(value, ["id", "kind", "mime", "byteLength", "originalName"], path, issues);
    if (!string(value.mime, `${path}/mime`, issues, false, 255) || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value.mime)) issue(issues, `${path}/mime`, "Некорректный MIME type");
    if (typeof value.byteLength !== "number" || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) issue(issues, `${path}/byteLength`, "Некорректный размер файла");
    string(value.originalName, `${path}/originalName`, issues, false, 2_000);
    return;
  }
  issue(issues, `${path}/kind`, "Неизвестный тип asset");
}

export function validateLibrary(value: unknown): ValidationResult<LibraryDatabase> {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) return { ok: false, issues: [{ path: "", message: "Ожидался объект базы" }] };
  exactKeys(value, ["schemaVersion", "revision", "publicationId", ...ENTITY_MAPS], "", issues);
  if (value.schemaVersion !== LIBRARY_SCHEMA_VERSION) issue(issues, "/schemaVersion", `Поддерживается schemaVersion ${LIBRARY_SCHEMA_VERSION}`);
  if (typeof value.revision !== "string" || value.revision !== "" && !SHA256.test(value.revision)) issue(issues, "/revision", "Revision должен быть пустым либо SHA-256");
  if (value.publicationId !== null && !uuid(value.publicationId, "/publicationId", issues)) { /* issue added */ }
  const validators = { games: validateGame, notes: validateNote, assets: validateAsset };
  for (const map of ENTITY_MAPS) {
    const entries = value[map];
    if (!record(entries, `/${map}`, issues)) continue;
    for (const [id, entity] of Object.entries(entries)) {
      validators[map](entity, `/${map}/${id}`, issues);
      if (!isObject(entity) || entity.id !== id) issue(issues, `/${map}/${id}/id`, "Ключ словаря должен совпадать с id сущности");
    }
  }
  if (isObject(value.games) && isObject(value.assets)) {
    const assets = value.assets as Record<string, Asset>;
    for (const [id, game] of Object.entries(value.games)) {
      if (isObject(game) && typeof game.coverAssetId === "string") {
        const asset = assets[game.coverAssetId];
        if (!asset) issue(issues, `/games/${id}/coverAssetId`, "Изображение не найдено");
        else if (asset.kind === "file") issue(issues, `/games/${id}/coverAssetId`, "Обложка должна ссылаться на изображение");
      }
    }
  }
  if (isObject(value.notes) && isObject(value.games) && isObject(value.assets)) {
    const games = value.games; const assets = value.assets as Record<string, Asset>;
    for (const [id, note] of Object.entries(value.notes)) if (isObject(note)) {
    if (typeof note.gameId === "string" && !(note.gameId in games)) issue(issues, `/notes/${id}/gameId`, "Игра не найдена");
    if (Array.isArray(note.attachments)) note.attachments.forEach((attachment, index) => {
      if (isObject(attachment) && (attachment.type === "image" || attachment.type === "file") && typeof attachment.assetId === "string") {
        const asset = assets[attachment.assetId];
        if (!asset) issue(issues, `/notes/${id}/attachments/${index}/assetId`, "Asset не найден");
        else if (attachment.type === "image" && asset.kind === "file") issue(issues, `/notes/${id}/attachments/${index}/assetId`, "Изображение должно ссылаться на image asset");
        else if (attachment.type === "file" && asset.kind !== "file") issue(issues, `/notes/${id}/attachments/${index}/assetId`, "Файл должен ссылаться на file asset");
      }
    });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as LibraryDatabase, issues };
}

export class DomainValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[], message = "Данные не прошли проверку") { super(message); this.name = "DomainValidationError"; }
}

export function assertValidLibrary(value: unknown): asserts value is LibraryDatabase {
  const result = validateLibrary(value);
  if (!result.ok) throw new DomainValidationError(result.issues);
}

export function libraryRevisionIsValid(database: LibraryDatabase): boolean {
  if (database.revision === "") {
    return database.publicationId === null && [database.games, database.notes, database.assets].every((map) => Object.keys(map).length === 0);
  }
  return database.revision === computeLibraryRevision(database);
}

export function assertValidPublishedLibrary(value: unknown): asserts value is LibraryDatabase {
  assertValidLibrary(value);
  if (!libraryRevisionIsValid(value)) throw new DomainValidationError([{ path: "/revision", message: "Revision не совпадает с содержимым базы" }]);
}

function decodePointerToken(token: string): string | null {
  if (/~(?:[^01]|$)/.test(token)) return null;
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

export interface ParsedPatchPath { map: EntityMapName; id: string; field?: string }

export function parsePatchPath(path: string, localOnly = false): ParsedPatchPath | null {
  if (!path.startsWith("/")) return null;
  const raw = path.slice(1).split("/");
  if (raw.length !== 2 && raw.length !== 3) return null;
  const tokens = raw.map(decodePointerToken);
  if (tokens.some((token) => token === null)) return null;
  const [map, id, field] = tokens as [string, string, string?];
  if (!ENTITY_MAPS.includes(map as EntityMapName) || !id) return null;
  if (map === "assets" ? !SHA256.test(id) : !UUID.test(id)) return null;
  if (field !== undefined) {
    const fields = localOnly ? LOCALLY_PATCHABLE_FIELDS[map as EntityMapName] : ENTITY_FIELDS[map as EntityMapName];
    if (!fields.includes(field) || field === "id") return null;
  }
  return { map: map as EntityMapName, id, field };
}

export function validatePatch(value: unknown): ValidationResult<PatchEnvelope> {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) return { ok: false, issues: [{ path: "", message: "Ожидался объект патча" }] };
  exactKeys(value, ["patchVersion", "schemaVersion", "baseRevision", "operations", "blobs"], "", issues);
  if (value.patchVersion !== 2) issue(issues, "/patchVersion", "Поддерживается patchVersion 2");
  if (value.schemaVersion !== LIBRARY_SCHEMA_VERSION) issue(issues, "/schemaVersion", `Поддерживается schemaVersion ${LIBRARY_SCHEMA_VERSION}`);
  if (typeof value.baseRevision !== "string" || value.baseRevision !== "" && !SHA256.test(value.baseRevision)) issue(issues, "/baseRevision", "Некорректный baseRevision");
  if (!record(value.operations, "/operations", issues)) return { ok: false, issues };
  const blobs = record(value.blobs, "/blobs", issues) ? value.blobs : {};
  const rootEntities = new Set<string>();
  const blobAssets = new Map<string, Record<string, unknown>>();
  for (const [path, operation] of Object.entries(value.operations)) {
    const parsed = parsePatchPath(path, true);
    if (!parsed) issue(issues, `/operations/${path}`, "Недопустимый путь");
    if (!isObject(operation)) { issue(issues, `/operations/${path}`, "Ожидалась операция"); continue; }
    const allowedKeys = operation.operation === "set" ? ["operation", "value", "baseExists", "baseHash", "changedAt", "transactionId"] : ["operation", "baseExists", "baseHash", "changedAt", "transactionId"];
    exactKeys(operation, allowedKeys, `/operations/${path}`, issues);
    if (operation.operation !== "set" && operation.operation !== "delete") issue(issues, `/operations/${path}/operation`, "Неизвестная операция");
    if (operation.operation === "set" && operation.value === undefined) issue(issues, `/operations/${path}/value`, "Set требует JSON-значение");
    if (typeof operation.baseExists !== "boolean") issue(issues, `/operations/${path}/baseExists`, "Ожидался boolean");
    if (typeof operation.baseHash !== "string" || !SHA256.test(operation.baseHash)) issue(issues, `/operations/${path}/baseHash`, "Ожидался SHA-256");
    if (operation.baseExists === false && operation.baseHash !== MISSING_VALUE_HASH) issue(issues, `/operations/${path}/baseHash`, "Для отсутствующего base нужен MISSING_VALUE_HASH");
    isoDate(operation.changedAt, `/operations/${path}/changedAt`, issues);
    string(operation.transactionId, `/operations/${path}/transactionId`, issues, false, 200);
    if (parsed && !parsed.field) rootEntities.add(`/${parsed.map}/${parsed.id}`);
    if (parsed && parsed.field === undefined && operation.operation === "set" && (!isObject(operation.value) || operation.value.id !== parsed.id)) {
      issue(issues, `/operations/${path}/value/id`, "ID сущности должен совпадать с ID в пути");
    }
    if (parsed?.map === "assets" && parsed.field === undefined && operation.operation === "set") {
      validateAsset(operation.value, `/operations/${path}/value`, issues);
      if (operation.baseExists !== false) issue(issues, `/operations/${path}`, "Существующие assets неизменяемы");
      if (isObject(operation.value)) {
        if (operation.value.kind === undefined) issue(issues, `/operations/${path}/value/base64`, "Patch V2 не хранит inline base64");
        else if (operation.baseExists === false) blobAssets.set(parsed.id, operation.value);
      }
    }
  }
  for (const path of Object.keys(value.operations)) {
    const parsed = parsePatchPath(path, true);
    if (parsed?.field && rootEntities.has(`/${parsed.map}/${parsed.id}`)) issue(issues, `/operations/${path}`, "Нельзя одновременно менять сущность целиком и отдельное поле");
  }
  for (const [id, raw] of Object.entries(blobs)) {
    if (!SHA256.test(id)) { issue(issues, `/blobs/${id}`, "Ключ blob должен быть SHA-256"); continue; }
    if (typeof raw !== "string" || !isCanonicalBase64(raw)) { issue(issues, `/blobs/${id}`, "Ожидался canonical base64"); continue; }
    const bytes = base64ToBytes(raw);
    if (sha256Bytes(bytes) !== id) issue(issues, `/blobs/${id}`, "Blob не совпадает с SHA-256 ключом");
    const asset = blobAssets.get(id);
    if (!asset) { issue(issues, `/blobs/${id}`, "Blob не связан с добавляемым asset"); continue; }
    if (asset.byteLength !== bytes.byteLength) issue(issues, `/operations/assets/${id}/value/byteLength`, "Размер asset не совпадает с blob");
    if (asset.kind === "image" && (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP")) issue(issues, `/blobs/${id}`, "Изображение blob не является WebP");
  }
  for (const id of blobAssets.keys()) if (!(id in blobs)) issue(issues, `/blobs/${id}`, "Для локального asset отсутствует blob");
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as PatchEnvelope, issues };
}

export function assertValidPatch(value: unknown): asserts value is PatchEnvelope {
  const result = validatePatch(value);
  if (!result.ok) throw new DomainValidationError(result.issues, "Локальный патч повреждён");
}
