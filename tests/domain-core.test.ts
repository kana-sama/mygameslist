import {
  MISSING_VALUE_HASH,
  applyPatch,
  canonicalHash,
  canonicalStringify,
  classifyStorageUsage,
  computeLibraryRevision,
  diffLibrary,
  gameMatchesFilters,
  moveRanked,
  reconcilePatch,
  resolveConflict,
  sha256Text,
  validatePatch,
  validateLibrary,
  webkitStringBytes,
  type Game,
  type LibraryDatabase,
  type Note,
} from "../src/domain";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-16T10:00:00.000Z";

function empty(): LibraryDatabase {
  return { schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} };
}

function game(title = "DuckTales"): Game {
  return { id: GAME_ID, title, coverAssetId: null, platforms: ["NES"], tags: ["platformer"], status: "playing", placement: { tierId: "a", rank: 1024 }, reviewMarkdown: "Хорошая игра", createdAt: NOW, updatedAt: NOW };
}

function note(groupRank?: number): Note {
  return { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "Маршрут", attachments: [], ...(groupRank === undefined ? {} : { groupRank }), rank: 1024, createdAt: NOW, updatedAt: NOW };
}

describe("canonical JSON and SHA-256", () => {
  it("sorts object keys recursively and retains array order", () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, x: [3, 1] } })).toBe('{"a":{"x":[3,1],"y":2},"z":1}');
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
  });

  it("matches the standard SHA-256 vector", () => {
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(MISSING_VALUE_HASH).toBe("0".repeat(64));
  });

  it("keeps the canonical empty-library revision stable", () => {
    expect(computeLibraryRevision(empty())).toBe("779d0ac8b9511db82adeb9674e3670cf70fb3ecc98a0bf70c0a10e02511096af");
  });
});

describe("library validation", () => {
  it("accepts an empty database and rejects unsafe Markdown", () => {
    expect(validateLibrary(empty()).ok).toBe(true);
    const database = empty(); database.games[GAME_ID] = { ...game(), reviewMarkdown: "[oops](javascript:alert(1))" };
    expect(validateLibrary(database).issues.some((item) => item.path.endsWith("reviewMarkdown"))).toBe(true);
  });

  it("accepts platinum as a distinct game status", () => {
    const database = empty();
    database.games[GAME_ID] = { ...game(), status: "platinum" };

    expect(validateLibrary(database).ok).toBe(true);
  });

  it("accepts legacy and grouped notes while rejecting invalid group ranks", () => {
    const database = empty(); database.games[GAME_ID] = game(); database.notes[NOTE_ID] = note();
    expect(validateLibrary(database).ok).toBe(true);
    database.notes[NOTE_ID] = note(2048);
    expect(validateLibrary(database).ok).toBe(true);
    database.notes[NOTE_ID] = note(-1);
    expect(validateLibrary(database).issues).toContainEqual(expect.objectContaining({ path: `/notes/${NOTE_ID}/groupRank` }));
  });
});

describe("patch lifecycle", () => {
  it("creates a sparse patch, applies it, and derives updatedAt", () => {
    const base = empty(); base.games[GAME_ID] = game();
    const current = structuredClone(base); current.games[GAME_ID].title = "DuckTales Remastered";
    const patch = diffLibrary(base, current, { changedAt: "2026-07-16T11:00:00.000Z", transactionId: "edit-title" });
    expect(Object.keys(patch.operations)).toEqual([`/games/${GAME_ID}/title`]);
    const effective = applyPatch(base, patch);
    expect(effective.games[GAME_ID].title).toBe("DuckTales Remastered");
    expect(effective.games[GAME_ID].updatedAt).toBe("2026-07-16T11:00:00.000Z");
  });

  it("prunes published values and reports/resolves same-field conflicts", () => {
    const base = empty(); base.games[GAME_ID] = game();
    const local = structuredClone(base); local.games[GAME_ID].title = "Local";
    const patch = diffLibrary(base, local, { changedAt: NOW, transactionId: "title" });
    const published = structuredClone(base); published.games[GAME_ID].title = "Local"; published.revision = "a".repeat(64);
    expect(reconcilePatch(published, patch).prunedCount).toBe(1);

    const changedStatic = structuredClone(base); changedStatic.games[GAME_ID].title = "Static"; changedStatic.revision = "b".repeat(64);
    const reconciliation = reconcilePatch(changedStatic, patch);
    expect(reconciliation.conflicts).toHaveLength(1);
    expect(reconciliation.effective.games[GAME_ID].title).toBe("Static");
    const localWins = resolveConflict(changedStatic, reconciliation.patch, `/games/${GAME_ID}/title`, { choice: "local" });
    expect(localWins.conflicts).toHaveLength(0);
    expect(localWins.effective.games[GAME_ID].title).toBe("Local");
  });

  it("rejects patch operations for service-managed fields", () => {
    const base = empty(); base.games[GAME_ID] = game();
    const patch = diffLibrary(base, { ...base, games: { [GAME_ID]: { ...game(), title: "Local" } } }, { changedAt: NOW, transactionId: "title" });
    const [operation] = Object.values(patch.operations);
    patch.operations = { [`/games/${GAME_ID}/updatedAt`]: operation };
    expect(validatePatch(patch).ok).toBe(false);
  });

  it("publishes and prunes a sparse note-group move", () => {
    const base = empty(); base.games[GAME_ID] = game(); base.notes[NOTE_ID] = note();
    const current = structuredClone(base); current.notes[NOTE_ID].groupRank = 2048;
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "move-note-group" });
    expect(Object.keys(patch.operations)).toEqual([`/notes/${NOTE_ID}/groupRank`]);
    const published = applyPatch(base, patch);
    expect(published.notes[NOTE_ID].groupRank).toBe(2048);
    expect(reconcilePatch(published, patch)).toMatchObject({ conflicts: [], patch: { operations: {} }, prunedCount: 1 });

    const returned = structuredClone(published); delete returned.notes[NOTE_ID].groupRank;
    const returnPatch = diffLibrary(published, returned, { changedAt: NOW, transactionId: "return-note-group" });
    expect(returnPatch.operations[`/notes/${NOTE_ID}/groupRank`]).toMatchObject({ operation: "delete", baseExists: true });
    expect(applyPatch(published, returnPatch).notes[NOTE_ID]).not.toHaveProperty("groupRank");
  });

  it("requires root set values to use the entity ID from their operation path", () => {
    const base = empty(); const current = structuredClone(base); current.games[GAME_ID] = game();
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "create" });
    const operation = structuredClone(patch.operations[`/games/${GAME_ID}`]);
    const cases = [
      { path: `/games/${GAME_ID}`, valueId: "22222222-2222-4222-8222-222222222222" },
      { path: "/notes/33333333-3333-4333-8333-333333333333", valueId: "44444444-4444-4444-8444-444444444444" },
      { path: `/assets/${"a".repeat(64)}`, valueId: "b".repeat(64) },
    ];

    for (const item of cases) {
      const candidate = { ...patch, operations: { [item.path]: { ...operation, value: { id: item.valueId } } } };
      expect(validatePatch(candidate).issues).toContainEqual(expect.objectContaining({ message: "ID сущности должен совпадать с ID в пути" }));
    }
  });

  it("rejects collection entities and legacy schema patches", () => {
    const base = empty(); base.games[GAME_ID] = game();
    const patch = diffLibrary(base, { ...base, games: { [GAME_ID]: { ...game(), title: "Local" } } }, { changedAt: NOW, transactionId: "title" });
    const [operation] = Object.values(patch.operations);
    patch.operations = { [`/collections/${GAME_ID}`]: operation };
    expect(validatePatch(patch).issues.some((item) => item.message === "Недопустимый путь")).toBe(true);
    expect(validatePatch({ ...patch, schemaVersion: 1 }).issues.some((item) => item.path === "/schemaVersion")).toBe(true);
    expect(validateLibrary({ ...empty(), collections: {}, collectionItems: {} }).ok).toBe(false);
  });
});

describe("Safari storage accounting", () => {
  it("counts UTF-16 key and value bytes and applies thresholds", () => {
    expect(webkitStringBytes("ab", "😀")).toBe(8);
    expect(classifyStorageUsage(4 * 1024 * 1024 * 0.7).level).toBe("warning");
    expect(classifyStorageUsage(4 * 1024 * 1024 * 0.95).level).toBe("blocked");
  });
});

describe("ranks and catalogue filters", () => {
  it("rebalances when no integer rank is available", () => {
    const result = moveRanked([{ id: "a", rank: 1 }, { id: "b", rank: 2 }, { id: "c", rank: 3 }], "c", 1);
    expect(result.rebalanced).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("uses OR inside groups and AND between groups", () => {
    expect(gameMatchesFilters(game(), { query: "duck nes", platforms: ["NES", "SNES"], tags: ["rpg", "platformer"], statuses: ["playing"] })).toBe(true);
    expect(gameMatchesFilters(game(), { platforms: ["NES"], tags: ["rpg"] })).toBe(false);
  });

  it("finds games through typos and the wrong keyboard layout", () => {
    expect(gameMatchesFilters(game(), { query: "DcukTales" })).toBe(true);
    expect(gameMatchesFilters(game(), { query: "вгсл" })).toBe(true);
    expect(gameMatchesFilters({ ...game(), title: "Ведьмак" }, { query: "dtlmvfr" })).toBe(true);
    expect(gameMatchesFilters(game(), { query: "unrelated" })).toBe(false);
  });

  it("finds a word when a short fuzzy query omits letters", () => {
    expect(gameMatchesFilters({ ...game(), title: "The Lost Vikings" }, { query: "lst" })).toBe(true);
    expect(gameMatchesFilters({ ...game(), title: "Super Mario Bros.: The Lost Levels" }, { query: "lst" })).toBe(true);
  });

  it("finds games by title initials", () => {
    expect(gameMatchesFilters({ ...game(), title: "Metal Gear Solid" }, { query: "mgs" })).toBe(true);
    expect(gameMatchesFilters({ ...game(), title: "The Metal Gear Solid Collection" }, { query: "mgs" })).toBe(true);
    expect(gameMatchesFilters({ ...game(), title: "Grand Theft Auto" }, { query: "gta" })).toBe(true);
    expect(gameMatchesFilters({ ...game(), title: "Red Dead Redemption" }, { query: "rdr" })).toBe(true);
    expect(gameMatchesFilters({ ...game(), title: "Metal Slug" }, { query: "mgs" })).toBe(false);
  });
});
