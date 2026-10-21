# Barbuta normal card plan

Spec: ../specs/2026-10-21-barbuta-normal-card-design.md

- [x] Субагент: убрать doubleWidth из authored note.json; doubleHeight не добавлять.
- [x] Временная проверка исходника и сборки: оба флага false/absent, остальные поля прежние.
- [x] Проверить jj status/diff, завершить отдельным jj describe/new.

`npm run build`: exit0. Временные inline assertions исходника и dist подтвердили
оба size-флага false/absent. В браузере оба checkbox двойного размера выключены,
карточка397.33×304 на1470×864, все64 клетки preview видны. Source diff содержит
только удаление doubleWidth:true. Временных permanent tests/фикстур не добавлено.
