import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphNote } from "../src/components/graph/GraphNote";
import { parseGraph } from "../src/domain/graph";
const state = vi.hoisted(() => ({ fail: false }));
vi.mock("../src/components/graph/layoutClient", async () => {
  const { instance } = await import("@viz-js/viz");
  const { layoutGraph } = await import("../src/components/graph/layout");
  const engine = instance();
  return {
    GraphLayoutClient: class {
      async layout(graph: Parameters<typeof layoutGraph>[0], width: number) {
        if (state.fail) throw new Error("Layout failed");
        return layoutGraph(graph, width, await engine);
      }
      dispose() {}
    },
  };
});
beforeEach(() => {
  state.fail = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const source =
  'digraph { label="Synthetic map"; subgraph g { label="Chapter"; a[label="Alpha"]; b[label="Beta",state=doing]; info[label="<img src=x onerror=alert(1)>",task=false,kind=note]; a->b; } }';
describe("graph note controls", () => {
  it("uses the measured initial width and switches chain direction on a one-pixel resize", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 717, 100));
    let resize!: (width: number) => void;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
        resize = (width) => callback([{ contentRect: { width } }]);
      }
      observe() {}
      disconnect() {}
    });
    const { container } = render(<GraphNote source="digraph { before; subgraph g { a;b;c; a->b->c; } after; before->g->after; }" />);
    await screen.findByText("a");
    const canvas = container.querySelector(".graph-note__canvas") as HTMLElement;
    const a = container.querySelector("[data-graph-node=a]") as HTMLElement;
    const b = container.querySelector("[data-graph-node=b]") as HTMLElement;
    expect(canvas.style.width).toBe("717px");
    expect(a.style.top).toBe(b.style.top);
    act(() => resize(424));
    await waitFor(() => expect(canvas.style.width).toBe("424px"));
    expect(a.style.top).toBe(b.style.top);
    act(() => resize(423));
    await waitFor(() => expect(canvas.style.width).toBe("423px"));
    expect(a.style.top).not.toBe(b.style.top);
    act(() => resize(424));
    await waitFor(() => expect(canvas.style.width).toBe("424px"));
    expect(a.style.top).toBe(b.style.top);
  });

  it("renders inert text and emits source-preserving node and group edits", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <GraphNote source={source} onSourceChange={onChange} />,
    );
    const a = await screen.findByRole("checkbox", { name: /Alpha/ });
    expect(container.querySelector("[data-graph-node=info]")).toHaveTextContent(
      "<img src=xonerror=alert(1)>",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.click(a, { shiftKey: true });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(parseGraph(onChange.mock.calls[0][0]).nodes[0].state).toBe("doing");
    fireEvent.click(screen.getByRole("checkbox", { name: /Chapter/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(
      parseGraph(onChange.mock.calls[1][0]).nodes.map((n) => n.state),
    ).toEqual(["done", "done", "todo"]);
  });
  it("retains the focused control while disabled and blocks overlapping asynchronous saves", async () => {
    let resolve!: () => void;
    const onChange = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const { rerender } = render(
      <GraphNote source={source} onSourceChange={onChange} />,
    );
    const a = await screen.findByRole("checkbox", { name: /Alpha/ });
    a.focus();
    fireEvent.click(a);
    fireEvent.click(a);
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(<GraphNote source={source} onSourceChange={onChange} disabled />);
    expect(a).toHaveFocus();
    expect(a).toHaveAttribute("aria-disabled", "true");
    resolve();
    await waitFor(() => expect(a).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(a);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("reports a failed save without changing source and supports keyboard toggles", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("Save failed"));
    render(<GraphNote source={source} onSourceChange={onChange} />);
    const a = await screen.findByRole("checkbox", { name: /Alpha/ });
    fireEvent.keyDown(a, { key: " " });
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(a).toHaveAttribute("aria-checked", "false");
  });
  it("shows invalid and empty states, and retries a worker error", async () => {
    const { rerender } = render(<GraphNote source="digraph {" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<GraphNote source="digraph {}" />);
    expect(screen.getByText("Граф пуст")).toBeInTheDocument();
    state.fail = true;
    rerender(<GraphNote source={source} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Layout failed");
    state.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});
