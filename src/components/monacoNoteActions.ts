import type * as Monaco from "monaco-editor";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";

const TRANSIENT_UI_CLOSED = "!suggestWidgetVisible && !findWidgetVisible && !editorHoverVisible && !inSnippetMode && !renameInputVisible && !parameterHintsVisible && !inlineSuggestionVisible && !isComposing";

export interface MonacoNoteActionsOptions {
  cancel?(): void;
  isSubmitDisabled(): boolean;
  submit?(): void | Promise<void>;
}

function disposeAll(resources: readonly Monaco.IDisposable[]): void {
  for (const resource of [...resources].reverse()) {
    try {
      resource.dispose();
    } catch {
      // Release the remaining editor-local actions even if one disposer fails.
    }
  }
}

export function installMonacoNoteActions(
  context: MonacoMarkdownEditorReadyContext,
  options: MonacoNoteActionsOptions,
): Monaco.IDisposable {
  const { editor, monaco } = context;
  const resources: Monaco.IDisposable[] = [];

  try {
    if (options.submit) {
      resources.push(editor.addAction({
        id: "mygameslist.note.submit",
        label: "Save note",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        keybindingContext: TRANSIENT_UI_CLOSED,
        precondition: "editorTextFocus && !editorReadonly",
        run(activeEditor) {
          if (activeEditor.inComposition || options.isSubmitDisabled()) return;
          return options.submit?.();
        },
      }));
    }

    if (options.cancel) {
      resources.push(editor.addAction({
        id: "mygameslist.note.cancel",
        label: "Cancel note edit",
        keybindings: [monaco.KeyCode.Escape],
        keybindingContext: `${TRANSIENT_UI_CLOSED} && !editorHasMultipleSelections`,
        precondition: "editorTextFocus",
        run(activeEditor) {
          if (!activeEditor.inComposition) options.cancel?.();
        },
      }));
      resources.push(editor.addAction({
        id: "mygameslist.note.dismissHover",
        label: "Hide editor hover",
        keybindings: [monaco.KeyCode.Escape],
        keybindingContext: "editorHoverVisible && !isComposing",
        precondition: "editorFocus",
        run(activeEditor) {
          if (!activeEditor.inComposition) return activeEditor.getAction("editor.action.hideHover")?.run();
        },
      }));
    }
  } catch (error) {
    disposeAll(resources);
    throw error;
  }

  return { dispose: () => disposeAll(resources) };
}
