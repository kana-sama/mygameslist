#!/usr/bin/env node

/**
 * Runtime validation shared by the data check and the publishing CLI.
 *
 * This file deliberately uses only Node built-ins: it must still be usable when
 * a freshly cloned repository has not had its npm dependencies installed yet.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT_KEYS = [
  "schemaVersion",
  "revision",
  "publicationId",
  "games",
  "notes",
  "assets",
];
const STATUS_IDS = new Set(["wishlist", "playing", "played", "completed", "platinum", "dropped"]);
const TIER_IDS = new Set(["s", "a", "b", "c", "d", "f", "unranked"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MIME_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export const LIBRARY_SCHEMA_VERSION = 2;
export const MAX_WEBP_DIMENSION = 16_383;

export class DataValidationError extends Error {
  constructor(errors) {
    super(`Library data is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    this.name = "DataValidationError";
    this.errors = errors;
  }
}

export function canonicalStringify(value) {
  return JSON.stringify(sortForCanonicalJson(value));
}

function sortForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortForCanonicalJson(value[key])]),
    );
  }
  return value;
}

export function hashCanonical(value) {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

export function computeRevision(database) {
  return hashCanonical({ ...database, revision: "" });
}

export function validateLibrary(database, options = {}) {
  const { verifyRevision = true, mediaRoot = null } = options;
  const errors = [];
  const error = (at, message) => errors.push(`${at}: ${message}`);

  if (!isPlainObject(database)) {
    throw new DataValidationError(["$: expected an object"]);
  }
  exactKeys(database, ROOT_KEYS, "$", error);

  if (database.schemaVersion !== LIBRARY_SCHEMA_VERSION) error("$.schemaVersion", `must equal ${LIBRARY_SCHEMA_VERSION}`);
  if (typeof database.revision !== "string" || (database.revision !== "" && !SHA256_RE.test(database.revision))) {
    error("$.revision", "must be empty for the initial database or a lowercase SHA-256 hash");
  }
  if (database.publicationId !== null && !isUuid(database.publicationId)) {
    error("$.publicationId", "must be null or a UUID");
  }

  for (const key of ["games", "notes", "assets"]) {
    if (!isPlainObject(database[key])) error(`$.${key}`, "must be an object map");
  }

  const games = isPlainObject(database.games) ? database.games : {};
  const notes = isPlainObject(database.notes) ? database.notes : {};
  const assets = isPlainObject(database.assets) ? database.assets : {};

  validateRecordKeys(games, "$.games", error);
  validateRecordKeys(notes, "$.notes", error);
  validateRecordKeys(assets, "$.assets", error);

  for (const [id, asset] of Object.entries(assets)) validateAsset(id, asset, `$.assets.${id}`, error);
  for (const [id, game] of Object.entries(games)) validateGame(id, game, assets, `$.games.${id}`, error);
  for (const [id, note] of Object.entries(notes)) validateNote(id, note, games, assets, `$.notes.${id}`, error);
  if (database.revision === "") {
    const hasContent = [games, notes, assets].some(
      (record) => Object.keys(record).length > 0,
    );
    if (hasContent || database.publicationId !== null) {
      error("$.revision", "may be empty only for the pristine empty database");
    }
  } else if (verifyRevision && database.revision !== computeRevision(database)) {
    error("$.revision", "does not match the canonical database content");
  }

  if (mediaRoot !== null) {
    const externalAssets = Object.entries(assets);
    let safeMediaDirectory = externalAssets.length === 0;
    if (externalAssets.length > 0) {
      try {
        const resolvedMediaRoot = path.resolve(mediaRoot);
        const ancestors = [path.dirname(path.dirname(resolvedMediaRoot)), path.dirname(resolvedMediaRoot)];
        const unsafeAncestor = ancestors.find((directory) => {
          const stat = lstatSync(directory);
          return stat.isSymbolicLink() || !stat.isDirectory();
        });
        if (unsafeAncestor) {
          error("$.assets", `media ancestor must be a real directory, not a symlink: ${unsafeAncestor}`);
        } else {
          const mediaStat = lstatSync(resolvedMediaRoot);
          if (mediaStat.isSymbolicLink() || !mediaStat.isDirectory()) {
            error("$.assets", "media root must be a real directory, not a symlink");
          } else {
            safeMediaDirectory = true;
          }
        }
      } catch (cause) {
        if (cause?.code === "ENOENT") error("$.assets", `media directory is missing: ${mediaRoot}`);
        else error("$.assets", `cannot inspect media directory: ${cause.message}`);
      }
    }
    if (safeMediaDirectory) {
      for (const [id, asset] of externalAssets) {
        validateExternalAssetFile(mediaRoot, id, asset, `$.assets.${id}`, error);
      }
    }
  }

  if (errors.length > 0) throw new DataValidationError(errors);
  return database;
}

function validateGame(key, game, assets, at, error) {
  const keys = [
    "id",
    "title",
    "coverAssetId",
    "platforms",
    "tags",
    "status",
    "placement",
    "reviewMarkdown",
    "createdAt",
    "updatedAt",
  ];
  if (!isPlainObject(game)) return error(at, "must be an object");
  exactKeys(game, keys, at, error);
  validateEntityId(key, game.id, `${at}.id`, error);
  nonEmptyString(game.title, `${at}.title`, error, 500);
  if (game.coverAssetId !== null && typeof game.coverAssetId !== "string") {
    error(`${at}.coverAssetId`, "must be null or an asset id");
  } else if (typeof game.coverAssetId === "string" && !Object.hasOwn(assets, game.coverAssetId)) {
    error(`${at}.coverAssetId`, "references a missing asset");
  } else if (typeof game.coverAssetId === "string" && assetStorageKind(assets[game.coverAssetId]) !== "image") {
    error(`${at}.coverAssetId`, "must reference an image asset");
  }
  stringSet(game.platforms, `${at}.platforms`, error);
  stringSet(game.tags, `${at}.tags`, error);
  if (!STATUS_IDS.has(game.status)) error(`${at}.status`, "is not a supported status");
  if (!isPlainObject(game.placement)) {
    error(`${at}.placement`, "must be an object");
  } else {
    exactKeys(game.placement, ["tierId", "rank"], `${at}.placement`, error);
    if (!TIER_IDS.has(game.placement.tierId)) error(`${at}.placement.tierId`, "is not a supported tier");
    rank(game.placement.rank, `${at}.placement.rank`, error);
  }
  markdown(game.reviewMarkdown, `${at}.reviewMarkdown`, error);
  isoDate(game.createdAt, `${at}.createdAt`, error);
  isoDate(game.updatedAt, `${at}.updatedAt`, error);
}

function validateNote(key, note, games, assets, at, error) {
  const keys = ["id", "gameId", "bodyMarkdown", "attachments", "rank", "createdAt", "updatedAt"];
  if (!isPlainObject(note)) return error(at, "must be an object");
  exactKeys(note, keys, at, error, ["groupRank"]);
  validateEntityId(key, note.id, `${at}.id`, error);
  if (!isUuid(note.gameId) || !Object.hasOwn(games, note.gameId)) error(`${at}.gameId`, "references a missing game");
  markdown(note.bodyMarkdown, `${at}.bodyMarkdown`, error);
  if (note.groupRank !== undefined) rank(note.groupRank, `${at}.groupRank`, error);
  rank(note.rank, `${at}.rank`, error);
  isoDate(note.createdAt, `${at}.createdAt`, error);
  isoDate(note.updatedAt, `${at}.updatedAt`, error);
  if (!Array.isArray(note.attachments)) {
    error(`${at}.attachments`, "must be an array");
  } else {
    note.attachments.forEach((attachment, index) => {
      const attachmentAt = `${at}.attachments[${index}]`;
      if (!isPlainObject(attachment)) return error(attachmentAt, "must be an object");
      if (attachment.type === "image") {
        exactKeys(attachment, ["type", "assetId", "alt"], attachmentAt, error);
        if (typeof attachment.assetId !== "string" || !Object.hasOwn(assets, attachment.assetId)) {
          error(`${attachmentAt}.assetId`, "references a missing asset");
        } else if (assetStorageKind(assets[attachment.assetId]) !== "image") {
          error(`${attachmentAt}.assetId`, "must reference an image asset");
        }
        boundedString(attachment.alt, `${attachmentAt}.alt`, error, 1_000);
      } else if (attachment.type === "file") {
        exactKeys(attachment, ["type", "assetId", "label"], attachmentAt, error);
        if (typeof attachment.assetId !== "string" || !Object.hasOwn(assets, attachment.assetId)) {
          error(`${attachmentAt}.assetId`, "references a missing asset");
        } else if (assetStorageKind(assets[attachment.assetId]) !== "file") {
          error(`${attachmentAt}.assetId`, "must reference a file asset");
        }
        nonEmptyString(attachment.label, `${attachmentAt}.label`, error, 1_000);
      } else if (attachment.type === "link") {
        exactKeys(attachment, ["type", "url", "label"], attachmentAt, error);
        safeUrl(attachment.url, `${attachmentAt}.url`, error);
        nonEmptyString(attachment.label, `${attachmentAt}.label`, error, 1_000);
      } else {
        error(`${attachmentAt}.type`, "must be image, file, or link");
      }
    });
  }
}

function validateAsset(key, asset, at, error) {
  if (!isPlainObject(asset)) return error(at, "must be an object");
  if (!SHA256_RE.test(key) || asset.id !== key) error(`${at}.id`, "must equal its lowercase SHA-256 map key");

  if (isLegacyInlineImageAsset(asset)) {
    error(`${at}.kind`, "static assets must reference files in public/media");
    error(`${at}.base64`, "base64 is allowed only in patch.blobs");
    return;
  }

  if (asset.kind === "image") {
    exactKeys(asset, ["id", "kind", "mime", "width", "height", "byteLength", "alt", "originalName"], at, error);
    validateImageMetadata(asset, at, error);
    byteLength(asset.byteLength, `${at}.byteLength`, error, 12);
    return;
  }

  if (asset.kind === "file") {
    exactKeys(asset, ["id", "kind", "mime", "byteLength", "originalName"], at, error);
    if (typeof asset.mime !== "string" || asset.mime.length > 255 || !MIME_RE.test(asset.mime)) {
      error(`${at}.mime`, "must be a valid MIME type");
    }
    byteLength(asset.byteLength, `${at}.byteLength`, error);
    nonEmptyString(asset.originalName, `${at}.originalName`, error, 2_000);
    return;
  }

  error(`${at}.kind`, "must equal image or file");
}

function validateImageMetadata(asset, at, error) {
  if (asset.mime !== "image/webp") error(`${at}.mime`, "must equal image/webp");
  imageDimension(asset.width, `${at}.width`, error);
  imageDimension(asset.height, `${at}.height`, error);
  boundedString(asset.alt, `${at}.alt`, error, 1_000);
  boundedString(asset.originalName, `${at}.originalName`, error, 2_000);
}

export function isCanonicalBase64(value) {
  return typeof value === "string" && BASE64_RE.test(value) && Buffer.from(value, "base64").toString("base64") === value;
}

export function isLegacyInlineImageAsset(asset) {
  return isPlainObject(asset) && Object.hasOwn(asset, "base64") && !Object.hasOwn(asset, "kind");
}

export function assetStorageKind(asset) {
  return isLegacyInlineImageAsset(asset) ? "image" : asset?.kind;
}

export function externalAssetFilename(id, asset) {
  if (!SHA256_RE.test(id)) throw new Error("External asset id must be a lowercase SHA-256 hash");
  const kind = assetStorageKind(asset);
  if (kind !== "image" && kind !== "file") throw new Error("External asset kind must be image or file");
  const extension = kind === "image" ? "webp" : typeof asset.mime === "string" && asset.mime.toLowerCase() === "video/mp4" ? "mp4" : "bin";
  return `${id}.${extension}`;
}

export function externalAssetPath(mediaRoot, id, asset) {
  const resolvedRoot = path.resolve(mediaRoot);
  const resolvedPath = path.resolve(resolvedRoot, externalAssetFilename(id, asset));
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("External asset path escapes the media directory");
  }
  return resolvedPath;
}

function validateExternalAssetFile(mediaRoot, id, asset, at, error) {
  if (!SHA256_RE.test(id) || !isPlainObject(asset) || asset.id !== id) return;
  const kind = assetStorageKind(asset);
  if (kind !== "image" && kind !== "file") return;
  let filePath;
  try {
    filePath = externalAssetPath(mediaRoot, id, asset);
  } catch (cause) {
    return error(at, cause.message);
  }
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return error(at, `media file is missing: ${filePath}`);
    return error(at, `cannot inspect media file: ${cause.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return error(at, "media path must be a regular file, not a symlink");
  if (stat.size !== asset.byteLength) {
    error(`${at}.byteLength`, "does not match the media file size");
    return;
  }
  const bytes = readFileSync(filePath);
  if (createHash("sha256").update(bytes).digest("hex") !== id) error(`${at}.id`, "does not match the media file SHA-256");
  if (assetStorageKind(asset) === "image" && !isWebP(bytes)) error(`${at}.mime`, "media file is not WebP");
}

function isWebP(bytes) {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function validateRecordKeys(record, at, error) {
  for (const key of Object.keys(record)) {
    if (PROTOTYPE_KEYS.has(key)) error(`${at}.${key}`, "unsafe map key");
  }
}

function validateEntityId(key, value, at, error) {
  if (!isUuid(key) || value !== key) error(at, "must equal its UUID map key");
}

function exactKeys(value, expected, at, error, optional = []) {
  if (!isPlainObject(value)) return;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const allowed = new Set([...wanted, ...optional]);
  for (const key of actual) if (!allowed.has(key)) error(`${at}.${key}`, "unknown field");
  for (const key of wanted) if (!Object.hasOwn(value, key)) error(`${at}.${key}`, "missing required field");
}

function stringSet(value, at, error) {
  if (!Array.isArray(value)) return error(at, "must be an array");
  const seen = new Set();
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "" || item.length > 200) {
      error(`${at}[${index}]`, "must be a non-empty string no longer than 200 characters");
    } else if (seen.has(item)) {
      error(`${at}[${index}]`, "must not be duplicated");
    }
    seen.add(item);
  });
}

function markdown(value, at, error) {
  if (typeof value !== "string") return error(at, "must be a string");
  if (value.length > 2_000_000) error(at, "is unreasonably large");
  const withoutCode = value.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const withoutAutolinks = withoutCode.replace(/<https?:\/\/[^\s<>]+>/gi, "");
  if (/<\/?[A-Za-z][^>]*>/.test(withoutAutolinks) || /<!--/.test(withoutAutolinks)) error(at, "raw HTML is not allowed");
  const links = withoutCode.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g);
  for (const match of links) safeUrl(match[1] ?? match[2] ?? "", at, error);
}

function safeUrl(value, at, error) {
  if (typeof value !== "string" || value.trim() === "" || /[\u0000-\u001f\u007f]/.test(value)) {
    return error(at, "must be a non-empty safe URL");
  }
  const normalized = value.trim();
  if (normalized.startsWith("#") || normalized.startsWith("/") && !normalized.startsWith("//") || normalized.startsWith("./") || normalized.startsWith("../")) return;
  if (/^(?:https?):\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (!new Set(["http:", "https:"]).has(parsed.protocol)) error(at, "uses an unsafe URL protocol");
    } catch {
      error(at, "is not a valid URL");
    }
    return;
  }
  error(at, "must use http(s) or an explicit safe relative path");
}

function rank(value, at, error) {
  if (!Number.isSafeInteger(value) || value < 0) error(at, "must be a non-negative safe integer");
}

function imageDimension(value, at, error) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_WEBP_DIMENSION) error(at, `must be an integer from 1 through ${MAX_WEBP_DIMENSION}`);
}

function byteLength(value, at, error, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) error(at, `must be a safe integer of at least ${minimum}`);
}

function isoDate(value, at, error) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    error(at, "must be an ISO-8601 UTC timestamp");
  }
}

function nonEmptyString(value, at, error, max) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    error(at, `must be a non-empty string no longer than ${max} characters`);
  }
}

function boundedString(value, at, error, max) {
  if (typeof value !== "string" || value.length > max) error(at, `must be a string no longer than ${max} characters`);
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? "public/data/library.json");
  const source = await readFile(inputPath, "utf8");
  let database;
  try {
    database = JSON.parse(source);
  } catch (cause) {
    throw new Error(`${inputPath} is not valid JSON: ${cause.message}`);
  }
  validateLibrary(database, { mediaRoot: path.resolve(path.dirname(inputPath), "..", "media") });
  process.stdout.write(`Valid library data: ${inputPath}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
