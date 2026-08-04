import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { hasFilePayload, isImageFile, snapshotFiles } from "./fileTransfer";

export type NoteTransferredFileKind = "image" | "file";

export interface UseNoteFileTransferCaptureOptions {
  disabled?: boolean;
  onFiles(files: File[], kind: NoteTransferredFileKind): void;
}

export type NoteFileTransferCaptureHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  | "onPasteCapture"
  | "onDragEnterCapture"
  | "onDragOverCapture"
  | "onDragLeaveCapture"
  | "onDropCapture"
>;

export interface NoteFileTransferCapture {
  isFileDragOver: boolean;
  captureHandlers: NoteFileTransferCaptureHandlers;
}

export function useNoteFileTransferCapture({
  disabled = false,
  onFiles,
}: UseNoteFileTransferCaptureOptions): NoteFileTransferCapture {
  const dragDepth = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const resetDrag = useCallback(() => {
    dragDepth.current = 0;
    setIsFileDragOver(false);
  }, []);

  useEffect(() => {
    if (!isFileDragOver) return;
    window.addEventListener("drop", resetDrag);
    window.addEventListener("dragend", resetDrag);
    return () => {
      window.removeEventListener("drop", resetDrag);
      window.removeEventListener("dragend", resetDrag);
    };
  }, [isFileDragOver, resetDrag]);

  useEffect(() => {
    if (disabled) resetDrag();
  }, [disabled, resetDrag]);

  const emitFiles = (files: File[]) => {
    const images = files.filter(isImageFile);
    const otherFiles = files.filter((file) => !isImageFile(file));
    if (images.length) onFiles(images, "image");
    if (otherFiles.length) onFiles(otherFiles, "file");
  };

  const captureHandlers: NoteFileTransferCaptureHandlers = {
    onPasteCapture: (event) => {
      const files = snapshotFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      if (!disabled) emitFiles(files);
    },
    onDragEnterCapture: (event) => {
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      if (disabled) return;
      dragDepth.current += 1;
      setIsFileDragOver(true);
    },
    onDragOverCapture: (event) => {
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!disabled) setIsFileDragOver(true);
    },
    onDragLeaveCapture: (event) => {
      if (dragDepth.current === 0 && !hasFilePayload(event.dataTransfer)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsFileDragOver(false);
    },
    onDropCapture: (event) => {
      resetDrag();
      if (!hasFilePayload(event.dataTransfer)) return;
      event.preventDefault();
      if (!disabled) emitFiles(snapshotFiles(event.dataTransfer));
    },
  };

  return { isFileDragOver, captureHandlers };
}
