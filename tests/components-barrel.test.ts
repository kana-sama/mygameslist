import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("components barrel", () => {
  it("does not export the Monaco runtime component", () => {
    const barrel = readFileSync(
      resolve(process.cwd(), "src/components/index.ts"),
      "utf8",
    );

    expect(barrel).not.toContain('"./MonacoMarkdownEditor"');
  });
});
