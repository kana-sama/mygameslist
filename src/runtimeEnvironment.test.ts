import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markRuntimeEnvironment } from "./runtimeEnvironment";

const stylesheet = readFileSync("src/styles.css", "utf8");

describe("markRuntimeEnvironment", () => {
  it("marks the root element in development mode", () => {
    const element = document.createElement("html");

    markRuntimeEnvironment(element, true);

    expect(element).toHaveAttribute("data-runtime-environment", "development");
  });

  it("leaves the root element unmarked outside development mode", () => {
    const element = document.createElement("html");
    element.setAttribute("data-runtime-environment", "development");

    markRuntimeEnvironment(element, false);

    expect(element).not.toHaveAttribute("data-runtime-environment");
  });

  it("routes the root canvas through the development-aware background token", () => {
    const rootRule = stylesheet.match(/:root\s*\{[\s\S]*?\}/)?.[0];

    expect(rootRule).toContain("background: var(--canvas-background);");
  });
});
