#!/usr/bin/env node

/**
 * Runtime validation shared by the data check and the publishing CLI.
 *
 * This file deliberately uses only Node built-ins: it must still be usable when
 * a freshly cloned repository has not had its npm dependencies installed yet.
 */

import { createHash } from "node:crypto";
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
  "collections",
  "collectionItems",
  "assets",
];
const STATUS_IDS = new Set(["wishlist", "playing", "played", "completed", "dropped"]);
const TIER_IDS = new Set(["s", "a", "b", "c", "d", "f", "unranked"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

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
  const { verifyRevision = true } = options;
  const errors = [];
  const error = (at, message) => errors.push(`${at}: ${message}`);

  if (!isPlainObject(database)) {
    throw new DataValidationError(["$: expected an object"]);
  }
  exactKeys(database, ROOT_KEYS, "$", error);

  if (database.schemaVersion !== 1) error("$.schemaVersion", "must equal 1");
  if (typeof database.revision !== "string" || (database.revision !== "" && !SHA256_RE.test(database.revision))) {
    error("$.revision", "must be empty for the initial database or a lowercase SHA-256 hash");
  }
  if (database.publicationId !== null && !isUuid(database.publicationId)) {
    error("$.publicationId", "must be null or a UUID");
  }

  for (const key of ["games", "notes", "collections", "collectionItems", "assets"]) {
    if (!isPlainObject(database[key])) error(`$.${key}`, "must be an object map");
  }

  const games = isPlainObject(database.games) ? database.games : {};
  const notes = isPlainObject(database.notes) ? database.notes : {};
  const collections = isPlainObject(database.collections) ? database.collections : {};
  const collectionItems = isPlainObject(database.collectionItems) ? database.collectionItems : {};
  const assets = isPlainObject(database.assets) ? database.assets : {};

  validateRecordKeys(games, "$.games", error);
  validateRecordKeys(notes, "$.notes", error);
  validateRecordKeys(collections, "$.collections", error);
  validateRecordKeys(collectionItems, "$.collectionItems", error);
  validateRecordKeys(assets, "$.assets", error);

  for (const [id, asset] of Object.entries(assets)) validateAsset(id, asset, `$.assets.${id}`, error);
  for (const [id, game] of Object.entries(games)) validateGame(id, game, assets, `$.games.${id}`, error);
  for (const [id, note] of Object.entries(notes)) validateNote(id, note, games, assets, `$.notes.${id}`, error);
  for (const [id, collection] of Object.entries(collections)) {
    validateCollection(id, collection, `$.collections.${id}`, error);
  }

  const membershipPairs = new Set();
  for (const [id, item] of Object.entries(collectionItems)) {
    validateCollectionItem(id, item, games, collections, `$.collectionItems.${id}`, error);
    if (isPlainObject(item) && typeof item.collectionId === "string" && typeof item.gameId === "string") {
      const pair = `${item.collectionId}\u0000${item.gameId}`;
      if (membershipPairs.has(pair)) error(`$.collectionItems.${id}`, "duplicates a collection/game membership");
      membershipPairs.add(pair);
    }
  }

  if (database.revision === "") {
    const hasContent = [games, notes, collections, collectionItems, assets].some(
      (record) => Object.keys(record).length > 0,
    );
    if (hasContent || database.publicationId !== null) {
      error("$.revision", "may be empty only for the pristine empty database");
    }
  } else if (verifyRevision && database.revision !== computeRevision(database)) {
    error("$.revision", "does not match the canonical database content");
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
  exactKeys(note, keys, at, error);
  validateEntityId(key, note.id, `${at}.id`, error);
  if (!isUuid(note.gameId) || !Object.hasOwn(games, note.gameId)) error(`${at}.gameId`, "references a missing game");
  markdown(note.bodyMarkdown, `${at}.bodyMarkdown`, error);
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
        }
        boundedString(attachment.alt, `${attachmentAt}.alt`, error, 1_000);
      } else if (attachment.type === "link") {
        exactKeys(attachment, ["type", "url", "label"], attachmentAt, error);
        safeUrl(attachment.url, `${attachmentAt}.url`, error);
        nonEmptyString(attachment.label, `${attachmentAt}.label`, error, 1_000);
      } else {
        error(`${attachmentAt}.type`, "must be image or link");
      }
    });
  }
}

function validateCollection(key, collection, at, error) {
  const keys = ["id", "title", "descriptionMarkdown", "createdAt", "updatedAt"];
  if (!isPlainObject(collection)) return error(at, "must be an object");
  exactKeys(collection, keys, at, error);
  validateEntityId(key, collection.id, `${at}.id`, error);
  nonEmptyString(collection.title, `${at}.title`, error, 500);
  markdown(collection.descriptionMarkdown, `${at}.descriptionMarkdown`, error);
  isoDate(collection.createdAt, `${at}.createdAt`, error);
  isoDate(collection.updatedAt, `${at}.updatedAt`, error);
}

function validateCollectionItem(key, item, games, collections, at, error) {
  const keys = ["id", "collectionId", "gameId", "rank"];
  if (!isPlainObject(item)) return error(at, "must be an object");
  exactKeys(item, keys, at, error);
  validateEntityId(key, item.id, `${at}.id`, error);
  if (!isUuid(item.collectionId) || !Object.hasOwn(collections, item.collectionId)) {
    error(`${at}.collectionId`, "references a missing collection");
  }
  if (!isUuid(item.gameId) || !Object.hasOwn(games, item.gameId)) error(`${at}.gameId`, "references a missing game");
  rank(item.rank, `${at}.rank`, error);
}

function validateAsset(key, asset, at, error) {
  const keys = ["id", "mime", "width", "height", "base64", "alt", "originalName"];
  if (!isPlainObject(asset)) return error(at, "must be an object");
  exactKeys(asset, keys, at, error);
  if (!SHA256_RE.test(key) || asset.id !== key) error(`${at}.id`, "must equal its lowercase SHA-256 map key");
  if (asset.mime !== "image/webp") error(`${at}.mime`, "must equal image/webp");
  imageDimension(asset.width, `${at}.width`, error);
  imageDimension(asset.height, `${at}.height`, error);
  boundedString(asset.alt, `${at}.alt`, error, 1_000);
  boundedString(asset.originalName, `${at}.originalName`, error, 2_000);
  if (typeof asset.base64 !== "string" || asset.base64.length === 0 || !BASE64_RE.test(asset.base64)) {
    error(`${at}.base64`, "must be canonical base64");
    return;
  }
  const bytes = Buffer.from(asset.base64, "base64");
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    error(`${at}.base64`, "is not a WebP file");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== key) error(`${at}.id`, "does not match the SHA-256 of decoded image bytes");
}

function validateRecordKeys(record, at, error) {
  for (const key of Object.keys(record)) {
    if (PROTOTYPE_KEYS.has(key)) error(`${at}.${key}`, "unsafe map key");
  }
}

function validateEntityId(key, value, at, error) {
  if (!isUuid(key) || value !== key) error(at, "must equal its UUID map key");
}

function exactKeys(value, expected, at, error) {
  if (!isPlainObject(value)) return;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  for (const key of actual) if (!wanted.includes(key)) error(`${at}.${key}`, "unknown field");
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
  if (!Number.isInteger(value) || value <= 0 || value > 1280) error(at, "must be an integer from 1 through 1280");
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
  validateLibrary(database);
  process.stdout.write(`Valid library data: ${inputPath}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
