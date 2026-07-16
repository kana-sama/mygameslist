import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("notes masonry CSS", () => {
  it("uses a measured grid instead of WebKit multicolumn fragmentation", () => {
    const container = declarationsFor(".notes-list, .note-editors-grid");
    const cards = declarationsFor(".note-card");

    expect(container).toMatch(/display:\s*grid/);
    expect(container).toMatch(/repeat\(auto-fit,\s*minmax\(min\(360px,\s*100%\),\s*1fr\)\)/);
    expect(container).toMatch(/grid-auto-rows:\s*1px/);
    expect(container).toMatch(/gap:\s*7px/);
    expect(container).not.toMatch(/column-/);
    expect(cards).toMatch(/align-self:\s*start/);
    expect(cards).not.toMatch(/break-inside|column-break/);
  });

  it("collapses the masonry to one column on narrow screens", () => {
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.notes-list, \.note-editors-grid \{\s*grid-template-columns:\s*1fr;/);
  });
});
