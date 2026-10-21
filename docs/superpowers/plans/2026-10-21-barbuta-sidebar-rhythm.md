# Barbuta sidebar rhythm plan

Spec: ../specs/2026-10-21-barbuta-sidebar-rhythm-design.md

- [x] Субагент: сгруппировать declarative DOM в page.js; постоянный slot+placeholder,
  CSS flex/grid для отступов и высокой note-area. В render заменить скрытие slot
  на переключение placeholder. Остальные обработчики/import/save/API не менять.
- [x] Итоговая сборка/data validation и временная dist-only комната с картинкой.
- [x] Проверить empty/filled/read/editor/keyboard/error, geometry и стабильность
  screenshot/note размеров при1280×800/1470×864/390×844; один scoped review.
- [x] Удалить временную QA-фикстуру, jj status/diff, один jj describe/new commit.

## Проверка

`npm run build` и `npm run data:validate` завершились exit0 после окончательной
CSS-правки фиксированной26px строки удаления. Постоянных authored-data тестов нет.

На1470×864 slot207.36px и note304.64px; между empty/filled/editor изменение
height и y равно0. На1280×800 note256px, на390×844 note176px и slot112px.
Три группы проверены структурно; padding16/8px, gap18/10px. Все64 клетки32:23,
поля12/8px, border сайдбара0, page/sidebar overflow0. Для HTTP404 note223px,
slot192px; overflow также0. Сохранены действия, focus и внутреннее выделение.

Исполнитель и scoped reviewer напрямую сравнили оба референса с восемью
финальными снимками `barbuta-rhythm-*.png`, включая EMPTY. Verdict: no findings.
Dist-only БД восстановлена, временные media/скрипты удалены, серверы и QA-вкладки
закрыты. Исходные данные и локальные правки пользователя не изменялись.
