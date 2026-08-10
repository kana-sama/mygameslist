import type { LibraryDatabase } from "../../src/domain/types";
import type { SourceTreeEntry, SourceTreeReader } from "../../src/source/types";

export const PUBLICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const GAME_A_ID = "11111111-1111-4111-8111-111111111111";
export const GAME_B_ID = "22222222-2222-4222-8222-222222222222";
export const NOTE_EMPTY_ID = "33333333-3333-4333-8333-333333333333";
export const NOTE_ATTACHMENTS_ID = "44444444-4444-4444-8444-444444444444";
export const NOTE_SHARED_ID = "55555555-5555-4555-8555-555555555555";
export const PROGRESS_ID = "66666666-6666-4666-8666-666666666666";
export const IMAGE_ID = "995f88d98ba63a015ed5b1179d2454be029d3205ac707911c046dcd86fcb3c97";
export const FILE_ID = "08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48db414871f51c9cb35283d";
export const NOW = "2026-08-11T00:00:00.000Z";

export const IMAGE_BYTES = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 88, 10, 0, 0, 0,
  0, 0, 0, 0, 63, 0, 0, 63, 0, 0,
]);
export const FILE_BYTES = new Uint8Array([0, 1, 2, 3, 4]);

export const GAME_A_DIRECTORY = `data/games/alpha-quest_${GAME_A_ID}`;
export const GAME_B_DIRECTORY = `data/games/beta_${GAME_B_ID}`;
export const GAME_A_YAML_PATH = `${GAME_A_DIRECTORY}/game.yaml`;
export const GAME_B_YAML_PATH = `${GAME_B_DIRECTORY}/game.yaml`;
export const NOTE_EMPTY_PATH = `${GAME_A_DIRECTORY}/notes/note_${NOTE_EMPTY_ID}.md`;
export const NOTE_ATTACHMENTS_PATH = `${GAME_A_DIRECTORY}/notes/no-final-lf_${NOTE_ATTACHMENTS_ID}.md`;
export const NOTE_SHARED_PATH = `${GAME_B_DIRECTORY}/notes/shared-route_${NOTE_SHARED_ID}.md`;
export const IMAGE_A_PATH = `${GAME_A_DIRECTORY}/assets/shared-art_${IMAGE_ID}.webp`;
export const FILE_PATH = `${GAME_A_DIRECTORY}/assets/slot_${FILE_ID}.custom`;
export const IMAGE_B_PATH = `${GAME_B_DIRECTORY}/assets/shared-art_${IMAGE_ID}.webp`;

export const MANIFEST_YAML = `sourceVersion: 1
schemaVersion: 2
publicationId: "${PUBLICATION_ID}"
`;

export const GAME_A_YAML = `id: "${GAME_A_ID}"
title: Alpha Quest
cover:
  assetId: "${IMAGE_ID}"
  alt: Cover art
  originalName: "shared art.png"
progressItems:
  - id: "${PROGRESS_ID}"
    icon:
      assetId: "${IMAGE_ID}"
      originalName: "shared art.png"
    noteId: "${NOTE_EMPTY_ID}"
platforms:
  - PC
tags:
  - RPG
status: playing
placement:
  tierId: a
  rank: 1024
reviewMarkdown: |2-
  Great adventure.
createdAt: "${NOW}"
updatedAt: "${NOW}"
`;

export const GAME_B_YAML = `id: "${GAME_B_ID}"
title: Beta
platforms: []
tags: []
status: wishlist
placement:
  tierId: unranked
  rank: 1024
reviewMarkdown: |2-
createdAt: "${NOW}"
updatedAt: "${NOW}"
`;

export const NOTE_EMPTY_DOCUMENT = `<!-- mygameslist-note:v1
id: "${NOTE_EMPTY_ID}"
rank: 1024
createdAt: "${NOW}"
updatedAt: "${NOW}"
-->
`;

export const NOTE_ATTACHMENTS_DOCUMENT = `<!-- mygameslist-note:v1
id: "${NOTE_ATTACHMENTS_ID}"
rank: 2048
doubleWidth: true
attachments:
  - type: "image"
    assetId: "${IMAGE_ID}"
    alt: "Local map"
    originalName: "shared art.png"
  - type: "file"
    assetId: "${FILE_ID}"
    label: "Save slot"
    originalName: "slot.custom"
    mime: "application/x-mygameslist-save"
  - type: "link"
    url: "https://youtu.be/dQw4w9WgXcQ"
    label: "Video guide"
createdAt: "${NOW}"
updatedAt: "${NOW}"
-->
No final LF
<!-- mygameslist-attachments:v1:start -->
## Вложения

- ![Local map](<../assets/shared-art_${IMAGE_ID}.webp>)
- [Save slot](<../assets/slot_${FILE_ID}.custom>)
- [Video guide](<https://youtu.be/dQw4w9WgXcQ>)
<!-- mygameslist-attachments:v1:end -->
`;

export const NOTE_SHARED_DOCUMENT = `<!-- mygameslist-note:v1
id: "${NOTE_SHARED_ID}"
rank: 1024
attachments:
  - type: "image"
    assetId: "${IMAGE_ID}"
    alt: "Second-game map"
    originalName: "shared art.png"
createdAt: "${NOW}"
updatedAt: "${NOW}"
-->
# Shared route



<!-- mygameslist-attachments:v1:start -->
## Вложения

- ![Second\\-game map](<../assets/shared-art_${IMAGE_ID}.webp>)
<!-- mygameslist-attachments:v1:end -->
`;

export const EXPECTED_LEAVES = [
  { kind: "text", path: "data/manifest.yaml", logicalId: "manifest", text: MANIFEST_YAML },
  { kind: "text", path: GAME_A_YAML_PATH, logicalId: `game:${GAME_A_ID}`, text: GAME_A_YAML },
  { kind: "text", path: NOTE_EMPTY_PATH, logicalId: `note:${NOTE_EMPTY_ID}`, text: NOTE_EMPTY_DOCUMENT },
  { kind: "text", path: NOTE_ATTACHMENTS_PATH, logicalId: `note:${NOTE_ATTACHMENTS_ID}`, text: NOTE_ATTACHMENTS_DOCUMENT },
  { kind: "binary", path: IMAGE_A_PATH, logicalId: `asset:${GAME_A_ID}:${IMAGE_ID}`, assetId: IMAGE_ID, byteLength: 30 },
  { kind: "binary", path: FILE_PATH, logicalId: `asset:${GAME_A_ID}:${FILE_ID}`, assetId: FILE_ID, byteLength: 5 },
  { kind: "text", path: GAME_B_YAML_PATH, logicalId: `game:${GAME_B_ID}`, text: GAME_B_YAML },
  { kind: "text", path: NOTE_SHARED_PATH, logicalId: `note:${NOTE_SHARED_ID}`, text: NOTE_SHARED_DOCUMENT },
  { kind: "binary", path: IMAGE_B_PATH, logicalId: `asset:${GAME_B_ID}:${IMAGE_ID}`, assetId: IMAGE_ID, byteLength: 30 },
] as const;

export function fixtureDatabase(): LibraryDatabase {
  return structuredClone({
    schemaVersion: 2,
    revision: "",
    publicationId: PUBLICATION_ID,
    games: {
      [GAME_B_ID]: {
        id: GAME_B_ID,
        title: "Beta",
        coverAssetId: null,
        platforms: [],
        tags: [],
        status: "wishlist",
        placement: { tierId: "unranked", rank: 1024 },
        reviewMarkdown: "",
        createdAt: NOW,
        updatedAt: NOW,
      },
      [GAME_A_ID]: {
        id: GAME_A_ID,
        title: "Alpha Quest",
        coverAssetId: IMAGE_ID,
        progressItems: [{ id: PROGRESS_ID, iconAssetId: IMAGE_ID, noteId: NOTE_EMPTY_ID }],
        platforms: ["PC"],
        tags: ["RPG"],
        status: "playing",
        placement: { tierId: "a", rank: 1024 },
        reviewMarkdown: "Great adventure.",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    notes: {
      [NOTE_SHARED_ID]: {
        id: NOTE_SHARED_ID,
        gameId: GAME_B_ID,
        bodyMarkdown: "# Shared route\n\n\n",
        attachments: [{ type: "image", assetId: IMAGE_ID, alt: "Second-game map" }],
        rank: 1024,
        createdAt: NOW,
        updatedAt: NOW,
      },
      [NOTE_ATTACHMENTS_ID]: {
        id: NOTE_ATTACHMENTS_ID,
        gameId: GAME_A_ID,
        bodyMarkdown: "No final LF",
        attachments: [
          { type: "image", assetId: IMAGE_ID, alt: "Local map" },
          { type: "file", assetId: FILE_ID, label: "Save slot" },
          { type: "link", url: "https://youtu.be/dQw4w9WgXcQ", label: "Video guide" },
        ],
        groupRank: 1024,
        rank: 2048,
        doubleWidth: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
      [NOTE_EMPTY_ID]: {
        id: NOTE_EMPTY_ID,
        gameId: GAME_A_ID,
        bodyMarkdown: "",
        attachments: [],
        groupRank: 1024,
        rank: 1024,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    assets: {
      [FILE_ID]: {
        id: FILE_ID,
        kind: "file",
        mime: "application/x-mygameslist-save",
        byteLength: 5,
        originalName: "slot.custom",
      },
      [IMAGE_ID]: {
        id: IMAGE_ID,
        kind: "image",
        mime: "image/webp",
        width: 64,
        height: 64,
        byteLength: 30,
        alt: "Cover art",
        originalName: "shared art.png",
      },
    },
  } satisfies LibraryDatabase);
}

export function projectedFiles(): Map<string, Uint8Array> {
  return new Map(EXPECTED_LEAVES.map((leaf) => [
    leaf.path,
    leaf.kind === "text"
      ? new TextEncoder().encode(leaf.text)
      : leaf.assetId === IMAGE_ID ? IMAGE_BYTES.slice() : FILE_BYTES.slice(),
  ]));
}

export function projectedEntries(git = false): SourceTreeEntry[] {
  const paths = EXPECTED_LEAVES.map((leaf) => leaf.path);
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join("/"));
  }
  const objectId = (path: string): string => (path.length % 16).toString(16).repeat(40);
  return [
    ...[...directories].sort().map((path): SourceTreeEntry => ({
      kind: "directory",
      path,
      ...(git ? { git: { mode: "040000", type: "tree", objectId: objectId(path) } as const } : {}),
    })),
    ...paths.slice().sort().map((path): SourceTreeEntry => ({
      kind: "file",
      path,
      ...(git ? { git: { mode: "100644", type: "blob", objectId: objectId(path) } as const } : {}),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export class MemorySourceTreeReader implements SourceTreeReader {
  readonly reads: string[] = [];

  constructor(
    readonly entries: readonly SourceTreeEntry[] = projectedEntries(),
    readonly files: ReadonlyMap<string, Uint8Array> = projectedFiles(),
  ) {}

  async listEntries(): Promise<readonly SourceTreeEntry[]> {
    return this.entries;
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.reads.push(path);
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`Missing fixture file ${path}`);
    return bytes.slice();
  }
}
