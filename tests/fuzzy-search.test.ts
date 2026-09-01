import { describe, expect, it } from "vitest";
import { fuzzySearch, searchQueryVariants } from "../src/domain";

describe("fuzzySearch", () => {
  it("orders exact, prefix, and primary substring matches by intrinsic match class", () => {
    const exact = fuzzySearch("eternal", [{ id: "title", priority: "primary", text: "Eternal" }]);
    const prefix = fuzzySearch("eternal", [{ id: "title", priority: "primary", text: "Eternal Horizon" }]);
    const substring = fuzzySearch("eternal", [{ id: "title", priority: "primary", text: "The Eternal Horizon" }]);

    expect(exact?.score).toBeLessThan(prefix?.score ?? Number.POSITIVE_INFINITY);
    expect(prefix?.score).toBeLessThan(substring?.score ?? Number.POSITIVE_INFINITY);
  });

  it("prefers an equivalent primary-field match over a secondary-field match", () => {
    expect(fuzzySearch("eternal", [
      { id: "title", priority: "primary", text: "Eternal" },
      { id: "annotation", priority: "secondary", text: "Eternal" },
    ])).toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("matches a query entered in the wrong keyboard layout", () => {
    expect(searchQueryVariants("vtnfk")).toContain("метал");
    expect(fuzzySearch("vtnfk", [{ id: "title", priority: "primary", text: "Металл" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("normalizes ё and е to the same searchable text", () => {
    expect(fuzzySearch("елка", [{ id: "title", priority: "primary", text: "Ёлка" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("matches keyboard-layout substitution in both directions", () => {
    expect(searchQueryVariants("руддщ")).toContain("hello");
    expect(fuzzySearch("руддщ", [{ id: "title", priority: "primary", text: "Hello" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("matches primary-field initialisms", () => {
    expect(fuzzySearch("mgs", [{ id: "title", priority: "primary", text: "Metal Gear Solid" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("requires every query term while allowing terms to match different fields", () => {
    expect(fuzzySearch("mg sl", [
      { id: "title", priority: "primary", text: "Metal Gear" },
      { id: "tag", priority: "secondary", text: "stealth" },
    ])).not.toBeNull();
  });

  it("matches an omission with a span beyond the former gap limit", () => {
    expect(fuzzySearch("etnl", [{ id: "title", priority: "primary", text: "Eternal" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("matches adjacent transpositions", () => {
    expect(fuzzySearch("eteranl", [{ id: "title", priority: "primary", text: "Eternal" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("matches multiple adjacent transpositions when term length permits them", () => {
    expect(fuzzySearch("badcefgh", [{ id: "title", priority: "primary", text: "abcdefgh" }]))
      .toMatchObject({ matchedFieldIds: ["title"] });
  });

  it("applies typo tolerance only at the configured term lengths", () => {
    expect(fuzzySearch("cot", [{ id: "title", priority: "primary", text: "cat" }])).toBeNull();
    expect(fuzzySearch("gmae", [{ id: "title", priority: "primary", text: "game" }])).not.toBeNull();
    expect(fuzzySearch("etxrnxl", [{ id: "title", priority: "primary", text: "eternal" }])).not.toBeNull();
  });

  it("reports unique contributing field identities in best-match order", () => {
    expect(fuzzySearch("metal stealth", [
      { id: "title", priority: "primary", text: "Metal Gear" },
      { id: "tag", priority: "secondary", text: "stealth" },
      { id: "duplicate", priority: "secondary", text: "stealth" },
    ])).toMatchObject({ matchedFieldIds: ["title", "tag"] });
  });

  it("rejects broad two-character fuzzy matches", () => {
    expect(fuzzySearch("mt", [{ id: "title", priority: "primary", text: "Metal" }])).toBeNull();
  });

  it("does not let all-short fuzzy terms bootstrap one another", () => {
    expect(fuzzySearch("mt sl", [
      { id: "title", priority: "primary", text: "Metal Gear" },
      { id: "tag", priority: "secondary", text: "stealth" },
    ])).toBeNull();
  });

  it("preserves match-class precedence across primary and secondary fields", () => {
    const primarySubstring = fuzzySearch("eternal", [{ id: "title", priority: "primary", text: "The Eternal" }]);
    const secondarySubstring = fuzzySearch("eternal", [{ id: "annotation", priority: "secondary", text: "The Eternal" }]);
    const secondarySubsequence = fuzzySearch("etnl", [{ id: "annotation", priority: "secondary", text: "Eternal" }]);
    const primaryEdit = fuzzySearch("etnl", [{ id: "title", priority: "primary", text: "etml" }]);

    expect(primarySubstring?.score).toBeLessThan(secondarySubstring?.score ?? Number.POSITIVE_INFINITY);
    expect(secondarySubstring?.score).toBeLessThan(secondarySubsequence?.score ?? Number.POSITIVE_INFINITY);
    expect(secondarySubsequence?.score).toBeLessThan(primaryEdit?.score ?? Number.POSITIVE_INFINITY);
  });
});
