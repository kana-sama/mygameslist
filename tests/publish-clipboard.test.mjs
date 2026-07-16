import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_INPUT_BYTES } from "../scripts/publish-patch.mjs";
import { publishClipboard, readClipboardPayload } from "../scripts/publish-clipboard.mjs";

function result(overrides = {}) {
  return {
    error: undefined,
    status: 0,
    stderr: Buffer.alloc(0),
    stdout: Buffer.from("payload"),
    ...overrides,
  };
}

describe("clipboard publication entrypoint", () => {
  it("reads plain text from the macOS clipboard without a shell", () => {
    const commandRunner = vi.fn(() => result());

    expect(readClipboardPayload(commandRunner)).toEqual(Buffer.from("payload"));
    expect(commandRunner).toHaveBeenCalledWith("/usr/bin/pbpaste", ["-Prefer", "txt"], {
      encoding: null,
      maxBuffer: MAX_INPUT_BYTES + 1,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("passes the exact clipboard bytes to the semantic patch publisher", () => {
    const bytes = Buffer.from("H4sIAAAAAAAA");
    const commandRunner = vi.fn(() => result({ stdout: bytes }));
    const publish = vi.fn(() => "published");

    expect(publishClipboard({ commandRunner, publish })).toBe("published");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(bytes);
  });

  it("rejects an empty clipboard before touching the repository", () => {
    const publish = vi.fn();

    expect(() => publishClipboard({
      commandRunner: () => result({ stdout: Buffer.from(" \n\t") }),
      publish,
    })).toThrow("Буфер обмена пуст");
    expect(publish).not.toHaveBeenCalled();
  });

  it("recognizes the status 1 shape returned by an empty macOS pasteboard", () => {
    expect(() => readClipboardPayload(() => result({
      status: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    }))).toThrow("Буфер обмена пуст");
  });

  it("reports when pbpaste is unavailable", () => {
    expect(() => readClipboardPayload(() => result({
      error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      status: null,
    }))).toThrow("публикация из буфера работает только в macOS");
  });

  it("reports clipboard output larger than the CLI limit", () => {
    expect(() => readClipboardPayload(() => result({
      error: Object.assign(new Error("maxBuffer"), { code: "ENOBUFS" }),
      status: null,
    }))).toThrow("превышает допустимые 16 МиБ");
  });

  it("includes pbpaste stderr for a non-zero exit", () => {
    expect(() => readClipboardPayload(() => result({
      status: 1,
      stderr: Buffer.from("clipboard unavailable"),
    }))).toThrow("pbpaste завершился с ошибкой: clipboard unavailable");
  });

  it("reports a generic spawn error without invoking publication", () => {
    const publish = vi.fn();

    expect(() => publishClipboard({
      commandRunner: () => result({ error: new Error("spawn failed"), status: null }),
      publish,
    })).toThrow("Не удалось прочитать буфер обмена: spawn failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("is exposed as a fixed npm script", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.scripts["publish:clipboard"]).toBe("node scripts/publish-clipboard.mjs");
  });
});
