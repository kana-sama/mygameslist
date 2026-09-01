# Rich Markdown tooltips для заметок

## Статус

Согласованный дизайн фичи. Реализация описана в `docs/superpowers/plans/2026-08-30-markdown-rich-tooltips.md`.

## Контекст

Текущий синтаксис `[text]("description")` создаёт нативную браузерную подсказку через атрибут `title`. Такая подсказка принимает только plain text, зависит от hover-поведения браузера и заставляет хранить всё описание непосредственно рядом с каждым вхождением текста.

Новая фича добавляет отдельный тип rich tooltip:

- inline остаётся только короткая ссылка на определение;
- определения хранятся внизу авторского Markdown заметки;
- содержимое определения рендерится как Markdown;
- tooltip открывается по клику и остаётся открытым до явного закрытия;
- на широком экране tooltip всегда находится визуально вне заметки;
- на узком экране tooltip становится полноэкранной modal-карточкой.

Старый `[text]("description")` не мигрируется и не изменяется в рамках этой фичи. Перевод существующего контента на новый формат является отдельной будущей задачей.

## Цели

1. Убрать длинное содержимое rich tooltip из inline-текста заметки.
2. Разрешить в tooltip весь поддерживаемый приложением Markdown, а не только plain text.
3. Сохранить компактный и узнаваемый trigger с dashed-подчёркиванием.
4. Не перекрывать заметку tooltip-карточкой на экранах, где рядом с заметкой достаточно места.
5. Сделать открытый tooltip устойчивым: он не зависит от hover, mouseleave или прокрутки заметки.
6. Дать структурированное представление для пар «лейбл → описание» без громоздкой Markdown-таблицы.

## Не входит в задачу

- Миграция существующих `[text]("description")` в новый формат.
- Удаление или изменение legacy-синтаксиса `[text]("description")`.
- Автоматическое создание rich-tooltip references или definitions в редакторе.
- Отдельный визуальный редактор определений.
- Изменение обычных Markdown-ссылок, изображений, вложений или attachment projection.
- Data-specific постоянные тесты, перечисляющие реальные заметки или tooltip из `data/`.

## Канонический синтаксис

### Inline-reference

Rich tooltip вызывается конструкцией:

```md
[**Eternal Rest**][?]
```

- `**Eternal Rest**` — видимая inline-подпись, источник заголовка открытой карточки и единственный источник anchor.
- Пустой destination `[?]` является обязательным и отделяет rich tooltip от обычного reference link.
- Подпись поддерживает существующий inline Markdown, разрешённый внутри подписей ссылок и legacy tooltip.
- Заголовок карточки и anchor получают одно и то же plain-text представление отрендеренной подписи. Служебные Markdown-маркеры в них не попадают.
- Несколько inline-reference с одинаковым plain-text anchor используют одно тело определения.

### Plain-text anchor

Anchor вычисляется из видимой подписи:

```md
[**Eternal Rest**][?] → Eternal Rest
```

Правила:

- inline Markdown раскрывается в то же plain-text значение, которое используется как заголовок карточки;
- внешние пробелы удаляются, внутренние пробелы сохраняются;
- сравнение anchor чувствительно к регистру и не выполняет Unicode-нормализацию;
- Unicode, пробелы и пунктуация разрешены, кроме закрывающей `]` и перевода строки, зарезервированных грамматикой opener;
- slug, kebab-case и отдельный пользовательский идентификатор отсутствуют;
- anchor обязан быть непустым и уникальным среди definitions одного документа.

### Определение

Определение располагается в терминальной секции авторского тела заметки:

```md
[?Eternal Rest]:
    **Vault of Heroes** · Lower Level

    - Доступно после главы 8
    - Время суток не важно
```

Правила определения:

- opener `[?Plain-text anchor]:` начинается с первой колонки;
- непустые строки тела имеют как минимум четыре ведущих пробела;
- перед рендерингом один уровень из четырёх пробелов удаляется;
- пустые строки внутри тела разрешены;
- определение завершается перед следующим `[?Plain-text anchor]:` в первой колонке либо перед концом авторского тела;
- пустое определение невалидно;
- тело поддерживает существующий Markdown приложения: абзацы, emphasis, strong, code, spoilers, безопасные ссылки, изображения, списки, таблицы, block code и другие уже поддерживаемые блоки;
- вложенный rich-tooltip reference внутри тела определения не поддерживается и считается невалидным, чтобы не создавать рекурсивные popover;
- raw HTML и небезопасные URL продолжают запрещаться существующей валидацией.

### Расположение определений в файле

Все rich-tooltip definitions образуют одну непрерывную терминальную секцию внизу авторского Markdown. После первого `[?Plain-text anchor]:` разрешены только тела определений, следующие definitions и пустые строки.

Для заметки без вложений секция заканчивается концом файла. Для заметки с вложениями definitions находятся непосредственно перед генерируемой attachment projection:

```md
Основной текст заметки.

[?Eternal Rest]:
    Содержимое tooltip.

<!-- mygameslist-attachments:v1:start -->
## Вложения
...
<!-- mygameslist-attachments:v1:end -->
```

Attachment projection остаётся генерируемой частью source document и не входит в авторское тело definitions.

Definitions не отображаются внизу заметки и не участвуют в основной блочной структуре заметки, её headings, checklist progress, collapse state или completed-item filtering. Они остаются видимыми как исходный текст в Monaco editor и в Markdown diff.

## Definition list для пар «лейбл → описание»

В теле rich tooltip поддерживается block-синтаксис definition list:

```md
Локация
: **Vault of Heroes**

Уровень
: Lower Level

Участники
: Rex, Mòrag, Brighid, Pandoria и Zeke
```

После внешнего четырёхпробельного dedent полного определения эта конструкция разбирается следующим образом:

- строка термина становится лейблом;
- непосредственно следующая строка, начинающаяся с `: `, становится описанием;
- между соседними парами разрешена одна или несколько пустых строк;
- лейбл и описание поддерживают inline Markdown;
- описание одной пары остаётся однострочным; сложное многоабзацное содержимое записывается как обычный Markdown после definition list;
- одна или несколько последовательных пар образуют один визуальный список;
- обычный текст, не соответствующий паре `term` + `: description`, сохраняет обычное Markdown-поведение.

Полный рекомендуемый пример:

```md
После прибытия откроется [Eternal Rest][?].

[?Eternal Rest]:
    Локация
    : **Vault of Heroes**

    Уровень
    : Lower Level

    Участники
    : Rex, Mòrag, Brighid, Pandoria и Zeke

    - Доступно после главы 8
    - Время суток не важно
```

## Legacy tooltip

Существующая конструкция:

```md
[text]("plain description")
```

остаётся отдельным legacy-типом:

- продолжает рендериться как неинтерактивный `span` с нативным `title`;
- сохраняет `cursor: help` и текущее hover-поведение браузера;
- не использует definitions, внешний popover или mobile modal;
- не конвертируется автоматически при загрузке, редактировании, сохранении или публикации;
- остаётся валидной до отдельной задачи миграции и последующего решения об удалении legacy-поддержки.

## Архитектура рендеринга

### Разбор документа

До существующего block parsing отдельный parser rich tooltip разделяет Markdown на:

1. видимое авторское тело без терминальной секции definitions;
2. карту `plain-text anchor → definition body` с исходными диапазонами;
3. диагностическую информацию о некорректных definitions и references.

Inline tokenizer получает отдельный token для `[label][?]`. Обычные links и `[text]("description")` сохраняют собственные токены и прежнюю семантику. Экранированный `\[label][?]` остаётся буквальным неинтерактивным текстом, а rich-looking текст внутри URL/title обычной ссылки или description legacy hover hint относится к metadata внешней конструкции и не считается reference.

Domain parser, inline tokenizer/rendering и source-range projection используют одинаковые escape, token-boundary и plain-text-anchor правила. References или definition openers не распознаются внутри inline code, fenced code blocks и экранированных конструкций.

### Компонентные границы

Фича разделяется на независимые единицы:

- parser definitions отвечает только за terminal section, anchors, dedent и диагностику;
- inline parser отвечает только за распознавание trigger и source ranges;
- tooltip Markdown renderer отвечает за тело definition и definition-list rows;
- positioning layer отвечает только за desktop placement, vertical clamping и mobile mode;
- note integration передаёт positioning layer DOM-границы note surface и scroll viewport;
- domain validation проверяет ссылки между references и definitions без зависимости от реального содержимого `data/`.

Markdown body получает стабильный context только с командами открытия и узкой подпиской на active source. Изменение active source публикуется trigger-компонентам; каждый trigger обновляет только собственный `aria-expanded`, а sibling `MarkdownView` trees не реконструируются при открытии или закрытии карточки.

Tooltip layer рендерится через portal вне `.note-card__surface`, `.note-card__viewport-frame` и других clipping-контейнеров заметки. Содержимое карточки не может стать дочерним DOM-элементом заметки и не влияет на её размеры, masonry/shelf packing или scroll height.

В каждый момент открыта максимум одна rich-tooltip карточка во всём интерфейсе заметок.

### Заметка и её заголовок

- Каждая заметка в view mode всегда имеет видимый заголовок в верхней части note surface; titleless-вариант для этой фичи не проектируется.
- Заголовок заметки остаётся закреплённым при внутренней прокрутке её Markdown-содержимого.
- Заголовок входит в визуальные вертикальные границы заметки, за которые desktop tooltip не может выходить.
- Заголовок tooltip не копирует заголовок заметки: он всегда повторяет подпись конкретного trigger.

### Data flow

1. Note Markdown разбирается на видимое тело и definitions.
2. Видимое тело проходит существующий block/inline rendering.
3. Inline-reference получает plain-text anchor/title из фактически отрендеренной подписи, неинтерактивно rendered label и source element ref. Внутри outer trigger не создаются вложенные links, buttons или интерактивные spoilers; безопасные inline-форматы вроде emphasis, strong и code сохраняются.
4. Клик передаёт active reference, definition body, note surface и source element в tooltip layer.
5. Tooltip layer выбирает desktop side либо mobile modal mode.
6. Definition body рендерится существующими Markdown primitives в read-only tooltip context.
7. Закрытие очищает active reference, но не меняет Markdown или scroll position заметки.

Tooltip Markdown является представлением исходника. Интерактивные inline-элементы вроде безопасных ссылок и spoilers сохраняют своё поведение. Checklist controls внутри definition отображаются read-only и не изменяют исходный Markdown из popover.

## Trigger: внешний вид и состояния

Rich-tooltip trigger визуально продолжает существующий язык hover hint:

- цвет в idle наследуется от окружающего текста;
- underline: `1px dashed`;
- underline offset: `2px`;
- фон и постоянная рамка отсутствуют;
- курсор: `pointer`, а не `help`;
- hover не открывает и не закрывает карточку;
- на hover и в открытом состоянии текст становится `#f0f5f8`, а underline использует `var(--accent-strong)`;
- `focus-visible` получает `2px solid var(--accent-strong)` с offset `2px` и радиусом `2px`;
- открытый trigger получает `aria-expanded="true"`, закрытый — `false`;
- trigger связан с карточкой через `aria-controls`.

Никаких дополнительных иконок, фоновых pills, внешнего link color или декоративных маркеров рядом с trigger нет.

## Desktop tooltip

### Геометрия

Desktop mode используется только когда хотя бы с одной горизонтальной стороны note surface доступны полная ширина карточки и зазор:

- ширина карточки: `344px`;
- зазор от note surface: `14px`;
- предпочтительная сторона: справа;
- fallback: слева, когда справа недостаточно места, а слева достаточно;
- если ни одна сторона не вмещает `344px + 14px`, используется mobile/fullscreen mode независимо от типа pointing device.

Карточка всегда целиком находится визуально вне прямоугольника заметки и не перекрывает её border, заголовок, текст, attachments или actions.

### Вертикальная привязка

- source point — вертикальный центр нажатого trigger;
- в свободном положении стрелка указывает на source point, а её центр расположен примерно на `31px` ниже верхней грани карточки, рядом с header;
- верх карточки не может быть выше верхней границы note surface;
- низ карточки не может быть ниже нижней границы note surface;
- итоговая позиция вычисляется как desired top, ограниченный диапазоном от note top до `note bottom - tooltip height`;
- если карточка упирается в верхнюю или нижнюю границу, стрелка смещается вдоль боковой грани и продолжает указывать на source point;
- центр стрелки ограничен диапазоном от `18px` до `tooltip height - 18px`;
- максимальная внешняя высота карточки равна видимой высоте note surface;
- при превышении этой высоты прокручивается только body карточки; header остаётся на месте.

Desktop tooltip хранит `left` и `top` в системе координат документа и использует absolute positioning. Поэтому при прокрутке страницы браузер перемещает tooltip вместе с note surface без document-scroll listener, повторных geometry reads и React placement update. Позиция пересчитывается при внутренней прокрутке заметки, resize viewport, изменении размеров note surface и изменении размеров tooltip content. Каждый пересчёт переводит вычисленные viewport coordinates в document coordinates через текущие `window.scrollX` и `window.scrollY`. Прокрутка не закрывает карточку. Если source временно выходит за видимую область scrollable note, карточка остаётся открытой и прижимается к соответствующей вертикальной границе; стрелка также остаётся в допустимых пределах.

### Визуальный контракт

Контейнер:

- border: `1px solid #42454b`;
- border radius: `6px`;
- background: `var(--surface-2)`;
- shadow: `0 14px 34px rgba(0, 0, 0, .48)`;
- overflow скрывает содержимое за скруглением;
- backdrop или затемнение страницы отсутствуют.

Стрелка:

- двухслойный треугольный указатель: внешний слой рисует только две наклонные части `#42454b` outline, внутренний слой формирует поверхность указателя;
- основание внутреннего слоя перекрывает вертикальную border карточки, поэтому между стрелкой и карточкой нет линии или щели;
- поверхность стрелки точно продолжает вертикальные слои карточки: `#202226` напротив header, `1px var(--line-soft)` напротив divider и `var(--surface-2)` напротив body;
- если центр стрелки находится у границы header/body, соответствующие части header background, divider и body background одновременно продолжаются через стрелку без скачка цвета;
- выходит из левой грани при расположении справа и из правой грани при расположении слева;
- её вертикальное положение динамически следует за source point.

Header:

- минимальная высота `39px`;
- horizontal layout: заголовок слева, close button справа;
- padding: `5px 6px 5px 12px`;
- нижняя линия: `1px solid var(--line-soft)`;
- background: `#202226`;
- заголовок: `12px`, weight `650`, одна строка с безопасным ellipsis при нехватке места;
- заголовок повторяет plain-text подпись trigger;
- close button: `27px × 27px`, radius `4px`, transparent idle background, muted icon;
- hover close button: обычный text color и `rgba(255, 255, 255, .055)` background.

Body:

- padding: `12px`;
- font size: `12px`;
- line height: `1.48`;
- color: `#d6d7da`;
- собственный vertical scroll при переполнении;
- использует существующие стили Markdown, адаптированные к ширине карточки.

Definition list:

- каждая пара рендерится как grid `82px minmax(0, 1fr)`;
- column gap: `8px`;
- vertical padding строки: `6px`;
- строки разделяются `1px solid var(--line-soft)`;
- label использует `var(--muted-2)`;
- description использует `#d9dade`;
- длинные label и description переносятся, не расширяя карточку.

Открытие использует короткую анимацию `120ms ease-out`: opacity `0 → 1` и translateY `-3px → 0`. При `prefers-reduced-motion: reduce` движение отключается.

## Fullscreen modal на узком экране

Когда ни справа, ни слева от заметки нет места для desktop-карточки, тот же tooltip рендерится как полноэкранная modal-карточка:

- portal занимает `100dvw × 100dvh` поверх всего приложения;
- modal полностью закрывает находящийся под ней интерфейс;
- отдельная видимая карточка заметки под modal не сжимается и не перестраивается;
- background использует `var(--surface-2)`;
- header закреплён сверху и повторяет desktop header;
- header учитывает `env(safe-area-inset-top)`;
- close target имеет минимум `44px × 44px` на coarse pointer;
- body занимает оставшуюся высоту, прокручивается внутри и учитывает нижний safe area;
- заголовок повторяет подпись trigger;
- definition list и остальной Markdown визуально совпадают с desktop body;
- внешнего клика для закрытия нет, потому что modal занимает весь viewport;
- modal закрывается только кнопкой-крестиком.

Fullscreen mode использует `role="dialog"` и `aria-modal="true"`, удерживает keyboard focus внутри себя и при открытии переводит focus на close button. После закрытия focus возвращается исходному trigger.

## Interaction model

### Открытие

- `click` или keyboard activation на trigger открывает tooltip;
- hover, focus, mouseenter и touch preview сами по себе ничего не открывают;
- повторный клик на уже активный trigger не закрывает карточку;
- клик на другой rich-tooltip trigger заменяет содержимое единственной открытой карточки и перепозиционирует её к новому source;
- открытие не меняет scroll position заметки.

### Закрытие desktop-карточки

Desktop tooltip закрывается только:

1. кликом по close button;
2. кликом вне tooltip и вне его активного trigger.

Не закрывают tooltip:

- mouseleave trigger;
- mouseleave карточки;
- hover другого элемента;
- прокрутка заметки или страницы;
- resize;
- клик внутри карточки, включая ссылки, spoilers и прокрутку body;
- повторный клик активного trigger;
- клавиша Escape.

После close button focus возвращается trigger. После outside click focus остаётся на элементе, который получил клик.

### Закрытие fullscreen modal

Fullscreen modal закрывается только close button. Outside click отсутствует, hover/mouseleave/scroll/Escape modal не закрывают.

## Accessibility

- Trigger является настоящей кнопкой без button chrome, а не `span` с click handler.
- Доступное имя trigger совпадает с его видимой подписью.
- Trigger публикует `aria-expanded` и `aria-controls`.
- Desktop-карточка использует `role="dialog"`, `aria-modal="false"` и `aria-labelledby` на повторённый заголовок.
- Desktop open не крадёт focus у trigger; close button достижим следующим Tab-переходом.
- Fullscreen mode использует modal focus trap и возвращает focus при закрытии.
- Close button имеет доступное имя `Закрыть` и видимый символ `×`.
- Цвет не является единственным признаком trigger: dashed underline присутствует во всех состояниях.
- Keyboard и pointer activation дают одинаковое содержимое и positioning mode.

## Валидация и отказоустойчивость

Domain validation проверяет новый синтаксис независимо от реального authored corpus.

Блокирующие ошибки:

- один anchor определён более одного раза;
- reference или definition образует пустой anchor;
- definition пусто;
- terminal definition section прерывается обычным неиндентированным Markdown;
- definition содержит вложенный rich-tooltip reference;
- definition body нарушает существующие правила Markdown safety.

Связность references и definitions не является блокирующей domain-ошибкой. Отдельный pure audit возвращает два списка anchors в порядке первого появления:

- `missingBodyAnchors`: каждый уникальный reference, для которого нет корректного непустого definition;
- `unreferencedBodyAnchors`: каждый уникальный корректный непустой definition, на который не ссылается ни один reference.

Escaped syntax, inline/fenced code и metadata обычных links/legacy hints не создают save-warning. Если parser уже нашёл блокирующую ошибку, orphan-warning не перехватывает save-flow: submit проходит в обычную валидацию и показывает существующую ошибку. Повторные references одного anchor не дублируют строку предупреждения.

### Предупреждение при сохранении

Audit выполняется только перед явным авторским сохранением:

- существующая заметка — кнопка или keyboard-submit `Сохранить заметку` в открытом note editor;
- новая игра — общая кнопка или submit `Сохранить`, с агрегированием audit по всем draft notes.

Если audit находит `missingBodyAnchors` или `unreferencedBodyAnchors`, первое нажатие не вызывает persistence и оставляет редактор открытым. Непосредственно над действиями сохранения появляется жёлтый inline-warning с конкретными anchors:

- `Нет тела для: «Anchor»` для references без definition;
- `Нет ссылки для: «Anchor»` для definitions без reference;
- заключительная инструкция `Нажмите «Сохранить заметку» ещё раз, чтобы сохранить всё равно.` либо `Нажмите «Сохранить» ещё раз, чтобы сохранить всё равно.`.

Повторный submit сохраняет только тот же неизменённый Markdown-draft. Любое изменение Markdown после предупреждения сбрасывает подтверждение; следующий submit снова является первым. Cancel/unmount также уничтожает подтверждение. Успешное или неуспешное persistence не оставляет подтверждение для следующей редакторской сессии.

Жёлтый warning не обходит блокирующие Markdown/domain errors: повторный submit проходит обычный save pipeline и может получить красную ошибку. Checkbox/checklist interactions, collapse state, reorder, delete и другие неавторские/структурные сохранения не показывают это подтверждение и не блокируются им.

Preview не падает на временно невалидном тексте:

- missing или ambiguous reference отображает только отрендеренную подпись как обычный текст без dashed underline и click behavior;
- rich-looking reference с пустым anchor остаётся буквальным неинтерактивным исходным текстом;
- malformed definition, не распознанное как definition, остаётся обычным Markdown исходника;
- блокирующее диагностическое сообщение проходит через существующий validation/save flow; orphan audit добавляет только transient жёлтый warning внутри текущей authoring-сессии, без persistent badge или отдельного repair UI.

## Source ranges, редактирование и diff

- Inline source ranges сохраняют точные позиции подписи и reference suffix для существующего diff/decorations pipeline.
- Definition bodies сохраняют исходные диапазоны в полном `bodyMarkdown`, хотя исключаются из видимого note flow.
- Monaco редактирует полный исходник вместе с terminal definitions.
- Markdown diff показывает изменения definitions как обычные изменения source text.
- В rendered diff миграция checklist-строки из legacy `[Label]("description")` в `[Label][?]` с тем же rendered label отображается одной жёлтой строкой `Изменено`, без буквального `[?]` и без интерактивного tooltip. Одновременный переход checkbox state остаётся в той же жёлтой строке и показывает оба disabled состояния «было/стало». Точный legacy/rich source и terminal definitions остаются доступны в source mode как красно-зелёный diff.
- Checkbox state changes в основном теле не должны менять, переставлять или пересериализовывать definitions.
- Serialize/parse roundtrip сохраняет EOL style и содержимое definitions без нормализации авторского Markdown.

## Проверка

### Постоянные generic tests

Parser и validation fixtures, не связанные с реальными играми, проверяют:

- один и несколько references;
- переиспользование definition;
- plain-text anchor extraction для emphasis, strong, code, escapes, spoilers, links и literal punctuation;
- Unicode, spaces, punctuation, case sensitivity и empty-anchor rejection;
- terminal section extraction и четырёхпробельный dedent;
- definitions перед attachment projection;
- отсутствие распознавания внутри code spans и fenced code;
- escape и metadata boundaries для legacy hints и обычных links;
- дефисы как обычную пунктуацию title anchor, включая дефисы в начале, конце и подряд;
- missing, duplicate, empty и interrupted definitions;
- audit references без bodies и bodies без references, включая deduplication и source order;
- вложенный rich-tooltip reference как validation error;
- сохранение legacy `[text]("description")`;
- source roundtrip и CRLF/LF;
- definition list и обычный Markdown вокруг него.

Component tests проверяют:

- trigger является button с dashed underline, inherited idle color и `cursor: pointer`;
- hover не открывает карточку;
- click открывает, повторный click не закрывает;
- title повторяет plain-text label;
- trigger label не содержит вложенных интерактивных элементов, а accessible name совпадает с dialog title для literal punctuation, code, emphasis, escapes и spoilers;
- definition list рендерит label/value rows;
- ссылки, emphasis, code, spoilers, lists и tables рендерятся внутри body;
- click внутри, mouseleave и scroll не закрывают;
- close button и desktop outside click закрывают;
- второй trigger заменяет первый;
- открытие и закрытие не commit/reconstruct unrelated sibling `MarkdownView` body;
- tooltip portal находится вне note DOM и не меняет note geometry;
- right placement имеет приоритет;
- left fallback используется при нехватке места справа;
- top и bottom clamping удерживают карточку в note bounds;
- arrow остаётся привязанной к source при clamping;
- oversized body получает внутренний scroll и фиксированный header;
- отсутствие места с обеих сторон включает fullscreen mode;
- fullscreen modal имеет internal scroll, focus trap и закрывается только крестиком;
- первый explicit save при orphan reference/definition показывает жёлтый warning и не вызывает persistence;
- повторный save неизменённого Markdown вызывает persistence, а Markdown-изменение сбрасывает подтверждение;
- new-game save агрегирует warnings по всем draft notes;
- checklist и structural saves не требуют orphan-confirmation;
- legacy native tooltip продолжает прежнее поведение.

### Визуальная проверка

Перед завершением implementation implementer и reviewer сравнивают результат с этим контрактом:

- desktop `1440 × 900`: карточка справа, source возле верха, центра и низа scrollable note;
- constrained desktop/tablet `1024 × 768`: right preference и left fallback;
- mobile `390 × 844`: fullscreen modal, fixed header, internal body scroll и safe areas;
- idle, hover, focus-visible, open и close-button hover states;
- короткий tooltip, definition list, длинный scrollable Markdown и длинный заголовок;
- note scroll при открытом tooltip;
- отсутствие визуального перекрытия note surface в desktop mode.

### Команды проверки

Implementation plan должен включить focused tests изменённых parser/component/domain units, полный test suite и production build. Временная проверка authored `data/`, если она понадобится, удаляется до финализации feature commit.

## Критерии приёмки

Фича готова, когда:

1. `[label][?]` открывает `[?Plain label]:` definition по клику.
2. Definition хранится в терминальной секции внизу авторского Markdown.
3. Заголовок карточки точно повторяет plain-text label trigger.
4. Definition list отображает согласованные label/value rows.
5. Desktop tooltip всегда визуально находится вне заметки, предпочитает правую сторону и корректно переходит влево.
6. Верх и низ desktop tooltip никогда не выходят за границы note surface.
7. Прокрутка заметки перепозиционирует, но не закрывает tooltip.
8. Tooltip не открывается и не закрывается по hover или mouseleave.
9. Desktop tooltip закрывается только крестиком или outside click; fullscreen modal — только крестиком.
10. При нехватке бокового пространства используется полноэкранная modal-карточка с внутренним scroll.
11. Tooltip content не является дочерним элементом clipping-контейнеров заметки и не меняет layout заметок.
12. Legacy `[text]("description")` работает без изменений и не мигрируется.
13. Обычные Markdown links и остальной Markdown не получают регрессий.
14. Первый explicit save orphan reference/definition показывает жёлтый warning, а повторный submit неизменённого Markdown сохраняет.
15. Generic tests и build проходят, а permanent tests не зависят от конкретного authored corpus.
