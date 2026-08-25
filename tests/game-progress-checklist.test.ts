import { describe, expect, it } from "vitest";
import {
  firstMarkdownHeading,
  resolveNoteChecklistProgress,
} from "../src/domain/markdownChecklist";

describe("resolveNoteChecklistProgress", () => {
  it.each([
    ["- [x] Found\n- [ ] Missing", { status: "ok", checked: 1, total: 2 }],
    ["- Parent\n  - [x] One\n  - [ ] Two", { status: "ok", checked: 1, total: 2 }],
    [
      "| Name | TW | SiP |\n| --- | --- | --- |\n| Dark Times | [x] | [ ] |",
      { status: "ok", checked: 1, total: 2 },
    ],
  ])("resolves %s", (markdown, expected) => {
    expect(resolveNoteChecklistProgress(markdown)).toEqual(expected);
  });

  it("counts indeterminate tasks without treating any affected aggregation as complete", () => {
    expect(resolveNoteChecklistProgress([
      "# Chapter",
      "- Group",
      "  - [x] Finished",
      "  - [-] In progress",
      "| Name | First | Second |",
      "| --- | --- | --- |",
      "| Table row | [x] | [-] |",
    ].join("\n"))).toEqual({ status: "ok", checked: 2, total: 4 });
  });

  it("extracts the first visible heading for editor options", () => {
    expect(firstMarkdownHeading("Intro\n\n# **Gold Bricks**\n- [ ] One"))
      .toBe("Gold Bricks");
  });

  it("aggregates sibling roots under the lowest shared heading", () => {
    expect(resolveNoteChecklistProgress([
      "# Gold Bricks",
      "## Story",
      "- [x] A",
      "",
      "## Free play",
      "- [ ] B",
    ].join("\n"))).toEqual({ status: "ok", checked: 1, total: 2 });
  });

  it.each([
    ["plain prose"],
    ["- [ ] ..."],
    ["# First\n- [ ] A\n\n# Second\n- [ ] B"],
    ["- [ ] A\n\n| B | Done |\n| --- | --- |\n| x | [ ] |"],
  ])("returns error for %s", (markdown) => {
    expect(resolveNoteChecklistProgress(markdown)).toEqual({ status: "error" });
  });
});
