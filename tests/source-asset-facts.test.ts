import { describe, expect, it } from "vitest";
import type { LibraryDatabase } from "../src/domain/types";
import type { SourceAssetOccurrence } from "../src/source/types";
import {
  collectSourceAssetOccurrences,
  inspectSourceAsset,
  parseWebPDimensions,
} from "../src/source/assetFacts";

const GAME_A_ID = "11111111-1111-4111-8111-111111111111";
const GAME_B_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_A_ID = "33333333-3333-4333-8333-333333333333";
const NOTE_B_ID = "44444444-4444-4444-8444-444444444444";
const PROGRESS_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-08-11T00:00:00.000Z";
const IMAGE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FILE_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// Independent literal RIFF/WebP fixtures. The expected dimensions below are
// hand-derived from the format bitfields, never from the parser under test.
const VP8_1_X_1 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 32, 10, 0, 0, 0,
  0, 0, 0, 157, 1, 42, 1, 0, 1, 0,
]);

const VP8_512_X_300 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 32, 10, 0, 0, 0,
  0, 0, 0, 157, 1, 42, 0, 2, 44, 1,
]);

const VP8_16383_X_16383 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 32, 10, 0, 0, 0,
  0, 0, 0, 157, 1, 42, 255, 63, 255, 63,
]);

const VP8L_420_X_3072 = new Uint8Array([
  82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 76, 5, 0, 0, 0,
  47, 163, 193, 255, 2, 0,
]);

const VP8L_16384_X_16384 = new Uint8Array([
  82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 76, 5, 0, 0, 0,
  47, 255, 255, 255, 15, 0,
]);

const VP8L_16384_X_1 = new Uint8Array([
  82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 76, 5, 0, 0, 0,
  47, 255, 63, 0, 0, 0,
]);

const VP8X_64_X_64 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 88, 10, 0, 0, 0,
  0, 0, 0, 0, 63, 0, 0, 63, 0, 0,
]);

const VP8X_16777216_X_1 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 88, 10, 0, 0, 0,
  0, 0, 0, 0, 255, 255, 255, 0, 0, 0,
]);

const VP8X_65535_X_65537 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 88, 10, 0, 0, 0,
  0, 0, 0, 0, 254, 255, 0, 0, 0, 1,
]);

const VP8X_65536_X_65536 = new Uint8Array([
  82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
  86, 80, 56, 88, 10, 0, 0, 0,
  0, 0, 0, 0, 255, 255, 0, 255, 255, 0,
]);

const VP8X_64_SHA = "995f88d98ba63a015ed5b1179d2454be029d3205ac707911c046dcd86fcb3c97";
const VP8L_420_SHA = "e731870f3a3cc9409359425a14b47943602140743096425681d976c2445c7050";
const VP8L_16384_X_1_SHA = "178865bebcca6e1bff9440006fb2780b2ed823e041bbfdd49e5dde29dde9b38b";
const FILE_BYTES = new Uint8Array([0, 1, 2, 3, 4]);
const FILE_BYTES_SHA = "08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48db414871f51c9cb35283d";
const MP4_BYTES = new Uint8Array([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
  0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50,
]);
const MP4_BYTES_SHA = "c8c5af84ac765d911a9ab05bc9a19d15d0b1bc5cf0654eff4469ce536410654e";

function changed(bytes: Uint8Array, index: number, value: number): Uint8Array {
  const result = bytes.slice();
  result[index] = value;
  return result;
}

function game(id: string, title: string): LibraryDatabase["games"][string] {
  return {
    id,
    title,
    coverAssetId: null,
    platforms: [],
    tags: [],
    status: "wishlist",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function occurrenceDatabase(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: "",
    publicationId: null,
    games: {
      [GAME_B_ID]: game(GAME_B_ID, "B"),
      [GAME_A_ID]: {
        ...game(GAME_A_ID, "A"),
        coverAssetId: IMAGE_ID,
        progressItems: [{ id: PROGRESS_ID, iconAssetId: IMAGE_ID, noteId: NOTE_A_ID }],
      },
    },
    notes: {
      [NOTE_B_ID]: {
        id: NOTE_B_ID,
        gameId: GAME_B_ID,
        bodyMarkdown: "B",
        attachments: [{ type: "image", assetId: IMAGE_ID, alt: "Second owner" }],
        rank: 1024,
        createdAt: NOW,
        updatedAt: NOW,
      },
      [NOTE_A_ID]: {
        id: NOTE_A_ID,
        gameId: GAME_A_ID,
        bodyMarkdown: "A",
        attachments: [
          { type: "image", assetId: IMAGE_ID, alt: "First owner" },
          { type: "file", assetId: FILE_ID, label: "Save A" },
        ],
        rank: 1024,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    assets: {
      [FILE_ID]: {
        id: FILE_ID,
        kind: "file",
        mime: "application/octet-stream",
        byteLength: 5,
        originalName: "save.dat",
      },
      [IMAGE_ID]: {
        id: IMAGE_ID,
        kind: "image",
        mime: "image/webp",
        width: 64,
        height: 64,
        byteLength: 30,
        alt: "Cover alt",
        originalName: "map.png",
      },
    },
  };
}

function noteImageOccurrence(
  assetId: string,
  gameId = GAME_A_ID,
  noteId = NOTE_A_ID,
  alt = "Map A",
  originalName = "map.png",
): SourceAssetOccurrence {
  return {
    gameId,
    assetId,
    kind: "image",
    originalName,
    references: [{ role: "note-image", gameId, assetId, originalName, noteId, attachmentIndex: 0, alt }],
  };
}

function progressOccurrence(assetId: string, originalName = "progress.png"): SourceAssetOccurrence {
  return {
    gameId: GAME_A_ID,
    assetId,
    kind: "image",
    originalName,
    references: [{ role: "progress-icon", gameId: GAME_A_ID, assetId, originalName, progressItemId: PROGRESS_ID }],
  };
}

function fileOccurrence(
  assetId: string,
  gameId = GAME_A_ID,
  mime = "application/octet-stream",
  label = "Save",
  originalName = "save.dat",
): SourceAssetOccurrence {
  return {
    gameId,
    assetId,
    kind: "file",
    originalName,
    references: [{ role: "note-file", gameId, assetId, originalName, noteId: NOTE_A_ID, attachmentIndex: 0, label, mime }],
  };
}

describe("WebP dimension parsing", () => {
  it.each([
    ["VP8 minimum", VP8_1_X_1, { width: 1, height: 1 }],
    ["VP8 ordinary", VP8_512_X_300, { width: 512, height: 300 }],
    ["VP8 maximum", VP8_16383_X_16383, { width: 16383, height: 16383 }],
    ["VP8L ordinary", VP8L_420_X_3072, { width: 420, height: 3072 }],
    ["VP8L maximum", VP8L_16384_X_16384, { width: 16384, height: 16384 }],
    ["VP8X progress", VP8X_64_X_64, { width: 64, height: 64 }],
    ["VP8X maximum width", VP8X_16777216_X_1, { width: 16777216, height: 1 }],
    ["VP8X maximum canvas area", VP8X_65535_X_65537, { width: 65535, height: 65537 }],
  ])("extracts %s dimensions", (_name, bytes, expected) => {
    expect(parseWebPDimensions(bytes)).toEqual(expected);
  });

  it.each([
    ["empty input", new Uint8Array()],
    ["wrong RIFF signature", changed(VP8_1_X_1, 0, 0)],
    ["wrong WEBP signature", changed(VP8_1_X_1, 8, 0)],
    ["RIFF length beyond input", changed(VP8_1_X_1, 4, 23)],
    ["bytes trailing outside RIFF", new Uint8Array([...VP8_1_X_1, 0])],
    ["truncated VP8 chunk", VP8_1_X_1.slice(0, -1)],
    ["invalid VP8 keyframe start code", changed(VP8_1_X_1, 23, 0)],
    ["inter-frame VP8 header", changed(VP8_1_X_1, 20, 1)],
    ["zero VP8 width", changed(VP8_1_X_1, 26, 0)],
    ["missing VP8L padding", VP8L_420_X_3072.slice(0, -1)],
    ["nonzero VP8L padding", changed(VP8L_420_X_3072, 25, 1)],
    ["invalid VP8L signature", changed(VP8L_420_X_3072, 20, 0)],
    ["truncated VP8X header", new Uint8Array([
      82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80,
      86, 80, 56, 88, 8, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 63,
    ])],
    ["VP8X canvas area above 32-bit maximum", VP8X_65536_X_65536],
    ["unsupported chunks only", new Uint8Array([
      82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80,
      74, 85, 78, 75, 0, 0, 0, 0,
    ])],
    ["overflowing chunk length", new Uint8Array([
      82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80,
      74, 85, 78, 75, 255, 255, 255, 255,
    ])],
    ["malformed chunk after valid dimensions", new Uint8Array([
      82, 73, 70, 70, 30, 0, 0, 0, 87, 69, 66, 80,
      86, 80, 56, 88, 10, 0, 0, 0, 0, 0, 0, 0, 63, 0, 0, 63, 0, 0,
      74, 85, 78, 75, 255, 255, 255, 255,
    ])],
  ])("rejects %s", (_name, bytes) => {
    expect(() => parseWebPDimensions(bytes)).toThrow();
  });
});

describe("source asset occurrence collection", () => {
  it("collapses same-game roles and sorts occurrences and references deterministically", () => {
    expect(collectSourceAssetOccurrences(occurrenceDatabase())).toEqual([
      {
        gameId: GAME_A_ID,
        assetId: IMAGE_ID,
        kind: "image",
        originalName: "map.png",
        references: [
          { role: "cover", gameId: GAME_A_ID, assetId: IMAGE_ID, originalName: "map.png", alt: "Cover alt" },
          { role: "progress-icon", gameId: GAME_A_ID, assetId: IMAGE_ID, originalName: "map.png", progressItemId: PROGRESS_ID },
          { role: "note-image", gameId: GAME_A_ID, assetId: IMAGE_ID, originalName: "map.png", noteId: NOTE_A_ID, attachmentIndex: 0, alt: "First owner" },
        ],
      },
      {
        gameId: GAME_A_ID,
        assetId: FILE_ID,
        kind: "file",
        originalName: "save.dat",
        references: [
          { role: "note-file", gameId: GAME_A_ID, assetId: FILE_ID, originalName: "save.dat", noteId: NOTE_A_ID, attachmentIndex: 1, label: "Save A", mime: "application/octet-stream" },
        ],
      },
      {
        gameId: GAME_B_ID,
        assetId: IMAGE_ID,
        kind: "image",
        originalName: "map.png",
        references: [
          { role: "note-image", gameId: GAME_B_ID, assetId: IMAGE_ID, originalName: "map.png", noteId: NOTE_B_ID, attachmentIndex: 0, alt: "Second owner" },
        ],
      },
    ]);
  });

  it("rejects a progress reference to a note owned by another game", () => {
    const database = occurrenceDatabase();
    database.games[GAME_A_ID].progressItems![0].noteId = NOTE_B_ID;
    expect(() => collectSourceAssetOccurrences(database)).toThrow(/progress.*game|ownership/i);
  });

  it("rejects a SHA referenced as both image and file", () => {
    const database = occurrenceDatabase();
    database.notes[NOTE_A_ID].attachments[1] = { type: "file", assetId: IMAGE_ID, label: "Mixed" };
    delete database.assets[FILE_ID];
    expect(() => collectSourceAssetOccurrences(database)).toThrow(/image.*file|kind/i);
  });

  it("rejects references whose asset metadata is missing", () => {
    const database = occurrenceDatabase();
    delete database.assets[IMAGE_ID];
    expect(() => collectSourceAssetOccurrences(database)).toThrow(/missing|asset/i);
  });
});

describe("source asset binary inspection", () => {
  it("derives image facts and chooses the first note-image alt by stable owner identity", () => {
    const later = noteImageOccurrence(VP8L_420_SHA, GAME_B_ID, NOTE_B_ID, "Later alt");
    const first = noteImageOccurrence(VP8L_420_SHA, GAME_A_ID, NOTE_A_ID, "First alt");

    expect(inspectSourceAsset([later, first], VP8L_420_X_3072)).toEqual({
      id: VP8L_420_SHA,
      kind: "image",
      mime: "image/webp",
      width: 420,
      height: 3072,
      byteLength: 26,
      alt: "First alt",
      originalName: "map.png",
    });
  });

  it("prefers an agreed cover alt over owner-specific note-image alts", () => {
    const noteOwner = noteImageOccurrence(VP8X_64_SHA, GAME_A_ID, NOTE_A_ID, "Note alt");
    const coverOwner: SourceAssetOccurrence = {
      gameId: GAME_B_ID,
      assetId: VP8X_64_SHA,
      kind: "image",
      originalName: "map.png",
      references: [{ role: "cover", gameId: GAME_B_ID, assetId: VP8X_64_SHA, originalName: "map.png", alt: "Cover alt" }],
    };

    expect(inspectSourceAsset([noteOwner, coverOwner], VP8X_64_X_64)).toMatchObject({ alt: "Cover alt" });
  });

  it("uses empty global alt for a progress-only 64 by 64 image", () => {
    expect(inspectSourceAsset([progressOccurrence(VP8X_64_SHA)], VP8X_64_X_64)).toEqual({
      id: VP8X_64_SHA,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 30,
      alt: "",
      originalName: "progress.png",
    });
  });

  it("rejects a progress icon whose parsed dimensions are not 64 by 64", () => {
    expect(() => inspectSourceAsset([progressOccurrence(VP8L_420_SHA)], VP8L_420_X_3072)).toThrow(/64.*64/);
  });

  it("rejects parser-valid image dimensions outside the schema-2 runtime limit", () => {
    expect(() => inspectSourceAsset(
      [noteImageOccurrence(VP8L_16384_X_1_SHA)],
      VP8L_16384_X_1,
    )).toThrow(/schema-2 runtime limit 16383×16383/i);
  });

  it.each([
    ["arbitrary", FILE_BYTES_SHA, FILE_BYTES, "application/octet-stream", "save.dat", 5],
    ["MP4", MP4_BYTES_SHA, MP4_BYTES, "video/mp4", "walkthrough.mov", 24],
  ])("preserves %s file MIME and derives exact SHA and byte length", (_name, id, bytes, mime, originalName, byteLength) => {
    const first = fileOccurrence(id, GAME_A_ID, mime, "First label", originalName);
    const second = fileOccurrence(id, GAME_B_ID, mime, "Different owner label", originalName);
    expect(inspectSourceAsset([second, first], bytes)).toEqual({ id, kind: "file", mime, byteLength, originalName });
  });

  it("rejects empty occurrence input", () => {
    expect(() => inspectSourceAsset([], FILE_BYTES)).toThrow(/occurrence|empty/i);
  });

  it.each([
    ["uppercase identity", [fileOccurrence(FILE_BYTES_SHA.toUpperCase())], /lowercase|SHA/i],
    ["mixed identities", [fileOccurrence(FILE_BYTES_SHA), fileOccurrence("f".repeat(64), GAME_B_ID)], /same.*SHA|identity/i],
    ["mixed kinds", [noteImageOccurrence(VP8X_64_SHA), fileOccurrence(VP8X_64_SHA, GAME_B_ID)], /kind|image.*file/i],
    ["differing original names", [noteImageOccurrence(VP8X_64_SHA), noteImageOccurrence(VP8X_64_SHA, GAME_B_ID, NOTE_B_ID, "B", "other.png")], /originalName/i],
    ["differing cover alts", [
      { gameId: GAME_A_ID, assetId: VP8X_64_SHA, kind: "image", originalName: "map.png", references: [{ role: "cover", gameId: GAME_A_ID, assetId: VP8X_64_SHA, originalName: "map.png", alt: "A" }] },
      { gameId: GAME_B_ID, assetId: VP8X_64_SHA, kind: "image", originalName: "map.png", references: [{ role: "cover", gameId: GAME_B_ID, assetId: VP8X_64_SHA, originalName: "map.png", alt: "B" }] },
    ], /cover.*alt/i],
    ["reference provenance mismatch", [{
      gameId: GAME_A_ID,
      assetId: VP8X_64_SHA,
      kind: "image",
      originalName: "map.png",
      references: [{ role: "note-image", gameId: GAME_B_ID, assetId: VP8X_64_SHA, originalName: "map.png", noteId: NOTE_A_ID, attachmentIndex: 0, alt: "Map" }],
    }], /provenance|gameId/i],
    ["duplicate game occurrence", [noteImageOccurrence(VP8X_64_SHA), noteImageOccurrence(VP8X_64_SHA)], /duplicate|gameId/i],
  ] as const)("rejects %s", (_name, occurrences, message) => {
    expect(() => inspectSourceAsset(occurrences as readonly SourceAssetOccurrence[], VP8X_64_X_64)).toThrow(message);
  });

  it("rejects reference originalName provenance that differs from its occurrence", () => {
    const occurrence = noteImageOccurrence(VP8X_64_SHA);
    occurrence.references[0].originalName = "other.png";
    expect(() => inspectSourceAsset([occurrence], VP8X_64_X_64)).toThrow(/reference.*originalName.*provenance/i);
  });

  it("rejects reference assetId provenance that differs from its occurrence", () => {
    const occurrence = noteImageOccurrence(VP8X_64_SHA);
    occurrence.references[0].assetId = "f".repeat(64);
    expect(() => inspectSourceAsset([occurrence], VP8X_64_X_64)).toThrow(/reference.*assetId.*provenance/i);
  });

  it("rejects an occurrence with empty reference provenance", () => {
    const occurrence = { ...noteImageOccurrence(VP8X_64_SHA), references: [] } as SourceAssetOccurrence;
    expect(() => inspectSourceAsset([occurrence], VP8X_64_X_64)).toThrow(/no owner provenance/i);
  });

  it.each([
    ["file role on an image occurrence", {
      gameId: GAME_A_ID,
      assetId: VP8X_64_SHA,
      kind: "image",
      originalName: "map.png",
      references: [{
        role: "note-file",
        gameId: GAME_A_ID,
        assetId: VP8X_64_SHA,
        originalName: "map.png",
        noteId: NOTE_A_ID,
        attachmentIndex: 0,
        label: "Map",
        mime: "application/octet-stream",
      }],
    }, VP8X_64_X_64],
    ["image role on a file occurrence", {
      gameId: GAME_A_ID,
      assetId: FILE_BYTES_SHA,
      kind: "file",
      originalName: "save.dat",
      references: [{
        role: "note-image",
        gameId: GAME_A_ID,
        assetId: FILE_BYTES_SHA,
        originalName: "save.dat",
        noteId: NOTE_A_ID,
        attachmentIndex: 0,
        alt: "Save",
      }],
    }, FILE_BYTES],
  ] as const)("rejects %s", (_name, occurrence, bytes) => {
    expect(() => inspectSourceAsset(
      [occurrence as unknown as SourceAssetOccurrence],
      bytes,
    )).toThrow(/role.*image\/file kind/i);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ] as const)("rejects %s file MIME provenance", (_name, mime) => {
    const occurrence = fileOccurrence(FILE_BYTES_SHA);
    const reference = occurrence.references[0] as { mime?: string };
    if (mime === undefined) delete reference.mime;
    else reference.mime = mime;
    expect(() => inspectSourceAsset([occurrence], FILE_BYTES)).toThrow(/MIME.*empty/i);
  });

  it("rejects differing arbitrary-file MIME while allowing different labels", () => {
    const first = fileOccurrence(FILE_BYTES_SHA, GAME_A_ID, "application/octet-stream", "A");
    const second = fileOccurrence(FILE_BYTES_SHA, GAME_B_ID, "application/pdf", "B");
    expect(() => inspectSourceAsset([first, second], FILE_BYTES)).toThrow(/MIME/i);
  });

  it("rejects bytes whose SHA does not match the occurrence identity", () => {
    expect(() => inspectSourceAsset([fileOccurrence("0".repeat(64))], FILE_BYTES)).toThrow(/SHA/i);
  });

  it("rejects malformed image bytes even when their SHA matches", () => {
    const malformed = new Uint8Array([1, 2, 3]);
    const malformedSha = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
    expect(() => inspectSourceAsset([noteImageOccurrence(malformedSha)], malformed)).toThrow(/WebP|RIFF|image/i);
  });
});
