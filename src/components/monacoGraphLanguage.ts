import type * as Monaco from "monaco-editor";
import { validateGraph } from "../domain/graph";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";

const language = "graph-note";
const attributes = ["label", "subtitle", "kind", "task", "state", "layout"];
const values: Record<string, string[]> = { kind: ["normal", "special", "milestone", "note", "group", "section"], task: ["true", "false"], state: ["todo", "doing", "done"], layout: ["flow", "grid"] };
const registered = new WeakSet<object>();
export function installMonacoGraphLanguage({ monaco, model }: MonacoMarkdownEditorReadyContext): Monaco.IDisposable {
  if (!registered.has(monaco)) {
    monaco.languages.register({ id: language });
    monaco.languages.setMonarchTokensProvider(language, {
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"], [/\/\*/, "comment", "@comment"],
          [/"(?:[^"\\]|\\.)*"/, "string"],
          [/\b(?:digraph|subgraph|graph)\b/, "keyword"],
          [/\b(?:label|subtitle|kind|task|state|layout)\b/, "attribute.name"],
          [/\b(?:true|false|todo|doing|done|normal|special|milestone|note|group|section|flow|grid)\b/, "keyword"],
          [/->/, "operator"], [/[{}\[\];,=]/, "delimiter"], [/[^\s{}\[\];,=]+/, "identifier"],
        ],
        comment: [[/[^*]+/, "comment"], [/\*\//, "comment", "@pop"], [/\*/, "comment"]],
      },
    });
    registered.add(monaco);
  }
  monaco.editor.setModelLanguage(model, language);
  const updateMarkers = () => {
    monaco.editor.setModelMarkers(model, language, validateGraph(model.getValue()).map(error => {
      const end = model.getPositionAt(error.offset + error.length);
      return { severity: monaco.MarkerSeverity.Error, message: error.message, startLineNumber: error.line, startColumn: error.column, endLineNumber: end.lineNumber, endColumn: end.column };
    }));
  };
  updateMarkers();
  const listener = model.onDidChangeContent(updateMarkers);
  const completion = monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ["=", "[", ","],
    provideCompletionItems(candidate, position) {
      if (candidate !== model || model.isDisposed()) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const attribute = before.match(/(kind|task|state|layout)\s*=\s*$/)?.[1];
      const labels = attribute ? values[attribute] : [...attributes, "digraph", "subgraph", "graph"];
      return { suggestions: labels.map(label => ({ label, insertText: label, kind: attribute ? monaco.languages.CompletionItemKind.EnumMember : monaco.languages.CompletionItemKind.Keyword, range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn } })) };
    },
  });
  return { dispose() { listener.dispose(); completion.dispose(); if (!model.isDisposed()) monaco.editor.setModelMarkers(model, language, []); } };
}
