import {
  assertSourceRepresentable,
  assertValidPublishedLibrary,
  canonicalStringify,
  normalizeLibraryDatabase,
  normalizePublishedLibrary,
  runtimeAssetFilename,
  type Asset,
  type Game,
  type LibraryDatabase,
  type Note,
} from "../domain";
import { inspectSourceAsset } from "./assetFacts";
import { parseGameYaml, parseManifestYaml } from "./metadata";
import { parseNoteDocument } from "./noteDocument";
import { projectSourceTree, validateProjectedSourceInventory } from "./project";
import type {
  PublishedLibraryEnvelope,
  SourceAssembly,
  SourceAssetOccurrence,
  SourceAssetReference,
  SourceGameV1,
  SourceNoteMetadataV1,
  SourceTreeEntry,
  SourceTreeReader,
} from "./types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SHA256 = "[0-9a-f]{64}";
const GAME_DIRECTORY = new RegExp(`^(.+)_(${UUID})$`);
const NOTE_FILENAME = new RegExp(`^(.+)_(${UUID})\\.md$`);
const ASSET_FILENAME = new RegExp(`^(.+)_(${SHA256})\\.([A-Za-z0-9]+)$`);
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SOURCE_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message: string): never {
  throw new Error(`Source assembly: ${message}`);
}

function safeRepositoryPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length === 0) fail("inventory path must be a nonempty string");
  if (path.startsWith("/") || path.includes("\\")) fail(`unsafe inventory path ${path}`);
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`unsafe inventory path segment ${path}`);
  }
}

function isSourcePath(path: string): boolean {
  return path === "data" || path.startsWith("data/");
}

function validateGitMetadata(entries: readonly SourceTreeEntry[]): void {
  const hasGit = entries.some((entry) => entry.git !== undefined);
  if (!hasGit) return;
  let objectIdLength: number | undefined;
  for (const entry of entries) {
    if (!entry.git) fail(`Git metadata is missing for ${entry.path}`);
    const expectedMode = entry.kind === "directory" ? "040000" : "100644";
    const expectedType = entry.kind === "directory" ? "tree" : "blob";
    if (entry.git.mode !== expectedMode || entry.git.type !== expectedType) fail(`invalid Git mode/type for ${entry.path}`);
    if (!GIT_OBJECT_ID.test(entry.git.objectId)) fail(`invalid Git object ID for ${entry.path}`);
    if (objectIdLength !== undefined && entry.git.objectId.length !== objectIdLength) fail("mixed Git object ID lengths");
    objectIdLength = entry.git.objectId.length;
  }
}

interface StructuralTree {
  entries: readonly SourceTreeEntry[];
  files: readonly string[];
  gameDirectories: readonly string[];
}

function validateStructuralTree(allEntries: readonly SourceTreeEntry[]): StructuralTree {
  const entries: SourceTreeEntry[] = [];
  const exact = new Map<string, SourceTreeEntry>();
  const folded = new Map<string, string>();
  for (const entry of allEntries) {
    safeRepositoryPath(entry.path);
    if (!isSourcePath(entry.path)) fail(`unexpected inventory path outside data/**: ${entry.path}`);
    if (exact.has(entry.path)) fail(`duplicate source path ${entry.path}`);
    const caseKey = entry.path.toLocaleLowerCase("en-US");
    const otherCase = folded.get(caseKey);
    if (otherCase !== undefined && otherCase !== entry.path) fail(`case-colliding source paths ${otherCase} and ${entry.path}`);
    if (entry.kind !== "file" && entry.kind !== "directory") fail(`unsupported source entry kind ${entry.kind} at ${entry.path}`);
    exact.set(entry.path, entry);
    folded.set(caseKey, entry.path);
    entries.push(entry);
  }
  validateGitMetadata(entries);

  const data = exact.get("data");
  const manifest = exact.get("data/manifest.yaml");
  if (data?.kind !== "directory") fail("data directory is missing");
  if (manifest?.kind !== "file") fail("data/manifest.yaml is missing");

  const gameDirectories: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (entry.kind === "file") files.push(entry.path);
    if (entry.path === "data" || entry.path === "data/manifest.yaml" || entry.path === "data/games") continue;
    if (parts[1] !== "games") fail(`unknown source entry ${entry.path}`);
    if (parts.length === 3 && entry.kind === "directory") {
      if (!GAME_DIRECTORY.test(parts[2])) fail(`invalid game directory identity ${entry.path}`);
      gameDirectories.push(entry.path);
      continue;
    }
    if (parts.length === 4) {
      const allowed = entry.kind === "file" && parts[3] === "game.yaml"
        || entry.kind === "directory" && (parts[3] === "notes" || parts[3] === "assets");
      if (!allowed) fail(`unknown game source entry ${entry.path}`);
      continue;
    }
    if (parts.length === 5 && entry.kind === "file" && (parts[3] === "notes" || parts[3] === "assets")) continue;
    fail(`unknown nested source entry ${entry.path}`);
  }

  const gamesDirectory = exact.get("data/games");
  if (gameDirectories.length === 0) {
    if (gamesDirectory !== undefined) fail("empty data/games directory has no semantic meaning");
  } else if (gamesDirectory?.kind !== "directory") fail("data/games directory is missing");

  for (const directory of gameDirectories) {
    if (exact.get(`${directory}/game.yaml`)?.kind !== "file") fail(`missing ${directory}/game.yaml`);
    for (const optional of ["notes", "assets"] as const) {
      const optionalPath = `${directory}/${optional}`;
      const directoryEntry = exact.get(optionalPath);
      const children = entries.filter((entry) => entry.path.startsWith(`${optionalPath}/`));
      if (directoryEntry && children.length === 0) fail(`empty optional directory ${optionalPath}`);
      if (!directoryEntry && children.length > 0) fail(`missing directory entry ${optionalPath}`);
    }
  }

  for (const entry of entries) {
    if (entry.path === "data") continue;
    const parentPath = entry.path.slice(0, entry.path.lastIndexOf("/"));
    if (exact.get(parentPath)?.kind !== "directory") fail(`missing parent directory ${parentPath}`);
  }
  return {
    entries: entries.sort((left, right) => compareText(left.path, right.path)),
    files: files.sort(compareText),
    gameDirectories: gameDirectories.sort(compareText),
  };
}

function pathFilename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function parseIdentity(pattern: RegExp, value: string, kind: string): string {
  const match = pattern.exec(value);
  if (!match) fail(`invalid ${kind} path identity ${value}`);
  return match[2];
}

async function readText(reader: SourceTreeReader, path: string): Promise<string> {
  const bytes = await reader.readFile(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`fatal UTF-8 decode failed for ${path}: ${message}`);
  }
}

function runtimeGame(source: SourceGameV1): Game {
  const game: Game = {
    id: source.id,
    title: source.title,
    coverAssetId: source.cover?.assetId ?? null,
    platforms: [...source.platforms],
    tags: [...source.tags],
    status: source.status,
    placement: { ...source.placement },
    reviewMarkdown: source.reviewMarkdown,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
  if (source.progressItems?.length) {
    game.progressItems = source.progressItems.map((item) => ({
      id: item.id,
      iconAssetId: item.icon.assetId,
      noteId: item.noteId,
    }));
  }
  return game;
}

function runtimeNote(metadata: SourceNoteMetadataV1, gameId: string, bodyMarkdown: string): Note {
  const note: Note = {
    id: metadata.id,
    gameId,
    bodyMarkdown,
    attachments: (metadata.attachments ?? []).map((attachment) => {
      if (attachment.type === "image") return { type: "image" as const, assetId: attachment.assetId, alt: attachment.alt };
      if (attachment.type === "file") return { type: "file" as const, assetId: attachment.assetId, label: attachment.label };
      return { ...attachment };
    }),
    rank: metadata.rank,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
  if (metadata.groupRank !== undefined) note.groupRank = metadata.groupRank;
  if (metadata.doubleWidth !== undefined) note.doubleWidth = metadata.doubleWidth;
  if (metadata.doubleHeight !== undefined) note.doubleHeight = metadata.doubleHeight;
  if (metadata.collapsedChecklistSections !== undefined) note.collapsedChecklistSections = [...metadata.collapsedChecklistSections];
  return note;
}

interface ParsedGameDirectory {
  gameId: string;
  directory: string;
  source: SourceGameV1;
  assetFiles: Map<string, { path: string; filename: string }>;
  notes: readonly { metadata: SourceNoteMetadataV1; bodyMarkdown: string }[];
}

async function parseGameDirectory(
  reader: SourceTreeReader,
  structural: StructuralTree,
  directory: string,
): Promise<ParsedGameDirectory> {
  const directoryGameId = parseIdentity(GAME_DIRECTORY, pathFilename(directory), "game directory");
  const source = parseGameYaml(await readText(reader, `${directory}/game.yaml`));
  if (source.id !== directoryGameId) fail(`game YAML id ${source.id} does not match directory UUID ${directoryGameId}`);

  const assetFiles = new Map<string, { path: string; filename: string }>();
  for (const path of structural.files.filter((candidate) => candidate.startsWith(`${directory}/assets/`))) {
    const filename = pathFilename(path);
    const assetId = parseIdentity(ASSET_FILENAME, filename, "asset filename");
    if (assetFiles.has(assetId)) fail(`duplicate owning-game binary occurrence ${directoryGameId}/${assetId}`);
    assetFiles.set(assetId, { path, filename });
  }
  const assetNames = new Map([...assetFiles].map(([assetId, file]) => [assetId, file.filename]));
  const notes: { metadata: SourceNoteMetadataV1; bodyMarkdown: string }[] = [];
  for (const path of structural.files.filter((candidate) => candidate.startsWith(`${directory}/notes/`)).sort(compareText)) {
    const noteId = parseIdentity(NOTE_FILENAME, pathFilename(path), "note filename");
    const document = parseNoteDocument(await readText(reader, path), path, assetNames);
    if (document.metadata.id !== noteId) fail(`note metadata id ${document.metadata.id} does not match filename UUID ${noteId}`);
    notes.push(document);
  }
  return { gameId: directoryGameId, directory, source, assetFiles, notes };
}

type MutableOccurrence = {
  gameId: string;
  assetId: string;
  kind: "image" | "file";
  originalName: string;
  references: SourceAssetReference[];
};

function sourceCommitSha(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !SOURCE_COMMIT_SHA.test(value)) {
    fail("sourceCommitSha must be null or a lowercase 40/64-character hex object ID");
  }
  return value;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export async function assembleSourceTree(
  reader: SourceTreeReader,
  options: { sourceCommitSha: string | null },
): Promise<SourceAssembly> {
  const commitSha = sourceCommitSha(options.sourceCommitSha);
  const structural = validateStructuralTree(await reader.listEntries());
  const manifest = parseManifestYaml(await readText(reader, "data/manifest.yaml"));
  const parsedGames: ParsedGameDirectory[] = [];
  for (const directory of structural.gameDirectories) parsedGames.push(await parseGameDirectory(reader, structural, directory));

  const games: Record<string, Game> = {};
  const notes: Record<string, Note> = {};
  const mutableOccurrences = new Map<string, MutableOccurrence>();
  const sourceBinaryPaths = new Map<string, string>();

  for (const parsed of parsedGames) {
    if (games[parsed.gameId]) fail(`duplicate game identity ${parsed.gameId}`);
    games[parsed.gameId] = runtimeGame(parsed.source);
    for (const [assetId, file] of parsed.assetFiles) sourceBinaryPaths.set(`${parsed.gameId}\0${assetId}`, file.path);
    for (const document of parsed.notes) {
      if (notes[document.metadata.id]) fail(`duplicate note identity ${document.metadata.id}`);
      notes[document.metadata.id] = runtimeNote(document.metadata, parsed.gameId, document.bodyMarkdown);
    }
  }

  const append = (
    gameId: string,
    assetId: string,
    kind: "image" | "file",
    originalName: string,
    reference: SourceAssetReference,
  ): void => {
    const key = `${gameId}\0${assetId}`;
    if (!sourceBinaryPaths.has(key)) fail(`asset ${assetId} has no binary occurrence in owning game ${gameId}`);
    const previous = mutableOccurrences.get(key);
    if (previous && (previous.kind !== kind || previous.originalName !== originalName)) {
      fail(`asset ${assetId} has incompatible owning-game source facts`);
    }
    const occurrence = previous ?? { gameId, assetId, kind, originalName, references: [] };
    occurrence.references.push(reference);
    mutableOccurrences.set(key, occurrence);
  };

  for (const parsed of parsedGames) {
    if (parsed.source.cover) {
      const cover = parsed.source.cover;
      append(parsed.gameId, cover.assetId, "image", cover.originalName, {
        role: "cover", gameId: parsed.gameId, assetId: cover.assetId, originalName: cover.originalName, alt: cover.alt,
      });
    }
    for (const item of parsed.source.progressItems ?? []) {
      const note = notes[item.noteId];
      if (!note || note.gameId !== parsed.gameId) fail(`progress item ${item.id} references a note outside its game`);
      append(parsed.gameId, item.icon.assetId, "image", item.icon.originalName, {
        role: "progress-icon",
        gameId: parsed.gameId,
        assetId: item.icon.assetId,
        originalName: item.icon.originalName,
        progressItemId: item.id,
      });
    }
    for (const document of parsed.notes) {
      for (const [attachmentIndex, attachment] of (document.metadata.attachments ?? []).entries()) {
        if (attachment.type === "link") continue;
        if (attachment.type === "image") {
          append(parsed.gameId, attachment.assetId, "image", attachment.originalName, {
            role: "note-image",
            gameId: parsed.gameId,
            assetId: attachment.assetId,
            originalName: attachment.originalName,
            noteId: document.metadata.id,
            attachmentIndex,
            alt: attachment.alt,
          });
        } else {
          append(parsed.gameId, attachment.assetId, "file", attachment.originalName, {
            role: "note-file",
            gameId: parsed.gameId,
            assetId: attachment.assetId,
            originalName: attachment.originalName,
            noteId: document.metadata.id,
            attachmentIndex,
            label: attachment.label,
            mime: attachment.mime,
          });
        }
      }
    }
  }
  for (const key of sourceBinaryPaths.keys()) {
    if (!mutableOccurrences.has(key)) fail(`unreferenced source binary ${sourceBinaryPaths.get(key)}`);
  }

  const occurrences = [...mutableOccurrences.values()]
    .sort((left, right) => compareText(left.gameId, right.gameId) || compareText(left.assetId, right.assetId))
    .map((occurrence): SourceAssetOccurrence => ({ ...occurrence }) as SourceAssetOccurrence);
  const occurrencesByAsset = new Map<string, SourceAssetOccurrence[]>();
  for (const occurrence of occurrences) {
    const grouped = occurrencesByAsset.get(occurrence.assetId) ?? [];
    grouped.push(occurrence);
    occurrencesByAsset.set(occurrence.assetId, grouped);
  }

  const assets: Record<string, Asset> = {};
  const bytesByAsset = new Map<string, Uint8Array>();
  for (const assetId of [...occurrencesByAsset.keys()].sort(compareText)) {
    const grouped = occurrencesByAsset.get(assetId)!;
    let canonicalBytes: Uint8Array | undefined;
    for (const occurrence of grouped) {
      const path = sourceBinaryPaths.get(`${occurrence.gameId}\0${assetId}`)!;
      const bytes = await reader.readFile(path);
      if (canonicalBytes && !sameBytes(canonicalBytes, bytes)) fail(`shared asset ${assetId} has byte disagreement across games`);
      canonicalBytes ??= bytes.slice();
    }
    assets[assetId] = inspectSourceAsset(grouped, canonicalBytes!);
    bytesByAsset.set(assetId, canonicalBytes!);
  }

  const database = await normalizePublishedLibrary({
    schemaVersion: manifest.schemaVersion,
    revision: "",
    publicationId: manifest.publicationId,
    games,
    notes,
    assets,
  });
  const canonicalProjection = await projectSourceTree(database);
  validateProjectedSourceInventory(canonicalProjection, structural.entries);

  const runtimeMedia = new Map<string, Uint8Array>();
  for (const assetId of Object.keys(database.assets).sort(compareText)) {
    runtimeMedia.set(runtimeAssetFilename(database.assets[assetId]), bytesByAsset.get(assetId)!.slice());
  }
  const envelope = { sourceCommitSha: commitSha, database };
  return { database, envelope, runtimeMedia, sourceAssetOccurrences: occurrences.length };
}

export function parsePublishedLibraryEnvelope(value: unknown): PublishedLibraryEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("published envelope must be an object");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "database" || keys[1] !== "sourceCommitSha") {
    fail("published envelope must contain exactly sourceCommitSha and database");
  }
  const commitSha = sourceCommitSha(record.sourceCommitSha);
  try {
    assertValidPublishedLibrary(record.database);
    assertSourceRepresentable(record.database as LibraryDatabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`published database is invalid: ${message}`);
  }
  const normalized = normalizeLibraryDatabase(record.database as LibraryDatabase);
  if (canonicalStringify(normalized) !== canonicalStringify(record.database)) {
    fail("published database must already be in canonical normalized form");
  }
  if (normalized.publicationId === null) fail("published database publicationId must be a manifest UUID");
  return { sourceCommitSha: commitSha, database: normalized };
}
