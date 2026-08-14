import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_ASSET_METADATA_PREFIX,
  PATCH_STORAGE_KEY,
  bytesToBase64,
  canonicalStringify,
  canonicalHash,
  diffLibrary,
  localAssetDataKey,
  makeExternalWebPAsset,
  makeLocalAsset,
  readLocalAsset,
  savePatch,
  sha256Bytes,
  withComputedRevision,
  writeLocalAssetsAtomic,
  type Asset,
  type Game,
  type LibraryDatabase,
} from "../src/domain";
import type { GameSaveInput, PreparedFile } from "../src/pages/GamePage";
import {
  LibraryProvider,
  promoteMemoryOnlyPublicationForDiscard,
  requiredLocalAssetIds,
  useLibrary,
} from "../src/state/LibraryContext";
import { GitHubGitDatabaseSyncClient } from "../src/state/githubGitDatabaseSync";
import {
  PENDING_PUBLICATION_STORAGE_KEY,
  installPendingPublication,
  installPendingPublicationJournal,
  loadPendingPublicationJournal,
  type PendingPublicationJournalV3,
  type PendingPublicationReceipt,
} from "../src/state/pendingPublication";
import { GITHUB_PAT_STORAGE_KEY } from "../src/state/githubPat";

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

const localAssetStateControl = vi.hoisted(() => ({
  afterUpdate: undefined as undefined | ((state: string) => Promise<void>),
}));

const interactionPersistenceControl = vi.hoisted(() => ({
  fullPatchWrites: 0,
  fullJournalWrites: 0,
  fastPatchWrites: 0,
  fastJournalWrites: 0,
  throwJournalBoundary: false,
  fullJournalInstallStarted: null as (() => void) | null,
  holdFullJournalInstall: null as Promise<void> | null,
  forcedFullJournalResults: [] as Array<
    | "actual"
    | "memory_only"
    | "memory_only_after_write"
    | "durable_after_write"
    | "durable_stale_after_write"
    | "changed"
    | "changed_without_lineage"
    | "changed_incompatible"
    | "changed_unreadable"
    | "throw_after_write"
  >,
}));

vi.mock("../src/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain")>();
  return {
    ...actual,
    savePatch: (...args: Parameters<typeof actual.savePatch>) => {
      interactionPersistenceControl.fullPatchWrites += 1;
      return actual.savePatch(...args);
    },
    saveValidatedInteractionPatch: (...args: unknown[]) => {
      interactionPersistenceControl.fastPatchWrites += 1;
      return (actual as unknown as { saveValidatedInteractionPatch: (...values: unknown[]) => unknown })
        .saveValidatedInteractionPatch(...args);
    },
    updateLocalAssetState: async (...args: Parameters<typeof actual.updateLocalAssetState>) => {
      await actual.updateLocalAssetState(...args);
      await localAssetStateControl.afterUpdate?.(args[1]);
    },
  };
});

vi.mock("../src/state/pendingPublication", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/state/pendingPublication")>();
  return {
    ...actual,
    installPendingPublicationJournal: async (...args: Parameters<typeof actual.installPendingPublicationJournal>) => {
      interactionPersistenceControl.fullJournalWrites += 1;
      if (interactionPersistenceControl.throwJournalBoundary) throw new Error("interaction journal boundary failed");
      if (interactionPersistenceControl.holdFullJournalInstall) {
        interactionPersistenceControl.fullJournalInstallStarted?.();
        await interactionPersistenceControl.holdFullJournalInstall;
      }
      const forced = interactionPersistenceControl.forcedFullJournalResults.shift() ?? "actual";
      const preserveForcedWriteAfterCasRetry = forced === "memory_only_after_write" || forced === "throw_after_write";
      const writeForcedJournal = (nextJournal: PendingPublicationJournalV3 = args[1]) => {
        const previousRaw = localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY);
        if (previousRaw !== args[2].expectedRaw) {
          if (preserveForcedWriteAfterCasRetry) interactionPersistenceControl.forcedFullJournalResults.unshift(forced);
          return { status: "changed" as const, currentRaw: previousRaw };
        }
        const currentOrdinaryRaw = localStorage.getItem(PATCH_STORAGE_KEY);
        if (
          Object.prototype.hasOwnProperty.call(args[2], "expectedOrdinaryRaw")
          && currentOrdinaryRaw !== args[2].expectedOrdinaryRaw
        ) {
          if (preserveForcedWriteAfterCasRetry) interactionPersistenceControl.forcedFullJournalResults.unshift(forced);
          return { status: "changed" as const, currentRaw: previousRaw, currentOrdinaryRaw };
        }
        const nextRaw = canonicalStringify(nextJournal);
        const lineage = args[2].replaceRescueLineage?.(previousRaw, nextRaw);
        if (lineage?.status === "changed") return { status: "changed" as const, currentRaw: previousRaw };
        if (lineage?.status === "failure") throw lineage.error;
        localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, nextRaw);
        return { status: "durable" as const, journal: nextJournal, raw: nextRaw };
      };
      if (forced === "memory_only") {
        return { status: "memory_only" as const, journal: args[1], error: new Error("forced replacement memory-only") };
      }
      if (forced === "memory_only_after_write") {
        const written = writeForcedJournal();
        if (written.status === "changed") return written;
        return { status: "memory_only" as const, journal: args[1], error: new Error("forced unconfirmed journal write") };
      }
      if (forced === "durable_after_write") {
        return writeForcedJournal();
      }
      if (forced === "durable_stale_after_write") {
        const raw = canonicalStringify(args[1]);
        localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, raw);
        return { status: "durable" as const, journal: args[1], raw };
      }
      if (forced === "changed") {
        const concurrent = structuredClone(args[1]);
        concurrent.createdAt = "2026-07-16T10:00:00.001Z";
        const written = writeForcedJournal(concurrent);
        if (written.status === "changed") return written;
        return { status: "changed" as const, currentRaw: written.raw };
      }
      if (forced === "changed_without_lineage") {
        const concurrent = structuredClone(args[1]);
        concurrent.createdAt = "2026-07-16T10:00:00.001Z";
        const concurrentRaw = canonicalStringify(concurrent);
        localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, concurrentRaw);
        return { status: "changed" as const, currentRaw: concurrentRaw };
      }
      if (forced === "changed_incompatible") {
        const incompatible = structuredClone(args[1]);
        incompatible.targetCommitSha = "7".repeat(40);
        const incompatibleRaw = canonicalStringify(incompatible);
        localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, incompatibleRaw);
        return { status: "changed" as const, currentRaw: incompatibleRaw };
      }
      if (forced === "changed_unreadable") {
        const unreadableRaw = "{unreadable-journal";
        localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, unreadableRaw);
        return { status: "changed" as const, currentRaw: unreadableRaw };
      }
      if (forced === "throw_after_write") {
        const written = writeForcedJournal();
        if (written.status === "changed") return written;
        throw new Error("forced installer throw after write");
      }
      return actual.installPendingPublicationJournal(...args);
    },
    installValidatedInteractionJournal: async (...args: unknown[]) => {
      interactionPersistenceControl.fastJournalWrites += 1;
      if (interactionPersistenceControl.throwJournalBoundary) throw new Error("interaction journal boundary failed");
      return (actual as unknown as { installValidatedInteractionJournal: (...values: unknown[]) => unknown })
        .installValidatedInteractionJournal(...args);
    },
  };
});

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_GAME_ID = "33333333-3333-4333-8333-333333333333";
const PROGRESS_ITEM_ID = "44444444-4444-4444-8444-444444444444";
const PROGRESS_NOTE_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-07-16T10:00:00.000Z";
const GITHUB_TOKEN = "github_pat_test-only";
const HEAD_SHA = "1".repeat(40);
const LONG_HEAD_SHA = "a".repeat(64);
const PUBLICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TREE_SHA = "2".repeat(40);
const LIBRARY_BLOB_SHA = "3".repeat(40);
const CREATED_LIBRARY_BLOB_SHA = "4".repeat(40);
const CREATED_TREE_SHA = "5".repeat(40);
const CREATED_COMMIT_SHA = "6".repeat(40);

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  private setFailures = 0;
  private failingSetKeys = new Set<string>();
  private failingSetMatch: ((key: string, value: string) => boolean) | null = null;
  private failReadAfterSetKeys = new Set<string>();
  private failingGetKeys = new Set<string>();
  private keptRemoveKeys = new Set<string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  failNextSet() { this.setFailures += 1; }
  failNextSetFor(key: string) { this.failingSetKeys.add(key); }
  failNextReadAfterSetFor(key: string) { this.failReadAfterSetKeys.add(key); }
  failNextMatchingSet(matches: (key: string, value: string) => boolean) { this.failingSetMatch = matches; }
  keepNextRemoveFor(key: string) { this.keptRemoveKeys.add(key); }
  getItem(key: string) {
    if (this.failingGetKeys.delete(key)) throw new DOMException("Storage is unavailable", "SecurityError");
    return this.values.get(key) ?? null;
  }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) {
    if (this.keptRemoveKeys.delete(key)) return;
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failingSetMatch?.(key, value)) {
      this.failingSetMatch = null;
      throw new DOMException("Storage is full", "QuotaExceededError");
    }
    if (this.failingSetKeys.delete(key)) {
      throw new DOMException("Storage is full", "QuotaExceededError");
    }
    if (this.setFailures > 0) {
      this.setFailures -= 1;
      throw new DOMException("Storage is full", "QuotaExceededError");
    }
    this.values.set(key, value);
    if (this.failReadAfterSetKeys.delete(key)) this.failingGetKeys.add(key);
  }
}

class ExclusiveTestLockManager {
  private readonly tails = new Map<string, Promise<void>>();

  request<T>(name: string, _options: LockOptions, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<Awaited<T>> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => held);
    this.tails.set(name, tail);
    return previous.then(() => callback({ name, mode: "exclusive" } as Lock)).finally(() => {
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
    }) as Promise<Awaited<T>>;
  }
}

function game(title: string, coverAssetId: string | null = null): Game {
  return {
    id: GAME_ID,
    title,
    coverAssetId,
    platforms: ["NES"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function webpAsset(marker: number, name: string): Asset {
  return makeExternalWebPAsset(new Uint8Array([82, 73, 70, 70, marker, 0, 0, 0, 87, 69, 66, 80]), 1, 1, name, `${name}.webp`).asset;
}

function seededDatabase(asset: Asset): LibraryDatabase {
  const database = empty();
  database.assets[asset.id] = asset;
  database.games[GAME_ID] = game("Seeded game", asset.id);
  return withComputedRevision(database);
}

function empty(): LibraryDatabase {
  return withComputedRevision({ schemaVersion: 2, revision: "", publicationId: PUBLICATION_ID, games: {}, notes: {}, assets: {} });
}

function pendingJournal(targetDatabase: LibraryDatabase, remainderPatch = diffLibrary(targetDatabase, targetDatabase)): PendingPublicationJournalV3 {
  return {
    version: 3,
    sourceCommitSha: HEAD_SHA,
    targetCommitSha: CREATED_COMMIT_SHA,
    targetRevision: targetDatabase.revision,
    targetDatabase,
    remainderPatch,
    localAssetIdsAwaitingVerification: [],
    owner: "kana-sama",
    repo: "mygameslist",
    branch: "main",
    createdAt: NOW,
    phase: "awaiting-deployment",
  };
}

function mockStaticValue(value: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => structuredClone(value),
  }));
}

function mockStaticDatabase(database: LibraryDatabase, sourceCommitSha: string | null = HEAD_SHA) {
  mockStaticValue({ sourceCommitSha, database });
}

function mockStaticSequence(...values: unknown[]) {
  let index = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return { ok: true, json: async () => structuredClone(value) };
  }));
}

function Probe() {
  const library = useLibrary();
  return <div>
    <span data-testid="loading">{String(library.loading)}</span>
    <span data-testid="fatal-error">{library.fatalError ?? "none"}</span>
    <span data-testid="source-commit-sha">{library.sourceCommitSha ?? "null"}</span>
    <span data-testid="base-revision">{library.base.revision}</span>
    <span data-testid="title">{Object.values(library.effective.games)[0]?.title ?? "empty"}</span>
    <span data-testid="operations">{Object.keys(library.patch.operations).length}</span>
    <span data-testid="operation-paths">{Object.keys(library.patch.operations).sort().join(",")}</span>
    <span data-testid="conflicts">{library.conflicts.length}</span>
    <span data-testid="publication-state">{library.publicationState.status}</span>
    <span data-testid="local-assets">{library.localAssets.length}</span>
    <button onClick={() => { void library.moveGame(GAME_ID, "s", 0).catch((error) => {
      (document.querySelector("[data-testid='mutation-error']") as HTMLElement).textContent = error instanceof Error ? error.message : String(error);
    }); }} type="button">Изменить</button>
    <span data-testid="mutation-error" />
  </div>;
}

function ImportProbe({ raw, assetId }: { raw: string; assetId: string }) {
  const library = useLibrary();
  const [result, setResult] = useState("idle");
  const asset = library.effective.assets[assetId];
  return <div>
    <span data-testid="import-loading">{String(library.loading)}</span>
    <span data-testid="import-result">{result}</span>
    <span data-testid="import-source-commit-sha">{library.sourceCommitSha ?? "null"}</span>
    <span data-testid="import-operation-paths">{Object.keys(library.patch.operations).sort().join(",")}</span>
    <span data-testid="import-asset-alt">{asset?.kind === "image" ? asset.alt : "none"}</span>
    <span data-testid="import-local-assets">{library.localAssets.length}</span>
    <button onClick={() => {
      void library.importPatch(raw)
        .then(() => setResult("imported"))
        .catch((error) => setResult(error instanceof Error ? error.message : String(error)));
    }} type="button">Import patch</button>
  </div>;
}

function AssetProbe({ localCover }: { localCover: Exclude<GameSaveInput["pendingCover"], null> }) {
  const library = useLibrary();
  const current = library.effective.games[GAME_ID];
  const saveCover = (pendingCover: GameSaveInput["pendingCover"]) => {
    if (!current) return;
    void library.saveGame({
      id: current.id,
      title: current.title,
      coverAssetId: null,
      pendingCover,
      platforms: current.platforms,
      tags: current.tags,
      status: current.status,
      tierId: current.placement.tierId,
      reviewMarkdown: current.reviewMarkdown,
      progressItems: current.progressItems?.map((item) => ({ ...item, pendingIcon: null })) ?? [],
      notes: [],
    });
  };
  return <div>
    <span data-testid="asset-loading">{String(library.loading)}</span>
    <span data-testid="asset-game-count">{Object.keys(library.effective.games).length}</span>
    <span data-testid="asset-cover-id">{current?.coverAssetId ?? "none"}</span>
    <span data-testid="asset-ids">{Object.keys(library.effective.assets).sort().join(",")}</span>
    <span data-testid="asset-operation-paths">{Object.keys(library.patch.operations).sort().join(",")}</span>
    <button onClick={() => library.deleteGame(GAME_ID)} type="button">Удалить seeded game</button>
    <button onClick={() => saveCover(localCover)} type="button">Поставить локальную обложку</button>
    <button onClick={() => saveCover(null)} type="button">Убрать обложку</button>
  </div>;
}

function ProgressAssetProbe({ icons }: { icons: [Exclude<GameSaveInput["progressItems"][number]["pendingIcon"], null>, Exclude<GameSaveInput["progressItems"][number]["pendingIcon"], null>] }) {
  const library = useLibrary();
  const current = library.effective.games[GAME_ID];
  const progressNote = library.effective.notes[PROGRESS_NOTE_ID];
  const saveProgress = (pendingIcon: GameSaveInput["progressItems"][number]["pendingIcon"] | null) => {
    if (!current) return;
    void library.saveGame({
      id: current.id,
      title: current.title,
      coverAssetId: current.coverAssetId,
      pendingCover: null,
      platforms: current.platforms,
      tags: current.tags,
      status: current.status,
      tierId: current.placement.tierId,
      reviewMarkdown: current.reviewMarkdown,
      progressItems: pendingIcon ? [{ id: PROGRESS_ITEM_ID, iconAssetId: null, noteId: PROGRESS_NOTE_ID, pendingIcon }] : [],
      notes: progressNote ? [{
        id: progressNote.id,
        clientId: progressNote.id,
        bodyMarkdown: progressNote.bodyMarkdown,
        attachments: [...progressNote.attachments],
        rank: progressNote.rank,
      }] : [],
    });
  };
  return <div>
    <span data-testid="progress-loading">{String(library.loading)}</span>
    <span data-testid="progress-icon-id">{current?.progressItems?.[0]?.iconAssetId ?? "none"}</span>
    <span data-testid="progress-item-id">{current?.progressItems?.[0]?.id ?? "none"}</span>
    <span data-testid="progress-canonical">{String(current ? Object.hasOwn(current, "progressItems") : false)}</span>
    <span data-testid="progress-asset-ids">{Object.keys(library.effective.assets).sort().join(",")}</span>
    <span data-testid="progress-local-assets">{library.localAssets.length}</span>
    <button onClick={() => saveProgress(icons[0])} type="button">Поставить первую иконку прогресса</button>
    <button onClick={() => saveProgress(icons[1])} type="button">Заменить иконку прогресса</button>
    <button onClick={() => saveProgress(null)} type="button">Удалить элемент прогресса</button>
  </div>;
}

function FileProbe({ preparedFile }: { preparedFile: PreparedFile }) {
  const library = useLibrary();
  const current = library.effective.games[GAME_ID];
  const fileAsset = Object.values(library.effective.assets).find((asset) => asset.kind === "file");
  const saveNotes = (withFile: boolean) => {
    if (!current) return;
    void library.saveGame({
      id: current.id,
      title: current.title,
      coverAssetId: current.coverAssetId,
      pendingCover: null,
      platforms: current.platforms,
      tags: current.tags,
      status: current.status,
      tierId: current.placement.tierId,
      reviewMarkdown: current.reviewMarkdown,
      progressItems: current.progressItems?.map((item) => ({ ...item, pendingIcon: null })) ?? [],
      notes: withFile ? [{
        clientId: "draft-file",
        bodyMarkdown: "Save file",
        rank: 1024,
        attachments: [{ type: "pending-file", file: preparedFile, label: "Save data" }],
      }] : [],
    });
  };
  return <div>
    <span data-testid="file-loading">{String(library.loading)}</span>
    <span data-testid="file-kind">{fileAsset?.kind ?? "none"}</span>
    <span data-testid="file-blob-count">{library.localAssets.length}</span>
    <span data-testid="file-url">{fileAsset ? library.resolveAssetUrl(fileAsset.id) : "none"}</span>
    <button onClick={() => saveNotes(true)} type="button">Прикрепить файл</button>
    <button onClick={() => saveNotes(false)} type="button">Удалить файл</button>
  </div>;
}

function NoteGroupProbe() {
  const library = useLibrary();
  const current = library.effective.games[GAME_ID];
  const currentNote = library.effective.notes[NOTE_ID];
  return <div>
    <span data-testid="group-loading">{String(library.loading)}</span>
    <span data-testid="group-rank">{currentNote?.groupRank ?? 1024}</span>
    <span data-testid="collapsed-checklists">{currentNote?.collapsedChecklistSections?.join(",") ?? "expanded"}</span>
    <span data-testid="note-size">{currentNote ? `${currentNote.doubleHeight ? "double-height" : "normal-height"},${currentNote.doubleWidth ? "double-width" : "normal-width"}` : "missing"}</span>
    <span data-testid="group-operation-paths">{Object.keys(library.patch.operations).sort().join(",")}</span>
    <button onClick={() => {
      if (!current || !currentNote) return;
      void library.saveGame({
        id: current.id,
        title: current.title,
        coverAssetId: current.coverAssetId,
        pendingCover: null,
        platforms: current.platforms,
        tags: current.tags,
        status: current.status,
        tierId: current.placement.tierId,
        reviewMarkdown: current.reviewMarkdown,
        progressItems: current.progressItems?.map((item) => ({ ...item, pendingIcon: null })) ?? [],
        notes: [{ id: currentNote.id, clientId: currentNote.id, bodyMarkdown: currentNote.bodyMarkdown, attachments: [...currentNote.attachments], groupRank: 2048, rank: currentNote.rank }],
      });
    }} type="button">Переместить заметку в группу</button>
    <button onClick={() => {
      if (!current || !currentNote) return;
      void library.saveGame({
        id: current.id,
        title: current.title,
        coverAssetId: current.coverAssetId,
        pendingCover: null,
        platforms: current.platforms,
        tags: current.tags,
        status: current.status,
        tierId: current.placement.tierId,
        reviewMarkdown: current.reviewMarkdown,
        progressItems: current.progressItems?.map((item) => ({ ...item, pendingIcon: null })) ?? [],
        notes: [{
          id: currentNote.id,
          clientId: currentNote.id,
          bodyMarkdown: currentNote.bodyMarkdown,
          attachments: [...currentNote.attachments],
          collapsedChecklistSections: ["heading:abc"],
          ...(currentNote.groupRank === undefined ? {} : { groupRank: currentNote.groupRank }),
          rank: currentNote.rank,
        }],
      });
    }} type="button">Свернуть checklist</button>
    <button onClick={() => {
      if (!current || !currentNote) return;
      void library.saveGame({
        id: current.id,
        title: current.title,
        coverAssetId: current.coverAssetId,
        pendingCover: null,
        platforms: current.platforms,
        tags: current.tags,
        status: current.status,
        tierId: current.placement.tierId,
        reviewMarkdown: current.reviewMarkdown,
        progressItems: current.progressItems?.map((item) => ({ ...item, pendingIcon: null })) ?? [],
        notes: [{
          id: currentNote.id,
          clientId: currentNote.id,
          bodyMarkdown: currentNote.bodyMarkdown,
          attachments: [...currentNote.attachments],
          doubleHeight: true,
          doubleWidth: true,
          ...(currentNote.groupRank === undefined ? {} : { groupRank: currentNote.groupRank }),
          rank: currentNote.rank,
        }],
      });
    }} type="button">Увеличить заметку</button>
  </div>;
}

function NoteInteractionProbe() {
  const library = useLibrary();
  const [result, setResult] = useState("idle");
  const [syncResult, setSyncResult] = useState("idle");
  const note = library.effective.notes[NOTE_ID];
  const bodyOperation = library.patch.operations[`/notes/${NOTE_ID}/bodyMarkdown`];
  const save = (value: string) => {
    void library.saveNoteInteraction({ noteId: NOTE_ID, field: "bodyMarkdown", value })
      .then(() => setResult("saved"))
      .catch((error) => setResult(error instanceof Error ? error.message : String(error)));
  };
  return <div>
    <span data-testid="interaction-loading">{String(library.loading)}</span>
    <span data-testid="interaction-body">{note?.bodyMarkdown ?? "missing"}</span>
    <span data-testid="interaction-result">{result}</span>
    <span data-testid="interaction-sync-result">{syncResult}</span>
    <span data-testid="interaction-authority">{library.publicationState.status}</span>
    <span data-testid="interaction-patch-value">{bodyOperation?.operation === "set" ? String(bodyOperation.value) : "none"}</span>
    <span data-testid="interaction-tier">{library.effective.games[GAME_ID]?.placement.tierId ?? "missing"}</span>
    <span data-testid="interaction-persistence-error">{library.persistenceError ?? "none"}</span>
    <span data-testid="interaction-conflicts">{library.conflicts.length}</span>
    <button type="button" onClick={() => save("First click")}>First note click</button>
    <button type="button" onClick={() => save("Second click")}>Second note click</button>
    <button type="button" onClick={() => save("Before")}>Restore base note</button>
    <button type="button" onClick={() => { void library.moveGame(GAME_ID, "s", 0); }}>Move after handoff</button>
    <button type="button" onClick={() => {
      setSyncResult("syncing");
      void library.syncToGitHub(GITHUB_TOKEN)
        .then(() => setSyncResult("synced"))
        .catch((error) => setSyncResult(error instanceof Error ? error.message : String(error)));
    }}>Start structural sync</button>
    <button type="button" onClick={() => {
      void library.undoLast()
        .then((restored) => setResult(`undo:${String(restored)}`))
        .catch((error) => setResult(error instanceof Error ? error.message : String(error)));
    }}>Undo note click</button>
  </div>;
}

function GitHubSyncProbe() {
  const library = useLibrary();
  const [result, setResult] = useState("idle");
  const assetIds = Object.keys(library.effective.assets).sort();
  return <div>
    <span data-testid="sync-loading">{String(library.loading)}</span>
    <span data-testid="sync-source-commit-sha">{library.sourceCommitSha ?? "null"}</span>
    <span data-testid="sync-title">{library.effective.games[GAME_ID]?.title ?? "empty"}</span>
    <span data-testid="sync-cover-id">{library.effective.games[GAME_ID]?.coverAssetId ?? "none"}</span>
    <span data-testid="sync-tier">{library.effective.games[GAME_ID]?.placement.tierId ?? "none"}</span>
    <span data-testid="sync-operations">{Object.keys(library.patch.operations).sort().join(",")}</span>
    <span data-testid="sync-conflicts">{library.conflicts.length}</span>
    <span data-testid="sync-pending">{String(library.publicationState.status !== "none")}</span>
    <span data-testid="sync-publication-durability">{library.publicationState.status === "valid" ? library.publicationState.durability : "none"}</span>
    <span data-testid="sync-publication-check">{library.publicationState.status === "valid" ? library.publicationState.check ?? "none" : "none"}</span>
    <span data-testid="sync-persistence-error">{library.persistenceError ?? "none"}</span>
    <span data-testid="sync-result">{result}</span>
    <span data-testid="sync-asset-urls">{assetIds.map((id) => library.resolveAssetUrl(id) ?? "missing").join(",")}</span>
    <span data-testid="sync-local-states">{library.localAssets.map((asset) => `${asset.id}:${asset.state}`).sort().join(",")}</span>
    <button onClick={() => { void library.verifyGitHubAccess(GITHUB_TOKEN).then(() => setResult("connected")).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Connect GitHub</button>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync GitHub</button>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN, { selectedPaths: [] }).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync empty selection</button>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN, { selectedPaths: [`/games/${GAME_ID}/title`] }).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync selected title</button>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN, { selectedPaths: [`/games/${GAME_ID}`] }).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync selected game</button>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN, { selectedPaths: [`/games/${GAME_ID}/coverAssetId`] }).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync selected cover</button>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN, { selectedPaths: [`/games/${GAME_ID}/missing`] }).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync invalid selection</button>
    <button onClick={() => { void library.retryPublicationCheck(GITHUB_TOKEN).then(() => setResult("checked")).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Retry publication check</button>
    <button onClick={() => { void library.exportPublicationRecovery().then(() => setResult("exported")).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Export publication recovery</button>
    <button onClick={() => { void library.discardPublicationAfterExport().then(() => setResult("discarded")).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Discard publication recovery</button>
    <button onClick={() => library.moveGame(GAME_ID, "s", 0)} type="button">Edit after click</button>
    <button onClick={() => {
      const current = library.effective.games[GAME_ID];
      const currentNote = library.effective.notes[NOTE_ID];
      if (!current || !currentNote) return;
      void library.saveGame({
        id: current.id,
        title: current.title,
        coverAssetId: current.coverAssetId,
        pendingCover: null,
        platforms: current.platforms,
        tags: current.tags,
        status: current.status,
        tierId: current.placement.tierId,
        reviewMarkdown: current.reviewMarkdown,
        progressItems: current.progressItems?.map((item) => ({ ...item, pendingIcon: null })) ?? [],
        notes: [{
          id: currentNote.id,
          clientId: currentNote.id,
          bodyMarkdown: "Post-click note",
          attachments: [...currentNote.attachments],
          rank: currentNote.rank,
        }],
      });
    }} type="button">Edit note after click</button>
  </div>;
}

function StorageEventOnLoadedProbe({ onLoaded }: { onLoaded: () => void }) {
  const library = useLibrary();
  const dispatched = useRef(false);
  useLayoutEffect(() => {
    if (library.loading || dispatched.current) return;
    dispatched.current = true;
    onLoaded();
  }, [library.loading, onLoaded]);
  return <div>
    <span data-testid="queued-sync-loading">{String(library.loading)}</span>
    <span data-testid="queued-sync-source-commit-sha">{library.sourceCommitSha ?? "null"}</span>
    <span data-testid="queued-sync-title">{library.effective.games[GAME_ID]?.title ?? "empty"}</span>
    <span data-testid="queued-sync-pending">{String(library.publicationState.status !== "none")}</span>
  </div>;
}

function githubResponses(database: LibraryDatabase, remoteDatabase = database, sourceCommitSha: string | null = HEAD_SHA) {
  const requests: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), document.baseURI);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ url, method, body });
    if (url.origin !== "https://api.github.com") return jsonResponse({ sourceCommitSha, database });
    const root = "/repos/kana-sama/mygameslist";
    if (method === "GET" && url.pathname === `${root}/git/ref/heads/main`) return jsonResponse({ object: { type: "commit", sha: HEAD_SHA } });
    if (method === "GET" && url.pathname === `${root}/git/commits/${HEAD_SHA}`) return jsonResponse({ tree: { sha: TREE_SHA } });
    if (method === "GET" && url.pathname === `${root}/git/trees/${TREE_SHA}`) return jsonResponse({ truncated: false, tree: [{ path: "public/data/library.json", type: "blob", sha: LIBRARY_BLOB_SHA }] });
    if (method === "GET" && url.pathname === `${root}/git/blobs/${LIBRARY_BLOB_SHA}`) {
      return jsonResponse({ encoding: "base64", content: bytesToBase64(new TextEncoder().encode(JSON.stringify(remoteDatabase))) });
    }
    if (method === "POST" && url.pathname === `${root}/git/blobs`) return jsonResponse({ sha: body?.encoding === "utf-8" ? CREATED_LIBRARY_BLOB_SHA : "7".repeat(40) }, 201);
    if (method === "POST" && url.pathname === `${root}/git/trees`) return jsonResponse({ sha: CREATED_TREE_SHA }, 201);
    if (method === "POST" && url.pathname === `${root}/git/commits`) return jsonResponse({ sha: CREATED_COMMIT_SHA }, 201);
    if (method === "POST" && url.pathname === `${root}/git/refs`) return jsonResponse({ ref: body?.ref, object: { type: "commit", sha: body?.sha } }, 201);
    if (method === "PATCH" && url.pathname === `${root}/git/refs/heads/main`) return jsonResponse({ object: { type: "commit", sha: CREATED_COMMIT_SHA } });
    if (method === "DELETE" && url.pathname.startsWith(`${root}/git/refs/heads/mylib-pat-check/`)) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests };
}

function publishedLibraryFromRequest(
  requests: Array<{ url: URL; method: string; body: Record<string, unknown> | null }>,
): LibraryDatabase {
  const request = requests.find(({ method, url, body }) => method === "POST"
    && url.pathname.endsWith("/git/blobs")
    && body?.encoding === "utf-8");
  if (typeof request?.body?.content !== "string") throw new Error("Published library request was not found");
  return JSON.parse(request.body.content) as LibraryDatabase;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  Object.defineProperty(navigator, "locks", { configurable: true, value: new ExclusiveTestLockManager() });
  sessionStorage.clear();
  interactionPersistenceControl.fullPatchWrites = 0;
  interactionPersistenceControl.fullJournalWrites = 0;
  interactionPersistenceControl.fastPatchWrites = 0;
  interactionPersistenceControl.fastJournalWrites = 0;
  interactionPersistenceControl.throwJournalBoundary = false;
  interactionPersistenceControl.fullJournalInstallStarted = null;
  interactionPersistenceControl.holdFullJournalInstall = null;
  interactionPersistenceControl.forcedFullJournalResults = [];
});

afterEach(() => {
  vi.useRealTimers();
  localAssetStateControl.afterUpdate = undefined;
  interactionPersistenceControl.throwJournalBoundary = false;
  interactionPersistenceControl.fullJournalInstallStarted = null;
  interactionPersistenceControl.holdFullJournalInstall = null;
  interactionPersistenceControl.forcedFullJournalResults = [];
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LibraryProvider patch reload and reconciliation", () => {
  it.each([
    ["40-hex", HEAD_SHA],
    ["64-hex", LONG_HEAD_SHA],
  ])("loads a valid published envelope with %s deployed provenance", async (_label, sourceCommitSha) => {
    const base = empty();
    mockStaticDatabase(base, sourceCommitSha);

    render(<LibraryProvider><Probe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("fatal-error")).toHaveTextContent("none");
    expect(screen.getByTestId("source-commit-sha")).toHaveTextContent(sourceCommitSha);
    expect(screen.getByTestId("base-revision")).toHaveTextContent(base.revision);
  });

  it("loads a durable v3 journal before the ordinary patch and updates its exact raw on mutation", async () => {
    const sourceDraft = empty();
    sourceDraft.games[GAME_ID] = game("Source title");
    const source = withComputedRevision(sourceDraft);
    const targetDraft = structuredClone(source);
    targetDraft.games[GAME_ID].title = "Published target";
    const target = withComputedRevision(targetDraft);
    const staleOrdinary = diffLibrary(source, { ...structuredClone(source), games: { [GAME_ID]: game("Ignored ordinary") } }, { changedAt: NOW });
    expect(savePatch(localStorage, staleOrdinary).ok).toBe(true);
    const installed = await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null });
    expect(installed.status).toBe("durable");
    const initialRaw = installed.status === "durable" ? installed.raw : "";
    mockStaticDatabase(source);

    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("publication-state")).toHaveTextContent("valid");
    expect(screen.getByTestId("title")).toHaveTextContent("Published target");
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBe(JSON.stringify(staleOrdinary));

    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    await waitFor(() => expect(loadPendingPublicationJournal(localStorage)).toMatchObject({ status: "valid" }));
    await waitFor(() => expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).not.toBe(initialRaw));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBe(JSON.stringify(staleOrdinary));
  });

  it("blocks edits when the pending journal is corrupt without changing ordinary bytes", async () => {
    const sourceDraft = empty();
    sourceDraft.games[GAME_ID] = game("Safe source");
    const source = withComputedRevision(sourceDraft);
    const ordinary = diffLibrary(source, { ...structuredClone(source), games: { [GAME_ID]: game("Hidden ordinary") } }, { changedAt: NOW });
    expect(savePatch(localStorage, ordinary).ok).toBe(true);
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, "{");
    mockStaticDatabase(source);

    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("publication-state")).toHaveTextContent("corrupt");
    expect(screen.getByTestId("title")).toHaveTextContent("Safe source");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    await waitFor(() => expect(screen.getByTestId("mutation-error")).toHaveTextContent("экспортируйте и восстановите"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBe(JSON.stringify(ordinary));
  });

  it("loads null development provenance without changing the semantic revision", async () => {
    const base = empty();
    mockStaticDatabase(base, null);

    render(<LibraryProvider><Probe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("fatal-error")).toHaveTextContent("none");
    expect(screen.getByTestId("source-commit-sha")).toHaveTextContent("null");
    expect(screen.getByTestId("base-revision")).toHaveTextContent(base.revision);
  });

  it.each([
    ["a bare database", () => empty()],
    ["an unknown envelope key", () => ({ sourceCommitSha: HEAD_SHA, database: empty(), unexpected: true })],
    ["a malformed source SHA", () => ({ sourceCommitSha: "A".repeat(40), database: empty() })],
    ["a mismatched semantic revision", () => ({ sourceCommitSha: HEAD_SHA, database: { ...empty(), revision: "b".repeat(64) } })],
    ["a noncanonical database", () => {
      const database = empty();
      database.games[GAME_ID] = { ...game("Noncanonical"), progressItems: [] };
      return { sourceCommitSha: HEAD_SHA, database: withComputedRevision(database) };
    }],
  ])("rejects %s without installing database state", async (_label, value) => {
    mockStaticValue(value());

    render(<LibraryProvider><Probe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("fatal-error")).not.toHaveTextContent("none");
    expect(screen.getByTestId("source-commit-sha")).toHaveTextContent("null");
    expect(screen.getByTestId("title")).toHaveTextContent("empty");
    expect(screen.getByTestId("operations")).toHaveTextContent("0");
  });

  it("retains deployed provenance across a local mutation and never creates a provenance patch path", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Provenance game");
    const base = withComputedRevision(draft);
    mockStaticDatabase(base);

    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));

    await waitFor(() => expect(screen.getByTestId("operations")).toHaveTextContent("1"));
    expect(screen.getByTestId("source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(screen.getByTestId("operation-paths").textContent).toBe(`/games/${GAME_ID}/placement`);
    expect(screen.getByTestId("operation-paths")).not.toHaveTextContent("sourceCommitSha");
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).not.toContain("sourceCommitSha");
  });

  it("rejects a nonrepresentable imported Blob patch before writing local bytes or changing state", async () => {
    const base = empty();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const assetId = sha256Bytes(bytes);
    const desired = structuredClone(base);
    desired.games[GAME_ID] = game("Imported game");
    desired.assets[assetId] = {
      id: assetId,
      kind: "file",
      mime: "application/octet-stream",
      byteLength: bytes.byteLength,
      originalName: "save.gct",
    };
    desired.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Imported save",
      attachments: [{ type: "file", assetId, label: "Save" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const patch = diffLibrary(base, desired, {
      changedAt: NOW,
      transactionId: "invalid-import",
      blobs: { [assetId]: bytesToBase64(bytes) },
    });
    const assetOperation = patch.operations[`/assets/${assetId}`];
    if (assetOperation.operation !== "set" || typeof assetOperation.value !== "object" || assetOperation.value === null) throw new Error("Expected asset set operation");
    (assetOperation.value as Asset).originalName = "unsafe/save.gct";
    mockStaticDatabase(base);

    render(<LibraryProvider><ImportProbe raw={JSON.stringify(patch)} assetId={assetId} /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("import-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Import patch" }));

    await waitFor(() => expect(screen.getByTestId("import-result")).not.toHaveTextContent("idle"));
    expect(screen.getByTestId("import-result")).toHaveTextContent("не представимые");
    expect(screen.getByTestId("import-source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(screen.getByTestId("import-operation-paths")).toBeEmptyDOMElement();
    expect(screen.getByTestId("import-local-assets")).toHaveTextContent("0");
    expect(await readLocalAsset(assetId)).toBeNull();
  });

  it("installs a valid imported owner edit with normalized derived image metadata", async () => {
    const prepared = makeExternalWebPAsset(new Uint8Array([82, 73, 70, 70, 7, 0, 0, 0, 87, 69, 66, 80]), 1, 1, "Old alt", "guide.webp");
    const draft = empty();
    draft.games[GAME_ID] = game("Import owner game");
    draft.assets[prepared.asset.id] = prepared.asset;
    draft.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Guide",
      attachments: [{ type: "image", assetId: prepared.asset.id, alt: "Old alt" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const base = withComputedRevision(draft);
    const desired = structuredClone(base);
    const attachment = desired.notes[NOTE_ID].attachments[0];
    if (attachment.type !== "image") throw new Error("Expected image attachment");
    attachment.alt = "New alt";
    const patch = diffLibrary(base, desired, { changedAt: NOW, transactionId: "valid-owner-import" });
    mockStaticDatabase(base);

    render(<LibraryProvider><ImportProbe raw={JSON.stringify(patch)} assetId={prepared.asset.id} /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("import-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Import patch" }));

    await waitFor(() => expect(screen.getByTestId("import-result")).toHaveTextContent("imported"));
    expect(screen.getByTestId("import-asset-alt")).toHaveTextContent("New alt");
    expect(screen.getByTestId("import-operation-paths")).toHaveTextContent(`/assets/${prepared.asset.id}`);
    expect(screen.getByTestId("import-operation-paths")).toHaveTextContent(`/notes/${NOTE_ID}/attachments`);
    expect(screen.getByTestId("import-source-commit-sha")).toHaveTextContent(HEAD_SHA);
  });

  it("persists a note group move as a sparse field operation", async () => {
    const draftBase = empty();
    draftBase.games[GAME_ID] = game("Grouped game");
    draftBase.notes[NOTE_ID] = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "Guide", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const base = withComputedRevision(draftBase);
    mockStaticDatabase(base);

    render(<LibraryProvider><NoteGroupProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("group-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Переместить заметку в группу" }));

    await waitFor(() => expect(screen.getByTestId("group-rank")).toHaveTextContent("2048"));
    expect(screen.getByTestId("group-operation-paths")).toHaveTextContent(`/notes/${NOTE_ID}/groupRank`);
  });

  it("persists collapsed checklist sections as a sparse field operation", async () => {
    const draftBase = empty();
    draftBase.games[GAME_ID] = game("Checklist game");
    draftBase.notes[NOTE_ID] = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "# Route\n- [ ] Task", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const base = withComputedRevision(draftBase);
    mockStaticDatabase(base);

    render(<LibraryProvider><NoteGroupProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("group-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Свернуть checklist" }));

    await waitFor(() => expect(screen.getByTestId("collapsed-checklists")).toHaveTextContent("heading:abc"));
    expect(screen.getByTestId("group-operation-paths")).toHaveTextContent(`/notes/${NOTE_ID}/collapsedChecklistSections`);
  });

  it("persists note sizes as sparse field operations", async () => {
    const draftBase = empty();
    draftBase.games[GAME_ID] = game("Sized note game");
    draftBase.notes[NOTE_ID] = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "Guide", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const base = withComputedRevision(draftBase);
    mockStaticDatabase(base);

    render(<LibraryProvider><NoteGroupProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("group-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Увеличить заметку" }));

    await waitFor(() => expect(screen.getByTestId("note-size")).toHaveTextContent("double-height,double-width"));
    expect(screen.getByTestId("group-operation-paths")).toHaveTextContent(`/notes/${NOTE_ID}/doubleHeight,/notes/${NOTE_ID}/doubleWidth`);
  });

  it("migrates schema-1 game changes and drops obsolete collection operations", async () => {
    const draftBase = empty();
    draftBase.games[GAME_ID] = game("Static game");
    const base = withComputedRevision(draftBase);
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Legacy local game";
    const patch = diffLibrary(base, local, { changedAt: NOW, transactionId: "legacy-edit" });
    const operation = Object.values(patch.operations)[0];
    const { blobs: _blobs, ...legacyPatch } = patch;
    const legacy = { ...legacyPatch, patchVersion: 1, schemaVersion: 1, operations: { ...patch.operations, [`/collections/${GAME_ID}`]: operation } };
    localStorage.setItem(PATCH_STORAGE_KEY, JSON.stringify(legacy));
    mockStaticDatabase(base);

    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("title")).toHaveTextContent("Legacy local game");
    expect(screen.getByTestId("operations")).toHaveTextContent("1");
    const stored = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as { schemaVersion: number; operations: Record<string, unknown> };
    expect(stored.schemaVersion).toBe(2);
    expect(Object.keys(stored.operations)).toEqual([`/games/${GAME_ID}/title`]);
  });

  it("migrates legacy Base64 blobs into separate localStorage records", async () => {
    const base = empty();
    const prepared = makeExternalWebPAsset(new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80]), 1, 1, "legacy", "legacy.webp");
    const current = structuredClone(base);
    current.assets[prepared.asset.id] = prepared.asset;
    current.games[GAME_ID] = { ...game("Legacy image"), coverAssetId: prepared.asset.id };
    const patch = diffLibrary(base, current, { changedAt: NOW, transactionId: "legacy-blob", blobs: { [prepared.asset.id]: prepared.base64 } });
    localStorage.setItem(PATCH_STORAGE_KEY, JSON.stringify(patch));
    mockStaticDatabase(base);

    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await waitFor(() => expect(screen.getByTestId("local-assets")).toHaveTextContent("1"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).not.toContain(prepared.base64);
    expect((await readLocalAsset(prepared.asset.id))?.byteLength).toBe(prepared.asset.byteLength);
  });

  it("restores a local patch after remount and prunes it once the same value is published", async () => {
    const base = empty();
    const local = structuredClone(base);
    local.games[GAME_ID] = game("Local DuckTales");
    const patch = diffLibrary(base, local, { changedAt: NOW, transactionId: "create-game" });
    expect(savePatch(localStorage, patch).ok).toBe(true);
    mockStaticDatabase(base);

    const first = render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("title")).toHaveTextContent("Local DuckTales");
    expect(screen.getByTestId("operations")).toHaveTextContent("1");
    first.unmount();

    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("title")).toHaveTextContent("Local DuckTales"));
    cleanup();

    const published = withComputedRevision({ ...local, publicationId: "22222222-2222-4222-8222-222222222222" });
    mockStaticDatabase(published);
    render(<LibraryProvider><Probe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await waitFor(() => expect(screen.getByTestId("operations")).toHaveTextContent("0"));
    expect(screen.getByTestId("title")).toHaveTextContent("Local DuckTales");
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBeNull();
  });

  it("keeps the static value visible and blocks ordinary edits until a conflict is resolved", async () => {
    const original = empty();
    original.games[GAME_ID] = game("Original");
    const originalPublished = withComputedRevision(original);
    const local = structuredClone(originalPublished);
    local.games[GAME_ID].title = "Local";
    const patch = diffLibrary(originalPublished, local, { changedAt: NOW, transactionId: "edit-title" });
    expect(savePatch(localStorage, patch).ok).toBe(true);

    const nextStatic = structuredClone(originalPublished);
    nextStatic.games[GAME_ID].title = "Static";
    const published = withComputedRevision(nextStatic);
    mockStaticDatabase(published);
    render(<LibraryProvider><Probe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("conflicts")).toHaveTextContent("1"));
    expect(screen.getByTestId("title")).toHaveTextContent("Static");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    await waitFor(() => expect(screen.getByTestId("mutation-error")).toHaveTextContent("Сначала разрешите конфликты"));
  });
});

describe("LibraryProvider interactive note persistence", () => {
  function databaseWithNote(bodyMarkdown = "Before"): LibraryDatabase {
    const draft = empty();
    draft.games[GAME_ID] = game("Interaction game");
    draft.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown,
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    return withComputedRevision(draft);
  }

  it("keeps useLibrary compatible and persists each click as one distinct undoable transaction", async () => {
    const base = databaseWithNote();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    const setItem = vi.spyOn(localStorage, "setItem");

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    const firstStored = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as ReturnType<typeof diffLibrary>;
    const firstTransaction = firstStored.operations[`/notes/${NOTE_ID}/bodyMarkdown`]?.transactionId;
    expect(setItem.mock.calls.filter(([key]) => key === PATCH_STORAGE_KEY)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Second note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("Second click"));
    const secondStored = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as ReturnType<typeof diffLibrary>;
    const secondTransaction = secondStored.operations[`/notes/${NOTE_ID}/bodyMarkdown`]?.transactionId;
    expect(setItem.mock.calls.filter(([key]) => key === PATCH_STORAGE_KEY)).toHaveLength(2);
    expect(secondTransaction).not.toBe(firstTransaction);

    fireEvent.click(screen.getByRole("button", { name: "Undo note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    expect(screen.getByTestId("interaction-result")).toHaveTextContent("undo:true");
    fireEvent.click(screen.getByRole("button", { name: "Undo note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before"));
    expect(screen.getByTestId("interaction-result")).toHaveTextContent("undo:true");
    fireEvent.click(screen.getByRole("button", { name: "Undo note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("undo:false"));
  });

  it("updates a durable pending-publication remainder without touching the ordinary patch", async () => {
    const source = databaseWithNote("Source");
    const targetDraft = structuredClone(source);
    targetDraft.notes[NOTE_ID].bodyMarkdown = "Published target";
    const target = withComputedRevision(targetDraft);
    const staleOrdinary = diffLibrary(source, source);
    expect(savePatch(localStorage, staleOrdinary).ok).toBe(true);
    const installed = await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null });
    expect(installed.status).toBe("durable");
    const ordinaryRaw = localStorage.getItem(PATCH_STORAGE_KEY);
    mockStaticDatabase(source);

    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    const setItem = vi.spyOn(localStorage, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "First note click" }));

    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    const loaded = loadPendingPublicationJournal(localStorage);
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") throw new Error("Expected durable pending publication");
    expect(loaded.journal.remainderPatch.operations[`/notes/${NOTE_ID}/bodyMarkdown`]).toMatchObject({
      operation: "set",
      value: "First click",
    });
    expect(setItem.mock.calls.filter(([key]) => key === PENDING_PUBLICATION_STORAGE_KEY)).toHaveLength(1);
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBe(ordinaryRaw);
  });

  it("keeps the prior snapshot and undo history when immediate persistence throws", async () => {
    const base = databaseWithNote();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    (localStorage as MemoryStorage).failNextSetFor(PATCH_STORAGE_KEY);

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));

    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("Storage is full"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before");
    expect(screen.getByTestId("interaction-persistence-error")).toHaveTextContent("Storage is full");
    fireEvent.click(screen.getByRole("button", { name: "Undo note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("undo:false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before");
  });

  it("blocks an interaction that overlaps an active conflict without attempting persistence", async () => {
    const base = databaseWithNote();
    const conflictPatch = {
      patchVersion: 2 as const,
      schemaVersion: 2 as const,
      baseRevision: base.revision,
      operations: {
        [`/notes/${NOTE_ID}/bodyMarkdown`]: {
          operation: "set" as const,
          value: "Conflicting local value",
          baseExists: true,
          baseHash: canonicalHash("Outdated base value"),
          changedAt: NOW,
          transactionId: "conflicting-transaction",
        },
      },
      blobs: {},
    };
    localStorage.setItem(PATCH_STORAGE_KEY, JSON.stringify(conflictPatch));
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-conflicts")).toHaveTextContent("1");
    const setItem = vi.spyOn(localStorage, "setItem");

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));

    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("конфликт"));
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before");
  });

  it.each([
    ["ordinary patch", false],
    ["pending journal", true],
  ])("uses only the already-validated fast persistence boundary for an %s interaction", async (_label, pending) => {
    const source = databaseWithNote("Source");
    const targetDraft = structuredClone(source);
    targetDraft.notes[NOTE_ID].bodyMarkdown = "Published target";
    const target = withComputedRevision(targetDraft);
    if (pending) {
      expect((await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null })).status).toBe("durable");
    }
    mockStaticDatabase(source);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    interactionPersistenceControl.fullPatchWrites = 0;
    interactionPersistenceControl.fullJournalWrites = 0;
    interactionPersistenceControl.fastPatchWrites = 0;
    interactionPersistenceControl.fastJournalWrites = 0;

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));

    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    expect(interactionPersistenceControl.fullPatchWrites).toBe(0);
    expect(interactionPersistenceControl.fullJournalWrites).toBe(0);
    expect(interactionPersistenceControl.fastPatchWrites).toBe(pending ? 0 : 1);
    expect(interactionPersistenceControl.fastJournalWrites).toBe(pending ? 1 : 0);
  });

  it("keeps a responsive interaction in the final authority when publication installs its journal concurrently", async () => {
    const base = databaseWithNote();
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local structural title";
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "structural-title" })).ok).toBe(true);
    const targetDraft = structuredClone(local);
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    let resolvePublication!: (value: Awaited<ReturnType<GitHubGitDatabaseSyncClient["publishSourceTree"]>>) => void;
    const publish = vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockImplementation(() => new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    mockStaticDatabase(base);
    const view = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Start structural sync" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    let releaseJournalInstall!: () => void;
    interactionPersistenceControl.holdFullJournalInstall = new Promise<void>((resolve) => { releaseJournalInstall = resolve; });
    const journalInstallStarted = new Promise<void>((resolve) => {
      interactionPersistenceControl.fullJournalInstallStarted = resolve;
    });
    resolvePublication({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    await journalInstallStarted;

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toContain("First click");
    const rescueRaw = localStorage.getItem("my-game-library.note-interaction-rescue.v1");
    expect(rescueRaw).toContain("baseRevision");
    expect(rescueRaw).toContain(base.revision);
    expect(rescueRaw).toContain(NOTE_ID);

    interactionPersistenceControl.holdFullJournalInstall = null;
    releaseJournalInstall();
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("synced"));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("saved"));
    expect(screen.getByTestId("interaction-authority")).toHaveTextContent("valid");
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("First click");
    const loaded = loadPendingPublicationJournal(localStorage);
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") throw new Error("Expected durable pending publication");
    expect(loaded.journal.remainderPatch.operations[`/notes/${NOTE_ID}/bodyMarkdown`]).toMatchObject({
      operation: "set",
      value: "First click",
    });

    view.unmount();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("First click");
  });

  it.each([
    {
      label: "an initial unconfirmed write",
      forcedResults: ["memory_only_after_write"],
      expectedPublication: "synced",
      expectedJournalStatus: "valid",
      expectedTargetCommitSha: CREATED_COMMIT_SHA,
      preserveRemoval: false,
    },
    {
      label: "an initial incompatible changed result",
      forcedResults: ["changed_incompatible"],
      expectedPublication: "несовместим",
      expectedJournalStatus: "valid",
      expectedTargetCommitSha: "7".repeat(40),
      preserveRemoval: false,
    },
    {
      label: "a replacement unreadable changed result",
      forcedResults: ["durable_after_write", "changed_unreadable"],
      expectedPublication: "несовместим",
      expectedJournalStatus: "corrupt",
      expectedTargetCommitSha: null,
      preserveRemoval: false,
    },
    {
      label: "a replacement write whose stale journal cannot be removed",
      forcedResults: ["durable_stale_after_write", "memory_only"],
      expectedPublication: /journal|публикац/i,
      expectedJournalStatus: "valid",
      expectedTargetCommitSha: CREATED_COMMIT_SHA,
      preserveRemoval: true,
    },
    {
      label: "an installer throw after stale bytes were written",
      forcedResults: ["throw_after_write"],
      expectedPublication: "forced installer throw after write",
      expectedJournalStatus: "valid",
      expectedTargetCommitSha: CREATED_COMMIT_SHA,
      preserveRemoval: false,
    },
    {
      label: "a compatible replacement adopted from another tab",
      forcedResults: ["durable_after_write", "changed", "actual"],
      expectedPublication: "synced",
      expectedJournalStatus: "valid",
      expectedTargetCommitSha: CREATED_COMMIT_SHA,
      preserveRemoval: false,
    },
    {
      label: "a stale rescue lineage",
      forcedResults: ["durable_after_write", "changed_without_lineage", "actual"],
      expectedPublication: /journal|публикац/i,
      expectedJournalStatus: "valid",
      expectedTargetCommitSha: CREATED_COMMIT_SHA,
      preserveRemoval: false,
    },
  ] as const)("keeps a successful interaction authoritative after $label and reload", async ({
    forcedResults,
    expectedPublication,
    expectedJournalStatus,
    expectedTargetCommitSha,
    preserveRemoval,
  }) => {
    const base = databaseWithNote();
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local structural title";
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "structural-title" })).ok).toBe(true);
    const targetDraft = structuredClone(local);
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    let resolvePublication!: (value: Awaited<ReturnType<GitHubGitDatabaseSyncClient["publishSourceTree"]>>) => void;
    vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockImplementation(() => new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    mockStaticDatabase(base);
    const view = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Start structural sync" }));
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("syncing"));
    let releaseJournalInstall!: () => void;
    interactionPersistenceControl.holdFullJournalInstall = new Promise<void>((resolve) => { releaseJournalInstall = resolve; });
    const journalInstallStarted = new Promise<void>((resolve) => {
      interactionPersistenceControl.fullJournalInstallStarted = resolve;
    });
    interactionPersistenceControl.forcedFullJournalResults = [...forcedResults];
    resolvePublication({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    await journalInstallStarted;
    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toContain("First click");
    const removeItem = vi.spyOn(localStorage, "removeItem");
    if (preserveRemoval) (localStorage as MemoryStorage).keepNextRemoveFor(PENDING_PUBLICATION_STORAGE_KEY);

    interactionPersistenceControl.holdFullJournalInstall = null;
    releaseJournalInstall();
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).not.toHaveTextContent("syncing"));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("saved"));
    expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent(expectedPublication);
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("First click");
    if (preserveRemoval) {
      expect(removeItem.mock.calls.filter(([key]) => key === PENDING_PUBLICATION_STORAGE_KEY)).toHaveLength(0);
    }

    const persisted = loadPendingPublicationJournal(localStorage);
    expect(persisted.status).toBe(expectedJournalStatus);
    if (persisted.status === "valid") {
      expect(persisted.journal.targetCommitSha).toBe(expectedTargetCommitSha);
    }
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toContain("First click");
    const authorityRescueRaw = localStorage.getItem("my-game-library.note-interaction-rescue.v1");
    expect(authorityRescueRaw).toContain("baseRevision");
    expect(authorityRescueRaw).toContain(base.revision);
    expect(authorityRescueRaw).toContain(NOTE_ID);

    view.unmount();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("First click");
  });

  it("never removes a compatible journal adopted from another tab after a later unconfirmed replacement", async () => {
    const base = databaseWithNote();
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local structural title";
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "structural-title" })).ok).toBe(true);
    const targetDraft = structuredClone(local);
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    let resolvePublication!: (value: Awaited<ReturnType<GitHubGitDatabaseSyncClient["publishSourceTree"]>>) => void;
    vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockImplementation(() => new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    mockStaticDatabase(base);
    const view = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Start structural sync" }));
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("syncing"));
    let releaseJournalInstall!: () => void;
    interactionPersistenceControl.holdFullJournalInstall = new Promise<void>((resolve) => { releaseJournalInstall = resolve; });
    const journalInstallStarted = new Promise<void>((resolve) => {
      interactionPersistenceControl.fullJournalInstallStarted = resolve;
    });
    interactionPersistenceControl.forcedFullJournalResults = ["durable_after_write", "changed", "memory_only"];
    resolvePublication({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    await journalInstallStarted;
    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    const removeItem = vi.spyOn(localStorage, "removeItem");

    interactionPersistenceControl.holdFullJournalInstall = null;
    releaseJournalInstall();
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).not.toHaveTextContent("syncing"));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("saved"));
    expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent(/journal|публикац/i);
    expect(removeItem.mock.calls.filter(([key]) => key === PENDING_PUBLICATION_STORAGE_KEY)).toHaveLength(0);
    expect(loadPendingPublicationJournal(localStorage)).toMatchObject({ status: "valid" });

    view.unmount();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("First click");
  });

  it("recovers a return-to-base interaction whose ordinary patch has no field operation", async () => {
    const base = databaseWithNote();
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local structural title";
    local.notes[NOTE_ID].bodyMarkdown = "First click";
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "published-note" })).ok).toBe(true);
    const targetDraft = structuredClone(local);
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    let resolvePublication!: (value: Awaited<ReturnType<GitHubGitDatabaseSyncClient["publishSourceTree"]>>) => void;
    vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockImplementation(() => new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    mockStaticDatabase(base);
    const view = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click");
    fireEvent.click(screen.getByRole("button", { name: "Start structural sync" }));
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("syncing"));
    let releaseJournalInstall!: () => void;
    interactionPersistenceControl.holdFullJournalInstall = new Promise<void>((resolve) => { releaseJournalInstall = resolve; });
    const journalInstallStarted = new Promise<void>((resolve) => {
      interactionPersistenceControl.fullJournalInstallStarted = resolve;
    });
    interactionPersistenceControl.forcedFullJournalResults = ["memory_only_after_write"];
    resolvePublication({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    await journalInstallStarted;

    fireEvent.click(screen.getByRole("button", { name: "Restore base note" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).not.toContain(`/notes/${NOTE_ID}/bodyMarkdown`);

    interactionPersistenceControl.holdFullJournalInstall = null;
    releaseJournalInstall();
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("synced"));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("saved"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before");
    expect(loadPendingPublicationJournal(localStorage)).toMatchObject({ status: "valid" });

    view.unmount();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("Before");
  });

  it("does not let an absorbed ordinary rescue override a later durable journal interaction", async () => {
    const base = databaseWithNote();
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local structural title";
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "structural-title" })).ok).toBe(true);
    const targetDraft = structuredClone(local);
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    let resolvePublication!: (value: Awaited<ReturnType<GitHubGitDatabaseSyncClient["publishSourceTree"]>>) => void;
    vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockImplementation(() => new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    mockStaticDatabase(base);
    const view = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Start structural sync" }));
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("syncing"));
    let releaseJournalInstall!: () => void;
    interactionPersistenceControl.holdFullJournalInstall = new Promise<void>((resolve) => { releaseJournalInstall = resolve; });
    const journalInstallStarted = new Promise<void>((resolve) => {
      interactionPersistenceControl.fullJournalInstallStarted = resolve;
    });
    resolvePublication({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    await journalInstallStarted;
    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    interactionPersistenceControl.holdFullJournalInstall = null;
    releaseJournalInstall();
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("synced"));

    fireEvent.click(screen.getByRole("button", { name: "Second note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("Second click"));
    const afterSecond = loadPendingPublicationJournal(localStorage);
    expect(afterSecond.status).toBe("valid");
    if (afterSecond.status === "valid") expect(afterSecond.journal.remainderPatch.operations[`/notes/${NOTE_ID}/bodyMarkdown`]).toMatchObject({ value: "Second click" });
    view.unmount();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Second click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("Second click");
  });

  it("keeps the latest fast click after an ordinary click, journal handoff, and full journal transition", async () => {
    const base = databaseWithNote();
    const targetDraft = structuredClone(base);
    targetDraft.notes[NOTE_ID].bodyMarkdown = "First click";
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockResolvedValue({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    mockStaticDatabase(base);
    const view = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    fireEvent.click(screen.getByRole("button", { name: "Start structural sync" }));
    await waitFor(() => expect(screen.getByTestId("interaction-sync-result")).toHaveTextContent("synced"));

    fireEvent.click(screen.getByRole("button", { name: "Move after handoff" }));
    await waitFor(() => expect(screen.getByTestId("interaction-tier")).toHaveTextContent("s"));
    fireEvent.click(screen.getByRole("button", { name: "Second note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("Second click"));

    view.unmount();
    mockStaticDatabase(base);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Second click");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("Second click");
  });

  it("does not reactivate a return-to-base rescue against a different deployed revision", async () => {
    const base = databaseWithNote("Before");
    mockStaticDatabase(base);
    const first = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "First note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("First click"));
    fireEvent.click(screen.getByRole("button", { name: "Restore base note" }));
    await waitFor(() => expect(screen.getByTestId("interaction-body")).toHaveTextContent("Before"));
    first.unmount();

    const deployedDraft = structuredClone(base);
    deployedDraft.notes[NOTE_ID].bodyMarkdown = "New deployed body";
    const deployed = withComputedRevision(deployedDraft);
    mockStaticDatabase(deployed, CREATED_COMMIT_SHA);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("New deployed body");
    expect(screen.getByTestId("interaction-patch-value")).toHaveTextContent("none");
  });

  it("surfaces a thrown journal persistence boundary error without publishing or adding undo", async () => {
    const source = databaseWithNote("Source");
    const targetDraft = structuredClone(source);
    targetDraft.notes[NOTE_ID].bodyMarkdown = "Published target";
    const target = withComputedRevision(targetDraft);
    expect((await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null })).status).toBe("durable");
    mockStaticDatabase(source);
    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    interactionPersistenceControl.throwJournalBoundary = true;

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));

    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("interaction journal boundary failed"));
    expect(screen.getByTestId("interaction-persistence-error")).toHaveTextContent("interaction journal boundary failed");
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Published target");
    interactionPersistenceControl.throwJournalBoundary = false;
    fireEvent.click(screen.getByRole("button", { name: "Undo note click" }));
    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent("undo:false"));
  });

  it("does not resurrect a failed journal interaction after its write succeeds but readback throws", async () => {
    const source = databaseWithNote("Source");
    const targetDraft = structuredClone(source);
    targetDraft.notes[NOTE_ID].bodyMarkdown = "Published target";
    const target = withComputedRevision(targetDraft);
    expect((await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null })).status).toBe("durable");
    mockStaticDatabase(source);
    const first = render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    (localStorage as MemoryStorage).failNextReadAfterSetFor(PENDING_PUBLICATION_STORAGE_KEY);

    fireEvent.click(screen.getByRole("button", { name: "First note click" }));

    await waitFor(() => expect(screen.getByTestId("interaction-result")).toHaveTextContent(/Safari/));
    expect(screen.getByTestId("interaction-persistence-error")).toHaveTextContent(/Safari/);
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Published target");
    first.unmount();

    render(<LibraryProvider><NoteInteractionProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("interaction-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("interaction-body")).toHaveTextContent("Published target");
  });
});

describe("LibraryProvider asset garbage collection", () => {
  it("persists, replaces, and deletes a pending progress icon canonically", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Progress game");
    draft.notes[PROGRESS_NOTE_ID] = {
      id: PROGRESS_NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Progress route",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    mockStaticDatabase(withComputedRevision(draft));
    const firstBytes = new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 69, 66, 80]);
    const secondBytes = new Uint8Array([82, 73, 70, 70, 2, 0, 0, 0, 87, 69, 66, 80]);
    const prepared = (bytes: Uint8Array, name: string) => ({
      clientId: name,
      assetId: sha256Bytes(bytes),
      blob: new Blob([bytes], { type: "image/webp" }),
      mime: "image/webp" as const,
      width: 64,
      height: 64,
      alt: "",
      originalName: `${name}.webp`,
      byteLength: bytes.byteLength,
    });
    const first = prepared(firstBytes, "first-progress");
    const second = prepared(secondBytes, "second-progress");
    render(<LibraryProvider><ProgressAssetProbe icons={[first, second]} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("progress-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Поставить первую иконку прогресса" }));
    await waitFor(() => expect(screen.getByTestId("progress-icon-id")).toHaveTextContent(first.assetId));
    expect(screen.getByTestId("progress-item-id")).toHaveTextContent(PROGRESS_ITEM_ID);
    expect(screen.getByTestId("progress-asset-ids")).toHaveTextContent(first.assetId);
    expect((await readLocalAsset(first.assetId))?.byteLength).toBe(first.byteLength);

    fireEvent.click(screen.getByRole("button", { name: "Заменить иконку прогресса" }));
    await waitFor(() => expect(screen.getByTestId("progress-icon-id")).toHaveTextContent(second.assetId));
    expect(screen.getByTestId("progress-asset-ids")).not.toHaveTextContent(first.assetId);
    await waitFor(async () => expect(await readLocalAsset(first.assetId)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Удалить элемент прогресса" }));
    await waitFor(() => expect(screen.getByTestId("progress-icon-id")).toHaveTextContent("none"));
    expect(screen.getByTestId("progress-canonical")).toHaveTextContent("false");
    await waitFor(async () => expect(await readLocalAsset(second.assetId)).toBeNull());
  });

  it("does not require a Blob after its final note reference is removed", () => {
    const base = empty();
    base.games[GAME_ID] = game("Static game");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const id = sha256Bytes(bytes);
    const withNote = structuredClone(base);
    withNote.assets[id] = { id, kind: "file", mime: "application/octet-stream", byteLength: bytes.byteLength, originalName: "save.dat" };
    withNote.notes[NOTE_ID] = { id: NOTE_ID, gameId: GAME_ID, bodyMarkdown: "Save", attachments: [{ type: "file", assetId: id, label: "Save data" }], rank: 1024, createdAt: NOW, updatedAt: NOW };
    const patch = diffLibrary(base, withNote, { changedAt: NOW, transactionId: "add-save" });
    const withoutNote = structuredClone(withNote);
    delete withoutNote.notes[NOTE_ID];

    expect(requiredLocalAssetIds(patch, withNote)).toEqual([id]);
    expect(requiredLocalAssetIds(patch, withoutNote)).toEqual([]);
  });

  it("deletes an orphaned localStorage file immediately during startup", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const id = sha256Bytes(bytes);
    await writeLocalAssetsAtomic([makeLocalAsset(id, new Blob([bytes]), "application/octet-stream", "local", Date.now())]);
    mockStaticDatabase(empty());

    render(<LibraryProvider><Probe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await waitFor(async () => expect(await readLocalAsset(id)).toBeNull());
    expect(screen.getByTestId("local-assets")).toHaveTextContent("0");
  });

  it("deletes an unreferenced static asset together with its seeded game", async () => {
    const staticAsset = webpAsset(0, "static cover");
    mockStaticDatabase(seededDatabase(staticAsset));
    const unusedBytes = new Uint8Array([82, 73, 70, 70, 9, 0, 0, 0, 87, 69, 66, 80]);
    render(<LibraryProvider><AssetProbe localCover={{ clientId: "unused", assetId: sha256Bytes(unusedBytes), blob: new Blob([unusedBytes]), mime: "image/webp", width: 1, height: 1, alt: "", originalName: "unused.webp", byteLength: unusedBytes.byteLength }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("asset-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить seeded game" }));

    await waitFor(() => expect(screen.getByTestId("asset-game-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("asset-ids")).not.toHaveTextContent(staticAsset.id);
    expect(screen.getByTestId("asset-operation-paths")).toHaveTextContent(`/assets/${staticAsset.id}`);
  });

  it("collects both replaced static covers and newly unused local covers", async () => {
    const staticAsset = webpAsset(0, "static cover");
    const localAsset = webpAsset(1, "local cover");
    const localBytes = new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 69, 66, 80]);
    mockStaticDatabase(seededDatabase(staticAsset));
    render(<LibraryProvider><AssetProbe localCover={{ clientId: "local", assetId: localAsset.id, blob: new Blob([localBytes], { type: "image/webp" }), mime: "image/webp", width: 1, height: 1, alt: localAsset.alt, originalName: localAsset.originalName, byteLength: localBytes.byteLength }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("asset-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Поставить локальную обложку" }));
    await waitFor(() => expect(screen.getByTestId("asset-cover-id")).toHaveTextContent(localAsset.id));
    expect(screen.getByTestId("asset-ids")).not.toHaveTextContent(staticAsset.id);
    expect(screen.getByTestId("asset-ids")).toHaveTextContent(localAsset.id);

    fireEvent.click(screen.getByRole("button", { name: "Убрать обложку" }));
    await waitFor(() => expect(screen.getByTestId("asset-cover-id")).toHaveTextContent("none"));
    expect(screen.getByTestId("asset-ids")).not.toHaveTextContent(staticAsset.id);
    expect(screen.getByTestId("asset-ids")).not.toHaveTextContent(localAsset.id);
    expect(screen.getByTestId("asset-operation-paths")).not.toHaveTextContent(`/assets/${localAsset.id}`);
    expect(screen.getByTestId("asset-operation-paths")).toHaveTextContent(`/assets/${staticAsset.id}`);
  });

  it("stores file bytes separately in localStorage and deletes them after the final reference", async () => {
    const draft = empty(); draft.games[GAME_ID] = game("Static game");
    mockStaticDatabase(withComputedRevision(draft));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const assetId = sha256Bytes(bytes);
    render(<LibraryProvider><FileProbe preparedFile={{ clientId: "file", assetId, mime: "application/octet-stream", blob: new Blob([bytes]), originalName: "save.dat", byteLength: bytes.byteLength }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("file-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    await waitFor(() => expect(screen.getByTestId("file-kind")).toHaveTextContent("file"));
    expect(screen.getByTestId("file-blob-count")).toHaveTextContent("1");
    expect(screen.getByTestId("file-url")).toHaveTextContent("blob:");
    const stored = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as { patchVersion: number; blobs: Record<string, string>; operations: Record<string, { value?: unknown }> };
    expect(stored.patchVersion).toBe(2);
    expect(stored.blobs).toEqual({});
    expect(JSON.stringify(stored.operations)).not.toContain("AQIDBA==");
    expect(localStorage.getItem(localAssetDataKey(assetId))).not.toBe("AQIDBA==");
    expect(new Uint8Array(await (await readLocalAsset(assetId))!.blob.arrayBuffer())).toEqual(bytes);

    fireEvent.click(screen.getByRole("button", { name: "Удалить файл" }));
    await waitFor(() => expect(screen.getByTestId("file-kind")).toHaveTextContent("none"));
    await waitFor(() => expect(screen.getByTestId("file-blob-count")).toHaveTextContent("0"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(localAssetDataKey(assetId))).toBeNull();
  });
});

describe.skip("legacy aggregate GitHub synchronization", () => {
  function localTitlePatch(base: LibraryDatabase) {
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local title";
    return diffLibrary(base, local, { changedAt: "2026-07-17T10:00:00.000Z", transactionId: "sync-title" });
  }

  function localTitleAndPlacementPatch(base: LibraryDatabase) {
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local title";
    local.games[GAME_ID].placement = { tierId: "b", rank: 1024 };
    return diffLibrary(base, local, { changedAt: "2026-07-17T10:00:00.000Z", transactionId: "sync-title-placement" });
  }

  async function prepareLocalCoverPatch(base: LibraryDatabase, marker: number, deferred: "title" | "placement") {
    const bytes = new Uint8Array([82, 73, 70, 70, marker, 0, 0, 0, 87, 69, 66, 80]);
    const cover = makeExternalWebPAsset(bytes, 1, 1, "Selected cover", "selected.webp").asset;
    const local = structuredClone(base);
    local.assets[cover.id] = cover;
    local.games[GAME_ID].coverAssetId = cover.id;
    if (deferred === "title") local.games[GAME_ID].title = "Deferred title";
    else local.games[GAME_ID].placement = { tierId: "b", rank: 1024 };
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: `selected-cover-${deferred}` })).ok).toBe(true);
    await writeLocalAssetsAtomic([makeLocalAsset(cover.id, new Blob([bytes], { type: "image/webp" }), "image/webp")]);
    return cover;
  }

  function committedTitleDatabase(base: LibraryDatabase) {
    const committed = structuredClone(base);
    committed.games[GAME_ID].title = "Committed title";
    committed.publicationId = "33333333-3333-4333-8333-333333333333";
    return withComputedRevision(committed);
  }

  function pendingReceipt(source: LibraryDatabase, database: LibraryDatabase): PendingPublicationReceipt {
    return {
      version: 1,
      owner: "kana-sama",
      repo: "mygameslist",
      branch: "main",
      sourceRevision: source.revision,
      commitSha: CREATED_COMMIT_SHA,
      createdAt: "2026-07-17T10:01:00.000Z",
      database,
      blobs: {},
    };
  }

  function placementPatch(base: LibraryDatabase) {
    const local = structuredClone(base);
    local.games[GAME_ID].placement = { tierId: "s", rank: 1024 };
    return diffLibrary(base, local, { changedAt: "2026-07-17T10:02:00.000Z", transactionId: "post-click-tier" });
  }

  it("connects an empty device through a temporary branch without changing main", async () => {
    const base = empty();
    const api = githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-operations")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("connected"));
    const writes = api.requests.filter(({ url, method }) => url.origin === "https://api.github.com" && method !== "GET");
    expect(writes.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
      "POST /repos/kana-sama/mygameslist/git/commits",
      "POST /repos/kana-sama/mygameslist/git/refs",
      expect.stringMatching(/^DELETE \/repos\/kana-sama\/mygameslist\/git\/refs\/heads\/mylib-pat-check\/[0-9a-f-]{36}$/),
    ]);
    expect(writes[1].body?.ref).toMatch(/^refs\/heads\/mylib-pat-check\/[0-9a-f-]{36}$/);
    expect(writes.some(({ url }) => url.pathname.endsWith("/heads/main"))).toBe(false);
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBeNull();
  });

  it("reloads against the pending committed database while Pages still serves the source revision", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    const remaining = placementPatch(committed);
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, JSON.stringify(pendingReceipt(source, committed)));
    expect(savePatch(localStorage, remaining).ok).toBe(true);
    mockStaticDatabase(source);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Committed title");
    expect(screen.getByTestId("sync-tier")).toHaveTextContent("s");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("0");
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(screen.getByTestId("sync-source-commit-sha")).not.toHaveTextContent(CREATED_COMMIT_SHA);
  });

  it("adopts provenance from the deployed envelope when polling confirms the target", async () => {
    vi.useFakeTimers();
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, JSON.stringify(pendingReceipt(source, committed)));
    mockStaticSequence(
      { sourceCommitSha: HEAD_SHA, database: source },
      { sourceCommitSha: CREATED_COMMIT_SHA, database: committed },
    );

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(CREATED_COMMIT_SHA);
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("false");
  });

  it("retains deployed provenance when a polled envelope is rejected", async () => {
    vi.useFakeTimers();
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, JSON.stringify(pendingReceipt(source, committed)));
    mockStaticSequence(
      { sourceCommitSha: HEAD_SHA, database: source },
      { sourceCommitSha: "INVALID", database: committed },
    );

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
  });

  it("keeps the pending base across an intermediate Pages deployment", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    const intermediateDraft = structuredClone(source);
    intermediateDraft.games[GAME_ID].tags = ["intermediate"];
    intermediateDraft.publicationId = "44444444-4444-4444-8444-444444444444";
    const intermediate = withComputedRevision(intermediateDraft);
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, JSON.stringify(pendingReceipt(source, committed)));
    localStorage.setItem(GITHUB_PAT_STORAGE_KEY, GITHUB_TOKEN);
    githubResponses(intermediate, committed);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Committed title");
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).not.toBeNull();
  });

  it("adopts a leapfrogged Pages deployment once it is also the current GitHub head", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    const latestDraft = structuredClone(committed);
    latestDraft.games[GAME_ID].tags = ["newer-commit"];
    latestDraft.publicationId = "55555555-5555-4555-8555-555555555555";
    const latest = withComputedRevision(latestDraft);
    const remaining = placementPatch(committed);
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, JSON.stringify(pendingReceipt(source, committed)));
    expect(savePatch(localStorage, remaining).ok).toBe(true);
    localStorage.setItem(GITHUB_PAT_STORAGE_KEY, GITHUB_TOKEN);
    githubResponses(latest, latest);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Committed title");
    expect(screen.getByTestId("sync-tier")).toHaveTextContent("s");
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("false");
    expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("0");
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).toBeNull();
  });

  it.each([
    { label: "with a remaining patch", keepPlacementPatch: true },
    { label: "with an empty remaining patch", keepPlacementPatch: false },
  ])("adopts another tab's pending database $label", async ({ keepPlacementPatch }) => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    mockStaticDatabase(source);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Static title");

    const remaining = keepPlacementPatch
      ? placementPatch(committed)
      : diffLibrary(committed, committed, { changedAt: "2026-07-17T10:02:00.000Z", transactionId: "empty-post-click" });
    expect(installPendingPublication(localStorage, pendingReceipt(source, committed), remaining)).toEqual({ ok: true });
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_PUBLICATION_STORAGE_KEY }));

    await waitFor(() => expect(screen.getByTestId("sync-pending")).toHaveTextContent("true"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Committed title");
    expect(screen.getByTestId("sync-tier")).toHaveTextContent(keepPlacementPatch ? "s" : "a");
    expect(screen.getByTestId("sync-operations").textContent).toBe(keepPlacementPatch ? `/games/${GAME_ID}/placement` : "");
    expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("0");
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
  });

  it("applies a storage event dispatched before post-load effects can subscribe", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const committed = committedTitleDatabase(source);
    const remaining = diffLibrary(committed, committed, { changedAt: "2026-07-17T10:02:00.000Z", transactionId: "queued-empty-patch" });
    mockStaticDatabase(source);

    render(<LibraryProvider><StorageEventOnLoadedProbe onLoaded={() => {
      installPendingPublication(localStorage, pendingReceipt(source, committed), remaining);
      window.dispatchEvent(new StorageEvent("storage", { key: PENDING_PUBLICATION_STORAGE_KEY }));
    }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("queued-sync-loading")).toHaveTextContent("false"));
    await waitFor(() => expect(screen.getByTestId("queued-sync-pending")).toHaveTextContent("true"));
    expect(screen.getByTestId("queued-sync-title")).toHaveTextContent("Committed title");
    expect(screen.getByTestId("queued-sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
  });

  it("commits the snapshot, switches to the committed base, and keeps only edits made after click", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitlePatch(base)).ok).toBe(true);
    const api = githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Local title");

    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit after click" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Local title");
    expect(screen.getByTestId("sync-tier")).toHaveTextContent("s");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/games/${GAME_ID}/title`);
    expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("0");
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(HEAD_SHA);
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).not.toBeNull();
    const storedPatch = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as { operations: Record<string, unknown> };
    expect(Object.keys(storedPatch.operations)).toEqual([`/games/${GAME_ID}/placement`]);

    const refUpdate = api.requests.find((request) => request.method === "PATCH");
    expect(refUpdate?.body).toEqual({ sha: CREATED_COMMIT_SHA, force: false });
    const treeUpdate = api.requests.find((request) => request.method === "POST" && request.url.pathname.endsWith("/git/trees"));
    expect(treeUpdate?.body).toMatchObject({
      base_tree: TREE_SHA,
      tree: [{ path: "public/data/library.json", mode: "100644", type: "blob", sha: CREATED_LIBRARY_BLOB_SHA }],
    });
  });

  it("publishes only selected paths and keeps deferred plus post-click edits", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    draft.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Static note",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitleAndPlacementPatch(base)).ok).toBe(true);
    const api = githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));

    fireEvent.click(screen.getByRole("button", { name: "Sync selected title" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit after click" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit note after click" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    const published = publishedLibraryFromRequest(api.requests);
    expect(published.games[GAME_ID].title).toBe("Local title");
    expect(published.games[GAME_ID].placement.tierId).toBe("a");
    expect(published.notes[NOTE_ID].bodyMarkdown).toBe("Static note");
    expect(screen.getByTestId("sync-tier")).toHaveTextContent("s");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/notes/${NOTE_ID}/bodyMarkdown`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/games/${GAME_ID}/title`);
  });

  it("treats an empty selected path list as a full sync", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitleAndPlacementPatch(base)).ok).toBe(true);
    const api = githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync empty selection" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(publishedLibraryFromRequest(api.requests).games[GAME_ID]).toMatchObject({
      title: "Local title",
      placement: { tierId: "b", rank: 1024 },
    });
    expect(screen.getByTestId("sync-operations")).toBeEmptyDOMElement();
  });

  it("rejects an invalid selection before asset state changes or GitHub requests", async () => {
    const base = empty();
    const bytes = new Uint8Array([82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80]);
    const cover = makeExternalWebPAsset(bytes, 1, 1, "Cover", "cover.webp").asset;
    const local = structuredClone(base);
    local.assets[cover.id] = cover;
    local.games[GAME_ID] = game("New game", cover.id);
    const patch = diffLibrary(base, local, { changedAt: NOW, transactionId: "new-game" });
    expect(savePatch(localStorage, patch).ok).toBe(true);
    await writeLocalAssetsAtomic([makeLocalAsset(cover.id, new Blob([bytes], { type: "image/webp" }), "image/webp")]);
    const api = githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync invalid selection" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("не найдена"));
    expect(screen.getByTestId("sync-operations").textContent?.split(",").sort()).toEqual(Object.keys(patch.operations).sort());
    expect(await readLocalAsset(cover.id)).toMatchObject({ state: "local" });
    expect(api.requests.filter(({ url }) => url.origin === "https://api.github.com")).toEqual([]);
  });

  it("moves only assets required by the selected patch to awaiting verification", async () => {
    const base = empty();
    const firstBytes = new Uint8Array([82, 73, 70, 70, 21, 0, 0, 0, 87, 69, 66, 80]);
    const secondBytes = new Uint8Array([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80]);
    const firstCover = makeExternalWebPAsset(firstBytes, 1, 1, "First", "first.webp").asset;
    const secondCover = makeExternalWebPAsset(secondBytes, 1, 1, "Second", "second.webp").asset;
    const local = structuredClone(base);
    local.assets[firstCover.id] = firstCover;
    local.assets[secondCover.id] = secondCover;
    local.games[GAME_ID] = game("First game", firstCover.id);
    local.games[SECOND_GAME_ID] = { ...game("Second game", secondCover.id), id: SECOND_GAME_ID };
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "two-games" })).ok).toBe(true);
    await writeLocalAssetsAtomic([
      makeLocalAsset(firstCover.id, new Blob([firstBytes], { type: "image/webp" }), "image/webp"),
      makeLocalAsset(secondCover.id, new Blob([secondBytes], { type: "image/webp" }), "image/webp"),
    ]);
    const api = githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync selected game" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(publishedLibraryFromRequest(api.requests).games).toEqual({ [GAME_ID]: expect.objectContaining({ title: "First game" }) });
    expect(await readLocalAsset(firstCover.id)).toMatchObject({ state: "awaiting-verification" });
    expect(await readLocalAsset(secondCover.id)).toMatchObject({ state: "local" });
  });

  it("keeps the accepted base and merged remainder in memory when receipt persistence fails", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    draft.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Static note",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitleAndPlacementPatch(base)).ok).toBe(true);
    githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    (localStorage as MemoryStorage).failNextSetFor(PENDING_PUBLICATION_STORAGE_KEY);
    fireEvent.click(screen.getByRole("button", { name: "Sync selected title" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit note after click" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(screen.getByTestId("sync-persistence-error")).toHaveTextContent("Коммит уже создан");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/notes/${NOTE_ID}/bodyMarkdown`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/games/${GAME_ID}/title`);
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
  });

  it("installs the accepted base and deferred remainder when the post-acceptance asset transition fails", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    const cover = await prepareLocalCoverPatch(base, 30, "title");
    const api = githubResponses(base);
    (localStorage as MemoryStorage).failNextMatchingSet((key, value) => key === `${LOCAL_ASSET_METADATA_PREFIX}${cover.id}`
      && value.includes('"state":"awaiting-verification"'));

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync selected cover" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("Storage is full"));
    expect(publishedLibraryFromRequest(api.requests).games[GAME_ID].coverAssetId).toBe(cover.id);
    expect(screen.getByTestId("sync-cover-id")).toHaveTextContent(cover.id);
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Deferred title");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/title`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/games/${GAME_ID}/coverAssetId`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/assets/${cover.id}`);
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    const storedPatch = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as { operations: Record<string, unknown> };
    expect(Object.keys(storedPatch.operations)).toEqual([`/games/${GAME_ID}/title`]);
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).not.toBeNull();
  });

  it("keeps an edit made while the post-acceptance asset transition is awaiting", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    const cover = await prepareLocalCoverPatch(base, 31, "placement");
    githubResponses(base);
    let releaseAwaiting!: () => void;
    let markAwaitingStarted!: () => void;
    const awaitingStarted = new Promise<void>((resolve) => { markAwaitingStarted = resolve; });
    const awaitingGate = new Promise<void>((resolve) => { releaseAwaiting = resolve; });
    localAssetStateControl.afterUpdate = async (state) => {
      if (state !== "awaiting-verification") return;
      markAwaitingStarted();
      await awaitingGate;
    };

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sync selected cover" }));
      await awaitingStarted;
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit after click" }));
    await act(async () => {
      releaseAwaiting();
      await awaitingGate;
    });

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(screen.getByTestId("sync-cover-id")).toHaveTextContent(cover.id);
    expect(screen.getByTestId("sync-tier")).toHaveTextContent("s");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/games/${GAME_ID}/coverAssetId`);
    expect(screen.getByTestId("sync-operations")).not.toHaveTextContent(`/assets/${cover.id}`);
    const storedPatch = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as { operations: Record<string, { value?: unknown }> };
    expect(storedPatch.operations[`/games/${GAME_ID}/placement`].value).toEqual({ tierId: "s", rank: 1024 });
  });

  it("keeps a remote conflict when a same-path post-click edit started from the deferred value", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitleAndPlacementPatch(base)).ok).toBe(true);
    const remoteDraft = structuredClone(base);
    remoteDraft.games[GAME_ID].placement = { tierId: "c", rank: 1024 };
    remoteDraft.publicationId = "77777777-7777-4777-8777-777777777777";
    const remote = withComputedRevision(remoteDraft);
    githubResponses(base, remote);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync selected title" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit after click" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(screen.getByTestId("sync-tier")).toHaveTextContent("c");
    expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("1");
    expect(screen.getByTestId("sync-operations")).toHaveTextContent(`/games/${GAME_ID}/placement`);
  });

  it("keeps new cover and note image Blob URLs until Pages deploys the commit", async () => {
    const base = empty();
    const coverBytes = new Uint8Array([82, 73, 70, 70, 10, 0, 0, 0, 87, 69, 66, 80]);
    const noteBytes = new Uint8Array([82, 73, 70, 70, 11, 0, 0, 0, 87, 69, 66, 80]);
    const cover = makeExternalWebPAsset(coverBytes, 1, 1, "Cover", "cover.webp").asset;
    const image = makeExternalWebPAsset(noteBytes, 1, 1, "Note", "note.webp").asset;
    const local = structuredClone(base);
    local.assets[cover.id] = cover;
    local.assets[image.id] = image;
    local.games[GAME_ID] = game("New game", cover.id);
    local.notes[NOTE_ID] = {
      id: NOTE_ID,
      gameId: GAME_ID,
      bodyMarkdown: "Guide",
      attachments: [{ type: "image", assetId: image.id, alt: "Note" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "new-game-media" })).ok).toBe(true);
    await writeLocalAssetsAtomic([
      makeLocalAsset(cover.id, new Blob([coverBytes], { type: "image/webp" }), "image/webp"),
      makeLocalAsset(image.id, new Blob([noteBytes], { type: "image/webp" }), "image/webp"),
    ]);
    githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-asset-urls").textContent?.split(",")).toEqual([expect.stringMatching(/^blob:/), expect.stringMatching(/^blob:/)]);
    const urlsBeforeSync = screen.getByTestId("sync-asset-urls").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(screen.getByTestId("sync-asset-urls")).toHaveTextContent(urlsBeforeSync ?? "");
    expect(screen.getByTestId("sync-local-states")).toHaveTextContent("awaiting-verification");
    expect(await readLocalAsset(cover.id)).toMatchObject({ state: "awaiting-verification" });
    expect(await readLocalAsset(image.id)).toMatchObject({ state: "awaiting-verification" });
  });

  it("names a missing localStorage file and the game that must be repaired", async () => {
    const base = empty();
    const missing = webpAsset(12, "missing cover");
    const local = structuredClone(base);
    local.assets[missing.id] = missing;
    local.games[GAME_ID] = game("Game with missing cover", missing.id);
    expect(savePatch(localStorage, diffLibrary(base, local, { changedAt: NOW, transactionId: "missing-cover" })).ok).toBe(true);
    githubResponses(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("missing cover.webp"));
    expect(screen.getByTestId("sync-result")).toHaveTextContent(`asset ${missing.id}`);
    expect(screen.getByTestId("sync-result")).toHaveTextContent("обложка игры «Game with missing cover»");
    expect(screen.getByTestId("sync-result")).toHaveTextContent("загрузите исходные файлы заново");
  });

  it("installs remote same-field conflicts before creating Git objects", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitlePatch(base)).ok).toBe(true);
    const remoteDraft = structuredClone(base);
    remoteDraft.games[GAME_ID].title = "Remote title";
    remoteDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const remote = withComputedRevision(remoteDraft);
    const api = githubResponses(base, remote);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));

    await waitFor(() => expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("1"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Remote title");
    expect(screen.getByTestId("sync-result")).toHaveTextContent("Разрешите появившиеся конфликты");
    expect(api.requests.every((request) => request.method === "GET")).toBe(true);
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).not.toBeNull();
  });

  it("keeps remote conflicts visible when Safari rejects the pending-publication transaction", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitlePatch(base)).ok).toBe(true);
    const remoteDraft = structuredClone(base);
    remoteDraft.games[GAME_ID].title = "Remote title";
    remoteDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const remote = withComputedRevision(remoteDraft);
    githubResponses(base, remote);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    (localStorage as MemoryStorage).failNextSet();
    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));

    await waitFor(() => expect(screen.getByTestId("sync-conflicts")).toHaveTextContent("1"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Remote title");
    expect(screen.getByTestId("sync-result")).toHaveTextContent("Разрешите появившиеся конфликты");
    expect(screen.getByTestId("sync-persistence-error")).toHaveTextContent("Конфликты сохранятся только до перезагрузки");
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).not.toBeNull();
  });
});

describe("LibraryProvider v3 source-tree publication", () => {
  function localTitlePatch(base: LibraryDatabase) {
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local title";
    return diffLibrary(base, local, { changedAt: NOW, transactionId: "v3-title" });
  }

  it("publishes the frozen source patch and durably blocks a second publication", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    const patch = localTitlePatch(base);
    expect(savePatch(localStorage, patch).ok).toBe(true);
    const targetDraft = structuredClone(base);
    targetDraft.games[GAME_ID].title = "Local title";
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    const publish = vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockResolvedValue({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });
    mockStaticDatabase(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("committed"));
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Local title");
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({
      deployed: { sourceCommitSha: HEAD_SHA, database: { revision: base.revision } },
      selectedPatch: { baseRevision: base.revision },
    });
    expect(loadPendingPublicationJournal(localStorage)).toMatchObject({
      status: "valid",
      journal: { targetCommitSha: CREATED_COMMIT_SHA, targetRevision: target.revision },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));
    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("Предыдущая публикация ещё не завершена"));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("finalizes an exact deployed target before clearing verified publication state", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const source = withComputedRevision(draft);
    const targetDraft = structuredClone(source);
    targetDraft.games[GAME_ID].title = "Published title";
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    const journal = pendingJournal(target);
    expect((await installPendingPublicationJournal(localStorage, journal, { expectedRaw: null })).status).toBe("durable");
    mockStaticDatabase(source, HEAD_SHA);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    mockStaticDatabase(target, CREATED_COMMIT_SHA);
    fireEvent.click(screen.getByRole("button", { name: "Retry publication check" }));

    await waitFor(() => expect(screen.getByTestId("sync-pending")).toHaveTextContent("false"));
    expect(screen.getByTestId("sync-source-commit-sha")).toHaveTextContent(CREATED_COMMIT_SHA);
    expect(screen.getByTestId("sync-title")).toHaveTextContent("Published title");
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).toBeNull();
  });

  it("requires export and then discards an exact recovery journal without reviving the old patch", async () => {
    const target = empty();
    const descendantDraft = structuredClone(target);
    descendantDraft.publicationId = "44444444-4444-4444-8444-444444444444";
    const descendant = withComputedRevision(descendantDraft);
    const recovery: PendingPublicationJournalV3 = {
      ...pendingJournal(target, diffLibrary(descendant, descendant)),
      phase: "recovery-required",
    };
    expect((await installPendingPublicationJournal(localStorage, recovery, {
      expectedRaw: null,
      recoveryBaseDatabase: descendant,
    })).status).toBe("durable");
    mockStaticDatabase(descendant, "9".repeat(40));
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:recovery"),
      revokeObjectURL: vi.fn(),
    }));

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Export publication recovery" }));
    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("exported"));
    fireEvent.click(screen.getByRole("button", { name: "Discard publication recovery" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("discarded"));
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("false");
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBeNull();
  });

  it("does not finalize a recovery journal when Pages still serves the original target", async () => {
    const target = empty();
    const descendantDraft = structuredClone(target);
    descendantDraft.publicationId = "44444444-4444-4444-8444-444444444444";
    const descendant = withComputedRevision(descendantDraft);
    const recovery: PendingPublicationJournalV3 = {
      ...pendingJournal(target, diffLibrary(descendant, descendant)),
      phase: "recovery-required",
    };
    expect((await installPendingPublicationJournal(localStorage, recovery, {
      expectedRaw: null,
      recoveryBaseDatabase: descendant,
    })).status).toBe("durable");
    mockStaticDatabase(descendant, "9".repeat(40));

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    mockStaticDatabase(target, CREATED_COMMIT_SHA);
    fireEvent.click(screen.getByRole("button", { name: "Retry publication check" }));

    await waitFor(() => expect(screen.getByTestId("sync-publication-check")).toHaveTextContent("unverifiable"));
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(loadPendingPublicationJournal(localStorage)).toMatchObject({
      status: "valid",
      journal: { phase: "recovery-required" },
    });
  });

  it("serializes edits made while source publication is in flight into the durable remainder", async () => {
    const draft = empty();
    draft.games[GAME_ID] = game("Static title");
    const base = withComputedRevision(draft);
    expect(savePatch(localStorage, localTitlePatch(base)).ok).toBe(true);
    const targetDraft = structuredClone(base);
    targetDraft.games[GAME_ID].title = "Local title";
    targetDraft.publicationId = "33333333-3333-4333-8333-333333333333";
    const target = withComputedRevision(targetDraft);
    let resolvePublication!: (value: Awaited<ReturnType<GitHubGitDatabaseSyncClient["publishSourceTree"]>>) => void;
    const publish = vi.spyOn(GitHubGitDatabaseSyncClient.prototype, "publishSourceTree").mockImplementation(() => new Promise((resolve) => {
      resolvePublication = resolve;
    }));
    mockStaticDatabase(base);

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Sync GitHub" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Edit after click" }));
    resolvePublication({
      status: "published",
      sourceCommitSha: HEAD_SHA,
      targetCommitSha: CREATED_COMMIT_SHA,
      database: target,
      uploadedLocalAssetIds: [],
      lostResponseConfirmed: false,
    });

    await waitFor(() => expect(screen.getByTestId("sync-tier")).toHaveTextContent("s"));
    const loaded = loadPendingPublicationJournal(localStorage);
    expect(loaded).toMatchObject({ status: "valid" });
    if (loaded.status !== "valid") throw new Error("Expected durable journal");
    expect(Object.keys(loaded.journal.remainderPatch.operations)).toContain(`/games/${GAME_ID}/placement`);
  });

  it("keeps recovery authority when Safari silently retains the old ordinary patch", async () => {
    const targetDraft = empty();
    targetDraft.games[GAME_ID] = game("Published title");
    const target = withComputedRevision(targetDraft);
    const descendantDraft = structuredClone(target);
    descendantDraft.publicationId = "44444444-4444-4444-8444-444444444444";
    const descendant = withComputedRevision(descendantDraft);
    const recovery: PendingPublicationJournalV3 = {
      ...pendingJournal(target, diffLibrary(descendant, descendant)),
      phase: "recovery-required",
    };
    expect((await installPendingPublicationJournal(localStorage, recovery, {
      expectedRaw: null,
      recoveryBaseDatabase: descendant,
    })).status).toBe("durable");
    const oldEffectiveDraft = structuredClone(descendant);
    oldEffectiveDraft.games[GAME_ID].title = "Old local title";
    const oldPatch = diffLibrary(descendant, withComputedRevision(oldEffectiveDraft));
    expect(savePatch(localStorage, oldPatch).ok).toBe(true);
    mockStaticDatabase(descendant, "9".repeat(40));
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:recovery"),
      revokeObjectURL: vi.fn(),
    }));

    render(<LibraryProvider><GitHubSyncProbe /></LibraryProvider>);
    await waitFor(() => expect(screen.getByTestId("sync-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Export publication recovery" }));
    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("exported"));
    (localStorage as MemoryStorage).keepNextRemoveFor(PATCH_STORAGE_KEY);
    fireEvent.click(screen.getByRole("button", { name: "Discard publication recovery" }));

    await waitFor(() => expect(screen.getByTestId("sync-result")).toHaveTextContent("Safari не подтвердил удаление"));
    expect(screen.getByTestId("sync-pending")).toHaveTextContent("true");
    expect(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)).not.toBeNull();
  });

  it("promotes memory-only recovery over its durable predecessor before discard", async () => {
    const targetDraft = empty();
    targetDraft.games[GAME_ID] = game("Published title");
    const target = withComputedRevision(targetDraft);
    const awaiting = await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null });
    if (awaiting.status !== "durable") throw new Error("Expected durable predecessor");
    const descendantDraft = structuredClone(target);
    descendantDraft.games[GAME_ID].title = "Remote title";
    descendantDraft.publicationId = "44444444-4444-4444-8444-444444444444";
    const descendant = withComputedRevision(descendantDraft);
    const resolvedDraft = structuredClone(descendant);
    resolvedDraft.games[GAME_ID].title = "Resolved locally";
    const recoveryJournal: PendingPublicationJournalV3 = {
      ...pendingJournal(target, diffLibrary(descendant, withComputedRevision(resolvedDraft))),
      phase: "recovery-required",
    };
    const promoted = await promoteMemoryOnlyPublicationForDiscard(localStorage, {
      status: "valid",
      durability: "memory-only",
      journal: recoveryJournal,
      raw: null,
      expectedRaw: awaiting.raw,
      recoveryBase: { sourceCommitSha: "9".repeat(40), database: descendant },
      check: null,
      exportCompleted: true,
    });

    expect(promoted).toMatchObject({ status: "durable", journal: { phase: "recovery-required" } });
    expect(loadPendingPublicationJournal(localStorage)).toMatchObject({ status: "valid", journal: { phase: "recovery-required" } });
  });

  it("refuses to replace a cross-tab durable journal from memory-only recovery", async () => {
    const target = empty();
    expect((await installPendingPublicationJournal(localStorage, pendingJournal(target), { expectedRaw: null })).status).toBe("durable");
    const recoveryJournal: PendingPublicationJournalV3 = {
      ...pendingJournal(target),
      phase: "recovery-required",
    };
    const result = await promoteMemoryOnlyPublicationForDiscard(localStorage, {
      status: "valid",
      durability: "memory-only",
      journal: recoveryJournal,
      raw: null,
      expectedRaw: null,
      recoveryBase: { sourceCommitSha: "9".repeat(40), database: target },
      check: null,
      exportCompleted: true,
    });

    expect(result).toMatchObject({ status: "changed" });
    expect(loadPendingPublicationJournal(localStorage)).toMatchObject({ status: "valid", journal: { phase: "awaiting-deployment" } });
  });
});
