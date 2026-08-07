import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  nonTransparentPixelBounds,
  optimizeProgressIcon,
  progressIconPlacement,
} from "../src/domain/progressIcon";

const assetMocks = vi.hoisted(() => ({
  canvasToLosslessWebPBytes: vi.fn(),
  loadImageElement: vi.fn(),
}));

vi.mock("../src/domain/assets", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/domain/assets")>(),
  ...assetMocks,
}));

function pixels(width: number, height: number, opaque: Array<[number, number]>): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return { data, width, height } as ImageData;
}

describe("progress icons", () => {
  it("finds the inclusive non-transparent bounds", () => {
    expect(nonTransparentPixelBounds(pixels(8, 7, [[2, 1], [5, 4]])))
      .toEqual({ x: 2, y: 1, width: 4, height: 4 });
  });

  it("returns null for a fully transparent image", () => {
    expect(nonTransparentPixelBounds(pixels(3, 3, []))).toBeNull();
  });

  it("pads small content without upscaling", () => {
    expect(progressIconPlacement({ x: 3, y: 4, width: 31, height: 20 })).toEqual({
      source: { x: 3, y: 4, width: 31, height: 20 },
      destination: { x: 16, y: 22, width: 31, height: 20 },
    });
  });

  it("downscales large content to fit the icon", () => {
    expect(progressIconPlacement({ x: 0, y: 0, width: 128, height: 64 })).toEqual({
      source: { x: 0, y: 0, width: 128, height: 64 },
      destination: { x: 0, y: 16, width: 64, height: 32 },
    });
  });

  it("uses floor for deterministic odd transparent padding", () => {
    expect(progressIconPlacement({ x: 1, y: 2, width: 63, height: 61 })).toEqual({
      source: { x: 1, y: 2, width: 63, height: 61 },
      destination: { x: 0, y: 1, width: 63, height: 61 },
    });
  });
});

function webpBytes(): Uint8Array {
  return new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
}

function canvasSeam(imageData: ImageData) {
  const sourceCanvas = document.createElement("canvas");
  const destinationCanvas = document.createElement("canvas");
  const sourceContext = { drawImage: vi.fn(), getImageData: vi.fn(() => imageData) };
  const destinationContext = { drawImage: vi.fn() };
  vi.spyOn(sourceCanvas, "getContext").mockReturnValue(sourceContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(destinationCanvas, "getContext").mockReturnValue(destinationContext as unknown as CanvasRenderingContext2D);
  const createElement = document.createElement.bind(document);
  let canvasIndex = 0;
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    if (tagName !== "canvas") return createElement(tagName, options);
    canvasIndex += 1;
    return canvasIndex === 1 ? sourceCanvas : destinationCanvas;
  });
  return { sourceCanvas, destinationCanvas, destinationContext, sourceContext };
}

describe("progress icon preparation", () => {
  beforeEach(() => {
    assetMocks.canvasToLosslessWebPBytes.mockReset();
    assetMocks.loadImageElement.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates a static 64 by 64 lossless WebP asset", async () => {
    const image = { naturalWidth: 31, naturalHeight: 20 } as HTMLImageElement;
    assetMocks.loadImageElement.mockResolvedValue(image);
    assetMocks.canvasToLosslessWebPBytes.mockResolvedValue(webpBytes());
    const seam = canvasSeam(pixels(31, 20, [[0, 0]]));
    const file = new File(["source"], "progress.png", { type: "image/png" });

    const optimized = await optimizeProgressIcon(file, "Progress");

    expect(optimized.asset).toEqual(expect.objectContaining({
      kind: "image", mime: "image/webp", width: 64, height: 64, alt: "Progress", originalName: "progress.png",
    }));
    expect(optimized.blob.type).toBe("image/webp");
    expect(optimized.byteLength).toBe(webpBytes().byteLength);
    expect(seam.destinationCanvas).toHaveProperty("width", 64);
    expect(seam.destinationCanvas).toHaveProperty("height", 64);
    expect(assetMocks.canvasToLosslessWebPBytes).toHaveBeenCalledWith(seam.destinationCanvas);
  });

  it("draws only trimmed large content into its fitted destination", async () => {
    const image = { naturalWidth: 160, naturalHeight: 100 } as HTMLImageElement;
    assetMocks.loadImageElement.mockResolvedValue(image);
    assetMocks.canvasToLosslessWebPBytes.mockResolvedValue(webpBytes());
    const seam = canvasSeam(pixels(160, 100, [[20, 30], [149, 69]]));
    const file = new File(["source"], "progress.png", { type: "image/png" });

    await optimizeProgressIcon(file);

    expect(seam.sourceContext.drawImage).toHaveBeenCalledWith(image, 0, 0, 160, 100);
    expect(seam.destinationContext.drawImage).toHaveBeenCalledWith(seam.sourceCanvas, 20, 30, 130, 40, 0, 22, 64, 20);
  });

  it("re-encodes existing WebP input through the lossless destination canvas", async () => {
    const sourceBytes = webpBytes();
    const encodedBytes = new Uint8Array([...webpBytes(), 1]);
    assetMocks.loadImageElement.mockResolvedValue({ naturalWidth: 2, naturalHeight: 2 } as HTMLImageElement);
    assetMocks.canvasToLosslessWebPBytes.mockResolvedValue(encodedBytes);
    const seam = canvasSeam(pixels(2, 2, [[0, 0], [1, 1]]));
    const file = new File([sourceBytes], "existing.webp", { type: "image/webp" });

    const optimized = await optimizeProgressIcon(file);

    expect(assetMocks.canvasToLosslessWebPBytes).toHaveBeenCalledWith(seam.destinationCanvas);
    expect(new Uint8Array(await optimized.blob.arrayBuffer())).toEqual(encodedBytes);
    expect(optimized.byteLength).toBe(encodedBytes.byteLength);
  });

  it("rejects a fully transparent source image", async () => {
    assetMocks.loadImageElement.mockResolvedValue({ naturalWidth: 3, naturalHeight: 3 } as HTMLImageElement);
    const seam = canvasSeam(pixels(3, 3, []));
    const file = new File(["source"], "empty.png", { type: "image/png" });

    await expect(optimizeProgressIcon(file)).rejects.toThrow("Изображение полностью прозрачное.");
    expect(seam.destinationContext.drawImage).not.toHaveBeenCalled();
    expect(assetMocks.canvasToLosslessWebPBytes).not.toHaveBeenCalled();
  });
});
