import { describe, expect, it } from "vitest";
import {
  deriveMinimalMarkdownTableLineEdit,
  formatMarkdownTableAtLine,
} from "../src/components/markdownTableFormatting";

function format(lines: string[], triggerLine = lines.length - 1): string[] | null {
  const result = formatMarkdownTableAtLine(lines, triggerLine);
  if (!result) return null;
  const formatted = [...lines];
  for (const line of result.lines) formatted[line.lineIndex] = line.text;
  return formatted;
}

describe("formatMarkdownTableAtLine", () => {
  it("aligns framed cells using left, right, and centered header markers", () => {
    expect(format([
      "| Name | Score | State |",
      "| :--- | ---: | :---: |",
      "| A | 7 | ok |",
    ])).toEqual([
      "| Name | Score | State |",
      "| :--- | ----: | :---: |",
      "| A    |     7 |  ok   |",
    ]);
  });

  it("puts an odd centered padding space on the right", () => {
    expect(format([
      "| A | Center |",
      "| --- | :---: |",
      "| x | ok |",
    ])).toEqual([
      "| A   | Center |",
      "| --- | :----: |",
      "| x   |   ok   |",
    ]);
  });

  it("preserves every delimiter row's colon markers", () => {
    expect(format([
      "| A | B | C | D |",
      "| --- | :--- | ---: | :---: |",
      "| x | y | z | q |",
      "| :--- | ---: | :---: | --- |",
      "| Group |",
      "| :--- | ---: | :---: | --- |",
      "| a | b | c | d |",
    ])).toEqual([
      "| A    | B    |     C |   D   |",
      "| ---- | :--- | ----: | :---: |",
      "| x    | y    |     z |   q   |",
      "| :--- | ---: | :---: | ----- |",
      "| Group                       |",
      "| :--- | ---: | :---: | ----- |",
      "| a    | b    |     c |   d   |",
    ]);
  });

  it("keeps ordinary unframed tables unframed", () => {
    expect(format([
      "Name | Score",
      "--- | ---:",
      "A | 7",
    ])).toEqual([
      "Name | Score",
      "---- | ----:",
      "A    |     7",
    ]);
  });

  it("keeps a compact unframed delimiter mixed while ordinary rows consume spare padding", () => {
    expect(format([
      "abc | qwe",
      "----|----",
      "rx  | ty",
    ])).toEqual([
      "abc | qwe",
      "----|----",
      "rx  | ty ",
    ]);
  });

  it("grows compact unframed delimiter hyphens instead of inserting separator spaces", () => {
    expect(format([
      "abcd | qwe",
      "----|----",
      "rx   | ty",
    ])).toEqual([
      "abcd | qwe",
      "-----|----",
      "rx   | ty ",
    ]);
  });

  it("keeps compact unframed delimiter marker minima after gutter translation", () => {
    expect(format([
      "A | B | C",
      ":---|---:|:---:",
      "x | y | z",
    ])).toEqual([
      "A   |  B |  C  ",
      ":---|---:|:---:",
      "x   |  y |  z  ",
    ]);
  });

  it("preserves compact framed delimiter gutters, indentation, and colon markers", () => {
    expect(format([
      "  | A | B | C |",
      "  |:---|---:|:---:|",
      "  | abcd | q | z |",
    ])).toEqual([
      "  | A    |  B |  C  |",
      "  |:-----|---:|:---:|",
      "  | abcd |  q |  z  |",
    ]);
  });

  it("does not expand a minimal framed compact delimiter", () => {
    expect(format([
      "| A |",
      "|---|",
      "| x |",
    ])).toBeNull();
  });

  it("keeps compact framed delimiter marker minima after gutter translation", () => {
    expect(format([
      "| A | B | C |",
      "|:---|---:|:---:|",
      "| x | y | z |",
    ])).toEqual([
      "| A  |  B |  C  |",
      "|:---|---:|:---:|",
      "| x  |  y |  z  |",
    ]);
  });

  it("preserves source-unit escaped pipes and inline code", () => {
    expect(format([
      "| Left | Right |",
      "| --- | --- |",
      "| a\\|b | `x|y` |",
    ])).toEqual([
      "| Left | Right |",
      "| ---- | ----- |",
      "| a\\|b | `x|y` |",
    ]);
  });

  it("formats a one-column framed table", () => {
    expect(format([
      "| A |",
      "| --- |",
      "| BB |",
    ])).toEqual([
      "| A   |",
      "| --- |",
      "| BB  |",
    ]);
  });

  it.each([
    ["---", "| ------ |"],
    [":---", "| :----- |"],
    ["---:", "| -----: |"],
    [":---:", "| :----: |"],
  ])("keeps a one-column body delimiter as a delimiter for %s", (marker, expectedBodyDelimiter) => {
    expect(format([
      "| Longer |",
      `| ${marker} |`,
      `| ${marker} |`,
      "| x |",
    ])).toEqual([
      "| Longer |",
      expectedBodyDelimiter,
      expectedBodyDelimiter,
      marker.endsWith(":") ? (marker.startsWith(":") ? "|   x    |" : "|      x |") : "| x      |",
    ]);
  });

  it.each([
    ["-----:", "|      x |", "|      y |"],
    [":----:", "|   x    |", "|   y    |"],
  ])("keeps N=1 delimiter-ordinary-delimiter rows ordinary and aligned for %s", (marker, expectedX, expectedY) => {
    expect(format([
      "| Longer |",
      `| ${marker} |`,
      "| x |",
      `| ${marker} |`,
      "| y |",
    ])).toEqual([
      "| Longer |",
      `| ${marker} |`,
      expectedX,
      `| ${marker} |`,
      expectedY,
    ]);
  });

  it("permits explicit empty cells without inventing missing cells", () => {
    expect(format([
      "| A | |",
      "| --- | --- |",
      "| x | |",
    ])).toEqual([
      "| A   |     |",
      "| --- | --- |",
      "| x   |     |",
    ]);
  });

  it("permits an explicit trailing empty cell in an unframed table", () => {
    expect(format([
      "A | ",
      "--- | ---",
      "x | ",
    ])).toEqual([
      "A   |    ",
      "--- | ---",
      "x   |    ",
    ]);
  });

  it("keeps an ambiguous unframed title spelling as an empty-final-cell row without a closing delimiter", () => {
    expect(format([
      "A | B",
      "--- | ---",
      "Group |",
    ])).toEqual([
      "A     | B  ",
      "----- | ---",
      "Group |    ",
    ]);
  });

  it("uses UTF-16 source units for widths", () => {
    expect(format([
      "| A | B |",
      "| --- | --- |",
      "| 🎮ab | x |",
    ])).toEqual([
      "| A    | B   |",
      "| ---- | --- |",
      "| 🎮ab | x   |",
    ]);
  });

  it("formats a first group using the header delimiter as its leading boundary", () => {
    expect(format([
      "| Name | Done |",
      "| ---- | ---- |",
      "| First group |",
      "| ---- | ---- |",
      "| Start | [ ] |",
    ])).toEqual([
      "| Name  | Done |",
      "| ----- | ---- |",
      "| First group  |",
      "| ----- | ---- |",
      "| Start | [ ]  |",
    ]);
  });

  it("uses the exact framed title capacity without an outer-pipe off-by-two", () => {
    expect(format([
      "| A | B |",
      "| --- | --- |",
      "| 1234567 |",
      "| --- | --- |",
      "| x | y |",
    ])).toEqual([
      "| A   | B   |",
      "| --- | --- |",
      "| 1234567   |",
      "| --- | --- |",
      "| x   | y   |",
    ]);
  });

  it("formats later delimiter-title-delimiter groups and aligns unframed titles", () => {
    expect(format([
      "Name | Done",
      "---- | ----",
      "Start | [ ]",
      "---- | ----",
      "Second group |",
      "---- | ----",
      "End | [x]",
    ])).toEqual([
      "Name  | Done  ",
      "----- | ------",
      "Start | [ ]   ",
      "----- | ------",
      "Second group |",
      "----- | ------",
      "End   | [x]   ",
    ]);
  });

  it("preserves compact and spaced delimiter rows independently across grouped-table boundaries", () => {
    expect(format([
      "| A | B |",
      "|---|---|",
      "| First row |",
      "| --- | --- |",
      "| a | done |",
      "| --- | --- |",
      "| Second title |",
      "|---|---|",
      "| b | more |",
    ])).toEqual([
      "| A   | B      |",
      "|-----|--------|",
      "| First row    |",
      "| --- | ------ |",
      "| a   | done   |",
      "| --- | ------ |",
      "| Second title |",
      "|-----|--------|",
      "| b   | more   |",
    ]);
  });

  it("finds a header-delimiter pair after preceding structural prose", () => {
    expect(format([
      "context | aside",
      "| A | B |",
      "| --- | --- |",
      "| x | yz |",
    ])).toEqual([
      "context | aside",
      "| A   | B   |",
      "| --- | --- |",
      "| x   | yz  |",
    ]);
  });

  it("keeps a body delimiter row when it does not begin a complete group triple", () => {
    expect(format([
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "| ---- | ---- |",
      "| z | q |",
    ])).toEqual([
      "| A    | B    |",
      "| ---- | ---- |",
      "| x    | y    |",
      "| ---- | ---- |",
      "| z    | q    |",
    ]);
  });

  it("rejects a framed dangling group title after a body delimiter", () => {
    expect(formatMarkdownTableAtLine([
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
      "| --- | --- |",
      "| Group |",
    ], 4)).toBeNull();
  });

  it("grows only the final column when a group title exceeds its span", () => {
    expect(format([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| A very long group title |",
      "| --- | --- | --- |",
      "| a | b | c |",
    ])).toEqual([
      "| A   | B   | C           |",
      "| --- | --- | ----------- |",
      "| A very long group title |",
      "| --- | --- | ----------- |",
      "| a   | b   | c           |",
    ]);
  });

  it.each([
    ["no header delimiter", ["| A | B |", "| value | cell |"]],
    ["short delimiter", ["| A | B |", "| -- | --- |", "| x | y |"]],
    ["wrong cell count", ["| A | B |", "| --- | --- |", "| x |"]],
    ["dangling group title", ["| A | B |", "| --- | --- |", "| Group |"]],
    ["mixed framing", ["| A | B |", "--- | ---", "| x | y |"]],
    ["mixed framed prefixes", ["  | A | B |", "| --- | --- |", "  | x | y |"]],
    ["unframed one-column table", ["A |", "--- |", "B |"]],
  ])("returns null for %s", (_name, lines) => {
    expect(formatMarkdownTableAtLine(lines, lines.length - 1)).toBeNull();
  });

  it("formats a table without crossing an adjacent renderer boundary", () => {
    expect(format([
      "| A | B |",
      "| --- | --- |",
      "| x | yz |",
      "## After | table",
    ], 2)).toEqual([
      "| A   | B   |",
      "| --- | --- |",
      "| x   | yz  |",
      "## After | table",
    ]);
  });
});

describe("deriveMinimalMarkdownTableLineEdit", () => {
  it.each([
    ["inserts before a closing pipe", "| A |", "| A   |", { startColumn: 4, endColumn: 4, text: "  " }],
    ["replaces a changed middle", "| A |", "| B |", { startColumn: 2, endColumn: 3, text: "B" }],
    ["deletes a middle", "| A   |", "| A |", { startColumn: 4, endColumn: 6, text: "" }],
  ])("%s", (_name, previous, next, expected) => {
    expect(deriveMinimalMarkdownTableLineEdit(previous, next)).toEqual(expected);
  });

  it("returns null for an unchanged line", () => {
    expect(deriveMinimalMarkdownTableLineEdit("| A |", "| A |")).toBeNull();
  });
});
