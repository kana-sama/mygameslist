import { useEffect, useRef, useState, type ReactElement } from "react";
import type * as Monaco from "monaco-editor";
import {
  createCompactMarkdownEditorOptions,
  defineCompactMarkdownTheme,
} from "./monacoMarkdownEditorConfig";
import { monacoEditor, type MonacoEditorApi } from "./monacoEditorRuntime";

type Disposable = { dispose(): void };

export interface MonacoMarkdownEditorReadyContext {
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  monaco: MonacoEditorApi;
}

export type MonacoMarkdownEditorExtension = (
  context: MonacoMarkdownEditorReadyContext,
) => Monaco.IDisposable | void;

export interface MonacoMarkdownEditorProps {
  modelKey: string;
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  onError?(error: unknown): void;
  onReady?: MonacoMarkdownEditorExtension;
  readOnly?: boolean;
}

function disposeAll(resources: Array<Disposable | null | undefined>): void {
  for (const resource of resources) {
    try {
      resource?.dispose();
    } catch {
      // Continue disposing the remaining resources owned by this component.
    }
  }
}

export function MonacoMarkdownEditor({
  ariaLabel,
  autoFocus = false,
  className,
  modelKey,
  onChange,
  onError,
  onReady,
  readOnly = false,
  value,
}: MonacoMarkdownEditorProps): ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const applyingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const autoFocusRef = useRef(autoFocus);
  const valueRef = useRef(value);
  const [initializationFailed, setInitializationFailed] = useState(false);

  onChangeRef.current = onChange;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  autoFocusRef.current = autoFocus;
  valueRef.current = value;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let model: Monaco.editor.ITextModel | null = null;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let changeSubscription: Monaco.IDisposable | null = null;
    let extensionDisposable: Monaco.IDisposable | undefined;
    let initializationCommitted = false;
    setInitializationFailed(false);

    try {
      const uri = monacoEditor.Uri.parse(
        `inmemory://mygameslist/markdown/${encodeURIComponent(modelKey)}.md`,
      );
      if (monacoEditor.editor.getModel(uri)) {
        throw new Error(`Monaco modelKey "${modelKey}" is already mounted.`);
      }

      defineCompactMarkdownTheme(monacoEditor);
      model = monacoEditor.editor.createModel(valueRef.current, "markdown", uri);
      editor = monacoEditor.editor.create(
        surface,
        createCompactMarkdownEditorOptions({ ariaLabel, model, readOnly }),
      );
      changeSubscription = model.onDidChangeContent(() => {
        if (
          initializationCommitted
          && !applyingExternalValueRef.current
          && model
        ) {
          onChangeRef.current(model.getValue());
        }
      });
      modelRef.current = model;
      editorRef.current = editor;
      const extension = onReadyRef.current?.({
        editor,
        model,
        monaco: monacoEditor,
      });
      if (extension) extensionDisposable = extension;
      if (autoFocusRef.current) editor.focus();
      initializationCommitted = true;
    } catch (error) {
      initializationCommitted = false;
      disposeAll([changeSubscription, extensionDisposable, editor, model]);
      extensionDisposable = undefined;
      changeSubscription = null;
      editor = null;
      model = null;
      editorRef.current = null;
      modelRef.current = null;
      setInitializationFailed(true);
      onErrorRef.current?.(error);
    }

    return () => {
      initializationCommitted = false;
      disposeAll([changeSubscription, extensionDisposable, editor, model]);
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [modelKey]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.getValue() === value) return;

    const position = editor.getPosition();
    applyingExternalValueRef.current = true;
    try {
      model.setValue(value);
    } finally {
      applyingExternalValueRef.current = false;
    }
    if (position) editor.setPosition(model.validatePosition(position));
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ ariaLabel, readOnly });
  }, [ariaLabel, readOnly]);

  const rootClassName = ["monaco-markdown-editor", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <div
        aria-hidden={initializationFailed ? true : undefined}
        className="monaco-markdown-editor__surface"
        ref={surfaceRef}
      />
      {initializationFailed ? (
        <div className="monaco-markdown-editor__error" role="alert">
          Не удалось открыть редактор.
        </div>
      ) : null}
    </div>
  );
}
