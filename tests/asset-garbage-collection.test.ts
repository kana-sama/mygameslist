import { describe, expect, it } from "vitest";
import {
  garbageCollectUnreferencedAssets,
  referencedAssetIds,
  validateLibrary,
  type Asset,
  type LibraryDatabase,
} from "../src/domain";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const COVER_ID = "a".repeat(64);
const FILE_ID = "b".repeat(64);
const ORPHAN_ID = "c".repeat(64);
const NOW = "2026-07-18T08:00:00.000Z";

function image(id: string): Asset {
  return { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "", originalName: `${id}.webp` };
}

function file(id: string): Asset {
  return { id, kind: "file", mime: "application/octet-stream", byteLength: 4, originalName: `${id}.bin` };
}

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: "",
    publicationId: null,
    games: {
      [GAME_ID]: {
        id: GAME_ID,
        title: "Game",
        coverAssetId: COVER_ID,
        platforms: [],
        tags: [],
        status: "playing",
        placement: { tierId: "unranked", rank: 1024 },
        reviewMarkdown: "",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    notes: {
      [NOTE_ID]: {
        id: NOTE_ID,
        gameId: GAME_ID,
        bodyMarkdown: "",
        attachments: [
          { type: "file", assetId: FILE_ID, label: "File" },
          { type: "link", url: "https://example.com", label: "Link" },
        ],
        rank: 1024,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    assets: {
      [COVER_ID]: image(COVER_ID),
      [FILE_ID]: file(FILE_ID),
      [ORPHAN_ID]: image(ORPHAN_ID),
    },
  };
}

describe("asset reachability invariant", () => {
  it("collects only assets unreachable from game covers and note attachments", () => {
    const current = database();

    expect([...referencedAssetIds(current)].sort()).toEqual([COVER_ID, FILE_ID]);
    expect(garbageCollectUnreferencedAssets(current)).toEqual([ORPHAN_ID]);
    expect(Object.keys(current.assets).sort()).toEqual([COVER_ID, FILE_ID]);
    expect(validateLibrary(current).ok).toBe(true);
  });

  it("rejects asset metadata without an owning game or note", () => {
    const result = validateLibrary(database());

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ path: `/assets/${ORPHAN_ID}`, message: "Asset ни к чему не привязан" });
  });
});
