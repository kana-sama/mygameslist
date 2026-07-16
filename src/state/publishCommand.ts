import type { PatchEnvelope } from "../domain/types";

const COMMAND_DELIMITER = "MYLIB_PATCH";
const LARGE_INLINE_PATCH = 512 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\n") ?? value;
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

export interface PublishCommand {
  command: string;
  payloadBytes: number;
  isLarge: boolean;
}

export async function createPublishCommand(patch: PatchEnvelope): Promise<PublishCommand> {
  const source = new TextEncoder().encode(JSON.stringify(patch));
  const payload = await gzip(source);
  const encoded = wrapBase64(bytesToBase64(payload));
  const command = [
    "(",
    "  set -eu",
    '  cd -- "$(git rev-parse --show-toplevel)"',
    `  node ./scripts/publish-patch.mjs <<'${COMMAND_DELIMITER}'`,
    encoded,
    COMMAND_DELIMITER,
    ")",
  ].join("\n");
  return {
    command,
    payloadBytes: payload.byteLength,
    isLarge: payload.byteLength > LARGE_INLINE_PATCH,
  };
}

export function createDownloadedPatchCommand(fileName = "mylib-patch.json"): string {
  if (fileName === "mylib-patch.json") {
    return [
      "(",
      "  set -eu",
      '  cd -- "$(git rev-parse --show-toplevel)"',
      '  node ./scripts/publish-patch.mjs --file "${HOME}/Downloads/mylib-patch.json"',
      ")",
    ].join("\n");
  }
  const escapedName = fileName.replace(/["\\`$]/g, "\\$&");
  return [
    "(",
    "  set -eu",
    '  cd -- "$(git rev-parse --show-toplevel)"',
    `  node ./scripts/publish-patch.mjs --file \"${escapedName}\"`,
    ")",
  ].join("\n");
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
