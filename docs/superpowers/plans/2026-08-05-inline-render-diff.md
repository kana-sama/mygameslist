# Inline Render Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать безопасные локальные Markdown-изменения одной жёлтой inline-строкой в render-mode, сохраняя красно-зелёный exact diff в source-mode.

**Architecture:** Новый чистый presentation-модуль строит render-only units из существующего `MarkdownDiffModel`: after-side служит структурным скелетом для безопасных пар, а неспаренные строки остаются removed/added. `MarkdownView` получает отдельные row, inline и task descriptors и вставляет visual evidence в уже разобранный Markdown; точная доменная модель и source-mode не переписываются.

**Tech Stack:** TypeScript 7, React 19, существующий Markdown renderer, `diff` 9, Vitest 4, Testing Library, CSS.

## Global Constraints

- Красная строка означает удаление, зелёная — добавление, жёлтая — только безопасную inline-правку в render-mode.
- Жёлтая строка допустима только для полной 1:1 пары физических строк; неполный multi-line fragment целиком использует красно-зелёный fallback.
- Source-mode остаётся точным и не получает жёлтых строк.
- Новая сторона является Markdown-скелетом; служебные маркеры не добавляются в Markdown-текст.
- Table hunk объединяется в одну таблицу только при совместимой структуре колонок.
- Similarity threshold `0.72`, ambiguous-anchor rules, reconstruction и publication flow не меняются.
- Спецификация, этот plan, реализация, стили и тесты входят в один итоговый Jujutsu-коммит. До полной проверки `jj describe` и `jj new` не запускаются.
- Для всех repository status, diff и commit операций используется только Jujutsu.

---

### Task 1: Render-only model для обычного текста и multi-line fallback

**Files:**
- Create: `src/components/markdownDiffRenderModel.ts`
- Modify: `src/components/MarkdownDiffPreview.tsx`
- Test: `tests/markdown-diff-preview.test.tsx`

**Interfaces:**
- Consumes: `MarkdownDiffHunk`, `MarkdownDiffFragment`, `SourceDiffLine`, `MarkdownDecoration` из `src/domain/markdownDiff.ts`.
- Produces: `RenderedDiffUnit`, `RenderedDiffSide`, `RenderedRowChange`, `RenderedInlineChange`, `RenderedTaskChange` и `renderedDiffUnits(hunk)`.

- [x] **Step 1: Добавить failing component tests для одной жёлтой строки**

  Добавить тест, который рендерит `createMarkdownDiff("Коридор освещают три факела вдоль стены.", "Коридор освещают четыре факела вдоль стены.")` и проверяет:

  ```tsx
  const modified = screen.getByRole("group", { name: "Изменено" });
  expect(within(modified).getByText("три").closest("del")).not.toBeNull();
  expect(within(modified).getByText("четыре").closest("ins")).not.toBeNull();
  expect(within(modified).getByLabelText("Удалено: три")).toBeInTheDocument();
  expect(within(modified).getByLabelText("Добавлено: четыре")).toBeInTheDocument();
  expect(screen.getAllByTestId("diff-visual-row")).toHaveLength(1);
  expect(screen.queryByRole("group", { name: "Удалено" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Добавлено" })).not.toBeInTheDocument();
  ```

  Добавить отдельные cases для локальной вставки и локального удаления: у них отсутствует стрелка и отсутствующая сторона не создаёт пустой `<del>` или `<ins>`.

- [x] **Step 2: Запустить tests и подтвердить RED**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx`

  Expected: новые assertions падают, потому что текущий render-mode создаёт две стороны и две visual rows.

- [x] **Step 3: Создать типы render-only model**

  В `src/components/markdownDiffRenderModel.ts` определить:

  ```ts
  export interface RenderedInlineChange {
    id: string;
    sourceLine: number;
    startColumn: number;
    endColumn: number;
    removed: string;
    added: string;
  }

  export interface RenderedTaskChange {
    id: string;
    sourceLine: number;
    sourceColumn?: number;
    beforeChecked: boolean;
    afterChecked: boolean;
  }

  export interface RenderedRowChange {
    kind: "added" | "removed" | "modified";
    label: "Добавлено" | "Удалено" | "Изменено";
    sourceLine: number;
  }

  export interface RenderedDiffSide {
    decorations: readonly MarkdownDecoration[];
    inlineChanges: readonly RenderedInlineChange[];
    key: string;
    kind: MarkdownChangeKind;
    label?: "Добавлено" | "Удалено";
    markdown: string;
    rowChanges: readonly RenderedRowChange[];
    taskChanges: readonly RenderedTaskChange[];
    visualRows: number;
  }

  export interface RenderedDiffUnit {
    changed: boolean;
    key: string;
    modified: boolean;
    sides: RenderedDiffSide[];
    visualRows: number;
  }
  ```

- [x] **Step 4: Реализовать безопасные text descriptors**

  Сгруппировать соседние `removed`/`added` части Unicode-aware token diff (`diffArrays`) в один `RenderedInlineChange`. Координаты относятся к after-side. Pure removal использует `startColumn === endColumn`; pure addition имеет пустой `removed`.

  Перед объединением исключать изменения, которые затрагивают невидимую Markdown-структуру: URL/title ссылки, delimiter emphasis/code, table delimiter или list marker. Изменение link label и содержимого emphasis/code допустимо, поскольку их диапазон относится к видимому тексту.

- [x] **Step 5: Реализовать fragment eligibility и fallback**

  Для `modified` fragment найти removed/added lines по общему `pairId`. Merge разрешён только если количество физических строк одинаково, каждая строка имеет ровно одну пару и все text/task descriptors безопасны.

  При merge создать одну after-side с `kind: "modified"`, одной `RenderedRowChange` на каждую физическую строку и `visualRows`, равным числу after rows. При отказе создать две стороны с `kind: "removed"` и `kind: "added"`; жёлтый цвет в fallback не используется.

- [x] **Step 6: Подключить model к `MarkdownDiffPreview`**

  Удалить локальные `RenderedSide`, `RenderedUnit`, `fragmentUnit` и `renderedUnits`, импортировать их аналоги из нового модуля. Передать в `MarkdownView` новые props `rowChanges`, `inlineChanges`, `taskChanges`; truncation должен сохранять descriptors только видимых строк и сдвигать их вместе с Markdown.

- [x] **Step 7: Запустить targeted tests**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx`

  Expected: новые text tests всё ещё падают только на отсутствующем rendering support в `MarkdownView`; существующие source/fallback tests остаются зелёными.

---

### Task 2: Inline evidence и task transitions в `MarkdownView`

**Files:**
- Create: `src/components/markdownInlineSyntax.ts`
- Modify: `src/components/Markdown.tsx`
- Modify: `src/components/MarkdownDiffPreview.tsx`
- Test: `tests/markdown-diff-preview.test.tsx`

**Interfaces:**
- Consumes: `RenderedInlineChange`, `RenderedRowChange`, `RenderedTaskChange` из `markdownDiffRenderModel.ts`.
- Produces: новые optional props `rowChanges`, `inlineChanges`, `taskChanges` у `MarkdownView` и semantic inline/task DOM.

- [x] **Step 1: Добавить failing tests для Markdown structure и checklist toggle**

  Добавить tests:

  ```tsx
  render(<MarkdownDiffPreview model={createMarkdownDiff(
    "- [ ] Внешний коридор (картина слева)",
    "- [x] Внешний коридор (картина слева)",
  )} />);

  const row = screen.getByRole("group", { name: "Изменено" });
  expect(within(row).getAllByRole("checkbox")).toHaveLength(2);
  expect(within(row).getAllByText("Внешний коридор (картина слева)")).toHaveLength(1);
  expect(within(row).getByRole("checkbox", { name: "Было не отмечено" })).not.toBeChecked();
  expect(within(row).getByRole("checkbox", { name: "Стало отмечено" })).toBeChecked();
  expect(within(row).getAllByRole("checkbox").every((checkbox) => checkbox.hasAttribute("disabled"))).toBe(true);
  ```

  Добавить case `**старое** → **новое**`, который сохраняет один `<strong>`, и link-label case, который сохраняет один `<a>` с исходным href. Добавить URL-change case, который получает две красно-зелёные стороны.

- [x] **Step 2: Запустить tests и подтвердить RED**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx`

  Expected: text model может дать жёлтую unit, но `MarkdownView` ещё не создаёт `<del>`, `<ins>` и двойной checkbox.

- [x] **Step 3: Вынести общую inline tokenization**

  В `markdownInlineSyntax.ts` создать единый token pattern для plain text, code, link, strong и emphasis, используемый и `Markdown.tsx`, и render-model eligibility. Экспортировать `markdownInlineTokenPattern()` и `markdownVisibleSourceRanges(source)`; не дублировать регулярное выражение в двух модулях.

- [x] **Step 4: Расширить `MarkdownViewProps` и row attributes**

  Добавить optional props:

  ```ts
  rowChanges?: readonly RenderedRowChange[];
  inlineChanges?: readonly RenderedInlineChange[];
  taskChanges?: readonly RenderedTaskChange[];
  ```

  `diffVisualAttributes(sourceLine, evidence)` сначала ищет `rowChanges`, затем существующую decoration. Для жёлтой строки возвращает `aria-label="Изменено"`, `data-diff-kind="modified"`, `data-testid="diff-visual-row"`.

- [x] **Step 5: Рендерить inline change один раз**

  В `renderDecoratedText` добавить line-scoped набор уже выведенных change ids. При достижении after range:

  ```tsx
  <>
    {change.removed ? <del aria-label={`Удалено: ${change.removed}`} className="markdown-diff-inline markdown-diff-inline--removed">{change.removed}</del> : null}
    {change.removed && change.added ? <span aria-hidden="true" className="markdown-diff-inline-arrow">→</span> : null}
    {change.added ? <ins aria-label={`Добавлено: ${change.added}`} className="markdown-diff-inline markdown-diff-inline--added">{change.added}</ins> : null}
  </>
  ```

  Zero-width pure removals выводить на after anchor. Shared rendered-id set предотвращает повтор на границах nested Markdown tokens.

- [x] **Step 6: Рендерить task transition**

  Для list item добавить source column task marker в parsed model. Для list checkbox и table checkbox искать `RenderedTaskChange` по `sourceLine` и optional `sourceColumn`. Вместо одного input выводить старый disabled checkbox, декоративную стрелку и новый disabled checkbox; task text рендерить один раз.

- [x] **Step 7: Запустить targeted tests и подтвердить GREEN**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx`

  Expected: text, formatting, link safety и checklist tests проходят; прежние component tests остаются зелёными.

---

### Task 3: Одна объединённая таблица с red/green/yellow rows

**Files:**
- Modify: `src/components/markdownDiffRenderModel.ts`
- Modify: `src/components/MarkdownDiffPreview.tsx`
- Modify: `src/components/Markdown.tsx`
- Test: `tests/markdown-diff-preview.test.tsx`

**Interfaces:**
- Consumes: table fragments, `structuralPrologue`, `scanMarkdownTableLine`, render descriptors из Tasks 1–2.
- Produces: `tableDiffUnit(hunk)` с одной combined Markdown side для совместимых таблиц.

- [x] **Step 1: Заменить старые table expectations на failing merged-table tests**

  Для изменения `Закрыто → Открыто` ожидать одну таблицу, одну row `data-diff-kind="modified"`, `<del>Закрыто</del>` и `<ins>Открыто</ins>` в одной cell.

  Для table checklist:

  ```tsx
  const model = createMarkdownDiff(
    "| Задача | Статус |\n| --- | --- |\n| Картина | [ ] |\n| Факел | [ ] |",
    "| Задача | Статус |\n| --- | --- |\n| Картина | [x] |\n| Ключ | [ ] |",
  );
  render(<MarkdownDiffPreview model={model} />);

  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getByText("Картина").closest("tr")).toHaveAttribute("data-diff-kind", "modified");
  expect(within(screen.getByText("Картина").closest("tr")!).getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByText("Факел").closest("tr")).toHaveAttribute("data-diff-kind", "removed");
  expect(screen.getByText("Ключ").closest("tr")).toHaveAttribute("data-diff-kind", "added");
  ```

- [x] **Step 2: Запустить table tests и подтвердить RED**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx -t 'table'`

  Expected: текущая реализация создаёт две таблицы или не объединяет mixed row states.

- [x] **Step 3: Реализовать combined table line selection**

  Строить synthetic display Markdown только в presentation layer:

  - добавить structural prologue один раз;
  - оставить context lines один раз;
  - оставить unpaired removed и unpaired added lines;
  - исключить paired removed line;
  - использовать paired added line как modified render-скелет;
  - сохранить исходный diff order остальных строк.

  Для каждой display line вычислить новый `sourceLine`, перенести `RenderedRowChange`, text descriptors и task descriptors на этот индекс.

- [x] **Step 4: Проверить table compatibility**

  Использовать `scanMarkdownTableLine` для проверки одинакового количества cells в paired rows и валидного общего header/delimiter. Если header/delimiter изменены или количество cells несовместимо, вернуть две валидные removed/added sides без жёлтого состояния.

- [x] **Step 5: Запустить table tests и подтвердить GREEN**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx -t 'table'`

  Expected: совместимый hunk даёт одну таблицу с mixed row kinds; incompatible structure даёт точный fallback.

---

### Task 4: Preview budget, стили и полная регрессия

**Files:**
- Modify: `src/components/MarkdownDiffPreview.tsx`
- Modify: `src/styles.css`
- Modify: `tests/markdown-diff-preview.test.tsx`
- Test: `tests/markdown-diff.test.ts`

**Interfaces:**
- Consumes: окончательные render units и descriptors.
- Produces: компактная визуальная система из макета и один проверенный feature change.

- [x] **Step 1: Добавить failing budget и fallback tests**

  Проверить:

  - одна merged yellow row расходует одну строку бюджета;
  - две полностью paired physical lines дают две yellow rows;
  - multi-line fragment с одной неполной парой целиком остаётся removed/added;
  - source-mode показывает точные red/green lines и ни одного `data-diff-kind="modified"`;
  - default preview не разделяет source pair.

- [x] **Step 2: Запустить targeted tests и подтвердить RED**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx tests/markdown-diff.test.ts`

  Expected: новые budget/fallback assertions фиксируют оставшиеся расхождения.

- [x] **Step 3: Исправить truncation descriptors**

  `truncateSide` должен фильтровать `rowChanges`, `inlineChanges` и `taskChanges` по видимому диапазону строк, обрезать только безопасные row boundaries и пересчитывать `visualRows`. `minimumUnitRows` для merged yellow unit равен числу минимально видимых after rows, а для red-green fallback сохраняет минимум по одной строке каждой стороны.

- [x] **Step 4: Реализовать стили макета**

  В `src/styles.css`:

  - оставить существующие red/green row backgrounds и edges;
  - использовать `--diff-modified-bg` и `--diff-modified-edge` для единственной yellow row;
  - добавить `.markdown-diff-inline-arrow`;
  - оформить `<del>` красным с line-through, `<ins>` зелёным с underline и убрать стандартное оформление `ins`;
  - task transition держать в одной строке с подписью и сохранять текущие размеры checkbox;
  - combined table row backgrounds применять через `tr[data-diff-kind]`;
  - не добавлять тени, крупные радиусы или декоративную легенду в production UI.

- [x] **Step 5: Запустить targeted tests и подтвердить GREEN**

  Run: `npm test -- tests/markdown-diff-preview.test.tsx tests/markdown-diff.test.ts`

  Expected: оба файла проходят без failures.

- [x] **Step 6: Запустить полную проверку**

  Run: `npm test`

  Expected: полный Vitest suite проходит.

  Run: `npm run build`

  Expected: TypeScript build и Vite production build завершаются с кодом 0.

- [x] **Step 7: Проверить единственный change перед коммитом**

  Run: `jj status`

  Expected: изменены только spec, plan, render-model/inline helper, Markdown renderer, diff preview, styles и связанные tests.

  Run: `jj diff`

  Expected: diff соответствует этой фиче и не содержит посторонней работы.

- [x] **Step 8: Создать единственный feature-коммит**

  Run: `jj describe -m 'Render local Markdown changes inline'`

  Run: `jj new`

  Expected: parent commit содержит всю фичу; новая working-copy change пуста. Промежуточных feature-коммитов нет.
