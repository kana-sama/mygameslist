import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasFilePayload,
  isImageFile,
  snapshotFiles,
} from "../src/components/fileTransfer";
import {
  useNoteFileTransferCapture,
  type NoteTransferredFileKind,
} from "../src/components/useNoteFileTransferCapture";

interface ReceivedBatch {
  files: File[];
  kind: NoteTransferredFileKind;
}

function fileItem(file: File | null): DataTransferItem {
  return {
    kind: "file",
    type: file?.type ?? "",
    getAsFile: () => file,
  } as DataTransferItem;
}

function textItem(): DataTransferItem {
  return {
    kind: "string",
    type: "text/plain",
    getAsFile: () => null,
  } as DataTransferItem;
}

function transfer({
  files = [],
  items,
  types,
}: {
  files?: File[];
  items?: DataTransferItem[];
  types?: string[];
} = {}): DataTransfer {
  return {
    dropEffect: "none",
    files,
    items: items ?? files.map((file) => fileItem(file)),
    types: types ?? (files.length ? ["Files"] : ["text/plain"]),
  } as unknown as DataTransfer;
}

function transferEvent(
  type: "paste" | "dragenter" | "dragover" | "dragleave" | "drop",
  dataTransfer: DataTransfer,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(
    event,
    type === "paste" ? "clipboardData" : "dataTransfer",
    { value: dataTransfer },
  );
  return event;
}

function CaptureHarness({
  disabled = false,
  onFiles,
  onParentDrop,
}: {
  disabled?: boolean;
  onFiles: (files: File[], kind: NoteTransferredFileKind) => void;
  onParentDrop?: (defaultPrevented: boolean) => void;
}) {
  const transferCapture = useNoteFileTransferCapture({ disabled, onFiles });

  return (
    <div onDrop={(event) => onParentDrop?.(event.defaultPrevented)}>
      <div
        {...transferCapture.captureHandlers}
        className={transferCapture.isFileDragOver ? "is-drag-over" : ""}
        data-testid="boundary"
      >
        <div data-testid="first-child" />
        <div data-testid="second-child" />
      </div>
    </div>
  );
}

afterEach(cleanup);

describe("file transfer helpers", () => {
  it("takes item files in preference to the files fallback", () => {
    const itemFile = new File(["item"], "item.png", { type: "image/png" });
    const fallbackFile = new File(["fallback"], "fallback.png", { type: "image/png" });

    expect(snapshotFiles(transfer({
      files: [fallbackFile],
      items: [textItem(), fileItem(itemFile)],
    }))).toEqual([itemFile]);
  });

  it("falls back to files when item file snapshots are empty", () => {
    const fallbackFile = new File(["fallback"], "fallback.png", { type: "image/png" });

    expect(snapshotFiles(transfer({
      files: [fallbackFile],
      items: [fileItem(null)],
    }))).toEqual([fallbackFile]);
  });

  it("recognizes empty-MIME Safari images by extension", () => {
    expect(isImageFile(new File(["png"], "capture.PNG", { type: "" }))).toBe(true);
    expect(isImageFile(new File(["pdf"], "manual.pdf", { type: "" }))).toBe(false);
  });

  it("recognizes a declared file payload before files are readable", () => {
    expect(hasFilePayload(transfer({ files: [], items: [], types: ["Files"] }))).toBe(true);
    expect(hasFilePayload(transfer())).toBe(false);
  });
});

describe("useNoteFileTransferCapture", () => {
  it("leaves ordinary text paste native", () => {
    const onFiles = vi.fn();
    render(<CaptureHarness onFiles={onFiles} />);
    const event = transferEvent("paste", transfer());

    fireEvent(screen.getByTestId("first-child"), event);

    expect(event.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("emits one image batch before one generic-file batch", () => {
    const received: ReceivedBatch[] = [];
    const image = new File(["image"], "capture.webp", { type: "image/webp" });
    const file = new File(["file"], "guide.pdf", { type: "application/pdf" });
    render(<CaptureHarness onFiles={(files, kind) => received.push({ files, kind })} />);
    const event = transferEvent("paste", transfer({ files: [file, image] }));

    fireEvent(screen.getByTestId("first-child"), event);

    expect(event.defaultPrevented).toBe(true);
    expect(received).toEqual([
      { files: [image], kind: "image" },
      { files: [file], kind: "file" },
    ]);
  });

  it("prevents a captured file drop without hiding it from parent handlers", () => {
    const onFiles = vi.fn();
    const onParentDrop = vi.fn();
    const file = new File(["file"], "guide.pdf", { type: "application/pdf" });
    render(<CaptureHarness onFiles={onFiles} onParentDrop={onParentDrop} />);
    const event = transferEvent("drop", transfer({ files: [file] }));

    fireEvent(screen.getByTestId("first-child"), event);

    expect(event.defaultPrevented).toBe(true);
    expect(onParentDrop).toHaveBeenCalledWith(true);
    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles).toHaveBeenCalledWith([file], "file");
  });

  it("requests copy and keeps the highlight across nested drag transitions", () => {
    render(<CaptureHarness onFiles={vi.fn()} />);
    const boundary = screen.getByTestId("boundary");
    const firstChild = screen.getByTestId("first-child");
    const secondChild = screen.getByTestId("second-child");
    const dataTransfer = transfer({ files: [], items: [], types: ["Files"] });

    fireEvent(firstChild, transferEvent("dragenter", dataTransfer));
    fireEvent(secondChild, transferEvent("dragenter", dataTransfer));
    const dragOver = transferEvent("dragover", dataTransfer);
    fireEvent(secondChild, dragOver);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(boundary).toHaveClass("is-drag-over");

    fireEvent(secondChild, transferEvent("dragleave", dataTransfer));
    expect(boundary).toHaveClass("is-drag-over");

    fireEvent(firstChild, transferEvent("dragleave", dataTransfer));
    expect(boundary).not.toHaveClass("is-drag-over");
  });

  it("resets an active drag on window drop and dragend", () => {
    render(<CaptureHarness onFiles={vi.fn()} />);
    const boundary = screen.getByTestId("boundary");
    const child = screen.getByTestId("first-child");
    const dataTransfer = transfer({ files: [], items: [], types: ["Files"] });

    fireEvent(child, transferEvent("dragenter", dataTransfer));
    expect(boundary).toHaveClass("is-drag-over");
    fireEvent(window, new Event("drop"));
    expect(boundary).not.toHaveClass("is-drag-over");

    fireEvent(child, transferEvent("dragenter", dataTransfer));
    expect(boundary).toHaveClass("is-drag-over");
    fireEvent(window, new Event("dragend"));
    expect(boundary).not.toHaveClass("is-drag-over");
  });

  it("consumes disabled file gestures without callbacks or highlight", () => {
    const onFiles = vi.fn();
    const image = new File(["image"], "capture.png", { type: "image/png" });
    render(<CaptureHarness disabled onFiles={onFiles} />);
    const boundary = screen.getByTestId("boundary");
    const child = screen.getByTestId("first-child");
    const dataTransfer = transfer({ files: [image] });
    const paste = transferEvent("paste", dataTransfer);
    const dragEnter = transferEvent("dragenter", dataTransfer);
    const dragOver = transferEvent("dragover", dataTransfer);
    const drop = transferEvent("drop", dataTransfer);

    fireEvent(child, paste);
    fireEvent(child, dragEnter);
    fireEvent(child, dragOver);
    fireEvent(child, drop);

    expect(paste.defaultPrevented).toBe(true);
    expect(dragEnter.defaultPrevented).toBe(true);
    expect(dragOver.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(boundary).not.toHaveClass("is-drag-over");
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("clears active drag state and depth when disabled becomes true", () => {
    const onFiles = vi.fn();
    const dataTransfer = transfer({ files: [], items: [], types: ["Files"] });
    const view = render(<CaptureHarness onFiles={onFiles} />);
    const boundary = screen.getByTestId("boundary");
    const child = screen.getByTestId("first-child");

    fireEvent(child, transferEvent("dragenter", dataTransfer));
    expect(boundary).toHaveClass("is-drag-over");

    view.rerender(<CaptureHarness disabled onFiles={onFiles} />);
    expect(boundary).not.toHaveClass("is-drag-over");

    view.rerender(<CaptureHarness onFiles={onFiles} />);
    fireEvent(child, transferEvent("dragenter", dataTransfer));
    fireEvent(child, transferEvent("dragleave", dataTransfer));
    expect(boundary).not.toHaveClass("is-drag-over");
  });
});
