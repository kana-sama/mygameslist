import { describe, expect, it } from "vitest";
import {
  isInsideFencedMarkdownCode,
  resolveMarkdownListEnter,
  resolveMarkdownListIndent,
} from "../src/components/markdownListEditing";

function atEnd(value: string) {
  return resolveMarkdownListEnter(value, value.length, value.length);
}

describe("resolveMarkdownListEnter", () => {
  it.each([
    ["  - Child", "  - Child\n  - "],
    ["* Item", "* Item\n* "],
    ["+ Item", "+ Item\n+ "],
    ["9) Nine", "9) Nine\n10) "],
    ["1. One", "1. One\n2. "],
    ["009) Padded", "009) Padded\n010) "],
  ])("continues the current marker in %j", (source, expected) => {
    expect(atEnd(source)).toEqual({ value: expected, caret: expected.length });
  });

  it("creates an unchecked task while preserving the original checked item", () => {
    const source = "* [X] Done";
    const expected = "* [X] Done\n* [ ] ";

    expect(atEnd(source)).toEqual({ value: expected, caret: expected.length });
  });

  it("splits an item at the caret and places the caret before the moved suffix", () => {
    const source = "- AlphaBeta";
    const caret = "- Alpha".length;

    expect(resolveMarkdownListEnter(source, caret, caret)).toEqual({
      value: "- Alpha\n- Beta",
      caret: "- Alpha\n- ".length,
    });
  });

  it("renumbers only the sequential ordered tail at the same level", () => {
    const source = [
      "1. One",
      "2. Two",
      "   - Nested",
      "3. Three",
      "7. Intentional",
      "8. Preserved after gap",
    ].join("\n");
    const caret = "1. One".length;

    expect(resolveMarkdownListEnter(source, caret, caret)).toEqual({
      value: [
        "1. One",
        "2. ",
        "3. Two",
        "   - Nested",
        "4. Three",
        "7. Intentional",
        "8. Preserved after gap",
      ].join("\n"),
      caret: "1. One\n2. ".length,
    });
  });

  it("removes an empty root item and closes its ordered-number gap", () => {
    const source = "1. One\n2. \n3. Three\n7. Intentional";
    const caret = "1. One\n2. ".length;

    expect(resolveMarkdownListEnter(source, caret, caret)).toEqual({
      value: "1. One\n\n2. Three\n7. Intentional",
      caret: "1. One\n".length,
    });
  });

  it("outdents an empty nested bullet one level and exits on the next Enter", () => {
    const source = "- Parent\n  - Child\n  - ";
    const outdented = "- Parent\n  - Child\n- ";
    const first = atEnd(source);

    expect(first).toEqual({ value: outdented, caret: outdented.length });
    expect(resolveMarkdownListEnter(first!.value, first!.caret, first!.caret)).toEqual({
      value: "- Parent\n  - Child\n",
      caret: "- Parent\n  - Child\n".length,
    });
  });

  it("uses the parent list style while outdenting through multiple levels", () => {
    const source = "- Top\n  * Middle\n    + ";
    const first = resolveMarkdownListEnter(source, source.length, source.length)!;
    const second = resolveMarkdownListEnter(first.value, first.caret, first.caret)!;
    const third = resolveMarkdownListEnter(second.value, second.caret, second.caret)!;

    expect(first).toEqual({ value: "- Top\n  * Middle\n  * ", caret: "- Top\n  * Middle\n  * ".length });
    expect(second).toEqual({ value: "- Top\n  * Middle\n- ", caret: "- Top\n  * Middle\n- ".length });
    expect(third).toEqual({ value: "- Top\n  * Middle\n", caret: "- Top\n  * Middle\n".length });
  });

  it("creates the parent ordered/checklist item even when the nested list has another style", () => {
    const ordered = "1. Parent\n   - \n2. Next";
    const orderedCaret = "1. Parent\n   - ".length;
    const checklist = "- [x] Parent\n  1. ";

    expect(resolveMarkdownListEnter(ordered, orderedCaret, orderedCaret)).toEqual({
      value: "1. Parent\n2. \n3. Next",
      caret: "1. Parent\n2. ".length,
    });
    expect(atEnd(checklist)).toEqual({
      value: "- [x] Parent\n- [ ] ",
      caret: "- [x] Parent\n- [ ] ".length,
    });
  });

  it("does not treat a shallower same-level indent as a nested item", () => {
    const source = "- Parent\n - ";

    expect(atEnd(source)).toEqual({ value: "- Parent\n", caret: "- Parent\n".length });
  });

  it("outdents into the parent list style and renumbers both affected ordered levels", () => {
    const source = [
      "1. Parent",
      "   1. Child",
      "   2. ",
      "   3. Later child",
      "2. Next parent",
    ].join("\n");
    const expected = [
      "1. Parent",
      "   1. Child",
      "2. ",
      "   2. Later child",
      "3. Next parent",
    ].join("\n");
    const caret = ["1. Parent", "   1. Child", "   2. "].join("\n").length;

    expect(resolveMarkdownListEnter(source, caret, caret)).toEqual({
      value: expected,
      caret: "1. Parent\n   1. Child\n2. ".length,
    });
  });

  it("preserves the document line ending", () => {
    const source = "- One\r\n- Two";
    const expected = "- One\r\n- Two\r\n- ";

    expect(atEnd(source)).toEqual({ value: expected, caret: expected.length });
  });

  it("leaves unsupported selections, positions, and ordinary text to the textarea", () => {
    expect(resolveMarkdownListEnter("Paragraph", 9, 9)).toBeNull();
    expect(resolveMarkdownListEnter("- Selected", 2, 6)).toBeNull();
    expect(resolveMarkdownListEnter("- Item", 1, 1)).toBeNull();
    expect(resolveMarkdownListEnter("- Item", -1, -1)).toBeNull();
  });

  it.each([
    "```md\n- code item\n```",
    "~~~\n* code item\n~~~",
    "\t```\n+ code item\n\t```",
    "- parent\n  - child\n    ```\n    - code item\n    ```",
    "- ```\n  * code item\n  ```",
  ])("does not continue list-looking text inside fenced code", (source) => {
    const caret = source.indexOf("item") + "item".length;

    expect(isInsideFencedMarkdownCode(source, caret)).toBe(true);
    expect(resolveMarkdownListEnter(source, caret, caret)).toBeNull();
  });
});

describe("resolveMarkdownListIndent", () => {
  it("indents a list item beneath its previous sibling and restores the caret", () => {
    const source = "- Parent\n- [x] Child";

    expect(resolveMarkdownListIndent(source, source.length, source.length, "indent")).toEqual({
      value: "- Parent\n  - [x] Child",
      selectionStart: source.length + 2,
      selectionEnd: source.length + 2,
    });
  });

  it("uses the previous ordered item's content indent", () => {
    const source = "9) Parent\n10) Child";

    expect(resolveMarkdownListIndent(source, source.length, source.length, "indent")).toEqual({
      value: "9) Parent\n   10) Child",
      selectionStart: source.length + 3,
      selectionEnd: source.length + 3,
    });
  });

  it("moves a collapsed item's descendant block with it", () => {
    const source = [
      "- Parent",
      "- Child",
      "  - Grandchild",
      "- Next",
    ].join("\n");
    const caret = "- Parent\n- Child".length;

    expect(resolveMarkdownListIndent(source, caret, caret, "indent")).toEqual({
      value: [
        "- Parent",
        "  - Child",
        "    - Grandchild",
        "- Next",
      ].join("\n"),
      selectionStart: caret + 2,
      selectionEnd: caret + 2,
    });
  });

  it("moves descendants when only part of the parent text is selected", () => {
    const source = [
      "- Previous",
      "- Parent",
      "  - Child",
      "- Next",
    ].join("\n");
    const selectionStart = source.indexOf("Parent");
    const selectionEnd = selectionStart + "Parent".length;

    expect(resolveMarkdownListIndent(source, selectionStart, selectionEnd, "indent")).toEqual({
      value: [
        "- Previous",
        "  - Parent",
        "    - Child",
        "- Next",
      ].join("\n"),
      selectionStart: selectionStart + 2,
      selectionEnd: selectionEnd + 2,
    });
  });

  it("outdents one structural level and keeps the list marker", () => {
    const source = "- Parent\n  * [ ] Child";

    expect(resolveMarkdownListIndent(source, source.length, source.length, "outdent")).toEqual({
      value: "- Parent\n* [ ] Child",
      selectionStart: source.length - 2,
      selectionEnd: source.length - 2,
    });
  });

  it("outdents mixed tab indentation to the exact parent column", () => {
    const source = "  - Parent\n  \t- Child";

    expect(resolveMarkdownListIndent(source, source.length, source.length, "outdent")).toEqual({
      value: "  - Parent\n  - Child",
      selectionStart: source.length - 1,
      selectionEnd: source.length - 1,
    });
  });

  it("changes every selected list line while preserving the selected range", () => {
    const source = [
      "- Parent",
      "- One",
      "  - Nested",
      "- Two",
    ].join("\n");
    const selectionStart = "- Parent\n".length;

    expect(resolveMarkdownListIndent(source, selectionStart, source.length, "indent")).toEqual({
      value: [
        "- Parent",
        "  - One",
        "    - Nested",
        "  - Two",
      ].join("\n"),
      selectionStart: selectionStart + 2,
      selectionEnd: source.length + 6,
    });
  });

  it("does not indent the first sibling, outdent a root item, or edit fenced code", () => {
    expect(resolveMarkdownListIndent("- First", 7, 7, "indent")).toBeNull();
    expect(resolveMarkdownListIndent("- Root", 6, 6, "outdent")).toBeNull();

    const fenced = "```\n- Code\n```";
    const caret = "```\n- Code".length;
    expect(resolveMarkdownListIndent(fenced, caret, caret, "indent")).toBeNull();

    const selectedFence = "- Parent\n- Child\n  ```\n  code\n  ```";
    const selectionStart = "- Parent\n".length;
    expect(resolveMarkdownListIndent(selectedFence, selectionStart, selectedFence.length, "indent")).toBeNull();
  });
});
