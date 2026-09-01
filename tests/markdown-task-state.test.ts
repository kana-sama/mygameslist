import { describe, expect, it } from "vitest";
import {
  nextMarkdownTaskState,
  setMarkdownListTaskState,
  setMarkdownTableTaskState,
} from "../src/domain/markdownTaskState";

describe("markdown task state transitions", () => {
  it.each([
    ["unchecked", "regular", "checked"],
    ["checked", "regular", "unchecked"],
    ["indeterminate", "regular", "checked"],
    ["unchecked", "partial", "indeterminate"],
    ["checked", "partial", "indeterminate"],
    ["indeterminate", "partial", "unchecked"],
  ] as const)("changes %s with a %s transition to %s", (state, transition, expected) => {
    expect(nextMarkdownTaskState(state, transition)).toBe(expected);
  });
});

describe("markdown task source mutations", () => {
  it("changes only validated list task markers while preserving line endings", () => {
    const markdown = "Heading\r\n- [ ] First\r\n- [x] Second";

    expect(setMarkdownListTaskState(markdown, 2, "indeterminate")).toBe(
      "Heading\r\n- [ ] First\r\n- [-] Second",
    );
    expect(setMarkdownListTaskState(markdown, 0, "checked")).toBe(markdown);
  });

  it("changes only validated table task markers at their source column", () => {
    const markdown = [
      "| Name | First | Second |",
      "| --- | --- | --- |",
      "| Tower | [ ] | [x] |",
    ].join("\n");

    expect(setMarkdownTableTaskState(markdown, 2, 16, "indeterminate")).toBe([
      "| Name | First | Second |",
      "| --- | --- | --- |",
      "| Tower | [ ] | [-] |",
    ].join("\n"));
    expect(setMarkdownTableTaskState(markdown, 2, 0, "unchecked")).toBe(markdown);
  });
});
