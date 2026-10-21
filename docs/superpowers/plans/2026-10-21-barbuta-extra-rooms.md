# Barbuta extra rooms plan

Spec: ../specs/2026-10-21-barbuta-extra-rooms-design.md

- [x] Model subagent: version1-compatible extra rooms/links и no-red-point locate;
  временные synthetic-data проверки, удалить их перед финализацией.
- [x] View subagent: extraBoard, highlights, preview и compact presentation CSS.
- [x] Page subagent: автоматический import, select/rename/delete/link UI, fitMap
  с учётом extra strip; беречь существующий FileList/save/editor lifecycle.
- [x] Контроллер: интеграция и одна итоговая build/data validation; временная
  dist-only UI-фикстура, focused browser checks desktop/mobile, один scoped review.
- [x] Удалить QA-фикстуры; перед финализацией проверить jj status/diff,
  сохранить один commit через jj describe и создать чистое изменение jj new.

## Итоговая проверка

- Временные проверки модели: 9/9; старый state и неизвестные поля сохранены,
  связи двусторонние, дубликаты/некорректные вершины исключены, удаление чистит связи.
- `npm run build` и `npm run data:validate` завершились успешно. `images.js`
  и обработка срока жизни FileList не изменены.
- Браузерный импорт настоящего JPEG и его варианта без точки: E4 и X1 созданы
  одной пачкой. Повторная пачка заменила E4 и добавила X2, сохранив заметку E4.
  Временная проверка использовала настоящий extract и обработчик FileList.
- В приложении проверены выбор/подсветка в обе стороны, добавление/удаление
  связи, переименование, preview и удаление комнаты с несохранённым черновиком
  перед немедленным закрытием. Удалённая комната не восстанавливается.
- На 1470×864, 1280×800 и 390×844 остаются 64 клетки; карта и панели
  помещаются без переполнения. Мобильная заметка сохраняет высоту 176px.
- Исполнитель и независимый reviewer напрямую сравнили baseline и шесть
  итоговых снимков: grid/extra selection, desktop/mobile editor, empty, preview.
  Замечаний нет; внешние рамки не возвращены.
- Все временные фикстуры и verifiers удалены, dist-only seed восстановлен,
  QA-сервер остановлен. Постоянные тесты authored data не добавлялись.
