import { useLayoutEffect, type DragEvent, type ReactElement } from "react";
import type { MonacoNoteEditorProps } from "../../src/components/MonacoNoteEditor";

const modelChangeCallbacks = new Map<string, (value: string) => void>();

export function emitMonacoMarkdownChange(modelKey: string, value: string): void {
  const onChange = modelChangeCallbacks.get(modelKey);
  if (!onChange) throw new Error(`Missing Monaco mock model ${modelKey}`);
  onChange(value);
}

export function MonacoNoteEditor({
  autoFocus,
  filesDisabled,
  modelKey,
  onChange,
  onFileFiles,
  onImageFiles,
  onSubmit,
  submitDisabled,
  value,
}: MonacoNoteEditorProps): ReactElement {
  useLayoutEffect(() => {
    modelChangeCallbacks.set(modelKey, onChange);
    return () => {
      if (modelChangeCallbacks.get(modelKey) === onChange) {
        modelChangeCallbacks.delete(modelKey);
      }
    };
  }, [modelKey, onChange]);

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (filesDisabled) return;
    const files = Array.from(event.dataTransfer.files);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const otherFiles = files.filter((file) => !file.type.startsWith("image/"));
    if (imageFiles.length) onImageFiles(imageFiles);
    if (otherFiles.length) onFileFiles(otherFiles);
  };

  return (
    <div className="monaco-note-editor" data-model-key={modelKey} onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
      <textarea
        aria-label="Текст заметки"
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !submitDisabled) {
            event.preventDefault();
            void onSubmit?.();
          }
        }}
        value={value}
      />
    </div>
  );
}
