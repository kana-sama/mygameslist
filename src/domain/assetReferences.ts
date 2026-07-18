import type { LibraryDatabase } from "./types";

export function referencedAssetIds(database: Pick<LibraryDatabase, "games" | "notes">): Set<string> {
  const referenced = new Set<string>();
  for (const game of Object.values(database.games)) {
    if (game.coverAssetId) referenced.add(game.coverAssetId);
  }
  for (const note of Object.values(database.notes)) {
    for (const attachment of note.attachments) {
      if (attachment.type === "image" || attachment.type === "file") referenced.add(attachment.assetId);
    }
  }
  return referenced;
}

export function unreferencedAssetIds(database: LibraryDatabase): string[] {
  const referenced = referencedAssetIds(database);
  return Object.keys(database.assets).filter((id) => !referenced.has(id)).sort();
}

export function garbageCollectUnreferencedAssets(database: LibraryDatabase): string[] {
  const removed = unreferencedAssetIds(database);
  for (const id of removed) delete database.assets[id];
  return removed;
}
