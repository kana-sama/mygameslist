import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("notes masonry CSS", () => {
  it("packs note cards into Safari-compatible columns", () => {
    const container = declarationsFor(".notes-list, .note-editors-grid");
    const cards = declarationsFor(".notes-list > .note-card, .note-editors-grid > .note-card");

    expect(container).toMatch(/column-width:\s*360px/);
    expect(container).toMatch(/column-gap:\s*7px/);
    expect(container).not.toMatch(/display:\s*grid/);
    expect(cards).toMatch(/display:\s*inline-block/);
    expect(cards).toMatch(/break-inside:\s*avoid/);
    expect(cards).toMatch(/-webkit-column-break-inside:\s*avoid/);
  });

  it("collapses the masonry to one column on narrow screens", () => {
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.notes-list, \.note-editors-grid \{\s*column-count:\s*1;\s*column-width:\s*auto;/);
  });
});
