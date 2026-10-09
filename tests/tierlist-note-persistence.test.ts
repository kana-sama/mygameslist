import { normalizeLibraryDatabase } from "../src/domain/libraryNormalization";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { noteFormat, noteContentTitle, validateNoteContent, resolveNoteContentProgress } from "../src/domain/noteContent";
import { applyPatch, diffLibrary, reconcilePatch, resolveConflict, updateInteractiveNoteField } from "../src/domain/patch";
import { validateLibrary, validatePatch } from "../src/domain/validation";
import { buildChangeReview } from "../src/domain/changeReview";
import { resolvePatchSelection } from "../src/domain/patchSelection";
import { parseNoteDocument, serializeNoteDocument } from "../src/source/noteDocument";
import { deriveNoteFilename } from "../src/source/paths";
import { projectSourceTree } from "../src/source/project";
import { assembleSourceTree } from "../src/source/assemble";
import { serializeTierList, parseTierList, moveTierListCard } from "../src/domain/tierList";
import { PATCH_STORAGE_KEY, storedInteractionPatchRaw } from "../src/domain/storage";
import { describeAssetForRecovery, garbageCollectUnreferencedAssets } from "../src/domain/assetReferences";
import { canonicalHash, canonicalStringify, withComputedRevision } from "../src/domain/canonical";
import { INTERACTION_RESCUE_STORAGE_KEY, loadActiveInteractionRescue, resolveRescuedNoteInteraction, persistInteractionPatchWithRescue } from "../src/state/interactionRescue";
import { fixtureDatabase, NOTE_EMPTY_ID, NOTE_SHARED_ID, NOW, IMAGE_ID, IMAGE_BYTES, FILE_BYTES, FILE_ID } from "./fixtures/source-tree";
import type { NoteFormat, PatchConflict } from "../src/domain/types";
const format = "tierlist" as NoteFormat;
const source = serializeTierList({ version: 2, title: "Выбор <literal>", grades: [{ id: "g", name: "Любой", cards: [{ id: "a", imageAssetId: IMAGE_ID , bodyMarkdown: "" }, { id: "b", imageAssetId: IMAGE_ID, bodyMarkdown: "[x] literal\n<svg>" }] }, { id: "empty", name: "Пустой", cards: [] }] });
const movedSource = serializeTierList(moveTierListCard(parseTierList(source), "a", "empty", 0));
const path = `/notes/${NOTE_EMPTY_ID}`, bodyPath = `${path}/bodyMarkdown`;
function database() {
  const db = fixtureDatabase(); db.notes[NOTE_EMPTY_ID] = { ...db.notes[NOTE_EMPTY_ID], format, bodyMarkdown: source, attachments: [{ type: "image", assetId: IMAGE_ID, alt: "Pool" }] }; return db;
}
function interaction(base = database(), value = movedSource, conflicts: PatchConflict[] = []) {
  return updateInteractiveNoteField({ base, effective: base, patch: diffLibrary(base, base), conflicts, changedAt: NOW, transactionId: "move", update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value, expectedBodyMarkdown: source, expectedFormat: format } });
}
describe("tier-list note persistence", () => {
  it("dispatches titles, validation and progress without parsing literal content as Markdown", () => {
    expect(noteContentTitle(database().notes[NOTE_EMPTY_ID])).toBe("Выбор <literal>");
    expect(validateNoteContent(source, format)).toEqual([]);
    expect(resolveNoteContentProgress(database().notes[NOTE_EMPTY_ID])).toEqual({ status: "error" });
    expect(noteFormat({})).toBe("markdown");
    expect(validateNoteContent("# Old")).toEqual([]);
    expect(validateNoteContent("digraph {}", "graph")).toEqual([]);
  });
  it("round-trips format metadata, body and image pool through source documents", () => {
    const db = database(), document = { metadata: { id: NOTE_EMPTY_ID, format, rank: 1024, createdAt: NOW, updatedAt: NOW, attachments: [{ type: "image" as const, assetId: IMAGE_ID, alt: "Pool", originalName: "pool.png" }] }, bodyMarkdown: source };
    const assetNames = new Map([[IMAGE_ID, `pool_${IMAGE_ID}.webp`]]);
    const text = serializeNoteDocument(document, assetNames);
    expect(text).toContain("format: tierlist\n");
    expect(parseNoteDocument(text, "tier.md", assetNames)).toEqual(document);
    expect(deriveNoteFilename(db.notes[NOTE_EMPTY_ID])).toBe(`выбор-literal_${NOTE_EMPTY_ID}.md`);
  });
  it("requires the card image in the same note's image pool and existing validated image asset", () => {
    const db = database(); expect(validateLibrary(db).ok).toBe(true);
    db.notes[NOTE_EMPTY_ID].attachments = [];
    expect(validateLibrary(db).ok).toBe(false); // Other notes and cover cannot substitute for this pool.
    db.notes[NOTE_EMPTY_ID].attachments = [{ type: "file", assetId: IMAGE_ID, label: "Wrong" }];
    expect(validateLibrary(db).ok).toBe(false);
    db.notes[NOTE_EMPTY_ID].attachments = [{ type: "image", assetId: FILE_ID, alt: "Wrong" }];
    db.notes[NOTE_EMPTY_ID].bodyMarkdown = source.replaceAll(IMAGE_ID, FILE_ID);
    expect(validateLibrary(db).ok).toBe(false);
    db.notes[NOTE_EMPTY_ID].bodyMarkdown = source; db.notes[NOTE_EMPTY_ID].attachments = [{ type: "image", assetId: IMAGE_ID, alt: "Pool" }];
    delete db.assets[IMAGE_ID]; expect(validateLibrary(db).ok).toBe(false);
  });
  it("uses the existing pool in projection and full source assembly with shared assets", async () => {
    const db = database(), projection = await projectSourceTree(db);
    const files = new Map(projection.leaves.map(leaf => [leaf.path, leaf.kind === "text" ? new TextEncoder().encode(leaf.text) : leaf.assetId === IMAGE_ID ? IMAGE_BYTES : FILE_BYTES]));
    const assembled = await assembleSourceTree({ listEntries: async () => {
      const dirs = new Set<string>(); for (const file of files.keys()) { const parts = file.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/")); }
      return [...[...dirs].map(path => ({ kind: "directory" as const, path })), ...[...files.keys()].map(path => ({ kind: "file" as const, path }))];
    }, readFile: async path => files.get(path)! }, { sourceCommitSha: null });
    expect(assembled.database.notes[NOTE_EMPTY_ID]).toMatchObject({ format, bodyMarkdown: source, attachments: db.notes[NOTE_EMPTY_ID].attachments });
    expect(assembled.database.notes[NOTE_SHARED_ID].attachments).toEqual(db.notes[NOTE_SHARED_ID].attachments);
    const deleted = structuredClone(db); const content = parseTierList(source); content.grades[0].cards.shift(); deleted.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(content);
    expect(applyPatch(db, diffLibrary(db, deleted)).assets[IMAGE_ID]).toBeDefined();
  });
  it("diffs, applies and selects atomic format/body changes", () => {
    const base = fixtureDatabase(), next = database(), patch = diffLibrary(base, next, { changedAt: NOW });
    expect(validatePatch(patch).ok).toBe(true);
    expect(patch.operations[bodyPath].noteFormat).toBe(format);
    expect(applyPatch(base, patch).notes[NOTE_EMPTY_ID]).toMatchObject({ format, bodyMarkdown: source });
    expect(() => applyPatch(base, { ...patch, operations: { [bodyPath]: patch.operations[bodyPath] } })).toThrow();
    const selection = resolvePatchSelection(base, next, patch, [{ changeId: "pick", operationPaths: [`${path}/format`] }]);
    expect(selection.selectedPaths).toContain(bodyPath);
    expect(selection.selectedPaths).toContain(`${path}/attachments`);
  });
  it("retains body interpretation when remote format changes and resolves content conflicts atomically", () => {
    const base = database(), local = structuredClone(base); local.notes[NOTE_EMPTY_ID].bodyMarkdown = movedSource;
    const remote = structuredClone(base); delete remote.notes[NOTE_EMPTY_ID].format; remote.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Remote";
    const reconciled = reconcilePatch(remote, diffLibrary(base, local));
    expect(reconciled.effective.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe("# Remote");
    expect(reconciled.conflicts.map(c => c.path).sort()).toEqual([bodyPath, `${path}/format`]);
    const resolved = resolveConflict(remote, reconciled.patch, bodyPath, { choice: "local" });
    expect(resolved.effective.notes[NOTE_EMPTY_ID]).toMatchObject({ format, bodyMarkdown: movedSource });
    expect(resolved.conflicts).toEqual([]);
  });
  it("reviews JSON as escaped source evidence with readable format labels", () => {
    const base = fixtureDatabase(), next = database(), review = buildChangeReview(base, next, diffLibrary(base, next));
    const evidence = Object.values(review.changesById).flatMap(change => change.evidence);
    expect(evidence.some(item => item.type === "source" && item.after === source)).toBe(true);
    expect(evidence.some(item => item.type === "scalar" && item.after.includes("Тирлист"))).toBe(true);
    expect(evidence.some(item => item.type === "markdown")).toBe(false);
  });
  it("guards interactive moves by source/format and keeps ownership valid", () => {
    const result = interaction(); expect(result.patch.operations[bodyPath].noteFormat).toBe(format);
    expect(result.effective.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe(movedSource);
    expect(() => interaction(undefined, source.replaceAll(IMAGE_ID, "b".repeat(64)))).toThrow();
    expect(() => interaction(undefined, "{}" )).toThrow();
    expect(() => interaction(undefined, movedSource, [{ path: `${path}/format` } as PatchConflict])).toThrow(/конфликт/);
    const db = database(); const input = { base: db, effective: db, patch: diffLibrary(db, db), conflicts: [], changedAt: NOW, transactionId: "stale" };
    for (const expectedFormat of ["graph", "markdown"] as const) expect(() => updateInteractiveNoteField({ ...input, update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value: movedSource, expectedFormat } })).toThrow(/измен/);
    expect(() => updateInteractiveNoteField({ ...input, update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value: movedSource, expectedBodyMarkdown: "old" } })).toThrow(/измен/);
  });
  it("closes body selection over new pool references and pool removal over card deletion", () => {
    const base = database(), next = structuredClone(base);
    base.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList({ version: 2, title: "", grades: [] });
    base.notes[NOTE_EMPTY_ID].attachments = [];
    const patch = diffLibrary(base, next, { changedAt: NOW });
    expect(resolvePatchSelection(base, next, patch, [{ changeId: "body", operationPaths: [bodyPath] }]).selectedPaths).toEqual([`${path}/attachments`, bodyPath]);
    const removal = diffLibrary(next, base, { changedAt: NOW });
    expect(resolvePatchSelection(next, base, removal, [{ changeId: "pool", operationPaths: [`${path}/attachments`] }]).selectedPaths).toEqual([`${path}/attachments`, bodyPath]);
    expect(garbageCollectUnreferencedAssets(base)).toEqual([]); // Shared cover/other-note images survive.
  });
  it("rejects source bodies whose images are absent from their attachment pool", () => {
    const document = { metadata: { id: NOTE_EMPTY_ID, format, rank: 1024, createdAt: NOW, updatedAt: NOW }, bodyMarkdown: source };
    expect(() => serializeNoteDocument(document, new Map())).toThrow(/вложениях/);
    const empty = serializeNoteDocument({ ...document, bodyMarkdown: "" }, new Map());
    expect(() => parseNoteDocument(empty + source, "missing.md", new Map())).toThrow(/вложениях/);
  });
  it("uses tier-list titles in asset recovery descriptions", () => {
    const db = database();
    for (const game of Object.values(db.games)) { game.coverAssetId = null; delete game.progressItems; }
    for (const note of Object.values(db.notes)) if (note.id !== NOTE_EMPTY_ID) note.attachments = note.attachments.filter(item => item.type !== "image");
    expect(describeAssetForRecovery(db, IMAGE_ID)).toContain("Выбор <literal>");
  });
  it("persists tier-list fallback after a revert and refuses overlapping storage writes", async () => {
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const base = withComputedRevision(database()), edited = interaction(base).patch, reverted = diffLibrary(base, base);
    storage.setItem(PATCH_STORAGE_KEY, storedInteractionPatchRaw(edited)!);
    const update = { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown" as const, value: source, expectedFormat: format };
    expect((await persistInteractionPatchWithRescue(storage, edited, reverted, update, NOW, "revert", { lockManager: null })).status).toBe("durable");
    const loaded = loadActiveInteractionRescue(storage, storedInteractionPatchRaw(reverted), reverted.baseRevision);
    expect(loaded).toMatchObject({ status: "active", entries: [{ source: "fallback", noteFormat: format, fallbackValue: source }] });
    if (loaded.status === "active") expect(resolveRescuedNoteInteraction(loaded.entries[0], reverted)).toMatchObject({ expectedFormat: format });
    storage.setItem(PATCH_STORAGE_KEY, "concurrent-tab");
    expect((await persistInteractionPatchWithRescue(storage, reverted, edited, update, NOW, "overlap", { lockManager: null })).status).toBe("changed");
    expect(storage.getItem(PATCH_STORAGE_KEY)).toBe("concurrent-tab");
  });
  it("loads and resolves tier-list rescue fallback and root/field patch markers", () => {
    const entry = { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown" as const, source: "fallback" as const, noteFormat: format, fallbackOperation: "set" as const, fallbackValue: source, changedAt: NOW, transactionId: "rescue" };
    const raw = canonicalStringify({ version: 1, generations: [{ ordinaryPatchHash: canonicalHash({ ordinaryPatchRaw: null }), baseRevision: "a".repeat(64), supersedingJournalHash: null, entries: [entry] }] });
    expect(loadActiveInteractionRescue({ getItem: key => key === INTERACTION_RESCUE_STORAGE_KEY ? raw : null }, null, "a".repeat(64))).toMatchObject({ status: "active" });
    expect(resolveRescuedNoteInteraction(entry, null)).toMatchObject({ expectedFormat: format, value: source });
    const patchEntry = { ...entry, source: "patch" as const, fallbackOperation: null };
    expect(resolveRescuedNoteInteraction(patchEntry, diffLibrary(fixtureDatabase(), database()))).toMatchObject({ expectedFormat: format });
    const base = database(), added = structuredClone(base); delete base.notes[NOTE_EMPTY_ID];
    expect(resolveRescuedNoteInteraction(patchEntry, diffLibrary(base, added))).toMatchObject({ expectedFormat: format });
  });
});

describe("tier-list ownership conflict atomicity", () => {
  it("keeps a conflicted card removal with its image-pool removal and resolves either row atomically", () => {
    const base = database(), local = structuredClone(base), remote = structuredClone(base);
    const content = parseTierList(source); content.grades[0].cards = [];
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(content);
    local.notes[NOTE_EMPTY_ID].attachments = [];
    const remoteContent = parseTierList(source); remoteContent.title = "Remote title";
    remote.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(remoteContent);
    for (const db of [base, local, remote]) expect(validateLibrary(db).ok).toBe(true);
    const result = reconcilePatch(remote, diffLibrary(base, local, { changedAt: NOW }));
    expect(result.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
    expect(result.conflicts.map(c => c.path).sort()).toEqual([`${path}/attachments`, bodyPath]);
    for (const conflictPath of [bodyPath, `${path}/attachments`]) {
      const keptLocal = resolveConflict(remote, result.patch, conflictPath, { choice: "local" });
      expect(keptLocal.conflicts).toEqual([]);
      expect(keptLocal.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(local).notes[NOTE_EMPTY_ID]);
      const keptStatic = resolveConflict(remote, result.patch, conflictPath, { choice: "static" });
      expect(keptStatic.conflicts).toEqual([]);
      expect(keptStatic.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
    }
  });
  it("retains the image pool for local body-only changes against remote card/pool deletion", () => {
    const base = database(), local = structuredClone(base), remote = structuredClone(base);
    const localContent = parseTierList(source); localContent.title = "Local title";
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(localContent);
    const remoteContent = parseTierList(source); remoteContent.grades[0].cards = [];
    remote.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(remoteContent);
    remote.notes[NOTE_EMPTY_ID].attachments = [];
    for (const db of [base, local, remote]) expect(validateLibrary(db).ok).toBe(true);
    for (const patch of [diffLibrary(base, local, { changedAt: NOW }), interaction(base, local.notes[NOTE_EMPTY_ID].bodyMarkdown).patch]) {
      const result = reconcilePatch(remote, patch);
      expect(result.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
      expect(result.conflicts.map(c => c.path).sort()).toEqual([`${path}/attachments`, bodyPath]);
      for (const conflictPath of [bodyPath, `${path}/attachments`]) {
        const keptLocal = resolveConflict(remote, result.patch, conflictPath, { choice: "local" });
        expect(keptLocal.conflicts).toEqual([]);
        expect(keptLocal.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(local).notes[NOTE_EMPTY_ID]);
        expect(resolveConflict(remote, result.patch, conflictPath, { choice: "static" }).effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
      }
    }
  });
  it("keeps remote unrelated attachments when a body edit only snapshots its image pool", () => {
    const base = database(), local = structuredClone(base), remote = structuredClone(base);
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = movedSource;
    remote.notes[NOTE_EMPTY_ID].attachments.push({ type: "link", url: "https://example.test/remote", label: "Remote link" });
    const result = reconcilePatch(remote, diffLibrary(base, local, { changedAt: NOW }));
    expect(result.conflicts).toEqual([]);
    expect(result.effective.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe(movedSource);
    expect(result.effective.notes[NOTE_EMPTY_ID].attachments).toEqual(remote.notes[NOTE_EMPTY_ID].attachments);
  });
  it("keeps unrelated attachment edits applicable despite a tier-list body conflict", () => {
    const base = database(), local = structuredClone(base), remote = structuredClone(base);
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = movedSource;
    local.notes[NOTE_EMPTY_ID].attachments.push({ type: "link", url: "https://example.test/", label: "Independent" });
    const content = parseTierList(source); content.title = "Remote title";
    remote.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(content);
    const result = reconcilePatch(remote, diffLibrary(base, local, { changedAt: NOW }));
    expect(result.conflicts.map(c => c.path)).toEqual([bodyPath]);
    expect(result.effective.notes[NOTE_EMPTY_ID].attachments).toEqual(local.notes[NOTE_EMPTY_ID].attachments);
    expect(result.effective.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe(remote.notes[NOTE_EMPTY_ID].bodyMarkdown);
  });
});

it.each(["fields", "whole-note"] as const)("holds owned image asset deletion with a conflicting tier-list %s candidate", mode => {
  const base = database();
  for (const game of Object.values(base.games)) { game.coverAssetId = null; delete game.progressItems; }
  for (const note of Object.values(base.notes)) if (note.id !== NOTE_EMPTY_ID) note.attachments = note.attachments.filter(item => item.type !== "image");
  const local = structuredClone(base), remote = structuredClone(base), content = parseTierList(source);
  content.grades[0].cards = []; local.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(content); local.notes[NOTE_EMPTY_ID].attachments = [];
  garbageCollectUnreferencedAssets(local);
  const remoteContent = parseTierList(source); remoteContent.title = "Remote"; remote.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(remoteContent);
  const patch = diffLibrary(base, local, { changedAt: NOW });
  if (mode === "whole-note") {
    const normalized = normalizeLibraryDatabase(base), target = normalizeLibraryDatabase(local);
    delete patch.operations[bodyPath]; delete patch.operations[`${path}/attachments`];
    patch.operations[path] = { operation: "set", baseExists: true, baseHash: canonicalHash(normalized.notes[NOTE_EMPTY_ID]), value: target.notes[NOTE_EMPTY_ID], changedAt: NOW, transactionId: "whole-note" };
  }
  const result = reconcilePatch(remote, patch);
  expect(result.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
  expect(result.effective.assets[IMAGE_ID]).toBeDefined();
  expect(result.conflicts.map(c => c.path)).toContain(`/assets/${IMAGE_ID}`);
  for (const row of result.conflicts) {
    const keepStatic = resolveConflict(remote, result.patch, row.path, { choice: "static" });
    expect(keepStatic.conflicts).toEqual([]); expect(keepStatic.effective.assets[IMAGE_ID]).toBeDefined();
    const keepLocal = resolveConflict(remote, result.patch, row.path, { choice: "local" });
    expect(keepLocal.conflicts).toEqual([]); expect(keepLocal.effective.assets[IMAGE_ID]).toBeUndefined();
  }
});

it.each(["fields", "whole-note"] as const)("exposes a recoverable %s conflict after the remote image asset was removed globally", mode => {
  const base = database();
  for (const game of Object.values(base.games)) { game.coverAssetId = null; delete game.progressItems; }
  for (const note of Object.values(base.notes)) if (note.id !== NOTE_EMPTY_ID) note.attachments = note.attachments.filter(item => item.type !== "image");
  const local = structuredClone(base), remote = structuredClone(base), content = parseTierList(source);
  const localContent = parseTierList(source); localContent.title = "Local title";
  local.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(localContent);
  content.grades[0].cards = []; remote.notes[NOTE_EMPTY_ID].bodyMarkdown = serializeTierList(content); remote.notes[NOTE_EMPTY_ID].attachments = [];
  garbageCollectUnreferencedAssets(remote);
  expect(validateLibrary(remote).ok).toBe(true);
  const patch = diffLibrary(base, local, { changedAt: NOW });
  if (mode === "whole-note") {
    const normalized = normalizeLibraryDatabase(base), target = normalizeLibraryDatabase(local);
    delete patch.operations[bodyPath]; delete patch.operations[`${path}/attachments`];
    patch.operations[path] = { operation: "set", baseExists: true, baseHash: canonicalHash(normalized.notes[NOTE_EMPTY_ID]), value: target.notes[NOTE_EMPTY_ID], changedAt: NOW, transactionId: "whole-note" };
  }
  const result = reconcilePatch(remote, patch);
  expect(validateLibrary(result.effective).ok).toBe(true);
  expect(result.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
  expect(result.conflicts.map(c => c.path).sort()).toEqual(mode === "whole-note" ? [path] : [`${path}/attachments`, bodyPath]);
  for (const row of result.conflicts) {
    expect(() => resolveConflict(remote, result.patch, row.path, { choice: "local" })).toThrow(/изображение.*недоступно/i);
    const keepStatic = resolveConflict(remote, result.patch, row.path, { choice: "static" });
    expect(keepStatic.conflicts).toEqual([]); expect(validateLibrary(keepStatic.effective).ok).toBe(true);
  }
});
