import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLibraryStore, useLibraryStoreSelector } from "../src/state/libraryStore";

afterEach(cleanup);

describe("library selector store", () => {
  it("keeps its read and subscription boundaries stable while replacing snapshots", () => {
    const initial = { count: 0 };
    const store = createLibraryStore(initial);
    const getSnapshot = store.getSnapshot;
    const subscribe = store.subscribe;
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe(initial);
    store.replaceSnapshot({ count: 1 });

    expect(store.getSnapshot).toBe(getSnapshot);
    expect(store.subscribe).toBe(subscribe);
    expect(store.getSnapshot()).toEqual({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.replaceSnapshot({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not rerender a selector whose selected reference is unchanged", () => {
    const selected = { label: "stable" };
    const store = createLibraryStore({ selected, unrelated: 0 });
    const renders = vi.fn();

    function Probe() {
      const value = useLibraryStoreSelector(store, (snapshot) => snapshot.selected);
      renders();
      return <span>{value.label}</span>;
    }

    render(<Probe />);
    expect(screen.getByText("stable")).toBeInTheDocument();
    expect(renders).toHaveBeenCalledTimes(1);

    act(() => store.replaceSnapshot({ selected, unrelated: 1 }));

    expect(renders).toHaveBeenCalledTimes(1);
  });
});
