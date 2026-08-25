import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MarkdownDiffPreview } from "../src/components";
import { createMarkdownDiff, type MarkdownDiffModel } from "../src/domain";
import {
  LEGO_PARCELS_AFTER,
  LEGO_PARCELS_BEFORE,
} from "./fixtures/lego-harry-potter-98c11c1c";

describe("compact Markdown diff preview", () => {
  it("opens rendered, toggles only itself to exact source, and shows no service markers", async () => {
    const user = userEvent.setup();
    const first = createMarkdownDiff(LEGO_PARCELS_BEFORE, LEGO_PARCELS_AFTER);
    const second = createMarkdownDiff("## Другое\nСтарое", "## Другое\nНовое");
    render(<><MarkdownDiffPreview model={first} /><MarkdownDiffPreview model={second} /></>);

    expect(screen.getAllByRole("button", { name: "Показать исходник" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Показать исходник" })[0]);

    expect(screen.getByText("- [x] Опушка")).toHaveAttribute("data-diff-kind", "added");
    expect(screen.getAllByRole("button", { name: "Показать исходник" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Показать как выглядит" })).toBeInTheDocument();
    expect(screen.queryByText(/^\+|^−|^~/)).not.toBeInTheDocument();
  });

  it("shows the full first useful hunk up to twelve rows and expands in the current mode", async () => {
    const user = userEvent.setup();
    const after = Array.from({ length: 18 }, (_, index) => `- Пункт ${index + 1}`).join("\n");
    const longModel = createMarkdownDiff("", after);
    render(<MarkdownDiffPreview model={longModel} />);

    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(12);
    await user.click(screen.getByRole("button", { name: "Весь diff · ещё 6" }));
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(18);

    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(18);
  });

  it("marks omitted content between expanded hunks in rendered and source modes", async () => {
    const user = userEvent.setup();
    const context = Array.from({ length: 12 }, (_, index) => `Контекст ${index + 1}`);
    const before = ["## Начало", "Старое начало", ...context, "## Конец", "Старый конец"].join("\n");
    const after = before
      .replace("Старое начало", "Новое начало")
      .replace("Старый конец", "Новый конец");
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.queryByRole("separator", { name: "Пропущено 7 строк" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(6);
    await user.click(screen.getByRole("button", { name: "Весь diff · ещё 5" }));
    const renderedSeparator = screen.getByRole("separator", { name: "Пропущено 7 строк" });
    expect(renderedSeparator.closest(".markdown-diff-rendered")).toBeNull();
    expect(renderedSeparator.previousElementSibling).toHaveClass("markdown-diff-rendered");
    expect(renderedSeparator.nextElementSibling).toHaveClass("markdown-diff-rendered");
    expect(renderedSeparator).toHaveTextContent(/^Пропущено 7 строк$/u);
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(11);

    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    const sourceSeparator = screen.getByRole("separator", { name: "Пропущено 7 строк" });
    expect(sourceSeparator.closest("pre")).toBeNull();
    expect(sourceSeparator.previousElementSibling?.tagName).toBe("PRE");
    expect(sourceSeparator.nextElementSibling?.tagName).toBe("PRE");
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(11);
  });

  it.each([
    [7, "Пропущена 1 строка"],
    [8, "Пропущены 2 строки"],
    [11, "Пропущено 5 строк"],
    [17, "Пропущено 11 строк"],
    [27, "Пропущена 21 строка"],
  ])("labels a %i-line context gap with the omitted line count", async (contextLength, label) => {
    const user = userEvent.setup();
    const context = Array.from({ length: contextLength }, (_, index) => `Контекст ${index + 1}`);
    const before = ["Старое начало", ...context, "Старый конец"].join("\n");
    const after = before
      .replace("Старое начало", "Новое начало")
      .replace("Старый конец", "Новый конец");
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    await user.click(screen.getByRole("button", { name: /Весь diff/u }));
    expect(screen.getByRole("separator", { name: label })).toHaveTextContent(label);
  });

  it("renders created and deleted note content instead of an empty side", () => {
    render(
      <>
        <MarkdownDiffPreview model={createMarkdownDiff("", "## Создано\nНовый текст")} />
        <MarkdownDiffPreview model={createMarkdownDiff("## Удалено\nСтарый текст", "")} />
      </>,
    );

    expect(screen.getByText("Создано").closest("h3")).not.toBeNull();
    expect(screen.getByText("Новый текст")).toBeInTheDocument();
    expect(screen.getByText("Удалено", { selector: "h3 span" }).closest("h3")).not.toBeNull();
    expect(screen.getByText("Старый текст")).toBeInTheDocument();
  });

  it("keeps GFM tables structural and decorates only changed inline text", () => {
    const model = createMarkdownDiff(
      "| Этап | Статус |\n| --- | --- |\n| Башня | **Закрыто** |",
      "| Этап | Статус |\n| --- | --- |\n| Башня | **Открыто** |",
    );
    render(<MarkdownDiffPreview model={model} />);

    expect(screen.getAllByRole("table")).toHaveLength(1);
    const opened = screen.getByLabelText("Добавлено: Открыто");
    const strong = opened.closest("strong");
    expect(strong?.closest("td")).not.toBeNull();
    expect(within(strong as HTMLElement).getByLabelText("Удалено: Закрыто")).toHaveTextContent("Закрыто");
    expect(strong).toHaveTextContent("Открыто");
    expect(opened.closest("tr")).toHaveAttribute("data-diff-kind", "modified");
    expect(screen.getByRole("group", { name: "Изменено" })).toContainElement(opened);
  });

  it("does not duplicate context fragments surrounding a changed table", () => {
    const before = "Контекст\n| Этап | Статус |\n| --- | --- |\n| Башня | Закрыто |";
    const after = "Контекст\n| Этап | Статус |\n| --- | --- |\n| Башня | Открыто |";
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getAllByText("Контекст")).toHaveLength(1);
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("renders a deep changed table row with a neutral structural prologue", () => {
    const before = [
      "| Этап | Статус |",
      "| --- | --- |",
      ...Array.from({ length: 10 }, (_, index) => `| Строка ${index + 1} | Закрыто |`),
    ].join("\n");
    const after = before.replace("| Строка 9 | Закрыто |", "| Строка 9 | Открыто |");
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Этап" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Статус" })).toHaveLength(1);
    for (const header of screen.getAllByRole("columnheader", { name: "Этап" })) {
      expect(header.closest("tr")).toHaveAttribute("data-diff-kind", "context");
      expect(header.closest("tr")).not.toHaveAttribute("aria-label");
    }
    const opened = screen.getByLabelText("Добавлено: Открыто");
    expect(opened.closest("tr")).toHaveAttribute("data-diff-kind", "modified");
    expect(screen.getAllByText("Строка 6")).toHaveLength(1);
    expect(screen.getAllByText("Строка 10")).toHaveLength(1);
  });

  it("renders a changed table checkbox once with both states", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "| Зона | Проверено |\n| --- | --- |\n| Коридор | [ ] Освещение |",
          "| Зона | Проверено |\n| --- | --- |\n| Коридор | [x] Освещение |",
        )}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Освещение")).toHaveLength(1);
    expect(within(table).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(table).getByRole("checkbox", { name: "Было не отмечено" })).not.toBeChecked();
    expect(within(table).getByRole("checkbox", { name: "Стало отмечено" })).toBeChecked();
  });

  it("keeps unrelated removed and added table rows in one table", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "| Зона | Деталь |\n| --- | --- |\n| Холл | Картина |\n| Удаляемый коридор | Факел |\n| Башня | Ключ |",
          "| Зона | Деталь |\n| --- | --- |\n| Холл | Картина |\n| Новый балкон | Стражник |\n| Башня | Ключ |",
        )}
      />,
    );

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText("Удаляемый коридор").closest("tr")).toHaveAttribute("data-diff-kind", "removed");
    expect(screen.getByText("Новый балкон").closest("tr")).toHaveAttribute("data-diff-kind", "added");
    expect(screen.getAllByText("Холл")).toHaveLength(1);
    expect(screen.getAllByText("Башня")).toHaveLength(1);
  });

  it("falls back to separate red and green tables for an incompatible schema", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "| Зона | Статус |\n| --- | --- |\n| Коридор | Закрыт |",
          "| Зона | Статус | Деталь |\n| --- | --- | --- |\n| Коридор | Открыт | Картина |",
        )}
      />,
    );

    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diff-visual-row").some((row) => row.dataset.diffKind === "removed")).toBe(true);
    expect(screen.getAllByTestId("diff-visual-row").some((row) => row.dataset.diffKind === "added")).toBe(true);
  });

  it("keeps red and green evidence when only a table delimiter changes", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "| Зона | Статус |\n| --- | --- |\n| Коридор | Открыт |",
          "| Зона | Статус |\n| :--- | ---: |\n| Коридор | Открыт |",
        )}
      />,
    );

    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
    const rows = screen.getAllByTestId("diff-visual-row");
    expect(rows.some((row) => row.dataset.diffKind === "removed")).toBe(true);
    expect(rows.some((row) => row.dataset.diffKind === "added")).toBe(true);
  });

  it.each([
    {
      after: "| Этап | Статус |\n| --- | --- |\n| Альфа | Готово |\n| Бета | Добавлено |\n",
      before: "| Этап | Статус |\n| --- | --- |\n| Альфа | Готово |\n",
      changed: "Добавлено",
      kind: "added",
      label: "Добавлено",
    },
    {
      after: "| Этап | Статус |\n| --- | --- |\n| Альфа | Готово |\n",
      before: "| Этап | Статус |\n| --- | --- |\n| Альфа | Готово |\n| Бета | Удалено |\n",
      changed: "Удалено",
      kind: "removed",
      label: "Удалено",
    },
  ])("keeps table headers and unchanged rows neutral for a row-only $kind", ({ after, before, changed, kind, label }) => {
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    const header = screen.getByRole("columnheader", { name: "Этап" });
    const side = header.closest(".markdown-diff-rendered-side");
    expect(side).toHaveAttribute("data-diff-kind", "context");
    expect(side).not.toHaveAttribute("aria-label");
    expect(screen.getByText("Готово").closest("tr")).toHaveAttribute("data-diff-kind", "context");
    expect(screen.getByText(changed).closest("tr")).toHaveAttribute("data-diff-kind", kind);
    expect(screen.getByText(changed).closest("tr")).toHaveAccessibleName(`${label}: Бета | ${changed}`);
  });

  it.each([
    ["paragraph", Array.from({ length: 18 }, (_, index) => `Строка ${index + 1}`).join("\n")],
    ["list item", ["- Большой пункт", ...Array.from({ length: 17 }, (_, index) => `  продолжение ${index + 1}`)].join("\n")],
    ["table", ["| Этап |", "| --- |", ...Array.from({ length: 17 }, (_, index) => `| Строка ${index + 1} |`)].join("\n")],
  ])("budgets a large rendered %s by visual rows and expands structurally", async (_label, after) => {
    const user = userEvent.setup();
    render(<MarkdownDiffPreview model={createMarkdownDiff("", after)} />);

    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(12);
    expect(screen.getByRole("button", { name: /Весь diff · ещё 6/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Весь diff/ }));
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(18);
    if (_label === "table") expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("keeps a paired multiline structural modification whole at the source boundary", async () => {
    const user = userEvent.setup();
    const before = "Контекст 1\nКонтекст 2\nКонтекст 3\n- Старый\n  деталь старая";
    const after = "Контекст 1\nКонтекст 2\nКонтекст 3\n- Новый\n  деталь новая";
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} previewRows={6} />);

    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    const rows = screen.getAllByTestId("diff-visual-row");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).not.toContain("Контекст 3");
    expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      "- Старый",
      "  деталь старая",
      "- Новый",
      "  деталь новая",
    ]));
  });

  it("preserves source whitespace and exposes changed-line labels without marker characters", async () => {
    const user = userEvent.setup();
    const model = createMarkdownDiff("Текст\n  старая\tстрока", "Текст\n  новая\tстрока");
    render(<MarkdownDiffPreview model={model} />);

    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    const rows = screen.getAllByTestId("diff-visual-row");
    expect(rows.map((row) => row.textContent)).toContain("  старая\tстрока");
    expect(rows.map((row) => row.textContent)).toContain("  новая\tстрока");
    expect(screen.getByLabelText(/^Удалено:/u, { selector: "[data-diff-kind='removed']" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Добавлено:/u, { selector: "[data-diff-kind='added']" })).toBeInTheDocument();
    expect(rows.every((row) => !/^[+−~]/u.test(row.textContent ?? ""))).toBe(true);
  });

  it("includes rendered inline evidence in the computed accessible name", () => {
    const { container } = render(
      <MarkdownDiffPreview model={createMarkdownDiff("", "Новое доказательство")} />,
    );

    const inline = container.querySelector<HTMLElement>(".markdown-diff-inline--added");
    expect(inline).not.toBeNull();
    expect(inline).toHaveTextContent("Новое доказательство");
    expect(inline).toHaveAccessibleName("Добавлено: Новое доказательство");
  });

  it("includes exact source-row evidence in the computed accessible name", async () => {
    const user = userEvent.setup();
    render(<MarkdownDiffPreview model={createMarkdownDiff("", "Новая исходная строка")} />);

    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    const row = screen.getByTestId("diff-visual-row");
    expect(row).toHaveTextContent("Новая исходная строка");
    expect(row).toHaveAccessibleName("Добавлено: Новая исходная строка");
  });

  it("renders a safe local text replacement once as an inline modification", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Коридор освещают три факела вдоль стены.",
          "Коридор освещают четыре факела вдоль стены.",
        )}
      />,
    );

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getByText("три").closest("del")).not.toBeNull();
    expect(within(modified).getByText("четыре").closest("ins")).not.toBeNull();
    expect(within(modified).getByLabelText("Удалено: три")).toBeInTheDocument();
    expect(within(modified).getByLabelText("Добавлено: четыре")).toBeInTheDocument();
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Удалено" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Добавлено" })).not.toBeInTheDocument();
  });

  it.each([
    {
      after: "Коридор освещают яркие факелы.",
      before: "Коридор освещают факелы.",
      label: /^Добавлено: яркие/u,
      missingElement: "del",
    },
    {
      after: "Коридор освещают факелы.",
      before: "Коридор освещают яркие факелы.",
      label: /^Удалено: яркие/u,
      missingElement: "ins",
    },
  ])("renders a local insertion or removal without an arrow", ({ after, before, label, missingElement }) => {
    const { container } = render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getByLabelText(label)).toBeInTheDocument();
    expect(within(modified).queryByText("→")).not.toBeInTheDocument();
    expect(container.querySelector(missingElement)).toBeNull();
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(1);
  });

  it("keeps link structure while changing its visible label inline", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Открыть [старую карту](https://example.com/map) коридора.",
          "Открыть [новую карту](https://example.com/map) коридора.",
        )}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com/map");
    expect(within(link).getByLabelText("Удалено: старую")).toBeInTheDocument();
    expect(within(link).getByLabelText("Добавлено: новую")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders every fully paired physical line as one yellow row", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Первый зал освещают три факела.\nВторой зал освещают три свечи.",
          "Первый зал освещают четыре факела.\nВторой зал освещают четыре свечи.",
        )}
      />,
    );

    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(2);
    expect(screen.getAllByTestId("diff-visual-row").every((row) => row.dataset.diffKind === "modified")).toBe(true);
    expect(screen.getAllByLabelText("Удалено: три")).toHaveLength(2);
    expect(screen.getAllByLabelText("Добавлено: четыре")).toHaveLength(2);
  });

  it("keeps a multiline yellow fragment whole when its row budget is one", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Первый зал освещают три факела.\nВторой зал освещают три свечи.",
          "Первый зал освещают четыре факела.\nВторой зал освещают четыре свечи.",
        )}
        previewRows={1}
      />,
    );

    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(2);
    expect(screen.getAllByLabelText("Добавлено: четыре")).toHaveLength(2);
  });

  it("does not let a table header hide the modified row at a one-row budget", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "| Этап | Статус |\n| --- | --- |\n| Башня | Закрыто |",
          "| Этап | Статус |\n| --- | --- |\n| Башня | Открыто |",
        )}
        previewRows={1}
      />,
    );

    expect(screen.getByLabelText("Удалено: Закрыто")).toBeInTheDocument();
    expect(screen.getByLabelText("Добавлено: Открыто")).toBeInTheDocument();
    expect(screen.getByText("Башня").closest("tr")).toHaveAttribute("data-diff-kind", "modified");
  });

  it("keeps a mixed modified table compact without hiding its yellow row", () => {
    const addedRows = Array.from({ length: 8 }, (_, index) => `| Новая ${index + 1} | Добавлено |`).join("\n");
    const contextRows = "| Контекст 1 | Да |\n| Контекст 2 | Да |\n| Контекст 3 | Да |";
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          `| Этап | Статус |\n| --- | --- |\n| Целевая башня в дальнем коридоре | Статус закрыт до вечера |\n${contextRows}\n| Финал | Да |`,
          `| Этап | Статус |\n| --- | --- |\n| Целевая башня в дальнем коридоре | Статус открыт до вечера |\n${contextRows}\n${addedRows}\n| Финал | Да |`,
        )}
        previewRows={3}
      />,
    );

    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(3);
    expect(screen.getByLabelText("Добавлено: открыт")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Весь diff/u })).toBeInTheDocument();
  });

  it("keeps a modified grouped table atomic when its budget is too small", () => {
    const before = "| Этап | Статус |\n| --- | --- |\n| Секция коридора |\n| --- | --- |\n| Дальний проход | [ ] Проверено |";
    const after = "| Этап | Статус |\n| --- | --- |\n| Секция коридора |\n| --- | --- |\n| Дальний проход | [x] Проверено |";
    const lines: MarkdownDiffModel["lines"] = [
      { id: "header", kind: "context", value: "| Этап | Статус |", eol: "\n", beforeLine: 1, afterLine: 1 },
      { id: "delimiter", kind: "context", value: "| --- | --- |", eol: "\n", beforeLine: 2, afterLine: 2 },
      { id: "group", kind: "context", value: "| Секция коридора |", eol: "\n", beforeLine: 3, afterLine: 3 },
      { id: "group-delimiter", kind: "context", value: "| --- | --- |", eol: "\n", beforeLine: 4, afterLine: 4 },
      { id: "old-row", kind: "removed", value: "| Дальний проход | [ ] Проверено |", eol: "", beforeLine: 5, afterLine: null, pairId: "pair:row" },
      { id: "new-row", kind: "added", value: "| Дальний проход | [x] Проверено |", eol: "", beforeLine: null, afterLine: 5, pairId: "pair:row" },
    ];
    const fragments: MarkdownDiffModel["fragments"] = [
      ...lines.slice(0, 4).map((line, index) => ({
        id: `context:${index}`,
        blockType: index % 2 === 0 ? "tableRow" as const : "table" as const,
        kind: "context" as const,
        before: { markdown: line.value, decorations: [] },
        after: { markdown: line.value, decorations: [] },
        sourceLineIds: [line.id],
      })),
      {
        id: "modified-row",
        blockType: "tableRow",
        kind: "modified",
        before: { markdown: lines[4].value, decorations: [] },
        after: { markdown: lines[5].value, decorations: [] },
        sourceLineIds: ["old-row", "new-row"],
      },
    ];
    const model: MarkdownDiffModel = {
      before,
      after,
      fallbacks: [],
      fragments,
      hunks: [{ id: "grouped-table", fragments, lines }],
      lines,
      renderable: true,
    };

    render(
      <MarkdownDiffPreview
        model={model}
        previewRows={1}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Было не отмечено" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Стало отмечено" })).toBeChecked();
    expect(screen.getByText("Дальний проход").closest("tr")).toHaveAttribute("data-diff-kind", "modified");
  });

  it("preserves an internal table group when its diff hunk starts at the framing delimiter", () => {
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
    ].join("\n");
    const after = before.replace(
      "| The Quidditch World Cup | [x] | [x] | [ ] | [ ] |",
      "| The Quidditch World Cup | [x] | [x] | [x] | [ ] |",
    );

    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getByText("Goblet of Fire").closest("th")).toHaveAttribute("colspan", "5");
    expect(screen.queryByText(/^[-:]+$/u)).not.toBeInTheDocument();
    expect(screen.getByText("The Quidditch World Cup").closest("tr")).toHaveAttribute(
      "data-diff-kind",
      "modified",
    );
  });

  it("keeps a complete group header when only its trailing delimiter enters hunk context", () => {
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
      "| Secret of the Egg | [ ] | [ ] | [ ] | [ ] |",
    ].join("\n");
    const after = before.replace(
      "| The First Task | [ ] | [ ] | [ ] | [ ] |",
      "| The First Task | [x] | [ ] | [ ] | [ ] |",
    );

    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getByText("Goblet of Fire").closest("th")).toHaveAttribute("colspan", "5");
    expect(screen.getByText("The First Task").closest("tr")).toHaveAttribute("data-diff-kind", "modified");
    expect(screen.queryByText(/^[-:]+$/u)).not.toBeInTheDocument();
  });

  it("keeps the table header when its delimiter is the first hunk context line", () => {
    const before = [
      "| Уровень | ✓ | TW | SiP | HC |",
      "| --- | --- | --- | --- | --- |",
      "| Philosopher's Stone |",
      "| --- | --- | --- | --- | --- |",
      "| The Magic Begins | [x] | [x] | [x] | [ ] |",
      "| Out of the Dungeon | [x] | [x] | [x] | [ ] |",
      "| A Jinxed Broom | [x] | [x] | [ ] | [ ] |",
      "| The Restricted Section | [x] | [x] | [ ] | [ ] |",
    ].join("\n");
    const after = before.replace(
      "| The Magic Begins | [x] | [x] | [x] | [ ] |",
      "| The Magic Begins | [x] | [x] | [x] | [x] |",
    );

    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("columnheader", { name: "Уровень" })).toBeInTheDocument();
    expect(screen.getByText("Philosopher's Stone").closest("th")).toHaveAttribute("colspan", "5");
    expect(screen.getByText("The Magic Begins").closest("tr")).toHaveAttribute("data-diff-kind", "modified");
  });

  it("preserves an internal table group in a red-green fallback", () => {
    const before = [
      "| Уровень | Ссылка | TW | SiP | HC |",
      "| --- | --- | --- | --- | --- |",
      "| Previous group |",
      "| --- | --- | --- | --- | --- |",
      "| Previous row | [карта](https://example.com/previous) | [x] | [x] | [x] |",
      "| --- | --- | --- | --- | --- |",
      "| Goblet of Fire |",
      "| --- | --- | --- | --- | --- |",
      "| The Quidditch World Cup | [карта](https://example.com/old) | [x] | [ ] | [ ] |",
      "| Dragons | [карта](https://example.com/dragons) | [x] | [ ] | [ ] |",
    ].join("\n");
    const after = before.replace("https://example.com/old", "https://example.com/new");

    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getAllByRole("table")).toHaveLength(2);
    const groupTitles = screen.getAllByText("Goblet of Fire");
    expect(groupTitles).toHaveLength(2);
    expect(groupTitles.every((title) => title.closest("th")?.colSpan === 5)).toBe(true);
    expect(screen.queryByText(/^[-:]+$/u)).not.toBeInTheDocument();
  });

  it("falls back the whole multiline paragraph when one physical line is unpaired", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Первая строка содержит старое слово и длинный общий контекст.\nВторая старая часть совсем другая.",
          "Первая строка содержит новое слово и длинный общий контекст.\nБананы, башни, ключи и факелы.",
        )}
      />,
    );

    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
    const removed = screen.getByRole("group", { name: "Удалено" });
    const added = screen.getByRole("group", { name: "Добавлено" });
    expect(removed).toHaveTextContent("Первая строка содержит старое слово");
    expect(removed).toHaveTextContent("Вторая старая часть совсем другая");
    expect(added).toHaveTextContent("Первая строка содержит новое слово");
    expect(added).toHaveTextContent("Бананы, башни, ключи и факелы");
  });

  it("keeps source mode exact red and green after a rendered inline change", async () => {
    const user = userEvent.setup();
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Коридор освещают три факела.",
          "Коридор освещают четыре факела.",
        )}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    const rows = screen.getAllByTestId("diff-visual-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.dataset.diffKind)).toEqual(["removed", "added"]);
    expect(rows.some((row) => row.dataset.diffKind === "modified")).toBe(false);
  });

  it("renders a checklist toggle as two disabled checkboxes and one label", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "- [ ] Внешний коридор (картина слева)",
          "- [x] Внешний коридор (картина слева)",
        )}
      />,
    );

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(modified).getAllByText("Внешний коридор (картина слева)")).toHaveLength(1);
    expect(within(modified).getByRole("checkbox", { name: "Было не отмечено" })).not.toBeChecked();
    expect(within(modified).getByRole("checkbox", { name: "Стало отмечено" })).toBeChecked();
    expect(
      within(modified).getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("renders an indeterminate checklist diff state as a disabled mixed checkbox", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "- [ ] Внешний коридор (картина слева)",
          "- [-] Внешний коридор (картина слева)",
        )}
      />,
    );

    const modified = screen.getByRole("group", { name: "Изменено" });
    const before = within(modified).getByRole("checkbox", { name: "Было не отмечено" });
    const after = within(modified).getByRole("checkbox", { name: "Стало частично отмечено" });
    expect(before).toBeDisabled();
    expect(after).toBeDisabled();
    expect(after).toHaveAttribute("aria-checked", "mixed");
    expect(after).toHaveClass("markdown-task-checkbox--indeterminate");
  });

  it.each([
    ["| Task | Note |\n| --- | --- |\n| [ ] A | stable |", "| Task | Note |\n| --- | --- |\n| [-] A | stable |"],
    ["| Task |\n| --- |\n| [ ] |", "| Task |\n| --- |\n| [-] |"],
  ])("renders paired mixed controls for a first-column or marker-only table task", (before, after) => {
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getByRole("checkbox", { name: "Было не отмечено" })).toBeDisabled();
    expect(within(modified).getByRole("checkbox", { name: "Стало частично отмечено" })).toHaveAttribute("aria-checked", "mixed");
  });

  it("keeps a checklist state and text change in one yellow row", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "- [ ] Внешний коридор (картина слева)",
          "- [x] Внешний коридор (факел слева)",
        )}
      />,
    );

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(modified).getByLabelText("Удалено: картина")).toBeInTheDocument();
    expect(within(modified).getByLabelText("Добавлено: факел")).toBeInTheDocument();
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(1);
  });

  it("falls back to red and green rendered sides when only a link target changes", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff(
          "Открыть [карту](https://example.com/old) коридора.",
          "Открыть [карту](https://example.com/new) коридора.",
        )}
      />,
    );

    expect(screen.getByRole("group", { name: "Удалено" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Добавлено" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
  });

  it("falls back when a paragraph changes only trimmed layout whitespace", () => {
    render(<MarkdownDiffPreview model={createMarkdownDiff("  Text", " Text")} />);

    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Удалено" })).toHaveTextContent("Text");
    expect(screen.getByRole("group", { name: "Добавлено" })).toHaveTextContent("Text");
  });

  it("falls back when a paragraph changes only trimmed Unicode whitespace", () => {
    render(<MarkdownDiffPreview model={createMarkdownDiff("\u00a0\u00a0Text", "\u00a0Text")} />);

    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Удалено" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Добавлено" })).toBeInTheDocument();
  });

  it("falls back when a heading marker changes", () => {
    render(<MarkdownDiffPreview model={createMarkdownDiff("## Коридор", "### Коридор")} />);

    expect(screen.queryByRole("group", { name: "Изменено" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Удалено" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Добавлено" })).toBeInTheDocument();
  });

  it("keeps both inline values of a modification when the preview budget is one row", () => {
    render(
      <MarkdownDiffPreview
        model={createMarkdownDiff("Старое значение", "Новое значение")}
        previewRows={1}
      />,
    );

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getByLabelText("Удалено: Старое")).toHaveTextContent("Старое");
    expect(within(modified).getByLabelText("Добавлено: Новое")).toHaveTextContent("Новое");
    expect(screen.queryByText("Текста пока нет")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(1);
  });

  it("displaces earlier complete context before starving an inline modification at the default budget", () => {
    const added = Array.from({ length: 10 }, (_, index) => `- Добавлено ${index + 1}`).join("\n");
    const model = createMarkdownDiff(
      "## Детали\nСтарое значение",
      `${added}\n## Детали\nНовое значение`,
    );
    render(<MarkdownDiffPreview model={model} />);

    const modified = screen.getByRole("group", { name: "Изменено" });
    expect(within(modified).getByLabelText("Удалено: Старое")).toHaveTextContent("Старое");
    expect(within(modified).getByLabelText("Добавлено: Новое")).toHaveTextContent("Новое");
    expect(screen.queryByText("Текста пока нет")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(12);
  });

  it("falls back only the untrusted note to source with an explanation", () => {
    const safe = createMarkdownDiff("## Надёжно\nДо", "## Надёжно\nПосле");
    const fallback: MarkdownDiffModel = {
      ...createMarkdownDiff("## Ненадёжно\nДо", "## Ненадёжно\nПосле"),
      fallbacks: [{ blockType: "heading", reason: "ambiguous-anchor" }],
      renderable: false,
    };
    render(<><MarkdownDiffPreview model={fallback} /><MarkdownDiffPreview model={safe} /></>);

    const fallbackPreview = screen.getByText("Показан точный исходник: эту заметку нельзя надёжно отобразить.").closest(".markdown-diff-preview");
    expect(fallbackPreview).not.toBeNull();
    expect(within(fallbackPreview as HTMLElement).queryByRole("button", { name: /Показать/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать исходник" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Надёжно" })).toBeInTheDocument();
  });
});
