import { afterEach, describe, expect, it, vi } from "vitest";
import { observeSmartNoteStyles, registerSmartNoteStyleBoundary } from "../src/components/smart/smartNoteStyles";

const disposers: Array<() => void> = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); });
const flush = async () => { await Promise.resolve(); };
function fixture() {
  const root = document.createElement("div"); document.body.append(root);
  const change = vi.fn(), fail = vi.fn();
  const styles = observeSmartNoteStyles(root, change, fail); disposers.push(styles.dispose);
  const link = (parent: HTMLElement | ShadowRoot = root) => {
    const element = document.createElement("link"); element.rel = "stylesheet"; element.href = "/synthetic.css"; parent.append(element); return element;
  };
  return { root, change, fail, styles, link };
}

describe("smart note stylesheet lifecycle", () => {
  it("delegates registered widget roots while continuing to gate arbitrary authored shadows", async () => {
    const f = fixture(), service = document.createElement("div"), authored = document.createElement("div");
    const serviceRoot = service.attachShadow({ mode: "open" }), authoredRoot = authored.attachShadow({ mode: "open" });
    registerSmartNoteStyleBoundary(serviceRoot);
    const serviceLink = f.link(serviceRoot), authoredLink = f.link(authoredRoot);
    f.root.append(service, authored); await flush();
    expect(f.change).toHaveBeenLastCalledWith(true);
    authoredLink.dispatchEvent(new Event("load"));
    expect(f.change).toHaveBeenLastCalledWith(false);
    serviceLink.dispatchEvent(new Event("error")); expect(f.fail).not.toHaveBeenCalled();
    const localChange = vi.fn(), localFail = vi.fn();
    const local = observeSmartNoteStyles(serviceRoot, localChange, localFail); disposers.push(local.dispose);
    expect(localChange).toHaveBeenLastCalledWith(true);
    serviceLink.dispatchEvent(new Event("load")); expect(localChange).toHaveBeenLastCalledWith(false);
    const laterAuthoredLink = f.link(authoredRoot); await flush();
    expect(f.change).toHaveBeenLastCalledWith(true);
    laterAuthoredLink.dispatchEvent(new Event("load")); expect(f.change).toHaveBeenLastCalledWith(false);
  });

  it("does not rescan the full owner for ordinary editor content mutations", async () => {
    const f = fixture(), editor = document.createElement("div"); f.root.append(editor); await flush();
    const scan = vi.spyOn(f.root, "querySelectorAll");
    const line = document.createElement("div"); line.textContent = "Typed text"; editor.append(line); await flush();
    line.textContent = "More text"; line.className = "selected"; await flush();
    expect(scan).not.toHaveBeenCalled();
    f.link(editor); await flush();
    expect(f.change).toHaveBeenLastCalledWith(true);
    scan.mockRestore();
  });
  it("waits for styles in an open shadow attached directly to the mount root", () => {
    const f = fixture(), shadow = f.root.attachShadow({ mode: "open" }), link = f.link(shadow);
    // The host refreshes once asynchronous mount completes, including a shadow
    // created directly on the supplied root without a light-DOM mutation.
    f.styles.refresh();
    expect(f.change).toHaveBeenLastCalledWith(true);
    link.dispatchEvent(new Event("load"));
    expect(f.change).toHaveBeenLastCalledWith(false);
  });

  it("drops removed nested roots and ignores their obsolete load/error events", async () => {
    const f = fixture(), nested = document.createElement("div"), shadow = nested.attachShadow({ mode: "open" });
    const link = f.link(shadow); f.root.append(nested); await flush();
    expect(f.change).toHaveBeenLastCalledWith(true);
    nested.remove(); await flush();
    expect(f.change).toHaveBeenLastCalledWith(false);
    const calls = f.change.mock.calls.length;
    link.dispatchEvent(new Event("load")); link.dispatchEvent(new Event("error"));
    expect(f.change).toHaveBeenCalledTimes(calls); expect(f.fail).not.toHaveBeenCalled();
  });

  it("rechecks href before handling events from an obsolete request", async () => {
    const f = fixture(), link = f.link(); await flush();
    link.href = "/replacement.css";
    // The mutation observer has not run yet, so this listener belongs to the
    // previous request and must not fail or finish the replacement request.
    link.dispatchEvent(new Event("error"));
    expect(f.fail).not.toHaveBeenCalled(); expect(f.change).toHaveBeenLastCalledWith(true);
    link.dispatchEvent(new Event("load")); expect(f.change).toHaveBeenLastCalledWith(false);
  });

  it("stops waiting for links without an active stylesheet relationship", async () => {
    const f = fixture(), link = f.link(); await flush();
    expect(f.change).toHaveBeenLastCalledWith(true);
    link.rel = "preload"; await flush(); expect(f.change).toHaveBeenLastCalledWith(false);
    link.rel = "stylesheet"; await flush(); expect(f.change).toHaveBeenLastCalledWith(true);
    link.removeAttribute("href"); await flush(); expect(f.change).toHaveBeenLastCalledWith(false);
  });

  it("disconnects listeners and mutation observation on teardown", async () => {
    const f = fixture(), link = f.link(); await flush();
    f.styles.dispose(); f.styles.dispose(); f.change.mockClear();
    link.dispatchEvent(new Event("error")); link.dispatchEvent(new Event("load"));
    f.link(); await flush();
    expect(f.fail).not.toHaveBeenCalled(); expect(f.change).not.toHaveBeenCalled();
  });
});
