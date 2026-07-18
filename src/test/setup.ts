import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach } from "vitest";
import { LOCAL_ASSET_DATABASE_NAME } from "../domain/localAssets";

Object.defineProperty(globalThis, "Blob", { configurable: true, writable: true, value: NodeBlob });

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_ASSET_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});
