import type { PatchEnvelope } from "../domain/types";

export const PUBLISH_CLIPBOARD_COMMAND = "npm run publish:clipboard";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!("CompressionStream" in window) || typeof Blob.prototype.stream !== "function") return bytes;
  try {
    const buffer = bytes.slice().buffer as ArrayBuffer;
    const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return bytes;
  }
}

export async function createPublishPayload(patch: PatchEnvelope): Promise<string> {
  const source = new TextEncoder().encode(JSON.stringify(patch));
  const payload = await gzip(source);
  return bytesToBase64(payload);
}

export function downloadPatch(patch: PatchEnvelope, fileName = "mylib-patch.json"): void {
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Safari не разрешил доступ к буферу обмена");
}
