import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPatch,
  diffLibrary,
  type Asset,
  type Game,
  type LibraryDatabase,
  type Note,
} from "../src/domain";
import type { LibraryContextValue } from "../src/state/LibraryContext";

const libraryHarness = vi.hoisted(() => ({ current: null as LibraryContextValue | null }));

vi.mock("../src/state/LibraryContext", () => ({
  LibraryProvider: ({ children }: { children: ReactNode }) => children,
  useLibrary: () => {
    if (!libraryHarness.current) throw new Error("Library test harness is not installed");
    return libraryHarness.current;
  },
}));

import App from "../src/App";

const GAME_A_ID = "00000000-0000-4000-8000-000000000001";
const GAME_B_ID = "00000000-0000-4000-8000-000000000002";
const NOTE_A_ID = "00000000-0000-4000-8000-000000000011";
const NOTE_B_ID = "00000000-0000-4000-8000-000000000012";
const ASSET_ID = "a".repeat(64);
const REVISION = "1".repeat(64);
const CREATED_AT = "2026-08-04T08:00:00.000Z";
const CHANGED_AT = "2026-08-04T10:00:00.000Z";
const PAT = "github_pat_1234567890";

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

function game(id: string, title: string, rank = 1024): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms: ["PC"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank },
    reviewMarkdown: "",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function note(id: string, gameId: string, bodyMarkdown: string, rank: number): Note {
  return {
    id,
    gameId,
    bodyMarkdown,
    attachments: [],
    rank,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function fileAsset(id: string): Asset {
  return {
    id,
    kind: "file",
    mime: "application/pdf",
    byteLength: 4096,
    originalName: "shared.pdf",
  };
}

function libraryValue(base: LibraryDatabase, effective: LibraryDatabase): LibraryContextValue {
  const patch = diffLibrary(base, effective, {
    changedAt: CHANGED_AT,
    transactionId: "integration-change",
  });
  const patchedEffective = applyPatch(base, patch);
  return {
    base,
    effective: patchedEffective,
    patch,
    conflicts: [],
    pendingPublication: null,
    loading: false,
    fatalError: null,
    persistenceError: null,
    corruptedPatchRaw: null,
    usage: { bytes: 0, budget: 4 * 1024 * 1024, ratio: 0, level: "ok", remainingBytes: 4 * 1024 * 1024 },
    storageEstimate: null,
    quotaStatus: { usage: null, quota: null, remaining: null, ratio: null, level: "ok" },
    persistentStorage: true,
    attachmentsBlocked: false,
    localAssets: [],
    localAssetBytes: 0,
    games: patchedEffective.games,
    canAddBlob: vi.fn().mockResolvedValue(null),
    resolveAssetUrl: vi.fn().mockReturnValue(null),
    saveGame: vi.fn(),
    deleteGame: vi.fn(),
    moveGame: vi.fn(),
    discardPath: vi.fn(),
    discardPaths: vi.fn(),
    clearPatch: vi.fn(),
    resolvePatchConflict: vi.fn(),
    importPatch: vi.fn().mockResolvedValue(undefined),
    undoLast: vi.fn().mockReturnValue(false),
    downloadCorruptedPatch: vi.fn(),
    exportRecoveryArchive: vi.fn().mockResolvedValue(undefined),
    deleteAllLocalAssets: vi.fn().mockResolvedValue(undefined),
    verifyGitHubAccess: vi.fn().mockResolvedValue(undefined),
    syncToGitHub: vi.fn().mockResolvedValue({
      status: "committed",
      commitSha: "2".repeat(40),
      commitUrl: "https://github.com/kana-sama/mygameslist/commit/test",
      pagesPending: false,
    }),
  };
}

function dependencyFixture(): { context: LibraryContextValue; selectedPaths: string[]; unrelatedPaths: string[] } {
  const base = database();
  base.games[GAME_A_ID] = game(GAME_A_ID, "Dependency Game");
  base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "# First owner\n\nOld", 1024);
  base.notes[NOTE_B_ID] = note(NOTE_B_ID, GAME_A_ID, "# Second owner", 2048);
  const effective = structuredClone(base);
  effective.assets[ASSET_ID] = fileAsset(ASSET_ID);
  effective.notes[NOTE_A_ID].bodyMarkdown = "# First owner\n\nUNRELATED";
  effective.notes[NOTE_A_ID].attachments = [{ type: "file", assetId: ASSET_ID, label: "Shared" }];
  effective.notes[NOTE_B_ID].attachments = [{ type: "file", assetId: ASSET_ID, label: "Shared" }];
  return {
    context: libraryValue(base, effective),
    selectedPaths: [`/assets/${ASSET_ID}`, `/notes/${NOTE_A_ID}/attachments`],
    unrelatedPaths: [`/notes/${NOTE_A_ID}/bodyMarkdown`, `/notes/${NOTE_B_ID}/attachments`],
  };
}

function crossGameOrderingFixture(): { context: LibraryContextValue; selectedPaths: string[] } {
  const base = database();
  base.games[GAME_A_ID] = game(GAME_A_ID, "Alpha", 1024);
  base.games[GAME_B_ID] = game(GAME_B_ID, "Beta", 2048);
  const effective = structuredClone(base);
  effective.games[GAME_A_ID].placement.rank = 2048;
  effective.games[GAME_B_ID].placement.rank = 1024;
  return {
    context: libraryValue(base, effective),
    selectedPaths: [`/games/${GAME_A_ID}/placement`, `/games/${GAME_B_ID}/placement`],
  };
}

async function openDiff(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: /^Локальные правки:/ }));
  return screen.getByRole("dialog", { name: "Локальные правки" });
}

beforeEach(() => {
  window.location.hash = "#/";
  window.sessionStorage.clear();
});

afterEach(() => {
  libraryHarness.current = null;
  vi.restoreAllMocks();
});

describe("App selective diff integration", () => {
  it("passes the resolver's exact dependency closure to connect sync and row undo, then resets to full sync", async () => {
    const user = userEvent.setup();
    const fixture = dependencyFixture();
    libraryHarness.current = fixture.context;
    render(<App />);
    const dialog = await openDiff(user);

    await user.click(within(dialog).getByRole("button", { name: "Выбрать часть" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Выбрать изменение: shared.pdf" }));
    await user.click(within(dialog).getByRole("button", { name: "Синхронизировать выбранное · 2" }));
    const panel = within(dialog).getByRole("region", { name: "Синхронизация с GitHub" });
    await user.type(within(panel).getByLabelText("Fine-grained PAT"), PAT);
    await user.click(within(panel).getByRole("button", { name: "Подключить и синхронизировать" }));

    await waitFor(() => expect(fixture.context.syncToGitHub).toHaveBeenCalledTimes(1));
    expect(fixture.context.syncToGitHub).toHaveBeenCalledWith(PAT, expect.objectContaining({ selectedPaths: fixture.selectedPaths }));
    const publishedPaths = vi.mocked(fixture.context.syncToGitHub).mock.calls[0][1]?.selectedPaths ?? [];
    expect(publishedPaths).not.toEqual(expect.arrayContaining(fixture.unrelatedPaths));

    await user.click(within(panel).getByRole("button", { name: "Закрыть синхронизацию" }));
    await user.click(within(dialog).getByRole("button", { name: "Синхронизировать выбранное · 2" }));
    const savedPatPanel = within(dialog).getByRole("region", { name: "Синхронизация с GitHub" });
    expect(within(savedPatPanel).queryByLabelText("Fine-grained PAT")).not.toBeInTheDocument();
    await user.click(within(savedPatPanel).getByRole("button", { name: "Синхронизировать выбранное · 2" }));
    await waitFor(() => expect(fixture.context.syncToGitHub).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fixture.context.syncToGitHub).mock.calls[1][1]?.selectedPaths).toEqual(fixture.selectedPaths);

    await user.click(within(dialog).getByRole("button", { name: "Отменить: shared.pdf" }));
    expect(fixture.context.discardPaths).toHaveBeenCalledWith(fixture.selectedPaths);

    await user.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    const reopened = await openDiff(user);
    expect(within(reopened).getByRole("button", { name: "Синхронизировать всё" })).toBeInTheDocument();
    await user.click(within(reopened).getByRole("button", { name: "Синхронизировать всё" }));
    const reopenedPanel = within(reopened).getByRole("region", { name: "Синхронизация с GitHub" });
    await user.click(within(reopenedPanel).getByRole("button", { name: "Синхронизировать всё" }));

    await waitFor(() => expect(fixture.context.syncToGitHub).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fixture.context.syncToGitHub).mock.calls[2][1]?.selectedPaths).toBeUndefined();
  });

  it("resolves a shared cross-game ordering identity for both row and game undo", async () => {
    const user = userEvent.setup();
    const fixture = crossGameOrderingFixture();
    libraryHarness.current = fixture.context;
    render(<App />);
    const dialog = await openDiff(user);

    await user.click(within(dialog).getByRole("button", { name: "Отменить: Alpha" }));
    await user.click(within(dialog).getByRole("button", { name: "Отменить игру: Alpha" }));

    expect(fixture.context.discardPaths).toHaveBeenNthCalledWith(1, fixture.selectedPaths);
    expect(fixture.context.discardPaths).toHaveBeenNthCalledWith(2, fixture.selectedPaths);
  });
});
