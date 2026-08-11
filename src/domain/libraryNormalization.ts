import { withComputedRevision } from "./canonical";
import { deriveImageAssetAltFromOwners, indexAssetOwners } from "./assetOwnership";
import { referencedAssetIds } from "./assetReferences";
import type { LibraryDatabase } from "./types";
import { assertSourceRepresentable, assertValidLibrary } from "./validation";

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

export function normalizeLibraryDatabase(database: LibraryDatabase): LibraryDatabase {
  const normalized = structuredClone(database);

  for (const game of Object.values(normalized.games)) {
    if (game.progressItems?.length === 0) delete game.progressItems;
  }
  for (const note of Object.values(normalized.notes)) {
    if (note.groupRank === 1024) delete note.groupRank;
    if (note.doubleWidth === false) delete note.doubleWidth;
    if (note.doubleHeight === false) delete note.doubleHeight;
    if (note.collapsedChecklistSections?.length === 0) delete note.collapsedChecklistSections;
  }

  const referenced = referencedAssetIds(normalized);
  for (const assetId of Object.keys(normalized.assets)) {
    if (!referenced.has(assetId)) delete normalized.assets[assetId];
  }
  const assetOwners = indexAssetOwners(normalized);
  for (const asset of Object.values(normalized.assets)) {
    if (asset.kind === "image") asset.alt = deriveImageAssetAltFromOwners(assetOwners.get(asset.id));
  }

  normalized.games = sortedRecord(normalized.games);
  normalized.notes = sortedRecord(normalized.notes);
  normalized.assets = sortedRecord(normalized.assets);
  assertValidLibrary(normalized);
  return normalized;
}

export async function normalizePublishedLibrary(database: LibraryDatabase): Promise<LibraryDatabase> {
  const normalized = normalizeLibraryDatabase(database);
  assertSourceRepresentable(normalized);
  return withComputedRevision(normalized);
}
