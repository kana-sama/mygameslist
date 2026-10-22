# Smart-note stylesheet loading implementation plan

Spec: ../specs/2026-10-22-smart-note-styles-loading-design.md

- [x] Один subagent: воспроизвести раннее раскрытие в generic host tests,
  реализовать отслеживание CSS и скрытие до готовности; покрыть lifecycle/error.
  Файлы: SmartNote.tsx, smartNote.css, при необходимости небольшой helper,
  tests/smart-note-ui.test.tsx и focused helper tests. Обновить docs/smart-notes.md.
- [x] Контроллер: проверить итоговую diff, штатные тесты и build; временный
  generic browser fixture с задержкой CSS для preview/page; удалить fixture.
- [x] Независимый scoped review; исправить существенные замечания, если есть.
- [x] jj status/diff, финализировать один commit через jj describe и jj new.

Ограничения: не менять authored notes и внешний вид готовых представлений,
не сбрасывать layout через display:none, не менять public API. Все задачи
относятся к одной ошибке хоста.

## Выполнение и проверка

- Причина воспроизведена до исправления в браузере: два ожидающих CSS,
  `aria-busy=false`, нет загрузки, изображение показано в размере 1800×1200.
- Регрессии наблюдались в RED до исправлений. Итоговые focused host/helper
  проверки: 28 прошли, включая вложенные стили, cached completion в одном
  React batch, CSS error/retry и поздний cleanup асинхронного mount.
- Настоящая задержка CSS в браузере: preview/page скрыты и inert; после первого
  файла из двух остаётся загрузка; после последнего появляется оформленный DOM.
  Скрытая страница имеет измеряемый host 1232×616, размеры и scroll не раздуваются.
  Закрытие во время ожидания и повторное открытие тоже проверены.
- Reviewer нашёл пропущенный ShadowRoot непосредственно на mount root. Добавлен
  regression test и обход этого root; повторное scoped review без замечаний.
- Финальные `npm test`: 131 файл, 2535 passed, 22 skipped; `npm run build` успешен.
  У сборки остаётся прежнее предупреждение о больших chunks.
- Временные browser fixture/server удалены; authored data и public API не менялись.
