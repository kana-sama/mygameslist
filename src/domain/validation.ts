import { MAX_WEBP_DIMENSION, base64ToBytes, isCanonicalBase64 } from "./assets";
import { parseMarkdownRichTooltips } from "./markdownRichTooltips";
import { LIBRARY_SCHEMA_VERSION, STATUS_IDS, TIER_IDS, type Asset, type LibraryDatabase, type PatchEnvelope } from "./types";
import { computeLibraryRevision, MISSING_VALUE_HASH, sha256Bytes } from "./canonical";
import { deriveImageAssetAltFromOwners, indexAssetOwners } from "./assetOwnership";

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
  games: ["id", "title", "coverAssetId", "progressItems", "platforms", "tags", "status", "placement", "reviewMarkdown", "createdAt", "updatedAt"],
  notes: ["id", "gameId", "bodyMarkdown", "attachments", "collapsedChecklistSections", "doubleHeight", "doubleWidth", "groupRank", "rank", "createdAt", "updatedAt"],
  assets: ["id", "kind", "mime", "width", "height", "byteLength", "alt", "originalName"],
};

export const LOCALLY_PATCHABLE_FIELDS = {
  games: ["title", "coverAssetId", "progressItems", "platforms", "tags", "status", "placement", "reviewMarkdown"],
  notes: ["bodyMarkdown", "attachments", "collapsedChecklistSections", "doubleHeight", "doubleWidth", "groupRank", "rank"],
  assets: [],
} as const satisfies Record<EntityMapName, readonly string[]>;

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
  const withoutHoverHints = withoutCode.replace(/\[[^\]\n]+\]\("[^"\n]*"\)/g, "");
  const withoutAutolinks = withoutHoverHints.replace(/<https?:\/\/[^>]+>/gi, "");
  if (/<\/?[a-z][^>]*>/i.test(withoutAutolinks) || /<!--/.test(withoutAutolinks)) errors.push("Raw HTML запрещён");
  const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g;
  for (const match of withoutHoverHints.matchAll(linkPattern)) {
    const url = match[1] ?? match[2] ?? "";
    if (!isSafeLink(url)) errors.push(`Небезопасная ссылка: ${url}`);
  }
  return errors;
}

/** Applies note-only rich-tooltip diagnostics in addition to generic Markdown safety. */
export function validateNoteMarkdown(value: string): string[] {
  return [...parseMarkdownRichTooltips(value).errors, ...validateMarkdown(value)];
}

/** Validates the two note fields that can be changed by immediate interactions. */
export function validateInteractiveNoteField(
  field: "bodyMarkdown" | "collapsedChecklistSections",
  value: string | string[] | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (field === "bodyMarkdown") markdown(value, "/bodyMarkdown", issues, true);
  else if (value !== undefined) stringList(value, "/collapsedChecklistSections", issues);
  return issues;
}

/** Validates metadata for the operation produced by an immediate note interaction. */
export function validateInteractiveNoteOperationMetadata(changedAt: string, transactionId: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  isoDate(changedAt, "/changedAt", issues);
  string(transactionId, "/transactionId", issues, false, 200);
  return issues;
}

function markdown(value: unknown, path: string, issues: ValidationIssue[], richTooltipsEnabled = false): void {
  if (!string(value, path, issues, true, 2_000_000)) return;
  const messages = richTooltipsEnabled ? validateNoteMarkdown(value) : validateMarkdown(value);
  for (const message of messages) issue(issues, path, message);
}

function record(value: unknown, path: string, issues: ValidationIssue[]): value is Record<string, unknown> {
  if (!isObject(value)) { issue(issues, path, "Ожидался объект-словарь"); return false; }
  return true;
}

function validateGame(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) { issue(issues, path, "Ожидался объект игры"); return; }
  const optionalFields = ["progressItems"];
  exactKeys(value, ENTITY_FIELDS.games.filter((field) => !optionalFields.includes(field)), path, issues, optionalFields);
  uuid(value.id, `${path}/id`, issues);
  string(value.title, `${path}/title`, issues, false, 500);
  if (value.coverAssetId !== null && !(typeof value.coverAssetId === "string" && SHA256.test(value.coverAssetId))) issue(issues, `${path}/coverAssetId`, "Ожидался SHA-256 asset id или null");
  if (value.progressItems !== undefined) {
    if (!Array.isArray(value.progressItems)) issue(issues, `${path}/progressItems`, "Ожидался массив элементов прогресса");
    else {
      const seen = new Set<string>();
      value.progressItems.forEach((item, index) => {
        const itemPath = `${path}/progressItems/${index}`;
        if (!isObject(item)) { issue(issues, itemPath, "Ожидался элемент прогресса"); return; }
        exactKeys(item, ["id", "iconAssetId", "noteId"], itemPath, issues);
        if (uuid(item.id, `${itemPath}/id`, issues)) {
          if (seen.has(item.id)) issue(issues, `${itemPath}/id`, "Повторяющийся id элемента прогресса");
          seen.add(item.id);
        }
        if (typeof item.iconAssetId !== "string" || !SHA256.test(item.iconAssetId)) issue(issues, `${itemPath}/iconAssetId`, "Ожидался SHA-256 asset id");
        uuid(item.noteId, `${itemPath}/noteId`, issues);
      });
    }
  }
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
  const optionalFields = ["collapsedChecklistSections", "doubleHeight", "doubleWidth", "groupRank"];
  exactKeys(value, ENTITY_FIELDS.notes.filter((field) => !optionalFields.includes(field)), path, issues, optionalFields);
  uuid(value.id, `${path}/id`, issues); uuid(value.gameId, `${path}/gameId`, issues);
  markdown(value.bodyMarkdown, `${path}/bodyMarkdown`, issues, true);
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
  if (value.collapsedChecklistSections !== undefined) stringList(value.collapsedChecklistSections, `${path}/collapsedChecklistSections`, issues);
  if (value.doubleHeight !== undefined && typeof value.doubleHeight !== "boolean") issue(issues, `${path}/doubleHeight`, "Ожидалось логическое значение");
  if (value.doubleWidth !== undefined && typeof value.doubleWidth !== "boolean") issue(issues, `${path}/doubleWidth`, "Ожидалось логическое значение");
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
      if (isObject(game) && Array.isArray(game.progressItems)) game.progressItems.forEach((item, index) => {
        if (!isObject(item) || typeof item.iconAssetId !== "string") return;
        const itemPath = `/games/${id}/progressItems/${index}`;
        const asset = assets[item.iconAssetId];
        if (!asset) issue(issues, `${itemPath}/iconAssetId`, "Иконка прогресса не найдена");
        else if (asset.kind !== "image") issue(issues, `${itemPath}/iconAssetId`, "Иконка прогресса должна ссылаться на изображение");
        else if (asset.width !== 64 || asset.height !== 64) issue(issues, `${itemPath}/iconAssetId`, "Иконка прогресса должна быть 64×64 px");
        if (typeof item.noteId === "string" && isObject(value.notes)) {
          const note = value.notes[item.noteId];
          if (isObject(note) && note.gameId !== id) issue(issues, `${itemPath}/noteId`, "Заметка прогресса должна принадлежать этой игре");
        }
      });
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
  if (isObject(value.games) && isObject(value.notes) && isObject(value.assets)) {
    const referenced = new Set<string>();
    for (const game of Object.values(value.games)) {
      if (isObject(game) && typeof game.coverAssetId === "string") referenced.add(game.coverAssetId);
      if (isObject(game) && Array.isArray(game.progressItems)) for (const item of game.progressItems) {
        if (isObject(item) && typeof item.iconAssetId === "string") referenced.add(item.iconAssetId);
      }
    }
    for (const note of Object.values(value.notes)) {
      if (!isObject(note) || !Array.isArray(note.attachments)) continue;
      for (const attachment of note.attachments) {
        if (isObject(attachment) && (attachment.type === "image" || attachment.type === "file") && typeof attachment.assetId === "string") {
          referenced.add(attachment.assetId);
        }
      }
    }
    for (const id of Object.keys(value.assets)) {
      if (!referenced.has(id)) issue(issues, `/assets/${id}`, "Asset ни к чему не привязан");
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

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MARKDOWN_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function walkStrings(value: unknown, path: string, visit: (item: string, path: string) => void): void {
  if (typeof value === "string") { visit(value, path); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => walkStrings(item, `${path}/${index}`, visit)); return; }
  if (!isObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    visit(key, `${path}/${key}`);
    walkStrings(item, `${path}/${key}`, visit);
  }
}

function sourceIssue(issues: ValidationIssue[], condition: boolean, path: string, message: string): void {
  if (!condition) issue(issues, path, message);
}

function sourceUuid(value: string, path: string, issues: ValidationIssue[]): void {
  sourceIssue(issues, CANONICAL_UUID.test(value), path, "UUID должен быть в lowercase canonical form");
}

function sourceSha(value: string, path: string, issues: ValidationIssue[]): void {
  sourceIssue(issues, SHA256.test(value), path, "SHA-256 должен быть в lowercase canonical form");
}

function displayFilename(value: string, path: string, issues: ValidationIssue[]): void {
  sourceIssue(issues, value.trim().length > 0 && value !== "." && value !== ".." && !/[\\/]/.test(value) && !CONTROL.test(value), path, "Имя файла должно быть непустым display filename без пути и control characters");
}

function singleLine(value: string, path: string, issues: ValidationIssue[], allowEmpty: boolean): void {
  sourceIssue(issues, (allowEmpty || value.trim().length > 0) && !CONTROL.test(value) && !/[\u2028\u2029]/.test(value), path, "Ожидалась однострочная строка без control characters");
}

function absoluteHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || CONTROL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0 && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

function sourceStrings(value: unknown, path: string, issues: ValidationIssue[]): void {
  walkStrings(value, path, (item, itemPath) => {
    if (hasUnpairedSurrogate(item)) issue(issues, itemPath, "Строка содержит unpaired surrogate");
    if (itemPath.endsWith("/reviewMarkdown") || itemPath.endsWith("/bodyMarkdown")) {
      if (MARKDOWN_CONTROL.test(item)) issue(issues, itemPath, "Markdown содержит недопустимый control character");
    } else if (CONTROL.test(item)) issue(issues, itemPath, "Метаданные содержат control character");
  });
}

function sourceProgressItems(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isObject(item)) return;
    const itemPath = `${path}/${index}`;
    if (typeof item.id === "string") sourceUuid(item.id, `${itemPath}/id`, issues);
    if (typeof item.iconAssetId === "string") sourceSha(item.iconAssetId, `${itemPath}/iconAssetId`, issues);
    if (typeof item.noteId === "string") sourceUuid(item.noteId, `${itemPath}/noteId`, issues);
  });
}

function sourceAttachments(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((attachment, index) => {
    if (!isObject(attachment)) return;
    const itemPath = `${path}/${index}`;
    if (attachment.type === "link") {
      if (typeof attachment.url === "string") sourceIssue(issues, absoluteHttpUrl(attachment.url), `${itemPath}/url`, "Ссылка должна быть absolute credential-free HTTP(S) URL");
      if (typeof attachment.label === "string") singleLine(attachment.label, `${itemPath}/label`, issues, false);
    } else if (attachment.type === "image") {
      if (typeof attachment.assetId === "string") sourceSha(attachment.assetId, `${itemPath}/assetId`, issues);
      if (typeof attachment.alt === "string") singleLine(attachment.alt, `${itemPath}/alt`, issues, true);
    } else if (attachment.type === "file") {
      if (typeof attachment.assetId === "string") sourceSha(attachment.assetId, `${itemPath}/assetId`, issues);
      if (typeof attachment.label === "string") singleLine(attachment.label, `${itemPath}/label`, issues, false);
    }
  });
}

function sourceCollapsedSections(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (typeof item === "string") singleLine(item, `${path}/${index}`, issues, false);
  });
}

type SourceFieldValidator = (value: unknown, path: string, issues: ValidationIssue[]) => void;
type LocallyPatchableField<Map extends EntityMapName> = (typeof LOCALLY_PATCHABLE_FIELDS)[Map][number];

const recursivelySourceSafe: SourceFieldValidator = () => { /* sourceStrings validates the complete value */ };

const SOURCE_PATCH_FIELD_VALIDATORS = {
  games: {
    title: recursivelySourceSafe,
    coverAssetId: (value, path, issues) => { if (typeof value === "string") sourceSha(value, path, issues); },
    progressItems: sourceProgressItems,
    platforms: recursivelySourceSafe,
    tags: recursivelySourceSafe,
    status: recursivelySourceSafe,
    placement: recursivelySourceSafe,
    reviewMarkdown: recursivelySourceSafe,
  },
  notes: {
    bodyMarkdown: recursivelySourceSafe,
    attachments: sourceAttachments,
    collapsedChecklistSections: sourceCollapsedSections,
    doubleHeight: recursivelySourceSafe,
    doubleWidth: recursivelySourceSafe,
    groupRank: recursivelySourceSafe,
    rank: recursivelySourceSafe,
  },
  assets: {},
} satisfies { [Map in EntityMapName]: Record<LocallyPatchableField<Map>, SourceFieldValidator> };

function sourceGame(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) return;
  if (typeof value.id === "string") sourceUuid(value.id, `${path}/id`, issues);
  SOURCE_PATCH_FIELD_VALIDATORS.games.coverAssetId(value.coverAssetId, `${path}/coverAssetId`, issues);
  if (value.progressItems !== undefined) SOURCE_PATCH_FIELD_VALIDATORS.games.progressItems(value.progressItems, `${path}/progressItems`, issues);
}

function sourceNote(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) return;
  if (typeof value.id === "string") sourceUuid(value.id, `${path}/id`, issues);
  if (typeof value.gameId === "string") sourceUuid(value.gameId, `${path}/gameId`, issues);
  SOURCE_PATCH_FIELD_VALIDATORS.notes.attachments(value.attachments, `${path}/attachments`, issues);
  if (value.collapsedChecklistSections !== undefined) {
    SOURCE_PATCH_FIELD_VALIDATORS.notes.collapsedChecklistSections(value.collapsedChecklistSections, `${path}/collapsedChecklistSections`, issues);
  }
}

function sourceAsset(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isObject(value)) return;
  if (typeof value.id === "string") sourceSha(value.id, `${path}/id`, issues);
  if (typeof value.originalName === "string") {
    displayFilename(value.originalName, `${path}/originalName`, issues);
    singleLine(value.originalName, `${path}/originalName`, issues, false);
  }
  if (typeof value.mime === "string") singleLine(value.mime, `${path}/mime`, issues, false);
  if (value.kind === "image" && typeof value.alt === "string") singleLine(value.alt, `${path}/alt`, issues, true);
}

const SOURCE_ROOT_VALIDATORS = {
  games: sourceGame,
  notes: sourceNote,
  assets: sourceAsset,
} satisfies Record<EntityMapName, SourceFieldValidator>;

function sourcePatchSetValue(parsed: ParsedPatchPath, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (parsed.field === undefined) {
    SOURCE_ROOT_VALIDATORS[parsed.map](value, path, issues);
    return;
  }
  const validator = (SOURCE_PATCH_FIELD_VALIDATORS[parsed.map] as Record<string, SourceFieldValidator>)[parsed.field];
  if (!validator) {
    issue(issues, path, "Для локального source patch path не определена проверка значения");
    return;
  }
  validator(value, path, issues);
}

/** Returns the stricter invariant failures required for lossless YAML/Markdown projection. */
export function sourceRepresentabilityIssues(database: LibraryDatabase): ValidationIssue[] {
  const validation = validateLibrary(database);
  if (!validation.ok) return validation.issues;
  const issues: ValidationIssue[] = [];

  sourceStrings(database, "", issues);

  if (database.revision !== "") sourceSha(database.revision, "/revision", issues);
  if (database.publicationId === null) issue(issues, "/publicationId", "Source tree требует publication UUID");
  else sourceUuid(database.publicationId, "/publicationId", issues);
  const assetOwners = indexAssetOwners(database);
  for (const [gameId, game] of Object.entries(database.games)) {
    sourceUuid(gameId, `/games/${gameId}`, issues);
    sourceGame(game, `/games/${gameId}`, issues);
    for (const [index, item] of (game.progressItems ?? []).entries()) {
      sourceIssue(issues, database.notes[item.noteId]?.gameId === gameId, `/games/${gameId}/progressItems/${index}/noteId`, "Source progress item должен ссылаться на заметку той же игры");
    }
  }
  for (const [noteId, note] of Object.entries(database.notes)) {
    sourceUuid(noteId, `/notes/${noteId}`, issues);
    sourceNote(note, `/notes/${noteId}`, issues);
  }
  for (const [assetId, asset] of Object.entries(database.assets)) {
    sourceSha(assetId, `/assets/${assetId}`, issues);
    sourceAsset(asset, `/assets/${assetId}`, issues);
    if (asset.kind === "image") {
      const derivedAlt = deriveImageAssetAltFromOwners(assetOwners.get(assetId));
      sourceIssue(issues, asset.alt === derivedAlt, `/assets/${assetId}/alt`, "Global image alt не совпадает с owner-derived значением");
    }
  }

  for (const [assetId, owners] of assetOwners) {
    const originalNames = new Set(owners.map((owner) => owner.originalName));
    sourceIssue(issues, originalNames.size <= 1, `/assets/${assetId}/originalName`, "Все владельцы SHA должны согласовать originalName");
    const fileMimes = new Set(owners.filter((owner) => owner.role === "note-file").map((owner) => owner.mime));
    sourceIssue(issues, fileMimes.size <= 1, `/assets/${assetId}/mime`, "Все file-владельцы SHA должны согласовать MIME");
    const coverAlts = new Set(owners.filter((owner) => owner.role === "cover").map((owner) => owner.alt));
    sourceIssue(issues, coverAlts.size <= 1, `/assets/${assetId}/alt`, "Все cover-владельцы SHA должны согласовать alt");
  }

  return issues;
}

/** Validates authored values even when a conflicting field operation cannot be materialized. */
export function patchOperationSourceIssues(path: string, operation: PatchEnvelope["operations"][string]): ValidationIssue[] {
  const parsed = parsePatchPath(path, true);
  if (!parsed) return [{ path, message: "Недопустимый source patch path" }];
  const issues: ValidationIssue[] = [];
  if (operation.operation !== "set") return issues;
  const value = operation.value;
  sourceStrings(value, path, issues);
  sourcePatchSetValue(parsed, value, path, issues);
  return issues;
}

/** Applies the stricter invariants required for lossless YAML/Markdown projection. */
export function assertSourceRepresentable(database: LibraryDatabase): void {
  const issues = sourceRepresentabilityIssues(database);
  if (issues.length) {
    const first = issues[0];
    throw new DomainValidationError(issues, `База не представима в source tree: ${first.path || "/"} — ${first.message}`);
  }
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
  if (map === "assets" ? !SHA256.test(id) : !(localOnly ? CANONICAL_UUID : UUID).test(id)) return null;
  if (field !== undefined) {
    const fields = localOnly ? LOCALLY_PATCHABLE_FIELDS[map as EntityMapName] : ENTITY_FIELDS[map as EntityMapName];
    if (!fields.includes(field) || field === "id") return null;
  }
  return { map: map as EntityMapName, id, field };
}

function validatePatchSetValue(parsed: ParsedPatchPath, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (parsed.map === "assets") return;
  const entityPath = `${path}/value`;
  if (parsed.map === "games") {
    if (parsed.field === undefined) { validateGame(value, entityPath, issues); return; }
    const candidate: Record<string, unknown> = {
      id: parsed.id,
      title: "Patch value",
      coverAssetId: null,
      platforms: [],
      tags: [],
      status: "wishlist",
      placement: { tierId: "unranked", rank: 1024 },
      reviewMarkdown: "",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      [parsed.field]: value,
    };
    validateGame(candidate, entityPath, issues);
    return;
  }
  if (parsed.field === undefined) { validateNote(value, entityPath, issues); return; }
  const candidate: Record<string, unknown> = {
    id: parsed.id,
    gameId: "00000000-0000-4000-8000-000000000000",
    bodyMarkdown: "",
    attachments: [],
    rank: 1024,
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
    [parsed.field]: value,
  };
  validateNote(candidate, entityPath, issues);
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
    if (parsed && operation.operation === "set") validatePatchSetValue(parsed, operation.value, `/operations/${path}`, issues);
    if (parsed?.map === "assets" && parsed.field === undefined && operation.operation === "set") {
      validateAsset(operation.value, `/operations/${path}/value`, issues);
      if (operation.baseExists !== false && (!isObject(operation.value) || operation.value.kind !== "image")) issue(issues, `/operations/${path}`, "Существующие assets неизменяемы, кроме owner-derived image alt");
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
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as PatchEnvelope, issues };
}

export function assertValidPatch(value: unknown): asserts value is PatchEnvelope {
  const result = validatePatch(value);
  if (!result.ok) throw new DomainValidationError(result.issues, "Локальный патч повреждён");
}
