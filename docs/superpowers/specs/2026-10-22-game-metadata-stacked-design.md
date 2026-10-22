# Полные строки статуса и тира в боковой панели

Reference дефекта: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_9eoOYU/Screenshot 2026-10-22 at 06.07.49.png`.
Пользователь прямо просит рендерить статус/тир без __short в этом режиме.
В терминах кода это sidebarLayoutMode=side: обложка сверху боковой колонки,
детали под ней, заметки справа.

- В side mode status и tier не получают game-sidebar__meta-short.
  Применяется обычный metadata block: каждый занимает полную строку grid,
  dt над dd. Статус и тир идут друг за другом, без тесной пары в одной строке.
- В top mode оставить два meta-short блока в паре, как на первом нормативном
  скрине из запроса; сохранить исправленные в предыдущем коммите разделители.
- Сохранить четыре metadata блока/order status,tier,platforms,tags, один
  title, badges, select editing/save/cancel, progress и cover; не менять
  responsive tracks, порядок остальных контейнеров или формат данных.
- В DESIGN.md указать, что compact inline metadata относится только к top.

Проверка: generic mode-specific GamePage regression (0 short в side,2 в top,
четыре блока и порядок сохранены; переключение preference). Реальный browser:
side dt над dd, каждый block полной ширины, top пара сохранена, desktop/mobile.
Исполнитель/reviewer непосредственно смотрят reference и итоговые скрины.
Focused metadata/layout/editing checks и build; никаких data-specific тестов.
