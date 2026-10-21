/** A Web Lock lease protects image bytes across scopes and browser tabs. */
const PREFIX = "my-game-library.image-lease.v1.";
export async function holdImageAsset(id: string): Promise<() => void> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error("Web Lock image leases unavailable");
  let release!: () => void;
  const lifetime = new Promise<void>(resolve => { release = resolve; });
  let acquired!: () => void;
  let failed!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  void locks.request(`${PREFIX}${id}`, { mode: "shared" }, async () => { acquired(); await lifetime; }).catch(failed);
  await ready;
  return release;
}

/** Called under the global local-asset mutation lock. Never waits for a live view. */
export async function withoutImageLease<T>(id: string, operation: () => T | Promise<T>): Promise<T | undefined> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return undefined;
  return locks.request(`${PREFIX}${id}`, { mode: "exclusive", ifAvailable: true }, lock => lock ? operation() : undefined);
}

/** Conservative roots from durable authority/recovery records also cover another tab's latest write. */
export function storedAssetProtectionIds(storage: Pick<Storage, "length" | "key" | "getItem">): Set<string> {
  const ids = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key || !/my-game-library\.(?:patch\.|pending-publication|note-interaction-rescue)/.test(key)) continue;
      const raw = storage.getItem(key);
      if (raw) for (const match of raw.matchAll(/[0-9a-f]{64}/g)) ids.add(match[0]);
    }
  } catch { throw new Error("Cannot inspect durable image recovery roots"); }
  return ids;
}

/** Hold every available exclusive lease through one atomic multi-record mutation. */
export async function withoutImageLeases<T>(ids: readonly string[], operation: (available: string[]) => T | Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return operation([]);
  const available: string[] = [];
  const enter = (index: number): Promise<T> => {
    if (index === ids.length) return Promise.resolve(operation(available));
    return locks.request(`${PREFIX}${ids[index]}`, { mode: "exclusive", ifAvailable: true }, lock => {
      if (lock) available.push(ids[index]);
      return enter(index + 1);
    });
  };
  return enter(0);
}
