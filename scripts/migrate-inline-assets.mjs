#!/usr/bin/env node

/** One-time/idempotent migration from legacy inline WebP assets to public/media. */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  computeRevision,
  externalAssetPath,
  isCanonicalBase64,
  isLegacyInlineImageAsset,
  validateLibrary,
} from "./validate-data.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWebP(bytes) {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

export function migrateInlineAssets(root) {
  const dataPath = path.join(root, "public", "data", "library.json");
  const mediaRoot = path.join(root, "public", "media");
  const temporaryDataPath = `${dataPath}.migrate-${process.pid}`;
  const createdMedia = [];
  const database = JSON.parse(readFileSync(dataPath, "utf8"));
  let migrated = 0;

  try {
    mkdirSync(mediaRoot, { recursive: true, mode: 0o755 });
    for (const [id, asset] of Object.entries(database.assets ?? {})) {
      if (!isLegacyInlineImageAsset(asset)) continue;
      if (!isCanonicalBase64(asset.base64)) throw new Error(`Asset ${id} contains invalid base64`);
      const bytes = Buffer.from(asset.base64, "base64");
      if (sha256(bytes) !== id) throw new Error(`Asset ${id} does not match its SHA-256 id`);
      if (!isWebP(bytes)) throw new Error(`Asset ${id} is not WebP`);

      const metadata = {
        id,
        kind: "image",
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        byteLength: bytes.byteLength,
        alt: asset.alt,
        originalName: asset.originalName,
      };
      const mediaPath = externalAssetPath(mediaRoot, id, metadata);
      if (existsSync(mediaPath)) {
        const existing = readFileSync(mediaPath);
        if (sha256(existing) !== id || !existing.equals(bytes)) throw new Error(`${path.basename(mediaPath)} has unexpected contents`);
      } else {
        writeFileSync(mediaPath, bytes, { flag: "wx", mode: 0o644 });
        createdMedia.push(mediaPath);
      }
      database.assets[id] = metadata;
      migrated += 1;
    }

    database.revision = "";
    database.revision = computeRevision(database);
    validateLibrary(database, { mediaRoot });
    writeFileSync(temporaryDataPath, `${JSON.stringify(database, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    renameSync(temporaryDataPath, dataPath);
    return { migrated, mediaPaths: createdMedia.map((mediaPath) => path.relative(root, mediaPath)) };
  } catch (error) {
    if (existsSync(temporaryDataPath)) unlinkSync(temporaryDataPath);
    for (const mediaPath of createdMedia.reverse()) if (existsSync(mediaPath)) unlinkSync(mediaPath);
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = migrateInlineAssets(root);
  process.stdout.write(`Migrated ${result.migrated} inline asset${result.migrated === 1 ? "" : "s"} to public/media.\n`);
}
