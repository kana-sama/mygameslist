import {
  MISSING_VALUE_HASH,
  applyPatch,
  assertSourceRepresentable,
  deriveImageAssetAlt,
  diffLibrary,
  indexAssetOwners,
  normalizeLibraryDatabase,
  normalizePublishedLibrary,
  patchOperationSourceIssues,
  reconcilePatch,
  resolveConflict,
  validateLibrary,
  validatePatch,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchEnvelope,
} from "../src/domain";

const GAME_A = "11111111-1111-4111-8111-111111111111";
const GAME_B = "22222222-2222-4222-8222-222222222222";
const NOTE_A = "33333333-3333-4333-8333-333333333333";
const NOTE_B = "44444444-4444-4444-8444-444444444444";
const PROGRESS_A = "55555555-5555-4555-8555-555555555555";
const UPPERCASE_GAME_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase();
const UPPERCASE_NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".toUpperCase();
const UPPERCASE_PROGRESS_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc".toUpperCase();
const IMAGE = "a".repeat(64);
const FILE = "b".repeat(64);
const ORPHAN = "c".repeat(64);
const NOW = "2026-08-11T10:00:00.000Z";
const PUBLICATION_ID = "66666666-6666-4666-8666-666666666666";

function game(id: string): Game {
  return {
    id,
    title: `Game ${id.slice(0, 1)}`,
    coverAssetId: null,
    platforms: ["PC"],
    tags: ["RPG"],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "Review\n",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function note(id: string, gameId: string): Note {
  return { id, gameId, bodyMarkdown: "Body\n", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
}

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: "d".repeat(64),
    publicationId: PUBLICATION_ID,
    games: { [GAME_A]: game(GAME_A), [GAME_B]: game(GAME_B) },
    notes: { [NOTE_A]: note(NOTE_A, GAME_A), [NOTE_B]: note(NOTE_B, GAME_B) },
    assets: {},
  };
}

describe("asset ownership", () => {
  it("indexes every owner in a stable semantic order and preserves shared metadata", () => {
    const value = database();
    value.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 64, height: 64, byteLength: 12, alt: "Shared cover", originalName: "shared.webp" };
    value.assets[FILE] = { id: FILE, kind: "file", mime: "application/pdf", byteLength: 5, originalName: "guide.pdf" };
    value.games[GAME_B].coverAssetId = IMAGE;
    value.games[GAME_A].coverAssetId = IMAGE;
    value.games[GAME_A].progressItems = [{ id: PROGRESS_A, iconAssetId: IMAGE, noteId: NOTE_A }];
    value.notes[NOTE_B].attachments = [{ type: "file", assetId: FILE, label: "Later guide" }];
    value.notes[NOTE_A].attachments = [
      { type: "image", assetId: IMAGE, alt: "Local screenshot" },
      { type: "file", assetId: FILE, label: "First guide" },
    ];

    const reordered: LibraryDatabase = {
      ...structuredClone(value),
      games: { [GAME_B]: structuredClone(value.games[GAME_B]), [GAME_A]: structuredClone(value.games[GAME_A]) },
      notes: { [NOTE_B]: structuredClone(value.notes[NOTE_B]), [NOTE_A]: structuredClone(value.notes[NOTE_A]) },
      assets: { [FILE]: structuredClone(value.assets[FILE]), [IMAGE]: structuredClone(value.assets[IMAGE]) },
    };

    const expectedImageOwners = [
      { role: "cover", gameId: GAME_A, alt: "Shared cover", originalName: "shared.webp" },
      { role: "progress", gameId: GAME_A, progressItemId: PROGRESS_A, originalName: "shared.webp" },
      { role: "note-image", gameId: GAME_A, noteId: NOTE_A, index: 0, alt: "Local screenshot", originalName: "shared.webp" },
      { role: "cover", gameId: GAME_B, alt: "Shared cover", originalName: "shared.webp" },
    ];
    const expectedFileOwners = [
      { role: "note-file", gameId: GAME_A, noteId: NOTE_A, index: 1, label: "First guide", originalName: "guide.pdf", mime: "application/pdf" },
      { role: "note-file", gameId: GAME_B, noteId: NOTE_B, index: 0, label: "Later guide", originalName: "guide.pdf", mime: "application/pdf" },
    ];

    expect(indexAssetOwners(value).get(IMAGE)).toEqual(expectedImageOwners);
    expect(indexAssetOwners(value).get(FILE)).toEqual(expectedFileOwners);
    expect([...indexAssetOwners(reordered)]).toEqual([...indexAssetOwners(value)]);
  });

  it("derives image alt from a cover, then the first ordered note image, then empty", () => {
    const value = database();
    value.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Cover wins", originalName: "image.webp" };
    value.games[GAME_B].coverAssetId = IMAGE;
    value.notes[NOTE_B].attachments = [{ type: "image", assetId: IMAGE, alt: "Second" }];
    value.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "First" }];
    expect(deriveImageAssetAlt(value, IMAGE)).toBe("Cover wins");

    value.games[GAME_B].coverAssetId = null;
    expect(deriveImageAssetAlt(value, IMAGE)).toBe("First");

    value.notes[NOTE_A].attachments = [];
    value.notes[NOTE_B].attachments = [];
    expect(deriveImageAssetAlt(value, IMAGE)).toBe("");
  });
});

describe("library normalization", () => {
  it("normalizes documented defaults, map order, reachability, and derived alt idempotently", () => {
    const value = database();
    value.games = { [GAME_B]: value.games[GAME_B], [GAME_A]: { ...value.games[GAME_A], progressItems: [] } };
    value.notes = {
      [NOTE_B]: value.notes[NOTE_B],
      [NOTE_A]: { ...value.notes[NOTE_A], groupRank: 1024, doubleWidth: false, doubleHeight: false, collapsedChecklistSections: [], attachments: [{ type: "image", assetId: IMAGE, alt: "Owner alt" }] },
    };
    value.assets = {
      [ORPHAN]: { id: ORPHAN, kind: "file", mime: "application/octet-stream", byteLength: 1, originalName: "orphan.bin" },
      [IMAGE]: { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Stale", originalName: "screen.webp" },
    };

    const normalized = normalizeLibraryDatabase(value);

    expect(normalized.publicationId).toBe(value.publicationId);
    expect(normalized.revision).toBe(value.revision);
    expect(Object.keys(normalized.games)).toEqual([GAME_A, GAME_B]);
    expect(Object.keys(normalized.notes)).toEqual([NOTE_A, NOTE_B]);
    expect(Object.keys(normalized.assets)).toEqual([IMAGE]);
    expect(normalized.games[GAME_A]).not.toHaveProperty("progressItems");
    expect(normalized.notes[NOTE_A]).not.toHaveProperty("groupRank");
    expect(normalized.notes[NOTE_A]).not.toHaveProperty("doubleWidth");
    expect(normalized.notes[NOTE_A]).not.toHaveProperty("doubleHeight");
    expect(normalized.notes[NOTE_A]).not.toHaveProperty("collapsedChecklistSections");
    expect(normalized.assets[IMAGE]).toMatchObject({ alt: "Owner alt" });
    expect(normalizeLibraryDatabase(normalized)).toEqual(normalized);
    expect(value.assets).toHaveProperty(ORPHAN);
  });

  it("recomputes revision only for the published normalization entry point", async () => {
    const value = database();
    value.revision = "e".repeat(64);

    const normalized = normalizeLibraryDatabase(value);
    const published = await normalizePublishedLibrary(value);

    expect(normalized.revision).toBe("e".repeat(64));
    expect(published.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(published.revision).not.toBe("e".repeat(64));
    expect(await normalizePublishedLibrary(published)).toEqual(published);
  });
});

describe("source representability", () => {
  const uppercasePathCases: ReadonlyArray<{ label: string; path: string; value: unknown }> = [
    { label: "game root", path: `/games/${UPPERCASE_GAME_ID}`, value: game(GAME_A) },
    { label: "game title", path: `/games/${UPPERCASE_GAME_ID}/title`, value: "Title" },
    { label: "game cover", path: `/games/${UPPERCASE_GAME_ID}/coverAssetId`, value: null },
    { label: "game progress", path: `/games/${UPPERCASE_GAME_ID}/progressItems`, value: [] },
    { label: "game platforms", path: `/games/${UPPERCASE_GAME_ID}/platforms`, value: [] },
    { label: "game tags", path: `/games/${UPPERCASE_GAME_ID}/tags`, value: [] },
    { label: "game status", path: `/games/${UPPERCASE_GAME_ID}/status`, value: "wishlist" },
    { label: "game placement", path: `/games/${UPPERCASE_GAME_ID}/placement`, value: { tierId: "a", rank: 1 } },
    { label: "game review", path: `/games/${UPPERCASE_GAME_ID}/reviewMarkdown`, value: "" },
    { label: "note root", path: `/notes/${UPPERCASE_NOTE_ID}`, value: note(NOTE_A, GAME_A) },
    { label: "note body", path: `/notes/${UPPERCASE_NOTE_ID}/bodyMarkdown`, value: "" },
    { label: "note attachments", path: `/notes/${UPPERCASE_NOTE_ID}/attachments`, value: [] },
    { label: "note collapsed sections", path: `/notes/${UPPERCASE_NOTE_ID}/collapsedChecklistSections`, value: [] },
    { label: "note double height", path: `/notes/${UPPERCASE_NOTE_ID}/doubleHeight`, value: false },
    { label: "note double width", path: `/notes/${UPPERCASE_NOTE_ID}/doubleWidth`, value: false },
    { label: "note group rank", path: `/notes/${UPPERCASE_NOTE_ID}/groupRank`, value: 1 },
    { label: "note rank", path: `/notes/${UPPERCASE_NOTE_ID}/rank`, value: 1 },
    { label: "asset root", path: `/assets/${IMAGE.toUpperCase()}`, value: { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "", originalName: "image.webp" } },
  ];

  it.each(uppercasePathCases)("accepts canonical and rejects noncanonical $label path identity for every operation kind", ({ path, value }) => {
    const common = { baseExists: true, baseHash: "f".repeat(64), changedAt: NOW, transactionId: "uppercase-path" };
    const canonicalPath = path
      .replace(UPPERCASE_GAME_ID, UPPERCASE_GAME_ID.toLowerCase())
      .replace(UPPERCASE_NOTE_ID, UPPERCASE_NOTE_ID.toLowerCase())
      .replace(IMAGE.toUpperCase(), IMAGE);

    expect(patchOperationSourceIssues(canonicalPath, { ...common, operation: "set", value })).toEqual([]);
    expect(patchOperationSourceIssues(canonicalPath, { ...common, operation: "delete" })).toEqual([]);
    expect(patchOperationSourceIssues(path, { ...common, operation: "set", value })).not.toEqual([]);
    expect(patchOperationSourceIssues(path, { ...common, operation: "delete" })).not.toEqual([]);
  });

  it.each([
    ["uppercase game UUID", (value: LibraryDatabase) => { const original = value.games[GAME_A]; delete value.games[GAME_A]; value.games[UPPERCASE_GAME_ID] = { ...original, id: UPPERCASE_GAME_ID }; value.notes[NOTE_A].gameId = UPPERCASE_GAME_ID; }],
    ["uppercase publication UUID", (value: LibraryDatabase) => { value.publicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(); }],
    ["uppercase SHA reference", (value: LibraryDatabase) => { value.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE.toUpperCase(), alt: "Image" }]; }],
    ["relative link", (value: LibraryDatabase) => { value.notes[NOTE_A].attachments = [{ type: "link", url: "../guide", label: "Guide" }]; }],
    ["credentialed link", (value: LibraryDatabase) => { value.notes[NOTE_A].attachments = [{ type: "link", url: "https://user:secret@example.com/guide", label: "Guide" }]; }],
    ["ambiguous HTTP URL", (value: LibraryDatabase) => { value.notes[NOTE_A].attachments = [{ type: "link", url: "https:example.com/guide", label: "Guide" }]; }],
    ["path filename", (value: LibraryDatabase) => { value.assets[FILE] = { id: FILE, kind: "file", mime: "application/pdf", byteLength: 1, originalName: "../guide.pdf" }; value.notes[NOTE_A].attachments = [{ type: "file", assetId: FILE, label: "Guide" }]; }],
    ["dot filename", (value: LibraryDatabase) => { value.assets[FILE] = { id: FILE, kind: "file", mime: "application/pdf", byteLength: 1, originalName: "." }; value.notes[NOTE_A].attachments = [{ type: "file", assetId: FILE, label: "Guide" }]; }],
    ["multiline attachment alt", (value: LibraryDatabase) => { value.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Line\nbreak", originalName: "image.webp" }; value.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "Line\nbreak" }]; }],
    ["Unicode line separator in attachment label", (value: LibraryDatabase) => { value.notes[NOTE_A].attachments = [{ type: "link", url: "https://example.com", label: "Line\u2028break" }]; }],
    ["control in MIME", (value: LibraryDatabase) => { value.assets[FILE] = { id: FILE, kind: "file", mime: "application/\u0007pdf", byteLength: 1, originalName: "guide.pdf" }; value.notes[NOTE_A].attachments = [{ type: "file", assetId: FILE, label: "Guide" }]; }],
    ["unpaired surrogate", (value: LibraryDatabase) => { value.games[GAME_A].title = "Broken \ud800"; }],
  ])("rejects %s", (_label, mutate) => {
    const value = database();
    mutate(value);
    expect(() => assertSourceRepresentable(value)).toThrow();
  });

  it("accepts absolute credential-free HTTP(S), Markdown line breaks, and safe display names", () => {
    const value = database();
    value.assets[FILE] = { id: FILE, kind: "file", mime: "application/pdf", byteLength: 1, originalName: "archive.tar.gz" };
    value.notes[NOTE_A].bodyMarkdown = "Line one\r\n\tLine two";
    value.notes[NOTE_A].attachments = [
      { type: "link", url: "https://example.com/a(b)?x=1", label: "Guide" },
      { type: "file", assetId: FILE, label: "Save file" },
    ];
    expect(() => assertSourceRepresentable(value)).not.toThrow();
  });

  it("keeps the empty null-publication bootstrap runtime-valid but rejects every null publication at the source boundary", () => {
    const emptyBootstrap: LibraryDatabase = {
      schemaVersion: 2,
      revision: "",
      publicationId: null,
      games: {},
      notes: {},
      assets: {},
    };
    const nonemptyRuntime = database();
    nonemptyRuntime.publicationId = null;

    expect(validateLibrary(emptyBootstrap)).toMatchObject({ ok: true, issues: [] });
    expect(validateLibrary(nonemptyRuntime)).toMatchObject({ ok: true, issues: [] });
    for (const value of [emptyBootstrap, nonemptyRuntime]) {
      expect(() => assertSourceRepresentable(value)).toThrowError(expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "/publicationId" }),
        ]),
      }));
    }
  });

  it("rejects service-managed root operations and a patch with a non-derived global image alt", () => {
    const base = database();
    base.revision = "";
    const operation = {
      operation: "set" as const,
      value: "77777777-7777-4777-8777-777777777777",
      baseExists: true,
      baseHash: MISSING_VALUE_HASH,
      changedAt: NOW,
      transactionId: "service-field",
    };
    const publicationPatch: PatchEnvelope = { patchVersion: 2, schemaVersion: 2, baseRevision: "", operations: { "/publicationId": operation }, blobs: {} };
    expect(validatePatch(publicationPatch).ok).toBe(false);

    base.publicationId = PUBLICATION_ID;
    base.games = { [GAME_A]: base.games[GAME_A] };
    base.notes = {};
    const target = structuredClone(base);
    target.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Wrong global alt", originalName: "image.webp" };
    target.notes[NOTE_A] = { ...note(NOTE_A, GAME_A), attachments: [{ type: "image", assetId: IMAGE, alt: "Owner alt" }] };
    const imagePatch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: "",
      operations: {
        [`/assets/${IMAGE}`]: { operation: "set", value: target.assets[IMAGE], baseExists: false, baseHash: MISSING_VALUE_HASH, changedAt: NOW, transactionId: "image" },
        [`/notes/${NOTE_A}`]: { operation: "set", value: target.notes[NOTE_A], baseExists: false, baseHash: MISSING_VALUE_HASH, changedAt: NOW, transactionId: "image" },
      },
      blobs: {},
    };
    expect(() => applyPatch(base, imagePatch, { checkBaseHashes: false })).toThrow();
  });

  it("recomputes derived image alt when an owner changes through a patch", () => {
    const base = database();
    base.publicationId = PUBLICATION_ID;
    base.revision = "";
    base.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Before", originalName: "image.webp" };
    base.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "Before" }];
    const current = structuredClone(base);
    current.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "After" }];
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "owner-alt" });

    expect(Object.keys(patch.operations).sort()).toEqual([`/assets/${IMAGE}`, `/notes/${NOTE_A}/attachments`]);
    expect(validatePatch(patch).ok).toBe(true);
    expect(applyPatch(base, patch, { checkBaseHashes: false }).assets[IMAGE]).toMatchObject({ alt: "After" });
    expect(reconcilePatch(base, patch).effective.assets[IMAGE]).toMatchObject({ alt: "After" });

    const importedOwnerOnly = structuredClone(patch);
    delete importedOwnerOnly.operations[`/assets/${IMAGE}`];
    const reconciledOwnerOnly = reconcilePatch(base, importedOwnerOnly);
    expect(Object.keys(reconciledOwnerOnly.patch.operations).sort()).toEqual([`/assets/${IMAGE}`, `/notes/${NOTE_A}/attachments`]);
    expect(applyPatch(base, reconciledOwnerOnly.patch, { validateResult: false }).assets[IMAGE]).toMatchObject({ alt: "After" });
  });

  it("rejects a nonrepresentable imported patch during reconciliation", () => {
    const base = database();
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/notes/${NOTE_A}/attachments`]: {
          operation: "set",
          value: [{ type: "link", url: "../relative", label: "Guide" }],
          baseExists: true,
          baseHash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          changedAt: NOW,
          transactionId: "import",
        },
      },
      blobs: {},
    };

    expect(() => applyPatch(base, patch)).toThrow();
    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it("rejects unsafe conflicting operations and conflicting non-derived asset alt", () => {
    const base = database();
    const unsafe = structuredClone(base);
    unsafe.notes[NOTE_A].attachments = [{ type: "link", url: "../unsafe", label: "Guide" }];
    const unsafePatch = diffLibrary(base, unsafe, { changedAt: NOW, transactionId: "unsafe-conflict" });
    unsafePatch.operations[`/notes/${NOTE_A}/attachments`].baseHash = "f".repeat(64);
    expect(() => reconcilePatch(base, unsafePatch)).toThrow();

    base.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Owner", originalName: "image.webp" };
    base.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "Owner" }];
    const wrongAsset = { ...base.assets[IMAGE], alt: "Wrong" };
    const wrongAltPatch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/assets/${IMAGE}`]: { operation: "set", value: wrongAsset, baseExists: true, baseHash: "f".repeat(64), changedAt: NOW, transactionId: "wrong-alt-conflict" },
      },
      blobs: {},
    };
    expect(() => reconcilePatch(base, wrongAltPatch)).toThrow();
  });

  it("rejects replacing one invalid value with another invalid value at the same path", () => {
    const base = database();
    base.notes[NOTE_A].attachments = [{ type: "link", url: "../old", label: "Guide" }];
    const current = structuredClone(base);
    current.notes[NOTE_A].attachments = [{ type: "link", url: "../new", label: "Guide" }];
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "replace-invalid" });

    expect(() => applyPatch(base, patch)).toThrow();
    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it("keeps an applicable derived alt coupled to its conflicting owner operation", () => {
    const base = database();
    base.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Before", originalName: "image.webp" };
    base.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "Before" }];
    const current = structuredClone(base);
    current.notes[NOTE_A].attachments = [{ type: "image", assetId: IMAGE, alt: "After" }];
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "owner-alt-conflict" });
    const changedStatic = structuredClone(base);
    changedStatic.notes[NOTE_A].attachments.push({ type: "link", url: "https://example.com/static", label: "Static" });

    const reconciliation = reconcilePatch(changedStatic, patch);

    expect(reconciliation.conflicts.map((item) => item.path)).toEqual([`/notes/${NOTE_A}/attachments`]);
    expect(reconciliation.effective.assets[IMAGE]).toMatchObject({ alt: "Before" });
    expect(Object.keys(reconciliation.patch.operations).sort()).toEqual([`/assets/${IMAGE}`, `/notes/${NOTE_A}/attachments`]);
  });

  it("rejects an unsafe conflicting field operation even when its entity is absent", () => {
    const base = database();
    delete base.notes[NOTE_A];
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/notes/${NOTE_A}/attachments`]: {
          operation: "set",
          value: [{ type: "link", url: "../cannot-apply", label: "Guide" }],
          baseExists: true,
          baseHash: "f".repeat(64),
          changedAt: NOW,
          transactionId: "missing-note-conflict",
        },
      },
      blobs: {},
    };

    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it("rejects a conflicting operation whose source issue is reported at an owner path", () => {
    const base = database();
    base.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 12, alt: "Cover", originalName: "cover.webp" };
    base.games[GAME_A].coverAssetId = IMAGE;
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/assets/${IMAGE}`]: { operation: "delete", baseExists: true, baseHash: "f".repeat(64), changedAt: NOW, transactionId: "delete-owned-asset" },
      },
      blobs: {},
    };

    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it("requires the complete effective database to be source-representable", () => {
    const base = database();
    base.notes[NOTE_A].attachments = [{ type: "link", url: "../legacy", label: "Legacy" }];
    const current = structuredClone(base);
    current.games[GAME_A].title = "Safe title edit";
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "safe-edit-invalid-base" });

    expect(() => applyPatch(base, patch)).toThrow();
    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it.each([
    [`/games/${GAME_A}/coverAssetId`, IMAGE.toUpperCase(), "uppercase-cover"],
    [`/games/${GAME_A}/progressItems`, [{ id: "not-a-uuid", iconAssetId: "short", noteId: 7 }], "malformed-progress"],
  ])("rejects a retained field conflict with a noncanonical or malformed value at %s", (path, value, transactionId) => {
    const base = database();
    delete base.games[GAME_A];
    delete base.notes[NOTE_A];
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: { [path]: { operation: "set", value, baseExists: true, baseHash: "f".repeat(64), changedAt: NOW, transactionId } },
      blobs: {},
    };

    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it.each([
    ["progress item id", [{ id: UPPERCASE_PROGRESS_ID, iconAssetId: IMAGE, noteId: NOTE_A }]],
    ["progress note id", [{ id: PROGRESS_A, iconAssetId: IMAGE, noteId: UPPERCASE_NOTE_ID }]],
  ])("rejects a retained conflict with an uppercase %s", (_label, progressItems) => {
    const base = database();
    delete base.games[GAME_A];
    delete base.notes[NOTE_A];
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/games/${GAME_A}/progressItems`]: {
          operation: "set",
          value: progressItems,
          baseExists: true,
          baseHash: "f".repeat(64),
          changedAt: NOW,
          transactionId: "uppercase-progress-identity",
        },
      },
      blobs: {},
    };

    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it.each([
    ["game", `/games/${UPPERCASE_GAME_ID}/title`, "Uppercase game path"],
    ["note", `/notes/${UPPERCASE_NOTE_ID}/bodyMarkdown`, "Uppercase note path"],
  ])("rejects an uppercase %s UUID in a retained conflict path", (_label, path, value) => {
    const base = database();
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [path]: {
          operation: "set",
          value,
          baseExists: true,
          baseHash: "f".repeat(64),
          changedAt: NOW,
          transactionId: "uppercase-path-identity",
        },
      },
      blobs: {},
    };

    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it.each([
    [`/games/${GAME_A}/title`, 42],
    [`/games/${GAME_A}/placement`, "not-placement"],
    [`/notes/${NOTE_A}/rank`, "first"],
    [`/notes/${NOTE_A}/doubleWidth`, "yes"],
  ])("rejects an invalid retained scalar or field type at %s", (path, value) => {
    const base = database();
    delete base.games[GAME_A];
    delete base.notes[NOTE_A];
    const patch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: { [path]: { operation: "set", value, baseExists: true, baseHash: "f".repeat(64), changedAt: NOW, transactionId: "invalid-field" } },
      blobs: {},
    };

    expect(() => reconcilePatch(base, patch)).toThrow();
  });

  it("keeps runtime fallback compatibility but rejects an unowned progress note in source", () => {
    const value = database();
    value.assets[IMAGE] = { id: IMAGE, kind: "image", mime: "image/webp", width: 64, height: 64, byteLength: 12, alt: "", originalName: "progress.webp" };
    value.games[GAME_A].progressItems = [{ id: PROGRESS_A, iconAssetId: IMAGE, noteId: "77777777-7777-4777-8777-777777777777" }];

    expect(validateLibrary(value).ok).toBe(true);
    expect(() => assertSourceRepresentable(value)).toThrow();
  });

  it("uses normalized root hashes when deleting an entity with documented defaults", () => {
    const base = database();
    base.notes[NOTE_A] = { ...base.notes[NOTE_A], groupRank: 1024, doubleWidth: false, collapsedChecklistSections: [] };
    const current = structuredClone(base);
    delete current.notes[NOTE_A];

    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "delete-defaulted-note" });

    expect(Object.keys(patch.operations)).toEqual([`/notes/${NOTE_A}`]);
    expect(applyPatch(base, patch).notes).not.toHaveProperty(NOTE_A);
  });

  it("resolves a root conflict against the same normalized static snapshot", () => {
    const base = database();
    const local = structuredClone(base);
    delete local.notes[NOTE_A];
    const patch = diffLibrary(base, local, { changedAt: NOW, transactionId: "delete-note" });
    const changedStatic = structuredClone(base);
    changedStatic.notes[NOTE_A] = { ...changedStatic.notes[NOTE_A], bodyMarkdown: "Static edit", groupRank: 1024 };
    const conflict = reconcilePatch(changedStatic, patch);

    const resolved = resolveConflict(changedStatic, conflict.patch, `/notes/${NOTE_A}`, { choice: "local" });

    expect(resolved.conflicts).toEqual([]);
    expect(resolved.effective.notes).not.toHaveProperty(NOTE_A);
  });
});
