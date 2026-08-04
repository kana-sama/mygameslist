import type * as Monaco from "monaco-editor";
import { isInsideFencedMarkdownCode } from "./markdownListEditing";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";
import {
  deriveMinimalMarkdownTableLineEdit,
  formatMarkdownTableAtLine,
} from "./markdownTableFormatting";
import { scanMarkdownTableLine } from "./markdownTableSyntax";

const TABLE_TYPING_EDIT_SOURCE = "mygameslist.markdownTableTyping";

function finalInsertedCellRange(
  model: Monaco.editor.ITextModel,
  changes: readonly Monaco.editor.IModelContentChange[],
  target: Monaco.editor.IModelContentChange,
): { endOffset: number; lineIndex: number; startOffset: number } | null {
  const precedingDelta = changes.reduce((total, change) => {
    if (change === target || change.rangeOffset + change.rangeLength > target.rangeOffset) {
      return total;
    }
    return total + change.text.length - change.rangeLength;
  }, 0);
  const valueLength = model.getValue().length;
  const startOffset = Math.max(0, Math.min(valueLength, target.rangeOffset + precedingDelta));
  const endOffset = Math.max(startOffset, Math.min(valueLength, startOffset + target.text.length));
  const start = model.getPositionAt(startOffset);
  const end = model.getPositionAt(endOffset);
  if (start.lineNumber !== end.lineNumber) return null;

  const line = model.getLineContent(start.lineNumber);
  const startIndex = start.column - 1;
  const endIndex = end.column - 1;
  if (target.rangeLength === 0) {
    const previousSyntax = scanMarkdownTableLine(
      `${line.slice(0, startIndex)}${line.slice(endIndex)}`,
    );
    const previousFirstPipe = previousSyntax?.pipeIndices[0];
    const previousLastPipe = previousSyntax?.pipeIndices.at(-1);
    if (
      previousSyntax?.hasLeadingPipe
      && previousFirstPipe !== undefined
      && startIndex <= previousFirstPipe
    ) return null;
    if (
      previousSyntax?.hasTrailingPipe
      && previousLastPipe !== undefined
      && startIndex > previousLastPipe
    ) return null;
  }

  const syntax = scanMarkdownTableLine(line);
  if (!syntax) return null;
  const firstPipe = syntax.pipeIndices[0];
  const lastPipe = syntax.pipeIndices.at(-1);
  if (syntax.hasLeadingPipe && firstPipe !== undefined && startIndex <= firstPipe) return null;
  if (syntax.hasTrailingPipe && lastPipe !== undefined && endIndex > lastPipe) return null;

  return { endOffset, lineIndex: start.lineNumber - 1, startOffset };
}

function formattingEditsAtLine(
  monaco: Pick<typeof Monaco, "Range">,
  model: Monaco.editor.ITextModel,
  lineIndex: number,
): Monaco.languages.TextEdit[] {
  const lines = Array.from(
    { length: model.getLineCount() },
    (_, index) => model.getLineContent(index + 1),
  );
  const formatted = formatMarkdownTableAtLine(lines, lineIndex);
  if (!formatted) return [];
  return formatted.lines.flatMap((formattedLine) => {
    const edit = deriveMinimalMarkdownTableLineEdit(
      lines[formattedLine.lineIndex],
      formattedLine.text,
    );
    if (!edit) return [];
    return [{
      range: new monaco.Range(
        formattedLine.lineIndex + 1,
        edit.startColumn + 1,
        formattedLine.lineIndex + 1,
        edit.endColumn + 1,
      ),
      text: edit.text,
    }];
  });
}

export function createMonacoMarkdownTableOnTypeProvider(
  monaco: Pick<typeof Monaco, "Range">,
): Monaco.languages.OnTypeFormattingEditProvider {
  return {
    autoFormatTriggerCharacters: ["|"],
    provideOnTypeFormattingEdits(model, position, character, _options, token) {
      if (token.isCancellationRequested || character !== "|") return [];
      const lineIndex = position.lineNumber - 1;
      const line = model.getLineContent(position.lineNumber);
      const typedPipeIndex = position.column - 2;
      const syntax = scanMarkdownTableLine(line);
      if (!syntax?.pipeIndices.includes(typedPipeIndex)) return [];
      const typedOffset = model.getOffsetAt(position) - 1;
      if (isInsideFencedMarkdownCode(model.getValue(), typedOffset)) return [];

      return formattingEditsAtLine(monaco, model, lineIndex);
    },
  };
}

export function installMonacoMarkdownTableTyping(
  context: MonacoMarkdownEditorReadyContext,
): Monaco.IDisposable {
  const { editor, model, monaco } = context;
  const compositionLineEligibility = new Map<number, boolean>();
  const pendingLines = new Set<number>();
  let applyingFormatting = false;
  let disposed = false;
  let scheduled = false;

  const formatPendingLines = () => {
    scheduled = false;
    if (
      disposed
      || applyingFormatting
      || editor.inComposition
      || editor.getModel() !== model
    ) return;

    const lineIndices = [...pendingLines];
    pendingLines.clear();
    const editsByLine = new Map<number, Monaco.languages.TextEdit>();
    for (const lineIndex of lineIndices) {
      for (const edit of formattingEditsAtLine(monaco, model, lineIndex)) {
        editsByLine.set(edit.range.startLineNumber, edit);
      }
    }
    if (!editsByLine.size) return;

    model.popStackElement();
    applyingFormatting = true;
    try {
      editor.executeEdits(
        TABLE_TYPING_EDIT_SOURCE,
        [...editsByLine.values()]
          .sort((left, right) => left.range.startLineNumber - right.range.startLineNumber)
          .map((edit) => ({
            forceMoveMarkers: true,
            range: edit.range,
            text: edit.text,
          })),
      );
    } finally {
      applyingFormatting = false;
      model.pushStackElement();
    }
  };

  const scheduleFormatting = () => {
    if (disposed || scheduled || !pendingLines.size) return;
    scheduled = true;
    queueMicrotask(formatPendingLines);
  };

  const contentSubscription = model.onDidChangeContent((event) => {
    if (applyingFormatting) return;
    if (
      event.isFlush
      || event.isUndoing
      || event.isRedoing
      || event.isEolChange
      || event.changes.some((change) => (
        /[\r\n]/u.test(change.text)
        || change.range.startLineNumber !== change.range.endLineNumber
      ))
    ) {
      compositionLineEligibility.clear();
      pendingLines.clear();
      return;
    }

    const value = model.getValue();
    const compositionInput = editor.inComposition;
    const candidateLines = new Set<number>();
    if (compositionInput) {
      for (const change of event.changes) {
        pendingLines.delete(change.range.startLineNumber - 1);
      }
    }
    for (const change of event.changes) {
      const eventLineIndex = change.range.startLineNumber - 1;
      if (!change.text) {
        pendingLines.delete(eventLineIndex);
        continue;
      }
      if (change.text === "|" && !compositionInput) continue;
      const inserted = finalInsertedCellRange(model, event.changes, change);
      if (compositionInput) {
        const initialEligibility = compositionLineEligibility.get(eventLineIndex);
        if (initialEligibility === false) continue;
        if (initialEligibility === undefined) {
          const eligible = inserted !== null;
          compositionLineEligibility.set(eventLineIndex, eligible);
          if (!eligible) continue;
        }
      }
      if (!inserted) continue;
      const insertedOffset = Math.max(inserted.startOffset, inserted.endOffset - 1);
      if (isInsideFencedMarkdownCode(value, insertedOffset)) continue;
      candidateLines.add(inserted.lineIndex);
    }
    for (const lineIndex of candidateLines) pendingLines.add(lineIndex);
    scheduleFormatting();
  });
  const compositionEndSubscription = editor.onDidCompositionEnd(() => {
    compositionLineEligibility.clear();
    scheduleFormatting();
  });

  return {
    dispose() {
      disposed = true;
      compositionLineEligibility.clear();
      pendingLines.clear();
      compositionEndSubscription.dispose();
      contentSubscription.dispose();
    },
  };
}

export function registerMonacoMarkdownTableFormatting(
  monaco: Pick<typeof Monaco, "Range" | "languages">,
): Monaco.IDisposable {
  return monaco.languages.registerOnTypeFormattingEditProvider(
    "markdown",
    createMonacoMarkdownTableOnTypeProvider(monaco),
  );
}
