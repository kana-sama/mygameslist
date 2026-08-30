import { describe, expect, it } from "vitest";
import {
  createMarkdownDiff,
  deriveMarkdownTitle,
  diffSourceLines,
  reconstructAfter,
  reconstructBefore,
  summarizeMarkdownDiff,
} from "../src/domain";
import {
  LEGO_LOCKS_AFTER,
  LEGO_LOCKS_BEFORE,
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

  it("pairs a local task toggle without moving duplicate ellipsis items", () => {
    const before = "## A\n- [ ] Открыть\n- [ ] ...\n\n## B\n- [ ] Открыть\n- [ ] ...";
    const after = "## A\n- [x] Открыть\n- [ ] ...\n\n## B\n- [ ] Открыть\n- [ ] ...";
    const model = createMarkdownDiff(before, after);

    expect(model.renderable).toBe(true);
    expect(
      model.lines
        .filter((line) => line.value === "- [ ] ...")
        .every((line) => line.kind === "context"),
    ).toBe(true);
    expect(
      model.fragments.some(
        (fragment) => fragment.blockType === "listItem" && fragment.kind === "modified",
      ),
    ).toBe(true);
    const modified = model.fragments.find((fragment) => fragment.kind === "modified");
    expect(modified).toMatchObject({
      before: {
        decorations: [expect.objectContaining({ startColumn: 3, endColumn: 4 })],
      },
      after: {
        decorations: [expect.objectContaining({ startColumn: 3, endColumn: 4 })],
      },
    });
    expect(model.lines.filter((line) => line.pairId)).toHaveLength(2);
    expect(model.hunks).toHaveLength(1);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("pairs a unique checklist tooltip migration by its rendered label", () => {
    const before = '- [x] [Archive Entry]("Old plain tooltip body")';
    const after = "- [x] [Archive Entry][?]";
    const model = createMarkdownDiff(before, after);

    const changedLines = model.lines.filter((line) => line.kind !== "context");
    expect(changedLines).toHaveLength(2);
    expect(changedLines[0]?.pairId).toBeDefined();
    expect(changedLines[1]?.pairId).toBe(changedLines[0]?.pairId);
    expect(model.fragments).toContainEqual(expect.objectContaining({
      blockType: "listItem",
      kind: "modified",
    }));
    expect(model.fragments.filter((fragment) => fragment.kind === "removed" || fragment.kind === "added"))
      .toHaveLength(0);
  });

  it("pairs a unique checklist tooltip migration before independently added terminal definitions", () => {
    const before = '- [x] [Archive Entry]("Old plain tooltip body")';
    const after = [
      "- [x] [Archive Entry][?]",
      "",
      "[?Archive Entry]:",
      "    Old plain tooltip body",
    ].join("\n");
    const model = createMarkdownDiff(before, after);

    const paired = model.lines.filter((line) => line.pairId);
    expect(paired).toHaveLength(2);
    expect(paired.map((line) => line.value)).toEqual([
      before,
      "- [x] [Archive Entry][?]",
    ]);
    expect(model.lines.filter((line) => line.value.startsWith("[?Archive Entry]:"))[0]?.pairId)
      .toBeUndefined();
    expect(model.fragments).toContainEqual(expect.objectContaining({
      blockType: "listItem",
      kind: "modified",
    }));
  });

  it.each([
    [
      "a formatted tooltip label",
      '- [x] [**Archive Entry**]("Old plain tooltip body")',
      "- [x] [**Archive Entry**][?]",
    ],
    [
      "embedded checklist text around a tooltip label",
      '- [x] Open [Archive Entry]("Old plain tooltip body") now',
      "- [x] Open [Archive Entry][?] now",
    ],
  ])("pairs %s by rendered tooltip content", (_label, before, after) => {
    const model = createMarkdownDiff(before, after);

    expect(model.lines.filter((line) => line.pairId)).toHaveLength(2);
    expect(model.fragments).toContainEqual(expect.objectContaining({
      blockType: "listItem",
      kind: "modified",
    }));
  });

  it("declines an unequal run with multiple legacy and rich tooltip candidates", () => {
    const before = Array.from(
      { length: 20 },
      (_, index) => `- [x] [Legacy ${index}]("Old tooltip body ${index}")`,
    ).join("\n");
    const after = [
      "- [x] [Legacy 0][?]",
      ...Array.from({ length: 20 }, (_, index) => `- [x] [Rich ${index}][?]`),
    ].join("\n");
    const model = createMarkdownDiff(before, after);

    expect(model.lines.every((line) => line.pairId === undefined)).toBe(true);
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
  });

  it.each([
    [
      "escaped tooltip syntax",
      '- [x] \\[Archive Entry]("Old plain tooltip body")',
      "- [x] \\[Archive Entry][?]",
    ],
    [
      "code tooltip syntax",
      '- [x] `[Archive Entry]("Old plain tooltip body")`',
      "- [x] `[Archive Entry][?]`",
    ],
    [
      "ordinary checklist links",
      "- [x] [Archive Entry](https://example.test/old)",
      "- [x] [Archive Entry][?]",
    ],
  ])("does not treat %s as a semantic tooltip migration", (_label, before, after) => {
    const model = createMarkdownDiff(before, after);

    expect(model.lines.every((line) => line.pairId === undefined)).toBe(true);
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
  });

  it("does not pair ambiguous duplicate checklist tooltip migrations", () => {
    const before = [
      '- [x] [Archive Entry]("Old plain tooltip body")',
      '- [x] [Archive Entry]("Old plain tooltip body")',
    ].join("\n");
    const after = [
      "- [x] [Archive Entry][?]",
      "- [x] [Archive Entry][?]",
    ].join("\n");
    const model = createMarkdownDiff(before, after);

    expect(model.lines.every((line) => line.pairId === undefined)).toBe(true);
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
  });

  it("falls back to exact lines when table row keys are ambiguous", () => {
    const before = "| Этап | Статус |\n| --- | --- |\n| Дубль | [ ] |\n| Дубль | [x] |";
    const after = "| Этап | Статус |\n| --- | --- |\n| Дубль | [x] |\n| Дубль | [x] |";
    const model = createMarkdownDiff(before, after);

    expect(model.fallbacks).toContainEqual(expect.objectContaining({ blockType: "table" }));
    expect(model.lines.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(
      true,
    );
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines descendants of ambiguous duplicate heading sections", () => {
    const before = "## A\n- [ ] Один\n\n## A\n- [ ] Два";
    const after = "## A\n- [x] Один\n\n## A\n- [ ] Два";
    const model = createMarkdownDiff(before, after);

    expect(model.fallbacks).toContainEqual(
      expect.objectContaining({ blockType: "heading", reason: "ambiguous-anchor" }),
    );
    expect(model.lines.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(
      true,
    );
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("keeps a similarly prefixed unique heading outside an ambiguous section", () => {
    const before = "## A\n- [ ] Один\n\n## A\n- [ ] Два\n\n## AB\n- [ ] Три";
    const after = "## A\n- [ ] Один\n\n## A\n- [ ] Два\n\n## AB\n- [x] Три";
    const model = createMarkdownDiff(before, after);

    expect(model.fragments).toContainEqual(
      expect.objectContaining({ blockType: "listItem", kind: "modified" }),
    );
    expect(model.lines.filter((line) => line.pairId)).toHaveLength(2);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines duplicate anchors inside a nested list", () => {
    const before = "- Снаружи\n  - [ ] Дубль\n  - [ ] Дубль";
    const after = "- Снаружи\n  - [x] Дубль\n  - [ ] Дубль";
    const model = createMarkdownDiff(before, after);

    expect(model.fallbacks).toContainEqual(
      expect.objectContaining({ blockType: "listItem", reason: "ambiguous-anchor" }),
    );
    expect(model.lines.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(
      true,
    );
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines descendants of ambiguous duplicate list items", () => {
    const before = "- Дубль\n  - [ ] Внутри\n- Дубль\n  - [ ] Внутри";
    const after = "- Дубль\n  - [x] Внутри\n- Дубль\n  - [ ] Внутри";
    const model = createMarkdownDiff(before, after);

    expect(model.fallbacks).toContainEqual(
      expect.objectContaining({ blockType: "listItem", reason: "ambiguous-anchor" }),
    );
    expect(model.lines.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(
      true,
    );
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("does not pair reordered non-adjacent list items as modifications", () => {
    const before = "- Alpha one\n- Beta one";
    const after = "- Beta two\n- Alpha two";
    const model = createMarkdownDiff(before, after);

    expect(model.lines.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(
      true,
    );
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines positional pairs when similar list items have stronger moved matches", () => {
    const before = "- Item one A\n- Item one B";
    const after = "- Item one B!\n- Item one A!";
    const model = createMarkdownDiff(before, after);

    expect(model.lines.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(
      true,
    );
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines semantic pairing when one edited line exceeds the character-product budget", () => {
    const shared = "а".repeat(1_100);
    const before = `${shared} старое`;
    const after = `${shared} новое`;
    const model = createMarkdownDiff(before, after);

    expect(model.lines.filter((line) => line.pairId)).toHaveLength(0);
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines semantic pairing when a replacement run exceeds the cross-comparison budget", () => {
    const before = Array.from(
      { length: 65 },
      (_, index) => `Запись ${String(index).padStart(2, "0")} имеет старое значение`,
    ).join("\n");
    const after = Array.from(
      { length: 65 },
      (_, index) => `Запись ${String(index).padStart(2, "0")} имеет новое значение`,
    ).join("\n");
    const model = createMarkdownDiff(before, after);

    expect(model.lines.filter((line) => line.pairId)).toHaveLength(0);
    expect(model.fragments.some((fragment) => fragment.kind === "modified")).toBe(false);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("declines later semantic pairs when replacement runs exhaust the document work budget", () => {
    const shared = "а".repeat(300);
    const before = Array.from({ length: 12 }, (_, index) => [
      `${shared} старое ${index}`,
      `неизменный разделитель ${index}`,
    ]).flat().join("\n");
    const after = Array.from({ length: 12 }, (_, index) => [
      `${shared} новое ${index}`,
      `неизменный разделитель ${index}`,
    ]).flat().join("\n");
    const model = createMarkdownDiff(before, after);
    const finalRun = model.lines.filter((line) => /(?:старое|новое) 11$/u.test(line.value));

    expect(finalRun).toHaveLength(2);
    expect(finalRun.every((line) => line.pairId === undefined && line.inline === undefined)).toBe(true);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("matches identical subheadings within their own parent sections", () => {
    const before = "## A\n### Details\n- [ ] One\n\n## B\n### Details\n- [ ] Two";
    const after = "## A\n### Details\n- [x] One\n\n## B\n### Details\n- [ ] Two";
    const model = createMarkdownDiff(before, after);

    expect(model.fallbacks).not.toContainEqual(
      expect.objectContaining({ blockType: "heading", reason: "ambiguous-anchor" }),
    );
    expect(model.fragments.filter((fragment) => fragment.kind === "modified")).toHaveLength(1);
    expect(model.lines.filter((line) => line.pairId)).toHaveLength(2);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("counts one multi-line list item as one structural fragment", () => {
    const after = "- Первая строка\n  продолжение";
    const model = createMarkdownDiff("", after);
    const addedItems = model.fragments.filter(
      (fragment) => fragment.blockType === "listItem" && fragment.kind === "added",
    );

    expect(addedItems).toHaveLength(1);
    expect(addedItems[0]).toMatchObject({
      after: { markdown: after },
      sourceLineIds: ["added:-:1", "added:-:2"],
    });
    expect(summarizeMarkdownDiff(model)).toBe("Добавлено 1 строка");
    expect(reconstructBefore(model.lines)).toBe("");
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("groups paired lines from one modified list item into one fragment", () => {
    const before = "- Пункт А\n  описание А";
    const after = "- Пункт Б\n  описание Б";
    const model = createMarkdownDiff(before, after);
    const modifiedItems = model.fragments.filter(
      (fragment) => fragment.blockType === "listItem" && fragment.kind === "modified",
    );

    expect(modifiedItems).toHaveLength(1);
    expect(modifiedItems[0]).toMatchObject({
      before: { markdown: before },
      after: { markdown: after },
      sourceLineIds: ["removed:1:-", "removed:2:-", "added:-:1", "added:-:2"],
    });
    expect(modifiedItems[0].before?.decorations.map((item) => item.startLine)).toEqual([0, 1]);
    expect(modifiedItems[0].after?.decorations.map((item) => item.startLine)).toEqual([0, 1]);
    expect(summarizeMarkdownDiff(model)).toBe("Изменено 1 строка");
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("derives a title from the first heading, then plain text, then the default", () => {
    expect(deriveMarkdownTitle("вступление\n## **Первый**\n# Второй")).toBe("Первый");
    expect(deriveMarkdownTitle("\n- [ ] Запасной заголовок")).toBe("Запасной заголовок");
    expect(deriveMarkdownTitle("\n\r\n")).toBe("Заметка без заголовка");
  });

  it("decorates only the changed UTF-16 table cell span", () => {
    const model = createMarkdownDiff(
      "| Этап | Статус |\n| --- | --- |\n| 🧙 | [ ] |",
      "| Этап | Статус |\n| --- | --- |\n| 🧙 | [x] |",
    );
    const row = model.fragments.find(
      (fragment) => fragment.blockType === "tableRow" && fragment.kind === "modified",
    );

    expect(row?.before?.decorations).toEqual([
      expect.objectContaining({ startLine: 0, startColumn: 8, endLine: 0, endColumn: 9 }),
    ]);
    expect(row?.after?.decorations).toEqual([
      expect.objectContaining({ startLine: 0, startColumn: 8, endLine: 0, endColumn: 9 }),
    ]);
  });

  it("builds separate three-context-line hunk windows deterministically", () => {
    const before = Array.from({ length: 14 }, (_, index) => `Строка ${index + 1}`).join("\n");
    const afterLines = before.split("\n");
    afterLines[2] = "Строка три";
    afterLines[11] = "Строка двенадцать";
    const model = createMarkdownDiff(before, afterLines.join("\n"));

    expect(model.hunks).toHaveLength(2);
    expect(model.hunks.map((hunk) => hunk.id)).toEqual(["hunk:0", "hunk:1"]);
    expect(model.hunks[0].lines.at(-1)?.value).toBe("Строка 6");
    expect(model.hunks[1].lines[0]?.value).toBe("Строка 9");
  });

  it("expands a table group scaffold without changing the exact source diff", () => {
    const before = [
      "| Уровень | ✓ | TW | SiP | HC |",
      "| --- | --- | --- | --- | --- |",
      "| Previous group |",
      "| --- | --- | --- | --- | --- |",
      "| Previous row | [x] | [x] | [x] | [x] |",
      "| --- | --- | --- | --- | --- |",
      "| Goblet of Fire |",
      "| --- | --- | --- | --- | --- |",
      "| The Quidditch World Cup | [x] | [x] | [ ] | [ ] |",
      "| Dragons | [x] | [x] | [ ] | [ ] |",
      "| The First Task | [ ] | [ ] | [ ] | [ ] |",
    ].join("\n");
    const after = before.replace(
      "| The First Task | [ ] | [ ] | [ ] | [ ] |",
      "| The First Task | [x] | [ ] | [ ] | [ ] |",
    );
    const model = createMarkdownDiff(before, after);

    expect(model.hunks[0]?.lines.slice(0, 3).map((line) => line.value)).toEqual([
      "| --- | --- | --- | --- | --- |",
      "| Goblet of Fire |",
      "| --- | --- | --- | --- | --- |",
    ]);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it.each([
    {
      name: "a multi-cell title",
      frame: "| --- | --- | --- | --- | --- |",
      title: "| Not a group | |",
      closing: "| --- | --- | --- | --- | --- |",
    },
    {
      name: "delimiters with the wrong column count",
      frame: "| --- | --- |",
      title: "| Not a group |",
      closing: "| --- | --- |",
    },
  ])("does not expand a false group scaffold with $name", ({ frame, title, closing }) => {
    const before = [
      "| A | B | C | D | E |",
      "| --- | --- | --- | --- | --- |",
      "| Ordinary row | 1 | 2 | 3 | 4 |",
      frame,
      title,
      closing,
      "| Row A | 1 | 2 | 3 | 4 |",
      "| Row B | 1 | 2 | 3 | 4 |",
      "| Target | old | 2 | 3 | 4 |",
    ].join("\n");
    const after = before.replace("| Target | old |", "| Target | new |");
    const model = createMarkdownDiff(before, after);

    expect(model.hunks[0]?.lines[0]?.value).toBe(closing);
    expect(model.hunks[0]?.lines.map((line) => line.value)).not.toContain(title);
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("slices a shared paragraph fragment to each distant hunk window", () => {
    const before = Array.from({ length: 20 }, (_, index) => `Строка ${index + 1}`).join("\n");
    const afterLines = before.split("\n");
    afterLines[2] = "Изменена строка 3";
    afterLines[17] = "Изменена строка 18";
    const after = afterLines.join("\n");
    const model = createMarkdownDiff(before, after);

    expect(model.hunks).toHaveLength(2);
    for (const hunk of model.hunks) {
      const hunkLineIds = new Set(hunk.lines.map((line) => line.id));
      expect(hunk.fragments.every((fragment) =>
        fragment.sourceLineIds.every((lineId) => hunkLineIds.has(lineId)),
      )).toBe(true);
      expect(hunk.fragments.flatMap((fragment) => [fragment.before?.markdown, fragment.after?.markdown]))
        .not.toContain(expect.stringContaining("Строка 10"));
    }
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("uses the parser's table delimiter rather than a delimiter-shaped body row for a hunk prologue", () => {
    const before = [
      "| Real A | Real B |",
      "| --- | --- |",
      "| Start | value |",
      "| Fake A | Fake B |",
      "| --- | --- |",
      ...Array.from({ length: 8 }, (_, index) => `| Row ${index + 1} | old |`),
    ].join("\n");
    const after = before.replace("| Row 7 | old |", "| Row 7 | new |");
    const model = createMarkdownDiff(before, after);

    expect(model.hunks[0]?.structuralPrologue?.before.markdown).toBe(
      "| Real A | Real B |\n| --- | --- |\n",
    );
    expect(model.hunks[0]?.structuralPrologue?.after.markdown).toBe(
      "| Real A | Real B |\n| --- | --- |\n",
    );
    expect(reconstructBefore(model.lines)).toBe(before);
    expect(reconstructAfter(model.lines)).toBe(after);
  });

  it("summarizes task and heading changes deterministically", () => {
    expect(
      summarizeMarkdownDiff(createMarkdownDiff("## Старое\n- [ ] A", "## Новое\n- [x] A")),
    ).toMatch(/Отмечен 1 пункт|раздел/);
  });

  it.each([
    ["[ ]", "[x]", "Отмечено 1 пункт"],
    ["[x]", "[ ]", "Снята отметка с 1 пункта"],
    ["[ ]", "[-]", "Частично отмечено 1 пункт"],
    ["[-]", "[ ]", "Снята частичная отметка с 1 пункта"],
    ["[x]", "[-]", "Отмечено частично вместо выполненного 1 пункт"],
    ["[-]", "[x]", "Выполнено вместо частично отмеченного 1 пункт"],
  ])("summarizes the ordered task transition %s → %s", (beforeMarker, afterMarker, summary) => {
    expect(summarizeMarkdownDiff(createMarkdownDiff(`- ${beforeMarker} A`, `- ${afterMarker} A`))).toBe(summary);
  });

  it("summarizes an indeterminate table-cell transition as task progress", () => {
    const before = "| Name | Done |\n| --- | --- |\n| Tower | [-] |";
    const after = "| Name | Done |\n| --- | --- |\n| Tower | [x] |";

    expect(summarizeMarkdownDiff(createMarkdownDiff(before, after))).toBe(
      "Выполнено вместо частично отмеченного 1 пункт",
    );
  });

  it.each([
    ["| Task | Note |\n| --- | --- |\n| [ ] A | stable |", "| Task | Note |\n| --- | --- |\n| [-] A | stable |"],
    ["| Task |\n| --- |\n| [ ] |", "| Task |\n| --- |\n| [-] |"],
  ])("pairs a first-column or marker-only table task as one modified row", (before, after) => {
    const model = createMarkdownDiff(before, after);

    expect(model.fragments.filter((fragment) => fragment.blockType === "tableRow" && fragment.kind === "modified")).toHaveLength(1);
    expect(summarizeMarkdownDiff(model)).toBe("Частично отмечено 1 пункт");
  });

  it.each([
    ["[ ]", "[x]", "Отмечено 1 пункт"],
    ["[x]", "[-]", "Отмечено частично вместо выполненного 1 пункт"],
    ["[-]", "[ ]", "Снята частичная отметка с 1 пункта"],
  ])("pairs a marker-only list transition %s → %s", (beforeMarker, afterMarker, summary) => {
    const model = createMarkdownDiff(`- ${beforeMarker}`, `- ${afterMarker}`);

    expect(model.fragments).toContainEqual(expect.objectContaining({ blockType: "listItem", kind: "modified" }));
    expect(summarizeMarkdownDiff(model)).toBe(summary);
  });

  it("recognizes tab-separated list task markers when pairing a transition", () => {
    const model = createMarkdownDiff("-\t[ ] Tab task", "-\t[-] Tab task");

    expect(model.fragments).toContainEqual(expect.objectContaining({ blockType: "listItem", kind: "modified" }));
    expect(summarizeMarkdownDiff(model)).toBe("Частично отмечено 1 пункт");
  });

  it("counts only same-column task transitions in multi-task table rows", () => {
    const before = "| Name | A | B |\n| --- | --- | --- |\n| Row | [ ] First | [x] Second |";
    const after = "| Name | A | B |\n| --- | --- | --- |\n| Row | [x] First | [x] Second |";

    expect(summarizeMarkdownDiff(createMarkdownDiff(before, after))).toBe("Отмечено 1 пункт");
  });

  it("does not summarize pipe-delimited prose or moved table tasks as in-place transitions", () => {
    const prose = createMarkdownDiff("Alpha | [ ] prose", "Alpha | [-] prose");
    const moved = createMarkdownDiff(
      "| Name | A | B |\n| --- | --- | --- |\n| Row | [ ] One | text |",
      "| Name | A | B |\n| --- | --- | --- |\n| Row | text | [x] One |",
    );

    expect(summarizeMarkdownDiff(prose)).toBe("Изменено 1 фрагмент текста");
    expect(summarizeMarkdownDiff(moved)).not.toMatch(/Отмечено|Выполнено|частично/u);
  });

  it("keeps all inserted Замки lines before one context ellipsis", () => {
    const model = createMarkdownDiff(LEGO_LOCKS_BEFORE, LEGO_LOCKS_AFTER);
    const inserted = model.lines.filter((line) => line.kind === "added").map((line) => line.value);
    const ellipsis = model.lines.filter((line) => line.value === "- [ ] ...");

    expect(inserted).toEqual([
      "- [ ] Класс Трансфигурации",
      "- [ ] Гостинная Пуфендуй",
      "- [ ] Ванный коридор - сверху",
      "- [ ] Ванный коридор - вход в женскую ванную",
      "- [ ] Вход в гостинную Слизерин - люки",
    ]);
    expect(ellipsis).toEqual([expect.objectContaining({ kind: "context" })]);
    expect(model.lines.indexOf(ellipsis[0])).toBeGreaterThan(
      model.lines.findLastIndex((line) => line.kind === "added"),
    );
    expect(reconstructBefore(model.lines)).toBe(LEGO_LOCKS_BEFORE);
    expect(reconstructAfter(model.lines)).toBe(LEGO_LOCKS_AFTER);
  });
});
