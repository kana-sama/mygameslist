import { LIBRARY_SCHEMA_VERSION, type FileAttachment, type Game, type ImageAttachment, type LibraryDatabase, type LinkAttachment, type Note } from "../domain";

export const SOURCE_VERSION = 1 as const;

export interface SourceManifestV1 {
  sourceVersion: typeof SOURCE_VERSION;
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  publicationId: string;
}

export interface SourceCoverReference {
  assetId: string;
  alt: string;
  originalName: string;
}

export interface SourceProgressIconReference {
  assetId: string;
  originalName: string;
}

export interface SourceGameProgressItemV1 {
  id: string;
  icon: SourceProgressIconReference;
  noteId: string;
}

export interface SourceGameV1 extends Pick<Game, "id" | "title" | "platforms" | "tags" | "status" | "placement" | "reviewMarkdown" | "createdAt" | "updatedAt"> {
  cover?: SourceCoverReference;
  progressItems?: SourceGameProgressItemV1[];
}

export interface SourceImageAttachmentV1 extends ImageAttachment {
  originalName: string;
}

export interface SourceFileAttachmentV1 extends FileAttachment {
  originalName: string;
  mime: string;
}

export type SourceLinkAttachmentV1 = LinkAttachment;
export type SourceNoteAttachmentV1 = SourceImageAttachmentV1 | SourceFileAttachmentV1 | SourceLinkAttachmentV1;

export interface SourceNoteMetadataV1 extends Pick<Note, "id" | "rank" | "createdAt" | "updatedAt"> {
  groupRank?: NonNullable<Note["groupRank"]>;
  doubleWidth?: NonNullable<Note["doubleWidth"]>;
  doubleHeight?: NonNullable<Note["doubleHeight"]>;
  collapsedChecklistSections?: readonly string[];
  attachments?: readonly SourceNoteAttachmentV1[];
}

export type GitObjectId = string;

export interface SourceTreeGitObject {
  mode: string;
  objectId: GitObjectId;
  type: "blob" | "tree" | "commit";
}

interface SourceTreeEntryBase {
  path: string;
  git?: SourceTreeGitObject;
}

export interface SourceTreeFileEntry extends SourceTreeEntryBase {
  kind: "file";
}

export interface SourceTreeDirectoryEntry extends SourceTreeEntryBase {
  kind: "directory";
}

export interface SourceTreeSymlinkEntry extends SourceTreeEntryBase {
  kind: "symlink";
  target?: string;
}

export interface SourceTreeUnsupportedEntry extends SourceTreeEntryBase {
  kind: "unsupported";
}

export type SourceTreeEntry = SourceTreeFileEntry | SourceTreeDirectoryEntry | SourceTreeSymlinkEntry | SourceTreeUnsupportedEntry;

export interface SourceTreeReader {
  listEntries(): Promise<readonly SourceTreeEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export interface SourceAssetReferenceBase {
  gameId: string;
  assetId: string;
  originalName: string;
}

export interface SourceCoverAssetReference extends SourceAssetReferenceBase {
  role: "cover";
  alt: string;
}

export interface SourceProgressIconAssetReference extends SourceAssetReferenceBase {
  role: "progress-icon";
  progressItemId: string;
}

export interface SourceNoteImageAssetReference extends SourceAssetReferenceBase {
  role: "note-image";
  noteId: string;
  attachmentIndex: number;
  alt: string;
}

export interface SourceNoteFileAssetReference extends SourceAssetReferenceBase {
  role: "note-file";
  noteId: string;
  attachmentIndex: number;
  label: string;
  mime: string;
}

export type SourceAssetReference = SourceCoverAssetReference | SourceProgressIconAssetReference | SourceNoteImageAssetReference | SourceNoteFileAssetReference;

export interface SourceImageAssetOccurrence {
  gameId: string;
  assetId: string;
  kind: "image";
  originalName: string;
  references: readonly (SourceCoverAssetReference | SourceProgressIconAssetReference | SourceNoteImageAssetReference)[];
}

export interface SourceFileAssetOccurrence {
  gameId: string;
  assetId: string;
  kind: "file";
  originalName: string;
  references: readonly SourceNoteFileAssetReference[];
}

export type SourceAssetOccurrence = SourceImageAssetOccurrence | SourceFileAssetOccurrence;

export interface ProjectedTextLeaf {
  kind: "text";
  path: string;
  logicalId: string;
  text: string;
}

export interface ProjectedBinaryLeaf {
  kind: "binary";
  path: string;
  logicalId: string;
  assetId: string;
  byteLength: number;
}

export type ProjectedSourceLeaf = ProjectedTextLeaf | ProjectedBinaryLeaf;

export interface ProjectedGameBundle {
  gameId: string;
  directoryPath: string;
  leaves: readonly ProjectedSourceLeaf[];
  assetOccurrences: readonly SourceAssetOccurrence[];
}

export interface SourceProjection {
  database: LibraryDatabase;
  leaves: readonly ProjectedSourceLeaf[];
  gameBundles: ReadonlyMap<string, ProjectedGameBundle>;
}

export interface ValidatedSourceInventory {
  entries: readonly SourceTreeEntry[];
  blobShasByPath: ReadonlyMap<string, GitObjectId>;
  assetOccurrences: readonly SourceAssetOccurrence[];
}

export interface PublishedLibraryEnvelope {
  sourceCommitSha: GitObjectId | null;
  database: LibraryDatabase;
}

export interface RuntimeMediaFile {
  assetId: string;
  path: string;
  bytes: Uint8Array;
}

export interface SourceAssembly {
  database: LibraryDatabase;
  envelope: PublishedLibraryEnvelope;
  runtimeMedia: ReadonlyMap<string, Uint8Array>;
  sourceAssetOccurrences: number;
}
