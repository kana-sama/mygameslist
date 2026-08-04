import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createMonacoMarkdownTableOnTypeProvider } from "../src/components/monacoMarkdownTableFormatting";

class TestRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

function createModel(lines: string[]) {
  const value = lines.join("\n");
  return {
    getLineContent: (lineNumber: number) => lines[lineNumber - 1],
    getLineCount: () => lines.length,
    getOffsetAt: (position: Monaco.IPosition) => lines
      .slice(0, position.lineNumber - 1)
      .reduce((offset, line) => offset + line.length + 1, 0) + position.column - 1,
    getValue: () => value,
  } as unknown as Monaco.editor.ITextModel;
}

const notCancelled = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
} as Monaco.CancellationToken;

describe("Monaco Markdown table on-type provider", () => {
  it("declares only the structural-pipe trigger", () => {
    const provider = createMonacoMarkdownTableOnTypeProvider({ Range: TestRange } as unknown as typeof Monaco);

    expect(provider.autoFormatTriggerCharacters).toEqual(["|"]);
  });

  it("returns minimal edits for every changed table line", () => {
    const provider = createMonacoMarkdownTableOnTypeProvider({ Range: TestRange } as unknown as typeof Monaco);
    const model = createModel([
      "| A | B |",
      "| --- | --- |",
      "| x | yz |",
    ]);

    expect(provider.provideOnTypeFormattingEdits(
      model,
      { lineNumber: 3, column: 11 },
      "|",
      {} as Monaco.languages.FormattingOptions,
      notCancelled,
    )).toEqual([
      { range: new TestRange(1, 5, 1, 8), text: "  | B  " },
      { range: new TestRange(3, 5, 3, 9), text: "  | yz " },
    ]);
  });

  it("inserts before the just-typed closing pipe instead of replacing it", () => {
    const provider = createMonacoMarkdownTableOnTypeProvider({ Range: TestRange } as unknown as typeof Monaco);
    const model = createModel([
      "| A |",
      "| --- |",
      "| BB |",
    ]);

    expect(provider.provideOnTypeFormattingEdits(
      model,
      { lineNumber: 3, column: 7 },
      "|",
      {} as Monaco.languages.FormattingOptions,
      notCancelled,
    )).toEqual([
      { range: new TestRange(1, 5, 1, 5), text: "  " },
      { range: new TestRange(3, 6, 3, 6), text: " " },
    ]);
  });

  it.each([
    ["cancelled", ["| A |", "| --- |", "| x |"], { isCancellationRequested: true }],
    ["escaped", ["| A |", "| --- |", "| x \\|"], notCancelled],
    ["fenced", ["```", "| A |", "| --- |", "| x |", "```"], notCancelled],
    ["non-table", ["text |"], notCancelled],
  ])("returns no edits for %s triggers", (_name, lines, token) => {
    const provider = createMonacoMarkdownTableOnTypeProvider({ Range: TestRange } as unknown as typeof Monaco);
    const model = createModel(lines);
    const line = lines[lines.length - (lines[0] === "```" ? 2 : 1)];
    const lineNumber = lines[0] === "```" ? lines.length - 1 : lines.length;

    expect(provider.provideOnTypeFormattingEdits(
      model,
      { lineNumber, column: line.length + 1 },
      "|",
      {} as Monaco.languages.FormattingOptions,
      token as Monaco.CancellationToken,
    )).toEqual([]);
  });

  it("returns no edits when the just-typed pipe is inside inline code", () => {
    const provider = createMonacoMarkdownTableOnTypeProvider({ Range: TestRange } as unknown as typeof Monaco);
    const model = createModel(["| A |", "| --- |", "| `x|` |"]);

    expect(provider.provideOnTypeFormattingEdits(
      model,
      { lineNumber: 3, column: 6 },
      "|",
      {} as Monaco.languages.FormattingOptions,
      notCancelled,
    )).toEqual([]);
  });
});
