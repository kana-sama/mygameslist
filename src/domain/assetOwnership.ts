import type { Asset, LibraryDatabase } from "./types";

export type AssetOwner =
  | { role: "cover"; gameId: string; alt: string; originalName: string }
  | { role: "progress"; gameId: string; progressItemId: string; originalName: string }
  | { role: "note-image"; gameId: string; noteId: string; index: number; alt: string; originalName: string }
  | { role: "note-file"; gameId: string; noteId: string; index: number; label: string; originalName: string; mime: string };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ownerKey(owner: AssetOwner): readonly (string | number)[] {
  const roleOrder = { cover: 0, progress: 1, "note-image": 2, "note-file": 3 } as const;
  if (owner.role === "cover") return [owner.gameId, roleOrder[owner.role]];
  if (owner.role === "progress") return [owner.gameId, roleOrder[owner.role], owner.progressItemId];
  return [owner.gameId, roleOrder[owner.role], owner.noteId, owner.index];
}

function compareOwners(left: AssetOwner, right: AssetOwner): number {
  const leftKey = ownerKey(left);
  const rightKey = ownerKey(right);
  for (let index = 0; index < Math.max(leftKey.length, rightKey.length); index += 1) {
    const leftPart = leftKey[index];
    const rightPart = rightKey[index];
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") return leftPart - rightPart;
    return compareText(String(leftPart ?? ""), String(rightPart ?? ""));
  }
  return 0;
}

function append(index: Map<string, AssetOwner[]>, assetId: string, owner: AssetOwner): void {
  const owners = index.get(assetId);
  if (owners) owners.push(owner);
  else index.set(assetId, [owner]);
}

function imageAsset(database: LibraryDatabase, assetId: string): Extract<Asset, { kind: "image" }> | undefined {
  const asset = database.assets[assetId];
  return asset?.kind === "image" ? asset : undefined;
}

function fileAsset(database: LibraryDatabase, assetId: string): Extract<Asset, { kind: "file" }> | undefined {
  const asset = database.assets[assetId];
  return asset?.kind === "file" ? asset : undefined;
}

export function indexAssetOwners(database: LibraryDatabase): ReadonlyMap<string, readonly AssetOwner[]> {
  const result = new Map<string, AssetOwner[]>();
  for (const gameId of Object.keys(database.games).sort(compareText)) {
    const game = database.games[gameId];
    if (game.coverAssetId) {
      const asset = imageAsset(database, game.coverAssetId);
      if (asset) append(result, asset.id, { role: "cover", gameId, alt: asset.alt, originalName: asset.originalName });
    }
    for (const item of game.progressItems ?? []) {
      const asset = imageAsset(database, item.iconAssetId);
      if (asset) append(result, asset.id, { role: "progress", gameId, progressItemId: item.id, originalName: asset.originalName });
    }
  }
  for (const noteId of Object.keys(database.notes).sort(compareText)) {
    const note = database.notes[noteId];
    note.attachments.forEach((attachment, attachmentIndex) => {
      if (attachment.type === "image") {
        const asset = imageAsset(database, attachment.assetId);
        if (asset) append(result, asset.id, { role: "note-image", gameId: note.gameId, noteId, index: attachmentIndex, alt: attachment.alt, originalName: asset.originalName });
      } else if (attachment.type === "file") {
        const asset = fileAsset(database, attachment.assetId);
        if (asset) append(result, asset.id, { role: "note-file", gameId: note.gameId, noteId, index: attachmentIndex, label: attachment.label, originalName: asset.originalName, mime: asset.mime });
      }
    });
  }
  return new Map(
    [...result.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([assetId, owners]) => [assetId, Object.freeze([...owners].sort(compareOwners))]),
  );
}

export function deriveImageAssetAltFromOwners(owners: readonly AssetOwner[] | undefined): string {
  const ownerList = owners ?? [];
  const cover = ownerList.find((owner): owner is Extract<AssetOwner, { role: "cover" }> => owner.role === "cover");
  if (cover) return cover.alt;
  const noteImage = ownerList.find((owner): owner is Extract<AssetOwner, { role: "note-image" }> => owner.role === "note-image");
  return noteImage?.alt ?? "";
}

export function deriveImageAssetAlt(database: LibraryDatabase, assetId: string): string {
  return deriveImageAssetAltFromOwners(indexAssetOwners(database).get(assetId));
}
