import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  document.head.querySelectorAll("style[data-sidebar-layout-test]").forEach((style) => style.remove());
  document.body.replaceChildren();
});

describe("top sidebar layout", () => {
  it("uses the approved one-column page and three-column desktop sidebar", () => {
    const style = document.createElement("style");
    style.dataset.sidebarLayoutTest = "true";
    style.textContent = productionStyles;
    document.head.append(style);

    const layout = document.createElement("div");
    layout.className = "game-view-layout game-view-layout--sidebar-top";
    const sidebar = document.createElement("aside");
    sidebar.className = "game-sidebar";
    const cover = document.createElement("button");
    cover.className = "game-sidebar__cover";
    const title = document.createElement("h1");
    const metadata = document.createElement("dl");
    metadata.className = "game-sidebar__meta";
    const progress = document.createElement("div");
    progress.className = "game-progress";
    const tools = document.createElement("div");
    tools.className = "game-sidebar__tools";
    const error = document.createElement("p");
    error.className = "inline-save-error";
    sidebar.append(cover, title, metadata, progress, tools, error);
    layout.append(sidebar);
    document.body.append(layout);

    expect(getComputedStyle(layout).gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(getComputedStyle(sidebar).position).toBe("static");
    expect(getComputedStyle(sidebar).display).toBe("grid");
    expect(getComputedStyle(sidebar).gridTemplateColumns).toBe("160px minmax(160px, 1fr) minmax(300px, 420px)");
    expect(getComputedStyle(cover).gridColumn).toBe("1");
    expect(getComputedStyle(metadata).gridColumn).toBe("2");
    expect(getComputedStyle(progress).gridColumn).toBe("3");
  });
});
