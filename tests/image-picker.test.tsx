import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePicker } from "../src/components/ImagePicker";

const assetMocks = vi.hoisted(() => ({
  optimizeCover: vi.fn(),
  optimizeNoteImage: vi.fn(),
}));

vi.mock("../src/domain/assets", () => assetMocks);

const optimized = {
  asset: {
    id: "asset-id",
    kind: "image" as const,
    mime: "image/webp" as const,
    width: 512,
    height: 512,
    byteLength: 12,
    alt: "Обложка игры",
    originalName: "cover.png",
  },
  blob: new Blob([], { type: "image/webp" }),
  byteLength: 12,
};

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function installClipboard(read: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { read } });
}

beforeEach(() => {
  assetMocks.optimizeCover.mockReset().mockResolvedValue(optimized);
  assetMocks.optimizeNoteImage.mockReset().mockResolvedValue(optimized);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalClipboardDescriptor) Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  else delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
});

describe("ImagePicker", () => {
  it("converts and prepares an image immediately after file selection", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const onPrepare = vi.fn().mockResolvedValue(true);
    const view = render(<ImagePicker alt="Обложка игры" mode="cover" onDraftChange={onDraftChange} onPrepare={onPrepare} />);
    const file = new File(["image"], "cover.png", { type: "image/png" });

    await user.upload(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, file);

    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
    expect(assetMocks.optimizeCover).toHaveBeenCalledWith(file, "Обложка игры");
    expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ assetId: optimized.asset.id, mime: "image/webp", width: 512, height: 512, blob: optimized.blob }));
    expect(onDraftChange.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole("button", { name: /Подготовить WebP/ })).not.toBeInTheDocument();
    expect(view.container.querySelector('input[type="range"]')).not.toBeInTheDocument();
  });

  it("uses the same immediate conversion when an image is dropped", async () => {
    const onPrepare = vi.fn().mockResolvedValue(true);
    const view = render(<ImagePicker mode="cover" onPrepare={onPrepare} />);
    const file = new File(["image"], "dropped.jpg", { type: "image/jpeg" });
    const preview = view.container.querySelector<HTMLElement>(".image-picker__preview")!;
    const dataTransfer = { dropEffect: "none", files: [file], types: ["Files"] };

    fireEvent.dragEnter(preview, { dataTransfer });
    expect(preview).toHaveClass("is-drag-over");
    fireEvent.drop(preview, { dataTransfer });

    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
    expect(assetMocks.optimizeCover).toHaveBeenCalledWith(file, "dropped");
    expect(preview).not.toHaveClass("is-drag-over");
  });

  it("reads a cover image from the clipboard through the ordinary optimization pipeline", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const onPrepare = vi.fn().mockResolvedValue(true);
    const clipboardBlob = new Blob(["clipboard image"], { type: "image/png" });
    const getType = vi.fn().mockResolvedValue(clipboardBlob);
    const read = vi.fn().mockResolvedValue([{ types: ["text/plain", "image/png"], getType }]);
    installClipboard(read);
    render(<ImagePicker alt="Обложка игры" mode="cover" onDraftChange={onDraftChange} onPrepare={onPrepare} />);

    await user.click(screen.getByRole("button", { name: "Вставить из буфера обмена" }));

    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
    expect(read).toHaveBeenCalledTimes(1);
    expect(getType).toHaveBeenCalledWith("image/png");
    const file = assetMocks.optimizeCover.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file).toMatchObject({ name: "clipboard-image.png", type: "image/png" });
    expect(assetMocks.optimizeCover).toHaveBeenCalledWith(file, "Обложка игры");
    expect(onDraftChange.mock.calls).toEqual([[true], [false]]);
  });

  it("reports an empty or inaccessible clipboard inline", async () => {
    const user = userEvent.setup();
    const onPrepare = vi.fn();
    const read = vi.fn().mockResolvedValue([{ types: ["text/plain"], getType: vi.fn() }]);
    installClipboard(read);
    const view = render(<ImagePicker mode="cover" onPrepare={onPrepare} />);

    await user.click(screen.getByRole("button", { name: "Вставить из буфера обмена" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("В буфере обмена нет изображения");
    expect(onPrepare).not.toHaveBeenCalled();

    read.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: "Вставить из буфера обмена" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Safari не разрешил доступ к буферу обмена");
    await waitFor(() => expect(view.container.querySelector(".image-picker")).toHaveAttribute("aria-busy", "false"));
  });

  it("does not add the clipboard button to note attachments", () => {
    render(<ImagePicker mode="note" onPrepare={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Вставить из буфера обмена" })).not.toBeInTheDocument();
  });

  it("returns to an idle state after rejected persistence and accepts the same file again", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const onPrepare = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = render(<ImagePicker mode="cover" onDraftChange={onDraftChange} onPrepare={onPrepare} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["image"], "cover.png", { type: "image/png" });

    await user.upload(input, file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить изображение");
    expect(onDraftChange).toHaveBeenLastCalledWith(false);

    await user.upload(input, file);
    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it("lets Safari images with an empty MIME reach the encoder and reports the final-size preflight inline", async () => {
    const onDraftChange = vi.fn();
    const onPrepare = vi.fn();
    const canAddBlob = vi.fn(() => "Изображение не помещается в локальное хранилище Safari");
    const view = render(<ImagePicker canAddBlob={canAddBlob} mode="cover" onDraftChange={onDraftChange} onPrepare={onPrepare} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["image"], "cover.webp", { type: "" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Изображение не помещается в локальное хранилище Safari");
    expect(assetMocks.optimizeCover).toHaveBeenCalledWith(file, "cover");
    expect(canAddBlob).toHaveBeenCalledWith(optimized.byteLength);
    expect(onPrepare).not.toHaveBeenCalled();
    expect(onDraftChange.mock.calls).toEqual([[true], [false]]);
  });
});
