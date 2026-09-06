import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentStatusIndicator } from "../src/components/DeploymentStatusIndicator";
import type { DeploymentStatusSnapshot } from "../src/state/deploymentStatusModel";

const snapshot: DeploymentStatusSnapshot = {
  state: "current", color: "green", title: "Открыта последняя версия", description: "Страница и база актуальны.",
  documentCommitSha: "a".repeat(40), dataCommitSha: "b".repeat(40), headCommitSha: "c".repeat(40), lastCheckedAt: 1_700_000_000_000,
};
const trigger = () => screen.getByRole("button", { name: /^Версия сайта:/ });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("DeploymentStatusIndicator", () => {
  it("keeps a hover tooltip reachable through the gap and closes after leaving both surfaces", async () => {
    const user = userEvent.setup();
    render(<DeploymentStatusIndicator snapshot={snapshot} />);
    await user.hover(trigger());
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.parentElement).toBe(document.body);
    expect(trigger()).toHaveAttribute("aria-describedby", tooltip.id);
    await user.hover(tooltip);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    await user.unhover(tooltip);
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("forgets hover owned by a removed portal so a later focus tooltip closes on blur", async () => {
    const user = userEvent.setup();
    render(<><DeploymentStatusIndicator snapshot={snapshot} /><button>Outside</button></>);
    await user.hover(trigger());
    await user.hover(screen.getByRole("tooltip"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab();
    expect(trigger()).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps real trigger hover after Escape and a subsequent focus/blur cycle", async () => {
    const user = userEvent.setup();
    render(<><DeploymentStatusIndicator snapshot={snapshot} /><button>Outside</button></>);
    await user.hover(trigger());
    await user.keyboard("{Escape}");
    await user.tab();
    await user.tab();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.unhover(trigger());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 180)); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("supports focus, keyboard pinning and Escape without reopening while focus stays", async () => {
    const user = userEvent.setup();
    render(<><DeploymentStatusIndicator snapshot={snapshot} /><button>Outside</button></>);
    await user.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.tab({ shift: true });
    await user.keyboard(" ");
    await user.keyboard("{Escape}");
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.keyboard(" ");
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("pins on click and closes on second click or outside without performing network or sync work", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const sync = vi.fn();
    const user = userEvent.setup();
    render(<div onSubmit={sync}><DeploymentStatusIndicator snapshot={snapshot} /><button>Outside</button></div>);
    await user.click(trigger());
    await user.unhover(trigger());
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.click(trigger());
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
  });

  it("toggles with touch compatibility clicks without hover reopening", async () => {
    const user = userEvent.setup();
    render(<DeploymentStatusIndicator snapshot={snapshot} />);
    await user.pointer([{ keys: "[TouchA>]", target: trigger() }, { keys: "[/TouchA]", target: trigger() }]);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.pointer([{ keys: "[TouchA>]", target: trigger() }, { keys: "[/TouchA]", target: trigger() }]);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows available version facts, updates an open tooltip and announces only semantic changes", async () => {
    const user = userEvent.setup();
    const view = render(<DeploymentStatusIndicator snapshot={snapshot} />);
    await user.click(trigger());
    const tooltip = screen.getByRole("tooltip");
    for (const sha of ["aaaaaaa", "bbbbbbb", "ccccccc"]) expect(within(tooltip).getByText(sha)).toBeInTheDocument();
    const status = screen.getByRole("status");
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    view.rerender(<DeploymentStatusIndicator snapshot={{ ...snapshot, lastCheckedAt: snapshot.lastCheckedAt! + 30_000 }} />);
    await act(async () => {});
    expect(mutations).toHaveLength(0);
    view.rerender(<DeploymentStatusIndicator snapshot={{ ...snapshot, state: "update-available", color: "red", title: "Доступна новая версия. Обновите страницу" }} />);
    expect(trigger()).toHaveAccessibleName("Версия сайта: Доступна новая версия. Обновите страницу");
    expect(document.querySelector(".deployment-status")).toHaveAttribute("data-color", "red");
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(status).toHaveTextContent("Доступна новая версия");
    observer.disconnect();
  });

  it("uses gray for an unfamiliar state and never invents unknown SHAs", async () => {
    const user = userEvent.setup();
    render(<DeploymentStatusIndicator snapshot={{ ...snapshot, state: "future" as DeploymentStatusSnapshot["state"], documentCommitSha: null, dataCommitSha: null, headCommitSha: null, lastCheckedAt: null }} />);
    expect(document.querySelector(".deployment-status")).toHaveAttribute("data-color", "gray");
    await user.click(trigger());
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("aaaaaaa");
  });

  it("clamps the portal to the viewport and repositions on resize and scroll", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 350, right: 380, bottom: 40, top: 10, width: 30, height: 30, x: 350, y: 10, toJSON() {} });
    vi.stubGlobal("innerWidth", 360);
    render(<DeploymentStatusIndicator snapshot={snapshot} />);
    fireEvent.focus(trigger());
    expect(screen.getByRole("tooltip")).toHaveStyle({ left: "32px", top: "45px", width: "320px" });
    vi.stubGlobal("innerWidth", 300);
    fireEvent.resize(window);
    expect(screen.getByRole("tooltip")).toHaveStyle({ left: "8px", width: "284px" });
    fireEvent.scroll(window);
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });
});
