import { lazy, Suspense, type ReactElement } from "react";
import type { MonacoNoteEditorProps } from "./MonacoNoteEditor";

const MonacoNoteEditor = lazy(() => import("./MonacoNoteEditor")
  .then(({ MonacoNoteEditor: Editor }) => ({ default: Editor })));

export function LazyMonacoNoteEditor(props: MonacoNoteEditorProps): ReactElement {
  return (
    <Suspense fallback={<div aria-busy="true" className="monaco-note-editor monaco-note-editor--loading" role="status">Загружаем редактор…</div>}>
      <MonacoNoteEditor {...props} />
    </Suspense>
  );
}
