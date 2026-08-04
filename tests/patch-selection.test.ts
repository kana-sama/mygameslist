// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MISSING_VALUE_HASH,
  PatchSelectionError,
  applyPatch,
  canonicalStringify,
  diffLibrary,
  mergePatchEnvelopes,
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
const MISSING_GAME_ID = "00000000-0000-4000-8000-000000000099";
const ASSET_A_ID = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ASSET_B_ID = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
const REVISION = "1".repeat(64);
const CREATED_AT = "2026-08-04T08:00:00.000Z";
const CHANGED_AT = "2026-08-04T10:00:00.000Z";

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: REVISION,
    publicationId: null,
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
