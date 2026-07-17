import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("media-only note footer", () => {
  it("overlays media without changing masonry geometry while revealing actions", () => {
    const footer = declarations(".note-card__media-actions");
    const visible = declarations(".note-card--media-only:hover .note-card__media-actions, .note-card--media-only:focus-within .note-card__media-actions");
    const visibleButtons = declarations(".note-card--media-only:hover .note-card__media-actions button, .note-card--media-only:focus-within .note-card__media-actions button");

    expect(footer).toContain("position: absolute");
    expect(footer).toContain("bottom: 0");
    expect(footer).toContain("left: 0");
    expect(footer).toContain("opacity: 0");
    expect(footer).toContain("pointer-events: none");
    expect(visible).toContain("opacity: 1");
    expect(visible).not.toContain("pointer-events: auto");
    expect(visibleButtons).toContain("pointer-events: auto");
    expect(styles).not.toContain("--note-media-footer-height");
    expect(styles).not.toContain(".note-card--media-only.note-card--collapsed");
  });

  it("keeps the overlay above native controls for playable media", () => {
    expect(declarations(".note-card--playable-media .note-card__media-actions")).toContain("bottom: 42px");
  });

  it("keeps footer actions visible on coarse pointers", () => {
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-card__media-actions \{[^}]*min-height:\s*49px;[^}]*opacity:\s*1;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-card__media-actions button \{[^}]*pointer-events:\s*auto;/);
  });
});
