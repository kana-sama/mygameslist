import { describe, expect, it } from "vitest";
import {
  findMarkdownTableSourceLines,
  parseMarkdownTableAtLine,
} from "../src/components/markdownTableStructure";
import { parseMarkdownBlocks } from "../src/domain/markdownChecklist";

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

  it("keeps paired spoiler pipes inside one table cell", () => {
    const lines = [
      "| Stage | Note |",
      "| --- | --- |",
      "| Start | ||secret|| |",
    ];
    const table = parseMarkdownTableAtLine(lines, 2);

    expect(table?.lines).toHaveLength(3);
    expect(table?.lines[2].syntax.cells).toHaveLength(2);
    expect(table?.lines[2].syntax.cells[1].value).toBe("||secret||");
  });

  it("preserves escaped table cell source alongside its decoded value", () => {
    const lines = [
      "| Stage | Note |",
      "| --- | --- |",
      "| Literal | \\|\\|literal\\|\\| |",
      "| Checked | [x] \\|\\|checked literal\\|\\| |",
    ];
    const parsed = parseMarkdownBlocks(lines.join("\n"))[0].table;

    expect(parsed?.headers).toHaveLength(2);
    expect(parsed?.sections[0].rows).toHaveLength(2);
    expect(parsed?.sections[0].rows.every((row) => row.cells.length === 2)).toBe(true);
    expect(parsed?.sections[0].rows[0].cells[1]).toMatchObject({
      sourceColumn: 12,
      sourceValue: "\\|\\|literal\\|\\|",
      value: "||literal||",
    });
    expect(parsed?.sections[0].rows[1].cells[1]).toMatchObject({
      sourceColumn: 16,
      sourceValue: "\\|\\|checked literal\\|\\|",
      taskChecked: true,
      taskSourceColumn: 12,
      value: "||checked literal||",
    });
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
