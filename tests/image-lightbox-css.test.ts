import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("image lightbox source-pixel rendering", () => {
  it("lays out images at intrinsic size without a persistent low-resolution compositor layer", () => {
    const declarations = /\.image-lightbox__stage img\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";

    expect(declarations).toContain("position: absolute");
    expect(declarations).toContain("max-width: none");
    expect(declarations).toContain("max-height: none");
    expect(declarations).not.toContain("will-change");
    expect(declarations).not.toContain("object-fit");
  });
});
