import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles)?.[1] ?? "";
}

describe("media-only note footer", () => {
  it("places actions below the card without changing masonry geometry", () => {
    const footer = declarations(".note-card__media-actions");
    const card = declarations(".note-card--media-only");
    const media = declarations(".note-card--media-only > .note-attachments");
    const elevated = declarations(".note-card--media-only:hover, .note-card--media-only:focus-within");
    const visible = declarations(".note-card--media-only:hover .note-card__media-actions, .note-card--media-only:focus-within .note-card__media-actions");
    const visibleButtons = declarations(".note-card--media-only:hover .note-card__media-actions button, .note-card--media-only:focus-within .note-card__media-actions button");

    expect(footer).toContain("position: absolute");
    expect(footer).toContain("top: 100%");
    expect(footer).toContain("bottom: auto");
    expect(footer).toContain("left: 0");
    expect(footer).toContain("opacity: 0");
    expect(footer).toContain("pointer-events: none");
    expect(card).toContain("overflow: visible");
    expect(media).toContain("overflow: hidden");
    expect(elevated).toContain("z-index: 4");
    expect(visible).toContain("opacity: 1");
    expect(visible).toContain("pointer-events: auto");
    expect(visibleButtons).toContain("pointer-events: auto");
    expect(styles).not.toContain("--note-media-footer-height");
    expect(styles).not.toContain(".note-card--media-only.note-card--collapsed");
    expect(styles).not.toContain("note-card--playable-media");
  });

  it("keeps footer actions visible on coarse pointers", () => {
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-card--media-only \{[^}]*overflow:\s*hidden;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-card__media-actions \{[^}]*position:\s*static;[^}]*min-height:\s*49px;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*?\.note-card__media-actions button \{[^}]*pointer-events:\s*auto;/);
  });
});
