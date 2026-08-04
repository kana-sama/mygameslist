import { useRef, type ReactElement } from "react";
import type * as Monaco from "monaco-editor";
import type { Game } from "../domain/types";
import {
  MonacoMarkdownEditor,
  type MonacoMarkdownEditorExtension,
} from "./MonacoMarkdownEditor";
import { installMonacoGameLinkCompletion } from "./monacoGameLinkCompletion";
import { installMonacoMarkdownListEditing } from "./monacoMarkdownListEditing";
import { installMonacoNoteActions } from "./monacoNoteActions";
import { useNoteFileTransferCapture } from "./useNoteFileTransferCapture";

export interface MonacoNoteEditorProps {
  modelKey: string;
  value: string;
  gameSuggestions: readonly Game[];
  excludeGameId?: string;
  autoFocus?: boolean;
  filesDisabled?: boolean;
  submitDisabled?: boolean;
  onChange(value: string): void;
  onSubmit?(): void | Promise<void>;
  onCancel?(): void;
  onImageFiles(files: File[]): void;
  onFileFiles(files: File[]): void;
}

type LiveValues = Pick<
  MonacoNoteEditorProps,
  | "excludeGameId"
  | "gameSuggestions"
  | "onCancel"
  | "onFileFiles"
  | "onImageFiles"
  | "onSubmit"
  | "submitDisabled"
>;

function disposeAll(resources: readonly Monaco.IDisposable[]): void {
  for (const resource of [...resources].reverse()) {
    try {
      resource.dispose();
    } catch {
      // Continue releasing editor-local extensions after a failed disposer.
    }
  }
}

export function MonacoNoteEditor({
  autoFocus,
  excludeGameId,
  filesDisabled,
  gameSuggestions,
  modelKey,
  onCancel,
  onChange,
  onFileFiles,
  onImageFiles,
  onSubmit,
  submitDisabled,
  value,
}: MonacoNoteEditorProps): ReactElement {
  const live = useRef<LiveValues>({
    excludeGameId,
    gameSuggestions,
    onCancel,
    onFileFiles,
    onImageFiles,
    onSubmit,
    submitDisabled,
  });
  live.current = {
    excludeGameId,
    gameSuggestions,
    onCancel,
    onFileFiles,
    onImageFiles,
    onSubmit,
    submitDisabled,
  };

  const transfer = useNoteFileTransferCapture({
    disabled: filesDisabled,
    onFiles(files, kind) {
      if (kind === "image") live.current.onImageFiles(files);
      else live.current.onFileFiles(files);
    },
  });

  const onReady: MonacoMarkdownEditorExtension = (context) => {
    const extensions: Monaco.IDisposable[] = [];
    try {
      extensions.push(installMonacoMarkdownListEditing(context));
      extensions.push(installMonacoGameLinkCompletion(context, {
        excludeGameId: live.current.excludeGameId,
        getGames: () => live.current.gameSuggestions,
      }));
      const installSubmit = Boolean(live.current.onSubmit);
      const installCancel = Boolean(live.current.onCancel);
      if (installSubmit || installCancel) {
        extensions.push(installMonacoNoteActions(context, {
          cancel: installCancel ? () => live.current.onCancel?.() : undefined,
          isSubmitDisabled: () => Boolean(live.current.submitDisabled),
          submit: installSubmit ? () => live.current.onSubmit?.() : undefined,
        }));
      }
    } catch (error) {
      disposeAll(extensions);
      throw error;
    }
    return { dispose: () => disposeAll(extensions) };
  };

  return (
    <div
      className={`monaco-note-editor note-file-transfer-boundary${transfer.isFileDragOver ? " is-drag-over" : ""}`}
      data-model-key={modelKey}
      {...transfer.captureHandlers}
    >
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        autoFocus={autoFocus}
        modelKey={modelKey}
        onChange={onChange}
        onReady={onReady}
        value={value}
      />
    </div>
  );
}
