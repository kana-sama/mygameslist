import { useEffect, useImperativeHandle, useRef, useState, type ReactElement, type Ref } from "react";
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

export interface MonacoMarkdownEditorHandle { focus(): void }

export interface MonacoMarkdownEditorProps {
  ref?: Ref<MonacoMarkdownEditorHandle>;
  onBlur?(): void;
  language?: string;
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
  ref,
  onBlur,
  ariaLabel,
  autoFocus = false,
  className,
  language = "markdown",
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
  const onBlurRef = useRef(onBlur);
  const focusRequested = useRef(false);
  useImperativeHandle(ref, () => ({ focus() { focusRequested.current = true; editorRef.current?.focus(); } }), []);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const autoFocusRef = useRef(autoFocus);
  const valueRef = useRef(value);
  const [initializationFailed, setInitializationFailed] = useState(false);

  onBlurRef.current = onBlur;
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
    let blurSubscription: Monaco.IDisposable | null = null;
    let changeSubscription: Monaco.IDisposable | null = null;
    let extensionDisposable: Monaco.IDisposable | undefined;
    let initializationCommitted = false;
    setInitializationFailed(false);

    try {
      const uri = monacoEditor.Uri.parse(
        `inmemory://mygameslist/${language}/${encodeURIComponent(modelKey)}.${language === "markdown" ? "md" : "dot"}`,
      );
      if (monacoEditor.editor.getModel(uri)) {
        throw new Error(`Monaco modelKey "${modelKey}" is already mounted.`);
      }

      defineCompactMarkdownTheme(monacoEditor);
      model = monacoEditor.editor.createModel(valueRef.current, language, uri);
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
      blurSubscription = editor.onDidBlurEditorWidget(() => onBlurRef.current?.());
      modelRef.current = model;
      editorRef.current = editor;
      const extension = onReadyRef.current?.({
        editor,
        model,
        monaco: monacoEditor,
      });
      if (extension) extensionDisposable = extension;
      if (autoFocusRef.current || focusRequested.current) editor.focus();
      initializationCommitted = true;
    } catch (error) {
      initializationCommitted = false;
      disposeAll([blurSubscription, changeSubscription, extensionDisposable, editor, model]);
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
      disposeAll([blurSubscription, changeSubscription, extensionDisposable, editor, model]);
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [modelKey, language]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.getValue() === value) return;

    const selections = editor.getSelections();
    applyingExternalValueRef.current = true;
    try {
      editor.executeEdits("mygameslist.externalValue", [{ range: model.getFullModelRange(), text: value }]);
    } finally {
      applyingExternalValueRef.current = false;
    }
    if (selections) editor.setSelections(selections);
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
