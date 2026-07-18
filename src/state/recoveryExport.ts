import { publishedAssetUrl, type LibraryDatabase, type LocalAsset, type PatchEnvelope } from "../domain";

interface ZipEntry {
  name: string;
  blob: Blob;
  crc32: number;
  offset: number;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, value >>> 8 & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff]);
}

function binaryParts(...values: Uint8Array[]): ArrayBuffer[] {
  return values.map((value) => value.slice().buffer as ArrayBuffer);
}

async function crc32(blob: Blob): Promise<number> {
  let value = 0xffffffff;
  const update = (bytes: Uint8Array) => {
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ value >>> 8;
  };
  if (typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      update(chunk.value);
    }
  } else update(new Uint8Array(await blob.arrayBuffer()));
  return (value ^ 0xffffffff) >>> 0;
}

function localHeader(entry: ZipEntry): Blob {
  const name = new TextEncoder().encode(entry.name);
  return new Blob(binaryParts(
    u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
    u32(entry.crc32), u32(entry.blob.size), u32(entry.blob.size), u16(name.length), u16(0), name,
  ));
}

function centralHeader(entry: ZipEntry): Blob {
  const name = new TextEncoder().encode(entry.name);
  return new Blob(binaryParts(
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
    u32(entry.crc32), u32(entry.blob.size), u32(entry.blob.size), u16(name.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(entry.offset), name,
  ));
}

export async function createRecoveryArchive(database: LibraryDatabase, patch: PatchEnvelope, localAssets: LocalAsset[]): Promise<Blob> {
  const unpublished = localAssets.map((local) => {
    const asset = database.assets[local.id];
    return {
      id: local.id,
      byteLength: local.byteLength,
      mimeType: local.mimeType,
      createdAt: new Date(local.createdAt).toISOString(),
      state: local.state,
      originalName: asset?.originalName ?? local.id,
      expectedPublishedUrl: asset ? publishedAssetUrl(asset, "./") : null,
    };
  });
  const sources: Array<{ name: string; blob: Blob }> = [
    { name: "library.json", blob: new Blob([JSON.stringify(database, null, 2)], { type: "application/json" }) },
    { name: "patch.json", blob: new Blob([JSON.stringify({ ...patch, blobs: {} }, null, 2)], { type: "application/json" }) },
    { name: "local-assets.json", blob: new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), unpublished }, null, 2)], { type: "application/json" }) },
    ...localAssets.map((local) => ({ name: `media/${local.id}.${local.mimeType === "image/webp" ? "webp" : local.mimeType === "video/mp4" ? "mp4" : "bin"}`, blob: local.blob })),
  ];
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (const source of sources) {
    const entry: ZipEntry = { ...source, crc32: await crc32(source.blob), offset };
    entries.push(entry);
    offset += localHeader(entry).size + entry.blob.size;
  }
  const central = entries.map(centralHeader);
  const centralSize = central.reduce((total, part) => total + part.size, 0);
  const end = new Blob(binaryParts(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralSize), u32(offset), u16(0)));
  return new Blob([...entries.flatMap((entry) => [localHeader(entry), entry.blob]), ...central, end], { type: "application/zip" });
}

export function downloadRecoveryArchive(blob: Blob, fileName = `mylib-recovery-${new Date().toISOString().slice(0, 10)}.zip`): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
