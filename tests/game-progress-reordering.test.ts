import { describe, expect, it } from "vitest";
import { reorderProgressItems } from "../src/domain/progressItems";

const items = [
  { id: "a", noteId: "note-a" },
  { id: "b", noteId: "note-b" },
  { id: "c", noteId: "note-c" },
  { id: "d", noteId: "note-d" },
];

describe("reorderProgressItems", () => {
  it("uses sortable arrayMove semantics in both directions without cloning item data", () => {
    const forward = reorderProgressItems(items, "a", "c")!;
    const backward = reorderProgressItems(items, "d", "b")!;
    expect(forward.map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
    expect(backward.map((item) => item.id)).toEqual(["a", "d", "b", "c"]);
    expect(forward[2]).toBe(items[0]);
    expect(backward[1]).toBe(items[3]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it.each([["a", "a"], ["missing", "b"], ["a", "missing"]])("returns null for no-op or unresolved %s -> %s", (active, over) => {
    expect(reorderProgressItems(items, active, over)).toBeNull();
  });
});
