// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MISSING_VALUE_HASH,
  PatchSelectionError,
  applyPatch,
  canonicalStringify,
  diffLibrary,
  mergePatchEnvelopes,
  reconcilePatch,
  rebasePostClickOverlaps,
  resolvePatchSelection,
  type Asset,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchEnvelope,
} from "../src/domain";

const GAME_A_ID = "00000000-0000-4000-8000-000000000001";
const GAME_B_ID = "00000000-0000-4000-8000-000000000002";
const NOTE_A_ID = "00000000-0000-4000-8000-000000000011";
const NOTE_B_ID = "00000000-0000-4000-8000-000000000012";
const NOTE_C_ID = "00000000-0000-4000-8000-000000000013";
const PROGRESS_ITEM_ID = "00000000-0000-4000-8000-000000000021";
const MISSING_GAME_ID = "00000000-0000-4000-8000-000000000099";
const ASSET_A_ID = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ASSET_B_ID = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
const PROGRESS_ASSET_ID = "3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452";
const REVISION = "1".repeat(64);
const PUBLICATION_ID = "99999999-9999-4999-8999-999999999999";
const CREATED_AT = "2026-08-04T08:00:00.000Z";
const EARLIER_CHANGED_AT = "2026-08-04T09:00:00.000Z";
const CHANGED_AT = "2026-08-04T10:00:00.000Z";

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: REVISION,
    publicationId: PUBLICATION_ID,
    games: {},
    notes: {},
    assets: {},
  };
}

function game(id: string, title: string): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms: ["PC"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function note(id: string, gameId: string, bodyMarkdown: string): Note {
  return {
    id,
    gameId,
    bodyMarkdown,
    attachments: [],
    rank: 1024,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function fileAsset(id: string, originalName: string, byteLength: number): Asset {
  return { id, kind: "file", mime: "application/octet-stream", byteLength, originalName };
}

function progressIcon(id: string): Asset {
  return { id, kind: "image", mime: "image/webp", width: 64, height: 64, byteLength: 12, alt: "", originalName: "progress.webp" };
}

function imageAsset(id: string, alt: string): Asset {
  return { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt, originalName: "image.webp" };
}

function patchBetween(
  base: LibraryDatabase,
  effective: LibraryDatabase,
  transactionId: string,
  blobs: Record<string, string> = {},
): PatchEnvelope {
  return diffLibrary(base, effective, { changedAt: CHANGED_AT, transactionId, blobs });
}

function operationPaths(patch: PatchEnvelope): string[] {
  return Object.keys(patch.operations).sort();
}

describe("patch selection", () => {
  it("includes the derived asset root when the selected winning note-image alt changes", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Image owner");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Before");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Winning note"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Before" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_A_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "After" }];
    const patch = patchBetween(base, desired, "winner-alt");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "winning-note-alt",
      operationPaths: [`/notes/${NOTE_A_ID}/attachments`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
    ]);
    expect(result.deferredPatch.operations).not.toHaveProperty(`/assets/${ASSET_A_ID}`);
    expect(result.dependencyReasons).toContainEqual(expect.objectContaining({
      requiredPath: `/assets/${ASSET_A_ID}`,
      requiredByChangeId: "winning-note-alt",
    }));
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "After" });
  });

  it("includes the fallback derived alt when the selected winning note root is deleted", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Fallback owners");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "First");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "First owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "First" }],
    };
    base.notes[NOTE_B_ID] = {
      ...note(NOTE_B_ID, GAME_A_ID, "Fallback owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Fallback" }],
    };
    const desired = structuredClone(base);
    delete desired.notes[NOTE_A_ID];
    const patch = patchBetween(base, desired, "remove-winner");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "remove-winning-owner",
      operationPaths: [`/notes/${NOTE_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}`,
    ]);
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "Fallback" });
  });

  it("includes the derived asset root when a selected cover removal exposes a note-image fallback", () => {
    const base = database();
    base.games[GAME_A_ID] = { ...game(GAME_A_ID, "Cover owner"), coverAssetId: ASSET_A_ID };
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Cover alt");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Fallback note"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Note alt" }],
    };
    const desired = structuredClone(base);
    desired.games[GAME_A_ID].coverAssetId = null;
    const patch = patchBetween(base, desired, "remove-cover");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "remove-cover",
      operationPaths: [`/games/${GAME_A_ID}/coverAssetId`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/games/${GAME_A_ID}/coverAssetId`,
    ]);
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "Note alt" });
  });

  it("pulls only the future winning owner needed by a selected removal", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Ordered owners");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "First");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "First owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "First" }],
    };
    base.notes[NOTE_B_ID] = {
      ...note(NOTE_B_ID, GAME_A_ID, "Future winner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Future before" }],
    };
    base.notes[NOTE_C_ID] = {
      ...note(NOTE_C_ID, GAME_A_ID, "Later nonwinner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Later before" }],
    };

    const afterRemoval = structuredClone(base);
    afterRemoval.notes[NOTE_A_ID].attachments = [];
    const removalPatch = diffLibrary(base, afterRemoval, {
      changedAt: EARLIER_CHANGED_AT,
      transactionId: "remove-first-owner",
    });
    const afterFutureWinner = applyPatch(base, removalPatch);
    afterFutureWinner.notes[NOTE_B_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "Future after" }];
    const futureWinnerPatch = diffLibrary(base, afterFutureWinner, {
      previousPatch: removalPatch,
      changedAt: CHANGED_AT,
      transactionId: "edit-future-winner",
    });
    const desired = applyPatch(base, futureWinnerPatch);
    desired.notes[NOTE_C_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "Later after" }];
    const patch = diffLibrary(base, desired, {
      previousPatch: futureWinnerPatch,
      changedAt: "2026-08-04T11:00:00.000Z",
      transactionId: "edit-later-nonwinner",
    });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "remove-first-owner",
      operationPaths: [`/notes/${NOTE_A_ID}/attachments`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
      `/notes/${NOTE_B_ID}/attachments`,
    ]);
    expect(operationPaths(result.deferredPatch)).toEqual([`/notes/${NOTE_C_ID}/attachments`]);
    expect(result.dependencyReasons).toContainEqual(expect.objectContaining({
      requiredPath: `/notes/${NOTE_B_ID}/attachments`,
      requiredByChangeId: "remove-first-owner",
    }));
    expect(applyPatch(base, result.publishPatch)).toMatchObject({
      assets: { [ASSET_A_ID]: { alt: "Future after" } },
      notes: {
        [NOTE_A_ID]: { attachments: [] },
        [NOTE_B_ID]: { attachments: [{ alt: "Future after" }] },
        [NOTE_C_ID]: { attachments: [{ alt: "Later before" }] },
      },
    });
  });

  it("prefers a target-created winner over an edited interim winner", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Changing winner order");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "First");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "First owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "First" }],
    };
    base.notes[NOTE_C_ID] = {
      ...note(NOTE_C_ID, GAME_A_ID, "Interim owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Interim before" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_A_ID].attachments = [];
    desired.notes[NOTE_C_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "Interim after" }];
    desired.notes[NOTE_B_ID] = {
      ...note(NOTE_B_ID, GAME_A_ID, "Target winner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Target" }],
    };
    const patch = patchBetween(base, desired, "replace-winner");
    const effective = applyPatch(base, patch);
    const snapshots = [base, effective, patch].map((value) => canonicalStringify(value));

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "remove-first-owner",
      operationPaths: [`/notes/${NOTE_A_ID}/attachments`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
      `/notes/${NOTE_B_ID}`,
    ]);
    expect(operationPaths(result.deferredPatch)).toEqual([`/notes/${NOTE_C_ID}/attachments`]);
    expect(applyPatch(base, result.publishPatch)).toMatchObject({
      assets: { [ASSET_A_ID]: { alt: "Target" } },
      notes: {
        [NOTE_A_ID]: { attachments: [] },
        [NOTE_B_ID]: { attachments: [{ alt: "Target" }] },
        [NOTE_C_ID]: { attachments: [{ alt: "Interim before" }] },
      },
    });
    expect([base, effective, patch].map((value) => canonicalStringify(value))).toEqual(snapshots);
  });

  it("rejects an explicit derived-alt-only seed while its explaining owner edit is deferred", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Image owner");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Before");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Winning owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Before" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_A_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "After" }];
    const patch = patchBetween(base, desired, "owner-explains-alt");
    const effective = applyPatch(base, patch);
    const snapshots = [base, effective, patch].map((value) => canonicalStringify(value));

    expect(() => resolvePatchSelection(base, effective, patch, [{
      changeId: "derived-alt-only",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }])).toThrowError(expect.objectContaining({
      name: "PatchSelectionError",
      changeId: "derived-alt-only",
    }));
    expect([base, effective, patch].map((value) => canonicalStringify(value))).toEqual(snapshots);
  });

  it("closes an explicit owner removal plus asset over the future winner edit", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Explicit owner transition");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "First");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "First owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "First" }],
    };
    base.notes[NOTE_B_ID] = {
      ...note(NOTE_B_ID, GAME_A_ID, "Future winner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Future before" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_A_ID].attachments = [];
    desired.notes[NOTE_B_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "Future after" }];
    const patch = patchBetween(base, desired, "explicit-owner-transition");
    const effective = applyPatch(base, patch);
    const snapshots = [base, effective, patch].map((value) => canonicalStringify(value));

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "explicit-owner-transition",
      operationPaths: [
        `/notes/${NOTE_A_ID}/attachments`,
        `/assets/${ASSET_A_ID}`,
      ],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
      `/notes/${NOTE_B_ID}/attachments`,
    ]);
    expect(result.deferredPatch.operations).toEqual({});
    expect(result.explicitPaths).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
    ]);
    expect(result.dependencyReasons).toContainEqual(expect.objectContaining({
      requiredPath: `/notes/${NOTE_B_ID}/attachments`,
      requiredByChangeId: "explicit-owner-transition",
    }));
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "Future after" });
    expect([base, effective, patch].map((value) => canonicalStringify(value))).toEqual(snapshots);
  });

  it("rejects an asset-only derived alt caused by a deferred cover removal", () => {
    const base = database();
    base.games[GAME_A_ID] = { ...game(GAME_A_ID, "Cover owner"), coverAssetId: ASSET_A_ID };
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Cover");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Fallback note"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Fallback" }],
    };
    const desired = structuredClone(base);
    desired.games[GAME_A_ID].coverAssetId = null;
    const patch = patchBetween(base, desired, "remove-cover");
    const effective = applyPatch(base, patch);
    const snapshots = [base, effective, patch].map((value) => canonicalStringify(value));

    expect(() => resolvePatchSelection(base, effective, patch, [{
      changeId: "derived-alt-with-deferred-cover-removal",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }])).toThrowError(expect.objectContaining({
      name: "PatchSelectionError",
      changeId: "derived-alt-with-deferred-cover-removal",
    }));
    expect([base, effective, patch].map((value) => canonicalStringify(value))).toEqual(snapshots);
  });

  it("rejects a selected winning-owner edit when its required derived asset operation is missing", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Image owner");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Before");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Winning owner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Before" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_A_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "After" }];
    const completePatch = patchBetween(base, desired, "owner-with-derived-alt");
    const effective = applyPatch(base, completePatch);
    const incompletePatch = structuredClone(completePatch);
    delete incompletePatch.operations[`/assets/${ASSET_A_ID}`];

    expect(() => resolvePatchSelection(base, effective, incompletePatch, [{
      changeId: "owner-with-missing-derived-alt",
      operationPaths: [`/notes/${NOTE_A_ID}/attachments`],
    }])).toThrowError(expect.objectContaining({
      name: "PatchSelectionError",
      changeId: "owner-with-missing-derived-alt",
      message: expect.stringContaining(`/assets/${ASSET_A_ID}`),
    }));
  });

  it("allows a direct global alt change when an unchanged cover owner makes it representable", () => {
    const base = database();
    base.games[GAME_A_ID] = { ...game(GAME_A_ID, "Cover owner"), coverAssetId: ASSET_A_ID };
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Before");
    const desired = structuredClone(base);
    desired.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "After");
    const patch = patchBetween(base, desired, "cover-alt");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "cover-alt",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([`/assets/${ASSET_A_ID}`]);
    expect(result.deferredPatch.operations).toEqual({});
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "After" });
  });

  it("allows a direct global alt while a different target cover survives", () => {
    const base = database();
    base.games[GAME_A_ID] = { ...game(GAME_A_ID, "First cover"), coverAssetId: ASSET_A_ID };
    base.games[GAME_B_ID] = { ...game(GAME_B_ID, "Surviving cover"), coverAssetId: ASSET_A_ID };
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Before");
    const desired = structuredClone(base);
    desired.games[GAME_A_ID].coverAssetId = null;
    desired.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "After");
    const patch = patchBetween(base, desired, "direct-alt-and-cover-removal");
    const effective = applyPatch(base, patch);
    const snapshots = [base, effective, patch].map((value) => canonicalStringify(value));

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "direct-cover-alt",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([`/assets/${ASSET_A_ID}`]);
    expect(operationPaths(result.deferredPatch)).toEqual([`/games/${GAME_A_ID}/coverAssetId`]);
    expect(applyPatch(base, result.publishPatch)).toMatchObject({
      assets: { [ASSET_A_ID]: { alt: "After" } },
      games: { [GAME_A_ID]: { coverAssetId: ASSET_A_ID } },
    });
    expect([base, effective, patch].map((value) => canonicalStringify(value))).toEqual(snapshots);
  });

  it("keeps global cover priority when an earlier game has a note-image owner", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Earlier note owner");
    base.games[GAME_B_ID] = { ...game(GAME_B_ID, "Later cover owner"), coverAssetId: ASSET_A_ID };
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Before");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Earlier note"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Note alt" }],
    };
    const desired = structuredClone(base);
    desired.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "After");
    const patch = patchBetween(base, desired, "cross-game-cover-alt");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "cross-game-cover-alt",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([`/assets/${ASSET_A_ID}`]);
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "After" });
  });

  it("keeps a nonwinning note-image alt edit local without pulling the asset root", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Ordered owners");
    base.assets[ASSET_A_ID] = imageAsset(ASSET_A_ID, "Winner");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Winner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Winner" }],
    };
    base.notes[NOTE_B_ID] = {
      ...note(NOTE_B_ID, GAME_A_ID, "Nonwinner"),
      attachments: [{ type: "image", assetId: ASSET_A_ID, alt: "Before" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_B_ID].attachments = [{ type: "image", assetId: ASSET_A_ID, alt: "After" }];
    const patch = patchBetween(base, desired, "nonwinner-alt");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "nonwinning-note-alt",
      operationPaths: [`/notes/${NOTE_B_ID}/attachments`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([`/notes/${NOTE_B_ID}/attachments`]);
    expect(result.publishPatch.operations).not.toHaveProperty(`/assets/${ASSET_A_ID}`);
    expect(applyPatch(base, result.publishPatch).assets[ASSET_A_ID]).toMatchObject({ alt: "Winner" });
  });

  it("includes a new progress icon asset with the selected game progress field", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Progress game");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "Progress note");
    const desired = structuredClone(base);
    desired.assets[PROGRESS_ASSET_ID] = progressIcon(PROGRESS_ASSET_ID);
    desired.games[GAME_A_ID].progressItems = [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ASSET_ID, noteId: NOTE_A_ID }];
    const iconBlob = "UklGRgQAAABXRUJQ";
    const patch = patchBetween(base, desired, "add-progress", { [PROGRESS_ASSET_ID]: iconBlob });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "progress-items",
      operationPaths: [`/games/${GAME_A_ID}/progressItems`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${PROGRESS_ASSET_ID}`,
      `/games/${GAME_A_ID}/progressItems`,
    ]);
    expect(result.publishPatch.blobs).toEqual({ [PROGRESS_ASSET_ID]: iconBlob });
  });

  it("does not pull an independently changed cover into a selected progress field", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Independent assets");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "Progress note");
    const afterCover = structuredClone(base);
    afterCover.assets[ASSET_A_ID] = progressIcon(ASSET_A_ID);
    afterCover.games[GAME_A_ID].coverAssetId = ASSET_A_ID;
    const coverPatch = diffLibrary(base, afterCover, {
      changedAt: EARLIER_CHANGED_AT,
      transactionId: "cover-only",
    });
    const desired = applyPatch(base, coverPatch);
    desired.assets[PROGRESS_ASSET_ID] = progressIcon(PROGRESS_ASSET_ID);
    desired.games[GAME_A_ID].progressItems = [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ASSET_ID, noteId: NOTE_A_ID }];
    const patch = diffLibrary(base, desired, {
      previousPatch: coverPatch,
      changedAt: CHANGED_AT,
      transactionId: "progress-only",
    });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "progress-only",
      operationPaths: [`/games/${GAME_A_ID}/progressItems`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${PROGRESS_ASSET_ID}`,
      `/games/${GAME_A_ID}/progressItems`,
    ]);
    expect(operationPaths(result.deferredPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/games/${GAME_A_ID}/coverAssetId`,
    ]);
  });

  it("includes a new note, its parent game, attachment metadata, and blob", () => {
    const base = database();
    const desired = structuredClone(base);
    desired.games[GAME_A_ID] = game(GAME_A_ID, "Parcel game");
    desired.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "parcel.zip", 0);
    desired.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "# Посылки"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "Архив" }],
    };
    const patch = patchBetween(base, desired, "new-note", { [ASSET_A_ID]: "" });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "new-note",
      operationPaths: [`/notes/${NOTE_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/games/${GAME_A_ID}`,
      `/notes/${NOTE_A_ID}`,
    ].sort());
    expect(result.publishPatch.blobs).toEqual({ [ASSET_A_ID]: patch.blobs[ASSET_A_ID] });
    expect(result.deferredPatch.blobs).not.toHaveProperty(ASSET_A_ID);
    expect(result.dependencyReasons).toContainEqual({
      requiredPath: `/assets/${ASSET_A_ID}`,
      requiredByChangeId: "new-note",
      message: "Нужно для вложения заметки «Посылки»",
    });
  });

  it("keeps unrelated operations and blobs deferred", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "First");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Second");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "First note");
    base.notes[NOTE_B_ID] = note(NOTE_B_ID, GAME_B_ID, "Second note");
    const desired = structuredClone(base);
    desired.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "a.bin", 0);
    desired.assets[ASSET_B_ID] = fileAsset(ASSET_B_ID, "b.bin", 1);
    desired.notes[NOTE_A_ID].attachments = [{ type: "file", assetId: ASSET_A_ID, label: "A" }];
    desired.notes[NOTE_B_ID].attachments = [{ type: "file", assetId: ASSET_B_ID, label: "B" }];
    desired.notes[NOTE_B_ID].bodyMarkdown = "Deferred text";
    const patch = patchBetween(base, desired, "attachments", {
      [ASSET_A_ID]: "",
      [ASSET_B_ID]: "YQ==",
    });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "first-attachment",
      operationPaths: [`/notes/${NOTE_A_ID}/attachments`],
    }]);

    expect(result.publishPatch.operations).toHaveProperty(`/notes/${NOTE_A_ID}/attachments`);
    expect(result.publishPatch.operations).toHaveProperty(`/assets/${ASSET_A_ID}`);
    expect(result.deferredPatch.operations).toHaveProperty(`/notes/${NOTE_B_ID}/bodyMarkdown`);
    expect(result.deferredPatch.operations).toHaveProperty(`/assets/${ASSET_B_ID}`);
    expect(result.publishPatch.blobs).toEqual({ [ASSET_A_ID]: "" });
    expect(result.deferredPatch.blobs).toEqual({ [ASSET_B_ID]: "YQ==" });
    const union = mergePatchEnvelopes(result.publishPatch, result.deferredPatch);
    expect(applyPatch(base, union)).toEqual(effective);
  });

  it("does not pull another same-transaction reference to an already-required asset", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "First");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Second");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "First note");
    base.notes[NOTE_B_ID] = note(NOTE_B_ID, GAME_B_ID, "Second note");
    const desired = structuredClone(base);
    desired.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "shared.bin", 0);
    desired.notes[NOTE_A_ID].attachments = [{ type: "file", assetId: ASSET_A_ID, label: "Selected" }];
    desired.notes[NOTE_B_ID].attachments = [{ type: "file", assetId: ASSET_A_ID, label: "Deferred" }];
    const patch = patchBetween(base, desired, "shared-asset", { [ASSET_A_ID]: "" });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "selected-reference",
      operationPaths: [`/notes/${NOTE_A_ID}/attachments`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
    ]);
    expect(result.deferredPatch.operations).toHaveProperty(`/notes/${NOTE_B_ID}/attachments`);
  });

  it("adds one same-transaction reference required by an explicitly selected asset creation", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Asset owner");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "Owner note");
    const desired = structuredClone(base);
    desired.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "created.bin", 0);
    desired.notes[NOTE_A_ID].attachments = [{ type: "file", assetId: ASSET_A_ID, label: "Created" }];
    desired.games[GAME_A_ID].title = "Unrelated text in the same transaction";
    const patch = patchBetween(base, desired, "create-asset", { [ASSET_A_ID]: "" });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "create-asset",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
    ]);
    expect(result.deferredPatch.operations).toHaveProperty(`/games/${GAME_A_ID}/title`);
  });

  it("publishes all explicit units selected for one game", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Old title");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Other game");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "Old note");
    const desired = structuredClone(base);
    desired.games[GAME_A_ID].title = "New title";
    desired.notes[NOTE_A_ID].bodyMarkdown = "New note";
    desired.games[GAME_B_ID].title = "Unrelated title";
    const patch = patchBetween(base, desired, "save-form");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [
      { changeId: "game-title", operationPaths: [`/games/${GAME_A_ID}/title`] },
      { changeId: "game-note", operationPaths: [`/notes/${NOTE_A_ID}/bodyMarkdown`] },
    ]);

    expect(result.explicitPaths).toEqual([
      `/games/${GAME_A_ID}/title`,
      `/notes/${NOTE_A_ID}/bodyMarkdown`,
    ]);
    expect(result.selectedPaths).toEqual(result.explicitPaths);
    expect(operationPaths(result.deferredPatch)).toEqual([`/games/${GAME_B_ID}/title`]);
  });

  it("includes a same-transaction child deletion required by a selected game deletion", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Deleted game");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "Deleted note");
    const desired = structuredClone(base);
    delete desired.notes[NOTE_A_ID];
    delete desired.games[GAME_A_ID];
    const patch = patchBetween(base, desired, "delete-game");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "delete-game",
      operationPaths: [`/games/${GAME_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/games/${GAME_A_ID}`,
      `/notes/${NOTE_A_ID}`,
    ].sort());
    expect(applyPatch(base, result.publishPatch)).toEqual(effective);
  });

  it("includes every ordering operation in a cross-game transaction but not text edits", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "First");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Second");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "Original");
    const desired = structuredClone(base);
    desired.games[GAME_A_ID].placement = { tierId: "b", rank: 2048 };
    desired.games[GAME_B_ID].placement = { tierId: "a", rank: 512 };
    desired.notes[NOTE_A_ID].rank = 2048;
    desired.notes[NOTE_A_ID].groupRank = 2048;
    desired.notes[NOTE_A_ID].bodyMarkdown = "Unrelated text";
    const patch = patchBetween(base, desired, "cross-game-move");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "move-first-game",
      operationPaths: [`/games/${GAME_A_ID}/placement`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/games/${GAME_A_ID}/placement`,
      `/games/${GAME_B_ID}/placement`,
      `/notes/${NOTE_A_ID}/groupRank`,
      `/notes/${NOTE_A_ID}/rank`,
    ].sort());
    expect(result.deferredPatch.operations).toHaveProperty(`/notes/${NOTE_A_ID}/bodyMarkdown`);
  });

  it("includes selected reference removals for an asset deletion without unrelated text", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Asset owner");
    base.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "old.bin", 0);
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Original"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "Old" }],
    };
    const desired = structuredClone(base);
    desired.notes[NOTE_A_ID].attachments = [];
    desired.notes[NOTE_A_ID].bodyMarkdown = "Edited in the same save";
    delete desired.assets[ASSET_A_ID];
    const patch = patchBetween(base, desired, "delete-asset");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "delete-asset",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
    ]);
    expect(result.deferredPatch.operations).toHaveProperty(`/notes/${NOTE_A_ID}/bodyMarkdown`);
    expect(applyPatch(base, result.publishPatch)).toEqual({
      ...effective,
      notes: { [NOTE_A_ID]: { ...effective.notes[NOTE_A_ID], bodyMarkdown: "Original" } },
    });
  });

  it("includes required asset reference removals retained from earlier transactions", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "First owner");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Second owner");
    base.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "shared.bin", 0);
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "First note"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "First reference" }],
    };
    base.notes[NOTE_B_ID] = {
      ...note(NOTE_B_ID, GAME_B_ID, "Second note"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "Second reference" }],
    };

    const afterFirstRemoval = structuredClone(base);
    afterFirstRemoval.notes[NOTE_A_ID].attachments = [];
    const earlierPatch = diffLibrary(base, afterFirstRemoval, {
      changedAt: EARLIER_CHANGED_AT,
      transactionId: "remove-first-reference",
    });

    const desired = applyPatch(base, earlierPatch);
    desired.notes[NOTE_B_ID].attachments = [];
    desired.notes[NOTE_B_ID].bodyMarkdown = "Unrelated text from final save";
    delete desired.assets[ASSET_A_ID];
    const patch = diffLibrary(base, desired, {
      previousPatch: earlierPatch,
      changedAt: CHANGED_AT,
      transactionId: "remove-final-reference",
    });
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "delete-shared-asset",
      operationPaths: [`/assets/${ASSET_A_ID}`],
    }]);

    expect(operationPaths(result.publishPatch)).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/notes/${NOTE_A_ID}/attachments`,
      `/notes/${NOTE_B_ID}/attachments`,
    ]);
    expect(result.deferredPatch.operations).toHaveProperty(`/notes/${NOTE_B_ID}/bodyMarkdown`);
  });

  it("partitions every original operation exactly once and preserves envelope metadata", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "First");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Second");
    const desired = structuredClone(base);
    desired.games[GAME_A_ID].title = "Published";
    desired.games[GAME_B_ID].reviewMarkdown = "Deferred";
    const patch = patchBetween(base, desired, "partition");
    const effective = applyPatch(base, patch);

    const result = resolvePatchSelection(base, effective, patch, [{
      changeId: "publish-title",
      operationPaths: [`/games/${GAME_A_ID}/title`],
    }]);
    const published = new Set(operationPaths(result.publishPatch));
    const deferred = new Set(operationPaths(result.deferredPatch));

    expect([...published].filter((path) => deferred.has(path))).toEqual([]);
    expect([...published, ...deferred].sort()).toEqual(operationPaths(patch));
    for (const output of [result.publishPatch, result.deferredPatch]) {
      expect(output).toMatchObject({
        patchVersion: patch.patchVersion,
        schemaVersion: patch.schemaVersion,
        baseRevision: patch.baseRevision,
      });
    }
    expect(canonicalStringify(applyPatch(base, mergePatchEnvelopes(result.publishPatch, result.deferredPatch))))
      .toBe(canonicalStringify(effective));
  });

  it("rejects an unknown selected path with its originating change and no mutation", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Original");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].title = "Changed";
    const patch = patchBetween(base, effective, "edit-title");
    const snapshots = [base, effective, patch].map((value) => canonicalStringify(value));

    expect(() => resolvePatchSelection(base, effective, patch, [{
      changeId: "missing-change",
      operationPaths: [`/games/${GAME_B_ID}/title`],
    }])).toThrowError(expect.objectContaining({
      name: "PatchSelectionError",
      changeId: "missing-change",
      message: expect.stringContaining(`/games/${GAME_B_ID}/title`),
    }));
    expect([base, effective, patch].map((value) => canonicalStringify(value))).toEqual(snapshots);
  });

  it("rejects a selected field whose entity is neither in base nor created by the patch", () => {
    const base = database();
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/games/${MISSING_GAME_ID}/title`]: {
          operation: "set",
          value: "Orphan field",
          baseExists: false,
          baseHash: MISSING_VALUE_HASH,
          changedAt: CHANGED_AT,
          transactionId: "broken-field",
        },
      },
      blobs: {},
    };

    expect(() => resolvePatchSelection(base, base, patch, [{
      changeId: "orphan-field",
      operationPaths: [`/games/${MISSING_GAME_ID}/title`],
    }])).toThrowError(expect.objectContaining({
      name: "PatchSelectionError",
      changeId: "orphan-field",
      message: expect.stringContaining(MISSING_GAME_ID),
    }));
  });
});

describe("patch envelope merging", () => {
  it("rebases post-click overlaps onto the deferred operation's original base metadata", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "First");
    const deferredTarget = structuredClone(base);
    deferredTarget.games[GAME_A_ID].placement = { tierId: "b", rank: 1024 };
    const deferred = diffLibrary(base, deferredTarget, {
      changedAt: EARLIER_CHANGED_AT,
      transactionId: "deferred-placement",
    });
    const frozenEffective = applyPatch(base, deferred);
    const postClickTarget = structuredClone(frozenEffective);
    postClickTarget.games[GAME_A_ID].placement = { tierId: "s", rank: 2048 };
    const postClick = diffLibrary(frozenEffective, postClickTarget, {
      changedAt: CHANGED_AT,
      transactionId: "post-click-placement",
    });
    const snapshots = [deferred, postClick].map((patch) => canonicalStringify(patch));

    const rebased = rebasePostClickOverlaps(deferred, postClick);

    const path = `/games/${GAME_A_ID}/placement`;
    expect(rebased.operations[path]).toEqual({
      ...postClick.operations[path],
      baseExists: deferred.operations[path].baseExists,
      baseHash: deferred.operations[path].baseHash,
    });
    expect([deferred, postClick].map((patch) => canonicalStringify(patch))).toEqual(snapshots);
    const merged = mergePatchEnvelopes(deferred, rebased);
    expect(reconcilePatch(base, merged)).toMatchObject({
      conflicts: [],
      effective: { games: { [GAME_A_ID]: { placement: { tierId: "s", rank: 2048 } } } },
    });
    const remote = structuredClone(base);
    remote.games[GAME_A_ID].placement = { tierId: "c", rank: 1024 };
    expect(reconcilePatch(remote, merged).conflicts).toEqual([
      expect.objectContaining({ path }),
    ]);
  });

  it("lets the later envelope win and prunes blobs without a surviving asset set", () => {
    const base = database();
    const effective = structuredClone(base);
    effective.games[GAME_A_ID] = game(GAME_A_ID, "Created");
    effective.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "unused.bin", 0);
    effective.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "Attachment"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "Unused" }],
    };
    const earlier = patchBetween(base, effective, "earlier", { [ASSET_A_ID]: "" });
    const later: PatchEnvelope = {
      ...earlier,
      baseRevision: "2".repeat(64),
      operations: {
        [`/assets/${ASSET_A_ID}`]: {
          ...earlier.operations[`/assets/${ASSET_A_ID}`],
          operation: "delete",
          baseExists: true,
          baseHash: "3".repeat(64),
        },
      },
      blobs: { [ASSET_A_ID]: "YQ==" },
    };

    const merged = mergePatchEnvelopes(earlier, later);

    expect(merged.baseRevision).toBe(later.baseRevision);
    expect(merged.operations[`/assets/${ASSET_A_ID}`]).toEqual(later.operations[`/assets/${ASSET_A_ID}`]);
    expect(merged.blobs).toEqual({});
  });
});
