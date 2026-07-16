#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { MAX_INPUT_BYTES, publishPatchInput } from "./publish-patch.mjs";

const PBPaste = "/usr/bin/pbpaste";

export function readClipboardPayload(commandRunner = spawnSync) {
  const result = commandRunner(PBPaste, ["-Prefer", "txt"], {
    encoding: null,
    maxBuffer: MAX_INPUT_BYTES + 1,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error?.code === "ENOENT") throw new Error("pbpaste недоступен: публикация из буфера работает только в macOS");
  if (result.error?.code === "ENOBUFS") throw new Error("Патч в буфере превышает допустимые 16 МиБ");
  if (result.error) throw new Error(`Не удалось прочитать буфер обмена: ${result.error.message}`);

  const payload = Buffer.from(result.stdout ?? "");
  const detail = Buffer.from(result.stderr ?? "").toString("utf8").trim();
  if (!payload.toString("utf8").trim() && !detail && (result.status === 0 || result.status === 1)) {
    throw new Error("Буфер обмена пуст. Сначала скопируйте патч на сайте");
  }
  if (result.status !== 0) {
    const reason = detail || (result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`);
    throw new Error(`pbpaste завершился с ошибкой: ${reason}`);
  }

  return payload;
}

export function publishClipboard({ commandRunner = spawnSync, publish = publishPatchInput } = {}) {
  return publish(readClipboardPayload(commandRunner));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { publishClipboard(); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
