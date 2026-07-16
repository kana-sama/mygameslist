import { describe, expect, it } from "vitest";
import { decodePatchInput } from "../scripts/publish-patch.mjs";
import type { PatchEnvelope } from "../src/domain";
import { PUBLISH_CLIPBOARD_COMMAND, createPublishPayload } from "../src/state/publishCommand";

const patch: PatchEnvelope = {
  patchVersion: 1,
  schemaVersion: 2,
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

describe("browser publication payload", () => {
  it("produces an inert CLI-decodable payload without embedding shell text", async () => {
    const payload = await createPublishPayload(patch);

    expect(payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(payload).not.toContain(JSON.stringify(patch));
    expect(payload).not.toContain("node scripts");
    expect(payload).not.toContain("git push");
    expect(decodePatchInput(payload)).toEqual(patch);
  });

  it("uses one fixed command which never contains the patch", () => {
    expect(PUBLISH_CLIPBOARD_COMMAND).toBe("npm run publish:clipboard");
    expect(PUBLISH_CLIPBOARD_COMMAND).not.toContain("git push");
    expect(PUBLISH_CLIPBOARD_COMMAND).not.toContain(JSON.stringify(patch));
  });
});
