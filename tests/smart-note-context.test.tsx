import { ImageLocks } from "./helpers/imageLocks";
import { smartProgramHash } from "../src/domain/smartNote";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import { LibraryProvider, useLibrary, type LibraryContextValue } from "../src/state/LibraryContext";
import { diffLibrary, loadPatch, PATCH_STORAGE_KEY, withComputedRevision, sha256Bytes, makeLocalAsset, writeLocalAssetsAtomic, deleteSafeOrphans, type LibraryDatabase } from "../src/domain";
import { PENDING_PUBLICATION_STORAGE_KEY, type PendingPublicationJournalV3 } from "../src/state/pendingPublication";

vi.mock("../src/components/MonacoMarkdownEditor", async () => import("./mocks/MonacoMarkdownEditorMock"));
const gameId = "00000000-0000-4000-8000-000000000001", noteId = "00000000-0000-4000-8000-000000000002";
const stamp = "2026-01-01T00:00:00.000Z";
let latest: LibraryContextValue;
function Probe() { const library = useLibrary(); useLayoutEffect(() => { latest = library; }); return null; }
function database(): LibraryDatabase {
  return withComputedRevision({ schemaVersion: 2, revision: "", publicationId: "00000000-0000-4000-8000-000000000003", games: { [gameId]: { id: gameId, title: "Synthetic", coverAssetId: null, platforms: [], tags: [], status: "playing", placement: { tierId: "a", rank: 1 }, reviewMarkdown: "", createdAt: stamp, updatedAt: stamp } }, notes: { [noteId]: { id: noteId, gameId, format: "smart", smart: { version: 1, apiVersion: 1, title: "Synthetic state", entrypoints: { preview: "preview.js" }, program: { hash: smartProgramHash({ version: 1, apiVersion: 1, entrypoints: { preview: "preview.js" } }, [{ path: "preview.js", sha256: "c".repeat(64), byteLength: 10 }]), files: [{ path: "preview.js", sha256: "c".repeat(64), byteLength: 10 }] } }, state: { count: 0 }, bodyMarkdown: "", attachments: [], rank: 1, createdAt: stamp, updatedAt: stamp } }, assets: {} });
}
function mount(base = database()) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ sourceCommitSha: "a".repeat(40), database: base }) })));
  return render(<LibraryProvider><Probe /></LibraryProvider>);
}
const page = { open: () => false, close: () => undefined };
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name: string, _options: LockOptions, fn: (lock: Lock) => unknown) => fn({ name, mode: "exclusive" } as Lock) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe("durable smart state context integration", () => {
  it("persists, reloads, undoes and imports through the ordinary patch", async () => {
    const first = mount(); await waitFor(() => expect(latest.loading).toBe(false));
    const scope = latest.createSmartNoteScope(noteId, "preview", page);
    await act(() => scope.api.state.update(() => ({ count: 1 })));
    expect(loadPatch(localStorage).patch?.operations[`/notes/${noteId}/state`].value).toEqual({ count: 1 });
    const exported = localStorage.getItem(PATCH_STORAGE_KEY)!;
    await act(async () => { await latest.undoLast(); });
    expect(latest.effective.notes[noteId].state).toEqual({ count: 0 });
    await act(() => latest.importPatch(exported));
    scope.dispose(); first.unmount(); mount();
    await waitFor(() => expect(latest.loading).toBe(false));
    expect(latest.effective.notes[noteId].state).toEqual({ count: 1 });
  });
  it("preserves smart notes omitted from ordinary full-game saves and does not replay stale state", async () => {
    mount(); await waitFor(() => expect(latest.loading).toBe(false));
    const stale = structuredClone(latest.effective.notes[noteId]);
    const scope = latest.createSmartNoteScope(noteId, "preview", page);
    await act(() => scope.api.state.update(() => ({ count: 2 })));
    const game = latest.effective.games[gameId];
    const input = { id: gameId, title: game.title, coverAssetId: null, pendingCover: null, platforms: [], tags: [], status: game.status, tierId: game.placement.tierId, reviewMarkdown: "", progressItems: [], notes: [] };
    await act(() => latest.saveGame(input));
    expect(latest.effective.notes[noteId].state).toEqual({ count: 2 });
    await act(() => latest.saveGame({ ...input, notes: [{ ...stale, clientId: noteId, doubleWidth: true }] }));
    expect(latest.effective.notes[noteId].state).toEqual({ count: 2 });
    expect(latest.effective.notes[noteId].doubleWidth).toBe(true);
    scope.dispose();
  });
  it("leases smart undo images across other-tab cleanup and releases them on provider unmount", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: new ImageLocks() });
    const base = database(), bytes = new TextEncoder().encode("synthetic retained image"), id = sha256Bytes(bytes);
    base.assets[id] = { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: bytes.length, alt: "", originalName: "synthetic.webp" };
    base.notes[noteId].state = { image: { $asset: id } }; base.notes[noteId].attachments = [{ type: "image", assetId: id, alt: "" }];
    const view = mount(withComputedRevision(base)); await waitFor(() => expect(latest.loading).toBe(false));
    await writeLocalAssetsAtomic([makeLocalAsset(id, new Blob([bytes]), "image/webp")]);
    const scope = latest.createSmartNoteScope(noteId, "preview", page);
    await act(() => scope.api.state.update(() => ({}))); scope.dispose();
    // Another tab has adopted a newer publication with no patch references.
    localStorage.removeItem(PATCH_STORAGE_KEY);
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([]);
    view.unmount(); await Promise.resolve(); await Promise.resolve();
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([id]);
  });
  it("rejects another-tab changes before replacing durable state", async () => {
    mount(); await waitFor(() => expect(latest.loading).toBe(false));
    const scope = latest.createSmartNoteScope(noteId, "preview", page);
    const concurrent = { ...latest.patch, operations: {}, blobs: {} };
    localStorage.setItem(PATCH_STORAGE_KEY, JSON.stringify(concurrent));
    await act(async () => { await expect(scope.api.state.update(() => ({ count: 1 }))).rejects.toThrow(/another tab/); });
    expect(latest.effective.notes[noteId].state).toEqual({ count: 0 });
    expect(localStorage.getItem(PATCH_STORAGE_KEY)).toBe(JSON.stringify(concurrent));
    scope.dispose();
  });
  it("writes smart changes into durable pending-publication remainders", async () => {
    const base = database();
    const journal: PendingPublicationJournalV3 = { version: 3, owner: "kana", repo: "mygameslist", branch: "main", sourceCommitSha: "a".repeat(40), targetCommitSha: "d".repeat(40), targetRevision: base.revision, targetDatabase: base, remainderPatch: diffLibrary(base, base), localAssetIdsAwaitingVerification: [], createdAt: stamp, phase: "awaiting-deployment" };
    // Match the configured repository identity without a network call.
    const { GITHUB_REPOSITORY_OWNER, GITHUB_REPOSITORY_NAME } = await import("../src/state/githubPat");
    journal.owner = GITHUB_REPOSITORY_OWNER; journal.repo = GITHUB_REPOSITORY_NAME;
    const { canonicalStringify } = await import("../src/domain");
    localStorage.setItem(PENDING_PUBLICATION_STORAGE_KEY, canonicalStringify(journal));
    mount(base); await waitFor(() => expect(latest.loading).toBe(false));
    const scope = latest.createSmartNoteScope(noteId, "page", page);
    await act(() => scope.api.state.update(() => ({ count: 3 })));
    expect(JSON.parse(localStorage.getItem(PENDING_PUBLICATION_STORAGE_KEY)!).remainderPatch.operations[`/notes/${noteId}/state`].value).toEqual({ count: 3 });
    expect(latest.effective.notes[noteId].state).toEqual({ count: 3 }); scope.dispose();
  });
});
