import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  document.head.querySelectorAll("style[data-note-layout-test]").forEach((style) => style.remove());
  document.body.replaceChildren();
});

describe("note column layout", () => {
  it("lets rendered and editing note columns shrink to 350px before wrapping", () => {
    const style = document.createElement("style");
    style.dataset.noteLayoutTest = "true";
    style.textContent = productionStyles;
    document.head.append(style);

    for (const className of ["notes-list", "note-editors-grid"]) {
      const grid = document.createElement("div");
      grid.className = className;
      document.body.append(grid);
      expect(getComputedStyle(grid).getPropertyValue("--note-column-min").trim()).toBe("350px");
    }
  });
});
