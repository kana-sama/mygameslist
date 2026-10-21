import { canonicalStringify } from "../domain/canonical";
import { collectSmartAssetIds, smartNoteStateRevision } from "../domain/smartNote";
import type { Asset, ImageAsset, JsonValue, Note, SmartAssetRef } from "../domain/types";

export type SmartNoteMode = "preview" | "page";
export interface SmartNotePageControls { open: () => boolean; close: () => void }
export type SmartNoteBeforeClose = () => void | Promise<void>;
export interface SmartNoteStateSnapshot { value: JsonValue; revision: string }
export interface SmartNoteImageMetadata extends ImageAsset { ref: SmartAssetRef; assetId: string }
export interface SmartNoteApi {
  version: 1;
  mode: SmartNoteMode;
  signal: AbortSignal;
  state: {
    get(): SmartNoteStateSnapshot;
    subscribe(listener: (snapshot: SmartNoteStateSnapshot) => void): () => void;
    update(reducer: (value: JsonValue) => JsonValue): Promise<void>;
    set(value: JsonValue, options: { expectedRevision: string }): Promise<void>;
  };
  assets: {
    list(): SmartNoteImageMetadata[];
    read(ref: SmartAssetRef): Promise<Blob>;
    url(ref: SmartAssetRef): Promise<{ url: string; release: () => void }>;
    upload(blob: Blob, options: { name: string; alt?: string }): Promise<SmartAssetRef>;
    release(ref: SmartAssetRef): void;
  };
  page: SmartNotePageControls & { beforeClose(handler: SmartNoteBeforeClose): () => void };
}
export interface SmartNoteScope { api: SmartNoteApi; prepareClose(): void | Promise<void>; dispose(): void }
export interface PreparedSmartImage { asset: ImageAsset; blob: Blob }
export interface SmartNoteRuntimeAdapter {
  read(noteId: string): { note: Note | undefined; assets: Record<string, Asset>; conflict: boolean };
  subscribe(listener: () => void): () => void;
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  persist(noteId: string, value: JsonValue, images: ReadonlyMap<string, ImageAsset>, signal: AbortSignal): Promise<void>;
  prepareImage(blob: Blob, options: { name: string; alt: string }): Promise<PreparedSmartImage>;
  persistImage(image: PreparedSmartImage): Promise<void>;
  readImage(asset: ImageAsset, signal: AbortSignal): Promise<Blob>;
  holdImage(id: string): Promise<() => void>;
  collectImages(): Promise<void>;
}

/** One factory per library; view scopes share a queue and temporary note ownership. */
export function createSmartNoteRuntime(adapter: SmartNoteRuntimeAdapter) {
  const uploads = new Map<string, Map<string, { asset: ImageAsset; owners: Set<symbol> }>>();
  function createScope(noteId: string, mode: SmartNoteMode, page: SmartNotePageControls): SmartNoteScope {
    const owner = Symbol(noteId);
    const controller = new AbortController();
    const subscriptions = new Set<() => void>();
    const closeHandlers = new Set<SmartNoteBeforeClose>();
    const holds = new Map<string, () => void>();
    const urls = new Set<() => void>();
    const initial = adapter.read(noteId).note;
    if (initial?.format !== "smart" || !initial.smart) throw new Error("Smart note unavailable");
    const programHash = initial.smart.program.hash;
    function active() { if (controller.signal.aborted) throw new Error("Smart note scope disposed"); }
    function current() {
      active();
      const result = adapter.read(noteId);
      if (result.conflict) throw new Error("Smart note conflict requires resolution");
      if (result.note?.format !== "smart" || !result.note.smart || result.note.state === undefined) throw new Error("Smart note unavailable");
      if (result.note.smart.program.hash !== programHash) throw new Error("Smart note program changed; remount required");
      return { ...result, note: result.note };
    }
    function get(): SmartNoteStateSnapshot {
      const { note } = current();
      return { value: structuredClone(note.state!), revision: smartNoteStateRevision(note) };
    }
    function image(ref: SmartAssetRef): ImageAsset {
      const ids = collectSmartAssetIds(ref);
      if (ids.size !== 1 || !Object.hasOwn(ref, "$asset")) throw new Error("Invalid image reference");
      const { note, assets } = current();
      const id = ref.$asset;
      const saved = note.attachments.some(attachment => attachment.type === "image" && attachment.assetId === id);
      const upload = uploads.get(noteId)?.get(id);
      const uploaded = upload?.owners.has(owner) ? upload.asset : undefined;
      const asset = saved ? assets[id] : uploaded;
      if (!asset || asset.kind !== "image") throw new Error("Unknown or foreign smart image reference");
      return asset;
    }
    async function write(reducer: (value: JsonValue) => JsonValue, expectedRevision?: string) {
      active();
      await adapter.enqueue(async () => {
        const snapshot = get();
        if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) throw new Error("Smart state revision conflict");
        const before = canonicalStringify(snapshot.value);
        const next = reducer(snapshot.value);
        const references = collectSmartAssetIds(next);
        const metadata = new Map<string, ImageAsset>();
        for (const id of references) metadata.set(id, image({ $asset: id }));
        if (canonicalStringify(next) === before) return;
        active();
        await adapter.persist(noteId, structuredClone(next), metadata, controller.signal);
      });
    }
    function releaseUpload(id: string) {
      holds.get(id)?.(); holds.delete(id);
      const entry = uploads.get(noteId)?.get(id);
      entry?.owners.delete(owner);
      if (entry?.owners.size === 0) uploads.get(noteId)?.delete(id);
      if (uploads.get(noteId)?.size === 0) uploads.delete(noteId);
    }
    const api: SmartNoteApi = {
      version: 1, mode, signal: controller.signal,
      state: {
        get,
        subscribe(listener) {
          let revision = get().revision;
          const unsubscribe = adapter.subscribe(() => {
            let snapshot: SmartNoteStateSnapshot;
            try { snapshot = get(); } catch { return; }
            if (snapshot.revision === revision) return;
            revision = snapshot.revision;
            try { listener(snapshot); } catch { /* One author's listener cannot fail a durable transition. */ }
          });
          const release = () => { unsubscribe(); subscriptions.delete(release); };
          subscriptions.add(release); return release;
        },
        update: reducer => write(reducer),
        set(value, options) {
          const expectedRevision = options?.expectedRevision;
          if (typeof expectedRevision !== "string" || !/^[0-9a-f]{64}$/.test(expectedRevision)) return Promise.reject(new Error("Smart state expected revision required"));
          // Freeze the requested target at invocation, before it waits for the queue.
          try { collectSmartAssetIds(value); const target = structuredClone(value); return write(() => target, expectedRevision); }
          catch (error) { return Promise.reject(error); }
        },
      },
      assets: {
        list() {
          const { note } = current();
          return note.attachments.map(attachment => {
            if (attachment.type !== "image") throw new Error("Invalid smart image attachment");
            const asset = image({ $asset: attachment.assetId });
            return { ...structuredClone(asset), alt: attachment.alt, ref: { $asset: asset.id }, assetId: asset.id };
          });
        },
        async read(ref) {
          const asset = image(ref);
          const release = await adapter.holdImage(asset.id);
          try { active(); const blob = await adapter.readImage(asset, controller.signal); active(); return blob; }
          finally { release(); }
        },
        async url(ref) {
          const asset = image(ref);
          const releaseHold = await adapter.holdImage(asset.id);
          try {
            active();
            const blob = await adapter.readImage(asset, controller.signal);
            active();
            const url = URL.createObjectURL(blob);
            let released = false;
            const release = () => { if (released) return; released = true; URL.revokeObjectURL(url); releaseHold(); urls.delete(release); };
            urls.add(release); return { url, release };
          } catch (error) { releaseHold(); throw error; }
        },
        async upload(blob, options) {
          current();
          if (!(blob instanceof Blob) || typeof options.name !== "string" || !options.name.trim() || options.alt !== undefined && typeof options.alt !== "string") throw new Error("Invalid smart image upload");
          const prepared = await adapter.prepareImage(blob, { name: options.name, alt: options.alt ?? "" });
          active();
          const release = await adapter.holdImage(prepared.asset.id);
          let installed = false;
          try {
            active();
            await adapter.persistImage(prepared);
            active();
            if (holds.has(prepared.asset.id)) release(); else holds.set(prepared.asset.id, release);
            const noteUploads = uploads.get(noteId) ?? new Map();
            const entry = noteUploads.get(prepared.asset.id) ?? { asset: prepared.asset, owners: new Set<symbol>() };
            entry.owners.add(owner); noteUploads.set(prepared.asset.id, entry); uploads.set(noteId, noteUploads);
            installed = true;
            return { $asset: prepared.asset.id };
          } finally {
            if (!installed) { release(); void adapter.collectImages().catch(() => undefined); }
          }
        },
        release(ref) { active(); const ids = collectSmartAssetIds(ref); if (ids.size !== 1 || !Object.hasOwn(ref, "$asset")) throw new Error("Invalid image reference"); releaseUpload(ref.$asset); void adapter.collectImages().catch(() => undefined); },
      },
      page: {
        open: () => { current(); return initial.smart?.entrypoints.page ? page.open() : false; },
        close: () => { active(); page.close(); },
        beforeClose(handler) { active(); closeHandlers.add(handler); return () => { closeHandlers.delete(handler); }; },
      },
    };
    return { api, prepareClose() {
      active();
      if (!closeHandlers.size) return;
      return (async () => { for (const handler of [...closeHandlers]) { active(); await handler(); } active(); })();
    }, dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      closeHandlers.clear();
      for (const unsubscribe of subscriptions) unsubscribe();
      for (const release of urls) release();
      for (const id of [...holds.keys()]) releaseUpload(id);
      void adapter.collectImages().catch(() => undefined);
    } };
  }
  return { createScope };
}
