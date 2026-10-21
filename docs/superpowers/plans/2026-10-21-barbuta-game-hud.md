# Barbuta game HUD plan

Spec: ../specs/2026-10-21-barbuta-game-hud-design.md
Files: authored `.../smart-notes/9846ccca-f748-4e79-a666-01c04aaf6e4a/page.js`
(только декоративный template) и `style.css` (crest, controls, compact mobile).
Модель и все обработчики остаются прежними. SVG-декор исключён из AX-дерева.

- [x] Субагент: реализовать выразительный компактный игровой декор сайдбара.
- [x] Контроллер: итоговая сборка/data validate, временная dist-only UI-фикстура.
- [x] Проверить desktop/mobile/read/editor/empty/error и геометрию, один scoped review.
- [x] Удалить QA-фикстуру, проверить jj status/diff, завершить отдельным jj describe/new.

Импорт не трогать, исходники во время UI-проверки не менять.
Уточнение до финализации: пользователь запретил внешнюю рамку сайдбара целиком.
Плетение, border, shadow и perimeter pseudo удалены; остаётся игровой crest.

## Проверка

`npm run build` и `npm run data:validate` прошли после финального удаления рамки.
Проверены read/editor, empty, hover/keyboard focus/selection и реальное HTTP404
временного ассета. Карта:64 ячейки,32:23,12px desktop/8px mobile. Превью:350px,
border0. Desktop1280×800/1470×864 и mobile390×844 без page/sidebar overflow.
После уточнения повторно сняты desktop/mobile: у inspector border0, shadow none,
before/after none; mobile editorbottom783.25<844. Внешней рамки нет.
Исполнитель и reviewer напрямую сверили финальные снимки с референсами.
Временная dist-only БД восстановлена, постоянных authored-data тестов нет.
