# Barbuta: комнаты вне сетки и связи

Пользователь: часть дверей ведёт в комнаты вне обычного грида. Эти комнаты
показывать отдельно, позволить указывать связи, подсвечивать соседей активной
комнаты. Уточнение: валидная миникарта без красной точки означает новую особую
комнату; импорт должен определять это автоматически в прежней загрузке пачкой.

## Поведение

- Обычная миникарта с одной точкой сохраняет импорт по координате8×8. Если HUD/
  миникарта распознаны, но ни одна клетка не имеет уверенной красной точки,
  создать отдельную комнату. Невалидный HUD и неоднозначные точки остаются ошибкой.
- Особые комнаты — отдельная горизонтальная полоса над grid, с теми же cropped
  изображениями/solved grayscale, компактными устойчивыми именамиX1,X2… . Полоса
  отсутствует, когда таких комнат нет; при множестве комнат прокручивается внутри.
  Основной grid всегда64 клетки,32:23. fitMap учитывает высоту полосы.
- Особая комната имеет тот же screenshot, Markdown/Edit, solved,400ms save.
  На странице ей можно дать понятное имя. Удаление особой комнаты удаляет её
  связи и asset references; framework штатно собирает неиспользуемые assets.
- В боковой панели выбранной комнаты компактный select «Связать с комнатой…»
  (grid и особые комнаты, без себя/уже связанных). Связь — двусторонняя дверь.
  Рядом компактные ссылки на соседей с отдельным удалением связи. Self-links и
  дубликаты запрещены. При выборе любой комнаты её соседи подсвечены на обеих
  областях карты; selected и related имеют разные внутренние контуры.
- Превью тоже показывает отдельные комнаты, клики открывают нужную комнату.
  В самой странице подсветка обновляется и снимается при смене выбора.
- Сохранить спокойные панели, постоянный placeholder, большую заметку, обычный
  размер карточки1×1, поля12/8px, отсутствие внешних рамок. На1280×800/1470×864/
  390×844 основная карта помещается; длинный ряд/список связей имеет свой scroll.
  Никаких новых игровых знаний/условий в сервисе, только authored note scripts.
- Не трогать FileList lifetime, Safari detached-byte decoding, crop/encoding и
  последовательность uploads. Тип импорта определяется отдельно для каждого файла.

## State и контракты между исполнителями

Оставить version1 и существующий `rooms`. Особые комнаты — ключи`extra:<uuid>` в
том же rooms; объект комнаты дополнительно содержит`title:string,order:number`.
`links?: [string,string][]` — уникальные неориентированные пары. Старый state без
этих полей читается без миграции. Не терять неизвестные поля или прежние заметки.

Model exports, которые используют view/page:
- `isGridKey(key)`, `isExtraKey(key)`, `extraKeys(value)`, `roomKeys(value)`.
- `label(key,value?)`: старые grid labels прежние, extra title по value.
- `addExtraRoom(value,key,patch={})`, `deleteExtraRoom(value,key)`.
- `setRoomLink(value,a,b,enabled=true)`, `linkedKeys(value,key)`.
- Существующие `room/changeRoom` работают с extra; extra сохраняется даже без
  картинки/текста до явного удаления. Grid deletion не удаляет графовую вершину.
- `locate(pixels)` возвращает grid key илиnull для валидной миникарты без точки.
- Preview selection принимает extra ids; page проверяет актуальность при mount.

View exports:
- Прежний `board(interactive,onSelect)` сохраняет контракт64 клеток.
- Новый `extraBoard(interactive,onSelect)` имеет тот же `{grid,render,focus}`.
  Создаёт/удаляет extra DOM по ключам стабильно; class`extra-board`, hidden когда0.
- Обе карты в render получают(value,selected,images), отмечают`linked` соседей.
  pictures.prune уже читает все rooms, обязательно сохраняет extra asset handles.
- CSS: .map-panel vertical gap10px; .extra-board single-row max-content cells88px
  (preview56px), overflow-x:auto. .linked выделение кремово-зелёное, selected розовое.
- Page добавляет `.room-links`, `.connection-list`, `.connect-room` под image/remove
  в inspector-room. Chips `.connection` с `.connection-open` и `.connection-remove`;
  список не выше48px. Select не выше28px, аккуратные отступы. Rename extra title
  внутри прежнего header, без новой постоянной строки; короткая кнопка edit рядом.

Page import: `extract(file).key===null` → upload как прежде, затем atomic
addExtraRoom(current,`extra:${crypto.randomUUID()}`,{image:ref}); id один на файл.
Каждый импорт без точки создаёт отдельную комнату; никакого угадывания идентичности
разных скринов. Grid imports по-прежнему заменяют по координате. Счётчик/labels
отражают оба типа. Явное удаление extra удаляет комнату целиком, не только image.

## Проверка

Временные synthetic-data проверки model: legacy state, отсутствие точки/одна/
неоднозначная/невалидный HUD; add/change/delete extra, порядок и названия, links
reverse dedupe/self/missing ids, cleanup edges, сохранение grid данных. JS checks,
итоговая build/data validate. UI: extra strip и main64, выбор с обеих сторон и
снятие highlight, add/remove link, rename/delete extra, Markdown/editor stable,
preview open, desktop/mobile fit. Убедиться, что обычный batch и Safari FileList
код неизменны. Проверки конкретных authored-data только временные.

Визуальный baseline последнего одобренного layout:
`/Users/kana/.codex/visualizations/2026/10/21/01a15d41-7efa-71c3-8e61-03c56470c9cb/barbuta-rhythm-1470-empty.png`.
Исполнитель/reviewer читают baseline и финальные снимки напрямую. Допускаются
только описанная полоса и функциональные controls; внешние рамки не возвращать.
