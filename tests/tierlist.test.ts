// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as tierList from "../src/domain/tierList";
import type { TierListDocument } from "../src/domain/tierList";
import { markdownInlinePlainText } from "../src/domain/markdownInlineAnnotations";
const imageAssetId = "a".repeat(64);
const fixture = (): TierListDocument => ({ version: 2, title: "Выбор 🐈\n<literal>", grades: [
  { id: "g1", name: "Любое", cards: [{ id: "c1", imageAssetId: null, bodyMarkdown: "Строка\nстрока" }, { id: "c2", imageAssetId, bodyMarkdown: "" }, { id: "c3", imageAssetId, bodyMarkdown: "[x] tooltip" }] },
  { id: "g2", name: "Любое", cards: [] },
] });
describe("tier-list document", () => {
  it("round-trips every legacy whitespace character without changing the strict v2 shape", () => {
    const text = "\u00a0 \tFirst  line\n\n   Second\t \n\u2003\u202f\ufeff";
    const source = JSON.stringify({ version: 1, title: "", grades: [{ id: "g", name: "A", cards: [{ id: "c", type: "image-text", imageAssetId, text }] }] });
    const converted = tierList.parseTierList(source);
    const saved = tierList.parseTierList(tierList.serializeTierList(converted));
    expect(markdownInlinePlainText(saved.grades[0].cards[0].bodyMarkdown)).toBe(text);
    expect(Object.keys(saved.grades[0].cards[0]).sort()).toEqual(["bodyMarkdown", "id", "imageAssetId"]);
    expect(JSON.parse(source).version).toBe(1);
    expect(saved).toEqual(converted);
  });
  it("creates and parses an empty board without preset grades", () => {
    expect(tierList.createTierListDocument()).toEqual({ version: 2, title: "", grades: [] });
    expect(tierList.parseTierList(" \n")).toEqual(tierList.createTierListDocument());
  });
  it("round-trips all card variants, duplicate names and literal multiline Unicode", () => {
    const document = fixture(), source = tierList.serializeTierList(document);
    expect(source).toBe(JSON.stringify(document, null, 2));
    expect(tierList.parseTierList(source)).toEqual(document);
    expect(tierList.validateTierList(source)).toEqual([]);
    expect(tierList.tierListImageAssetIds(document)).toEqual(new Set([imageAssetId]));
  });
  it.each([
    null, [], {}, { version: 3, title: "", grades: [] }, { version: 1, grades: [] }, { version: 1, title: 0, grades: [] },
    { version: 1, title: "", grades: [], extra: true }, { version: 1, title: "", grades: {} },
  ])("rejects missing fields, wrong values and unknown keys: %j", value => {
    expect(tierList.validateTierList(JSON.stringify(value)).length).toBeGreaterThan(0);
    expect(() => tierList.parseTierList(JSON.stringify(value))).toThrow();
  });
  it.each([
    { id: "c", type: "text", text: "  " }, { id: "c", type: "text" }, { id: "c", type: "text", text: "ok", imageAssetId },
    { id: "c", type: "image", imageAssetId: "invalid" }, { id: "c", type: "image", imageAssetId, text: "extra" },
    { id: "c", type: "image-text", imageAssetId, text: "\n" }, { id: "c", type: "unknown" }, { id: " ", type: "text", text: "ok" },
  ])("rejects invalid card variants: %j", card => {
    expect(tierList.validateTierList(JSON.stringify({ version: 1, title: "", grades: [{ id: "g", name: "ok", cards: [card] }] })).length).toBeGreaterThan(0);
  });
  it("rejects unknown grade fields, blank names, wrong arrays and globally repeated IDs", () => {
    for (const grade of [{ id: "g", name: " ", cards: [] }, { id: "g", name: "ok", cards: {}, extra: true }, { id: "g", name: "ok" }]) {
      expect(tierList.validateTierList(JSON.stringify({ version: 1, title: "", grades: [grade] })).length).toBeGreaterThan(0);
    }
    for (const id of ["g1", "g2", "c1"]) {
      const doc = fixture(); doc.grades[1].cards.push({ id, imageAssetId: null, bodyMarkdown: "duplicate" });
      expect(tierList.validateTierList(JSON.stringify(doc)).join()).toMatch(/ID/);
    }
    const doc = fixture(); doc.grades[1].id = "g1";
    expect(() => tierList.parseTierList(JSON.stringify(doc))).toThrow(/ID/);
    expect(tierList.validateTierList("{" ).length).toBeGreaterThan(0);
  });
});
describe("tier-list movement", () => {
  it("moves into an empty grade without mutating source or changing IDs", () => {
    const doc = fixture(), before = structuredClone(doc), moved = tierList.moveTierListCard(doc, "c2", "g2", 500);
    expect(doc).toEqual(before);
    expect(moved.grades[0].cards.map(c => c.id)).toEqual(["c1", "c3"]);
    expect(moved.grades[1].cards).toEqual([doc.grades[0].cards[1]]);
    expect(moved.grades.map(g => [g.id, g.name])).toEqual(doc.grades.map(g => [g.id, g.name]));
  });
  it("uses the destination index after removal and clamps at both ends", () => {
    const doc = fixture();
    expect(tierList.moveTierListCard(doc, "c1", "g1", 1).grades[0].cards.map(c => c.id)).toEqual(["c2", "c1", "c3"]);
    expect(tierList.moveTierListCard(doc, "c1", "g1", 99).grades[0].cards.map(c => c.id)).toEqual(["c2", "c3", "c1"]);
    expect(tierList.moveTierListCard(doc, "c3", "g1", -99).grades[0].cards.map(c => c.id)).toEqual(["c3", "c1", "c2"]);
  });
  it("returns the original document for invalid and unchanged drops", () => {
    const doc = fixture();
    for (const [card, grade, index] of [["bad", "g1", 0], ["c1", "bad", 0], ["c1", "g1", 0], ["c3", "g1", 99], ["c1", "g2", NaN]] as const) {
      expect(tierList.moveTierListCard(doc, card, grade, index)).toBe(doc);
    }
  });
});
