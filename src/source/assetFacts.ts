import { MAX_WEBP_DIMENSION } from "../domain/assets";
import { sha256Bytes } from "../domain/canonical";
import type { Asset, LibraryDatabase } from "../domain/types";
import type {
  SourceAssetOccurrence,
  SourceAssetReference,
} from "./types";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_VP8_DIMENSION = 0x3fff;
const MAX_VP8L_DIMENSION = 0x4000;
const MAX_VP8X_DIMENSION = 0x1000000;
const MAX_VP8X_CANVAS_AREA = 0xffff_ffff;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x1_0000
    + bytes[offset + 3] * 0x1_000000;
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function checkedDimensions(
  width: number,
  height: number,
  chunk: string,
  maximum: number,
): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > maximum || height > maximum) {
    throw new Error(`${chunk} has invalid WebP dimensions ${width}×${height}`);
  }
  return { width, height };
}

function parseVp8Dimensions(bytes: Uint8Array, start: number, length: number): { width: number; height: number } {
  if (length < 10) throw new Error("VP8 chunk is truncated");
  if ((bytes[start] & 1) !== 0) throw new Error("VP8 dimension header is not a keyframe");
  if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
    throw new Error("VP8 keyframe start code is invalid");
  }
  const width = readUint16LE(bytes, start + 6) & 0x3fff;
  const height = readUint16LE(bytes, start + 8) & 0x3fff;
  return checkedDimensions(width, height, "VP8", MAX_VP8_DIMENSION);
}

function parseVp8lDimensions(bytes: Uint8Array, start: number, length: number): { width: number; height: number } {
  if (length < 5) throw new Error("VP8L chunk is truncated");
  if (bytes[start] !== 0x2f) throw new Error("VP8L signature is invalid");
  const bits = readUint32LE(bytes, start + 1);
  const version = Math.floor(bits / 0x2000_0000);
  if (version !== 0) throw new Error("VP8L version is unsupported");
  const width = bits % 0x4000 + 1;
  const height = Math.floor(bits / 0x4000) % 0x4000 + 1;
  return checkedDimensions(width, height, "VP8L", MAX_VP8L_DIMENSION);
}

function parseVp8xDimensions(bytes: Uint8Array, start: number, length: number): { width: number; height: number } {
  if (length < 10) throw new Error("VP8X chunk is truncated");
  const width = readUint24LE(bytes, start + 4) + 1;
  const height = readUint24LE(bytes, start + 7) + 1;
  const dimensions = checkedDimensions(width, height, "VP8X", MAX_VP8X_DIMENSION);
  if (width * height > MAX_VP8X_CANVAS_AREA) {
    throw new Error(`VP8X canvas area exceeds the 32-bit maximum: ${width}×${height}`);
  }
  return dimensions;
}

export function parseWebPDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 12 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) {
    throw new Error("Invalid RIFF/WEBP container");
  }
  const riffEnd = readUint32LE(bytes, 4) + 8;
  if (!Number.isSafeInteger(riffEnd) || riffEnd !== bytes.length || riffEnd < 12) {
    throw new Error("RIFF length does not match the WebP input");
  }

  let offset = 12;
  let dimensions: { width: number; height: number } | undefined;
  let dimensionsFromVp8x = false;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) throw new Error("WebP chunk header is truncated");
    const length = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);
    if (!Number.isSafeInteger(dataEnd) || !Number.isSafeInteger(paddedEnd)
      || dataEnd < dataStart || paddedEnd < dataEnd
      || dataEnd > riffEnd || paddedEnd > riffEnd) {
      throw new Error("WebP chunk length exceeds the RIFF container");
    }
    if (length % 2 === 1 && bytes[dataEnd] !== 0) {
      throw new Error("WebP chunk padding byte must be zero");
    }

    let parsed: { width: number; height: number } | undefined;
    let vp8x = false;
    if (hasAscii(bytes, offset, "VP8 ")) parsed = parseVp8Dimensions(bytes, dataStart, length);
    else if (hasAscii(bytes, offset, "VP8L")) parsed = parseVp8lDimensions(bytes, dataStart, length);
    else if (hasAscii(bytes, offset, "VP8X")) {
      parsed = parseVp8xDimensions(bytes, dataStart, length);
      vp8x = true;
    }
    if (parsed && (!dimensions || vp8x || !dimensionsFromVp8x)) {
      dimensions = parsed;
      dimensionsFromVp8x = vp8x;
    }
    offset = paddedEnd;
  }
  if (offset !== riffEnd) throw new Error("WebP chunk padding exceeds the RIFF container");
  if (!dimensions) throw new Error("WebP has no supported dimension-bearing chunk");
  return dimensions;
}

type MutableOccurrence = {
  gameId: string;
  assetId: string;
  kind: "image" | "file";
  originalName: string;
  references: SourceAssetReference[];
};

function referenceOrder(reference: SourceAssetReference): readonly (string | number)[] {
  const roleOrder = { cover: 0, "progress-icon": 1, "note-image": 2, "note-file": 3 } as const;
  if (reference.role === "cover") return [roleOrder[reference.role]];
  if (reference.role === "progress-icon") return [roleOrder[reference.role], reference.progressItemId];
  return [roleOrder[reference.role], reference.noteId, reference.attachmentIndex];
}

function compareReferences(left: SourceAssetReference, right: SourceAssetReference): number {
  const leftKey = referenceOrder(left);
  const rightKey = referenceOrder(right);
  for (let index = 0; index < Math.max(leftKey.length, rightKey.length); index += 1) {
    const leftPart = leftKey[index];
    const rightPart = rightKey[index];
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") return leftPart - rightPart;
    return compareText(String(leftPart ?? ""), String(rightPart ?? ""));
  }
  return 0;
}

export function collectSourceAssetOccurrences(database: LibraryDatabase): readonly SourceAssetOccurrence[] {
  const occurrences = new Map<string, MutableOccurrence>();
  const requiredKinds = new Map<string, "image" | "file">();

  const append = (
    gameId: string,
    assetId: string,
    kind: "image" | "file",
    makeReference: (originalName: string, mime?: string, imageAlt?: string) => SourceAssetReference,
  ): void => {
    const previousKind = requiredKinds.get(assetId);
    if (previousKind && previousKind !== kind) throw new Error(`Asset ${assetId} is referenced as both image and file kinds`);
    requiredKinds.set(assetId, kind);

    const asset = database.assets[assetId];
    if (!asset) throw new Error(`Referenced asset ${assetId} is missing`);
    if (asset.id !== assetId) throw new Error(`Asset ${assetId} identity does not match its map key`);
    if (asset.kind !== kind) throw new Error(`Asset ${assetId} has kind ${asset.kind}, expected ${kind}`);
    const key = `${gameId}\u0000${assetId}`;
    const existing = occurrences.get(key);
    if (existing && (existing.kind !== kind || existing.originalName !== asset.originalName)) {
      throw new Error(`Asset ${assetId} has incompatible same-game owner facts`);
    }
    const occurrence = existing ?? {
      gameId,
      assetId,
      kind,
      originalName: asset.originalName,
      references: [],
    };
    occurrence.references.push(makeReference(
      asset.originalName,
      asset.kind === "file" ? asset.mime : undefined,
      asset.kind === "image" ? asset.alt : undefined,
    ));
    occurrences.set(key, occurrence);
  };

  for (const [gameId, game] of Object.entries(database.games)) {
    if (game.id !== gameId) throw new Error(`Game ${gameId} identity does not match its map key`);
    if (game.coverAssetId) {
      append(gameId, game.coverAssetId, "image", (originalName, _mime, imageAlt) => ({
        role: "cover",
        gameId,
        assetId: game.coverAssetId!,
        originalName,
        alt: imageAlt ?? "",
      }));
    }
    for (const item of game.progressItems ?? []) {
      const note = database.notes[item.noteId];
      if (!note || note.gameId !== gameId) throw new Error(`Progress item ${item.id} violates note game ownership`);
      append(gameId, item.iconAssetId, "image", (originalName) => ({
        role: "progress-icon",
        gameId,
        assetId: item.iconAssetId,
        originalName,
        progressItemId: item.id,
      }));
    }
  }

  for (const [noteId, note] of Object.entries(database.notes)) {
    if (note.id !== noteId) throw new Error(`Note ${noteId} identity does not match its map key`);
    if (!database.games[note.gameId]) throw new Error(`Note ${noteId} has missing game ownership`);
    note.attachments.forEach((attachment, attachmentIndex) => {
      if (attachment.type === "image") {
        append(note.gameId, attachment.assetId, "image", (originalName) => ({
          role: "note-image",
          gameId: note.gameId,
          assetId: attachment.assetId,
          originalName,
          noteId,
          attachmentIndex,
          alt: attachment.alt,
        }));
      } else if (attachment.type === "file") {
        append(note.gameId, attachment.assetId, "file", (originalName, mime) => ({
          role: "note-file",
          gameId: note.gameId,
          assetId: attachment.assetId,
          originalName,
          noteId,
          attachmentIndex,
          label: attachment.label,
          mime: mime ?? "",
        }));
      }
    });
  }

  return [...occurrences.values()]
    .sort((left, right) => compareText(left.gameId, right.gameId) || compareText(left.assetId, right.assetId))
    .map((occurrence) => ({ ...occurrence, references: [...occurrence.references].sort(compareReferences) }) as SourceAssetOccurrence);
}

function noteImageKey(reference: Extract<SourceAssetReference, { role: "note-image" }>): readonly (string | number)[] {
  return [reference.gameId, reference.noteId, reference.attachmentIndex];
}

function compareNoteImages(
  left: Extract<SourceAssetReference, { role: "note-image" }>,
  right: Extract<SourceAssetReference, { role: "note-image" }>,
): number {
  const leftKey = noteImageKey(left);
  const rightKey = noteImageKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const leftPart = leftKey[index];
    const rightPart = rightKey[index];
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") return leftPart - rightPart;
    return compareText(String(leftPart), String(rightPart));
  }
  return 0;
}

export function inspectSourceAsset(
  occurrences: readonly SourceAssetOccurrence[],
  bytes: Uint8Array,
): Asset {
  if (occurrences.length === 0) throw new Error("Source asset occurrence input is empty");
  const assetId = occurrences[0].assetId;
  const kind = occurrences[0].kind;
  const originalName = occurrences[0].originalName;
  if (!SHA256.test(assetId)) throw new Error("Source asset ID must be a lowercase SHA-256");
  if (!originalName) throw new Error("Source asset originalName must not be empty");

  const seenOccurrences = new Set<string>();
  const covers: Extract<SourceAssetReference, { role: "cover" }>[] = [];
  const noteImages: Extract<SourceAssetReference, { role: "note-image" }>[] = [];
  let hasProgressIcon = false;
  let fileMime: string | undefined;

  for (const occurrence of occurrences) {
    if (!SHA256.test(occurrence.assetId)) throw new Error("Source asset ID must be a lowercase SHA-256");
    if (occurrence.assetId !== assetId) throw new Error("All source occurrences must have the same SHA identity");
    if (occurrence.kind !== kind) throw new Error("Source asset occurrences mix image and file kinds");
    if (occurrence.originalName !== originalName) throw new Error("Source asset occurrences disagree on originalName");
    const occurrenceKey = `${occurrence.gameId}\u0000${occurrence.assetId}`;
    if (seenOccurrences.has(occurrenceKey)) throw new Error(`Duplicate source asset occurrence for gameId ${occurrence.gameId}`);
    seenOccurrences.add(occurrenceKey);
    if (occurrence.references.length === 0) throw new Error("Source asset occurrence has no owner provenance");

    for (const reference of occurrence.references) {
      if (reference.gameId !== occurrence.gameId || reference.assetId !== assetId) {
        throw new Error("Source asset reference gameId/assetId provenance mismatch");
      }
      if (reference.originalName !== originalName) throw new Error("Source asset reference originalName provenance mismatch");
      const imageRole = reference.role === "cover" || reference.role === "progress-icon" || reference.role === "note-image";
      if ((kind === "image") !== imageRole) throw new Error("Source asset reference role does not match its image/file kind");
      if (reference.role === "cover") covers.push(reference);
      else if (reference.role === "progress-icon") hasProgressIcon = true;
      else if (reference.role === "note-image") noteImages.push(reference);
      else {
        if (!reference.mime) throw new Error("Source file occurrence MIME must not be empty");
        if (fileMime !== undefined && reference.mime !== fileMime) throw new Error("Source file occurrences disagree on MIME");
        fileMime = reference.mime;
      }
    }
  }

  const coverAlt = covers[0]?.alt;
  if (covers.some((cover) => cover.alt !== coverAlt)) throw new Error("Source image cover owners disagree on cover alt");
  const actualSha = sha256Bytes(bytes);
  if (actualSha !== assetId) throw new Error(`Source asset SHA mismatch: expected ${assetId}, got ${actualSha}`);

  if (kind === "file") {
    if (!fileMime) throw new Error("Source file occurrence has no MIME provenance");
    return { id: assetId, kind: "file", mime: fileMime, byteLength: bytes.byteLength, originalName };
  }

  const { width, height } = parseWebPDimensions(bytes);
  if (width > MAX_WEBP_DIMENSION || height > MAX_WEBP_DIMENSION) {
    throw new Error(
      `Source image dimensions ${width}×${height} exceed the schema-2 runtime limit ${MAX_WEBP_DIMENSION}×${MAX_WEBP_DIMENSION}`,
    );
  }
  if (hasProgressIcon && (width !== 64 || height !== 64)) {
    throw new Error(`Progress icon WebP must be exactly 64×64, got ${width}×${height}`);
  }
  noteImages.sort(compareNoteImages);
  return {
    id: assetId,
    kind: "image",
    mime: "image/webp",
    width,
    height,
    byteLength: bytes.byteLength,
    alt: coverAlt ?? noteImages[0]?.alt ?? "",
    originalName,
  };
}
