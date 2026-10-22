# Smart-note stable opening implementation plan

Spec: ../specs/2026-10-22-smart-note-stable-opening-design.md

- [x] Диагностический subagent: сравнить видео и текущий host/fitMap; подтвердить
  изменение геометрии из-за строки загрузки в потоке.
- [x] Implementer subagent: минимально устранить влияние page loader на layout,
  сохранив размеры при раскрытии; не вводить таймеры/новый API или authored edits.
  Основной файл: src/components/smart/smartNote.css; документация при необходимости.
- [x] Контроллер: временная browser fixture с настоящим page, покадровые размеры
  cold/warm и desktop/mobile, состояние с loader до React commit; focused tests/build.
- [x] Один scoped reviewer: сравнить с записью, проверить готовый layout и diff.
- [x] Удалить временные fixtures, jj status/diff, один jj describe и jj new.

## Результаты

- Два page-scoped CSS правила: loader вне потока и атомарное скрытие через
  существующий loading class. Готовый DOM и preview не менялись.
- В браузере настоящий page с временным state: cold/warm opening и сохранённый
  в DOM stale loader. На 1280×720 host остаётся 1232×616, карта 713.52×518.75,
  кнопка 450.48×36; присутствие loader не меняет ни одну величину.
- На 1470×864 карта 913.87×662.75, кнопка 440.13×36; на 390×844 карта
  322.52×235.75, кнопка 358×32. Первый видимый кадр совпадает с готовым layout,
  stale loader имеет display:none/position:absolute, font-size остаётся 12px.
- Исполнитель и независимый reviewer непосредственно сравнили кадры 02/03/04.
  Review без замечаний; финальные стили размеров и взаимодействий не затронуты.
- `npm test -- tests/smart-note-ui.test.tsx tests/smart-note-styles.test.ts`:
  28 passed. `npm run build`: успешно, прежнее предупреждение о больших chunks.
- Временные browser fixture/server удалены; постоянные data-specific tests
  не добавлялись. Артефакт: smart-note-stable-fullscreen.png в visualizations.
