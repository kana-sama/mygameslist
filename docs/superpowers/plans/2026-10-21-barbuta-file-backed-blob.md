# Barbuta file-backed Blob fix

Spec: ../specs/2026-10-21-barbuta-file-backed-blob-design.md

- [x] Воспроизвести сбой на оригинальном файле в native Safari и сравнить
  disk-backed URL с ArrayBuffer → memory Blob.
- [x] Субагент: временная red/green проверка отказа disk-backed Blob;
  минимальная правка images.js, read/decode ошибки и освобождение ресурсов;
  удержание выбранного FileList до окончания общей очереди в page.js.
- [x] Native Safari: исходный файл из Desktop и повтор;
  очередь с ошибкой через mounted-page fixtures; проверить координату E4
  и картинку, build/data:validate, scoped review.
- [x] Удалить временные фикстуры, проверить jj status/diff и завершить
  одним коммитом jj describe/new.

Диагностика: один memory Blob фикс не прошёл полный native Safari UI —
arrayBuffer отказал при немедленной очистке input. Пользователь подтвердил
контрольный одиночный extract без очистки input на оригинале: 4,3, размер в bytes.
Проверка FileList lifetime добавлена в тот же незавершённый фикс.

Проверено после правок: 12 временных extract-сценариев и 6 mounted-page
сценариев прошли после наблюдаемого red; последние покрывают delayed read,
перекрывающиеся выборы, плохой файл, повторный выбор, picker/drop/paste и dispose.
Оба node --check, итоговые build/data:validate прошли; временные верификаторы
и публичная diagnostic-страница удалены. Scoped review без замечаний.
Полный npm test до page.js правки: 2525 passed, 22 skipped; после неё выполнены
6 целевых mounted-page проверок вместо повторного полного прогона.

Финальный native Safari UI-тест выполнен пользователем на отдельном origin
127.0.0.1:5191: оригинальный файл, затем повторный выбор (E4, заменено 1).
Пользователь подтвердил: «Да, оба импорта работают». Финальный AX/screenshot
также показывает загруженную комнату E4 и её изображение. Проверка завершена;
тестовая вкладка и сервер закрыты, локальные заметки на localhost:5173 не менялись.
