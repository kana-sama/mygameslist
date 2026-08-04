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

    expect(screen.getAllByRole("table")).toHaveLength(2);
    const opened = screen.getByText((_content, element) => element?.tagName === "STRONG" && element.textContent === "Открыто");
    expect(opened.closest("td")).not.toBeNull();
    expect(within(opened).getByLabelText("Добавлено")).toHaveTextContent("От");
    expect(screen.getByLabelText("Изменено")).toContainElement(opened);
  });

  it("does not duplicate context fragments surrounding a changed table", () => {
    const before = "Контекст\n| Этап | Статус |\n| --- | --- |\n| Башня | Закрыто |";
    const after = "Контекст\n| Этап | Статус |\n| --- | --- |\n| Башня | Открыто |";
    render(<MarkdownDiffPreview model={createMarkdownDiff(before, after)} />);

    expect(screen.getAllByText("Контекст")).toHaveLength(2);
    expect(screen.getAllByRole("table")).toHaveLength(2);
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
    expect(screen.getByText(changed).closest("tr")).toHaveAttribute("aria-label", label);
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
    expect(screen.getByLabelText("Удалено", { selector: "[data-diff-kind='removed']" })).toBeInTheDocument();
    expect(screen.getByLabelText("Добавлено", { selector: "[data-diff-kind='added']" })).toBeInTheDocument();
    expect(rows.every((row) => !/^[+−~]/u.test(row.textContent ?? ""))).toBe(true);
  });

  it("labels both rendered sides of a modified fragment", () => {
    render(<MarkdownDiffPreview model={createMarkdownDiff("Старое значение", "Новое значение")} />);

    expect(screen.getByLabelText("Удалено", { selector: ".markdown-diff-rendered-side" })).toBeInTheDocument();
    expect(screen.getByLabelText("Добавлено", { selector: ".markdown-diff-rendered-side" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Изменено").length).toBeGreaterThan(0);
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
