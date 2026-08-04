import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import { installMonacoMarkdownListEditing as publicInstallMonacoMarkdownListEditing } from "../src/components";
import {
  deriveMinimalMonacoMarkdownEdit,
  installMonacoMarkdownListEditing,
} from "../src/components/monacoMarkdownListEditing";

type Listener = () => void;

class TestPosition {
  constructor(
    readonly lineNumber: number,
    readonly column: number,
  ) {}
}

class TestRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

class TestSelection extends TestRange {
  constructor(
    selectionStartLineNumber: number,
    selectionStartColumn: number,
    positionLineNumber: number,
    positionColumn: number,
  ) {
    super(
      Math.min(selectionStartLineNumber, positionLineNumber),
      selectionStartLineNumber === positionLineNumber
        ? Math.min(selectionStartColumn, positionColumn)
        : selectionStartLineNumber < positionLineNumber ? selectionStartColumn : positionColumn,
      Math.max(selectionStartLineNumber, positionLineNumber),
      selectionStartLineNumber === positionLineNumber
        ? Math.max(selectionStartColumn, positionColumn)
        : selectionStartLineNumber < positionLineNumber ? positionColumn : selectionStartColumn,
    );
    this.selectionStartLineNumber = selectionStartLineNumber;
    this.selectionStartColumn = selectionStartColumn;
    this.positionLineNumber = positionLineNumber;
    this.positionColumn = positionColumn;
  }

  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;

  getPosition(): TestPosition {
    return new TestPosition(this.positionLineNumber, this.positionColumn);
  }

  isEmpty(): boolean {
    return this.selectionStartLineNumber === this.positionLineNumber
      && this.selectionStartColumn === this.positionColumn;
  }
}

function offsetAt(value: string, position: Monaco.IPosition): number {
  const lines = value.split("\n");
  let offset = 0;
  for (let index = 1; index < position.lineNumber; index += 1) {
    offset += lines[index - 1].length + 1;
  }
  return Math.min(value.length, offset + position.column - 1);
}

function positionAt(value: string, requestedOffset: number): TestPosition {
  const offset = Math.max(0, Math.min(value.length, requestedOffset));
  const prefix = value.slice(0, offset);
  const lineNumber = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  return new TestPosition(lineNumber, offset - lastNewline);
}

function eventSource() {
  const listeners = new Set<Listener>();
  const dispose = vi.fn((listener: Listener) => listeners.delete(listener));
  return {
    dispose,
    emit() {
      for (const listener of listeners) listener();
    },
    event(listener: Listener) {
      listeners.add(listener);
      return { dispose: () => dispose(listener) };
    },
  };
}

function createHarness(
  initialValue: string,
  initialSelections: TestSelection[] = [new TestSelection(1, 1, 1, 1)],
) {
  let value = initialValue;
  let selections = initialSelections;
  let modelAvailable = true;
  let executeEditsResult = true;
  let pushUndoStopResult = true;
  const actionDispose = vi.fn();
  const contextReset = vi.fn();
  const contextSet = vi.fn();
  const cursorChanges = eventSource();
  const contentChanges = eventSource();
  const compositionStarts = eventSource();
  const compositionEnds = eventSource();

  const model = {
    getOffsetAt: (position: Monaco.IPosition) => offsetAt(value, position),
    getPositionAt: (offset: number) => positionAt(value, offset),
    getValue: () => value,
    onDidChangeContent: contentChanges.event,
  } as unknown as Monaco.editor.ITextModel;

  let registeredAction: Monaco.editor.IActionDescriptor | undefined;
  const executeEdits = vi.fn((
    _source: string,
    edits: Monaco.editor.IIdentifiedSingleEditOperation[],
    endCursorState?: Monaco.editor.ICursorStateComputer | Monaco.Selection[],
  ) => {
    expect(edits).toHaveLength(1);
    if (!executeEditsResult) return false;
    const edit = edits[0];
    const start = offsetAt(value, {
      lineNumber: edit.range.startLineNumber,
      column: edit.range.startColumn,
    });
    const end = offsetAt(value, {
      lineNumber: edit.range.endLineNumber,
      column: edit.range.endColumn,
    });
    value = `${value.slice(0, start)}${edit.text ?? ""}${value.slice(end)}`;
    if (typeof endCursorState === "function") {
      selections = endCursorState([] as unknown as Monaco.editor.ICursorStateComputerData) as TestSelection[];
    } else if (endCursorState) {
      selections = endCursorState as unknown as TestSelection[];
    }
    return true;
  });
  const editor = {
    addAction: vi.fn((descriptor: Monaco.editor.IActionDescriptor) => {
      registeredAction = descriptor;
      return { dispose: actionDispose };
    }),
    createContextKey: vi.fn(() => ({
      get: vi.fn(),
      reset: contextReset,
      set: contextSet,
    })),
    executeEdits,
    getModel: vi.fn(() => modelAvailable ? model : null),
    getSelections: vi.fn(() => selections),
    onDidChangeCursorSelection: cursorChanges.event,
    onDidCompositionEnd: compositionEnds.event,
    onDidCompositionStart: compositionStarts.event,
    popUndoStop: vi.fn(() => true),
    pushUndoStop: vi.fn(() => pushUndoStopResult),
    trigger: vi.fn(),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const monaco = {
    KeyCode: { Enter: 3 },
    Range: TestRange,
    Selection: TestSelection,
  } as unknown as MonacoMarkdownEditorReadyContext["monaco"];
  const context: MonacoMarkdownEditorReadyContext = { editor, model, monaco };

  return {
    action: () => {
      if (!registeredAction) throw new Error("No action registered");
      return registeredAction;
    },
    actionDispose,
    compositionEnds,
    compositionStarts,
    context,
    contextReset,
    contextSet,
    contentChanges,
    cursorChanges,
    editor,
    executeEdits,
    model,
    selections: () => selections,
    setModelAvailable(next: boolean) {
      modelAvailable = next;
    },
    setExecuteEditsResult(next: boolean) {
      executeEditsResult = next;
    },
    setPushUndoStopResult(next: boolean) {
      pushUndoStopResult = next;
    },
    setSelections(next: TestSelection[]) {
      selections = next;
    },
    value: () => value,
  };
}

type LifecycleResource =
  | "context"
  | "action"
  | "cursor"
  | "content"
  | "compositionStart"
  | "compositionEnd";

function createLifecycleHarness({
  cleanupErrors = {},
  initialRefreshError,
  registrationFailure,
}: {
  cleanupErrors?: Partial<Record<LifecycleResource, Error>>;
  initialRefreshError?: Error;
  registrationFailure?: { resource: LifecycleResource; error: Error };
} = {}) {
  const source = "- Item";
  const cleanupOrder: LifecycleResource[] = [];
  const selection = new TestSelection(1, source.length + 1, 1, source.length + 1);

  const cleanup = (resource: LifecycleResource) => {
    cleanupOrder.push(resource);
    const error = cleanupErrors[resource];
    if (error) throw error;
  };
  const acquire = (resource: Exclude<LifecycleResource, "context">) => {
    if (registrationFailure?.resource === resource) throw registrationFailure.error;
    return { dispose: () => cleanup(resource) };
  };

  const model = {
    getOffsetAt: (position: Monaco.IPosition) => offsetAt(source, position),
    getValue: () => source,
    onDidChangeContent: () => acquire("content"),
  } as unknown as Monaco.editor.ITextModel;
  const editor = {
    addAction: () => acquire("action"),
    createContextKey: () => {
      if (registrationFailure?.resource === "context") throw registrationFailure.error;
      return {
        get: vi.fn(),
        reset: () => cleanup("context"),
        set: () => {
          if (initialRefreshError) throw initialRefreshError;
        },
      };
    },
    getModel: () => model,
    getSelections: () => [selection],
    onDidChangeCursorSelection: () => acquire("cursor"),
    onDidCompositionEnd: () => acquire("compositionEnd"),
    onDidCompositionStart: () => acquire("compositionStart"),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const monaco = {
    KeyCode: { Enter: 3 },
    Range: TestRange,
    Selection: TestSelection,
  } as unknown as MonacoMarkdownEditorReadyContext["monaco"];

  return {
    cleanupOrder,
    context: { editor, model, monaco } as MonacoMarkdownEditorReadyContext,
  };
}

function captureThrown(action: () => void): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}

function collapsedSelection(value: string, offset: number): TestSelection {
  const position = positionAt(value, offset);
  return new TestSelection(
    position.lineNumber,
    position.column,
    position.lineNumber,
    position.column,
  );
}

describe("deriveMinimalMonacoMarkdownEdit", () => {
  it("keeps only the smallest changed middle and the resolver caret", () => {
    expect(deriveMinimalMonacoMarkdownEdit(
      "- AlphaBeta",
      "- Alpha\n- Beta",
      10,
    )).toEqual({
      startOffset: 7,
      endOffset: 7,
      text: "\n- ",
      caretOffset: 10,
    });
  });

  it("returns null when the resolver produces no text change", () => {
    expect(deriveMinimalMonacoMarkdownEdit("- Item", "- Item", 6)).toBeNull();
  });
});

describe("installMonacoMarkdownListEditing", () => {
  it("is available through the public component barrel", () => {
    expect(publicInstallMonacoMarkdownListEditing).toBe(installMonacoMarkdownListEditing);
  });

  it("registers one scoped plain-Enter action and refreshes its candidate context", () => {
    const source = "- Item";
    const harness = createHarness(source, [collapsedSelection(source, source.length)]);

    const installed = installMonacoMarkdownListEditing(harness.context);

    expect(harness.editor.createContextKey).toHaveBeenCalledWith(
      "mygameslist.markdownListEnterCandidate",
      false,
    );
    expect(harness.editor.addAction).toHaveBeenCalledOnce();
    expect(harness.action()).toMatchObject({
      id: "mygameslist.markdownListEnter",
      keybindings: [3],
      precondition: "editorTextFocus && !editorReadonly",
      keybindingContext: "mygameslist.markdownListEnterCandidate && !suggestWidgetVisible && !isComposing",
    });
    expect(harness.contextSet).toHaveBeenLastCalledWith(true);

    harness.setSelections([new TestSelection(1, 3, 1, 5)]);
    harness.cursorChanges.emit();
    expect(harness.contextSet).toHaveBeenLastCalledWith(false);

    harness.setSelections([collapsedSelection(source, source.length)]);
    harness.contentChanges.emit();
    expect(harness.contextSet).toHaveBeenLastCalledWith(true);

    harness.compositionStarts.emit();
    expect(harness.contextSet).toHaveBeenLastCalledWith(false);
    harness.compositionEnds.emit();
    expect(harness.contextSet).toHaveBeenLastCalledWith(true);

    installed.dispose();
    expect(harness.contextReset).toHaveBeenCalledOnce();
    expect(harness.actionDispose).toHaveBeenCalledOnce();
    expect(harness.cursorChanges.dispose).toHaveBeenCalledOnce();
    expect(harness.contentChanges.dispose).toHaveBeenCalledOnce();
    expect(harness.compositionStarts.dispose).toHaveBeenCalledOnce();
    expect(harness.compositionEnds.dispose).toHaveBeenCalledOnce();
  });

  it("rolls back every acquired resource when a later registration throws", () => {
    const installationError = new Error("content registration failed");
    const harness = createLifecycleHarness({
      registrationFailure: { resource: "content", error: installationError },
    });

    const thrown = captureThrown(() => installMonacoMarkdownListEditing(harness.context));

    expect(thrown).toBe(installationError);
    expect(harness.cleanupOrder).toEqual(["cursor", "action", "context"]);
  });

  it("rolls back all resources in reverse order when the initial refresh throws", () => {
    const refreshError = new Error("initial refresh failed");
    const harness = createLifecycleHarness({ initialRefreshError: refreshError });

    const thrown = captureThrown(() => installMonacoMarkdownListEditing(harness.context));

    expect(thrown).toBe(refreshError);
    expect(harness.cleanupOrder).toEqual([
      "compositionEnd",
      "compositionStart",
      "content",
      "cursor",
      "action",
      "context",
    ]);
  });

  it("continues reverse-order disposal when one child disposer throws", () => {
    const harness = createLifecycleHarness({
      cleanupErrors: { compositionStart: new Error("composition cleanup failed") },
    });
    const installed = installMonacoMarkdownListEditing(harness.context);

    expect(() => installed.dispose()).not.toThrow();
    expect(harness.cleanupOrder).toEqual([
      "compositionEnd",
      "compositionStart",
      "content",
      "cursor",
      "action",
      "context",
    ]);
  });

  it("rethrows the original installation error when rollback cleanup also throws", () => {
    const installationError = new Error("composition registration failed");
    const harness = createLifecycleHarness({
      cleanupErrors: { content: new Error("content cleanup failed") },
      registrationFailure: {
        resource: "compositionStart",
        error: installationError,
      },
    });

    const thrown = captureThrown(() => installMonacoMarkdownListEditing(harness.context));

    expect(thrown).toBe(installationError);
    expect(harness.cleanupOrder).toEqual(["content", "cursor", "action", "context"]);
  });

  it("splits a bullet with one minimal edit, explicit caret, and undo boundary", () => {
    const source = "- AlphaBeta";
    const harness = createHarness(source, [collapsedSelection(source, 7)]);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.value()).toBe("- Alpha\n- Beta");
    expect(harness.executeEdits).toHaveBeenCalledOnce();
    expect(harness.executeEdits.mock.calls[0][0]).toBe("mygameslist.markdownListEnter");
    expect(harness.executeEdits.mock.calls[0][1]).toEqual([{
      forceMoveMarkers: true,
      range: new TestRange(1, 8, 1, 8),
      text: "\n- ",
    }]);
    expect(harness.selections()).toEqual([new TestSelection(2, 3, 2, 3)]);
    expect(harness.editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(harness.editor.trigger).not.toHaveBeenCalled();
  });

  it("renumbers an ordered tail in one edit", () => {
    const source = "1. One\n2. Two\n3. Three";
    const harness = createHarness(source, [collapsedSelection(source, "1. One".length)]);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.value()).toBe("1. One\n2. \n3. Two\n4. Three");
    expect(harness.executeEdits).toHaveBeenCalledOnce();
    expect(harness.selections()).toEqual([new TestSelection(2, 4, 2, 4)]);
  });

  it("continues a checked task as an unchecked task", () => {
    const source = "* [X] Done";
    const harness = createHarness(source, [collapsedSelection(source, source.length)]);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.value()).toBe("* [X] Done\n* [ ] ");
    expect(harness.selections()).toEqual([new TestSelection(2, 7, 2, 7)]);
  });

  it("preserves CRLF in the minimal edit and restores the post-edit caret", () => {
    const source = "- AlphaBeta\r\n- Next";
    const harness = createHarness(source, [collapsedSelection(source, 7)]);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.value()).toBe("- Alpha\r\n- Beta\r\n- Next");
    expect(harness.executeEdits.mock.calls[0][1]).toEqual([{
      forceMoveMarkers: true,
      range: new TestRange(1, 8, 1, 8),
      text: "\r\n- ",
    }]);
    expect(harness.selections()).toEqual([new TestSelection(2, 3, 2, 3)]);
  });

  it("removes a newly created pre-edit undo boundary when Monaco rejects the edit", () => {
    const source = "- Item";
    const harness = createHarness(source, [collapsedSelection(source, source.length)]);
    harness.setExecuteEditsResult(false);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.value()).toBe(source);
    expect(harness.executeEdits).toHaveBeenCalledOnce();
    expect(harness.editor.pushUndoStop).toHaveBeenCalledOnce();
    expect(harness.editor.popUndoStop).toHaveBeenCalledOnce();
    expect(harness.editor.trigger).not.toHaveBeenCalled();
  });

  it("does not pop an existing undo boundary when the pre-edit push created none", () => {
    const source = "- Item";
    const harness = createHarness(source, [collapsedSelection(source, source.length)]);
    harness.setPushUndoStopResult(false);
    harness.setExecuteEditsResult(false);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.value()).toBe(source);
    expect(harness.executeEdits).toHaveBeenCalledOnce();
    expect(harness.editor.pushUndoStop).toHaveBeenCalledOnce();
    expect(harness.editor.popUndoStop).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "ordinary text",
      source: "Paragraph",
      selections: [collapsedSelection("Paragraph", "Paragraph".length)],
    },
    {
      name: "a selected range",
      source: "- Selected",
      selections: [new TestSelection(1, 3, 1, 8)],
    },
    {
      name: "multiple cursors",
      source: "- One\n- Two",
      selections: [collapsedSelection("- One\n- Two", 5), collapsedSelection("- One\n- Two", 11)],
    },
  ])("keeps the scoped key disabled for $name", ({ source, selections }) => {
    const harness = createHarness(source, selections);

    installMonacoMarkdownListEditing(harness.context);

    expect(harness.contextSet).toHaveBeenLastCalledWith(false);
  });

  it.each([
    { name: "a caret inside the marker", source: "- Item", offset: 1 },
    { name: "a fenced list-looking line", source: "```\n- Code\n```", offset: "```\n- Code".length },
  ])("delegates $name to Monaco's native newline", ({ source, offset }) => {
    const harness = createHarness(source, [collapsedSelection(source, offset)]);
    installMonacoMarkdownListEditing(harness.context);

    harness.action().run(harness.editor);

    expect(harness.executeEdits).not.toHaveBeenCalled();
    expect(harness.editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "type",
      { text: "\n" },
    );
    expect(harness.editor.pushUndoStop).not.toHaveBeenCalled();
  });

  it("delegates when the editor has no model", () => {
    const source = "- Item";
    const harness = createHarness(source, [collapsedSelection(source, source.length)]);
    installMonacoMarkdownListEditing(harness.context);
    harness.setModelAvailable(false);

    harness.action().run(harness.editor);

    expect(harness.editor.trigger).toHaveBeenCalledWith(
      "keyboard",
      "type",
      { text: "\n" },
    );
  });
});
