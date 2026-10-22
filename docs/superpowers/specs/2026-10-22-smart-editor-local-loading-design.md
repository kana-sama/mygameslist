# Локальная холодная загрузка редактора смарт-заметки

Нормативная запись пользователя:
`/Users/kana/Desktop/Screen Recording 2026-10-22 at 06.12.02.mov`.
Извлечённые reference кадры: `/private/tmp/smart-editor-flash-frames/frame-05.png`
(страница перед открытием), `frame-06.png` (всё содержимое исчезло),
`frame-07.png` (страница вернулась, локальная загрузка редактора),
`frame-10.png` (редактор готов). Scene transitions примерно0.517 и0.633 секунды.

Диагноз для проверки: service UI зеркалит глобальные stylesheet links в новые
Shadow DOM, а общий observeSmartNoteStyles рекурсивно включает эти pending links
в загрузку всей заметки. mirrorStyles также заменяет стили уже готовых widgets
при появлении Monaco styles, создавая лишние pending links.

- При первом открытии редактора в готовой заметке карта, sidebar, header, фон,
  размеры, выбранная комната и уже готовые widgets остаются видимыми и стабильными.
- Загрузка lazy module и CSS редактора локальна области service editor; до
  готовности показывается штатный локальный loader, без неоформленного Monaco.
  CSS/ошибки widgets не должны повторно скрывать готовую authored страницу.
- Сохранить первоначальную загрузку authored программы и её stylesheet links,
  и скрытие при добавлении новых authored styles: без unstyled content.
- Service Markdown/editor имеют собственную корректную готовность стилей; при
  зеркалировании не заменять без необходимости уже готовые stylesheet nodes.
  Сохранить живые inline/Monaco styles, defaults, scoped theme и error/cleanup.
- Не менять authored скрипты/state, загрузку изображений, API, готовый дизайн,
  редактирование текста, focus, beforeClose. Никаких таймеров, скрывающих мигание.
- Общее решение для любых smart notes, без Barbuta-specific селекторов/данных.

Проверка: generic regression воспроизводит исходное скрытие готовой страницы
при создании editor с задержанным CSS и при новых/обновлённых service styles.
Локальный loader/ready/error, сохранение ready siblings, cleanup/late events.
Browser холодная lazy/CSS загрузка (уникальный тестовый origin/ресурс),
готовая карта остаётся видимой, геометрия не меняется; desktop/mobile.
Исполнитель/reviewer напрямую смотрят запись/кадры и итоговые screenshots.
Focused host/widget/styles tests и build в конце; никаких data-specific тестов.
