import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("notes shelf CSS", () => {
  it("uses an unlimited measured grid with explicit shelf tracks", () => {
    const container = declarationsFor(".notes-list, .note-editors-grid");
    const cards = declarationsFor(".note-card");

    expect(container).toMatch(/display:\s*grid/);
    expect(container).toMatch(/--note-column-min:\s*360px/);
    expect(container).toMatch(/repeat\(auto-fill,\s*minmax\(min\(var\(--note-column-min\),\s*100%\),\s*1fr\)\)/);
    expect(container).not.toMatch(/repeat\(auto-fit/);
    expect(container).toMatch(/grid-auto-rows:\s*1px/);
    expect(container).toMatch(/column-gap:\s*8px/);
    expect(container).toMatch(/row-gap:\s*0/);
    expect(container).not.toMatch(/column-(?:count|width)/);
    expect(cards).toMatch(/align-self:\s*stretch/);
    expect(cards).not.toMatch(/break-inside|column-break/);
  });

  it("collapses the shelf to one column on narrow screens", () => {
    expect(styles).toMatch(/@media \(max-width: 500px\)[\s\S]*?\.notes-list, \.note-editors-grid \{\s*grid-template-columns:\s*1fr;/);
  });

  it("keeps labelled add actions in the normal flow below each group", () => {
    const groups = declarationsFor(".note-groups");
    const group = declarationsFor(".note-group");
    const groupBoundary = declarationsFor(".note-group + .note-group");
    const empty = declarationsFor(".note-empty-group");
    const slot = declarationsFor(".note-group-add-slot");
    const button = declarationsFor(".note-group-add-button");

    expect(groups).toMatch(/display:\s*flex/);
    expect(groups).toMatch(/flex-direction:\s*column/);
    expect(group).toMatch(/position:\s*relative/);
    expect(group).not.toMatch(/background|border-radius/);
    expect(groupBoundary).not.toMatch(/border/);
    expect(empty).toMatch(/position:\s*relative/);
    expect(empty).toMatch(/min-height:\s*34px/);
    expect(empty).not.toMatch(/border/);
    expect(slot).toMatch(/position:\s*relative/);
    expect(slot).toMatch(/min-height:\s*34px/);
    expect(slot).toMatch(/display:\s*flex/);
    expect(slot).toMatch(/margin-top:\s*4px/);
    expect(slot).not.toMatch(/position:\s*absolute|opacity:\s*0|pointer-events:\s*none/);
    expect(styles).not.toContain(".note-group-add-slot::before");
    expect(button).toMatch(/min-width:\s*146px/);
    expect(button).toMatch(/height:\s*30px/);
    expect(button).toMatch(/display:\s*inline-flex/);
    expect(styles).not.toMatch(/\.note-group:hover > \.note-group-add-slot/);
    expect(declarationsFor(".note-group.is-file-over, .note-empty-group.is-file-over")).toMatch(/outline:\s*1px solid var\(--accent\)/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-empty-group \{[^}]*min-height:\s*44px;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-group-add-slot \{[^}]*min-height:\s*44px;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-group-add-button \{[^}]*min-width:\s*180px;[^}]*height:\s*44px;/);
  });

  it("keeps top-level Markdown lists flush with the note content", () => {
    expect(declarationsFor(".markdown > ul, .markdown > ol")).toMatch(/padding-inline-start:\s*18px/);
    expect(declarationsFor(".markdown > ul:has(> .markdown-task-item), .markdown > ol:has(> .markdown-task-item)")).toMatch(/padding-inline-start:\s*0/);
    expect(declarationsFor(".markdown > ul:has(> .markdown-open-checklist-marker), .markdown > ol:has(> .markdown-open-checklist-marker)")).toMatch(/padding-inline-start:\s*0/);
    expect(declarationsFor(".markdown > ul:has(> .markdown-checklist-group):not(:has(> li:not(.markdown-checklist-group):not(.markdown-task-item))), .markdown > ol:has(> .markdown-checklist-group):not(:has(> li:not(.markdown-checklist-group):not(.markdown-task-item)))")).toMatch(/padding-inline-start:\s*0/);
    expect(declarationsFor(".markdown ul ul, .markdown ul ol, .markdown ol ul, .markdown ol ol")).toMatch(/padding-inline-start:\s*18px/);
    expect(declarationsFor(".markdown-task-item")).not.toMatch(/display:\s*flex/);
    expect(declarationsFor(".markdown-task-row")).toMatch(/display:\s*flex/);
  });

  it("reveals keyboard-accessible checklist edit affordances on hover and focus", () => {
    const button = declarationsFor(".markdown-task-edit-button");
    const reveal = declarationsFor(".markdown-task-row:hover > .markdown-task-edit-button, .markdown-task-row:focus-within > .markdown-task-edit-button");

    expect(button).toMatch(/opacity:\s*0/);
    expect(button).toMatch(/cursor:\s*pointer/);
    expect(reveal).toMatch(/opacity:\s*1/);
    expect(declarationsFor(".markdown-task-edit-button:focus-visible")).toMatch(/outline:\s*1px solid var\(--accent\)/);
    expect(declarationsFor(".markdown-open-checklist-add")).toMatch(/color:\s*var\(--muted-2\)/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.markdown-task-edit-button \{[^}]*opacity:\s*1/);
  });

  it("keeps Markdown tables compact and scrollable inside narrow notes", () => {
    const scroll = declarationsFor(".markdown-table-scroll");
    const table = declarationsFor(".markdown-table");
    const cells = declarationsFor(".markdown-table th, .markdown-table td");
    const firstHeader = declarationsFor(".markdown-table th:first-child");
    const otherHeaders = declarationsFor(".markdown-table th:not(:first-child)");
    const completed = declarationsFor(".markdown-table-row--complete > td");

    expect(scroll).toMatch(/max-width:\s*100%/);
    expect(scroll).toMatch(/overflow-x:\s*auto/);
    expect(table).toMatch(/width:\s*max-content/);
    expect(table).toMatch(/min-width:\s*100%/);
    expect(table).toMatch(/border-collapse:\s*collapse/);
    expect(cells).toMatch(/padding:\s*4px 6px/);
    expect(cells).toMatch(/border:\s*1px solid var\(--line-soft\)/);
    expect(firstHeader).toMatch(/text-align:\s*left!important/);
    expect(otherHeaders).toMatch(/text-align:\s*center!important/);
    expect(completed).toMatch(/color:\s*var\(--success\)/);
    expect(completed).not.toMatch(/text-decoration:\s*line-through/);
    expect(declarationsFor(".markdown-table-row--complete > td a, .markdown-table-row--complete > td code")).toMatch(/color:\s*inherit/);
  });

  it("frames Markdown tables with compact collapsible group headings", () => {
    const groupCell = declarationsFor(".markdown-table-group__heading > th");
    const groupHeader = declarationsFor(".markdown-table-group__header");
    const groupTitle = declarationsFor(".markdown-table-group__title");
    const completeGroup = declarationsFor(".markdown-table-group--complete .markdown-table-group__header");
    const hiddenGroup = declarationsFor(".markdown-table-group__content[hidden]");

    expect(groupCell).toMatch(/padding:\s*0/);
    expect(groupCell).toMatch(/background:\s*var\(--surface-2\)/);
    expect(groupHeader).toMatch(/display:\s*flex/);
    expect(groupHeader).toMatch(/width:\s*100%/);
    expect(groupTitle).toMatch(/flex:\s*1/);
    expect(completeGroup).toMatch(/color:\s*var\(--success\)/);
    expect(hiddenGroup).toMatch(/display:\s*none/);
  });

  it("uses positive green styling for completed checklist rows", () => {
    const completed = declarationsFor(".markdown-task-item--checked > .markdown-task-row > .markdown-task-content");

    expect(completed).toMatch(/color:\s*var\(--success\)/);
    expect(completed).not.toMatch(/text-decoration:\s*line-through/);
    expect(declarationsFor(".markdown-task-checkbox:checked")).toMatch(/accent-color:\s*var\(--success\)/);
  });

  it("keeps checklist progress compact and marks complete headings green", () => {
    const heading = declarationsFor(".markdown-checklist-heading");
    const title = declarationsFor(".markdown-checklist-heading__title");
    const group = declarationsFor(".markdown-checklist-group__header");
    const progress = declarationsFor(".markdown-checklist-progress");

    expect(heading).toMatch(/display:\s*flex/);
    expect(title).toMatch(/flex:\s*1/);
    expect(declarationsFor(".markdown-checklist-group")).toMatch(/list-style:\s*none/);
    expect(group).toMatch(/display:\s*flex/);
    expect(declarationsFor(".markdown-checklist-group__title")).toMatch(/flex:\s*1/);
    expect(progress).toMatch(/margin-inline-start:\s*auto/);
    expect(progress).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(declarationsFor(".markdown .markdown-checklist-heading--complete")).toMatch(/color:\s*var\(--success\)/);
    expect(declarationsFor(".markdown .markdown-checklist-group--complete > .markdown-checklist-group__header")).toMatch(/color:\s*var\(--success\)/);
  });

  it("shares a focus ring between checklist and table group collapse controls", () => {
    const toggle = declarationsFor(".markdown-checklist-toggle");
    const headingToggle = declarationsFor(".markdown-checklist-heading__toggle");
    const sharedFocusVisible = styles.match(/\.markdown-checklist-toggle:focus-visible,\s*\.markdown-table-group__header:focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(toggle).toMatch(/width:\s*100%/);
    expect(toggle).toMatch(/appearance:\s*none/);
    expect(toggle).toMatch(/padding:\s*0/);
    expect(toggle).toMatch(/cursor:\s*pointer/);
    expect(headingToggle).toMatch(/display:\s*flex/);
    expect(headingToggle).toMatch(/flex:\s*1/);
    expect(sharedFocusVisible).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(declarationsFor(".markdown-checklist-group__content[hidden]")).toMatch(/display:\s*none/);
  });
});
