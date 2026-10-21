import { WIDTH, HEIGHT, frame, cropRect, locate } from "./model.js";

export async function extract(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error("Файл больше 40 МБ");
  let bytes;
  try { bytes = await file.arrayBuffer(); }
  catch (cause) { throw new Error("Не удалось прочитать файл", { cause }); }
  // Safari can fail to load disk-backed File URLs; decode detached bytes instead.
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Не удалось прочитать изображение"));
      image.src = url;
    });
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width < 384 || height < 216) throw new Error("Скрин слишком маленький: нужен полный кадр от 384×216");
    const canvas = document.createElement("canvas");
    canvas.width = 384; canvas.height = 216;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    const f = frame(width, height);
    ctx.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, 384, 216);
    const key = locate(ctx.getImageData(0, 0, 384, 216).data);
    const rect = cropRect(width, height);
    canvas.width = WIDTH; canvas.height = HEIGHT;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, WIDTH, HEIGHT);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Не удалось вырезать экран");
    return { key, blob };
  } finally { URL.revokeObjectURL(url); }
}
