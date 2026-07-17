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
    expect(container).toMatch(/repeat\(auto-fill,\s*minmax\(min\(360px,\s*100%\),\s*1fr\)\)/);
    expect(container).not.toMatch(/repeat\(auto-fit/);
    expect(container).toMatch(/grid-auto-rows:\s*1px/);
    expect(container).toMatch(/gap:\s*7px/);
    expect(container).not.toMatch(/column-/);
    expect(cards).toMatch(/align-self:\s*start/);
    expect(cards).not.toMatch(/break-inside|column-break/);
  });

  it("collapses the masonry to one column on narrow screens", () => {
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.notes-list, \.note-editors-grid \{\s*grid-template-columns:\s*1fr;/);
  });

  it("keeps add cards outside masonry and reveals them without reserving a column", () => {
    const groups = declarationsFor(".note-groups");
    const group = declarationsFor(".note-group");
    const empty = declarationsFor(".note-empty-group");
    const slot = declarationsFor(".note-group-add-slot");
    const card = declarationsFor(".note-group-add-card");

    expect(groups).toMatch(/display:\s*flex/);
    expect(groups).toMatch(/flex-direction:\s*column/);
    expect(group).not.toMatch(/background|border-radius/);
    expect(empty).toMatch(/min-height:\s*30px/);
    expect(slot).toMatch(/max-height:\s*0/);
    expect(slot).toMatch(/opacity:\s*0/);
    expect(card).toMatch(/width:\s*min\(144px,\s*100%\)/);
    expect(card).toMatch(/aspect-ratio:\s*4\s*\/\s*3/);
    expect(styles).toMatch(/\.note-group:hover > \.note-group-add-slot,[^}]*\.note-groups\.is-file-dragging \.note-group-add-slot[^}]*\{[^}]*opacity:\s*1/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-empty-group \{[^}]*min-height:\s*44px;/);
    expect(styles).not.toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-group-add-slot \{[^}]*opacity:\s*1;/);
  });

  it("keeps top-level Markdown lists flush with the note content", () => {
    expect(declarationsFor(".markdown > ul, .markdown > ol")).toMatch(/padding-inline-start:\s*18px/);
    expect(declarationsFor(".markdown > ul:has(> .markdown-task-item)")).toMatch(/padding-inline-start:\s*0/);
  });
});
