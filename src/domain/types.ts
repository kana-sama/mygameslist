export const STATUS_IDS = ["wishlist", "playing", "played", "completed", "dropped"] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const TIER_IDS = ["s", "a", "b", "c", "d", "f", "unranked"] as const;
export type TierId = (typeof TIER_IDS)[number];

export const LIBRARY_SCHEMA_VERSION = 2 as const;

export interface Placement {
  tierId: TierId;
  rank: number;
}

export interface Game {
  id: string;
  title: string;
  coverAssetId: string | null;
  platforms: string[];
  tags: string[];
  status: StatusId;
  placement: Placement;
  reviewMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageAttachment {
  type: "image";
  assetId: string;
  alt: string;
}

export interface LinkAttachment {
  type: "link";
  url: string;
  label: string;
}

export type NoteAttachment = ImageAttachment | LinkAttachment;

export interface Note {
  id: string;
  gameId: string;
  bodyMarkdown: string;
  attachments: NoteAttachment[];
  rank: number;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  mime: "image/webp";
  width: number;
  height: number;
  base64: string;
  alt: string;
  originalName: string;
}

export interface LibraryDatabase {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  revision: string;
  publicationId: string | null;
  games: Record<string, Game>;
  notes: Record<string, Note>;
  assets: Record<string, Asset>;
}

export interface PatchOperation {
  operation: "set" | "delete";
  value?: unknown;
  baseExists: boolean;
  baseHash: string;
  changedAt: string;
  transactionId: string;
}

export interface PatchEnvelope {
  patchVersion: 1;
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION;
  baseRevision: string;
  operations: Record<string, PatchOperation>;
}

export interface PatchConflict {
  path: string;
  operation: PatchOperation;
  staticValue: unknown;
  staticExists: boolean;
}

export interface ReconciledPatch {
  patch: PatchEnvelope;
  effective: LibraryDatabase;
  conflicts: PatchConflict[];
  prunedCount: number;
}
