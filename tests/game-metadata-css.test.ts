import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("compact game metadata", () => {
  it("places status and tier beside each other on one line", () => {
    const metadata = declarations(".game-sidebar__meta");
    const shortField = declarations(".game-sidebar__meta > .game-sidebar__meta-short");

    expect(metadata).toContain("display: grid");
    expect(metadata).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(shortField).toContain("display: flex");
    expect(shortField).toContain("grid-column: auto");
    expect(shortField).toContain("align-items: center");
  });

  it("keeps inline suggestion inputs dense", () => {
    const editor = declarations(".inline-values-editor .tag-input__control");

    expect(editor).toContain("min-height: 28px");
    expect(editor).toContain("gap: 2px");
  });
});
