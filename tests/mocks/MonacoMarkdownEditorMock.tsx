import { useLayoutEffect, type ReactElement } from "react";
import type { MonacoMarkdownEditorProps } from "../../src/components/MonacoMarkdownEditor";

const modelChangeCallbacks = new Map<string, (value: string) => void>();

export function emitMonacoMarkdownChange(modelKey: string, value: string): void {
  const onChange = modelChangeCallbacks.get(modelKey);
  if (!onChange) throw new Error(`Missing Monaco mock model ${modelKey}`);
  onChange(value);
}

export function MonacoMarkdownEditor({
  ariaLabel,
  autoFocus,
  className,
  modelKey,
  onChange,
  readOnly,
  value,
}: MonacoMarkdownEditorProps): ReactElement {
  useLayoutEffect(() => {
    modelChangeCallbacks.set(modelKey, onChange);
    return () => {
      if (modelChangeCallbacks.get(modelKey) === onChange) {
        modelChangeCallbacks.delete(modelKey);
      }
    };
  }, [modelKey, onChange]);

  const rootClassName = ["monaco-markdown-editor", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName} data-auto-focus={autoFocus ? "true" : undefined} data-model-key={modelKey}>
      <textarea
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.currentTarget.value)}
        readOnly={readOnly}
        value={value}
      />
    </div>
  );
}
