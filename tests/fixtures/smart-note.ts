import { sha256Bytes } from "../../src/domain/canonical";
import { smartProgramHash } from "../../src/domain/smartNote";
import type { LibraryDatabase } from "../../src/domain/types";
import { GAME_A_ID, NOW } from "./source-tree";
export const SMART_NOTE_ID = "77777777-7777-4777-8777-777777777777";
export const SMART_PROGRAMS = new Map<string, Uint8Array>([
  ["nested/preview.js", new TextEncoder().encode('import { value } from "./helper.js"; export function mount(root) { root.textContent = value; }\r\n')],
  ["nested/helper.js", new TextEncoder().encode('export const value = "Synthetic";\n')],
  ["templates/page.html", new TextEncoder().encode('<p>Opaque template</p>\r\n')],
  ["styles/view.css", new TextEncoder().encode(':host { color: red; }\n')],
  ["static/bytes.bin", new Uint8Array([0, 255, 13, 10])],
]);
export function addSyntheticSmartNote(database: LibraryDatabase): LibraryDatabase {
  const files = [...SMART_PROGRAMS].map(([path,bytes]) => ({ path, sha256: sha256Bytes(bytes), byteLength: bytes.length })).sort((a,b) => a.path < b.path ? -1 : 1);
  const definition = { version: 1 as const, apiVersion: 1 as const, title: "Synthetic smart note", entrypoints: { preview: "nested/preview.js" }, program: { hash: "", files } };
  definition.program.hash = smartProgramHash(definition, files);
  database.notes[SMART_NOTE_ID] = { format: "smart", id: SMART_NOTE_ID, gameId: GAME_A_ID, smart: definition, state: { rows: [1, 2], label: "hello\nworld" }, bodyMarkdown: "", attachments: [], rank: 4096, createdAt: NOW, updatedAt: NOW };
  return database;
}
