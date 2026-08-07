function clipboardImageName(mime: string): string {
  const extension = mime.toLowerCase() === "image/jpeg"
    ? "jpg"
    : /^image\/(?:png|webp|gif)$/.test(mime.toLowerCase())
      ? mime.slice("image/".length).toLowerCase()
      : "png";
  return `clipboard-image.${extension}`;
}

export function clipboardImageFile(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return Array.from(data.files).find((file) => file.type.startsWith("image/")) ?? null;
}

export async function readClipboardImage(): Promise<File> {
  if (typeof navigator.clipboard?.read !== "function") {
    throw new Error("Этот браузер не умеет читать изображения из буфера обмена.");
  }
  let items: ClipboardItems;
  try { items = await navigator.clipboard.read(); }
  catch (reason) {
    if (reason instanceof DOMException && (reason.name === "NotAllowedError" || reason.name === "SecurityError")) {
      throw new Error("Safari не разрешил доступ к буферу обмена. Разрешите доступ и попробуйте ещё раз.");
    }
    throw new Error(reason instanceof Error ? `Не удалось прочитать буфер обмена: ${reason.message}` : "Не удалось прочитать буфер обмена.");
  }
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.toLowerCase().startsWith("image/"));
    if (!type) continue;
    let blob: Blob;
    try { blob = await item.getType(type); }
    catch (reason) {
      throw new Error(reason instanceof Error ? `Не удалось прочитать изображение из буфера обмена: ${reason.message}` : "Не удалось прочитать изображение из буфера обмена.");
    }
    const mime = blob.type || type;
    return new File([blob], clipboardImageName(mime), { type: mime, lastModified: Date.now() });
  }
  throw new Error("В буфере обмена нет изображения.");
}
