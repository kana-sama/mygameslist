import { collectSmartAssetIds, smartProgramHash, validateSmartDefinition, validateSmartProgramPath } from "../domain/smartNote";
import { canonicalStringify, sha256Bytes } from "../domain/canonical";
import type { JsonValue, LibraryDatabase, Note, SmartNoteDefinition } from "../domain/types";
import type { SourceTreeReader } from "./types";
export interface SourceSmartNoteDocument {
  format: "smart"; version: 1; apiVersion: 1; id: string; title: string;
  entrypoints: SmartNoteDefinition["entrypoints"];
  rank: number; groupRank?: number; doubleWidth?: boolean; doubleHeight?: boolean;
  createdAt: string; updatedAt: string; state: JsonValue;
  assets: { assetId: string; originalName: string; alt: string }[];
}
export async function parseSmartNoteDocument(reader: SourceTreeReader, directory: string, files: readonly string[], gameId: string): Promise<{ note: Note; document: SourceSmartNoteDocument; programs: Map<string, Uint8Array> }> {
  const bytes = await reader.readFile(`${directory}/note.json`);
  const source: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Smart note document must be an object");
  const value = source as Record<string, unknown>;
  const required = ["format", "version", "apiVersion", "id", "title", "entrypoints", "rank", "createdAt", "updatedAt", "state", "assets"];
  const allowed = [...required, "groupRank", "doubleWidth", "doubleHeight"];
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.includes(key)) || value.format !== "smart") throw new Error("Invalid smart note document fields");
  const document = source as SourceSmartNoteDocument;
  if (document.id !== directory.split("/").at(-1)) throw new Error("Smart note UUID must match its directory");
  const programs = new Map<string, Uint8Array>();
  for (const file of files.filter(path => path.startsWith(`${directory}/`) && path !== `${directory}/note.json`).sort()) {
    const relativePath = file.slice(directory.length + 1); validateSmartProgramPath(relativePath);
    programs.set(relativePath, (await reader.readFile(file)).slice());
  }
  const descriptors = [...programs].map(([path, bytes]) => ({ path, sha256: sha256Bytes(bytes), byteLength: bytes.byteLength }));
  const definition: SmartNoteDefinition = { version: document.version, apiVersion: document.apiVersion, title: document.title, entrypoints: document.entrypoints, program: { hash: smartProgramHash(document, descriptors), files: descriptors } };
  validateSmartDefinition(definition);
  const ids = [...collectSmartAssetIds(document.state)].sort();
  if (!Array.isArray(document.assets) || document.assets.length !== ids.length || document.assets.some((asset, index) => !asset || typeof asset !== "object" || Object.keys(asset).sort().join(",") !== "alt,assetId,originalName" || asset.assetId !== ids[index] || typeof asset.alt !== "string" || typeof asset.originalName !== "string")) throw new Error("Smart note assets must exactly match sorted state references");
  const note: Note = { format: "smart", id: document.id, gameId, smart: definition, state: document.state, bodyMarkdown: "", rank: document.rank, createdAt: document.createdAt, updatedAt: document.updatedAt, attachments: document.assets.map(asset => ({ type: "image", assetId: asset.assetId, alt: asset.alt })) };
  for (const field of ["groupRank", "doubleWidth", "doubleHeight"] as const) if (document[field] !== undefined) Object.assign(note, { [field]: document[field] });
  return { note, document, programs };
}
export function serializeSmartNoteDocument(note: Note, database: LibraryDatabase): string {
  const smart = note.smart!;
  const value: SourceSmartNoteDocument = { format: "smart", version: smart.version, apiVersion: smart.apiVersion, id: note.id, title: smart.title, entrypoints: smart.entrypoints, rank: note.rank, createdAt: note.createdAt, updatedAt: note.updatedAt, state: note.state!, assets: note.attachments.map(attachment => {
    if (attachment.type !== "image") throw new Error("Smart notes only reference images");
    return { assetId: attachment.assetId, alt: attachment.alt, originalName: database.assets[attachment.assetId].originalName };
  }) };
  for (const field of ["groupRank", "doubleWidth", "doubleHeight"] as const) if (note[field] !== undefined) Object.assign(value, { [field]: note[field] });
  return `${canonicalStringify(value)}\n`;
}
export function smartProgramContentType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return ({ js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", woff: "font/woff", woff2: "font/woff2", txt: "text/plain; charset=utf-8", wasm: "application/wasm", mp4: "video/mp4", ico: "image/x-icon", avif: "image/avif", pdf: "application/pdf" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
