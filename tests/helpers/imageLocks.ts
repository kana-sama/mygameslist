/** Implements the shared/nonblocking subset used by browser image ownership. */
export class ImageLocks {
  held = new Map<string, { shared: number; exclusive: boolean }>();
  async request<T>(name: string, options: LockOptions, callback: (lock: Lock | null) => T | Promise<T>): Promise<T> {
    const state = this.held.get(name) ?? { shared: 0, exclusive: false };
    const shared = options.mode === "shared";
    if (state.exclusive || !shared && state.shared > 0) {
      if (!options.ifAvailable) throw new Error("Test lock unexpectedly blocks");
      return callback(null);
    }
    if (shared) state.shared++; else state.exclusive = true;
    this.held.set(name, state);
    try { return await callback({ name, mode: shared ? "shared" : "exclusive" } as Lock); }
    finally { if (shared) state.shared--; else state.exclusive = false; }
  }
}
