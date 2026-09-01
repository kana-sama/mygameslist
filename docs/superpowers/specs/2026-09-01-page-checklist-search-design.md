# Поиск по чеклистам текущей страницы

## Статус

Согласованный дизайн фичи. Визуальное направление утверждено по макету `.superpowers/brainstorm/96049-1788248038/content/refined-two-pane-v5.html`.

Спецификация, implementation plan, реализация и постоянные тесты должны войти в один feature-коммит. Отдельный промежуточный spec-коммит не создаётся.

## Цель

Добавить на страницу игры быстрый клавиатурный поиск по всем Markdown-чеклистам текущей страницы. Поиск должен находить пункт как по его собственному тексту, так и по содержимому каждой аннотации внутри него. Поддерживаются оба самостоятельных механизма аннотаций проекта:

- simple hover tooltip `[text]("description")` с plain-text description;
- rich tooltip `[text][?]` с отдельным Markdown definition body.

Результат можно изменить, не закрывая поиск, либо открыть в исходной заметке. До ввода запроса palette показывает небольшую локальную историю пунктов, успешно изменённых через неё.

Одновременно расширяется общий способ ввода состояния `[-]`: существующий `Cmd+Click` сохраняется, а `Shift+Click` становится равнозначным способом. В поисковой palette клавиатурный эквивалент — только `Shift+Space`; системный shortcut `Cmd+Space` приложение не перехватывает. Новое правило действует одинаково в заметках, Markdown-таблицах и поисковой palette.

## Область действия

- Palette доступна только на существующей странице игры.
- Индексируются все task items из Markdown-списков и task cells из Markdown-таблиц во всех заметках текущей игры.
- Индекс строится из актуального Markdown заметок, а не из видимых DOM-узлов.
- В поиск входят выполненные пункты, пункты внутри свёрнутых секций и пункты, временно скрытые глобальным фильтром выполненных чеклистов.
- Progress items игры, обычные Markdown-абзацы, заголовки без задач, catalog games и заметки других игр не входят в checklist-индекс.
- Нового поведения для узких экранов не добавляется. Утверждённый контракт рассчитан на desktop viewport.

## Не входит в задачу

- Глобальный поиск по чеклистам всей библиотеки.
- Поиск по обычному тексту заметок вне checklist item и содержащихся в нём simple/rich-аннотаций.
- Индексация optional title у обычной Markdown-ссылки как аннотации: link title остаётся metadata ссылки, а не simple hover tooltip.
- Создание, редактирование или исправление simple/rich-аннотаций из palette.
- Изменение визуального дизайна существующего поиска игр.
- Сохранение поискового запроса между открытиями palette или между страницами.
- Синхронизация checklist-search history через библиотеку, GitHub, export или другой браузер.
- Поддержка palette поверх открытого редактора заметки или другого modal-инструмента.

## Утверждённый визуальный дизайн

### Общая геометрия

- Palette открывается как центральный overlay поверх затемнённой текущей страницы.
- Desktop-ширина palette — `690px`, высота — `366px`.
- Верхнее поле поиска имеет высоту `44px`, нижняя строка подсказок — `29px`.
- Основная область делится на две колонки `44% / 56%`: результаты слева, preview аннотаций справа.
- Список результатов и preview прокручиваются независимо, когда содержимое не помещается.
- Поверхность, границы, тень, типографика, малые радиусы и instrumental blue следуют существующему `DESIGN.md` и визуальному языку `GlobalGameSearch`.
- Утверждённая пользователем коррекция типографики переопределяет только микроскопические размеры текста из visual reference: query, текст результата, заголовок аннотации и simple/rich preview используют существующую primary/control ступень приложения `12px`; путь, footer hints и клавиша `Esc` используют существующую secondary/label ступень `9px`. Отдельная palette-only ступень `13px` не вводится. Все остальные свойства reference остаются обязательными.

### Результаты

Каждая строка результата содержит ровно три постоянных элемента:

1. чекбокс текущего состояния;
2. текст checklist item;
3. компактный путь `заметка › секция`.

Строка не имеет `height` или `min-height`: её высоту определяет содержимое. Внутренние отступы равны `7px` сверху и снизу и `10px` слева и справа. Между текстом и путём остаётся только `1px`. Выбранная строка получает существующую active surface и тонкий instrumental-blue indicator слева.

В строках отсутствуют отдельные счётчики, status chips, подписи «совпадение в тексте/аннотации», score, технические идентификаторы и дополнительные metadata tables. Совпавшие фрагменты можно выделять тихой instrumental-blue wash без изменения текста.

Путь начинается с заголовка заметки и продолжается ближайшей иерархией Markdown-заголовков или checklist/table group. При нехватке ширины он обрезается многоточием в одну строку.

### Preview

- Preview следует за текущим визуальным выбором при навигации стрелками и наведении мыши; отдельный клик для просмотра не требуется.
- Для выбранного пункта preview показывает все непустые simple/rich-аннотации в порядке их появления внутри item.
- Simple hover tooltip отображается с видимой inline-подписью как заголовком и с `description` как обычным plain text: Markdown-подобные символы description не форматируются.
- Rich tooltip отображается с anchor/inline-подписью как заголовком и с полным отрендеренным Markdown definition body.
- Если запрос совпал с одной из нескольких аннотаций, эта аннотация располагается первой, а остальные сохраняют исходный относительный порядок.
- Для пункта без непустых simple/rich-аннотаций правая колонка остаётся пустой; отдельное сообщение или декоративный placeholder не добавляется.
- Rich preview переиспользует существующее представление rich-tooltip body, включая обычный Markdown и definition lists. Вся preview остаётся неинтерактивной: ссылки, вложенные действия и новые tooltip trigger не открываются.
- В preview отсутствуют status chip чекбокса, отдельная таблица служебных метаданных и пояснение источника fuzzy-совпадения.

### Нижняя строка

Нижняя строка содержит только тихие подсказки:

- `Space` — отметить;
- `Shift+Space` — частично;
- `Enter` — перейти;
- `↑↓` — выбрать.

Подсказки не меняют геометрию palette между input- и result-режимами. Семантическая доступность действий задаётся через ARIA, а не дополнительный видимый chrome.

## Открытие и закрытие

- Shortcut состоит из нажатия и отпускания одного `Shift`, затем второго нажатия `Shift` не позднее чем через `400ms`.
- Между двумя нажатиями не должно быть другой клавиши.
- `KeyboardEvent.repeat`, незавершённая IME composition и комбинация `Shift` с другим удерживаемым modifier игнорируются.
- Shortcut работает независимо от обычного DOM-фокуса на странице игры, но не срабатывает, пока открыт редактор заметки, settings/diff/progress dialog, lightbox или другой modal-инструмент.
- При открытии запрос пуст, слева показаны валидные recent items текущей игры в порядке последнего успешного изменения через palette, первый recent item выбран для preview, а фокус находится в search input.
- Если у текущей игры нет валидной истории, результаты и preview пусты без отдельного placeholder.
- `Escape` закрывает palette из любого её внутреннего состояния и возвращает фокус элементу, который был активен перед открытием.
- Закрытие очищает запрос, визуальный выбор, ошибки и локальное optimistic state palette.

## Два режима клавиатуры

### Режим ввода

- Фокус находится в search input.
- `Space` вводит обычный пробел, поэтому доступны многословные запросы.
- `ArrowDown` переводит фокус на первый результат.
- `ArrowUp` переводит фокус на последний результат.
- После появления непустого набора matches первый результат обязательно выбирается визуально для preview, пока DOM-фокус остаётся в input; `Space` при этом не изменяет его состояние.

### Режим результатов

- `ArrowDown` и `ArrowUp` перемещают выбор без циклического wrap.
- `ArrowUp` на первом результате возвращает фокус в search input; после этого `Space` снова печатает пробел.
- `ArrowDown` на последнем результате оставляет выбор на последнем результате.
- Ввод печатного символа или `Backspace` возвращает фокус в input и применяет ввод к запросу.
- `Space` применяет обычный checkbox transition.
- `Shift+Space` применяет partial transition.
- `Enter` переходит к выбранному пункту.

Изменение запроса обновляет результаты немедленно. Пустой query показывает recent history, непустой — fuzzy matches. Если предыдущий выбранный item остаётся в новом наборе, выбор сохраняется по его identity. Иначе выбирается первый результат: в input mode только визуально, а в result mode с переносом DOM-фокуса на его row. Если новый набор пуст, фокус возвращается в input.

## Мышь

- Наведение на результат меняет визуальный выбор и preview, не перемещая DOM-фокус из input.
- Клик по телу результата выполняет тот же переход, что и `Enter`.
- Обычный клик по чекбоксу выполняет обычный transition и не закрывает palette.
- `Shift+Click` по чекбоксу выполняет partial transition и не закрывает palette.
- `Cmd+Click` по чекбоксу выполняет тот же partial transition и не закрывает palette.
- Клик за пределами palette закрывает её и восстанавливает предыдущий фокус, если целевой элемент всё ещё существует.

## Единый tri-state контракт

Правило применяется к task items Markdown-списков, task cells Markdown-таблиц и чекбоксам результатов поиска.

| Действие | `[ ]` | `[x]` | `[-]` |
|---|---|---|---|
| Обычный клик / `Space` | `[x]` | `[ ]` | `[x]` |
| `Shift+Click` / `Cmd+Click` / `Shift+Space` | `[-]` | `[-]` | `[ ]` |

`Shift+Click` и `Cmd+Click` полностью равнозначны. `Ctrl+Click` не получает специального tri-state поведения. `Cmd+Space` остаётся системным shortcut и не регистрируется приложением.

## Общий fuzzy search

### Выделение общей ответственности

Текущие `normalized`, keyboard-layout variants, Damerau-Levenshtein edit distance, initials и subsequence scoring переносятся из `catalogue.ts` в общий domain-модуль fuzzy search. Новый модуль не знает о `Game`, `Note`, React или DOM.

Он принимает:

- query;
- primary text fields;
- secondary text fields с identity, достаточной для определения лучшего совпавшего поля.

Он возвращает детерминированный finite score либо отсутствие совпадения, а также identity лучшего поля для потребителей, которым нужен preview. Точное совпадение, prefix и direct substring всегда ранжируются выше fuzzy-вариантов. Primary field всегда получает преимущество перед эквивалентным secondary match.

### Общее поведение

Общий scorer сохраняет:

- Unicode normalization и приведение `ё` к `е`;
- русскую/английскую keyboard-layout substitution;
- title/primary initialisms;
- direct substring и word matching;
- Damerau-Levenshtein substitutions, insertions, deletions и соседние transpositions;
- AND между непустыми query terms.

Subsequence matching больше не имеет жёсткого ограничения `gap <= max(2, floor(term.length / 2))`. Для query длиной не менее трёх символов любое сохраняющее порядок subsequence может совпасть; число пропусков, плотность и span повышают score и поэтому опускают слабые совпадения ниже сильных. Короткие запросы не получают чрезмерно широкого fuzzy matching.

Edit-distance tolerance остаётся зависящей от длины, но становится общей настройкой scorer, а не правилом игр. Несколько допустимых transpositions получают последовательный penalty вместо отдельной checklist-эвристики.

### Поиск игр

`gameSearchScore` сохраняется как совместимый wrapper общего scorer:

- primary field — `game.title`;
- secondary fields — platforms и tags;
- существующие filter semantics, catalog URL и видимый `GlobalGameSearch` не меняются;
- улучшенная subsequence tolerance автоматически становится доступна поиску игр;
- существующий порядок exact/prefix/title/secondary/fuzzy результатов сохраняется контрактными тестами.

### Поиск чеклистов

- primary field — plain text checklist item после удаления Markdown decoration при сохранении видимого текста;
- secondary fields — plain `description` каждого simple hover tooltip и plain searchable text каждого валидного rich-tooltip definition внутри item;
- несколько query terms могут совпасть в разных полях одного item;
- item text outranks эквивалентный annotation match;
- результаты сортируются по score, затем по порядку заметок на странице, source line и source column;
- empty query не запускает fuzzy matching и вместо него проецирует recent history текущей игры;
- все finite matches показываются; искусственного лимита количества результатов нет.

## История недавних изменений

История является маленьким browser-local convenience cache и не входит в данные библиотеки.

- Запись добавляется только после успешного durable checkbox save, инициированного из palette.
- Обычные checkbox-взаимодействия непосредственно в заметке не попадают в эту историю.
- Повторное изменение того же item не создаёт дубликат, а перемещает его identity в начало.
- Хранятся только `gameId`, `noteId`, стабильная item identity и timestamp последнего успешного изменения. Текст пункта, path, Markdown и annotation bodies повторно не сохраняются.
- При открытии palette identities текущей игры разрешаются через свежий checklist index; исчезнувшие или больше неразрешимые записи удаляются.
- На одну игру хранится не больше `8` записей, на весь origin — не больше `24` записей.
- Сериализованный payload имеет дополнительный hard cap `8 KiB`; при превышении старейшие записи удаляются до попадания под предел.
- Хранилище использует отдельный versioned `localStorage` key. Ошибка чтения, записи или quota не блокирует checkbox save и не показывает ошибку библиотеки: история деградирует до in-memory состояния текущей page session и продолжает работать при повторном открытии palette до ухода со страницы.
- Empty-query state показывает recent items текущей игры без дополнительного видимого заголовка, счётчика или отдельного визуального типа строки. Порядок — от последнего изменения к более старым; preview и все checkbox/navigation actions работают как у fuzzy result.

## Checklist search index

Индекс строится чистой domain-функцией из актуальных заметок страницы.

Для каждого task item или task table cell запись содержит:

- `noteId`/`clientId`;
- текущее `MarkdownTaskState`;
- исходный Markdown текста и plain display/search text;
- source line и task source column;
- стабильный item identity на время текущей версии Markdown;
- structural item id, когда он доступен;
- ancestor heading/group collapse ids;
- note title и компактный display path;
- упорядоченные annotation entries с типом `simple` или `rich`, видимой подписью и source order;
- simple tooltip descriptions;
- rich-tooltip anchors, валидные definition bodies и подготовленный searchable plain text каждого annotation entry.

Парсинг переиспользует `parseMarkdownBlocks`, `markdownInlineTokenPattern`, `parseMarkdownRichTooltips`, `parseMarkdownRichTooltipBody`, существующие source locations и collapse identities. Распознавание simple hover tooltip выносится из локального regex в `Markdown.tsx` в общий inline-annotation parser, которым пользуются и renderer, и checklist index. Отдельный regex-only parser задач или аннотаций в palette не создаётся.

Пустой simple description не индексируется как secondary field и не показывается в preview. Некорректная или незакрытая simple-конструкция остаётся частью обычного текста ровно по существующему Markdown-поведению. Невалидная, дублированная, пустая или отсутствующая rich-tooltip definition также не индексируется и не показывается в preview. Сам checklist item во всех случаях остаётся доступен по primary text.

Индекс пересобирается при изменении актуального Markdown заметки, состава/порядка заметок или их заголовочных путей. Checkbox marker updates не должны менять identity выбранного результата.

## Сохранение из palette

- Palette вычисляет новый Markdown через те же `setMarkdownTaskState` и table-cell state update primitives, которые использует обычный Markdown renderer.
- Table-cell primitive становится доступной общему interaction layer вместо дублирования строковой мутации в palette.
- Существующий `NoteInteractionSource.saveNoteInteraction` остаётся единственным durable path для сохранённых заметок.
- Palette применяет локальное optimistic state только к изменяемой заметке и блокирует повторное checkbox-действие для неё до завершения сохранения; поиск и навигация по другим результатам остаются доступны.
- После успеха authoritative note snapshot пересобирает индекс без закрытия palette.
- После успешного authoritative save item identity записывается в recent history и становится первым в empty-query state.
- Изменение `[ ]`, `[x]` или `[-]` не удаляет результат из открытой palette даже при включённом фильтре выполненных пунктов: индекс зависит от Markdown, а не от текущей видимости DOM.

При ошибке optimistic state откатывается к последнему authoritative snapshot. Palette остаётся открытой, фокус и выбранный result сохраняются, а в нижней области появляется одна компактная строка ошибки. Следующая успешная операция очищает ошибку.

## Переход к исходному пункту

Search result передаёт странице структурную цель: note identity, source location, structural item id и ancestor collapse ids.

Последовательность перехода:

1. palette закрывается;
2. нужная заметка получает search navigation request;
3. ancestor collapsed checklist ids удаляются через существующий persisted collapse interaction;
4. completed-filter reveal state временно включает structural item/section ids через существующий механизм reveal;
5. после commit render checkbox целевого пункта получает DOM focus;
6. целая строка плавно прокручивается в видимую область с разумным отступом от sticky header;
7. строка получает краткую instrumental-blue wash highlight, которая исчезает автоматически и отключается при `prefers-reduced-motion`.

Search navigation request передаётся note component явным prop/state channel. Custom DOM event и сканирование текста заметок не используются. DOM lookup разрешён только по сгенерированному target identity после того, как модель раскрытия уже обновлена.

Если authoritative Markdown изменился и target identity больше не существует, переход отменяется безопасно: palette не изменяет соседний пункт и фокус возвращается на страницу игры.

## Доступность

- Overlay имеет dialog semantics и доступное имя «Поиск по чеклистам».
- Search input использует combobox/grid pattern с `aria-controls` и `aria-activedescendant` в input mode: grid допускает отдельный интерактивный checkbox cell без вложения control в listbox option.
- Result rows и cells сообщают item text, путь и checkbox state, включая `aria-checked="mixed"` для `[-]`.
- Preview связан с выбранным option через доступное описание, но не дублирует весь длинный текст в имени option.
- Фокус остаётся внутри palette до закрытия; `Tab` не уходит под overlay.
- Checkbox mouse targets не теряют доступное имя после optimistic update.
- Save error объявляется один раз через спокойный `aria-live` region.
- `prefers-reduced-motion` отключает enter/exit animation и переход highlight, сохраняя статическую подсветку на короткий интервал.

## Проверка

### Общий fuzzy contract

Постоянные domain-тесты проверяют:

- normalization, `ё`/`е` и обе keyboard layouts;
- exact, prefix, substring, initials и primary/secondary weighting;
- пропуски с gap, который раньше превышал жёсткий предел;
- одну и несколько соседних transpositions;
- опечатки разной длины;
- AND между terms и deterministic tie-breaking;
- отсутствие чрезмерного fuzzy matching для запросов короче трёх символов;
- неизменность существующих search behavior игр и доступность новых улучшений через `gameSearchScore`.

### Checklist index

Fixture-based domain-тесты, не зависящие от `data/`, проверяют:

- nested list tasks и task table cells;
- note/heading/group path;
- source line, source column, structural id и ancestor collapse ids;
- несколько simple и rich tooltip в одном item с сохранением общего source order;
- поиск по simple plain-text description, rich Markdown body и definition-list values;
- empty/malformed simple tooltip и missing, duplicate, empty или malformed rich definitions;
- включение checked, indeterminate, collapsed и filter-hidden items;
- стабильную identity после изменения только task marker.

### Recent history

Storage/component tests проверяют:

- запись только после успешного palette save;
- отсутствие записей от обычных note checkbox interactions и failed save;
- deduplication и move-to-front;
- фильтрацию по текущей игре;
- лимиты `8` на игру, `24` глобально и hard cap `8 KiB`;
- разрешение через свежий index и pruning stale identities;
- безопасную деградацию при unavailable/corrupt/quota-failed `localStorage`;
- empty-query projection без дополнительного heading/count и с обычным preview/action behavior.

### Interaction tests

Component tests проверяют:

- одинаковый partial transition для `Shift+Click` и `Cmd+Click` в list/table tasks;
- отсутствие application handler для `Cmd+Space`;
- все переходы `[ ]`, `[x]`, `[-]` из таблицы tri-state contract;
- открытие только после полного double-Shift sequence;
- блокировку shortcut при editor/modal state;
- input/result focus modes, пробел в query и `ArrowUp` с первого результата обратно в input;
- ввод символа и `Backspace` из result mode;
- mouse hover preview, body click navigation и checkbox click без закрытия;
- optimistic save, pending guard, success refresh и error rollback;
- сохранение результата в palette при включённом completed filter;
- reveal collapsed/filter-hidden target, persisted collapse update, scroll, checkbox focus и transient highlight;
- focus restoration, outside click, `Escape`, focus trap и reduced motion.

### Визуальная проверка

Implementer и reviewer сравнивают финальную palette напрямую с `.superpowers/brainstorm/96049-1788248038/content/refined-two-pane-v5.html` и настоящей страницей игры при desktop viewports `1280×800` и `1440×900`.

Проверяются:

- ровно один центральный overlay;
- геометрия `690×366px` и колонки `44% / 56%`;
- ровно три постоянных элемента строки результата;
- отсутствие `height`/`min-height` у result row;
- симметричные вертикальные padding `7px`;
- input, recent-history, result-focus, hover, unchecked, checked, indeterminate, empty-history, no-results, saving и error states;
- preview без status chip, match-source labels, counters и metadata table;
- переход к пункту в idle, collapsed, completed-filter-hidden и reduced-motion states.

## Критерии готовности

Фича готова, когда:

1. double `Shift` открывает утверждённую palette на странице игры и нигде больше;
2. fuzzy query находит task item по собственному тексту, simple hover descriptions и каждой связанной валидной rich-аннотации;
3. расширенная fuzzy tolerance используется тем же общим scorer в поиске игр;
4. `Space`, `Shift+Space`, click, `Shift+Click` и `Cmd+Click` соблюдают единый tri-state contract в списках, таблицах и palette, а `Cmd+Space` не перехватывается;
5. `Enter` или click по result раскрывает скрытый target, прокручивает, фокусирует и подсвечивает именно его;
6. palette сохраняет простую утверждённую структуру и точную плотность строк;
7. ошибки не закрывают palette и не оставляют ложное checkbox state;
8. empty query показывает не больше восьми валидных recent items текущей игры из bounded browser-local cache, не дублирующего Markdown или аннотации;
9. focused tests, полный test suite и production build проходят без ошибок;
10. спецификация, implementation plan, реализация и тесты находятся в одном feature-коммите.
