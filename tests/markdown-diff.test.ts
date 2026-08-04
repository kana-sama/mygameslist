import { describe, expect, it } from "vitest";
import {
  diffSourceLines,
  reconstructAfter,
  reconstructBefore,
} from "../src/domain";
import {
  LEGO_PARCELS_AFTER,
  LEGO_PARCELS_BEFORE,
} from "./fixtures/lego-harry-potter-98c11c1c";

describe("exact Markdown source diff", () => {
  it("keeps an ellipsis task as context when text is inserted before it", () => {
    const lines = diffSourceLines(LEGO_PARCELS_BEFORE, LEGO_PARCELS_AFTER);
    const ellipsis = lines.filter((line) => line.value === "- [ ] ...");

    expect(ellipsis).toEqual([expect.objectContaining({ kind: "context" })]);
    expect(lines.filter((line) => line.kind === "added").map((line) => line.value)).toEqual([
      "- [x] Опушка",
      "- [x] Гостинная Пуфендуй",
    ]);
  });

  it.each([
    ["", ""],
    ["a", "a\n"],
    ["a\r\n\r\n", "a\r\nб\r\n"],
    ["- [ ] ...\n- [ ] ...", "- [x] один\n- [ ] ...\n- [ ] ..."],
    [LEGO_PARCELS_BEFORE, LEGO_PARCELS_AFTER],
  ])("reconstructs both exact inputs for corpus %#", (before, after) => {
    const lines = diffSourceLines(before, after);
    expect(reconstructBefore(lines)).toBe(before);
    expect(reconstructAfter(lines)).toBe(after);
  });
});
