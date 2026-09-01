import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks } from "../src/domain/markdownChecklist";
import {
  buildChecklistSearchIndex,
  checklistSearchEntryId,
  searchChecklistEntries,
} from "../src/domain/checklistSearch";

const structuralFixture = [
  "# Atlas",
  "",
  "## Route",
  "- Chapter group",
  '  - [ ] Open [Door]("stone *key*") and [**Map**][?]',
  "  - [-] Mixed state",
  "## Tables",
  "| Stage | Goal |",
  "| --- | --- |",
  "| Vault |",
  "| --- | --- |",
  "| A | [x] Inspect [Seal][?] |",
  "",
  "[?Map]:",
  "    Northern route",
  "[?Seal]:",
  "    Region",
  "    : **Deep Vault**",
].join("\n");

describe("checklist search index", () => {
  it("indexes nested list and grouped-table tasks with authoritative structure and source coordinates", () => {
    const blocks = parseMarkdownBlocks(structuralFixture);
    const titleHeading = blocks.find((block) => block.type === "heading" && block.value === "Atlas")!;
    const routeHeading = blocks.find((block) => block.type === "heading" && block.value === "Route")!;
    const tablesHeading = blocks.find((block) => block.type === "heading" && block.value === "Tables")!;
    const listBlock = blocks.find((block) => block.type === "list")!;
    const listGroup = listBlock.items![0];
    const tableBlock = blocks.find((block) => block.type === "table")!;
    const tableGroup = tableBlock.table!.sections.find((section) => section.type === "group")!;

    const entries = buildChecklistSearchIndex([{ bodyMarkdown: structuralFixture, clientId: "client:a", id: "note-a" }]);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      ancestorCollapseIds: [titleHeading.collapseId, routeHeading.collapseId, listGroup.collapseId],
      annotations: [
        {
          id: `${checklistSearchEntryId("client:a", 4, 4)}:annotation:0`,
          kind: "simple",
          labelMarkdown: "Door",
          labelText: "Door",
          plainText: "stone *key*",
          sourceOrder: 0,
        },
        {
          bodyMarkdown: "Northern route",
          id: `${checklistSearchEntryId("client:a", 4, 4)}:annotation:1`,
          kind: "rich",
          labelMarkdown: "**Map**",
          labelText: "Map",
          plainText: "Northern route",
          sourceOrder: 1,
        },
      ],
      id: checklistSearchEntryId("client:a", 4, 4),
      noteClientId: "client:a",
      noteId: "note-a",
      noteOrder: 0,
      path: "Atlas › Route › Chapter group",
      sourceColumn: 4,
      sourceLine: 4,
      state: "unchecked",
      structuralGuard: expect.any(String),
      structuralItemId: listGroup.children[0].items![0].structuralId,
      text: "Open Door and Map",
      textMarkdown: 'Open [Door]("stone *key*") and [**Map**][?]',
    });
    expect(entries[1]).toMatchObject({
      ancestorCollapseIds: [titleHeading.collapseId, routeHeading.collapseId, listGroup.collapseId],
      path: "Atlas › Route › Chapter group",
      sourceColumn: 4,
      sourceLine: 5,
      state: "indeterminate",
      text: "Mixed state",
    });
    expect(entries[2]).toMatchObject({
      ancestorCollapseIds: [titleHeading.collapseId, tablesHeading.collapseId, tableGroup.collapseId],
      annotations: [{ bodyMarkdown: "Region\n: **Deep Vault**", kind: "rich", plainText: "Region Deep Vault" }],
      path: "Atlas › Tables › Vault",
      sourceColumn: 6,
      sourceLine: 11,
      state: "checked",
      text: "Inspect Seal",
      textMarkdown: "Inspect [Seal][?]",
    });
    expect(entries[2].structuralItemId).toBeUndefined();
  });

  it("keeps list and table structural guards stable for marker-only changes but replaces them with item content", () => {
    const before = buildChecklistSearchIndex([{ bodyMarkdown: structuralFixture, clientId: "stable" }]);
    const markerOnly = buildChecklistSearchIndex([{
      bodyMarkdown: structuralFixture.replace("  - [ ] Open", "  - [x] Open").replace("| A | [x] Inspect", "| A | [-] Inspect"),
      clientId: "stable",
    }]);
    const replacements = buildChecklistSearchIndex([{
      bodyMarkdown: structuralFixture
        .replace("Open [Door]", "Replace [Door]")
        .replace("Inspect [Seal]", "Replace [Seal]"),
      clientId: "stable",
    }]);

    expect(before[0].structuralGuard).toEqual(expect.any(String));
    expect(before[2].structuralGuard).toEqual(expect.any(String));
    expect(markerOnly.map((entry) => entry.id)).toEqual(before.map((entry) => entry.id));
    expect(markerOnly.map((entry) => entry.structuralGuard)).toEqual(before.map((entry) => entry.structuralGuard));
    expect(markerOnly.map((entry) => entry.structuralItemId)).toEqual(before.map((entry) => entry.structuralItemId));
    expect(markerOnly.map((entry) => entry.state)).toEqual(["checked", "indeterminate", "indeterminate"]);
    expect(replacements[0].id).toBe(before[0].id);
    expect(replacements[2].id).toBe(before[2].id);
    expect(replacements[0].structuralGuard).not.toBe(before[0].structuralGuard);
    expect(replacements[2].structuralGuard).not.toBe(before[2].structuralGuard);
  });

  it("indexes even simple-annotation escapes but keeps odd escapes literal", () => {
    const markdown = [
      "# Escapes",
      String.raw`- [ ] Odd \[Hidden]("description")`,
      String.raw`- [ ] Even \\[Visible]("description")`,
    ].join("\n");

    const entries = buildChecklistSearchIndex([{ bodyMarkdown: markdown, clientId: "escapes" }]);

    expect(entries.map((entry) => entry.annotations.map((annotation) => annotation.labelText))).toEqual([
      [],
      ["Visible"],
    ]);
    expect(entries.map((entry) => entry.text)).toEqual([
      'Odd [Hidden]("description")',
      String.raw`Even \Visible`,
    ]);
  });

  it("excludes task-like lines inside a rejected nonterminal rich definition body without hiding later tasks", () => {
    const markdown = [
      "# Invalid definitions",
      "[?Broken]:",
      "    - [ ] Definition body task",
      "",
      "Ordinary content makes the definition section nonterminal.",
      "- [ ] Ordinary task",
    ].join("\n");

    const entries = buildChecklistSearchIndex([{ bodyMarkdown: markdown, clientId: "invalid-definitions" }]);

    expect(entries.map((entry) => entry.text)).toEqual(["Ordinary task"]);
  });

  it("ignores empty simple and invalid rich annotations without hiding their task item", () => {
    const markdown = [
      "# Validation",
      '- [ ] Keep [Empty]("") [Missing][?] [Duplicate][?] [Blank][?] [Nested][?] [Valid][?] [Broken]("unterminated)',
      "",
      "[?Duplicate]:",
      "    First",
      "[?Duplicate]:",
      "    Second",
      "[?Blank]:",
      "",
      "[?Nested]:",
      "    Invalid [Inner][?] body",
      "[?Valid]:",
      "    Searchable body",
    ].join("\n");

    const [entry] = buildChecklistSearchIndex([{ bodyMarkdown: markdown, clientId: "validation" }]);

    expect(entry.text).toContain("Keep Empty Missing Duplicate Blank Nested Valid");
    expect(entry.annotations).toEqual([
      {
        bodyMarkdown: "Searchable body",
        id: `${entry.id}:annotation:5`,
        kind: "rich",
        labelMarkdown: "Valid",
        labelText: "Valid",
        plainText: "Searchable body",
        sourceOrder: 5,
      },
    ]);
  });

  it("searches item text before annotations, resolves rich definition-list text, and reports matched annotations in scorer order", () => {
    const notes = [
      {
        clientId: "annotation-note",
        bodyMarkdown: [
          "# Lore",
          '- [ ] Review [Clue]("needle") and [Archive][?]',
          "",
          "[?Archive]:",
          "    Region",
          "    : Forgotten Vault",
        ].join("\n"),
      },
      { clientId: "item-note", bodyMarkdown: "# Tasks\n- [ ] needle" },
    ];
    const entries = buildChecklistSearchIndex(notes);

    const needle = searchChecklistEntries(entries, "needle");
    expect(needle.map((result) => result.entry.noteClientId)).toEqual(["item-note", "annotation-note"]);
    expect(needle[0].matchedAnnotationIds).toEqual([]);
    expect(needle[1].matchedAnnotationIds).toEqual([entries[0].annotations[0].id]);

    const splitFields = searchChecklistEntries(entries, "review vault");
    expect(splitFields).toHaveLength(1);
    expect(splitFields[0].matchedAnnotationIds).toEqual([entries[0].annotations[1].id]);
    expect(searchChecklistEntries(entries, "forgotten")[0].entry.id).toBe(entries[0].id);
    expect(searchChecklistEntries(entries, "")).toEqual([]);
  });
});
