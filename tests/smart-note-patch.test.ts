// @vitest-environment node
import { smartProgramHash } from "../src/domain/smartNote";
import { describe, expect, it } from "vitest";
import { applyPatch, canonicalHash, diffLibrary, reconcilePatch, resolveConflict, resolvePatchSelection, type LibraryDatabase } from "../src/domain";

const gameId = "00000000-0000-4000-8000-000000000001";
const noteId = "00000000-0000-4000-8000-000000000002";
const stamp = "2026-01-01T00:00:00.000Z";
function fixture(): LibraryDatabase {
  return { schemaVersion: 2, revision: "a".repeat(64), publicationId: "00000000-0000-4000-8000-000000000010", games: { [gameId]: { id: gameId, title: "Example", coverAssetId: null, platforms: [], tags: [], status: "playing", placement: { tierId: "a", rank: 1 }, reviewMarkdown: "", createdAt: stamp, updatedAt: stamp } }, notes: { [noteId]: { id: noteId, gameId, format: "smart", smart: { version: 1, apiVersion: 1, title: "Example smart note", entrypoints: { preview: "preview.js" }, program: { hash: smartProgramHash({ version: 1, apiVersion: 1, entrypoints: { preview: "preview.js" } }, [{ path: "preview.js", sha256: "c".repeat(64), byteLength: 20 }]), files: [{ path: "preview.js", sha256: "c".repeat(64), byteLength: 20 }] } }, state: { count: 0 }, bodyMarkdown: "", attachments: [], rank: 1, createdAt: stamp, updatedAt: stamp } }, assets: {} };
}

describe("smart patch boundary", () => {
  it("binds state to program identity and keeps stale program state recoverable", () => {
    const base = fixture(), edited = structuredClone(base);
    edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited);
    expect(patch.operations[`/notes/${noteId}/state`].smartProgramHash).toBe(base.notes[noteId].smart!.program.hash);
    const updated = structuredClone(base); updated.notes[noteId].smart!.program.files[0].byteLength += 1; updated.notes[noteId].smart!.program.hash = smartProgramHash(updated.notes[noteId].smart!, updated.notes[noteId].smart!.program.files);
    const result = reconcilePatch(updated, patch);
    expect(result.conflicts.map(conflict => conflict.path)).toContain(`/notes/${noteId}/state`);
    expect(result.effective.notes[noteId].state).toEqual({ count: 0 });
    expect(() => resolveConflict(updated, patch, `/notes/${noteId}/state`, { choice: "local" })).toThrow(/program/i);
    expect(() => resolveConflict(updated, patch, `/notes/${noteId}/state`, { choice: "manual", value: { count: 7 } })).toThrow(/program/i);
    expect(resolveConflict(updated, patch, `/notes/${noteId}/state`, { choice: "static" }).conflicts).toEqual([]);
  });
  it("keeps image removal recoverable across a program update", () => {
    const base = fixture();
    const assetId = "e".repeat(64);
    base.assets[assetId] = { id: assetId, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 20, alt: "", originalName: "synthetic.webp" };
    base.notes[noteId].state = { image: { $asset: assetId } }; base.notes[noteId].attachments = [{ type: "image", assetId, alt: "" }];
    const edited = structuredClone(base); edited.notes[noteId].state = {}; edited.notes[noteId].attachments = []; delete edited.assets[assetId];
    const patch = diffLibrary(base, edited);
    const updated = structuredClone(base); updated.notes[noteId].smart!.program.files[0].byteLength++;
    updated.notes[noteId].smart!.program.hash = smartProgramHash(updated.notes[noteId].smart!, updated.notes[noteId].smart!.program.files);
    const result = reconcilePatch(updated, patch);
    expect(result.effective.notes[noteId].state).toEqual(base.notes[noteId].state);
    expect(result.effective.assets[assetId]).toEqual(base.assets[assetId]);
    expect(result.conflicts.map(item => item.path)).toContain(`/assets/${assetId}`);
  });
  it("withholds image deletion when a same-program state edit conflicts", () => {
    const base = fixture();
    const assetId = "e".repeat(64);
    base.assets[assetId] = { id: assetId, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 20, alt: "", originalName: "synthetic.webp" };
    base.notes[noteId].state = { image: { $asset: assetId }, count: 0 };
    base.notes[noteId].attachments = [{ type: "image", assetId, alt: "" }];
    const edited = structuredClone(base);
    edited.notes[noteId].state = {}; edited.notes[noteId].attachments = []; delete edited.assets[assetId];
    const patch = diffLibrary(base, edited);
    const remote = structuredClone(base); remote.notes[noteId].state = { image: { $asset: assetId }, count: 2 };
    const result = reconcilePatch(remote, patch);
    expect(result.effective.notes[noteId].state).toEqual(remote.notes[noteId].state);
    expect(result.effective.assets[assetId]).toEqual(base.assets[assetId]);
    expect(result.conflicts.map(item => item.path)).toContain(`/assets/${assetId}`);
    expect(resolveConflict(remote, result.patch, `/notes/${noteId}/state`, { choice: "static" }).conflicts).toEqual([]);
  });
  it("preserves program binding while manually merging a same-program conflict", () => {
    const base = fixture(), edited = structuredClone(base); edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited); const remote = structuredClone(base); remote.notes[noteId].state = { count: 2 };
    const conflicted = reconcilePatch(remote, patch);
    const resolved = resolveConflict(remote, conflicted.patch, `/notes/${noteId}/state`, { choice: "manual", value: { count: 3 } });
    expect(resolved.conflicts).toEqual([]); expect(resolved.effective.notes[noteId].state).toEqual({ count: 3 });
    expect(resolved.patch.operations[`/notes/${noteId}/state`].smartProgramHash).toBe(remote.notes[noteId].smart!.program.hash);
  });
  it("rejects creation, conversion, individual deletion and immutable edits", () => {
    const base = fixture();
    for (const mutate of [(db: LibraryDatabase) => { delete db.notes[noteId]; }, (db: LibraryDatabase) => { db.notes[noteId].smart!.title = "Forged"; }, (db: LibraryDatabase) => { db.notes[noteId] = { ...db.notes[noteId], format: "markdown", state: undefined, smart: undefined, bodyMarkdown: "converted" }; }]) {
      const edited = structuredClone(base); mutate(edited);
      expect(() => diffLibrary(base, edited)).toThrow();
    }
    const empty = fixture(); delete empty.notes[noteId];
    expect(() => diffLibrary(empty, base)).toThrow(/smart/i);
    const operation = { operation: "delete" as const, baseExists: true, baseHash: canonicalHash(base.notes[noteId]), changedAt: stamp, transactionId: "00000000-0000-4000-8000-000000000003" };
    expect(() => applyPatch(base, { patchVersion: 2, schemaVersion: 2, baseRevision: base.revision, operations: { [`/notes/${noteId}`]: operation }, blobs: {} })).toThrow();
  });
  it("allows game deletion and makes selecting its smart note deletion include the game", () => {
    const base = fixture();
    const ordinaryId = "00000000-0000-4000-8000-000000000003";
    base.notes[ordinaryId] = { id: ordinaryId, gameId, bodyMarkdown: "Ordinary synthetic note", attachments: [], rank: 2, createdAt: stamp, updatedAt: stamp };
    const edited = structuredClone(base);
    for (const [id,note] of Object.entries(edited.notes)) if (note.gameId === gameId) delete edited.notes[id];
    delete edited.games[gameId];
    const patch = diffLibrary(base, edited);
    const selected = resolvePatchSelection(base, edited, patch, [{ changeId: "remove", operationPaths: [`/notes/${noteId}`] }]);
    expect(selected.selectedPaths).toContain(`/games/${gameId}`);
    expect(applyPatch(base, selected.publishPatch).notes).toEqual({});
  });
});
