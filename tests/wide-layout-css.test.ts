import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("wide desktop layout", () => {
  it("lets page content and the shared header use the full viewport width", () => {
    const page = declarations(".page");
    const header = declarations(".app-header");
    const pageRules = [...styles.matchAll(/\.page\s*\{([^}]*)\}/g)].map((match) => match[1]);
    const headerRules = [...styles.matchAll(/\.app-header\s*\{([^}]*)\}/g)].map((match) => match[1]);

    expect(page).toContain("width: 100%");
    expect(page).toContain("margin: 0");
    expect(page).toContain("padding: 18px 14px 54px");
    expect(header).toContain("padding: 0 14px");
    for (const rule of pageRules) {
      expect(rule).not.toContain("margin: 0 auto");
      expect(rule).not.toContain("width: min(");
      expect(rule).not.toContain("width: calc(100% -");
    }
    for (const rule of headerRules) {
      expect(rule).not.toContain("1540px");
      expect(rule).not.toContain("100vw");
    }
  });

  it("adds catalog columns as horizontal space becomes available", () => {
    const catalog = declarations(".catalog-list");

    expect(catalog).toContain("repeat(auto-fill, minmax(min(460px, 100%), 1fr))");
    expect(catalog).not.toContain("repeat(3");
    const columnsAt2560 = Math.floor(((2560 - 28) + 6) / (460 + 6));
    expect(columnsAt2560).toBe(5);
  });
});
