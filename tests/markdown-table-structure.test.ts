import { describe, expect, it } from "vitest";
import {
  findMarkdownTableSourceLines,
  parseMarkdownTableAtLine,
} from "../src/components/markdownTableStructure";

describe("Markdown table structure", () => {
  it("returns every source line in ordinary and grouped tables", () => {
    const lines = [
      "Intro | prose",
      "",
      "| Name | Done |",
      "| --- | --- |",
      "| First group |",
      "| --- | --- |",
      "| Start | [ ] |",
      "",
      "```md",
      "| Fake | Table |",
      "| --- | --- |",
      "```",
    ];

    expect(findMarkdownTableSourceLines(lines)).toEqual(
      [2, 3, 4, 5, 6].map((lineIndex) => ({
        lineIndex,
        text: lines[lineIndex],
      })),
    );
  });

  it("parses the same block from its header, delimiter, or body", () => {
    const lines = ["| A | B |", "| --- | --- |", "| x | y |"]; 
    expect([0, 1, 2].map((line) => parseMarkdownTableAtLine(lines, line)?.lines.map((item) => item.lineIndex)))
      .toEqual([[0, 1, 2], [0, 1, 2], [0, 1, 2]]);
  });

  it.each([
    [["text | value"]],
    [["| header | only |"]],
    [["```", "| A | B |", "| --- | --- |", "```"]],
  ])("ignores non-table fixture %j", (lines) => {
    expect(findMarkdownTableSourceLines(lines)).toEqual([]);
  });

  it("bounds source-line reads for a long invalid contiguous pipe block", () => {
    const lineCount = 1_000;
    let indexedReads = 0;
    const sourceLines = Array.from(
      { length: lineCount },
      (_, index) => `invalid row ${index} | without delimiter`,
    );
    const lines = new Proxy(sourceLines, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(findMarkdownTableSourceLines(lines)).toEqual([]);
    expect(indexedReads).toBeLessThanOrEqual(lineCount * 20);
  });
});
