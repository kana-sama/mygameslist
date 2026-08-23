import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  document.head.querySelectorAll("style[data-sidebar-layout-test]").forEach((style) => style.remove());
  document.body.replaceChildren();
});

describe("top sidebar layout", () => {
  it("uses the approved one-column page and compact desktop sidebar tracks", () => {
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
    const titleTrigger = document.createElement("button");
    titleTrigger.className = "inline-value-trigger";
    title.append(titleTrigger);
    const metadata = document.createElement("dl");
    metadata.className = "game-sidebar__meta";
    const progress = document.createElement("div");
    progress.className = "game-progress";
    const progressGrid = document.createElement("div");
    progressGrid.className = "game-progress__grid";
    progress.append(progressGrid);
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
    expect(getComputedStyle(sidebar).gridTemplateColumns).toBe("160px minmax(320px, 360px) minmax(0, 1fr) auto");
    expect(getComputedStyle(cover).gridColumn).toBe("1");
    expect(getComputedStyle(cover).gridRow).toBe("1 / span 2");
    expect(getComputedStyle(title).minWidth).toBe("0px");
    expect(getComputedStyle(title).overflow).toBe("hidden");
    expect(getComputedStyle(title).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(titleTrigger).overflow).toBe("hidden");
    expect(getComputedStyle(titleTrigger).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(titleTrigger).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(metadata).gridColumn).toBe("2");
    expect(getComputedStyle(progress).gridColumn).toBe("3");
    expect(getComputedStyle(progressGrid).gridTemplateColumns).toBe("repeat(auto-fit, minmax(88px, 96px))");
    expect(getComputedStyle(progressGrid).justifyContent).toBe("start");
    expect(getComputedStyle(tools).gridColumn).toBe("4");
    expect(getComputedStyle(tools).gridRow).toBe("1 / span 2");
    expect(getComputedStyle(tools).flexDirection).toBe("column");
    expect(getComputedStyle(error).gridColumn).toBe("2");
    expect(getComputedStyle(error).gridRow).toBe("3");
  });

  it("reserves a separate narrow tools track before progress moves below the metadata", () => {
    expect(productionStyles).toMatch(/@media \(max-width: 1019px\) \{[\s\S]*?\.game-view-layout--sidebar-top \.game-sidebar \{ grid-template-columns: 112px minmax\(0, 1fr\) 26px; column-gap: 10px; \}[\s\S]*?\.game-view-layout--sidebar-top \.game-sidebar__tools \{ grid-column: 3; grid-row: 1 \/ span 2;/);
    expect(productionStyles).toMatch(/@media \(max-width: 500px\) \{[\s\S]*?\.game-view-layout--sidebar-top \.game-sidebar \{ grid-template-columns: 96px minmax\(0, 1fr\) 26px; \}/);
    expect(productionStyles).toMatch(/@media \(min-width: 1020px\) and \(max-width: 1100px\) \{[\s\S]*?grid-template-columns: 160px 320px minmax\(0, 1fr\) 26px; column-gap: 10px;/);
  });
});
