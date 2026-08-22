import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPatch,
  diffLibrary,
  reconcilePatch,
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
  useLibrarySelector: (selector: (library: LibraryContextValue) => unknown) => {
    if (!libraryHarness.current) throw new Error("Library test harness is not installed");
    return selector(libraryHarness.current);
  },
}));

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

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
const SOURCE_COMMIT_SHA = "f".repeat(40);
const PUBLICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    sourceCommitSha: SOURCE_COMMIT_SHA,
    base,
    effective: patchedEffective,
    patch,
    conflicts: [],
    publicationState: { status: "none", exportCompleted: false },
    retainedLocalAssetIds: [],
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
    saveGame: vi.fn().mockResolvedValue(GAME_A_ID),
    saveNoteInteraction: vi.fn().mockResolvedValue(undefined),
    deleteGame: vi.fn().mockResolvedValue(undefined),
    moveGame: vi.fn().mockResolvedValue(undefined),
    discardPath: vi.fn().mockResolvedValue(undefined),
    discardPaths: vi.fn().mockResolvedValue(undefined),
    clearPatch: vi.fn().mockResolvedValue(undefined),
    resolvePatchConflict: vi.fn().mockResolvedValue(undefined),
    importPatch: vi.fn().mockResolvedValue(undefined),
    undoLast: vi.fn().mockResolvedValue(false),
    downloadCorruptedPatch: vi.fn(),
    exportRecoveryArchive: vi.fn().mockResolvedValue(undefined),
    retryPublicationPersistence: vi.fn().mockResolvedValue(undefined),
    retryPublicationCheck: vi.fn().mockResolvedValue(undefined),
    exportPublicationRecovery: vi.fn().mockResolvedValue(undefined),
    discardPublicationAfterExport: vi.fn().mockResolvedValue(undefined),
    reloadPage: vi.fn(),
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

function conflictTransitionFixture(): {
  context: LibraryContextValue;
  conflicted: LibraryContextValue;
  selectedPath: string;
} {
  const base = database();
  base.games[GAME_A_ID] = game(GAME_A_ID, "Static title");
  base.notes[NOTE_A_ID] = note(NOTE_A_ID, GAME_A_ID, "# Unrelated\n\nStatic note", 1024);
  const effective = structuredClone(base);
  effective.games[GAME_A_ID].title = "Local title";
  effective.notes[NOTE_A_ID].bodyMarkdown = "# Unrelated\n\nLocal note";
  const context = libraryValue(base, effective);
  const remote = structuredClone(base);
  remote.games[GAME_A_ID].title = "Remote title";
  const reconciled = reconcilePatch(remote, context.patch);
  return {
    context,
    conflicted: {
      ...context,
      base: remote,
      effective: reconciled.effective,
      patch: reconciled.patch,
      conflicts: reconciled.conflicts,
      games: reconciled.effective.games,
    },
    selectedPath: `/games/${GAME_A_ID}/title`,
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
  it("keeps a per-game custom-style toggle local to this browser", async () => {
    const user = userEvent.setup();
    const base = database();
    base.games[GAME_A_ID] = game(GAME_A_ID, "Styled Game");
    libraryHarness.current = libraryValue(base, base);
    window.location.hash = `#/games/${GAME_A_ID}`;

    const first = render(<App />);
    const shell = first.container.querySelector(".app-shell");
    expect(shell).toHaveAttribute("id", GAME_A_ID);

    await user.click(screen.getByRole("button", { name: "Отключить кастомные стили" }));
    expect(shell).not.toHaveAttribute("id");
    expect(screen.getByRole("button", { name: "Включить кастомные стили" })).toHaveAttribute("aria-pressed", "true");

    first.unmount();
    const second = render(<App />);
    expect(second.container.querySelector(".app-shell")).not.toHaveAttribute("id");

    await user.click(screen.getByRole("button", { name: "Включить кастомные стили" }));
    expect(second.container.querySelector(".app-shell")).toHaveAttribute("id", GAME_A_ID);
  });

  it("maps v3 waiting state to a blocked target link and forwards recovery actions", async () => {
    const user = userEvent.setup();
    const fixture = dependencyFixture();
    const targetCommitSha = "2".repeat(40);
    fixture.context.publicationState = {
      status: "valid",
      durability: "durable",
      journal: {
        version: 3,
        sourceCommitSha: SOURCE_COMMIT_SHA,
        targetCommitSha,
        targetRevision: fixture.context.base.revision,
        targetDatabase: fixture.context.base,
        remainderPatch: fixture.context.patch,
        localAssetIdsAwaitingVerification: [],
        owner: "kana-sama",
        repo: "mygameslist",
        branch: "main",
        createdAt: CHANGED_AT,
        phase: "awaiting-deployment",
      },
      raw: "journal-r1",
      expectedRaw: "journal-r1",
      recoveryBase: null,
      check: "waiting-source",
      exportCompleted: false,
    };
    libraryHarness.current = fixture.context;
    render(<App />);
    const dialog = await openDiff(user);
    await user.click(within(dialog).getByRole("button", { name: "Синхронизировать всё" }));
    const panel = within(dialog).getByRole("region", { name: "Синхронизация с GitHub" });

    expect(within(panel).getByRole("link", { name: "Коммит" })).toHaveAttribute("href", `https://github.com/kana-sama/mygameslist/commit/${targetCommitSha}`);
    await user.type(within(panel).getByLabelText("Fine-grained PAT"), PAT);
    expect(within(panel).getByRole("button", { name: "Подключить и проверить" })).toBeEnabled();
    await user.click(within(panel).getByRole("button", { name: "Повторить проверку" }));
    await user.click(within(panel).getByRole("button", { name: "Экспортировать локальную копию" }));
    expect(fixture.context.retryPublicationCheck).toHaveBeenCalledTimes(1);
    expect(fixture.context.exportPublicationRecovery).toHaveBeenCalledTimes(1);
    expect(fixture.context.syncToGitHub).not.toHaveBeenCalled();
  });

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

  it("keeps conflict UI renderable when a selected sync discovers a same-path remote change", async () => {
    const user = userEvent.setup();
    const fixture = conflictTransitionFixture();
    let rejectSync: ((reason: Error) => void) | undefined;
    const syncResult = new Promise<never>((_resolve, reject) => { rejectSync = reject; });
    fixture.context.syncToGitHub = vi.fn().mockReturnValue(syncResult);
    fixture.conflicted.syncToGitHub = fixture.context.syncToGitHub;
    libraryHarness.current = fixture.context;
    const rendered = render(<App />);
    const dialog = await openDiff(user);

    await user.click(within(dialog).getByRole("button", { name: "Выбрать часть" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Выбрать изменение: Local title" }));
    await user.click(within(dialog).getByRole("button", { name: "Синхронизировать выбранное · 1" }));
    const panel = within(dialog).getByRole("region", { name: "Синхронизация с GitHub" });
    await user.type(within(panel).getByLabelText("Fine-grained PAT"), PAT);
    await user.click(within(panel).getByRole("button", { name: "Подключить и синхронизировать" }));
    await waitFor(() => expect(fixture.context.syncToGitHub).toHaveBeenCalledWith(
      PAT,
      expect.objectContaining({ selectedPaths: [fixture.selectedPath] }),
    ));

    libraryHarness.current = fixture.conflicted;
    expect(() => rendered.rerender(<App />)).not.toThrow();
    await act(async () => { rejectSync?.(new Error("Remote conflict")); });

    expect(within(dialog).getByRole("heading", { name: "Нужно разрешить конфликты" })).toBeInTheDocument();
    expect(within(dialog).getByText("Remote title", { selector: "pre" })).toBeInTheDocument();
    expect(within(dialog).getByText("Local title", { selector: "pre" })).toBeInTheDocument();
  });
});
