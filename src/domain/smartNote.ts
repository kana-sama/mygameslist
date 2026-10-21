import { canonicalHash } from "./canonical";
import type { ImageAttachment, Note, SmartNoteDefinition, SmartProgramFile } from "./types";
const SHA256 = /^[0-9a-f]{64}$/;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || ![...required, ...optional].includes(key))) throw new TypeError("Invalid smart note fields");
}
/** Validates JSON without silently dropping unsupported values, accessors or sparse entries. */
export function collectSmartAssetIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const ancestors = new Set<object>();
  function visit(item: unknown): void {
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (!Array.isArray(item) && !object(item)) throw new TypeError("Smart state must be JSON");
    if (ancestors.has(item)) throw new TypeError("Smart state must not contain cycles");
    if (Reflect.ownKeys(item).some(key => typeof key === "symbol")) throw new TypeError("Smart state must not contain symbol keys");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length || Object.getOwnPropertyNames(item).length !== item.length + 1) throw new TypeError("Smart state must not contain sparse or decorated arrays");
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !('value' in descriptor)) throw new TypeError("Smart state must not contain accessors");
          visit(descriptor.value);
        }
      } else {
        if (Object.hasOwn(item, "$asset")) {
          keys(item, ["$asset"]);
          const ref = Object.getOwnPropertyDescriptor(item, "$asset");
          if (!ref || !ref.enumerable || !('value' in ref) || typeof ref.value !== "string" || !SHA256.test(ref.value)) throw new TypeError("Invalid smart image reference");
          ids.add(ref.value);
        } else for (const key of Object.getOwnPropertyNames(item)) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError("Smart state must contain only enumerable JSON data");
          visit(descriptor.value);
        }
      }
    } finally { ancestors.delete(item); }
  }
  visit(value);
  return ids;
}
export function validateSmartProgramPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || /[\\:%?#\u0000-\u001f\u007f]/u.test(path) || path.split("/").some(segment => !segment || segment === "." || segment === "..") || path.split("/")[0].toLowerCase() === "note.json") throw new TypeError("Invalid smart program path");
}
export function smartProgramHash(definition: Pick<SmartNoteDefinition, "version" | "apiVersion" | "entrypoints">, files: SmartProgramFile[]): string {
  return canonicalHash({ version: definition.version, apiVersion: definition.apiVersion, entrypoints: definition.entrypoints, files: [...files].sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
}
export function validateSmartDefinition(value: unknown): asserts value is SmartNoteDefinition {
  if (!object(value)) throw new TypeError("Missing smart note definition");
  keys(value, ["version", "apiVersion", "title", "entrypoints", "program"]);
  if (value.version !== 1 || value.apiVersion !== 1 || typeof value.title !== "string" || !value.title.trim() || value.title.length > 500) throw new TypeError("Unsupported smart note contract");
  if (!object(value.entrypoints) || !object(value.program)) throw new TypeError("Invalid smart program descriptor");
  keys(value.entrypoints, ["preview"], ["page"]); keys(value.program, ["hash", "files"]);
  if (typeof value.program.hash !== "string" || !SHA256.test(value.program.hash) || !Array.isArray(value.program.files) || !value.program.files.length) throw new TypeError("Invalid smart program manifest");
  const paths = new Set<string>();
  const directoryCases = new Map<string, string>();
  let previous = "";
  for (const file of value.program.files) {
    if (!object(file)) throw new TypeError("Invalid smart program file");
    keys(file, ["path", "sha256", "byteLength"]); validateSmartProgramPath(file.path);
    if (file.path <= previous || paths.has(file.path.toLowerCase()) || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || Number(file.byteLength) < 0) throw new TypeError("Invalid smart program file manifest");
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index++) {
      const directory = segments.slice(0, index).join("/");
      const previousDirectory = directoryCases.get(directory.toLowerCase());
      if (previousDirectory !== undefined && previousDirectory !== directory) throw new TypeError("Smart directory case collision");
      directoryCases.set(directory.toLowerCase(), directory);
    }
    const foldedPath = file.path.toLowerCase();
    if ([...paths].some(path => path.startsWith(`${foldedPath}/`) || foldedPath.startsWith(`${path}/`))) throw new TypeError("Smart file/directory collision");
    previous = file.path; paths.add(file.path.toLowerCase());
  }
  if (value.program.hash !== smartProgramHash(value as unknown as SmartNoteDefinition, value.program.files as SmartProgramFile[])) throw new TypeError("Smart program hash disagrees with descriptor");
  for (const path of Object.values(value.entrypoints)) {
    validateSmartProgramPath(path);
    if (!path.endsWith(".js") || !value.program.files.some(file => file.path === path)) throw new TypeError("Smart entrypoint must name an existing .js program file");
  }
}
export function smartNoteImageAttachments(state: unknown): ImageAttachment[] {
  return [...collectSmartAssetIds(state)].sort().map(assetId => ({ type: "image", assetId, alt: "" }));
}
export function smartNoteStateRevision(note: Note): string {
  if (note.format !== "smart" || !note.smart || note.state === undefined) throw new TypeError("Not a smart note");
  collectSmartAssetIds(note.state);
  return canonicalHash({ program: note.smart.program.hash, state: note.state });
}
export function smartProgramBaseUrl(note: Note, baseUrl: string): string {
  if (!note.smart) throw new TypeError("Missing smart note definition");
  return `${baseUrl.replace(/\/?$/, "/")}smart-notes/${encodeURIComponent(note.id)}/${note.smart.program.hash}/`;
}
