import { describe, expect, it } from "vitest";
import { collectSmartAssetIds, smartNoteStateRevision, smartProgramBaseUrl, smartProgramHash, validateSmartDefinition } from "../src/domain/smartNote";
import { canonicalHash } from "../src/domain/canonical";
import type { Note } from "../src/domain/types";
const hash = "a".repeat(64);
const smart = { version: 1 as const, apiVersion: 1 as const, title: "Synthetic", entrypoints: { preview: "nested/preview.js" }, program: { hash, files: [{ path: "nested/preview.js", sha256: hash, byteLength: 1 }] } };
smart.program.hash = smartProgramHash(smart, smart.program.files);
describe("smart note structural contracts", () => {
  it("preserves legacy program identity for absent/default1 versions and invalidates bumped schemas", () => {
    const legacy = canonicalHash({ version: smart.version, apiVersion: smart.apiVersion, entrypoints: smart.entrypoints, files: smart.program.files });
    expect(smartProgramHash(smart, smart.program.files)).toBe(legacy);
    expect(smartProgramHash({ ...smart, stateVersion: 1 }, smart.program.files)).toBe(legacy);
    expect(smartProgramHash({ ...smart, stateVersion: 2 }, smart.program.files)).not.toBe(legacy);
    const versioned = { ...smart, stateVersion: 2, program: { ...smart.program, hash: smartProgramHash({ ...smart, stateVersion: 2 }, smart.program.files) } };
    expect(() => validateSmartDefinition(versioned)).not.toThrow();
    for (const stateVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) expect(() => validateSmartDefinition({ ...smart, stateVersion })).toThrow();
  });
  it("collects recursive exact image refs and rejects non-JSON or malformed reserved markers", () => {
    expect([...collectSmartAssetIds({ rows: [{ $asset: hash }, { again: { $asset: hash } }] })]).toEqual([hash]);
    for (const invalid of [undefined, NaN, new Date(), { $asset: hash, other: true }, { $asset: "bad" }, [, 1]]) expect(() => collectSmartAssetIds(invalid)).toThrow();
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    expect(() => collectSmartAssetIds(cyclic)).toThrow();
  });
  it("rejects unsafe or missing program entrypoints", () => {
    expect(() => validateSmartDefinition(smart)).not.toThrow();
    for (const path of ["../escape.js", "/absolute.js", "a\\b.js", "note.json", "a//b.js", "a%2fb.js", "https:evil.js", "Note.json"]) {
      expect(() => validateSmartDefinition({ ...smart, entrypoints: { preview: path } })).toThrow();
    }
  });
  it("binds revision to state/program while serving a stable deployment-relative root", () => {
    const note = { id: "synthetic", format: "smart", smart, state: {}, gameId: "synthetic", bodyMarkdown: "", attachments: [], rank: 1, createdAt: "", updatedAt: "" } as Note;
    expect(smartNoteStateRevision(note)).not.toBe(smartNoteStateRevision({ ...note, state: { value: 1 } }));
    expect(smartNoteStateRevision(note)).not.toBe(smartNoteStateRevision({ ...note, smart: { ...smart, program: { ...smart.program, hash: "b".repeat(64) } } }));
    expect(smartProgramBaseUrl(note, "/library/")).toBe(`/library/smart-notes/synthetic/${smart.program.hash}/`);
  });
});
