import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("extreme portrait note images", () => {
  it("clips the image without adding layout height for the expansion control", () => {
    const collapsed = /\.note-attachment-shell--tall-image\.is-collapsed \.note-attachment--image\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    const toggle = /\.note-attachment-tall-toggle\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";

    expect(collapsed).toContain("max-height: 420px");
    expect(toggle).toContain("position: absolute");
    expect(toggle).toContain("bottom: 0");
    expect(toggle).toContain("height: 44px");
  });
});
