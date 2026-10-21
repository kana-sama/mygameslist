import { WIDTH, HEIGHT, frame, cropRect, locate } from "./model.js";

export async function extract(file) {
  if (file.size > 40 * 1024 * 1024) throw new Error("Файл больше 40 МБ");
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("Не удалось прочитать изображение"); }
  try {
    if (bitmap.width < 384 || bitmap.height < 216) throw new Error("Скрин слишком маленький: нужен полный кадр от 384×216");
    const canvas = document.createElement("canvas");
    canvas.width = 384; canvas.height = 216;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    const f = frame(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, f.x, f.y, f.w, f.h, 0, 0, 384, 216);
    const key = locate(ctx.getImageData(0, 0, 384, 216).data);
    const rect = cropRect(bitmap.width, bitmap.height);
    canvas.width = WIDTH; canvas.height = HEIGHT;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, WIDTH, HEIGHT);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Не удалось вырезать экран");
    return { key, blob };
  } finally { bitmap.close(); }
}
