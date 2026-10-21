import { describe, it, expect } from "vitest";
import { canonicalStringify } from "../src/domain/canonical";
import { assembleSourceTree, projectSourceTree, type SourceTreeEntry } from "../src/source";
import { fixtureDatabase, MemorySourceTreeReader, projectedFiles, GAME_A_DIRECTORY, IMAGE_ID } from "./fixtures/source-tree";
import { addSyntheticSmartNote, SMART_NOTE_ID, SMART_PROGRAMS } from "./fixtures/smart-note";
async function fixture() {
  const projection = await projectSourceTree(addSyntheticSmartNote(fixtureDatabase()));
  const files = new Map<string, Uint8Array>();
  const originals = projectedFiles();
  for (const leaf of projection.leaves) files.set(leaf.path, leaf.kind === "text" ? new TextEncoder().encode(leaf.text) : leaf.kind === "opaque" ? SMART_PROGRAMS.get(leaf.logicalId.slice(`program:${SMART_NOTE_ID}:`.length))! : originals.get(leaf.path)!);
  const directories = new Set<string>();
  for (const path of files.keys()) { const parts = path.split("/"); for(let i=1;i<parts.length;i++) directories.add(parts.slice(0,i).join("/")); }
  const entries: SourceTreeEntry[] = [...[...directories].map(path => ({ kind: "directory" as const, path })), ...[...files.keys()].map(path => ({ kind: "file" as const, path }))];
  return { projection, files, entries };
}
describe("smart source programs", () => {
  it("roundtrips structural state and nested opaque bytes without placing programs in the database", async () => {
    const { projection, files, entries } = await fixture();
    const result = await assembleSourceTree(new MemorySourceTreeReader(entries, files), { sourceCommitSha: null });
    expect(result.database).toEqual(projection.database);
    const note = result.database.notes[SMART_NOTE_ID];
    for (const [path, bytes] of SMART_PROGRAMS) expect(result.runtimePrograms!.get(`${SMART_NOTE_ID}/${note.smart!.program.hash}/${path}`)).toEqual(bytes);
    expect(canonicalStringify(result.database)).not.toContain('export function mount');
    expect(projection.leaves.filter(leaf => leaf.kind === "opaque")).toHaveLength(SMART_PROGRAMS.size);
    expect(projection.leaves.filter(leaf => leaf.path.startsWith(`${GAME_A_DIRECTORY}/smart-notes/${SMART_NOTE_ID}/`) && leaf.kind === "text")).toHaveLength(1);
  });
  it("roundtrips state image ownership and source metadata through the shared game assets", async () => {
    const { files, entries } = await fixture();
    const path = `${GAME_A_DIRECTORY}/smart-notes/${SMART_NOTE_ID}/note.json`;
    const source = JSON.parse(new TextDecoder().decode(files.get(path)));
    source.state = { image: { $asset: IMAGE_ID }, repeated: [{ $asset: IMAGE_ID }] };
    source.assets = [{ assetId: IMAGE_ID, originalName: "shared art.png", alt: "Smart local alt" }];
    files.set(path, new TextEncoder().encode(JSON.stringify(source)));
    const result = await assembleSourceTree(new MemorySourceTreeReader(entries, files), { sourceCommitSha: null });
    expect(result.database.notes[SMART_NOTE_ID].attachments).toEqual([{ type: "image", assetId: IMAGE_ID, alt: "Smart local alt" }]);
    const projected = await projectSourceTree(result.database);
    const metadata = projected.leaves.find(leaf => leaf.path === path)!;
    expect(metadata.kind === "text" && JSON.parse(metadata.text).assets).toEqual(source.assets);
  });
  it("keeps program identity unchanged for state writes and rejects mismatched assets", async () => {
    const { projection, files, entries } = await fixture();
    const path = `${GAME_A_DIRECTORY}/smart-notes/${SMART_NOTE_ID}/note.json`;
    const source = JSON.parse(new TextDecoder().decode(files.get(path)));
    source.state = { arbitrary: [true, null, { deeply: "different" }] };
    files.set(path, new TextEncoder().encode(JSON.stringify(source)));
    const result = await assembleSourceTree(new MemorySourceTreeReader(entries, files), { sourceCommitSha: null });
    expect(result.database.notes[SMART_NOTE_ID].smart).toEqual(projection.database.notes[SMART_NOTE_ID].smart);
    source.assets = [{ assetId: "a".repeat(64), originalName: "extra.webp", alt: "" }];
    files.set(path, new TextEncoder().encode(JSON.stringify(source)));
    await expect(assembleSourceTree(new MemorySourceTreeReader(entries, files), { sourceCommitSha: null })).rejects.toThrow(/assets/);
  });
  it("rejects unsupported program entries and escaping entrypoints", async () => {
    const { entries, files } = await fixture();
    const program = `${GAME_A_DIRECTORY}/smart-notes/${SMART_NOTE_ID}/nested/helper.js`;
    await expect(assembleSourceTree(new MemorySourceTreeReader(entries.map(entry => entry.path === program ? { ...entry, kind: "symlink" } : entry), files), { sourceCommitSha: null })).rejects.toThrow(/unsupported/);
    const path = `${GAME_A_DIRECTORY}/smart-notes/${SMART_NOTE_ID}/note.json`;
    const source = JSON.parse(new TextDecoder().decode(files.get(path))); source.entrypoints.preview = "../escape.js";
    files.set(path, new TextEncoder().encode(JSON.stringify(source)));
    await expect(assembleSourceTree(new MemorySourceTreeReader(entries, files), { sourceCommitSha: null })).rejects.toThrow(/path/);
  });
});
