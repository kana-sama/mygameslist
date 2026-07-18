import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("catalog search consolidation", () => {
  it("removes the legacy catalog controls and emphasizes the header filters", () => {
    const headerFilters = declarations(".global-game-search__filter-button");
    const chips = declarations(".catalog-active-filters__chips");

    expect(styles).not.toContain(".catalog-controls {");
    expect(styles).not.toContain(".search-field {");
    expect(styles).not.toContain(".filter-row {");
    expect(headerFilters).toContain("display: grid");
    expect(headerFilters).toContain("width: 26px");
    expect(styles).not.toContain(".catalog-active-filters__open");
    expect(chips).toContain("overflow-x: auto");
  });

  it("keeps the header route-independent and expands search to the full narrow viewport", () => {
    expect(styles).not.toContain(".global-game-search.is-catalog {");
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.global-game-search \{[^}]*max-width:\s*30px;/);
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.global-game-search\.is-open \{[^}]*right:\s*0;[^}]*left:\s*0;[^}]*width:\s*100vw;/);
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.global-game-search__popover \{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(declarations(".global-game-search__close")).toContain("display: none");
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.global-game-search\.is-open \.global-game-search__close \{[^}]*display:\s*grid;/);
  });
});
