import type * as Monaco from "monaco-editor";
import { resolveMarkdownListEnter } from "./markdownListEditing";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";

const ACTION_ID = "mygameslist.markdownListEnter";
const CANDIDATE_CONTEXT_KEY = "mygameslist.markdownListEnterCandidate";
const LIST_LINE = /^[ \t]*(?:(?:\d+[.)])|[-+*])(?:[ \t]+|$)/u;

export interface MinimalMonacoMarkdownEdit {
  startOffset: number;
  endOffset: number;
  text: string;
  caretOffset: number;
}

export function deriveMinimalMonacoMarkdownEdit(
  previousValue: string,
  nextValue: string,
  caretOffset: number,
): MinimalMonacoMarkdownEdit | null {
  if (previousValue === nextValue) return null;

  let startOffset = 0;
  const sharedLength = Math.min(previousValue.length, nextValue.length);
  while (
    startOffset < sharedLength
    && previousValue[startOffset] === nextValue[startOffset]
  ) startOffset += 1;

  let sharedSuffixLength = 0;
  while (
    sharedSuffixLength < previousValue.length - startOffset
    && sharedSuffixLength < nextValue.length - startOffset
    && previousValue[previousValue.length - sharedSuffixLength - 1]
      === nextValue[nextValue.length - sharedSuffixLength - 1]
  ) sharedSuffixLength += 1;

  return {
    startOffset,
    endOffset: previousValue.length - sharedSuffixLength,
    text: nextValue.slice(startOffset, nextValue.length - sharedSuffixLength),
    caretOffset,
  };
}

function hasOneCollapsedSelection(
  selections: Monaco.Selection[] | null,
): selections is [Monaco.Selection] {
  return selections?.length === 1 && selections[0].isEmpty();
}

function isListLineCandidate(
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): boolean {
  const value = model.getValue();
  const offset = model.getOffsetAt(selection.getPosition());
  const lineStart = value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineEnd = value.indexOf("\n", offset);
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
  return LIST_LINE.test(line);
}

function disposeAll(resources: readonly Monaco.IDisposable[]): void {
  for (let index = resources.length - 1; index >= 0; index -= 1) {
    try {
      resources[index].dispose();
    } catch {
      // Continue releasing the remaining list-editing resources.
    }
  }
}

export function installMonacoMarkdownListEditing(
  context: MonacoMarkdownEditorReadyContext,
): Monaco.IDisposable {
  const { editor, monaco } = context;
  const resources: Monaco.IDisposable[] = [];

  try {
    const candidate = editor.createContextKey<boolean>(CANDIDATE_CONTEXT_KEY, false);
    resources.push({ dispose: () => candidate.reset() });
    let composing = false;

    const refreshCandidate = () => {
      const model = editor.getModel();
      const selections = editor.getSelections();
      candidate.set(Boolean(
        !composing
        && model
        && hasOneCollapsedSelection(selections)
        && isListLineCandidate(model, selections[0]),
      ));
    };

    const action = editor.addAction({
      id: ACTION_ID,
      label: "Continue Markdown List",
      keybindings: [monaco.KeyCode.Enter],
      precondition: "editorTextFocus && !editorReadonly",
      keybindingContext: `${CANDIDATE_CONTEXT_KEY} && !suggestWidgetVisible && !isComposing`,
      run(activeEditor) {
        const fallback = () => activeEditor.trigger("keyboard", "type", { text: "\n" });
        const model = activeEditor.getModel();
        const selections = activeEditor.getSelections();
        if (!model || !hasOneCollapsedSelection(selections)) {
          fallback();
          return;
        }

        const caretOffset = model.getOffsetAt(selections[0].getPosition());
        const previousValue = model.getValue();
        const resolved = resolveMarkdownListEnter(
          previousValue,
          caretOffset,
          caretOffset,
        );
        if (!resolved) {
          fallback();
          return;
        }

        const edit = deriveMinimalMonacoMarkdownEdit(
          previousValue,
          resolved.value,
          resolved.caret,
        );
        if (!edit) {
          fallback();
          return;
        }

        const start = model.getPositionAt(edit.startOffset);
        const end = model.getPositionAt(edit.endOffset);
        const createdPreEditUndoStop = activeEditor.pushUndoStop();
        const applied = activeEditor.executeEdits(
          ACTION_ID,
          [{
            forceMoveMarkers: true,
            range: new monaco.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            ),
            text: edit.text,
          }],
          () => {
            const caret = model.getPositionAt(edit.caretOffset);
            return [new monaco.Selection(
              caret.lineNumber,
              caret.column,
              caret.lineNumber,
              caret.column,
            )];
          },
        );
        if (applied) {
          activeEditor.pushUndoStop();
        } else if (createdPreEditUndoStop) {
          activeEditor.popUndoStop();
        }
      },
    });
    resources.push(action);

    const cursorSubscription = editor.onDidChangeCursorSelection(refreshCandidate);
    resources.push(cursorSubscription);
    const contentSubscription = context.model.onDidChangeContent(refreshCandidate);
    resources.push(contentSubscription);
    const compositionStartSubscription = editor.onDidCompositionStart(() => {
      composing = true;
      candidate.set(false);
    });
    resources.push(compositionStartSubscription);
    const compositionEndSubscription = editor.onDidCompositionEnd(() => {
      composing = false;
      refreshCandidate();
    });
    resources.push(compositionEndSubscription);
    refreshCandidate();

    return { dispose: () => disposeAll(resources) };
  } catch (error) {
    disposeAll(resources);
    throw error;
  }
}
