// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  diffLibrary,
  reconcilePatch,
  withComputedRevision,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchEnvelope,
} from "../src/domain";
import { applyPatch as applyCliPatchUntyped } from "../scripts/publish-patch.mjs";

const EXISTING_GAME_ID = "00000000-0000-4000-8000-000000000001";
const NEW_GAME_ID = "00000000-0000-4000-8000-000000000002";
const NOTE_A_ID = "00000000-0000-4000-8000-000000000003";
const NOTE_B_ID = "00000000-0000-4000-8000-000000000004";
const TX_1 = "00000000-0000-4000-8000-000000000005";
const TX_2 = "00000000-0000-4000-8000-000000000006";
const CREATED_AT = "2026-07-17T10:00:00.000Z";
const T1 = "2026-07-17T10:01:00.000Z";
const T2 = "2026-07-17T10:02:00.000Z";

const applyCliPatch = applyCliPatchUntyped as (database: LibraryDatabase, patch: PatchEnvelope) => LibraryDatabase;

function emptyDatabase(): LibraryDatabase {
  return withComputedRevision({ schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} });
}

function game(id: string, title: string, updatedAt = CREATED_AT): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms: [],
    tags: [],
    status: "playing",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: CREATED_AT,
    updatedAt,
  };
}

function note(id: string, bodyMarkdown: string, updatedAt = CREATED_AT): Note {
  return {
    id,
    gameId: NEW_GAME_ID,
    bodyMarkdown,
    attachments: [],
    rank: id === NOTE_A_ID ? 1024 : 2048,
    createdAt: CREATED_AT,
    updatedAt,
  };
}

function operationValue(patch: PatchEnvelope, path: string): Record<string, unknown> {
  return patch.operations[path].value as Record<string, unknown>;
}

describe("browser patch publication lifecycle", () => {
  it("publishes a new game and notes without leaving local operations or conflicts", () => {
    const base = emptyDatabase();
    const local = structuredClone(base);
    local.games[NEW_GAME_ID] = game(NEW_GAME_ID, "New game");
    local.notes[NOTE_A_ID] = note(NOTE_A_ID, "First note");
    local.notes[NOTE_B_ID] = note(NOTE_B_ID, "Second note");

    const patch = diffLibrary(base, local, { changedAt: T1, transactionId: TX_1 });
    expect(operationValue(patch, `/games/${NEW_GAME_ID}`).updatedAt).toBe(T1);
    expect(operationValue(patch, `/notes/${NOTE_A_ID}`).updatedAt).toBe(T1);
    expect(operationValue(patch, `/notes/${NOTE_B_ID}`).updatedAt).toBe(T1);

    const published = applyCliPatch(base, patch);
    const reconciled = reconcilePatch(published, patch);

    expect(reconciled.conflicts).toEqual([]);
    expect(reconciled.patch.operations).toEqual({});
    expect(reconciled.prunedCount).toBe(3);
  });

  it("publishes a note group move through the CLI patch path", () => {
    const draftBase = emptyDatabase();
    draftBase.games[NEW_GAME_ID] = game(NEW_GAME_ID, "New game");
    draftBase.notes[NOTE_A_ID] = note(NOTE_A_ID, "Grouped note");
    const base = withComputedRevision(draftBase);
    const local = structuredClone(base);
    local.notes[NOTE_A_ID].groupRank = 2048;
    const patch = diffLibrary(base, local, { changedAt: T1, transactionId: TX_1 });

    expect(Object.keys(patch.operations)).toEqual([`/notes/${NOTE_A_ID}/groupRank`]);
    const published = applyCliPatch(base, patch);
    expect(published.notes[NOTE_A_ID].groupRank).toBe(2048);
    expect(reconcilePatch(published, patch)).toMatchObject({ conflicts: [], patch: { operations: {} } });
  });

  it("keeps earlier create timestamps when another note is added later", () => {
    const base = emptyDatabase();
    const firstLocal = structuredClone(base);
    firstLocal.games[NEW_GAME_ID] = game(NEW_GAME_ID, "New game");
    firstLocal.notes[NOTE_A_ID] = note(NOTE_A_ID, "First note");
    const firstPatch = diffLibrary(base, firstLocal, { changedAt: T1, transactionId: TX_1 });

    const secondLocal = reconcilePatch(base, firstPatch).effective;
    secondLocal.notes[NOTE_B_ID] = note(NOTE_B_ID, "Second note", T2);
    const secondPatch = diffLibrary(base, secondLocal, { previousPatch: firstPatch, changedAt: T2, transactionId: TX_2 });

    expect(secondPatch.operations[`/games/${NEW_GAME_ID}`].changedAt).toBe(T1);
    expect(secondPatch.operations[`/notes/${NOTE_A_ID}`].changedAt).toBe(T1);
    expect(secondPatch.operations[`/notes/${NOTE_B_ID}`].changedAt).toBe(T2);

    const published = applyCliPatch(base, secondPatch);
    expect(published.games[NEW_GAME_ID].updatedAt).toBe(T2);
    expect(published.notes[NOTE_A_ID].updatedAt).toBe(T1);
    expect(published.notes[NOTE_B_ID].updatedAt).toBe(T2);
    expect(reconcilePatch(published, secondPatch)).toMatchObject({ conflicts: [], patch: { operations: {} } });
  });

  it("does not retimestamp pending creates during an unrelated edit", () => {
    const draftBase = emptyDatabase();
    draftBase.games[EXISTING_GAME_ID] = game(EXISTING_GAME_ID, "Existing game");
    const base = withComputedRevision(draftBase);
    const firstLocal = structuredClone(base);
    firstLocal.games[NEW_GAME_ID] = game(NEW_GAME_ID, "New game");
    firstLocal.notes[NOTE_A_ID] = note(NOTE_A_ID, "First note");
    firstLocal.notes[NOTE_B_ID] = note(NOTE_B_ID, "Second note");
    const firstPatch = diffLibrary(base, firstLocal, { changedAt: T1, transactionId: TX_1 });

    const secondLocal = reconcilePatch(base, firstPatch).effective;
    secondLocal.games[EXISTING_GAME_ID].title = "Edited existing game";
    const secondPatch = diffLibrary(base, secondLocal, { previousPatch: firstPatch, changedAt: T2, transactionId: TX_2 });

    for (const path of [`/games/${NEW_GAME_ID}`, `/notes/${NOTE_A_ID}`, `/notes/${NOTE_B_ID}`]) {
      expect(secondPatch.operations[path]).toEqual(firstPatch.operations[path]);
    }
    expect(secondPatch.operations[`/games/${EXISTING_GAME_ID}/title`].changedAt).toBe(T2);
  });

  it("heals old timestamp-only mismatches but preserves semantic conflicts", () => {
    const base = emptyDatabase();
    const local = structuredClone(base);
    local.games[NEW_GAME_ID] = game(NEW_GAME_ID, "New game");
    local.notes[NOTE_A_ID] = note(NOTE_A_ID, "First note");
    const legacyPatch = diffLibrary(base, local, { changedAt: T1, transactionId: TX_1 });
    operationValue(legacyPatch, `/games/${NEW_GAME_ID}`).updatedAt = CREATED_AT;
    operationValue(legacyPatch, `/notes/${NOTE_A_ID}`).updatedAt = CREATED_AT;
    legacyPatch.operations[`/notes/${NOTE_A_ID}`].changedAt = T2;

    const effective = reconcilePatch(base, legacyPatch).effective;
    const retained = diffLibrary(base, effective, { previousPatch: legacyPatch, changedAt: T2, transactionId: TX_2 });
    expect(retained.operations[`/games/${NEW_GAME_ID}`]).toEqual(legacyPatch.operations[`/games/${NEW_GAME_ID}`]);
    expect(retained.operations[`/notes/${NOTE_A_ID}`]).toEqual(legacyPatch.operations[`/notes/${NOTE_A_ID}`]);

    const published = applyCliPatch(base, legacyPatch);
    expect(published.games[NEW_GAME_ID].updatedAt).toBe(T2);
    expect(reconcilePatch(published, legacyPatch)).toMatchObject({ conflicts: [], patch: { operations: {} } });

    const remotelyChanged = structuredClone(published);
    remotelyChanged.games[NEW_GAME_ID].title = "Different static title";
    remotelyChanged.notes[NOTE_A_ID].bodyMarkdown = "Different static note";
    const changedPublication = withComputedRevision(remotelyChanged);
    expect(reconcilePatch(changedPublication, legacyPatch).conflicts.map((conflict) => conflict.path)).toEqual([
      `/games/${NEW_GAME_ID}`,
      `/notes/${NOTE_A_ID}`,
    ]);
  });
});
