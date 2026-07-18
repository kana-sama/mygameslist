import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCH_STORAGE_KEY,
  bytesToBase64,
  diffLibrary,
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
import { LibraryProvider, useLibrary } from "../src/state/LibraryContext";
import {
  PENDING_PUBLICATION_STORAGE_KEY,
  installPendingPublication,
  type PendingPublicationReceipt,
} from "../src/state/pendingPublication";
import { GITHUB_PAT_STORAGE_KEY } from "../src/state/githubPat";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-16T10:00:00.000Z";
const GITHUB_TOKEN = "github_pat_test-only";
const HEAD_SHA = "1".repeat(40);
const TREE_SHA = "2".repeat(40);
const LIBRARY_BLOB_SHA = "3".repeat(40);
const CREATED_LIBRARY_BLOB_SHA = "4".repeat(40);
const CREATED_TREE_SHA = "5".repeat(40);
const CREATED_COMMIT_SHA = "6".repeat(40);

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  private setFailures = 0;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  failNextSet() { this.setFailures += 1; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.setFailures > 0) {
      this.setFailures -= 1;
      throw new DOMException("Storage is full", "QuotaExceededError");
    }
    this.values.set(key, value);
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
  return withComputedRevision({ schemaVersion: 2, revision: "", publicationId: null, games: {}, notes: {}, assets: {} });
}

function mockStaticDatabase(database: LibraryDatabase) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => structuredClone(database),
  }));
}

function Probe() {
  const library = useLibrary();
  return <div>
    <span data-testid="loading">{String(library.loading)}</span>
    <span data-testid="title">{Object.values(library.effective.games)[0]?.title ?? "empty"}</span>
    <span data-testid="operations">{Object.keys(library.patch.operations).length}</span>
    <span data-testid="conflicts">{library.conflicts.length}</span>
    <span data-testid="local-assets">{library.localAssets.length}</span>
    <button onClick={() => {
      try { library.moveGame(GAME_ID, "s", 0); }
      catch (error) { (document.querySelector("[data-testid='mutation-error']") as HTMLElement).textContent = error instanceof Error ? error.message : String(error); }
    }} type="button">Изменить</button>
    <span data-testid="mutation-error" />
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
        notes: [{ id: currentNote.id, clientId: currentNote.id, bodyMarkdown: currentNote.bodyMarkdown, attachments: [...currentNote.attachments], groupRank: 2048, rank: currentNote.rank }],
      });
    }} type="button">Переместить заметку в группу</button>
  </div>;
}

function GitHubSyncProbe() {
  const library = useLibrary();
  const [result, setResult] = useState("idle");
  return <div>
    <span data-testid="sync-loading">{String(library.loading)}</span>
    <span data-testid="sync-title">{library.effective.games[GAME_ID]?.title ?? "empty"}</span>
    <span data-testid="sync-tier">{library.effective.games[GAME_ID]?.placement.tierId ?? "none"}</span>
    <span data-testid="sync-operations">{Object.keys(library.patch.operations).sort().join(",")}</span>
    <span data-testid="sync-conflicts">{library.conflicts.length}</span>
    <span data-testid="sync-pending">{String(library.pendingPublication !== null)}</span>
    <span data-testid="sync-persistence-error">{library.persistenceError ?? "none"}</span>
    <span data-testid="sync-result">{result}</span>
    <button onClick={() => { void library.syncToGitHub(GITHUB_TOKEN).then((value) => setResult(value.status)).catch((error) => setResult(error instanceof Error ? error.message : String(error))); }} type="button">Sync GitHub</button>
    <button onClick={() => library.moveGame(GAME_ID, "s", 0)} type="button">Edit after click</button>
  </div>;
}

function githubResponses(database: LibraryDatabase, remoteDatabase = database) {
  const requests: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), document.baseURI);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    requests.push({ url, method, body });
    if (url.origin !== "https://api.github.com") return jsonResponse(database);
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
    if (method === "PATCH" && url.pathname === `${root}/git/refs/heads/main`) return jsonResponse({ object: { type: "commit", sha: CREATED_COMMIT_SHA } });
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("LibraryProvider patch reload and reconciliation", () => {
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

  it("migrates legacy patch blobs into IndexedDB before stripping localStorage", async () => {
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
    expect(screen.getByTestId("mutation-error")).toHaveTextContent("Сначала разрешите конфликты");
  });
});

describe("LibraryProvider asset garbage collection", () => {
  it("deletes an orphaned IndexedDB blob immediately during startup", async () => {
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

  it("stores file bytes only in IndexedDB and deletes them after the final reference", async () => {
    const draft = empty(); draft.games[GAME_ID] = game("Static game");
    mockStaticDatabase(withComputedRevision(draft));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    render(<LibraryProvider><FileProbe preparedFile={{ clientId: "file", assetId: sha256Bytes(bytes), mime: "application/octet-stream", blob: new Blob([bytes]), originalName: "save.dat", byteLength: bytes.byteLength }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("file-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Прикрепить файл" }));
    await waitFor(() => expect(screen.getByTestId("file-kind")).toHaveTextContent("file"));
    expect(screen.getByTestId("file-blob-count")).toHaveTextContent("1");
    expect(screen.getByTestId("file-url")).toHaveTextContent("blob:");
    const stored = JSON.parse(localStorage.getItem(PATCH_STORAGE_KEY) ?? "null") as { patchVersion: number; blobs: Record<string, string>; operations: Record<string, { value?: unknown }> };
    expect(stored.patchVersion).toBe(2);
    expect(stored.blobs).toEqual({});
    expect(JSON.stringify(stored.operations)).not.toContain("AQIDBA==");

    fireEvent.click(screen.getByRole("button", { name: "Удалить файл" }));
    await waitFor(() => expect(screen.getByTestId("file-kind")).toHaveTextContent("none"));
    await waitFor(() => expect(screen.getByTestId("file-blob-count")).toHaveTextContent("0"));
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBeNull();
  });
});

describe("LibraryProvider direct GitHub synchronization", () => {
  function localTitlePatch(base: LibraryDatabase) {
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Local title";
    return diffLibrary(base, local, { changedAt: "2026-07-17T10:00:00.000Z", transactionId: "sync-title" });
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
