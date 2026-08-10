import { SOURCE_VERSION, type ProjectedSourceLeaf, type SourceAssetReference, type SourceManifestV1, type SourceNoteAttachmentV1, type SourceNoteMetadataV1, type SourceTreeEntry } from "../src/source";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "a".repeat(64);

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;
type SourceNoteMetadataCollapsedSectionsAreReadonly = Assert<Equal<SourceNoteMetadataV1["collapsedChecklistSections"], readonly string[] | undefined>>;

function describeAttachment(attachment: SourceNoteAttachmentV1): string {
  switch (attachment.type) {
    case "image": return `image:${attachment.alt}:${attachment.originalName}`;
    case "file": return `file:${attachment.label}:${attachment.mime}:${attachment.originalName}`;
    case "link": return `link:${attachment.label}:${attachment.url}`;
  }
}

function describeLeaf(leaf: ProjectedSourceLeaf): string {
  switch (leaf.kind) {
    case "text": return `text:${leaf.logicalId}:${leaf.text}`;
    case "binary": return `binary:${leaf.logicalId}:${leaf.assetId}:${leaf.byteLength}`;
  }
}

function describeEntry(entry: SourceTreeEntry): string {
  switch (entry.kind) {
    case "file": return `file:${entry.path}`;
    case "directory": return `directory:${entry.path}`;
    case "symlink": return `symlink:${entry.path}`;
    case "unsupported": return `unsupported:${entry.path}`;
  }
}

function describeAssetReference(reference: SourceAssetReference): string {
  switch (reference.role) {
    case "cover": return `cover:${reference.alt}`;
    case "progress-icon": return `progress:${reference.progressItemId}`;
    case "note-image": return `note-image:${reference.noteId}:${reference.attachmentIndex}:${reference.alt}`;
    case "note-file": return `note-file:${reference.noteId}:${reference.attachmentIndex}:${reference.mime}`;
  }
}

describe("browser-safe source contracts", () => {
  it("exposes the v1 manifest constant and only its authored manifest fields", () => {
    const manifest = {
      sourceVersion: SOURCE_VERSION,
      schemaVersion: 2,
      publicationId: "22222222-2222-4222-8222-222222222222",
    } satisfies SourceManifestV1;

    expect(SOURCE_VERSION).toBe(1);
    expect(Object.keys(manifest)).toEqual(["sourceVersion", "schemaVersion", "publicationId"]);
  });

  it("handles every source note attachment and projected leaf discriminant", () => {
    const attachments: readonly SourceNoteAttachmentV1[] = [
      { type: "image", assetId: ASSET_ID, alt: "Map", originalName: "map.png" },
      { type: "file", assetId: ASSET_ID, label: "Save", originalName: "save.gct", mime: "application/octet-stream" },
      { type: "link", url: "https://example.com/guide", label: "Guide" },
    ];
    const leaves: readonly ProjectedSourceLeaf[] = [
      { kind: "text", path: "data/manifest.yaml", logicalId: "manifest", text: "sourceVersion: 1\n" },
      { kind: "binary", path: `data/games/game_${GAME_ID}/assets/map_${ASSET_ID}.webp`, logicalId: `asset:${GAME_ID}:${ASSET_ID}`, assetId: ASSET_ID, byteLength: 12 },
    ];

    expect(attachments.map(describeAttachment)).toEqual([
      "image:Map:map.png",
      "file:Save:application/octet-stream:save.gct",
      "link:Guide:https://example.com/guide",
    ]);
    expect(leaves.map(describeLeaf)).toEqual([
      "text:manifest:sourceVersion: 1\n",
      `binary:asset:${GAME_ID}:${ASSET_ID}:${ASSET_ID}:12`,
    ]);
  });

  it("allows source note metadata to omit every defaulted field", () => {
    const metadata = {
      id: NOTE_ID,
      rank: 1024,
      createdAt: "2026-08-11T09:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    } satisfies SourceNoteMetadataV1;

    expect(metadata).toEqual({
      id: NOTE_ID,
      rank: 1024,
      createdAt: "2026-08-11T09:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    });
  });

  it("retains ordered readonly source note metadata defaults and attachments", () => {
    const metadata = {
      id: NOTE_ID,
      groupRank: 2048,
      rank: 1024,
      doubleWidth: true,
      doubleHeight: true,
      collapsedChecklistSections: ["heading:route", "list:checklist"] as const,
      attachments: [
        { type: "image", assetId: ASSET_ID, alt: "Map", originalName: "map.png" },
        { type: "link", url: "https://example.com/guide", label: "Guide" },
        { type: "file", assetId: ASSET_ID, label: "Save", originalName: "save.gct", mime: "application/octet-stream" },
      ] as const,
      createdAt: "2026-08-11T09:00:00.000Z",
      updatedAt: "2026-08-11T09:30:00.000Z",
    } satisfies SourceNoteMetadataV1;

    expect(metadata.collapsedChecklistSections).toEqual(["heading:route", "list:checklist"]);
    expect(metadata.attachments.map(describeAttachment)).toEqual([
      "image:Map:map.png",
      "link:Guide:https://example.com/guide",
      "file:Save:application/octet-stream:save.gct",
    ]);
  });

  it("handles every source-tree and semantic asset-owner discriminant", () => {
    const entries: readonly SourceTreeEntry[] = [
      { kind: "file", path: "data/manifest.yaml", git: { mode: "100644", objectId: "b".repeat(40), type: "blob" } },
      { kind: "directory", path: "data/games", git: { mode: "040000", objectId: "c".repeat(40), type: "tree" } },
      { kind: "symlink", path: "data/unsafe", git: { mode: "120000", objectId: "d".repeat(40), type: "blob" } },
      { kind: "unsupported", path: "data/device", git: { mode: "160000", objectId: "e".repeat(40), type: "commit" } },
    ];
    const references: readonly SourceAssetReference[] = [
      { role: "cover", gameId: GAME_ID, assetId: ASSET_ID, originalName: "cover.png", alt: "Cover" },
      { role: "progress-icon", gameId: GAME_ID, assetId: ASSET_ID, originalName: "icon.png", progressItemId: "33333333-3333-4333-8333-333333333333" },
      { role: "note-image", gameId: GAME_ID, assetId: ASSET_ID, originalName: "map.png", noteId: NOTE_ID, attachmentIndex: 0, alt: "Map" },
      { role: "note-file", gameId: GAME_ID, assetId: ASSET_ID, originalName: "save.gct", noteId: NOTE_ID, attachmentIndex: 1, label: "Save", mime: "application/octet-stream" },
    ];

    expect(entries.map(describeEntry)).toEqual([
      "file:data/manifest.yaml",
      "directory:data/games",
      "symlink:data/unsafe",
      "unsupported:data/device",
    ]);
    expect(references.map(describeAssetReference)).toEqual([
      "cover:Cover",
      "progress:33333333-3333-4333-8333-333333333333",
      `note-image:${NOTE_ID}:0:Map`,
      `note-file:${NOTE_ID}:1:application/octet-stream`,
    ]);
  });
});
