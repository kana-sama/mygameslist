# Terminal rich-tooltip checklist filter fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Execute through subagents as required by AGENTS.md; one final fix commit, no intermediate commits.

**Goal:** Скрывать завершённую последнюю секцию обычной заметки независимо от terminal rich-tooltip definitions.

**Architecture:** Исправить подготовку Markdown на границе кэша `InlineNoteCard`, чтобы snapshot и рендерер анализировали одинаковый видимый документ. Использовать существующий `parseMarkdownRichTooltips().visibleMarkdown`, сохранив raw source для `legacy-review:`. Алгоритм фильтра и общий block parser остаются прежними.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, существующие Markdown parsers, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-09-06-terminal-rich-tooltip-checklist-filter-fix-design.md`.

**Status:** Пользователь согласовал реализацию сообщением «исправляй». Исправление, generic tests, полный suite, сборка и независимый review завершены. Итоги проверки зафиксированы в спецификации.

## Global Constraints

- Snapshot обычной заметки рассчитывается по тому же `visibleMarkdown`, который показывает `MarkdownView` при включённых rich tooltips.
- Для карточек `legacy-review:` rich tooltips отключены: snapshot продолжает использовать полный исходник, как и рендерер.
- Сохраняются lifecycle snapshot по generation/revision, заморозка во время активности, временное раскрытие, collapse state, structural IDs и существующее поведение таблиц.
- Исходник заметки, определения, их порядок и содержимое, hierarchy и авторский порядок секций не меняются. Исправление не требует правок данных или CSS.
- Permanent tests используют только generic fixtures; проверки конкретного вложения временные.
- Все repository status/diff/history/commit операции выполняются только через `jj`. Существующие коммиты неизменяемы; документация, реализация и permanent tests завершаются одним коммитом.

---

### Task 1: Согласовать snapshot страницы с видимым Markdown и проверить регрессию

**Files:**

- Modify: `src/pages/GamePage.tsx`, `InlineNoteCard`, блок создания snapshot около строк 969–973.
- Create: `tests/completed-checklist-rich-tooltips.test.tsx`, generic integration coverage.
- Read: `src/components/Markdown.tsx:1521`, `src/components/markdownCompletedChecklistFilter.ts`, `src/domain/markdownRichTooltips.ts`.
- Read: `tests/ui-acceptance.test.tsx`, `tests/markdown-rich-tooltip-ui.test.tsx`, `tests/markdown-tasks.test.tsx`.
- Include in final commit: spec и этот план, уже созданные на этапе диагностики.

**Interfaces:**

- Consumes: `note.bodyMarkdown: string`, `note.clientId: string`, текущий cache epoch и `parseMarkdownRichTooltips(source).visibleMarkdown`.
- Produces: прежний `CompletedChecklistFilterSnapshot` через `createCompletedChecklistFilterSnapshot(parseMarkdownBlocks(snapshotMarkdown))`; публичные типы и props не меняются.

**Required reference brief for implementer and reviewer:**

Передать обоим агентам полный путь к spec, этому плану и двум пользовательским reference files из spec. Обязательные инварианты: один заголовок заметки; прежняя heading hierarchy и порядок; после фильтра четыре оставшиеся незавершённые секции и ровно одна title-owned сводка `Скрыто 8 секций`; прогресс `58/66`; definitions сохраняются в исходнике, но отсутствуют в основном потоке. Размер приложенного изображения 778 × 1294 не выдавать за размер browser viewport. Итог сравнить с оригиналами непосредственно, включая collapsed idle и существующие expanded/reveal/filter-off состояния.

- [x] **Step 1: Добавить воспроизводящий integration test до изменения кода.**

Создать новый тестовый файл с базовым setup и synthetic fixture:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownView } from "../src/components/Markdown";
import { GamePage } from "../src/pages/GamePage";
import type { Game, Note } from "../src/domain";

class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const source = "# Note\n\n## Complete\n- [x] [Entry][?]\n";
const definitions = "\n[?Entry]:\n    Description\n";
const game: Game = {
  id: "11111111-1111-4111-8111-111111111111", title: "Synthetic game",
  coverAssetId: null, platforms: [], tags: [], status: "playing",
  placement: { tierId: "unranked", rank: 1024 }, reviewMarkdown: "",
  createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
};
function makeNote(bodyMarkdown: string): Note {
  return {
    id: "22222222-2222-4222-8222-222222222222", gameId: game.id,
    bodyMarkdown, attachments: [], rank: 1024,
    createdAt: game.createdAt, updatedAt: game.updatedAt,
  };
}

it("hides the last completed section with terminal rich tooltip definitions on GamePage", () => {
  render(<GamePage assets={{}} completedChecklistFilterEnabled game={game}
    mode="game" notes={[makeNote(source + definitions)]} onSave={vi.fn()} />);
  expect(screen.queryByRole("heading", { name: /Complete/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /^Note/ })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Скрыто 1 секций" })).toHaveLength(1);
  expect(screen.queryByText("Description")).not.toBeInTheDocument();
});
```

- [x] **Step 2: Подтвердить ожидаемое падение.**

```sh
npm test -- tests/completed-checklist-rich-tooltips.test.tsx
```

Expected: assertion отсутствия heading `Complete` падает, потому что heading присутствует. Не считать ошибку импорта или test setup воспроизведением бага.

- [x] **Step 3: Исправить только входные данные snapshot.**

Внутри существующего `if`, который создаёт snapshot нового epoch, заменить raw-source расчёт:

```tsx
const snapshotMarkdown = note.clientId.startsWith("legacy-review:")
  ? note.bodyMarkdown
  : parseMarkdownRichTooltips(note.bodyMarkdown).visibleMarkdown;
completedChecklistFilterSnapshotCache.current = {
  epoch: completedChecklistFilterEpoch,
  snapshot: createCompletedChecklistFilterSnapshot(parseMarkdownBlocks(snapshotMarkdown)),
};
```

`parseMarkdownRichTooltips` уже импортирован в `GamePage.tsx`. Вычислять projection только при обновлении snapshot; не менять условие кэша и не привязывать его к каждому изменению `bodyMarkdown`. Guard должен соответствовать существующему `richTooltipsEnabled={!note.clientId.startsWith("legacy-review:")}` у `MarkdownView`.

- [x] **Step 4: Добавить контрольные generic tests в тот же файл.**

Проверить parity standalone/page и контрпримеры:

```tsx
it("also hides the section in standalone rich Markdown", () => {
  render(<MarkdownView completedChecklistFilterEnabled richTooltipsEnabled markdown={source + definitions} />);
  expect(screen.queryByRole("heading", { name: /Complete/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скрыто 1 секций" })).toBeInTheDocument();
});

it.each([
  source + "\nOrdinary paragraph\n" + definitions,
  source.replace("[x]", "[ ]") + definitions,
  source.replace("[x]", "[-]") + definitions,
  source + definitions + "\nVisible interruption\n",
])("keeps a section containing visible work or ordinary content: %s", (bodyMarkdown) => {
  render(<GamePage assets={{}} completedChecklistFilterEnabled game={game}
    mode="game" notes={[makeNote(bodyMarkdown)]} onSave={vi.fn()} />);
  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Скрыто 1 секций" })).not.toBeInTheDocument();
});

it("preserves raw-source filtering for legacy review cards", () => {
  render(<GamePage assets={{}} completedChecklistFilterEnabled
    game={{ ...game, reviewMarkdown: source + definitions }} mode="game" notes={[]} onSave={vi.fn()} />);
  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Скрыто 1 секций" })).not.toBeInTheDocument();
});

it("counts a completed parent once when terminal definitions follow its last child", () => {
  const bodyMarkdown = "# Note\n## Parent\n### Child\n- [x] [Entry][?]\n" + definitions;
  render(<GamePage assets={{}} completedChecklistFilterEnabled game={game}
    mode="game" notes={[makeNote(bodyMarkdown)]} onSave={vi.fn()} />);
  expect(screen.queryByRole("heading", { name: /Parent|Child/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Скрыто 1 секций" })).toHaveLength(1);
});

it("reveals sections and tasks independently while preserving tooltip bodies and source", async () => {
  const onSave = vi.fn();
  const note = makeNote(source + definitions);
  const view = render(<GamePage assets={{}} completedChecklistFilterEnabled game={game}
    mode="game" notes={[note]} onSave={onSave} />);
  fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 секций" }));
  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 пунктов" }));
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Entry" }));
  expect(within(await screen.findByRole("dialog")).getByText("Description")).toBeInTheDocument();
  view.rerender(<GamePage assets={{}} completedChecklistFilterEnabled={false} game={game}
    mode="game" notes={[note]} onSave={onSave} />);
  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(onSave).not.toHaveBeenCalled();
});
```

- [x] **Step 5: Запустить проверки поведения и сборку.**

```sh
npm test -- tests/completed-checklist-rich-tooltips.test.tsx tests/markdown-tasks.test.tsx tests/markdown-rich-tooltips.test.ts tests/markdown-rich-tooltip-ui.test.tsx tests/ui-acceptance.test.tsx
npm test
npm run build
```

Focused tests должны подтвердить section/list/table filtering, snapshot lifecycle и source-preserving tooltip interactions. Полный suite и production build выполняются один раз после focused green, повторяются только при новых изменениях или сбоях.

- [x] **Step 6: Сверить исходный reference и провести review.**

Временно загрузить присланный текст в diagnostic fixture без изменения `data/`. Проверить: 66 definitions без parser errors; title progress `58/66`; четыре видимые depth-two секции в исходном порядке; ровно одна сводка прямых секций со значением 8; отсутствие heading `Spirit Crucible Elpys` среди доступных заголовков при свежем фильтре. Проверить DOM ownership сводки, а не только её текст. Временный verifier удалить.

На локальном preview implementer и reviewer непосредственно сравнивают оригинальные reference files с результатом: collapsed idle из снимка, expanded, reveal и filter-off; существующий hover/focus сводки. Подтвердить сохранение hierarchy, typography, отступов и interaction model. Полный пользовательский текст не включать в permanent tests. Reviewer отдельно проверяет guard для legacy reviews и неизменность cache epoch.

- [x] **Step 7: Завершить одним коммитом только после реализации и успешной проверки.**

```sh
jj status
jj diff
```

Ожидаемые файлы: `src/pages/GamePage.tsx`, новый generic test, spec и план. Убедиться в отсутствии временного verifier, изменений `data/`, CSS и unrelated work. Если в рабочем изменении появился чужой код, сначала изолировать только перечисленные файлы средствами `jj`, сохранив существующие коммиты и чужое содержимое.

```sh
jj describe -m "Fix completed section filtering with terminal rich tooltips"
jj new
jj status
```

Финализировать реализацию, spec, plan и generic tests вместе: отдельный plan/spec commit запрещён проектным workflow.
