import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("platinum cover treatment", () => {
  it("uses a visible non-interactive 100% corner ribbon without changing cover geometry", () => {
    const overlay = declarations(".cover--platinum::after");

    expect(overlay).toContain('content: "100%"');
    expect(overlay).toContain("position: absolute");
    expect(overlay).toContain("top: var(--platinum-ribbon-top)");
    expect(overlay).toContain("right: var(--platinum-ribbon-right)");
    expect(overlay).toContain("transform: rotate(45deg)");
    expect(overlay).toContain("linear-gradient");
    expect(overlay).toContain("pointer-events: none");
    expect(overlay).not.toContain("inset: 0");
  });

  it("does not keep the old completed-cover modifier", () => {
    expect(styles).not.toContain("game-card--completed");
  });
});
