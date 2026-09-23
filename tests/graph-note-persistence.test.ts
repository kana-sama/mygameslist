// @vitest-environment node
import { describe, expect, it } from "vitest";
import { noteFormat, noteContentTitle, validateNoteContent } from "../src/domain/noteContent";
import { applyPatch, diffLibrary, reconcilePatch, resolveConflict, updateInteractiveNoteField } from "../src/domain/patch";
import { validateLibrary, validatePatch } from "../src/domain/validation";
import { normalizeLibraryDatabase } from "../src/domain/libraryNormalization";
import { buildChangeReview } from "../src/domain/changeReview";
import { resolvePatchSelection } from "../src/domain/patchSelection";
import { parseNoteDocument, serializeNoteDocument } from "../src/source/noteDocument";
import { deriveNoteFilename } from "../src/source/paths";
import { projectSourceTree } from "../src/source/project";
import { assembleSourceTree } from "../src/source/assemble";
import { fixtureDatabase, NOTE_EMPTY_ID, NOW, IMAGE_ID, IMAGE_BYTES, FILE_BYTES } from "./fixtures/source-tree";
import type { PatchConflict } from "../src/domain/types";

const source = 'digraph { label="Map"; a [label="<b>literal</b>", state=todo]; }';
const path = `/notes/${NOTE_EMPTY_ID}`;
const metadata = { id: NOTE_EMPTY_ID, rank: 1024, createdAt: NOW, updatedAt: NOW };
function graphDatabase() {
  const db = fixtureDatabase();
  db.notes[NOTE_EMPTY_ID] = { ...db.notes[NOTE_EMPTY_ID], format: "graph", bodyMarkdown: source };
  return db;
}
function interact(base = graphDatabase(), value = source, conflicts: PatchConflict[] = []) {
  return updateInteractiveNoteField({ base, effective: base, patch: diffLibrary(base, base), conflicts,
    update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value }, changedAt: NOW, transactionId: "graph-check" });
}

describe("graph note persistence", () => {
  it("defaults old notes to Markdown and derives literal graph root titles", () => {
    expect(noteFormat({})).toBe("markdown");
    expect(noteContentTitle({ format: "graph", bodyMarkdown: source })).toBe("Map");
    expect(noteContentTitle({ format: "graph", bodyMarkdown: "digraph { a; }" })).toBeNull();
    expect(validateNoteContent(source, "graph")).toEqual([]);
    expect(validateNoteContent(source)).not.toEqual([]);
    expect(validateNoteContent("digraph { a [color=red]; }", "graph")[0]).toMatch(/1.*\d.*color/);
  });
  it("round-trips graph metadata and source verbatim and omits explicit Markdown", () => {
    const serialized = serializeNoteDocument({ metadata: { ...metadata, format: "graph" }, bodyMarkdown: source }, new Map());
    expect(serialized).toContain("format: graph\n");
    expect(parseNoteDocument(serialized, "graph.md", new Map())).toEqual({ metadata: { ...metadata, format: "graph" }, bodyMarkdown: source });
    expect(serializeNoteDocument({ metadata: { ...metadata, format: "markdown" }, bodyMarkdown: "# Old" }, new Map()))
      .toBe(serializeNoteDocument({ metadata, bodyMarkdown: "# Old" }, new Map()));
    expect(() => serializeNoteDocument({ metadata: { ...metadata, format: "graph" }, bodyMarkdown: "digraph { a [style=filled]; }" }, new Map())).toThrow(/style/);
    expect(() => serializeNoteDocument({ metadata: { ...metadata, format: "bad" as never }, bodyMarkdown: source }, new Map())).toThrow(/format|формат/);
  });
  it("validates the format with the complete candidate and canonicalizes Markdown", () => {
    const db = graphDatabase();
    expect(validateLibrary(db).ok).toBe(true);
    db.notes[NOTE_EMPTY_ID].format = "unknown" as never;
    expect(validateLibrary(db).ok).toBe(false);
    db.notes[NOTE_EMPTY_ID] = { ...db.notes[NOTE_EMPTY_ID], format: "markdown", bodyMarkdown: "# Old" };
    expect(normalizeLibraryDatabase(db).notes[NOTE_EMPTY_ID]).not.toHaveProperty("format");
  });
  it("accepts atomic format/body patches and rejects invalid partial candidates", () => {
    const base = fixtureDatabase(), next = graphDatabase();
    base.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Markdown source";
    const patch = diffLibrary(base, next, { changedAt: NOW });
    expect(validatePatch(patch).ok).toBe(true);
    expect(applyPatch(base, patch).notes[NOTE_EMPTY_ID]).toMatchObject({ format: "graph", bodyMarkdown: source });
    const onlyFormat = { ...patch, operations: { [`${path}/format`]: patch.operations[`${path}/format`] } };
    expect(() => applyPatch(base, onlyFormat)).toThrow();
    const invalid = structuredClone(patch);
    invalid.operations[`${path}/bodyMarkdown`].value = "digraph { a [color=red]; }";
    expect(() => applyPatch(base, invalid)).toThrow();
    const markdown = structuredClone(next);
    delete markdown.notes[NOTE_EMPTY_ID].format;
    markdown.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Back";
    expect(applyPatch(next, diffLibrary(next, markdown)).notes[NOTE_EMPTY_ID]).not.toHaveProperty("format");
  });
  it("validates interactive source using the stored format and rejects format conflicts", () => {
    expect(interact(undefined, source.replace("state=todo", "state=done")).effective.notes[NOTE_EMPTY_ID].bodyMarkdown).toContain("state=done");
    expect(() => interact(undefined, "digraph { a [color=red]; }")).toThrow();
    expect(() => interact(undefined, source, [{ path: `${path}/format` } as PatchConflict])).toThrow(/конфликт/);
  });
  it("rejects stale source/format preconditions and final source above the limit", () => {
    const base = graphDatabase();
    const input = { base, effective: base, patch: diffLibrary(base, base), conflicts: [], changedAt: NOW, transactionId: "stale" };
    expect(() => updateInteractiveNoteField({ ...input, update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value: source, expectedBodyMarkdown: "older", expectedFormat: "graph" } })).toThrow(/измен/);
    expect(() => updateInteractiveNoteField({ ...input, update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value: source, expectedBodyMarkdown: source, expectedFormat: "markdown" } })).toThrow(/измен/);
    expect(() => interact(base, `digraph { a; } //${"x".repeat(102400)}`)).toThrow();
  });
  it("keeps format and body selections atomic even across transactions", () => {
    const base = fixtureDatabase(), next = graphDatabase(), patch = diffLibrary(base, next, { changedAt: NOW });
    patch.operations[`${path}/format`].transactionId = "earlier";
    for (const field of ["format", "bodyMarkdown"]) {
      const selected = resolvePatchSelection(base, next, patch, [{ changeId: "selection", operationPaths: [`${path}/${field}`] }]);
      expect(selected.selectedPaths).toEqual([`${path}/bodyMarkdown`, `${path}/format`]);
    }
  });
  it("reviews graph content as plain source and gives format a readable label", () => {
    const base = fixtureDatabase(), next = graphDatabase();
    const review = buildChangeReview(base, next, diffLibrary(base, next));
    const changes = Object.values(review.changesById);
    expect(changes.some(change => change.title === "Map")).toBe(true);
    const evidence = changes.flatMap(change => change.evidence);
    expect(evidence.some(item => item.type === "source" && item.after === source)).toBe(true);
    expect(evidence.some(item => item.type === "scalar" && item.after.includes("Граф"))).toBe(true);
    expect(evidence.some(item => item.type === "markdown")).toBe(false);
  });
  it("uses the graph root title in source filenames and survives full source assembly", async () => {
    const db = graphDatabase();
    expect(deriveNoteFilename(db.notes[NOTE_EMPTY_ID])).toBe(`map_${NOTE_EMPTY_ID}.md`);
    const projection = await projectSourceTree(db);
    const files = new Map(projection.leaves.map(leaf => [leaf.path, leaf.kind === "text" ? new TextEncoder().encode(leaf.text) : leaf.assetId === IMAGE_ID ? IMAGE_BYTES : FILE_BYTES]));
    const assembled = await assembleSourceTree({ listEntries: async () => {
      const directories = new Set<string>();
      for (const file of files.keys()) { const parts = file.split("/"); for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/")); }
      return [...[...directories].map(path => ({ kind: "directory" as const, path })), ...[...files.keys()].map(path => ({ kind: "file" as const, path }))];
    }, readFile: async path => files.get(path)! }, { sourceCommitSha: null });
    expect(assembled.database.notes[NOTE_EMPTY_ID]).toMatchObject({ format: "graph", bodyMarkdown: source });
  });
});

it("loads graph rescue fallback text before validating it in authoritative note context", async () => {
  const { loadActiveInteractionRescue, INTERACTION_RESCUE_STORAGE_KEY } = await import("../src/state/interactionRescue");
  const { canonicalHash, canonicalStringify } = await import("../src/domain/canonical");
  const raw = canonicalStringify({ version: 1, generations: [{
    ordinaryPatchHash: canonicalHash({ ordinaryPatchRaw: null }), baseRevision: "a".repeat(64),
    supersedingJournalHash: null, entries: [{ noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", source: "fallback", fallbackOperation: "set", fallbackValue: source, changedAt: NOW, transactionId: "graph-rescue" }],
  }] });
  const storage = { getItem: (key: string) => key === INTERACTION_RESCUE_STORAGE_KEY ? raw : null };
  expect(loadActiveInteractionRescue(storage, null, "a".repeat(64))).toMatchObject({ status: "active", entries: [{ fallbackValue: source }] });
});


describe("format and source conflict recovery", () => {
  it.each(["graph", "markdown"] as const)("keeps a local %s conversion atomic against remote source edits", format => {
    const base = format === "graph" ? fixtureDatabase() : graphDatabase();
    if (format === "graph") base.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Original";
    const local = structuredClone(base);
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = format === "graph" ? source : "# Local markdown";
    if (format === "graph") local.notes[NOTE_EMPTY_ID].format = format;
    else delete local.notes[NOTE_EMPTY_ID].format;
    const patch = diffLibrary(base, local, { changedAt: NOW });
    for (const remoteConverts of [false, true]) {
      const remote = structuredClone(remoteConverts ? local : base);
      remote.notes[NOTE_EMPTY_ID].bodyMarkdown = noteFormat(remote.notes[NOTE_EMPTY_ID]) === "graph"
        ? 'digraph { label="Remote"; b; }' : "# Remote edit";
      const reconciled = reconcilePatch(remote, patch);
      expect(reconciled.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
      expect(reconciled.conflicts.map(item => item.path).sort()).toEqual([`${path}/bodyMarkdown`, `${path}/format`]);
      // Either visible conflict row resolves the same complete content candidate.
      for (const field of ["format", "bodyMarkdown"]) {
        const keepLocal = resolveConflict(remote, reconciled.patch, `${path}/${field}`, { choice: "local" });
        expect(keepLocal.conflicts).toEqual([]);
        expect(keepLocal.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(local).notes[NOTE_EMPTY_ID]);
        const keepStatic = resolveConflict(remote, reconciled.patch, `${path}/${field}`, { choice: "static" });
        expect(keepStatic.conflicts).toEqual([]);
        expect(keepStatic.patch.operations).toEqual({});
        expect(keepStatic.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
      }
    }
  });
});

it("round-trips literal envelope markers in validated graph comments through source projection", async () => {
  const bodyMarkdown = 'digraph { /* <!-- mygameslist-note:v1\nmetadata-like comment */ a; }';
  expect(validateNoteContent(bodyMarkdown, "graph")).toEqual([]);
  const document = { metadata: { ...metadata, format: "graph" as const }, bodyMarkdown };
  const serialized = serializeNoteDocument(document, new Map());
  expect(parseNoteDocument(serialized, "literal.md", new Map())).toEqual(document);
  const db = graphDatabase();
  db.notes[NOTE_EMPTY_ID].bodyMarkdown = bodyMarkdown;
  const projection = await projectSourceTree(db);
  expect(projection.leaves.some(leaf => leaf.kind === "text" && leaf.text.includes(bodyMarkdown))).toBe(true);
  expect(() => serializeNoteDocument({ metadata, bodyMarkdown: `\`\`\`\n${bodyMarkdown}\n\`\`\`` }, new Map())).toThrow(/second note envelope/);
});

it("retains unchanged source as part of a format conversion until both fields are published", () => {
  const base = fixtureDatabase();
  base.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { a; }";
  const local = structuredClone(base);
  local.notes[NOTE_EMPTY_ID].format = "graph";
  const patch = diffLibrary(base, local, { changedAt: NOW });
  expect(patch.operations[`${path}/bodyMarkdown`]?.value).toBe("digraph { a; }");
  const pending = reconcilePatch(base, patch);
  expect(pending.patch.operations[`${path}/bodyMarkdown`]?.value).toBe("digraph { a; }");
  const remote = structuredClone(base);
  remote.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Remote text";
  const conflicted = reconcilePatch(remote, pending.patch);
  expect(conflicted.conflicts).toHaveLength(2);
  expect(resolveConflict(remote, conflicted.patch, `${path}/format`, { choice: "local" }).effective.notes[NOTE_EMPTY_ID])
    .toMatchObject({ format: "graph", bodyMarkdown: "digraph { a; }" });
});

it("retains an already published format partner without inventing a conflict", () => {
  const base = fixtureDatabase();
  base.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { a; }";
  const local = structuredClone(base);
  local.notes[NOTE_EMPTY_ID].format = "graph";
  local.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { b; }";
  const remote = structuredClone(base);
  remote.notes[NOTE_EMPTY_ID].format = "graph";
  const pending = reconcilePatch(remote, diffLibrary(base, local, { changedAt: NOW }));
  expect(pending.conflicts).toEqual([]);
  expect(pending.effective.notes[NOTE_EMPTY_ID]).toMatchObject({ format: "graph", bodyMarkdown: "digraph { b; }" });
  expect(pending.patch.operations[`${path}/format`]?.value).toBe("graph");
  expect(applyPatch(remote, pending.patch).notes[NOTE_EMPTY_ID]).toEqual(pending.effective.notes[NOTE_EMPTY_ID]);
  expect(reconcilePatch(local, pending.patch).patch.operations).toEqual({});
});

it("retains conversion source snapshot when a graph interaction returns to the base text", () => {
  const base = fixtureDatabase();
  base.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { a [state=todo]; }";
  const local = structuredClone(base);
  local.notes[NOTE_EMPTY_ID].format = "graph";
  local.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { a [state=done]; }";
  const result = updateInteractiveNoteField({ base, effective: local, patch: diffLibrary(base, local, { changedAt: NOW }), conflicts: [],
    update: { noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", value: base.notes[NOTE_EMPTY_ID].bodyMarkdown }, changedAt: NOW, transactionId: "reset" });
  expect(result.patch.operations[`${path}/bodyMarkdown`]?.value).toBe(base.notes[NOTE_EMPTY_ID].bodyMarkdown);
});

describe("remote conversions against body-only edits", () => {
  it.each(["markdown", "graph"] as const)("preserves the local %s interpretation through remote conversion and conflict resolution", format => {
    const base = format === "graph" ? graphDatabase() : fixtureDatabase();
    if (format === "markdown") base.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Original";
    const local = structuredClone(base);
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = format === "graph" ? 'digraph { label="Local"; b; }' : "# Local edit";
    const patch = diffLibrary(base, local, { changedAt: NOW });
    const remote = structuredClone(base);
    if (format === "markdown") {
      remote.notes[NOTE_EMPTY_ID].format = "graph";
      remote.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { remote; }";
    } else {
      delete remote.notes[NOTE_EMPTY_ID].format;
      remote.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Remote Markdown";
    }
    const reconciled = reconcilePatch(remote, patch);
    expect(reconciled.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
    expect(reconciled.conflicts.map(item => item.path).sort()).toEqual([`${path}/bodyMarkdown`, `${path}/format`]);
    expect(resolveConflict(remote, reconciled.patch, `${path}/bodyMarkdown`, { choice: "local" }).effective.notes[NOTE_EMPTY_ID])
      .toEqual(normalizeLibraryDatabase(local).notes[NOTE_EMPTY_ID]);
    expect(resolveConflict(remote, reconciled.patch, `${path}/format`, { choice: "static" }).effective.notes[NOTE_EMPTY_ID])
      .toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
  });
  it("keeps legacy Markdown edits recoverable after a remote graph conversion", () => {
    const base = fixtureDatabase(), local = fixtureDatabase(), remote = graphDatabase();
    base.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Original";
    local.notes[NOTE_EMPTY_ID].bodyMarkdown = "# Legacy edit";
    const patch = diffLibrary(base, local, { changedAt: NOW });
    delete patch.operations[`${path}/bodyMarkdown`].noteFormat;
    const reconciled = reconcilePatch(remote, patch);
    expect(reconciled.conflicts).toHaveLength(2);
    const resolved = resolveConflict(remote, reconciled.patch, `${path}/bodyMarkdown`, { choice: "local" });
    expect(resolved.effective.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe("# Legacy edit");
    expect(noteFormat(resolved.effective.notes[NOTE_EMPTY_ID])).toBe("markdown");
  });
  it("stores interpretation for interactive graph writes", () => {
    const result = interact(undefined, source.replace("state=todo", "state=done"));
    expect(result.patch.operations[`${path}/bodyMarkdown`].noteFormat).toBe("graph");
  });
});

it.each(["markdown", "graph"] as const)("detects remote mode-only changes despite an unchanged body hash (%s local)", format => {
  const base = fixtureDatabase();
  base.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { a; }";
  if (format === "graph") base.notes[NOTE_EMPTY_ID].format = "graph";
  const local = structuredClone(base);
  local.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { b; }";
  const remote = structuredClone(base);
  if (format === "graph") delete remote.notes[NOTE_EMPTY_ID].format;
  else remote.notes[NOTE_EMPTY_ID].format = "graph";
  const reconciled = reconcilePatch(remote, diffLibrary(base, local, { changedAt: NOW }));
  expect(reconciled.conflicts).toHaveLength(2);
  expect(reconciled.effective.notes[NOTE_EMPTY_ID]).toEqual(normalizeLibraryDatabase(remote).notes[NOTE_EMPTY_ID]);
});

it("rejects invalid or misplaced note-format context and contradictory paired formats", () => {
  const base = fixtureDatabase(), local = graphDatabase();
  const patch = diffLibrary(base, local, { changedAt: NOW });
  const invalid = structuredClone(patch);
  invalid.operations[`${path}/bodyMarkdown`].noteFormat = "bad" as never;
  expect(validatePatch(invalid).ok).toBe(false);
  const wrongPath = structuredClone(patch);
  wrongPath.operations[`${path}/format`].noteFormat = "graph";
  expect(validatePatch(wrongPath).ok).toBe(false);
  const contradictory = structuredClone(patch);
  contradictory.operations[`${path}/bodyMarkdown`].noteFormat = "markdown";
  expect(validatePatch(contradictory).ok).toBe(false);
});

it("does not apply graph-context source as Markdown when its text is valid in either format", () => {
  const base = fixtureDatabase(), local = fixtureDatabase();
  base.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { a; }";
  local.notes[NOTE_EMPTY_ID].bodyMarkdown = "digraph { b; }";
  const patch = diffLibrary(base, local, { changedAt: NOW });
  patch.operations[`${path}/bodyMarkdown`].noteFormat = "graph";
  expect(() => applyPatch(base, patch)).toThrow();
});

it("retains graph interpretation when restoring an interaction from its body operation", async () => {
  const { resolveRescuedNoteInteraction } = await import("../src/state/interactionRescue");
  const interaction = interact(undefined, source.replace("state=todo", "state=done"));
  const restored = resolveRescuedNoteInteraction({ noteId: NOTE_EMPTY_ID, field: "bodyMarkdown", source: "patch", fallbackOperation: null, changedAt: NOW, transactionId: "restore" }, interaction.patch);
  expect(restored?.expectedFormat).toBe("graph");
});
