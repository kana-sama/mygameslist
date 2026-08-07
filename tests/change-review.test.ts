// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildChangeReview,
  diffLibrary,
  reconcilePatch,
  type Asset,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchEnvelope,
  type PatchOperation,
} from "../src/domain";

const GAME_A_ID = "00000000-0000-4000-8000-000000000001";
const GAME_B_ID = "00000000-0000-4000-8000-000000000002";
const GAME_C_ID = "00000000-0000-4000-8000-000000000003";
const NOTE_A_ID = "00000000-0000-4000-8000-000000000011";
const NOTE_B_ID = "00000000-0000-4000-8000-000000000012";
const NOTE_C_ID = "00000000-0000-4000-8000-000000000013";
const PROGRESS_ITEM_ID = "00000000-0000-4000-8000-000000000021";
const ASSET_A_ID = "a".repeat(64);
const ASSET_B_ID = "b".repeat(64);
const CREATED_AT = "2026-08-04T08:00:00.000Z";
const T1 = "2026-08-04T10:00:00.000Z";
const T2 = "2026-08-04T11:00:00.000Z";

function database(): LibraryDatabase {
  return {
    schemaVersion: 2,
    revision: "",
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
    tags: ["adventure"],
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

function fileAsset(id: string, originalName = "guide.pdf"): Asset {
  return { id, kind: "file", mime: "application/pdf", byteLength: 4096, originalName };
}

function progressIcon(id: string): Asset {
  return { id, kind: "image", mime: "image/webp", width: 64, height: 64, byteLength: 12, alt: "", originalName: "progress.webp" };
}

function patchBetween(
  base: LibraryDatabase,
  effective: LibraryDatabase,
  transactionId: string,
  changedAt = T1,
): PatchEnvelope {
  return diffLibrary(base, effective, { transactionId, changedAt });
}

function mergePatches(base: LibraryDatabase, ...patches: PatchEnvelope[]): PatchEnvelope {
  return {
    patchVersion: 2,
    schemaVersion: 2,
    baseRevision: base.revision,
    operations: Object.assign({}, ...patches.map((patch) => patch.operations)),
    blobs: Object.assign({}, ...patches.map((patch) => patch.blobs)),
  };
}

function assetCreateOperation(asset: Asset, transactionId: string, changedAt: string): PatchOperation {
  const base = database();
  base.games[GAME_A_ID] = game(GAME_A_ID, "Владелец");
  base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "# Файл");
  const effective = structuredClone(base);
  effective.assets[asset.id] = asset;
  effective.notes[NOTE_A_ID].attachments = [{ type: "file", assetId: asset.id, label: "Файл" }];
  return patchBetween(base, effective, transactionId, changedAt).operations[`/assets/${asset.id}`];
}

function assetDeleteOperation(asset: Asset, transactionId: string, changedAt: string): PatchOperation {
  const base = database();
  base.games[GAME_A_ID] = game(GAME_A_ID, "Владелец");
  base.notes[NOTE_A_ID] = {
    ...note(NOTE_A_ID, GAME_A_ID, "# Файл"),
    attachments: [{ type: "file", assetId: asset.id, label: "Файл" }],
  };
  base.assets[asset.id] = asset;
  const effective = structuredClone(base);
  effective.notes[NOTE_A_ID].attachments = [];
  delete effective.assets[asset.id];
  return patchBetween(base, effective, transactionId, changedAt).operations[`/assets/${asset.id}`];
}

describe("game-grouped change review", () => {
  it("folds a new progress icon asset into its game change", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Progress game");
    const effective = structuredClone(base);
    effective.assets[ASSET_A_ID] = progressIcon(ASSET_A_ID);
    effective.games[GAME_A_ID].progressItems = [{ id: PROGRESS_ITEM_ID, iconAssetId: ASSET_A_ID, noteId: NOTE_A_ID }];

    const review = buildChangeReview(base, effective, patchBetween(base, effective, "add-progress"));
    const change = review.groups[0].changes[0];

    expect(review.groups).toHaveLength(1);
    expect(change.entity).toEqual({ map: "games", id: GAME_A_ID });
    expect(change.operationPaths).toEqual([
      `/assets/${ASSET_A_ID}`,
      `/games/${GAME_A_ID}/progressItems`,
    ]);
    expect(change.evidence).toContainEqual(expect.objectContaining({
      type: "asset",
      assetId: ASSET_A_ID,
      width: 64,
      height: 64,
    }));
  });

  it("uses a conflicting operation's local target as the after evidence", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Static title");
    const local = structuredClone(base);
    local.games[GAME_A_ID].title = "Local title";
    const patch = patchBetween(base, local, "local-title");
    const remote = structuredClone(base);
    remote.games[GAME_A_ID].title = "Remote title";
    const reconciled = reconcilePatch(remote, patch);

    const change = buildChangeReview(remote, reconciled.effective, reconciled.patch)
      .groups[0].changes[0];

    expect(reconciled.conflicts).toHaveLength(1);
    expect(change.evidence).toContainEqual({
      type: "scalar",
      before: "Remote title",
      after: "Local title",
    });
  });

  it("groups game, note, and referenced asset evidence under the game", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Lego Harry Potter: Years 1–4");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "# Посылки\n\nСтарый текст");
    const effective = structuredClone(base);
    effective.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID);
    effective.notes[NOTE_A_ID].bodyMarkdown = "# Посылки\n\nНовый текст";
    effective.notes[NOTE_A_ID].attachments = [{ type: "file", assetId: ASSET_A_ID, label: "Гайд" }];
    const patch = patchBetween(base, effective, "save-note");

    const review = buildChangeReview(base, effective, patch);

    expect(review.groups).toHaveLength(1);
    expect(review.groups[0]).toMatchObject({
      gameId: GAME_A_ID,
      title: "Lego Harry Potter: Years 1–4",
    });
    expect(review.groups[0].changes.map((change) => change.title)).toContain("Посылки");
    const change = review.groups[0].changes.find((item) => item.entity.id === NOTE_A_ID);
    expect(change?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "markdown", before: expect.any(String), after: expect.any(String) }),
      expect.objectContaining({ type: "asset", assetId: ASSET_A_ID, originalName: "guide.pdf" }),
    ]));
    expect(review.groups[0].changes.some((item) => item.entity.id === ASSET_A_ID)).toBe(false);
  });

  it("uses base ownership and content for a deleted note", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Lego Harry Potter: Years 1–4");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "# Посылки\n\nТекст");
    const effective = structuredClone(base);
    delete effective.notes[NOTE_A_ID];

    const change = buildChangeReview(base, effective, patchBetween(base, effective, "delete-note"))
      .groups[0].changes[0];

    expect(change.title).toBe("Посылки");
    expect(change.summary).toBe("Удалена заметка «Посылки»");
    expect(change.evidence).toContainEqual(expect.objectContaining({ type: "markdown", after: "" }));
  });

  it("derives created-note titles from a heading, first text line, and fallback", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    const effective = structuredClone(base);
    effective.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "## **Маршрут**\nШаги");
    effective.notes[NOTE_B_ID] = note(NOTE_B_ID, GAME_A_ID, "- [ ] Купить карту");
    effective.notes[NOTE_C_ID] = note(NOTE_C_ID, GAME_A_ID, "\n\n");

    const changes = buildChangeReview(base, effective, patchBetween(base, effective, "create-notes"))
      .groups[0].changes;

    expect(changes.map((change) => change.title)).toEqual([
      "Заметка без заголовка",
      "Купить карту",
      "Маршрут",
    ]);
    expect(changes.map((change) => change.summary)).toEqual(expect.arrayContaining([
      "Создана заметка «Маршрут»",
      "Создана заметка «Купить карту»",
      "Создана заметка «Заметка без заголовка»",
    ]));
    expect(new Set(changes.map((change) => change.selectionId)).size).toBe(3);
  });

  it("builds scalar, chip, placement, Markdown, and file metadata evidence", () => {
    const base = database();
    base.games[GAME_A_ID] = { ...game(GAME_A_ID, "Старая игра"), reviewMarkdown: "- [ ] Старое" };
    const effective = structuredClone(base);
    effective.games[GAME_A_ID] = {
      ...effective.games[GAME_A_ID],
      title: "Новая игра",
      platforms: ["Switch"],
      placement: { tierId: "s", rank: 2048 },
      reviewMarkdown: "- [x] Старое",
    };
    effective.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "manual.pdf");
    const changesPatch = patchBetween(base, { ...effective, assets: {} }, "edit-game");
    const assetPatch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/assets/${ASSET_A_ID}`]: assetCreateOperation(effective.assets[ASSET_A_ID], "add-file", T2),
      },
      blobs: {},
    };
    const review = buildChangeReview(base, effective, mergePatches(base, changesPatch, assetPatch));

    const gameChange = review.groups.find((group) => group.gameId === GAME_A_ID)?.changes[0];
    expect(gameChange?.evidence).toEqual(expect.arrayContaining([
      { type: "scalar", before: "Старая игра", after: "Новая игра" },
      { type: "chips", added: ["Switch"], removed: ["PC"] },
      expect.objectContaining({ type: "move", before: expect.stringContaining("A"), after: expect.stringContaining("S") }),
      expect.objectContaining({ type: "markdown", before: "- [ ] Старое", after: "- [x] Старое" }),
    ]));
    expect(review.groups.find((group) => group.gameId === null)).toMatchObject({
      title: "Без привязки к игре",
      changes: [expect.objectContaining({
        kind: "asset",
        evidence: [expect.objectContaining({
          type: "asset",
          assetId: ASSET_A_ID,
          originalName: "manual.pdf",
          mime: "application/pdf",
          byteLength: 4096,
        })],
      })],
    });
  });

  it("keeps a changed link URL visible when its label is unchanged", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "# Ссылки"),
      attachments: [{ type: "link", label: "Документация", url: "https://old.example/docs" }],
    };
    const effective = structuredClone(base);
    effective.notes[NOTE_A_ID].attachments = [
      { type: "link", label: "Документация", url: "https://new.example/docs" },
    ];

    const change = buildChangeReview(base, effective, patchBetween(base, effective, "change-link"))
      .groups[0].changes[0];

    expect(change.evidence).toContainEqual({
      type: "chips",
      added: ["Документация · https://new.example/docs"],
      removed: ["Документация · https://old.example/docs"],
    });
  });

  it("keeps a replaced asset identity visible when its attachment label is unchanged", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    base.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "old-guide.pdf");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "# Файлы"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "Гайд" }],
    };
    const effective = structuredClone(base);
    delete effective.assets[ASSET_A_ID];
    effective.assets[ASSET_B_ID] = fileAsset(ASSET_B_ID, "new-guide.pdf");
    effective.notes[NOTE_A_ID].attachments = [
      { type: "file", assetId: ASSET_B_ID, label: "Гайд" },
    ];

    const change = buildChangeReview(base, effective, patchBetween(base, effective, "replace-file"))
      .groups[0].changes[0];

    expect(change.evidence).toContainEqual({
      type: "chips",
      added: [`Гайд · new-guide.pdf · asset:${ASSET_B_ID}`],
      removed: [`Гайд · old-guide.pdf · asset:${ASSET_A_ID}`],
    });
  });

  it("uses base asset references for deletion ownership and leaves unowned assets orphaned", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    base.notes[NOTE_A_ID] = {
      ...note(NOTE_A_ID, GAME_A_ID, "# Файл"),
      attachments: [{ type: "file", assetId: ASSET_A_ID, label: "Обложка" }],
    };
    base.assets[ASSET_A_ID] = fileAsset(ASSET_A_ID, "old-cover.webp");
    base.assets[ASSET_B_ID] = fileAsset(ASSET_B_ID, "unused.zip");
    const effective = structuredClone(base);
    delete effective.assets[ASSET_A_ID];
    delete effective.assets[ASSET_B_ID];
    const ownedPatch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/assets/${ASSET_A_ID}`]: assetDeleteOperation(base.assets[ASSET_A_ID], "delete-owned", T1),
      },
      blobs: {},
    };
    const orphanPatch: PatchEnvelope = {
      patchVersion: 2,
      schemaVersion: 2,
      baseRevision: base.revision,
      operations: {
        [`/assets/${ASSET_B_ID}`]: assetDeleteOperation(base.assets[ASSET_B_ID], "delete-orphan", T2),
      },
      blobs: {},
    };

    const review = buildChangeReview(base, effective, mergePatches(base, ownedPatch, orphanPatch));

    expect(review.groups.find((group) => group.gameId === GAME_A_ID)?.changes[0]).toMatchObject({
      entity: { map: "assets", id: ASSET_A_ID },
      title: "old-cover.webp",
    });
    expect(review.groups.find((group) => group.gameId === null)?.changes[0]).toMatchObject({
      entity: { map: "assets", id: ASSET_B_ID },
      title: "unused.zip",
    });
  });

  it("shows a cross-game rank transaction in both groups with one selection identity", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Альфа");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Бета");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].placement.rank = 2048;
    effective.games[GAME_B_ID].placement.rank = 512;

    const review = buildChangeReview(base, effective, patchBetween(base, effective, "cross-game-order"));
    const occurrences = review.groups.flatMap((group) => group.changes);

    expect(review.groups).toHaveLength(2);
    expect(new Set(occurrences.map((change) => change.id)).size).toBe(2);
    expect(new Set(occurrences.map((change) => change.selectionId))).toEqual(new Set(["tx:cross-game-order"]));
    expect(review.uniqueSelectionIds).toEqual(["tx:cross-game-order"]);
    expect(review.changesBySelectionId["tx:cross-game-order"]).toHaveLength(2);
  });

  it("keeps unrelated entities in a normal save transaction as separate selections", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "# Старая");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].title = "Новая игра";
    effective.notes[NOTE_A_ID].bodyMarkdown = "# Новая";

    const changes = buildChangeReview(base, effective, patchBetween(base, effective, "save-form"))
      .groups[0].changes;

    expect(changes).toHaveLength(2);
    expect(new Set(changes.map((change) => change.selectionId)).size).toBe(2);
  });

  it("coalesces legacy fields by entity and derives selection identity from paths", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].title = "Новая игра";
    effective.games[GAME_A_ID].status = "played";
    const patch = patchBetween(base, effective, "legacy-placeholder");
    for (const operation of Object.values(patch.operations)) operation.transactionId = "";

    const changes = buildChangeReview(base, effective, patch).groups[0].changes;

    expect(changes).toHaveLength(1);
    expect(changes[0].selectionId).toBe(
      `path:/games/${GAME_A_ID}/status|/games/${GAME_A_ID}/title`,
    );
  });

  it("keeps whitespace-distinct transaction IDs as separate semantic units", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].title = "Новая игра";
    effective.games[GAME_A_ID].status = "played";
    const titlePatch = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_A_ID]: { ...base.games[GAME_A_ID], title: "Новая игра" } },
    }, "save");
    const statusPatch = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_A_ID]: { ...base.games[GAME_A_ID], status: "played" } },
    }, " save ");

    const changes = buildChangeReview(base, effective, mergePatches(base, titlePatch, statusPatch))
      .groups[0].changes;

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.selectionId).sort()).toEqual([
      `tx: save :games:${GAME_A_ID}`,
      `tx:save:games:${GAME_A_ID}`,
    ]);
  });

  it("keeps a missing transaction ID separate from the literal legacy ID", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Игра");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].title = "Новая игра";
    effective.games[GAME_A_ID].status = "played";
    const missingPatch = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_A_ID]: { ...base.games[GAME_A_ID], status: "played" } },
    }, "missing-placeholder");
    Object.values(missingPatch.operations).forEach((operation) => { operation.transactionId = ""; });
    const legacyPatch = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_A_ID]: { ...base.games[GAME_A_ID], title: "Новая игра" } },
    }, "legacy");

    const changes = buildChangeReview(base, effective, mergePatches(base, missingPatch, legacyPatch))
      .groups[0].changes;

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.selectionId).sort()).toEqual([
      `path:/games/${GAME_A_ID}/status`,
      `tx:legacy:games:${GAME_A_ID}`,
    ]);
  });

  it("orders fractional-second timestamps after the same whole second", () => {
    const wholeSecond = "2026-08-04T10:00:00Z";
    const fractionalSecond = "2026-08-04T10:00:00.100Z";
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Альфа");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Бета");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_B_ID, "# Старая заметка");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].status = "played";
    effective.games[GAME_B_ID].status = "played";
    effective.notes[NOTE_A_ID].bodyMarkdown = "# Новая заметка";
    const wholePatch = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_A_ID]: effective.games[GAME_A_ID] },
      notes: { ...base.notes, [NOTE_A_ID]: effective.notes[NOTE_A_ID] },
    }, "whole", wholeSecond);
    const fractionalPatch = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_B_ID]: effective.games[GAME_B_ID] },
    }, "fractional", fractionalSecond);

    const review = buildChangeReview(base, effective, mergePatches(base, wholePatch, fractionalPatch));

    expect(review.groups.map((group) => group.gameId)).toEqual([GAME_B_ID, GAME_A_ID]);
    expect(review.groups[0].changes.map((change) => change.entity)).toEqual([
      { map: "games", id: GAME_B_ID },
      { map: "notes", id: NOTE_A_ID },
    ]);
    expect(review.groups[0].newestChangedAt).toBe(fractionalSecond);
  });

  it("orders groups by newest change then Russian title and rows deterministically", () => {
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Яблоко");
    base.games[GAME_B_ID] = game(GAME_B_ID, "Арбуз");
    base.games[GAME_C_ID] = game(GAME_C_ID, "Банан");
    base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_C_ID, "# Якорь");
    const effective = structuredClone(base);
    effective.games[GAME_A_ID].status = "played";
    effective.games[GAME_B_ID].status = "played";
    effective.games[GAME_C_ID].title = "Банан 2";
    effective.notes[NOTE_A_ID].bodyMarkdown = "# Абзац";
    const older = patchBetween(base, {
      ...base,
      games: { ...base.games, [GAME_C_ID]: effective.games[GAME_C_ID] },
      notes: { ...base.notes, [NOTE_A_ID]: effective.notes[NOTE_A_ID] },
    }, "older", T1);
    const newer = patchBetween(base, {
      ...base,
      games: {
        ...base.games,
        [GAME_A_ID]: effective.games[GAME_A_ID],
        [GAME_B_ID]: effective.games[GAME_B_ID],
      },
    }, "newer", T2);

    const review = buildChangeReview(base, effective, mergePatches(base, older, newer));

    expect(review.groups.map((group) => group.title)).toEqual(["Арбуз", "Яблоко", "Банан 2"]);
    expect(review.groups[2].changes.map((change) => change.entity.map)).toEqual(["games", "notes"]);

    const reversedPatch = structuredClone(mergePatches(base, older, newer));
    reversedPatch.operations = Object.fromEntries(Object.entries(reversedPatch.operations).reverse());
    expect(buildChangeReview(base, effective, reversedPatch)).toEqual(review);
  });
});
