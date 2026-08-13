import { useMemo, useSyncExternalStore } from "react";

export interface LibraryStore<Snapshot> {
  getSnapshot: () => Snapshot;
  subscribe: (listener: () => void) => () => void;
  replaceSnapshot: (snapshot: Snapshot) => void;
}

export function createLibraryStore<Snapshot>(initialSnapshot: Snapshot): LibraryStore<Snapshot> {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const replaceSnapshot = (nextSnapshot: Snapshot) => {
    if (Object.is(snapshot, nextSnapshot)) return;
    snapshot = nextSnapshot;
    listeners.forEach((listener) => listener());
  };

  return { getSnapshot, subscribe, replaceSnapshot };
}

export function useLibraryStoreSelector<Snapshot, Selection>(
  store: LibraryStore<Snapshot>,
  selector: (snapshot: Snapshot) => Selection,
  isEqual: (left: Selection, right: Selection) => boolean = Object.is,
): Selection {
  const getSelection = useMemo(() => {
    let initialized = false;
    let previousSnapshot: Snapshot;
    let previousSelection: Selection;
    return () => {
      const snapshot = store.getSnapshot();
      if (initialized && Object.is(snapshot, previousSnapshot)) return previousSelection;
      const selection = selector(snapshot);
      previousSnapshot = snapshot;
      if (initialized && isEqual(previousSelection, selection)) return previousSelection;
      initialized = true;
      previousSelection = selection;
      return selection;
    };
  }, [isEqual, selector, store]);

  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}
