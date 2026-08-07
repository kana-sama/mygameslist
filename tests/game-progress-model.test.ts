import { describe, expect, it } from "vitest";
import { validateLibrary, type Asset, type LibraryDatabase } from "../src/domain";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_GAME_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const ICON_ID = "a".repeat(64);
const NOW = "2026-08-07T08:00:00.000Z";

function iconAsset(id: string, width: number, height: number): Asset {
  return { id, kind: "image", mime: "image/webp", width, height, byteLength: 12, alt: "", originalName: "progress.webp" };
}

function noteFor(gameId: string) {
  return { id: NOTE_ID, gameId, bodyMarkdown: "- [ ] Route", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
}

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: "",
    publicationId: null,
    games: {
      [GAME_ID]: {
        id: GAME_ID,
        title: "DuckTales",
        coverAssetId: null,
        platforms: ["NES"],
        tags: [],
        status: "playing",
        placement: { tierId: "a", rank: 1024 },
        reviewMarkdown: "",
        createdAt: NOW,
        updatedAt: NOW,
      },
      [OTHER_GAME_ID]: {
        id: OTHER_GAME_ID,
        title: "Other",
        coverAssetId: null,
        platforms: [],
        tags: [],
        status: "playing",
        placement: { tierId: "b", rank: 1024 },
        reviewMarkdown: "",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    notes: {},
    assets: {},
  };
}

function withProgress() {
  const value = database() as LibraryDatabase & {
    games: Record<string, LibraryDatabase["games"][string] & {
      progressItems?: Array<{ id: string; iconAssetId: string; noteId: string; unexpected?: boolean }>;
    }>;
  };
  value.games[GAME_ID].progressItems = [{ id: ITEM_ID, iconAssetId: ICON_ID, noteId: NOTE_ID }];
  value.assets[ICON_ID] = iconAsset(ICON_ID, 64, 64);
  value.notes[NOTE_ID] = noteFor(GAME_ID);
  return value;
}

describe("game progress model", () => {
  it("accepts a 64x64 progress icon and permits its note to be missing", () => {
    const value = withProgress();

    expect(validateLibrary(value).ok).toBe(true);

    delete value.notes[NOTE_ID];
    expect(validateLibrary(value).ok).toBe(true);
  });

  it("keeps progressItems optional for existing games", () => {
    expect(validateLibrary(database()).ok).toBe(true);
  });

  it("rejects a malformed progress item UUID", () => {
    const value = withProgress();
    value.games[GAME_ID].progressItems![0].id = "not-a-uuid";

    expect(validateLibrary(value).issues).toContainEqual(expect.objectContaining({
      path: `/games/${GAME_ID}/progressItems/0/id`,
    }));
  });

  it("rejects a progress icon that is not an image", () => {
    const value = withProgress();
    value.assets[ICON_ID] = { id: ICON_ID, kind: "file", mime: "application/octet-stream", byteLength: 12, originalName: "progress.bin" };

    expect(validateLibrary(value).issues).toContainEqual(expect.objectContaining({
      path: `/games/${GAME_ID}/progressItems/0/iconAssetId`,
    }));
  });

  it("rejects a progress icon that is not exactly 64x64", () => {
    const value = withProgress();
    value.assets[ICON_ID] = iconAsset(ICON_ID, 63, 64);

    expect(validateLibrary(value).issues).toContainEqual(expect.objectContaining({
      path: `/games/${GAME_ID}/progressItems/0/iconAssetId`,
    }));
  });

  it("rejects duplicate progress item IDs", () => {
    const value = withProgress();
    value.games[GAME_ID].progressItems!.push({ id: ITEM_ID, iconAssetId: ICON_ID, noteId: NOTE_ID });

    expect(validateLibrary(value).issues).toContainEqual(expect.objectContaining({
      path: `/games/${GAME_ID}/progressItems/1/id`,
    }));
  });

  it("rejects an existing progress note owned by another game", () => {
    const value = withProgress();
    value.notes[NOTE_ID] = noteFor(OTHER_GAME_ID);

    expect(validateLibrary(value).issues).toContainEqual(expect.objectContaining({
      path: `/games/${GAME_ID}/progressItems/0/noteId`,
    }));
  });

  it("requires exact progress item keys and valid reference formats", () => {
    const value = withProgress();
    value.games[GAME_ID].progressItems = [{ id: SECOND_ITEM_ID, iconAssetId: "bad", noteId: "bad", unexpected: true }];

    const paths = validateLibrary(value).issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining([
      `/games/${GAME_ID}/progressItems/0/iconAssetId`,
      `/games/${GAME_ID}/progressItems/0/noteId`,
      `/games/${GAME_ID}/progressItems/0/unexpected`,
    ]));
  });
});
