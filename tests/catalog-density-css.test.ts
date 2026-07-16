import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("compact catalog controls", () => {
  it("places search and filters in one desktop row", () => {
    const controls = declarations(".catalog-controls");
    const search = declarations(".search-field");
    const filters = declarations(".filter-row");

    expect(controls).toContain("display: flex");
    expect(controls).toContain("align-items: center");
    expect(controls).toContain("width: 100%");
    expect(controls).toContain("justify-content: flex-start");
    expect(search).toContain("flex: 0 1 340px");
    expect(search).toContain("margin-left: auto");
    expect(filters).toContain("flex: 0 1 auto");
    expect(filters).toContain("justify-content: flex-start");
    expect(filters).toContain("margin: 0");
    expect(styles).not.toContain(".catalog-subbar");
  });

  it("stacks the controls only on narrow screens", () => {
    expect(styles).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.catalog-controls \{[^}]*flex-direction:\s*column;/);
  });
});
