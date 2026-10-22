// @vitest-environment node
import { smartProgramHash } from "../src/domain/smartNote";
import { describe, expect, it } from "vitest";
import { applyPatch, canonicalHash, diffLibrary, reconcilePatch, resolveConflict, resolvePatchSelection, validatePatch, sha256Bytes, MISSING_VALUE_HASH, type LibraryDatabase } from "../src/domain";

const gameId = "00000000-0000-4000-8000-000000000001";
const noteId = "00000000-0000-4000-8000-000000000002";
const stamp = "2026-01-01T00:00:00.000Z";
function fixture(): LibraryDatabase {
  return { schemaVersion: 2, revision: "a".repeat(64), publicationId: "00000000-0000-4000-8000-000000000010", games: { [gameId]: { id: gameId, title: "Example", coverAssetId: null, platforms: [], tags: [], status: "playing", placement: { tierId: "a", rank: 1 }, reviewMarkdown: "", createdAt: stamp, updatedAt: stamp } }, notes: { [noteId]: { id: noteId, gameId, format: "smart", smart: { version: 1, apiVersion: 1, title: "Example smart note", entrypoints: { preview: "preview.js" }, program: { hash: smartProgramHash({ version: 1, apiVersion: 1, entrypoints: { preview: "preview.js" } }, [{ path: "preview.js", sha256: "c".repeat(64), byteLength: 20 }]), files: [{ path: "preview.js", sha256: "c".repeat(64), byteLength: 20 }] } }, state: { count: 0 }, bodyMarkdown: "", attachments: [], rank: 1, createdAt: stamp, updatedAt: stamp } }, assets: {} };
}

describe("smart patch boundary", () => {
  it.each([false, true])("reconciles code changes with default1 state, including legacy=%s operations", legacy => {
    const base = fixture(), edited = structuredClone(base); edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited, { changedAt: stamp, transactionId: "original-edit" });
    const path = `/notes/${noteId}/state`;
    expect(patch.operations[path].smartStateVersion).toBe(1);
    if (legacy) delete patch.operations[path].smartStateVersion;
    const remote = structuredClone(base); remote.notes[noteId].smart!.program.files[0].byteLength++;
    remote.notes[noteId].smart!.stateVersion = 1;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    expect(applyPatch(remote, patch).notes[noteId].state).toEqual({ count: 1 });
    const reconciled = reconcilePatch(remote, patch);
    expect(reconciled.conflicts).toEqual([]);
    expect(reconciled.effective.notes[noteId].state).toEqual({ count: 1 });
    expect(reconciled.patch.operations[path]).toMatchObject({ smartProgramHash: remote.notes[noteId].smart!.program.hash, smartStateVersion: 1, changedAt: stamp, transactionId: "original-edit" });
    expect(reconciled.effective.notes[noteId].updatedAt).toBe(stamp);
  });
  it.each(["local", "manual"] as const)("retains concurrent state conflicts across compatible code changes and allows %s resolution", choice => {
    const base = fixture(), edited = structuredClone(base); edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited); delete patch.operations[`/notes/${noteId}/state`].smartStateVersion;
    const remote = structuredClone(base); remote.notes[noteId].state = { count: 2 }; remote.notes[noteId].smart!.program.files[0].byteLength++;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    const conflicted = reconcilePatch(remote, patch);
    expect(conflicted.conflicts.map(item => item.path)).toEqual([`/notes/${noteId}/state`]);
    expect(conflicted.effective.notes[noteId].state).toEqual({ count: 2 });
    expect(() => applyPatch(remote, patch)).toThrow(/Base hash/);
    const resolved = resolveConflict(remote, conflicted.patch, `/notes/${noteId}/state`, choice === "manual" ? { choice, value: { count: 3 } } : { choice });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.effective.notes[noteId].state).toEqual({ count: choice === "local" ? 1 : 3 });
  });
  it.each([false, true])("preserves image additions and blobs across code changes for legacy=%s", legacy => {
    const base = fixture(), edited = structuredClone(base), bytes = new TextEncoder().encode("RIFF0000WEBPsynthetic image bytes"), id = sha256Bytes(bytes);
    edited.assets[id] = { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: bytes.length, alt: "", originalName: "synthetic.webp" };
    edited.notes[noteId].state = { image: { $asset: id } }; edited.notes[noteId].attachments = [{ type: "image", assetId: id, alt: "" }];
    const patch = diffLibrary(base, edited, { blobs: { [id]: Buffer.from(bytes).toString("base64") } });
    expect(patch.operations[`/notes/${noteId}/attachments`].smartStateVersion).toBe(1);
    if (legacy) for (const operation of Object.values(patch.operations)) delete operation.smartStateVersion;
    const remote = structuredClone(base); remote.notes[noteId].smart!.program.files[0].byteLength++;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    const result = reconcilePatch(remote, patch);
    expect(result.conflicts).toEqual([]); expect(result.effective.notes[noteId].state).toEqual({ image: { $asset: id } });
    expect(result.effective.notes[noteId].attachments).toEqual(edited.notes[noteId].attachments);
    expect(result.effective.assets[id]).toEqual(edited.assets[id]); expect(result.patch.blobs).toEqual(patch.blobs);
    remote.notes[noteId].smart!.stateVersion = 2;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    const incompatible = reconcilePatch(remote, patch);
    expect(incompatible.conflicts.map(item => item.path).sort()).toEqual(Object.keys(patch.operations).sort());
    expect(incompatible.effective.notes[noteId].state).toEqual({ count: 0 });
    expect(incompatible.effective.assets[id]).toBeUndefined(); expect(incompatible.patch.blobs).toEqual(patch.blobs);
    expect(() => applyPatch(remote, patch, { checkBaseHashes: false, validateResult: false })).toThrow(/state version/i);
  });
  it("applies legacy image removal after compatible code changes", () => {
    const base = fixture(), id = "e".repeat(64);
    base.assets[id] = { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 20, alt: "", originalName: "synthetic.webp" };
    base.notes[noteId].state = { image: { $asset: id } }; base.notes[noteId].attachments = [{ type: "image", assetId: id, alt: "" }];
    const edited = structuredClone(base); edited.notes[noteId].state = {}; edited.notes[noteId].attachments = []; delete edited.assets[id];
    const patch = diffLibrary(base, edited); for (const operation of Object.values(patch.operations)) delete operation.smartStateVersion;
    const remote = structuredClone(base); remote.notes[noteId].smart!.program.files[0].byteLength++;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    const result = reconcilePatch(remote, patch); expect(result.conflicts).toEqual([]);
    expect(result.effective.notes[noteId].state).toEqual({}); expect(result.effective.notes[noteId].attachments).toEqual([]); expect(result.effective.assets[id]).toBeUndefined();
  });

  it("retains independent edit timestamps while rebinding compatible metadata", () => {
    const base = fixture(), edited = structuredClone(base); edited.notes[noteId].state = { count: 1 };
    const original = diffLibrary(base, edited, { changedAt: stamp, transactionId: "state-edit" });
    edited.games[gameId].title = "Separate edit";
    const secondStamp = "2026-02-01T00:00:00.000Z";
    const patch = diffLibrary(base, edited, { previousPatch: original, changedAt: secondStamp, transactionId: "title-edit" });
    const remote = structuredClone(base); remote.notes[noteId].smart!.program.files[0].byteLength++;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    const result = reconcilePatch(remote, patch);
    expect(result.conflicts).toEqual([]);
    expect(result.patch.operations[`/notes/${noteId}/state`]).toMatchObject({ changedAt: stamp, transactionId: "state-edit" });
    expect(result.patch.operations[`/games/${gameId}/title`]).toMatchObject({ changedAt: secondStamp, transactionId: "title-edit" });
    expect(result.effective.notes[noteId].updatedAt).toBe(stamp);
    const next = structuredClone(result.effective); next.notes[noteId].state = { count: 4 };
    const nextPatch = diffLibrary(remote, next, { previousPatch: result.patch, changedAt: secondStamp, transactionId: "new-state-edit" });
    expect(nextPatch.operations[`/notes/${noteId}/state`]).toMatchObject({ value: { count: 4 }, changedAt: secondStamp, transactionId: "new-state-edit" });
  });
  it("supports compatible nondefault versions while legacy operations remain version1", () => {
    const base = fixture(); base.notes[noteId].smart!.stateVersion = 2;
    base.notes[noteId].smart!.program.hash = smartProgramHash(base.notes[noteId].smart!, base.notes[noteId].smart!.program.files);
    const edited = structuredClone(base); edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited);
    expect(patch.operations[`/notes/${noteId}/state`].smartStateVersion).toBe(2);
    const remote = structuredClone(base); remote.notes[noteId].smart!.program.files[0].byteLength++;
    remote.notes[noteId].smart!.program.hash = smartProgramHash(remote.notes[noteId].smart!, remote.notes[noteId].smart!.program.files);
    expect(reconcilePatch(remote, patch).conflicts).toEqual([]);
    expect(applyPatch(remote, patch).notes[noteId].state).toEqual({ count: 1 });
    delete patch.operations[`/notes/${noteId}/state`].smartStateVersion;
    expect(reconcilePatch(remote, patch).conflicts.map(item => item.path)).toEqual([`/notes/${noteId}/state`]);
  });
  it("withholds unbound smart attachment operations", () => {
    const base = fixture(), edited = structuredClone(base), id = "e".repeat(64);
    base.assets[id] = { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 20, alt: "", originalName: "synthetic.webp" };
    base.notes[noteId].state = { image: { $asset: id } }; base.notes[noteId].attachments = [{ type: "image", assetId: id, alt: "Original" }];
    Object.assign(edited, structuredClone(base)); edited.notes[noteId].attachments[0].alt = "Changed"; edited.assets[id].alt = "Changed";
    const patch = diffLibrary(base, edited), path = `/notes/${noteId}/attachments`;
    delete patch.operations[path].smartProgramHash; delete patch.operations[path].smartStateVersion;
    expect(validatePatch(patch).ok).toBe(true);
    expect(() => applyPatch(base, patch)).toThrow(/state version/i);
    const result = reconcilePatch(base, patch);
    expect(result.conflicts.map(item => item.path)).toContain(path);
    expect(result.effective.notes[noteId].attachments[0].alt).toBe("Original");
  });
  it("validates state version metadata and rejects unrelated paths", () => {
    const base = fixture(), edited = structuredClone(base); edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited), path = `/notes/${noteId}/state`;
    for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      const invalid = structuredClone(patch); Object.assign(invalid.operations[path], { smartStateVersion: version });
      expect(validatePatch(invalid).ok).toBe(false);
    }
    for (const [unrelated, value] of [[`/notes/${noteId}/rank`, 2], [`/games/${gameId}/title`, "Changed title"], [`/assets/${"e".repeat(64)}`, { id: "e".repeat(64), kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 20, alt: "", originalName: "synthetic.webp" }]] as const) {
      const unrelatedPatch = structuredClone(patch);
      const { smartProgramHash: _hash, smartStateVersion: _version, ...operation } = unrelatedPatch.operations[path];
      unrelatedPatch.operations = { [unrelated]: { ...operation, value, ...(unrelated.startsWith("/assets/") ? { baseExists: false, baseHash: MISSING_VALUE_HASH } : {}) } };
      expect(validatePatch(unrelatedPatch).ok).toBe(true);
      unrelatedPatch.operations[unrelated].smartStateVersion = 1;
      expect(validatePatch(unrelatedPatch).ok).toBe(false);
    }
    for (const smartStateVersion of [1, 2, Number.MAX_SAFE_INTEGER]) {
      const valid = structuredClone(patch); valid.operations[path].smartStateVersion = smartStateVersion;
      expect(validatePatch(valid).ok).toBe(true);
    }
  });

  it("keeps incompatible state versions recoverable even when only the declaration changes", () => {
    const base = fixture(), edited = structuredClone(base);
    edited.notes[noteId].state = { count: 1 };
    const patch = diffLibrary(base, edited);
    expect(patch.operations[`/notes/${noteId}/state`].smartProgramHash).toBe(base.notes[noteId].smart!.program.hash);
    const updated = structuredClone(base); updated.notes[noteId].smart!.stateVersion = 2; updated.notes[noteId].smart!.program.hash = smartProgramHash(updated.notes[noteId].smart!, updated.notes[noteId].smart!.program.files);
    const result = reconcilePatch(updated, patch);
    expect(result.conflicts.map(conflict => conflict.path)).toContain(`/notes/${noteId}/state`);
    expect(result.effective.notes[noteId].state).toEqual({ count: 0 });
    expect(() => resolveConflict(updated, patch, `/notes/${noteId}/state`, { choice: "local" })).toThrow(/state version/i);
    expect(() => resolveConflict(updated, patch, `/notes/${noteId}/state`, { choice: "manual", value: { count: 7 } })).toThrow(/state version/i);
    expect(resolveConflict(updated, patch, `/notes/${noteId}/state`, { choice: "static" }).conflicts).toEqual([]);
  });
  it("keeps image removal recoverable across an incompatible state version", () => {
    const base = fixture();
    const assetId = "e".repeat(64);
    base.assets[assetId] = { id: assetId, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: 20, alt: "", originalName: "synthetic.webp" };
    base.notes[noteId].state = { image: { $asset: assetId } }; base.notes[noteId].attachments = [{ type: "image", assetId, alt: "" }];
    const edited = structuredClone(base); edited.notes[noteId].state = {}; edited.notes[noteId].attachments = []; delete edited.assets[assetId];
    const patch = diffLibrary(base, edited);
    const updated = structuredClone(base); updated.notes[noteId].smart!.stateVersion = 2;
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
    for (const mutate of [(db: LibraryDatabase) => { delete db.notes[noteId]; }, (db: LibraryDatabase) => { db.notes[noteId].smart!.title = "Forged"; }, (db: LibraryDatabase) => { db.notes[noteId].smart!.stateVersion = 2; }, (db: LibraryDatabase) => { db.notes[noteId] = { ...db.notes[noteId], format: "markdown", state: undefined, smart: undefined, bodyMarkdown: "converted" }; }]) {
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
