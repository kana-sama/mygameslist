import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCH_STORAGE_KEY,
  bytesToBase64,
  diffLibrary,
  makeWebPAsset,
  savePatch,
  withComputedRevision,
  type Asset,
  type Game,
  type LibraryDatabase,
} from "../src/domain";
import type { GameSaveInput } from "../src/pages/GamePage";
import { LibraryProvider, useLibrary } from "../src/state/LibraryContext";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-16T10:00:00.000Z";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
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
  return makeWebPAsset(new Uint8Array([82, 73, 70, 70, marker, 0, 0, 0, 87, 69, 66, 80]), 1, 1, name, `${name}.webp`);
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

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("LibraryProvider patch reload and reconciliation", () => {
  it("migrates schema-1 game changes and drops obsolete collection operations", async () => {
    const draftBase = empty();
    draftBase.games[GAME_ID] = game("Static game");
    const base = withComputedRevision(draftBase);
    const local = structuredClone(base);
    local.games[GAME_ID].title = "Legacy local game";
    const patch = diffLibrary(base, local, { changedAt: NOW, transactionId: "legacy-edit" });
    const operation = Object.values(patch.operations)[0];
    const legacy = { ...patch, schemaVersion: 1, operations: { ...patch.operations, [`/collections/${GAME_ID}`]: operation } };
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
  it("keeps an unreferenced static asset after deleting its seeded game", async () => {
    const staticAsset = webpAsset(0, "static cover");
    mockStaticDatabase(seededDatabase(staticAsset));
    render(<LibraryProvider><AssetProbe localCover={{ base64: "", width: 1, height: 1, alt: "", originalName: "unused.webp" }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("asset-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить seeded game" }));

    await waitFor(() => expect(screen.getByTestId("asset-game-count")).toHaveTextContent("0"));
    expect(screen.getByTestId("asset-ids")).toHaveTextContent(staticAsset.id);
    expect(screen.getByTestId("asset-operation-paths")).not.toHaveTextContent(`/assets/${staticAsset.id}`);
  });

  it("retains the static cover across replacement and collects a newly unused local cover", async () => {
    const staticAsset = webpAsset(0, "static cover");
    const localAsset = webpAsset(1, "local cover");
    mockStaticDatabase(seededDatabase(staticAsset));
    render(<LibraryProvider><AssetProbe localCover={{ base64: bytesToBase64(new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 69, 66, 80])), width: 1, height: 1, alt: localAsset.alt, originalName: localAsset.originalName }} /></LibraryProvider>);

    await waitFor(() => expect(screen.getByTestId("asset-loading")).toHaveTextContent("false"));
    fireEvent.click(screen.getByRole("button", { name: "Поставить локальную обложку" }));
    await waitFor(() => expect(screen.getByTestId("asset-cover-id")).toHaveTextContent(localAsset.id));
    expect(screen.getByTestId("asset-ids")).toHaveTextContent(staticAsset.id);
    expect(screen.getByTestId("asset-ids")).toHaveTextContent(localAsset.id);

    fireEvent.click(screen.getByRole("button", { name: "Убрать обложку" }));
    await waitFor(() => expect(screen.getByTestId("asset-cover-id")).toHaveTextContent("none"));
    expect(screen.getByTestId("asset-ids")).toHaveTextContent(staticAsset.id);
    expect(screen.getByTestId("asset-ids")).not.toHaveTextContent(localAsset.id);
    expect(screen.getByTestId("asset-operation-paths")).not.toHaveTextContent(`/assets/${localAsset.id}`);
    expect(screen.getByTestId("asset-operation-paths")).not.toHaveTextContent(`/assets/${staticAsset.id}`);
  });
});
