# Close icon plan

- [x] Субагент: проверить glyph/CSS и заменить на центрированную SVG без изменения поведения.
- [x] Проверить сборку и UI, сверить референс исполнителем и reviewer.
- [x] Просмотреть jj status/diff, завершить отдельным jj describe/new.

`npm run build`: exit 0. На 1470×864 кнопка 32×32, SVG 24×24;
смещение центров [0,0]. Enter закрывает modal и возвращает focus на Barbuta.
Исполнитель и reviewer напрямую сравнили референс с `barbuta-close-icon.png`:
замечаний нет. Размер header, label и обработчик сохранены.
