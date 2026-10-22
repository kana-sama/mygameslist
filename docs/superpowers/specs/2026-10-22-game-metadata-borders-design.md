# Разделители метаданных верхней панели игры

Пользовательские reference:
1. Нормативный итог: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_W7nnH0/Screenshot 2026-10-22 at 06.06.50.png`.
2. Дефект: `/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_wwc9Pw/Screenshot 2026-10-22 at 06.06.57.png`.

В режиме sidebarLayoutMode=top сохранить cover → details → progress → tools,
один title и четыре metadata блока в порядке status/tier/platforms/tags.
Status/tier остаются компактной парой в одной строке. Изменить только линии:
- убрать верхнюю границу dl перед status/tier;
- убрать нижнюю границу последнего блока tags;
- сохранить границу после status/tier и после platforms;
- сохранить внешнюю нижнюю границу всей панели, рамки badges/cover, отступы,
  размеры, responsive tracks и все взаимодействия.
Правка scoped к top mode; боковая панель не меняется в этом коммите.
Второй отдельный запрос (убрать meta-short в side mode) — следующий коммит.

Проверка: временная fixture настоящего GamePage, computed borders именно dl
и его четырёх детей, top/side и узкая ширина; сравнить финальный top напрямую
с первым и вторым reference. Существующие focused layout checks и build.
Новых permanent CSS-source тестов не добавлять. В DESIGN.md закрепить правило.
