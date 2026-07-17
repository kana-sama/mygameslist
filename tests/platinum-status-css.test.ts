import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("platinum cover treatment", () => {
  it("uses a non-interactive inset overlay without changing cover geometry", () => {
    const overlay = declarations(".cover--platinum::after");

    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("inset: 0");
    expect(overlay).toContain("box-shadow: inset");
    expect(overlay).toContain("pointer-events: none");
  });

  it("does not keep the old completed-cover modifier", () => {
    expect(styles).not.toContain("game-card--completed");
  });
});
