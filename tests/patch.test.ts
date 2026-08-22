// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  MISSING_VALUE_HASH,
  canonicalHash,
  updateInteractiveNoteField,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchConflict,
  type PatchEnvelope,
} from "../src/domain";

const GAME_ID = "00000000-0000-4000-8000-000000000001";
const NOTE_A_ID = "00000000-0000-4000-8000-000000000011";
const NOTE_B_ID = "00000000-0000-4000-8000-000000000012";
const CREATED_NOTE_ID = "00000000-0000-4000-8000-000000000013";
const REVISION = "a".repeat(64);
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000021";
const CREATED_AT = "2026-08-14T09:00:00.000Z";
const CHANGED_AT = "2026-08-14T10:00:00.000Z";

function game(): Game {
  return {
    id: GAME_ID,
    title: "Example game",
    coverAssetId: null,
    platforms: [],
    tags: [],
    status: "playing",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function note(id: string, bodyMarkdown: string): Note {
  return {
    id,
    gameId: GAME_ID,
    bodyMarkdown,
    attachments: [],
    rank: id === NOTE_A_ID ? 1024 : 2048,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: REVISION,
    publicationId: PUBLICATION_ID,
    games: { [GAME_ID]: game() },
    notes: {
      [NOTE_A_ID]: note(NOTE_A_ID, "Before"),
      [NOTE_B_ID]: note(NOTE_B_ID, "Sibling"),
    },
    assets: {},
  };
}

function patch(operations: PatchEnvelope["operations"] = {}, blobs: PatchEnvelope["blobs"] = {}): PatchEnvelope {
  return { patchVersion: 2, schemaVersion: 2, baseRevision: REVISION, operations, blobs };
}

function update(input: {
  base: LibraryDatabase;
  effective?: LibraryDatabase;
  patch?: PatchEnvelope;
  conflicts?: readonly PatchConflict[];
  noteId?: string;
  field?: "bodyMarkdown" | "collapsedChecklistSections";
  value: string | string[] | undefined;
  transactionId?: string;
}) {
  return updateInteractiveNoteField({
    base: input.base,
    effective: input.effective ?? input.base,
    patch: input.patch ?? patch(),
    conflicts: input.conflicts ?? [],
    update: { noteId: input.noteId ?? NOTE_A_ID, field: input.field ?? "bodyMarkdown", value: input.value } as never,
    changedAt: CHANGED_AT,
    transactionId: input.transactionId ?? "note-field-tx",
  });
}

describe("interactive note field patch transition", () => {
  it("updates only the target note and body operation while retaining unrelated identities and patch data", () => {
    const base = database();
    const unrelatedOperation = {
      operation: "set" as const,
      value: "Elsewhere",
      baseExists: true,
      baseHash: canonicalHash(""),
      changedAt: CREATED_AT,
      transactionId: "other-tx",
    };
    const inputPatch = patch({ [`/games/${GAME_ID}/reviewMarkdown`]: unrelatedOperation }, { ["b".repeat(64)]: "AQ==" });

    const result = update({ base, patch: inputPatch, value: "After", transactionId: "body-tx" });

    expect(result.effective).not.toBe(base);
    expect(result.effective.notes).not.toBe(base.notes);
    expect(result.effective.notes[NOTE_A_ID]).not.toBe(base.notes[NOTE_A_ID]);
    expect(result.effective.notes[NOTE_B_ID]).toBe(base.notes[NOTE_B_ID]);
    expect(result.effective.assets).toBe(base.assets);
    expect(result.effective.games).not.toBe(base.games);
    expect(result.effective.games[GAME_ID]).not.toBe(base.games[GAME_ID]);
    expect(result.effective.notes[NOTE_A_ID]).toMatchObject({ bodyMarkdown: "After", updatedAt: CHANGED_AT });
    expect(result.patch.operations).toEqual({
      [`/games/${GAME_ID}/reviewMarkdown`]: unrelatedOperation,
      [`/notes/${NOTE_A_ID}/bodyMarkdown`]: {
        operation: "set",
        value: "After",
        baseExists: true,
        baseHash: canonicalHash("Before"),
        changedAt: CHANGED_AT,
        transactionId: "body-tx",
      },
    });
    expect(result.patch.blobs).toBe(inputPatch.blobs);
  });

  it("updates collapsed sections and removes its sparse operation when returned to the base value", () => {
    const base = database();
    base.notes[NOTE_A_ID] = { ...base.notes[NOTE_A_ID], collapsedChecklistSections: ["heading:alpha"] };
    const changed = update({ base, field: "collapsedChecklistSections", value: ["heading:beta"], transactionId: "collapse-tx" });

    expect(changed.patch.operations[`/notes/${NOTE_A_ID}/collapsedChecklistSections`]).toMatchObject({
      operation: "set",
      value: ["heading:beta"],
      baseExists: true,
      baseHash: canonicalHash(["heading:alpha"]),
      changedAt: CHANGED_AT,
      transactionId: "collapse-tx",
    });

    const restored = update({
      base,
      effective: changed.effective,
      patch: changed.patch,
      field: "collapsedChecklistSections",
      value: ["heading:alpha"],
    });

    expect(restored.patch.operations).toEqual({});
    expect(restored.effective.notes[NOTE_A_ID].collapsedChecklistSections).toEqual(["heading:alpha"]);
  });

  it("deletes a saved top-level collapsed heading", () => {
    const base = database();
    base.notes[NOTE_A_ID] = { ...base.notes[NOTE_A_ID], collapsedChecklistSections: ["heading:top-level"] };

    const result = update({ base, field: "collapsedChecklistSections", value: undefined, transactionId: "expand-top-level-tx" });

    expect(Object.prototype.hasOwnProperty.call(result.effective.notes[NOTE_A_ID], "collapsedChecklistSections")).toBe(false);
    expect(result.patch.operations[`/notes/${NOTE_A_ID}/collapsedChecklistSections`]).toEqual({
      operation: "delete",
      baseExists: true,
      baseHash: canonicalHash(["heading:top-level"]),
      changedAt: CHANGED_AT,
      transactionId: "expand-top-level-tx",
    });
  });

  it("replaces a locally created note root operation instead of adding a field operation", () => {
    const base = database();
    const created = note(CREATED_NOTE_ID, "Draft");
    const effective = {
      ...base,
      notes: { ...base.notes, [CREATED_NOTE_ID]: created },
    };
    const rootPath = `/notes/${CREATED_NOTE_ID}`;
    const rootOperation = {
      operation: "set" as const,
      value: created,
      baseExists: false,
      baseHash: MISSING_VALUE_HASH,
      changedAt: CREATED_AT,
      transactionId: "create-tx",
    };
    const inputPatch = patch({ [rootPath]: rootOperation });

    const result = update({
      base,
      effective,
      patch: inputPatch,
      noteId: CREATED_NOTE_ID,
      value: "Changed draft",
      transactionId: "edit-created-tx",
    });

    expect(result.patch.operations).toEqual({
      [rootPath]: {
        ...rootOperation,
        value: { ...created, bodyMarkdown: "Changed draft", updatedAt: CHANGED_AT },
        changedAt: CHANGED_AT,
        transactionId: "edit-created-tx",
      },
    });
    expect(result.patch.operations[`/notes/${CREATED_NOTE_ID}/bodyMarkdown`]).toBeUndefined();
  });

  it("rejects overlapping conflicts without changing its inputs", () => {
    const base = database();
    const inputPatch = patch();
    const rootConflict: PatchConflict = {
      path: `/notes/${NOTE_A_ID}`,
      operation: { operation: "set", value: base.notes[NOTE_A_ID], baseExists: true, baseHash: canonicalHash(base.notes[NOTE_A_ID]), changedAt: CREATED_AT, transactionId: "conflict" },
      staticValue: base.notes[NOTE_A_ID],
      staticExists: true,
    };
    const fieldConflict = { ...rootConflict, path: `/notes/${NOTE_A_ID}/bodyMarkdown` };

    for (const conflicts of [[rootConflict], [fieldConflict]]) {
      expect(() => update({ base, patch: inputPatch, conflicts, value: "Blocked" })).toThrow(/конфликт/i);
      expect(base.notes[NOTE_A_ID].bodyMarkdown).toBe("Before");
      expect(inputPatch.operations).toEqual({});
    }
  });

  it("rejects invalid Markdown and collapsed values before changing a note", () => {
    const base = database();

    expect(() => update({ base, value: "[unsafe](javascript:alert(1))" })).toThrow();
    expect(() => update({ base, field: "collapsedChecklistSections", value: ["heading:one", "heading:one"] })).toThrow();
    expect(base.notes[NOTE_A_ID]).toEqual(note(NOTE_A_ID, "Before"));
  });

  it("rejects invalid operation metadata without changing its inputs", () => {
    const base = database();
    const inputPatch = patch();
    const invalidMetadata = [
      { changedAt: "not-a-date", transactionId: "valid-tx" },
      { changedAt: CHANGED_AT, transactionId: "" },
    ];

    for (const item of invalidMetadata) {
      expect(() => updateInteractiveNoteField({
        base,
        effective: base,
        patch: inputPatch,
        conflicts: [],
        update: { noteId: NOTE_A_ID, field: "bodyMarkdown", value: "After" },
        ...item,
      })).toThrow();
      expect(base.notes[NOTE_A_ID]).toEqual(note(NOTE_A_ID, "Before"));
      expect(inputPatch.operations).toEqual({});
    }
  });

  it("rejects an existing same-note root operation without adding a field operation", () => {
    const base = database();
    const rootPath = `/notes/${NOTE_A_ID}`;
    const inputPatch = patch({
      [rootPath]: {
        operation: "set",
        value: { ...base.notes[NOTE_A_ID], bodyMarkdown: "Existing root change" },
        baseExists: true,
        baseHash: canonicalHash(base.notes[NOTE_A_ID]),
        changedAt: CREATED_AT,
        transactionId: "root-tx",
      },
    });

    expect(() => update({ base, patch: inputPatch, value: "After" })).toThrow();
    expect(inputPatch.operations).toEqual({
      [rootPath]: expect.objectContaining({ value: expect.objectContaining({ bodyMarkdown: "Existing root change" }) }),
    });
    expect(base.notes[NOTE_A_ID]).toEqual(note(NOTE_A_ID, "Before"));
  });

  it("rejects a false-missing root operation when the note exists in the base", () => {
    const base = database();
    const rootPath = `/notes/${NOTE_A_ID}`;
    const rootOperation = {
      operation: "set" as const,
      value: { ...base.notes[NOTE_A_ID], bodyMarkdown: "Stale root change" },
      baseExists: false,
      baseHash: MISSING_VALUE_HASH,
      changedAt: CREATED_AT,
      transactionId: "stale-root-tx",
    };
    const inputPatch = patch({ [rootPath]: rootOperation });

    expect(() => update({ base, patch: inputPatch, value: "After" })).toThrow();
    expect(inputPatch.operations).toEqual({ [rootPath]: rootOperation });
    expect(base.notes[NOTE_A_ID]).toEqual(note(NOTE_A_ID, "Before"));
  });

  it("rejects a locally created root operation without the missing-value hash", () => {
    const base = database();
    const created = note(CREATED_NOTE_ID, "Draft");
    const effective = { ...base, notes: { ...base.notes, [CREATED_NOTE_ID]: created } };
    const rootPath = `/notes/${CREATED_NOTE_ID}`;
    const rootOperation = {
      operation: "set" as const,
      value: created,
      baseExists: false,
      baseHash: "f".repeat(64),
      changedAt: CREATED_AT,
      transactionId: "create-tx",
    };
    const inputPatch = patch({ [rootPath]: rootOperation });

    expect(() => update({ base, effective, patch: inputPatch, noteId: CREATED_NOTE_ID, value: "After" })).toThrow();
    expect(inputPatch.operations).toEqual({ [rootPath]: rootOperation });
    expect(effective.notes[CREATED_NOTE_ID]).toBe(created);
  });
});
