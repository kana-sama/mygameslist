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

  it("summarizes task and heading changes deterministically", () => {
    expect(
      summarizeMarkdownDiff(createMarkdownDiff("## Старое\n- [ ] A", "## Новое\n- [x] A")),
    ).toMatch(/Отмечен 1 пункт|раздел/);
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
