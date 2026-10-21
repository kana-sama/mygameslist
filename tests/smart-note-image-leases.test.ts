import { afterEach, describe, expect, it, vi } from "vitest";
import { holdImageAsset } from "../src/domain/assetLeases";
import { deleteSafeOrphans, listLocalAssets, makeLocalAsset, sha256Bytes, writeLocalAssetsAtomic } from "../src/domain";

import { ImageLocks } from "./helpers/imageLocks";
afterEach(() => vi.restoreAllMocks());
describe("smart image leases", () => {
  it("protects another mounted scope or tab until every shared holder releases", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: new ImageLocks() });
    const bytes = new TextEncoder().encode("synthetic upload");
    const id = sha256Bytes(bytes), blob = new Blob([bytes], { type: "image/webp" });
    const first = await holdImageAsset(id), second = await holdImageAsset(id);
    await writeLocalAssetsAtomic([makeLocalAsset(id, blob, blob.type)]);
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([]);
    first(); await Promise.resolve();
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([]);
    second(); await Promise.resolve(); await Promise.resolve();
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([id]);
    expect(await listLocalAssets()).toEqual([]);
  });
  it("reads fresh other-tab recovery roots inside collection", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: new ImageLocks() });
    const bytes = new TextEncoder().encode("recoverable upload");
    const id = sha256Bytes(bytes), blob = new Blob([bytes]);
    await writeLocalAssetsAtomic([makeLocalAsset(id, blob, "image/webp")]);
    localStorage.setItem("my-game-library.pending-publication.v1", JSON.stringify({ roots: [id] }));
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([]);
    localStorage.removeItem("my-game-library.pending-publication.v1");
    expect(await deleteSafeOrphans([], Date.now() + 1)).toEqual([id]);
  });
});
