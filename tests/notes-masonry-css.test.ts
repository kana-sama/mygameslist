import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownView } from "../src/components/Markdown";

const productionStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => cleanup());

describe("completed table summary CSS", () => {
  it("matches rendered reference surfaces, exact summary metrics, resets, and interactive states", () => {
    const style = document.createElement("style");
    style.textContent = `:root { --surface-2: rgb(20, 21, 22); --muted: rgb(90, 91, 92); --text: rgb(230, 231, 232); --line-soft: rgb(40, 41, 42); }\n${productionStyles.replaceAll(":hover", ".test-hover").replaceAll(":focus-visible", ".test-focus")}`;
    document.head.append(style);
    try {
      const view = render(createElement(MarkdownView, { completedChecklistFilterEnabled: true, markdown: [
        "| Stage | Done |",
        "| --- | --- |",
        "| Complete group |",
        "| --- | --- |",
        "| Done | [x] |",
        "| --- | --- |",
        "| Mixed group |",
        "| --- | --- |",
        "| Hidden row | [x] |",
        "| Visible row | [ ] |",
      ].join("\n") }));
      const hiddenGroup = view.container.querySelector<HTMLElement>(".markdown-table-group[hidden]")!;
      const hiddenRow = view.container.querySelector<HTMLElement>(".markdown-table-row[hidden]")!;
      const rowSummary = view.container.querySelector<HTMLElement>(".markdown-table-hidden-summary--rows")!;
      const groupSummary = view.container.querySelector<HTMLElement>(".markdown-table-hidden-summary--groups")!;
      const rowCell = rowSummary.querySelector<HTMLElement>("td")!;
      const groupCell = groupSummary.querySelector<HTMLElement>("td")!;
      const rowButton = rowSummary.querySelector<HTMLButtonElement>("button")!;
      const groupButton = groupSummary.querySelector<HTMLButtonElement>("button")!;
      const ordinaryCell = screen.getByText("Visible row").closest<HTMLElement>("td")!;
      const groupHeadingCell = screen.getByText("Mixed group").closest<HTMLElement>("th")!;
      const replica = document.createElement("table");
      replica.className = "markdown-table markdown-completed-checklist-motion-replica";
      replica.style.width = "173.5px";
      view.container.querySelector(".markdown")!.append(replica);

      expect(getComputedStyle(hiddenRow).display).toBe("table-row");
      expect(getComputedStyle(hiddenRow).visibility).toBe("collapse");
      expect(getComputedStyle(hiddenGroup).display).toBe("table-row-group");
      expect(getComputedStyle(hiddenGroup).visibility).toBe("collapse");
      const cellProperties = ["boxSizing", "height", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "textAlign", "fontWeight"] as const;
      const buttonProperties = ["boxSizing", "width", "height", "minHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "fontWeight", "lineHeight", "textAlign"] as const;
      for (const property of cellProperties) expect(getComputedStyle(rowCell)[property]).toBe(getComputedStyle(groupCell)[property]);
      for (const property of buttonProperties) expect(getComputedStyle(rowButton)[property]).toBe(getComputedStyle(groupButton)[property]);
      expect(getComputedStyle(rowSummary).height).toBe("29px");
      expect(getComputedStyle(groupSummary).height).toBe("29px");
      expect(getComputedStyle(rowCell).boxSizing).toBe("border-box");
      expect(getComputedStyle(rowCell).height).toBe("29px");
      expect(getComputedStyle(rowCell).lineHeight).toBe("15px");
      expect(getComputedStyle(rowCell).paddingTop).toBe("6px");
      expect(getComputedStyle(rowCell).paddingRight).toBe("8px");
      expect(getComputedStyle(rowButton).display).toBe("block");
      expect(getComputedStyle(rowButton).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(groupButton).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(rowButton).borderTopStyle).toBe("none");
      expect(getComputedStyle(rowButton).appearance).toBe("none");
      expect(getComputedStyle(rowButton).cursor).toBe("pointer");
      expect(getComputedStyle(groupButton).cursor).toBe("pointer");
      expect(getComputedStyle(rowButton).color).toBe(getComputedStyle(groupButton).color);
      expect(getComputedStyle(rowCell).backgroundColor).toBe(getComputedStyle(ordinaryCell).backgroundColor);
      expect(getComputedStyle(groupCell).backgroundColor).toBe(getComputedStyle(groupHeadingCell).backgroundColor);
      rowButton.classList.add("test-hover");
      groupButton.classList.add("test-focus");
      expect(getComputedStyle(rowButton).color).toBe(getComputedStyle(groupButton).color);
      expect(getComputedStyle(rowButton).textDecoration).toContain("underline");
      expect(getComputedStyle(groupButton).textDecoration).toContain("underline");
      expect(getComputedStyle(replica).tableLayout).toBe("fixed");
      expect(getComputedStyle(replica).width).toBe("173.5px");
      expect(getComputedStyle(replica).minWidth).toBe("0px");
      expect(getComputedStyle(replica).maxWidth).toBe("none");
    } finally {
      style.remove();
    }
  });
});
