import { describe, expect, it } from "vitest";
import { decodePatchInput } from "../scripts/publish-patch.mjs";
import type { PatchEnvelope } from "../src/domain";
import { createDownloadedPatchCommand, createPublishCommand } from "../src/state/publishCommand";

const patch: PatchEnvelope = {
  patchVersion: 1,
  schemaVersion: 1,
  baseRevision: "1".repeat(64),
  operations: {
    "/games/11111111-1111-4111-8111-111111111111/title": {
      operation: "set",
      value: "DuckTales",
      baseExists: true,
      baseHash: "2".repeat(64),
      changedAt: "2026-07-16T10:00:00.000Z",
      transactionId: "edit-title",
    },
  },
};

describe("browser publication command", () => {
  it("uses a quoted heredoc and produces a CLI-decodable payload", async () => {
    const result = await createPublishCommand(patch);
    expect(result.command).toContain("<<'MYLIB_PATCH'");
    expect(result.command).not.toContain(JSON.stringify(patch));
    const lines = result.command.split("\n");
    const start = lines.findIndex((line) => line.includes("<<'MYLIB_PATCH'"));
    const end = lines.indexOf("MYLIB_PATCH", start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(decodePatchInput(lines.slice(start + 1, end).join("\n"))).toEqual(patch);
  });

  it("offers a short command for the downloaded Safari patch file", () => {
    const command = createDownloadedPatchCommand();
    expect(command).toContain('--file "${HOME}/Downloads/mylib-patch.json"');
    expect(command).not.toContain("git push");
  });
});
