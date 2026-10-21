# Smart note Markdown UI implementation plan

Spec: ../specs/2026-10-21-smart-note-markdown-ui-design.md

- [x] Субагент A: общий контракт UI, React bridge с существующими MarkdownView/
  lazy MonacoNoteEditor, контекст/Shadow DOM styles/cleanup; синтетические тесты
  и docs/smart-notes.md. Только код сервиса и общие тесты.
- [x] Субагент B параллельно: только page.js/style.css Barbuta, перейти на
  утверждённый API, режимы просмотр/редактирование, сохранить debounce/черновики.
- [x] Субагент C: глобальный поиск должен учитывать composedPath редактируемого
  поля и defaultPrevented; синтетическая регрессия ввода Markdown через Shadow DOM.
- [x] Контроллер: объединённые focused tests, build/data:validate и браузерная
  проверка обоих режимов, lifecycle и размеров; один scoped review в конце.
- [x] Проверить jj status/diff, завершить одним коммитом jj describe/new.

Контракт API выше общий для обоих исполнителей; файлы реализаций не пересекаются.
Спецификация и план входят в тот же коммит, промежуточных коммитов нет.

Проверено: 250 тестов в 11 профильных файлах, tsc/production build и
data:validate прошли. Постоянные тесты используют синтетические заметки;
временная проверка Barbuta удалена после debounce/drafts/finish/error/retry/cleanup.

В реальном браузере: до нажатия edit — 0 Monaco; после — штатный editor с
фокусом, русским вводом, подсветкой и целой ссылкой https://example.com/a/b.
Готово и Escape удаляют editor, возвращают Markdown и сохраняют текст.
Чекбокс Markdown меняет источник; закрытие и reload сохраняют изменения.
В реальном Monaco обнаружен native-edit-context (div role=textbox), поэтому
глобальный поиск учитывает и виртуальные поля; регрессии fail-before/pass-after.

1280×800: 64 ячейки, края карты отличаются от рабочей области на 0/0/0.0625px,
сайдбар 271.875px, прокрутки страницы нет. 390×844: карта во всю ширину,
сайдбар ниже, editor 358×240px, горизонтального overflow нет. Исполнитель и
независимый reviewer сравнили итоговые read/edit screenshots обоих размеров с
исходными reference и утверждённой компоновкой; замечаний нет.
