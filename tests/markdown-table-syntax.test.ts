import { describe, expect, it } from "vitest";
import { scanMarkdownTableLine } from "../src/components/markdownTableSyntax";

describe("scanMarkdownTableLine", () => {
  it("keeps structural source locations for a framed row", () => {
    expect(scanMarkdownTableLine("  | A | B |  ")).toEqual({
      cells: [
        { sourceColumn: 4, sourceText: "A", value: "A" },
        { sourceColumn: 8, sourceText: "B", value: "B" },
      ],
      hasLeadingPipe: true,
      hasTrailingPipe: true,
      leadingWhitespace: "  ",
      pipeIndices: [2, 6, 10],
    });
  });

  it("keeps an unframed row unframed", () => {
    expect(scanMarkdownTableLine(" left | right ")).toEqual({
      cells: [
        { sourceColumn: 1, sourceText: "left", value: "left" },
        { sourceColumn: 8, sourceText: "right", value: "right" },
      ],
      hasLeadingPipe: false,
      hasTrailingPipe: false,
      leadingWhitespace: " ",
      pipeIndices: [6],
    });
  });

  it.each([
    { name: "an odd escaped pipe", line: "a \\| b | c", pipes: [7] },
    { name: "an even escaped pipe", line: "a \\\\| b | c", pipes: [4, 8] },
  ])("handles $name", ({ line, pipes }) => {
    expect(scanMarkdownTableLine(line)?.pipeIndices).toEqual(pipes);
  });

  it("keeps escaped source text while decoding the renderer value", () => {
    expect(scanMarkdownTableLine("| a\\|b | c |")?.cells[0]).toEqual({
      sourceColumn: 2,
      sourceText: "a\\|b",
      value: "a|b",
    });
  });

  it("ignores pipes inside matching inline backtick runs", () => {
    expect(scanMarkdownTableLine("`a|b` | ``c|d`` | e")).toEqual(expect.objectContaining({
      pipeIndices: [6, 16],
      cells: [
        { sourceColumn: 0, sourceText: "`a|b`", value: "`a|b`" },
        { sourceColumn: 8, sourceText: "``c|d``", value: "``c|d``" },
        { sourceColumn: 18, sourceText: "e", value: "e" },
      ],
    }));
  });

  it("returns null without a structural pipe", () => {
    expect(scanMarkdownTableLine("`a|b`")).toBeNull();
  });

  it("exposes the prefix before a framed opening pipe", () => {
    expect(scanMarkdownTableLine("\t| A |"))
      .toEqual(expect.objectContaining({ leadingWhitespace: "\t" }));
  });
});
