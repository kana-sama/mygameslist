import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCH_STORAGE_KEY,
  diffLibrary,
  savePatch,
  withComputedRevision,
  type Game,
  type LibraryDatabase,
} from "../src/domain";
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

function game(title: string): Game {
  return {
    id: GAME_ID,
    title,
    coverAssetId: null,
    platforms: ["NES"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function empty(): LibraryDatabase {
  return withComputedRevision({ schemaVersion: 1, revision: "", publicationId: null, games: {}, notes: {}, collections: {}, collectionItems: {}, assets: {} });
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

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("LibraryProvider patch reload and reconciliation", () => {
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
