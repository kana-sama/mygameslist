# Unbounded Note Card Stacking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox syntax for tracking. Пользователь утвердил исполнение 2026-09-06 командой «теперь реализовывай» после завершения стадии планирования. Все задачи — части одного изменения и одного итогового коммита.

**Goal:** Размещать в одной колонке ряда любое число последовательных карточек, которое помещается по естественным высотам, в том числе после скрытия содержимого.

**Architecture:** Обобщить существующие `ShelfSlot.indexes`, упаковку и распределение высот до N элементов. Сравнивать измеренные естественные высоты при обновлениях сетки и перепаковывать только при их изменении, сохраняя `packingFrozen`, расширение редактора и измерение вне живой сетки. Дополнить CSS переноса для средних элементов стека.

**Tech Stack:** React 19, TypeScript 7, CSS Grid, Vitest 4, Testing Library, существующие ResizeObserver/MutationObserver и Jujutsu; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-06-unbounded-note-card-stacking-design.md` — утверждённая пользователем спецификация.

## Global Constraints

- Репозиторий: `/Users/kana/Development/mygameslist`.
- Только `jj` для status/diff/history/finalization. Существующие и завершённые коммиты неизменяемы.
- Один итоговый коммит содержит спецификацию, этот план, реализацию и постоянные общие тесты. Промежуточных коммитов нет.
- Исполнение через субагентов; выбор способа исполнения у пользователя не запрашивать.
- Сохранять порядок документа и границы групп. Не пропускать неподходящие карточки. Стеки только для `columnSpan === 1` в многоколоночной сетке.
- Сохранять `DEFAULT_ROW_GAP = 12`, `DEFAULT_STACK_GAP = 6` и текущие CSS-параметры колонок; учитывать переданные `rowGap`/`stackGap`.
- Не изменять DOM-иерархию карточек, оформление, содержимое, ключи React, данные, зависимости и анимации.
- Все новые постоянные fixtures искусственные, без идентификаторов, названий и содержимого реальных игр.
- Каждый implementer и reviewer читает спецификацию и исходный скриншот по точному пути из спецификации. Референс показывает проблему; разрешённые отличия — только новые стеки и их геометрия.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `src/components/ShelfGrid.tsx` | `ShelfStackPosition`, упаковка, распределение высот, сравнение измерений; существующие expansion/composition helpers сохраняются и проверяются |
| `src/styles.css` | Четыре desktop-правила зон переноса/индикаторов: добавить `middle` |
| `tests/shelf-grid.test.tsx` | Чистые регрессии упаковки/расширения и DOM-регрессии наблюдения/блокировки |
| `tests/note-layout-css.test.ts` | Общая проверка вычисленных CSS-стилей зон переноса |
| Спецификация и этот план | Утверждённый контракт, шаги, результаты проверок |

`src/pages/GamePage.tsx` изучен: `layoutKey` не содержит состояния фильтра/сворачивания, а `packingFrozen` включается при переносе и редактировании. Менять ключ или добавлять зависимость от конкретного фильтра не требуется: сетка реагирует на реальные измеренные высоты. Файлы Markdown и authored data не входят в реализацию.

## Task 1: Обобщить упаковку и геометрию стеков

**Files:** Modify `src/components/ShelfGrid.tsx` (`ShelfStackPosition`, `packShelfItems`, `layoutComposition`); Test `tests/shelf-grid.test.tsx`.

**Interfaces:** Сохранить сигнатуры `buildShelfLayout(naturalHeights, columnCount, options): ShelfLayout` и `expandShelfLayout(naturalHeights, columnCount, previousLayout, options): ShelfLayout`. В `ShelfStackPosition` добавить `"middle"`. Внутренний `ShelfSlot.indexes: number[]` уже поддерживает N индексов; новый формат композиции не нужен.

- [x] **Step 1: Добавить failing tests на стеки из трёх, четырёх и многих карточек.**

```ts
it("stacks every adjacent short card that fits the shelf", () => {
  const heights = [600, 70, 80, 90, 100];
  const layout = buildShelfLayout(heights, 3);
  expect(layout.placements.map(({ shelf, column }) => [shelf, column]))
    .toEqual([[0, 0], [0, 1], [0, 1], [0, 1], [0, 1]]);
  expect(layout.placements.map(({ stackPosition }) => stackPosition))
    .toEqual(["single", "top", "middle", "middle", "bottom"]);
  expect(layout.placements.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4]);
  const stack = layout.placements.slice(1);
  expect(stack.reduce((sum, card) => sum + card.height, 0) + 3 * 6).toBe(600);
  stack.forEach((card, index) => {
    expect(card.height).toBeGreaterThanOrEqual(heights[card.index]);
    if (index > 0) expect(card.top).toBe(stack[index - 1].top + stack[index - 1].height + 6);
  });
  expect(stack.at(-1)!.top + stack.at(-1)!.height).toBe(600);
  expectNoPlacementOverlaps(layout);
});

it("does not replace the pair limit with another fixed limit", () => {
  const layout = buildShelfLayout([600, ...Array(50).fill(5)], 3);
  expect(layout.placements).toHaveLength(51);
  expect(layout.placements.slice(1).every((p) => p.shelf === 0 && p.column === 1)).toBe(true);
  expectNoPlacementOverlaps(layout);
});

it.each([
  { last: 104, columns: [0, 1, 1, 1] },
  { last: 105, columns: [0, 1, 1, 2] },
])("honors the exact height boundary for $last", ({ last, columns }) => {
  const layout = buildShelfLayout([300, 90, 94, last], 3);
  expect(layout.placements.map((p) => p.column)).toEqual(columns);
  expectNoPlacementOverlaps(layout);
});
```

- [x] **Step 2: Запустить новые тесты до изменения кода.**

```bash
npm test -- tests/shelf-grid.test.tsx -t 'every adjacent|another fixed limit|exact height boundary'
```

Ожидается FAIL на составе стека/позициях для трёх и более карточек. Если тест падает из-за импорта или окружения, сначала исправить сам тест.

- [x] **Step 3: Заменить проверку пары последовательным накоплением.**

Внутри текущего цикла по колонкам вместо `nextItem/canStack` использовать следующий блок; внешний цикл с повторной оценкой `shelfHeight` сохранить:

```ts
const indexes = [item.index];
let usedHeight = heights[item.index];
itemOffset += 1;
if (item.columnSpan === 1 && totalColumns > 1) {
  while (itemOffset < items.length) {
    const next = items[itemOffset];
    if (next.columnSpan !== 1) break;
    const nextHeight = usedHeight + stackGap + heights[next.index];
    if (nextHeight > shelfHeight) break;
    indexes.push(next.index);
    usedHeight = nextHeight;
    itemOffset += 1;
  }
}
slots.push({ column: columnOffset + column, columnSpan: item.columnSpan, indexes });
column += item.columnSpan;
```

Высоту ряда нельзя увеличивать только ради добавления ещё одного элемента в уже заполняемый стек. Существующий повторный проход разрешён, когда отдельная карточка, занявшая освободившуюся колонку, сама выше текущей оценки. При каждом таком повторе высота строго растёт до высоты одной из входных карточек/существующего закреплённого слота; произвольного лимита итераций не добавлять.

- [x] **Step 4: Обобщить расчёт placements для стека.**

Сохранить ветку одиночного слота с `topOffset`. Для стека использовать накопленное округление; каждому индексу должен соответствовать `placements.push`:

```ts
const naturalTotal = slot.indexes.reduce((total, index) => total + heights[index], 0);
const extra = Math.max(0, shelfHeight - naturalTotal - stackGap * (slot.indexes.length - 1));
let naturalPrefix = 0;
let allocatedExtra = 0;
let top = shelfTop;
slot.indexes.forEach((index, position) => {
  naturalPrefix += heights[index];
  const nextExtra = position === slot.indexes.length - 1
    ? extra
    : Math.floor(extra * naturalPrefix / naturalTotal);
  const height = heights[index] + nextExtra - allocatedExtra;
  const stackPosition: ShelfStackPosition = position === 0
    ? "top"
    : position === slot.indexes.length - 1 ? "bottom" : "middle";
  placements.push({ index, shelf, column: slot.column, columnSpan: slot.columnSpan,
    top, height, shelfHeight, stackPosition });
  top += height + stackGap;
  allocatedExtra = nextExtra;
});
```

Все высоты уже нормализованы как минимум до 1, поэтому `naturalTotal > 0`. Новый алгоритм должен сохранить существующий результат пары `[40, 50, 140, 60]`: 59 и 75 px с промежутком 6 px.

- [x] **Step 5: Добавить ограничения порядка и проверку повторного прохода.**

```ts
it("revisits earlier stacks when a newly admitted tall card raises the shelf", () => {
  const layout = buildShelfLayout([40, 40, 100, 220, 50], 3);
  expect(layout.placements.map((p) => [p.shelf, p.column]))
    .toEqual([[0, 0], [0, 0], [0, 0], [0, 1], [0, 2]]);
  expect(layout.height).toBe(220);
  expectNoPlacementOverlaps(layout);
});

it("stops a stack at a wide card without skipping ahead", () => {
  const layout = buildShelfLayout([600, 40, 40, 40, 70, 40], 4,
    { columnSpans: [1, 1, 1, 1, 2, 1] });
  expect(layout.placements.map((p) => [p.shelf, p.column, p.columnSpan]))
    .toEqual([[0, 0, 1], [0, 1, 1], [0, 1, 1], [0, 1, 1], [0, 2, 2], [1, 0, 1]]);
  expectNoPlacementOverlaps(layout);
});

it("uses custom gaps and a later shelf's top for a long stack", () => {
  const layout = buildShelfLayout([500, 500, 300, 90, 94, 96], 2,
    { rowGap: 17, stackGap: 10 });
  expect(layout.placements.slice(2).map((p) => [p.shelf, p.column, p.top, p.height]))
    .toEqual([[1, 0, 517, 300], [1, 1, 517, 90], [1, 1, 617, 94], [1, 1, 721, 96]]);
  expect(layout.height).toBe(817);
  expectNoPlacementOverlaps(layout);
});
```

Переименовать старый тест `stacks only two adjacent cards...` в проверку сохранения размеров пары, оставив его точные ожидания. Сохранить прежние тесты одной колонки, неправильных измерений и широких карточек. Для нового алгоритма проверять не только число элементов, но и точное число слотов/колонок через группировку placements по `(shelf, column)`.

- [x] **Step 6: Запустить весь `tests/shelf-grid.test.tsx`.** Все новые и прежние тесты должны пройти. Не делать промежуточный коммит.

## Task 2: Перепаковывать при реальном изменении естественных высот

**Files:** Modify `src/components/ShelfGrid.tsx` (`ShelfGrid` refs и `layout`); Test `tests/shelf-grid.test.tsx`.

**Interfaces:** Публичные props неизменны. Новый `naturalHeightsRef` хранит последние нормализованные измерения; существующий `pendingRepackRef` хранит отложенный запрос.

- [x] **Step 1: Добавить DOM-регрессию при неизменном layoutKey.** Использовать существующие `ResizeObserverMock`, ручную очередь animation-frame callbacks и измерение по `data-height`.

```tsx
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
  if (this.classList.contains("notes-list")) return { width: 1100, height: 600 } as DOMRect;
  return { width: 360, height: Number(this.dataset.height ?? 1) } as DOMRect;
});
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  const id = nextFrame++;
  frames.set(id, callback);
  return id;
});
vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    let rounds = 0;
    while (frames.size > 0) {
      expect(++rounds).toBeLessThan(10);
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
      await Promise.resolve();
    }
  });
};
const view = render(
  <ShelfGrid className="notes-list" layoutKey="height-change">
    <article data-height="600" />
    <article data-height="300"><button aria-expanded="true">Toggle</button></article>
    <article data-height="300" />
    <article data-height="300" />
    <article data-height="300" />
  </ShelfGrid>,
);
const grid = view.container.querySelector(".notes-list")!;
const originals = Array.from(grid.children) as HTMLElement[];
const toggle = originals[1].querySelector("button")!;
toggle.focus();
[70, 80, 90, 100].forEach((height, index) => {
  originals[index + 1].dataset.height = String(height);
});
toggle.setAttribute("aria-expanded", "false");
await flush();
expect(Array.from(grid.children)).toEqual(originals);
expect(document.activeElement).toBe(toggle);
expect(originals.map((card) => [card.dataset.shelfIndex, card.style.gridColumnStart]))
  .toEqual([["0", "1"], ["0", "2"], ["0", "2"], ["0", "2"], ["0", "2"]]);
expect(originals.map((card) => card.dataset.shelfPosition))
  .toEqual(["single", "top", "middle", "middle", "bottom"]);
```

Обернуть пример в `it("repacks changed natural heights without changing the layout key", async () => { ... })`. Запустить до изменения React-логики; ожидается FAIL на сохранённых отдельных колонках/рядах.

- [x] **Step 2: Включить сравнение естественных высот в решение о перепаковке.**

```ts
// Вместе с refs ShelfGrid:
const naturalHeightsRef = useRef<readonly number[] | null>(null);

// Сразу после measureNaturalHeights:
const previousHeights = naturalHeightsRef.current;
const heightsChanged = previousHeights === null
  || previousHeights.length !== heights.length
  || heights.some((height, index) => height !== previousHeights[index]);

// Расширить существующее выражение:
const shouldRepack = requestRepack || pendingRepackRef.current
  || !compositionRef.current || columnCountChanged || structureChanged || heightsChanged;

// После успешного расчёта, рядом с обновлением cardsRef:
naturalHeightsRef.current = heights;
```

Существующее вычисление `repackNow` и выставление `pendingRepackRef` при заблокированной упаковке остаются владельцами freeze-логики. Не заменять все вызовы `scheduleLayout(false)` на `true`: одинаковые размеры не должны принуждать новую упаковку.

- [x] **Step 3: Расширить DOM-регрессию обратным ростом и блокировкой.** На той же fixture вернуть высоты 300 и сменить `aria-expanded` обратно: отдельные карточки снова расходятся без пересечений. В отдельном параметризованном тесте включить `packingFrozen` до уменьшения высот, зафиксировать прежние `(shelf, column, stackPosition)`, уменьшить их до `[600,70,80,90,100]` и проверить сохранённую композицию; после `rerender` с `packingFrozen={false}` ожидать стек из четырёх. Во всех переходах проверять исходные DOM-узлы. Проверить также увеличение содержимого уже существующего стека при freeze: состав прежний, ряд растёт, ни одна карточка не исчезает.

Проверки выполнить на основе JSX/измерений из Step 1, с теми же стабильными ключами карточек и неизменным `layoutKey`; менять только `packingFrozen` и естественные высоты. Это проверяет именно отложенный запрос, а не принудительный сигнал нового ключа.

- [x] **Step 4: Проверить идемпотентность и существующие исключения.** Повторить geometry-mutation после первого успешного уменьшения без изменения высот, сравнить весь массив inline placements и identity/focus. Убедиться, что очередь frames опустошается. Существующий тест `does not remeasure cards for note visual-state mutations...` должен по-прежнему показывать ноль измерений для прокрутки/прогресса; обычные geometry-mutations продолжают измеряться. Проверка клона должна оставаться без ослабления assertions.

```bash
npm test -- tests/shelf-grid.test.tsx
```

## Task 3: Совместимость со средними карточками, переносом и редактором

**Files:** Modify `src/styles.css`; Test `tests/note-layout-css.test.ts`, `tests/shelf-grid.test.tsx`. `expandShelfLayout`, `placementComposition` и `appendTailToComposition` менять только если новые регрессии выявили зависимость от пары.

**Interfaces:** `data-shelf-position="middle"` — новый вариант существующего атрибута. Модель note-edge, DnD callbacks и сохранение порядка не меняются.

- [x] **Step 1: Добавить failing CSS-тест для middle.** В `tests/note-layout-css.test.ts` установить production stylesheet с `data-note-layout-test`, как в существующих тестах, и создать `article[data-shelf-position]` с двумя `div.note-drop-zone--before/--after`. Параметризовать `top`, `middle`, `bottom`:

```ts
expect(getComputedStyle(before).top).toBe("0px");
expect(getComputedStyle(before).left).toBe("0px");
expect(getComputedStyle(before).right).toBe("0px");
expect(getComputedStyle(before).height).toBe("50%");
expect(getComputedStyle(after).bottom).toBe("0px");
expect(getComputedStyle(after).left).toBe("0px");
expect(getComputedStyle(after).right).toBe("0px");
expect(getComputedStyle(after).height).toBe("50%");
```

Добавить отдельную проверку `single`: зоны имеют ширину 50%, до — `left: 0`, после — `right: 0`, обе от top до bottom. Проверять вычисленные стили живых элементов; реальную геометрию pseudo-element индикаторов проверить в браузере, поскольку JSDOM не измеряет их достоверно.

- [x] **Step 2: Включить middle в четыре правила CSS.** В desktop-селекторах, где перечислены `top` и `bottom`, явно добавить третий селектор с `middle`: before, after, before indicator и after indicator. Декларации остаются прежними; мобильные общие селекторы `[data-shelf-position]` не менять. Пример первого правила:

```css
[data-shelf-position="top"] .note-drop-zone--before,
[data-shelf-position="middle"] .note-drop-zone--before,
[data-shelf-position="bottom"] .note-drop-zone--before { top: 0; right: 0; left: 0; height: 50%; }
```

- [x] **Step 3: Добавить проверки закрепления редактора в N-стеке.**

```ts
it.each([0, 1, 2])("pins stack member %i when it expands rightward", (index) => {
  const heights = [40, 40, 40, 300, 100, 100];
  const initial = buildShelfLayout(heights, 4);
  expect(initial.placements.slice(0, 3).map((p) => p.stackPosition))
    .toEqual(["top", "middle", "bottom"]);
  const anchor = initial.placements[index];
  const snapshot = structuredClone(initial);
  const expanded = expandShelfLayout(heights, 4, initial, {
    columnSpans: heights.map(() => 1), expansion: { index, requestedSpan: 3 },
  });
  expect(expanded.placements[index]).toMatchObject({
    shelf: anchor.shelf, column: anchor.column, top: anchor.top, columnSpan: 3,
  });
  expect(expanded.placements.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(initial).toEqual(snapshot);
  expectNoPlacementOverlaps(expanded);
});

it("keeps a displaced triple in the last free column", () => {
  const heights = [300, 40, 40, 40, 300];
  const initial = buildShelfLayout(heights, 4);
  const expanded = expandShelfLayout(heights, 4, initial, {
    expansion: { index: 0, requestedSpan: 3 },
  });
  expect(expanded.placements.slice(1, 4).map((p) => [p.shelf, p.column, p.stackPosition]))
    .toEqual([[0, 3, "top"], [0, 3, "middle"], [0, 3, "bottom"]]);
  expect(expanded.placements.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  expectNoPlacementOverlaps(expanded);
});
```

Дополнить проверку прежнего `topOffset` вторым расширением на следующем ряду, используя существующий тест `preserves a sole widened bottom anchor's offset...` как шаблон, но начиная со среднего элемента тройки. До второго расширения сохранить placements обоих якорей и затем сравнить shelf/column/top; ни один индекс не дублируется. Исходная композиция не изменяется.

- [x] **Step 4: Выполнить проверки совместимости.**

```bash
npm test -- tests/shelf-grid.test.tsx tests/note-layout-css.test.ts tests/note-groups.test.tsx tests/note-collapse.test.tsx tests/note-interaction-render-isolation.test.tsx
```

Ожидается PASS. Прежние тесты групп, переноса, монотонной ширины редактора и 4→2→4 responsive-переходов не ослаблять.

## Task 4: Визуальная приёмка, независимый review и единый коммит

**Files:** Только одобренные файлы из карты; временные harness/скриншоты проверки не включать в feature commit. Эта задача исполняется только после отдельного разрешения реализации.

- [x] **Step 1: Запустить итоговые проверки после всех изменений.**

```bash
npm test
npm run build
```

`npm run build` уже включает `tsc -b`. Не запускать повторные широкие проверки без новых изменений или обнаруженных проблем.

- [x] **Step 2: Исполнитель проверяет браузер.** Прочитать исходный скриншот и спецификацию непосредственно перед сравнением. На локальной странице из референса найти тот же порядок/состояние заметок и включить скрытие завершённого содержимого. Дополнительно использовать искусственную fixture с одной высокой и 4+ короткими карточками. Зафиксировать количество живых карточек и групп, количество стеков и rectangles: все помещающиеся последовательные короткие карточки находятся в одной колонке. Не считать совпадение общего количества карточек достаточным доказательством правильного стекирования.

Проверить ширины сетки 1100 и 1464 px, viewport 640 и 390 px, а также сопоставимую со скриншотом конфигурацию. Показать реальные idle/hover/focus-visible/active состояния, фильтрацию в обе стороны, сворачивание/раскрытие, начало/окончание переноса, изменение ширины редактора, отмену редактирования и ошибку сохранения в искусственной fixture. Для переноса проверить верхнюю/нижнюю половины средней карточки, обе линии-индикатора и конечный порядок после drop; повторить перенос клавиатурой. Сверить CSS gaps и нижние границы по rectangles.

Во время обычной внутренней прокрутки геометрия сетки и внешняя прокрутка стабильны. При сворачивании допустимо только итоговое размещение по новому контракту; недопустим промежуточный сброс живой сетки, потеря фокуса или скачок к постороннему ряду. Проверить после завершения текущих анимаций фильтра/сворачивания и при быстром переключении в обратную сторону; не вводить новую анимацию ради маскировки дефекта. В консоли нет новых ошибок наблюдателей.

- [x] **Step 3: Независимый reviewer выполняет проверку спецификации и кода.** Передать точные пути скриншота, спецификации и плана, approved viewport-набор и все требования таблицы приёмки. Reviewer сам сравнивает итоговый UI с референсом, проверяет порядок, слоты, все указанные состояния, окончание цикла упаковки, N placements, округление, freeze/thaw, закрепление редактора и observer feedback. Если референс недоступен или проверка заблокирована, сообщить об этом, не заявлять визуальную приёмку выполненной.

- [x] **Step 4: Исправить найденные отклонения в том же рабочем изменении.** После правок запустить затронутые тесты; повторить build или всю suite только если изменения этого требуют. Удалить временные проверочные файлы. Внести фактические результаты в этот план. Не изменять утверждённый визуальный/интерактивный контракт самостоятельно.

- [x] **Step 5: Финализировать ровно один feature commit.**

```bash
jj status
jj diff
```

Сопоставить список файлов с картой. Если появилась посторонняя работа, сохранить её отдельно средствами Jujutsu без переписывания существующих коммитов и без включения в этот feature commit. При чистом составе завершить:

```bash
jj describe -m "Allow any number of fitting note cards per shelf column"
jj new
jj status
```

Не выполнять эти команды финализации на стадии подготовки плана.

## Проверка полноты плана

- Требования 1–6 покрывает Task 1, включая точную структуру слотов, границы высоты и сохранение прежних пар.
- Требования 8–9 и часть 11 покрывает Task 2, включая изменения без нового `layoutKey` и отсутствие влияния визуальных мутаций.
- Требования 7 и 10 покрывает Task 3; реальные DnD-границы и состояния дополнительно проверяет Task 4.
- Референс, стабильность фокуса/прокрутки, responsive, анимационные переходы и границы задачи проверяет Task 4.
- Стадия подготовки: выполнены чтение исходного кода/спецификаций, воспроизведение ограничения чистым вызовом текущего алгоритма, существующие 32 ShelfGrid-теста. Код приложения и тесты не изменены; исполнение плана не начато.

## Результаты исполнения

- Tasks 1–3 реализованы субагентами; каждый этап прошёл независимый review без замечаний.
- TDD: до реализации подтверждены ожидаемые падения тестов упаковки, обновления высот и CSS middle.
- Совместимость: 110 тестов в 5 файлах прошли.
- Полная проверка: `npm test` — 91 файл, 1943 теста прошли, 22 пропущены; два диагностических сообщения JSDOM о неподдерживаемой навигации.
- `npm run build` — успешны TypeScript и production build; остаётся предупреждение Vite о крупных chunks.
- Изменения отдельной задачи центрирования checkbox-only ячеек сохранены её исполнителем отдельным предшествующим коммитом.
- Браузерная приёмка исполнителя пройдена: сетки 1100/1464 px, viewport 640/390 px, референс и все оговорённые состояния. В reference-сцене три короткие карточки образуют один стек рядом с высокой; в искусственной сцене — четыре. Измерены промежутки 6 px внутри стека и 12 px между рядами, совпадение нижних границ и отсутствие пересечений.
- Проверены фильтрация в обе стороны, сворачивание с сохранением фокуса, вставка до/после средней карточки мышью, перенос клавиатурой, автоматическое расширение редактора, отмена и ошибка сохранения. Внутренняя вертикальная/горизонтальная прокрутка не изменяет внешнюю позицию и геометрию карточки. Ошибок наблюдателей нет.
- Браузерная проверка использовала временный GamePage harness с состоянием в памяти; пользовательские локальные правки и данные не изменялись.
- Итоговые code review и независимое визуальное сравнение пройдены без замечаний. Дополнительно подтверждены свёрнутая Nopons и сохранение gridRowStart при расширении среднего редактора с одной до двух колонок. Браузер reviewer был недоступен, поэтому дополнительные live-снимки получены основным исполнителем по его запросу и независимо просмотрены reviewer; его собственное управление браузером не заявляется.
- Временный harness удалён. В итоговое изменение входят ровно шесть файлов из карты; реализация, спецификация, план и общие тесты финализируются одним коммитом.
