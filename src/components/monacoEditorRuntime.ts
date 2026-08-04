import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/markdown/register";
// Monaco 0.56's features/suggest/register omits the built-in SuggestController.
// Re-audit this package-exported compatibility import whenever Monaco is upgraded.
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

type MonacoWorkerEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
};

type MonacoWorkerGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoWorkerEnvironment;
};

const workerGlobal = globalThis as MonacoWorkerGlobal;
workerGlobal.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export type MonacoEditorApi = typeof monaco;
export const monacoEditor: MonacoEditorApi = monaco;
