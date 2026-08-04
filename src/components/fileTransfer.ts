const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || !file.type && IMAGE_FILE_EXTENSION.test(file.name);
}

export function snapshotFiles(transfer: DataTransfer): File[] {
  const itemFiles = Array.from(transfer.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  return itemFiles.length ? itemFiles : Array.from(transfer.files ?? []);
}

export function hasFilePayload(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes("Files")
    || Array.from(transfer.items ?? []).some((item) => item.kind === "file")
    || transfer.files.length > 0;
}
