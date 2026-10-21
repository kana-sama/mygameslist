import { describe, expect, it, vi } from "vitest";
import { createSmartNoteRuntime, type SmartNoteRuntimeAdapter } from "../src/state/smartNoteRuntime";
import type { JsonValue, Note } from "../src/domain/types";

function setup() {
  let note: Note = { id: "note", gameId: "game", format: "smart", bodyMarkdown: "", attachments: [], state: { count: 0 }, rank: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", smart: { version: 1, apiVersion: 1, title: "Counter", entrypoints: { preview: "preview.js" }, program: { hash: "a".repeat(64), files: [] } } };
  const listeners = new Set<() => void>();
  let queue = Promise.resolve();
  const persist = vi.fn(async (value: JsonValue) => { note = { ...note, state: structuredClone(value) }; listeners.forEach(fn => fn()); });
  const adapter: SmartNoteRuntimeAdapter = {
    read: () => ({ note, assets: {}, conflict: false }),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    enqueue: operation => { const pending = queue.then(operation); queue = pending.then(() => undefined, () => undefined); return pending; },
    persist: (_id, value) => persist(value),
    prepareImage: async () => { throw new Error("unused"); },
    persistImage: async () => undefined,
    readImage: async () => { throw new Error("unused"); },
    holdImage: async () => () => undefined,
    collectImages: async () => undefined,
  };
  const runtime = createSmartNoteRuntime(adapter);
  const preview = runtime.createScope("note", "preview", { open: () => false, close: () => undefined });
  const page = runtime.createScope("note", "page", { open: () => true, close: () => undefined });
  return { runtime, preview, page, persist, adapter, replace: (next: Note) => { note = next; }, getNote: () => note };
}

describe("smart scoped state", () => {
  it("serializes reducers from both views over durable latest state and returns independent snapshots", async () => {
    const { preview, page, persist } = setup();
    const received: JsonValue[] = [];
    preview.api.state.subscribe(snapshot => received.push(snapshot.value));
    const snapshot = preview.api.state.get();
    (snapshot.value as { count: number }).count = 90;
    expect(page.api.state.get().value).toEqual({ count: 0 });
    await Promise.all([preview.api.state.update(value => ({ count: (value as { count: number }).count + 1 })), page.api.state.update(value => ({ count: (value as { count: number }).count + 1 }))]);
    expect(page.api.state.get().value).toEqual({ count: 2 });
    expect(received).toEqual([{ count: 1 }, { count: 2 }]);
    expect(persist).toHaveBeenCalledTimes(2);
  });
  it("checks revisions inside the queue and leaves no-op writes untouched", async () => {
    const { preview, page, persist } = setup();
    const revision = preview.api.state.get().revision;
    await page.api.state.update(() => ({ count: 1 }));
    await expect(preview.api.state.set({ count: 9 }, { expectedRevision: revision })).rejects.toThrow(/conflict/i);
    await page.api.state.update(value => value);
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid JSON, foreign refs, async reducers and disposed queued writes", async () => {
    const { preview, persist } = setup();
    await expect(preview.api.state.update(() => ({ missing: undefined }) as unknown as JsonValue)).rejects.toThrow();
    await expect(preview.api.state.update(() => ({ $asset: "b".repeat(64) }))).rejects.toThrow(/image/i);
    await expect(preview.api.state.update((async () => ({})) as never)).rejects.toThrow();
    const write = preview.api.state.update(() => ({}));
    preview.dispose();
    await expect(write).rejects.toThrow(/disposed/i);
    expect(preview.api.signal.aborted).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
  it("requires a revision token for full replacement from vanilla JavaScript", async () => {
    const { preview, persist } = setup();
    await expect(preview.api.state.set({}, {} as never)).rejects.toThrow(/revision/i);
    await expect(preview.api.state.set({}, { expectedRevision: undefined } as never)).rejects.toThrow(/revision/i);
    expect(persist).not.toHaveBeenCalled();
  });
  it("keeps unsaved uploads private to the uploading representation", async () => {
    const { preview, page, adapter, getNote, replace } = setup();
    const id = "b".repeat(64);
    const blob = new Blob(["image"]);
    adapter.prepareImage = async () => ({ asset: { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: blob.size, alt: "", originalName: "synthetic.png" }, blob });
    adapter.readImage = async () => blob;
    const ref = await preview.api.assets.upload(blob, { name: "synthetic.png" });
    expect(await preview.api.assets.read(ref)).toBe(blob);
    await expect(page.api.assets.read(ref)).rejects.toThrow(/foreign/i);
    await expect(page.api.state.update(() => ({ image: ref }))).rejects.toThrow(/foreign/i);
    const prepared = await adapter.prepareImage(blob, { name: "synthetic.png", alt: "" });
    const read = adapter.read;
    adapter.read = id => ({ ...read(id), assets: { [prepared.asset.id]: prepared.asset } });
    adapter.persist = async (_id, value) => { replace({ ...getNote(), state: value, attachments: [{ type: "image", assetId: prepared.asset.id, alt: "" }] }); };
    await preview.api.state.update(() => ({ image: ref }));
    expect(await page.api.assets.read(ref)).toBe(blob);
    preview.dispose(); page.dispose();
  });
  it("cleans failed and disposed in-flight uploads without leaving a hold", async () => {
    const { preview, adapter } = setup();
    const id = "b".repeat(64), blob = new Blob(["image"]), release = vi.fn();
    adapter.prepareImage = async () => ({ asset: { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: blob.size, alt: "", originalName: "synthetic.png" }, blob });
    adapter.holdImage = async () => release;
    let finish!: () => void;
    adapter.persistImage = () => new Promise<void>(resolve => { finish = resolve; });
    adapter.collectImages = vi.fn(async () => undefined);
    const upload = preview.api.assets.upload(blob, { name: "synthetic.png" });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    preview.dispose(); finish();
    await expect(upload).rejects.toThrow(/disposed/i);
    expect(release).toHaveBeenCalledTimes(1);
    expect(adapter.collectImages).toHaveBeenCalled();
  });
  it("revokes each generated URL and its byte lease on release or scope disposal", async () => {
    const { preview, adapter } = setup();
    const id = "b".repeat(64), blob = new Blob(["image"]), releases: Array<ReturnType<typeof vi.fn>> = [];
    adapter.prepareImage = async () => ({ asset: { id, kind: "image", mime: "image/webp", width: 1, height: 1, byteLength: blob.size, alt: "", originalName: "synthetic.png" }, blob });
    adapter.holdImage = async () => { const release = vi.fn(); releases.push(release); return release; };
    adapter.readImage = async () => blob;
    const create = vi.fn(() => "blob:synthetic"), revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const ref = await preview.api.assets.upload(blob, { name: "synthetic.png" });
    const first = await preview.api.assets.url(ref), second = await preview.api.assets.url(ref);
    first.release(); first.release(); preview.dispose();
    expect(create).toHaveBeenCalledTimes(2); expect(revoke).toHaveBeenCalledTimes(2);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
    second.release(); expect(revoke).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
  it("does not notify or install failed durable writes and permits retry", async () => {
    const { preview, page, persist } = setup();
    const listener = vi.fn(); page.api.state.subscribe(listener);
    persist.mockRejectedValueOnce(new Error("quota"));
    await expect(preview.api.state.update(() => ({ count: 1 }))).rejects.toThrow("quota");
    expect(page.api.state.get().value).toEqual({ count: 0 });
    expect(listener).not.toHaveBeenCalled();
    await preview.api.state.update(() => ({ count: 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it("blocks code changes and note conflicts in existing scopes", () => {
    const { preview, adapter, getNote } = setup();
    const read = adapter.read;
    adapter.read = id => ({ ...read(id), conflict: true });
    expect(() => preview.api.state.get()).toThrow(/conflict/i);
    adapter.read = () => ({ note: { ...getNote(), smart: { ...getNote().smart!, program: { hash: "b".repeat(64), files: [] } } }, assets: {}, conflict: false });
    expect(() => preview.api.state.get()).toThrow(/program/i);
  });
});
