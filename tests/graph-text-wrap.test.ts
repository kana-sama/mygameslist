import { describe, expect, it } from "vitest";
import { wrapGraphText } from "../src/components/graph/layout";

const cells = (text: string) => [...text].length;
const wrap = (text: string, width: number) => wrapGraphText(text, width, 12, cells);

describe("balanced graph text", () => {
  it("balances all lines instead of leaving a short last word", () => {
    expect(wrap("aaaa bbbb cccc dd", 14)).toEqual(["aaaa bbbb", "cccc dd"]);
  });

  it("keeps a fitting word and numeric suffix together", () => {
    expect(wrap("Alpha Beta Chapter 12", 19)).toEqual(["Alpha Beta", "Chapter 12"]);
    expect(wrap("Альфа Бета Глава 12", 17)).toEqual(["Альфа Бета", "Глава 12"]);
  });

  it("allows an overwide numeric pair to break", () => {
    expect(wrap("Chapter 12", 7)).toEqual(["Chapter", "12"]);
  });

  it("prioritizes the minimum feasible line count", () => {
    expect(wrap("aaaa bbbb cc", 9)).toHaveLength(2);
    expect(wrap("aaaa bbbb", 9)).toEqual(["aaaa bbbb"]);
  });

  it("preserves explicit and blank lines while collapsing ordinary whitespace", () => {
    expect(wrap("  alpha\t beta\n\ngamma\n", 30)).toEqual(["alpha beta", "", "gamma", ""]);
  });

  it.each(["\u00a0", "\u202f"])("keeps a fitting nonbreaking run (%s)", (space) => {
    expect(wrap(`aa bb${space}cc dd`, 8)).toEqual(["aa", `bb${space}cc dd`]);
    expect(wrap(`aa${space}bb`, 3)).toEqual(["aa", "bb"]);
  });

  it("only splits oversized words at grapheme boundaries", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const graphemes = (text: string) => [...segmenter.segment(text)].length;
    expect(wrapGraphText("e\u0301e\u0301e\u0301", 2, 12, graphemes)).toEqual(["e\u0301e\u0301", "e\u0301"]);
    expect(wrap("👩🏽‍🚀👩🏽‍🚀", 1)).toEqual(["👩🏽‍🚀", "👩🏽‍🚀"]);
  });

  it("uses measured widths rather than character counts", () => {
    const measure = (text: string) => [...text].reduce((sum, c) => sum + (c === "W" ? 4 : 1), 0);
    const lines = wrapGraphText("WW aa bb cc", 11, 12, measure);
    expect(lines).toEqual(["WW", "aa bb cc"]);
    expect(lines.every((line) => measure(line) <= 11)).toBe(true);
  });

  it("is deterministic and measures repeated candidates only once", () => {
    const text = "ab ".repeat(166).trim();
    const measured = new Set<string>();
    const measure = (candidate: string) => {
      expect(measured.has(candidate)).toBe(false);
      measured.add(candidate);
      return cells(candidate);
    };
    const lines = wrapGraphText(text, 30, 12, measure);
    expect(lines).toEqual(wrap(text, 30));
    expect(lines.join(" ")).toBe(text);
    expect(lines.every((line) => cells(line) <= 30)).toBe(true);
    expect(measured.size).toBeLessThan(600);
  });

  it("bounds measurement work for a maximum-length distinct oversized token", () => {
    const text = Array.from({ length: 500 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
    let measurements = 0;
    const lines = wrapGraphText(text, 249, 12, (candidate) => {
      measurements++;
      return cells(candidate);
    });
    expect(lines.join("")).toBe(text);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => cells(line) <= 249)).toBe(true);
    expect(Math.max(...lines.map(cells)) - Math.min(...lines.map(cells))).toBeLessThanOrEqual(1);
    expect(measurements).toBeLessThan(5000);
  });
});
