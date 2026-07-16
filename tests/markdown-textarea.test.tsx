import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlainMarkdownTextarea } from "../src/components/Markdown";

function fileItem(file: File | null): DataTransferItem {
  return {
    kind: "file",
    type: file?.type ?? "",
    getAsFile: () => file,
  } as DataTransferItem;
}

function transfer({ files = [], items, types }: { files?: File[]; items?: DataTransferItem[]; types?: string[] } = {}): DataTransfer {
  return {
    dropEffect: "none",
    files,
    items: items ?? files.map((file) => fileItem(file)),
    types: types ?? (files.length ? ["Files"] : ["text/plain"]),
  } as unknown as DataTransfer;
}

function transferEvent(type: "paste" | "dragenter" | "dragover" | "dragleave" | "drop", dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: dataTransfer });
  return event;
}

afterEach(cleanup);

describe("PlainMarkdownTextarea", () => {
  it("renders only the textarea and forwards value changes and native attributes", () => {
    const onChange = vi.fn();
    const view = render(<PlainMarkdownTextarea aria-label="Текст заметки" className="note-input" onChange={onChange} placeholder="Заметка" rows={4} value="Начало" />);

    expect(view.container.children).toHaveLength(1);
    const textarea = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveClass("note-input");
    expect(textarea).toHaveAttribute("rows", "4");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "Новый текст" } });
    expect(onChange).toHaveBeenCalledWith("Новый текст");
  });

  it("leaves an ordinary text paste to the browser", () => {
    const onImageFiles = vi.fn();
    render(<PlainMarkdownTextarea aria-label="Текст заметки" onChange={vi.fn()} onImageFiles={onImageFiles} value="" />);
    const event = transferEvent("paste", transfer());

    fireEvent(screen.getByRole("textbox"), event);

    expect(event.defaultPrevented).toBe(false);
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it("takes image files from items without duplicating the files fallback", () => {
    const image = new File(["png"], "shot.png", { type: "image/png" });
    const onImageFiles = vi.fn();
    render(<PlainMarkdownTextarea aria-label="Текст заметки" onChange={vi.fn()} onImageFiles={onImageFiles} value="" />);
    const event = transferEvent("paste", transfer({ files: [image], items: [fileItem(image)] }));

    fireEvent(screen.getByRole("textbox"), event);

    expect(event.defaultPrevented).toBe(true);
    expect(onImageFiles).toHaveBeenCalledTimes(1);
    expect(onImageFiles).toHaveBeenCalledWith([image]);
  });

  it("falls back to files and accepts an image extension when Safari omits MIME", () => {
    const image = new File(["png"], "screenshot.PNG", { type: "" });
    const onImageFiles = vi.fn();
    render(<PlainMarkdownTextarea aria-label="Текст заметки" onChange={vi.fn()} onImageFiles={onImageFiles} value="" />);
    const event = transferEvent("paste", transfer({ files: [image], items: [fileItem(null)] }));

    fireEvent(screen.getByRole("textbox"), event);

    expect(event.defaultPrevented).toBe(true);
    expect(onImageFiles).toHaveBeenCalledWith([image]);
  });

  it("marks a file drag, requests copy, and clears the state on leave", () => {
    render(<PlainMarkdownTextarea aria-label="Текст заметки" className="note-input" onChange={vi.fn()} value="" />);
    const textarea = screen.getByRole("textbox");
    const dataTransfer = transfer({ files: [], types: ["Files"] });
    const dragOver = transferEvent("dragover", dataTransfer);

    fireEvent(textarea, dragOver);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(textarea).toHaveClass("note-input", "is-drag-over");

    fireEvent(textarea, transferEvent("dragleave", dataTransfer));
    expect(textarea).not.toHaveClass("is-drag-over");
  });

  it("prevents navigation and reports a dropped non-image file", () => {
    const documentFile = new File(["pdf"], "manual.pdf", { type: "application/pdf" });
    const onImageFiles = vi.fn();
    const onImageError = vi.fn();
    render(<PlainMarkdownTextarea aria-label="Текст заметки" onChange={vi.fn()} onImageError={onImageError} onImageFiles={onImageFiles} value="" />);
    const event = transferEvent("drop", transfer({ files: [documentFile] }));

    fireEvent(screen.getByRole("textbox"), event);

    expect(event.defaultPrevented).toBe(true);
    expect(onImageFiles).not.toHaveBeenCalled();
    expect(onImageError).toHaveBeenCalledWith(expect.objectContaining({ message: "Можно добавить только изображения." }));
  });

  it("still consumes file gestures when images are disabled without emitting files", () => {
    const image = new File(["png"], "shot.png", { type: "image/png" });
    const onImageFiles = vi.fn();
    render(<PlainMarkdownTextarea aria-label="Текст заметки" imagesDisabled onChange={vi.fn()} onImageFiles={onImageFiles} value="" />);
    const textarea = screen.getByRole("textbox");
    const paste = transferEvent("paste", transfer({ files: [image] }));
    const dragOver = transferEvent("dragover", transfer({ files: [], types: ["Files"] }));

    fireEvent(textarea, paste);
    fireEvent(textarea, dragOver);

    expect(paste.defaultPrevented).toBe(true);
    expect(dragOver.defaultPrevented).toBe(true);
    expect(textarea).not.toHaveClass("is-drag-over");
    expect(onImageFiles).not.toHaveBeenCalled();
  });
});
