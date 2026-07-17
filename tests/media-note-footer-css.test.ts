import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("media-only note footer", () => {
  it("keeps stable masonry geometry while revealing actions on hover or focus", () => {
    const footer = declarations(".note-card__media-actions");
    const visible = declarations(".note-card--media-only:hover .note-card__media-actions, .note-card--media-only:focus-within .note-card__media-actions");

    expect(footer).toContain("min-height: var(--note-media-footer-height)");
    expect(footer).toContain("opacity: 0");
    expect(footer).toContain("pointer-events: none");
    expect(visible).toContain("opacity: 1");
    expect(visible).toContain("pointer-events: auto");
    expect(styles).toContain(".note-card--media-only.note-card--collapsed .note-card__collapse-toggle { bottom: var(--note-media-footer-height); }");
  });

  it("keeps footer actions visible on coarse pointers", () => {
    expect(styles).toContain(".note-card--media-only { --note-media-footer-height: 49px; }");
    expect(styles).toContain(".note-card__media-actions { opacity: 1; pointer-events: auto; }");
  });
});
