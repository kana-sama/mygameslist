import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePicker } from "../src/components/ImagePicker";

class ImageMock {
  naturalWidth = 640;
  naturalHeight = 480;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  vi.stubGlobal("Image", ImageMock);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["webp"], { type: "image/webp" }));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImagePicker", () => {
  it("keeps the selected crop when async persistence rejects it", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const rejected = vi.fn().mockResolvedValue(false);
    const view = render(<ImagePicker mode="cover" onDraftChange={onDraftChange} onPrepare={rejected} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;

    await user.upload(input, new File(["image"], "cover.png", { type: "image/png" }));
    expect(await screen.findByRole("button", { name: /Подготовить WebP/ })).toBeInTheDocument();
    expect(onDraftChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: /Подготовить WebP/ }));
    await waitFor(() => expect(rejected).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /Подготовить WebP/ })).toBeInTheDocument();
    expect(onDraftChange).not.toHaveBeenCalledWith(false);

    const accepted = vi.fn().mockResolvedValue(true);
    view.rerender(<ImagePicker mode="cover" onDraftChange={onDraftChange} onPrepare={accepted} />);
    await user.click(screen.getByRole("button", { name: /Подготовить WebP/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Подготовить WebP/ })).not.toBeInTheDocument());
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });
});
