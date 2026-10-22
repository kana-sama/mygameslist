# Одинаковый заголовок карточки для всех форматов заметок

Пользователь требует одинаковое оформление заголовков smart, Markdown (`#`/h1),
graph и tierlist. Нормативный скрин:
`/var/folders/y9/2hndrhd56jsgd181g052xf7w0000gn/T/TemporaryItems/NSIRD_screencaptureui_8MqG3c/Screenshot 2026-10-22 at 05.24.02.png`.
Четыре карточки с одинаковым названием; Markdown/graph/tierlist — образец,
увеличенный smart title — дефект.

- Превью всех четырёх типов использует один источник типографики заголовка:
  font family, size, weight, line-height, letter-spacing, color, wrapping.
  За образец взять существующий заголовок обычной карточки Markdown/graph/tierlist.
- Совпадают верхний и боковой отступы текста и ритм от заголовка до содержимого;
  не добавлять отдельный увеличенный header или двойной content padding для smart.
- Сохранить один доступный заголовок и семантику smart h1; кнопка открытия получает
  font:inherit, прежний focus/keyboard/open/drag behavior. Не менять modal header.
- Сохранить существующие inner/outer sticky layers других форматов и видимость
  progress/controls. Не менять остальные элементы Markdown, graph и tierlist.
- В активном корневом DESIGN.md закрепить инвариант для всех форматов и новых
  будущих типов: host title является общим UI карточки, независимая типографика
  конкретного формата запрещена. Повторить ссылку в docs/smart-notes.md.
- Не менять authored scripts/state/данные игр. Изменение обратимое и локальное;
  не добавлять тесты, сравнивающие исходный текст CSS.

Проверка: временная synthetic fixture с четырьмя настоящими компонентами/карточками,
с одинаковыми короткими и переносимыми длинными названиями на desktop/mobile.
Сравнить computed typography, текстовые inset/line boxes, число доступных heading,
hover/focus/active и открытие smart page. Исполнитель и reviewer непосредственно
сравнивают скрин с итоговым результатом. Focused tests и build в конце.
