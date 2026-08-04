import type * as Monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import {
  createMonacoMarkdownTableOnTypeProvider,
  installMonacoMarkdownTableTyping,
} from "../src/components/monacoMarkdownTableFormatting";

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

function createTypingHarness(initialLines: string[]) {
  interface HistoryEntry {
    after: string[];
    before: string[];
  }

  let lines = [...initialLines];
  let compositionActive = false;
  let openHistoryEntry: HistoryEntry | null = null;
  let versionId = 1;
  const historyCalls: string[] = [];
  const redoEntries: HistoryEntry[] = [];
  const undoEntries: HistoryEntry[] = [];
  const contentListeners = new Set<(event: Monaco.editor.IModelContentChangedEvent) => void>();
  const compositionEndListeners = new Set<() => void>();
  const offsetAt = (lineNumber: number, column: number) => lines
    .slice(0, lineNumber - 1)
    .reduce((offset, previousLine) => offset + previousLine.length + 1, 0)
    + column - 1;
  const positionAt = (offset: number): Monaco.Position => {
    let remaining = Math.max(0, Math.min(offset, lines.join("\n").length));
    for (let index = 0; index < lines.length; index += 1) {
      if (remaining <= lines[index].length) {
        return { lineNumber: index + 1, column: remaining + 1 } as Monaco.Position;
      }
      remaining -= lines[index].length + 1;
    }
    return {
      lineNumber: lines.length,
      column: lines.at(-1)!.length + 1,
    } as Monaco.Position;
  };
  const notify = (changes: Monaco.editor.IModelContentChange[]) => {
    versionId += 1;
    const event = {
      changes,
      detailedReasonsChangeLengths: changes.map(() => 1),
      eol: "\n",
      isEolChange: false,
      isFlush: false,
      isRedoing: false,
      isUndoing: false,
      versionId,
    } as Monaco.editor.IModelContentChangedEvent;
    for (const listener of contentListeners) listener(event);
  };
  const model = {
    getLineContent: (lineNumber: number) => lines[lineNumber - 1],
    getLineCount: () => lines.length,
    getPositionAt: positionAt,
    getValue: () => lines.join("\n"),
    popStackElement: () => {
      historyCalls.push("open");
      openHistoryEntry = undoEntries.at(-1) ?? null;
    },
    pushStackElement: () => {
      historyCalls.push("close");
      openHistoryEntry = null;
    },
    onDidChangeContent: (listener: (event: Monaco.editor.IModelContentChangedEvent) => void) => {
      contentListeners.add(listener);
      return { dispose: () => contentListeners.delete(listener) };
    },
  } as unknown as Monaco.editor.ITextModel;
  const editor = {
    executeEdits: (_source: string, edits: Monaco.editor.IIdentifiedSingleEditOperation[]) => {
      historyCalls.push("edit");
      const before = [...lines];
      for (const edit of [...edits].reverse()) {
        const lineIndex = edit.range.startLineNumber - 1;
        const line = lines[lineIndex];
        lines[lineIndex] = line.slice(0, edit.range.startColumn - 1)
          + (edit.text ?? "")
          + line.slice(edit.range.endColumn - 1);
      }
      if (openHistoryEntry) openHistoryEntry.after = [...lines];
      else undoEntries.push({ after: [...lines], before });
      redoEntries.length = 0;
      return true;
    },
    getModel: () => model,
    get inComposition() {
      return compositionActive;
    },
    onDidCompositionEnd: (listener: () => void) => {
      compositionEndListeners.add(listener);
      return { dispose: () => compositionEndListeners.delete(listener) };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;

  return {
    context: {
      editor,
      model,
      monaco: { Range: TestRange } as unknown as typeof Monaco,
    },
    lines: () => [...lines],
    historyCalls: () => [...historyCalls],
    type(lineNumber: number, column: number, text: string) {
      this.typeMany([{ column, lineNumber, text }]);
    },
    typeMany(edits: Array<{ column: number; lineNumber: number; text: string }>) {
      const before = [...lines];
      const changes = edits
        .map(({ column, lineNumber, text }) => ({
          range: new TestRange(lineNumber, column, lineNumber, column),
          rangeLength: 0,
          rangeOffset: offsetAt(lineNumber, column),
          text,
        }))
        .sort((left, right) => right.rangeOffset - left.rangeOffset);
      let value = lines.join("\n");
      for (const change of changes) {
        value = value.slice(0, change.rangeOffset) + change.text + value.slice(change.rangeOffset);
      }
      lines = value.split("\n");
      undoEntries.push({ after: [...lines], before });
      redoEntries.length = 0;
      notify(changes);
    },
    replace(
      lineNumber: number,
      startColumn: number,
      endColumn: number,
      text: string,
    ) {
      const before = [...lines];
      const rangeOffset = offsetAt(lineNumber, startColumn);
      const rangeLength = endColumn - startColumn;
      const change = {
        range: new TestRange(lineNumber, startColumn, lineNumber, endColumn),
        rangeLength,
        rangeOffset,
        text,
      };
      const value = lines.join("\n");
      lines = `${value.slice(0, rangeOffset)}${text}${value.slice(rangeOffset + rangeLength)}`.split("\n");
      if (rangeLength > 0 || text) {
        undoEntries.push({ after: [...lines], before });
        redoEntries.length = 0;
      }
      notify([change]);
    },
    delete(lineNumber: number, startColumn: number, endColumn: number) {
      this.deleteMany([{ endColumn, lineNumber, startColumn }]);
    },
    deleteMany(edits: Array<{ endColumn: number; lineNumber: number; startColumn: number }>) {
      const before = [...lines];
      const changes = edits
        .map(({ endColumn, lineNumber, startColumn }) => ({
          range: new TestRange(lineNumber, startColumn, lineNumber, endColumn),
          rangeLength: endColumn - startColumn,
          rangeOffset: offsetAt(lineNumber, startColumn),
          text: "",
        }))
        .sort((left, right) => right.rangeOffset - left.rangeOffset);
      let value = lines.join("\n");
      for (const change of changes) {
        value = value.slice(0, change.rangeOffset) + value.slice(change.rangeOffset + change.rangeLength);
      }
      lines = value.split("\n");
      undoEntries.push({ after: [...lines], before });
      redoEntries.length = 0;
      notify(changes);
    },
    deleteAcrossLines(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      const before = [...lines];
      const rangeOffset = offsetAt(startLineNumber, startColumn);
      const endOffset = offsetAt(endLineNumber, endColumn);
      const change = {
        range: new TestRange(startLineNumber, startColumn, endLineNumber, endColumn),
        rangeLength: endOffset - rangeOffset,
        rangeOffset,
        text: "",
      };
      const value = lines.join("\n");
      lines = `${value.slice(0, rangeOffset)}${value.slice(endOffset)}`.split("\n");
      undoEntries.push({ after: [...lines], before });
      redoEntries.length = 0;
      notify([change]);
    },
    startComposition() {
      compositionActive = true;
    },
    endComposition() {
      compositionActive = false;
      for (const listener of compositionEndListeners) listener();
    },
    undo() {
      const entry = undoEntries.pop();
      if (!entry) return;
      lines = [...entry.before];
      redoEntries.push(entry);
    },
    redo() {
      const entry = redoEntries.pop();
      if (!entry) return;
      lines = [...entry.after];
      undoEntries.push(entry);
    },
  };
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

describe("Monaco Markdown table typing", () => {
  it("consumes spare cell padding after a non-pipe character without moving separators", async () => {
    const harness = createTypingHarness([
      "abc | qwe",
      "--- | ---",
      "r   | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 2, "x");
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc | qwe",
      "--- | ---",
      "rx  | ty ",
    ]);
    formatting.dispose();
  });

  it("keeps compact delimiter gutters while consuming padding in one undoable typing history element", async () => {
    const initial = [
      "abc | qwe",
      "----|----",
      "r   | ty ",
    ];
    const formatted = [
      "abc | qwe",
      "----|----",
      "rx  | ty ",
    ];
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 2, "x");
    await Promise.resolve();

    expect(harness.lines()).toEqual(formatted);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    harness.undo();
    expect(harness.lines()).toEqual(initial);
    harness.redo();
    expect(harness.lines()).toEqual(formatted);
    formatting.dispose();
  });

  it("widens every table row when inserted content exceeds the current column width", async () => {
    const harness = createTypingHarness([
      "abc | qwe",
      "--- | ---",
      "xyz | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 4, "q");
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc  | qwe",
      "---- | ---",
      "xyzq | ty ",
    ]);
    formatting.dispose();
  });

  it("grows compact delimiter hyphens when typing overflows the column", async () => {
    const initial = [
      "abc | qwe",
      "----|----",
      "xyz | ty ",
    ];
    const formatted = [
      "abc  | qwe",
      "-----|----",
      "xyzq | ty ",
    ];
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 4, "q");
    await Promise.resolve();

    expect(harness.lines()).toEqual(formatted);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    harness.undo();
    expect(harness.lines()).toEqual(initial);
    harness.redo();
    expect(harness.lines()).toEqual(formatted);
    formatting.dispose();
  });

  it("keeps a boundary still while padding remains, then widens it on overflow", async () => {
    const harness = createTypingHarness([
      "abc | qwe",
      "--- | ---",
      "rr  | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 3, "x");
    await Promise.resolve();
    expect(harness.lines()).toEqual([
      "abc | qwe",
      "--- | ---",
      "rrx | ty ",
    ]);

    harness.type(3, 4, "y");
    await Promise.resolve();
    expect(harness.lines()).toEqual([
      "abc  | qwe",
      "---- | ---",
      "rrxy | ty ",
    ]);
    formatting.dispose();
  });

  it("leaves text typed after a framed closing border outside the table", async () => {
    const harness = createTypingHarness([
      "| A   | B   |",
      "| --- | --- |",
      "| x   | y   |",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, "| x   | y   |".length + 1, " ");
    await Promise.resolve();

    expect(harness.lines()[2]).toBe("| x   | y   | ");
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("leaves non-whitespace typed after an unframed group-title border outside the table", async () => {
    const harness = createTypingHarness([
      "Name  | Done  ",
      "----- | ------",
      "Start | [ ]   ",
      "----- | ------",
      "Second group |",
      "----- | ------",
      "End   | [x]   ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(5, "Second group |".length + 1, "z");
    await Promise.resolve();

    expect(harness.lines()[4]).toBe("Second group |z");
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("keeps later IME replacements outside an unframed group-title border", async () => {
    const title = "Second group |";
    const harness = createTypingHarness([
      "Name  | Done  ",
      "----- | ------",
      "Start | [ ]   ",
      "----- | ------",
      title,
      "----- | ------",
      "End   | [x]   ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.startComposition();
    harness.type(5, title.length + 1, "a");
    await Promise.resolve();
    harness.replace(5, title.length + 1, title.length + 2, "ab");
    harness.endComposition();
    await Promise.resolve();

    expect(harness.lines()[4]).toBe(`${title}ab`);
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("formats a structural pipe committed through IME composition", async () => {
    const harness = createTypingHarness([
      "| A | B |",
      "| --- | --- |",
      "| x y |",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.startComposition();
    harness.type(3, 4, "|");
    await Promise.resolve();
    expect(harness.historyCalls()).toEqual([]);

    harness.endComposition();
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "| A   | B   |",
      "| --- | --- |",
      "| x   | y   |",
    ]);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("leaves an ordinary structural pipe to Monaco's native provider", async () => {
    const harness = createTypingHarness([
      "| A | B |",
      "| --- | --- |",
      "| x y |",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 4, "|");
    await Promise.resolve();

    expect(harness.lines()[2]).toBe("| x| y |");
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("maps a multi-cursor insertion from old ranges into the final model", async () => {
    const harness = createTypingHarness([
      "prefix",
      "```",
      "inside fence content",
      "```",
      "abc | qwe",
      "--- | ---",
      "r   | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.typeMany([
      { column: 7, lineNumber: 1, text: "p".repeat(35) },
      { column: 2, lineNumber: 7, text: "x" },
    ]);
    await Promise.resolve();

    expect(harness.lines()[6]).toBe("rx  | ty ");
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("contracts a column after a Backspace-like in-cell deletion in one Undo/Redo step", async () => {
    const initial = [
      "abc  | qwe",
      "---- | ---",
      "abcd | ty ",
    ];
    const formatted = [
      "abc | qwe",
      "--- | ---",
      "abc | ty ",
    ];
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.delete(3, 4, 5);
    await Promise.resolve();

    expect(harness.lines()).toEqual(formatted);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    harness.undo();
    expect(harness.lines()).toEqual(initial);
    harness.redo();
    expect(harness.lines()).toEqual(formatted);
    formatting.dispose();
  });

  it("contracts a column after a forward-Delete-like in-cell deletion", async () => {
    const harness = createTypingHarness([
      "abc  | qwe",
      "---- | ---",
      "abcd | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.delete(3, 1, 2);
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc | qwe",
      "--- | ---",
      "bcd | ty ",
    ]);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("contracts a column after deleting a selected cell span", async () => {
    const harness = createTypingHarness([
      "abc   | qwe",
      "----- | ---",
      "abcde | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.delete(3, 3, 6);
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc | qwe",
      "--- | ---",
      "ab  | ty ",
    ]);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("contracts a column after a shorter non-empty selection replacement", async () => {
    const harness = createTypingHarness([
      "abc   | qwe",
      "----- | ---",
      "abcde | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.replace(3, 2, 6, "x");
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc | qwe",
      "--- | ---",
      "ax  | ty ",
    ]);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("maps multi-cursor deletions from old ranges into the final model", async () => {
    const harness = createTypingHarness([
      "prefixxxxxxxxxxx",
      "| abc  | qwe |",
      "| ---- | --- |",
      "| abcd | ty  |",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.deleteMany([
      { endColumn: 11, lineNumber: 1, startColumn: 1 },
      { endColumn: 7, lineNumber: 4, startColumn: 6 },
    ]);
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "xxxxxx",
      "| abc | qwe |",
      "| --- | --- |",
      "| abc | ty  |",
    ]);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("formats a deletion immediately before a structural pipe", async () => {
    const initial = [
      "abc  | qwe",
      "---- | ---",
      "abcd | ty ",
    ];
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.delete(3, 5, 6);
    await Promise.resolve();

    expect(harness.lines()).toEqual(initial);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    formatting.dispose();
  });

  it("does not format a deletion after a framed closing border", async () => {
    const harness = createTypingHarness([
      "| abcd | qwe |z",
      "| ---- | --- |",
      "| x | ty |",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.delete(1, 15, 16);
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "| abcd | qwe |",
      "| ---- | --- |",
      "| x | ty |",
    ]);
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("contracts a compact delimiter in the same one-step history element as deletion", async () => {
    const initial = [
      "abc  | qwe",
      "-----|----",
      "abcd | ty ",
    ];
    const formatted = [
      "abc | qwe",
      "----|----",
      "abc | ty ",
    ];
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.delete(3, 4, 5);
    await Promise.resolve();

    expect(harness.lines()).toEqual(formatted);
    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    harness.undo();
    expect(harness.lines()).toEqual(initial);
    harness.redo();
    expect(harness.lines()).toEqual(formatted);
    formatting.dispose();
  });

  it("does not format a deletion that crosses table lines", async () => {
    const harness = createTypingHarness([
      "abc  | qwe",
      "---- | ---",
      "abcd | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.deleteAcrossLines(2, 5, 3, 2);
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc  | qwe",
      "----bcd | ty ",
    ]);
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it.each([
    [
      "inside fenced code",
      ["```", "abc  | qwe", "---- | ---", "abcd | ty ", "```"],
      ["```", "abc  | qwe", "---- | ---", "abc | ty ", "```"],
      (harness: ReturnType<typeof createTypingHarness>) => harness.delete(4, 4, 5),
    ],
    [
      "when deleting a structural pipe leaves no candidate",
      ["abc  | qwe", "---- | ---", "abcd | ty "],
      ["abc  | qwe", "---- | ---", "abcd  ty "],
      (harness: ReturnType<typeof createTypingHarness>) => harness.delete(3, 6, 7),
    ],
  ])("does not format a deletion %s", async (_name, initial, expected, deleteChange) => {
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    deleteChange(harness);
    await Promise.resolve();

    expect(harness.lines()).toEqual(expected);
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("ignores an empty no-op content change", async () => {
    const harness = createTypingHarness([
      "abc  | qwe",
      "---- | ---",
      "abcd | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.replace(3, 4, 4, "");
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc  | qwe",
      "---- | ---",
      "abcd | ty ",
    ]);
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("rejects a multi-change event atomically when any insertion breaks a line", async () => {
    const harness = createTypingHarness([
      "outside",
      "abc | qwe",
      "--- | ---",
      "r   | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.typeMany([
      { column: 8, lineNumber: 1, text: "\n" },
      { column: 2, lineNumber: 4, text: "x" },
    ]);
    await Promise.resolve();

    expect(harness.lines()[4]).toBe("rx   | ty ");
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("does not run a queued composition format after disposal", async () => {
    const harness = createTypingHarness([
      "abc | qwe",
      "--- | ---",
      "r   | ty ",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.startComposition();
    harness.type(3, 2, "x");
    await Promise.resolve();
    formatting.dispose();
    harness.endComposition();
    await Promise.resolve();

    expect(harness.lines()[2]).toBe("rx   | ty ");
    expect(harness.historyCalls()).toEqual([]);
  });

  it("does not format a stale candidate after IME composition is cancelled", async () => {
    const harness = createTypingHarness([
      "abc|qwe",
      "---|---",
      "r|ty",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.startComposition();
    harness.type(3, 2, "x");
    await Promise.resolve();
    harness.replace(3, 2, 3, "");
    harness.endComposition();
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "abc|qwe",
      "---|---",
      "r|ty",
    ]);
    expect(harness.historyCalls()).toEqual([]);
    formatting.dispose();
  });

  it("merges alignment edits with the Monaco history element that inserted the character", async () => {
    const initial = [
      "abc | qwe",
      "--- | ---",
      "r   | ty ",
    ];
    const formatted = [
      "abc | qwe",
      "--- | ---",
      "rx  | ty ",
    ];
    const harness = createTypingHarness(initial);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(3, 2, "x");
    await Promise.resolve();

    expect(harness.historyCalls()).toEqual(["open", "edit", "close"]);
    expect(harness.lines()).toEqual(formatted);
    harness.undo();
    expect(harness.lines()).toEqual(initial);
    harness.redo();
    expect(harness.lines()).toEqual(formatted);
    formatting.dispose();
  });

  it("leaves table-shaped text inside fenced code unchanged", async () => {
    const harness = createTypingHarness([
      "```",
      "abc | qwe",
      "--- | ---",
      "r   | ty ",
      "```",
    ]);
    const formatting = installMonacoMarkdownTableTyping(harness.context);

    harness.type(4, 2, "x");
    await Promise.resolve();

    expect(harness.lines()).toEqual([
      "```",
      "abc | qwe",
      "--- | ---",
      "rx   | ty ",
      "```",
    ]);
    formatting.dispose();
  });
});
