import {
  assertSourceRepresentable,
  assertValidPublishedLibrary,
  canonicalStringify,
  normalizeLibraryDatabase,
  normalizePublishedLibrary,
  type LibraryDatabase,
  type Note,
} from "../domain";
import { collectSourceAssetOccurrences } from "./assetFacts";
import { serializeGameYaml, serializeManifestYaml } from "./metadata";
import { serializeNoteDocument } from "./noteDocument";
import { deriveNoteFilename, gameSourceDirectoryName, sourceAssetFilename } from "./paths";
import {
  SOURCE_VERSION,
  type ProjectedGameBundle,
  type ProjectedSourceLeaf,
  type SourceAssetOccurrence,
  type SourceGameV1,
  type SourceNoteAttachmentV1,
  type SourceNoteMetadataV1,
  type SourceProjection,
  type SourceTreeEntry,
  type ValidatedSourceInventory,
} from "./types";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceFailure(message: string): never {
  throw new Error(`Source projection: ${message}`);
}

function assertCanonicalProjectionInput(database: LibraryDatabase): void {
  try {
    assertValidPublishedLibrary(database);
    assertSourceRepresentable(database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sourceFailure(`database is not a valid normalized published source database: ${message}`);
  }
  const normalized = normalizeLibraryDatabase(database);
  if (canonicalStringify(normalized) !== canonicalStringify(database)) {
    sourceFailure("database is not normalized");
  }
  if (database.publicationId === null) sourceFailure("publicationId is required by the source manifest");
}

interface ProjectionContext {
  occurrencesByGame: ReadonlyMap<string, readonly SourceAssetOccurrence[]>;
  notesByGame: ReadonlyMap<string, readonly Note[]>;
}

function projectionContext(database: LibraryDatabase): ProjectionContext {
  const occurrencesByGame = new Map<string, SourceAssetOccurrence[]>();
  for (const occurrence of collectSourceAssetOccurrences(database)) {
    const occurrences = occurrencesByGame.get(occurrence.gameId);
    if (occurrences) occurrences.push(occurrence);
    else occurrencesByGame.set(occurrence.gameId, [occurrence]);
  }

  const notesByGame = new Map<string, Note[]>();
  for (const note of Object.values(database.notes)) {
    const notes = notesByGame.get(note.gameId);
    if (notes) notes.push(note);
    else notesByGame.set(note.gameId, [note]);
  }
  for (const notes of notesByGame.values()) notes.sort((left, right) => compareText(left.id, right.id));

  return { occurrencesByGame, notesByGame };
}

function gameSourceValue(
  database: LibraryDatabase,
  gameId: string,
  occurrences: readonly SourceAssetOccurrence[],
): SourceGameV1 {
  const game = database.games[gameId];
  const result: SourceGameV1 = {
    id: game.id,
    title: game.title,
    platforms: [...game.platforms],
    tags: [...game.tags],
    status: game.status,
    placement: { ...game.placement },
    reviewMarkdown: game.reviewMarkdown,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
  if (game.coverAssetId) {
    const asset = database.assets[game.coverAssetId];
    if (!asset || asset.kind !== "image") sourceFailure(`game ${gameId} cover asset is missing or is not an image`);
    result.cover = { assetId: asset.id, alt: asset.alt, originalName: asset.originalName };
  }
  if (game.progressItems?.length) {
    result.progressItems = game.progressItems.map((item) => {
      const occurrence = occurrences.find((candidate) => candidate.assetId === item.iconAssetId);
      if (!occurrence || occurrence.kind !== "image") {
        sourceFailure(`progress item ${item.id} has no owning-game image occurrence`);
      }
      return {
        id: item.id,
        icon: { assetId: item.iconAssetId, originalName: occurrence.originalName },
        noteId: item.noteId,
      };
    });
  }
  return result;
}

function noteSourceValue(database: LibraryDatabase, note: Note): SourceNoteMetadataV1 {
  const metadata: SourceNoteMetadataV1 = {
    id: note.id,
    rank: note.rank,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  if (note.groupRank !== undefined) metadata.groupRank = note.groupRank;
  if (note.doubleWidth !== undefined) metadata.doubleWidth = note.doubleWidth;
  if (note.doubleHeight !== undefined) metadata.doubleHeight = note.doubleHeight;
  if (note.collapsedChecklistSections !== undefined) {
    metadata.collapsedChecklistSections = [...note.collapsedChecklistSections];
  }
  if (note.attachments.length) {
    metadata.attachments = note.attachments.map((attachment): SourceNoteAttachmentV1 => {
      if (attachment.type === "link") return { ...attachment };
      const asset = database.assets[attachment.assetId];
      if (!asset) sourceFailure(`note ${note.id} attachment asset ${attachment.assetId} is missing`);
      if (attachment.type === "image") {
        if (asset.kind !== "image") sourceFailure(`note ${note.id} image attachment has a non-image asset`);
        return { ...attachment, originalName: asset.originalName };
      }
      if (asset.kind !== "file") sourceFailure(`note ${note.id} file attachment has a non-file asset`);
      return { ...attachment, originalName: asset.originalName, mime: asset.mime };
    });
  }
  return metadata;
}

function projectCanonicalGameSourceBundle(
  database: LibraryDatabase,
  gameId: string,
  context: ProjectionContext,
): ProjectedGameBundle {
  const game = database.games[gameId];
  if (!game) sourceFailure(`game ${gameId} does not exist`);

  const directoryPath = `data/games/${gameSourceDirectoryName(game)}`;
  const occurrences = context.occurrencesByGame.get(gameId) ?? [];
  const assetLeaves = occurrences.map((occurrence) => {
    const asset = database.assets[occurrence.assetId];
    const filename = sourceAssetFilename(occurrence, asset);
    return {
      kind: "binary" as const,
      path: `${directoryPath}/assets/${filename}`,
      logicalId: `asset:${gameId}:${occurrence.assetId}`,
      assetId: occurrence.assetId,
      byteLength: asset.byteLength,
    };
  }).sort((left, right) => compareText(left.path, right.path));
  const assetNames = new Map(assetLeaves.map((leaf) => [leaf.assetId, leaf.path.slice(leaf.path.lastIndexOf("/") + 1)]));

  const gameLeaf: ProjectedSourceLeaf = {
    kind: "text",
    path: `${directoryPath}/game.yaml`,
    logicalId: `game:${gameId}`,
    text: serializeGameYaml(gameSourceValue(database, gameId, occurrences)),
  };
  const noteLeaves = (context.notesByGame.get(gameId) ?? [])
    .map((note): ProjectedSourceLeaf => ({
      kind: "text",
      path: `${directoryPath}/notes/${deriveNoteFilename(note)}`,
      logicalId: `note:${note.id}`,
      text: serializeNoteDocument({ metadata: noteSourceValue(database, note), bodyMarkdown: note.bodyMarkdown }, assetNames),
    }));

  return {
    gameId,
    directoryPath,
    leaves: [gameLeaf, ...noteLeaves, ...assetLeaves],
    assetOccurrences: occurrences,
  };
}

export function projectGameSourceBundle(database: LibraryDatabase, gameId: string): ProjectedGameBundle {
  assertCanonicalProjectionInput(database);
  return projectCanonicalGameSourceBundle(database, gameId, projectionContext(database));
}

export async function projectSourceTree(database: LibraryDatabase): Promise<SourceProjection> {
  const normalized = await normalizePublishedLibrary(database);
  if (normalized.publicationId === null) sourceFailure("publicationId is required by the source manifest");
  const context = projectionContext(normalized);

  const manifest: ProjectedSourceLeaf = {
    kind: "text",
    path: "data/manifest.yaml",
    logicalId: "manifest",
    text: serializeManifestYaml({
      sourceVersion: SOURCE_VERSION,
      schemaVersion: normalized.schemaVersion,
      publicationId: normalized.publicationId,
    }),
  };
  const gameBundles = new Map<string, ProjectedGameBundle>();
  for (const gameId of Object.keys(normalized.games).sort(compareText)) {
    gameBundles.set(gameId, projectCanonicalGameSourceBundle(normalized, gameId, context));
  }
  return {
    database: normalized,
    leaves: [manifest, ...[...gameBundles.values()].flatMap((bundle) => bundle.leaves)],
    gameBundles,
  };
}

function assertSafeInventoryPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path.length === 0) throw new Error("Source inventory path must be a nonempty string");
  if (path.startsWith("/") || path.includes("\\")) throw new Error(`Unsafe source inventory path: ${path}`);
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Unsafe source inventory path segment: ${path}`);
  }
  if (segments[0] !== "data") throw new Error(`Unexpected path outside data/** inventory: ${path}`);
}

function requiredInventory(projection: SourceProjection): Map<string, "file" | "directory"> {
  const required = new Map<string, "file" | "directory">();
  for (const leaf of projection.leaves) {
    assertSafeInventoryPath(leaf.path);
    const segments = leaf.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join("/");
      if (required.get(directory) === "file") throw new Error(`Projected file occupies required directory ${directory}`);
      required.set(directory, "directory");
    }
    if (required.has(leaf.path)) throw new Error(`Duplicate projected source path ${leaf.path}`);
    required.set(leaf.path, "file");
  }
  return required;
}

function optionalOpaqueInventory(projection: SourceProjection): Map<string, string> {
  return new Map(
    [...projection.gameBundles.values()].map((bundle) => [`${bundle.directoryPath}/styles.css`, bundle.gameId]),
  );
}

function validateGitEntry(entry: SourceTreeEntry, objectIdLength: number | undefined): number {
  if (!entry.git) throw new Error(`Git metadata is missing for ${entry.path}`);
  const expectedMode = entry.kind === "directory" ? "040000" : "100644";
  const expectedType = entry.kind === "directory" ? "tree" : "blob";
  if (entry.git.mode !== expectedMode || entry.git.type !== expectedType) {
    throw new Error(`Invalid Git mode/type for ${entry.path}`);
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(entry.git.objectId)) {
    throw new Error(`Invalid Git object ID for ${entry.path}`);
  }
  const length = entry.git.objectId.length;
  if (objectIdLength !== undefined && length !== objectIdLength) throw new Error("Mixed Git object ID lengths are not allowed");
  return length;
}

export function validateProjectedSourceInventory(
  projection: SourceProjection,
  entries: readonly SourceTreeEntry[],
): ValidatedSourceInventory {
  const required = requiredInventory(projection);
  const optionalOpaque = optionalOpaqueInventory(projection);
  for (const entry of entries) assertSafeInventoryPath(entry.path);
  const actual = new Map<string, SourceTreeEntry>();
  const casePaths = new Map<string, string>();
  const hasGitMetadata = entries.some((entry) => entry.git !== undefined);
  let objectIdLength: number | undefined;

  for (const entry of entries) {
    assertSafeInventoryPath(entry.path);
    if (actual.has(entry.path)) throw new Error(`Duplicate source inventory path ${entry.path}`);
    const caseKey = entry.path.toLocaleLowerCase("en-US");
    const previousCase = casePaths.get(caseKey);
    if (previousCase !== undefined && previousCase !== entry.path) {
      throw new Error(`Case-colliding source paths ${previousCase} and ${entry.path}`);
    }
    casePaths.set(caseKey, entry.path);
    if (entry.kind !== "file" && entry.kind !== "directory") {
      throw new Error(`Unsupported source inventory entry kind ${entry.kind} at ${entry.path}`);
    }
    const expectedKind = required.get(entry.path) ?? (optionalOpaque.has(entry.path) ? "file" : undefined);
    if (expectedKind === undefined) throw new Error(`Unexpected source inventory entry ${entry.path}`);
    if (entry.kind !== expectedKind) throw new Error(`Wrong source inventory kind for ${entry.path}`);
    if (hasGitMetadata) objectIdLength = validateGitEntry(entry, objectIdLength);
    actual.set(entry.path, entry);
  }
  for (const path of required.keys()) {
    if (!actual.has(path)) throw new Error(`Missing source inventory entry ${path}`);
  }

  const blobShasByPath = new Map<string, string>();
  if (hasGitMetadata) {
    for (const leaf of projection.leaves) blobShasByPath.set(leaf.path, actual.get(leaf.path)!.git!.objectId);
  }
  const optionalGameStylesByGameId = new Map<string, { path: string; blobSha: string | null }>();
  for (const [path, gameId] of optionalOpaque) {
    const entry = actual.get(path);
    if (entry) optionalGameStylesByGameId.set(gameId, { path, blobSha: entry.git?.objectId ?? null });
  }
  const assetOccurrences = [...projection.gameBundles.values()].flatMap((bundle) => bundle.assetOccurrences);
  return {
    entries: [...actual.values()].sort((left, right) => compareText(left.path, right.path)),
    blobShasByPath,
    optionalGameStylesByGameId,
    assetOccurrences,
  };
}
