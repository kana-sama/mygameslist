# Smart state compatibility implementation plan

Spec: ../specs/2026-10-22-smart-state-compatibility-design.md

- [x] Исследовать привязку patch к program.hash и parse/serialize/validation paths.
- [x] Один implementation subagent: RED regressions, затем совместимость версий
  формата вместо program identity; schema/source support, patch metadata/reconcile/
  resolution, связанные assets и generic tests. Обновить docs/smart-notes.md.
  Основные файлы: domain/types.ts, smartNote.ts, patch.ts, validation.ts,
  source/smartNoteDocument.ts; tests/smart-note-{domain,source,patch,context}.
- [x] Контроллер: итоговый diff и integration checks; npm test и npm run build.
- [x] Один независимый scoped review с акцентом на legacy patches и сохранность assets.
- [x] jj status/diff, один jj describe и jj new после успешной проверки.

Не менять runtime program-hash remount guard или authored data. Не переписывать
прежние коммиты. Не добавлять generic migrations/schema inference. Новые metadata
получают default 1 для старых патчей без потери их value/changedAt/transactionId.

## Результаты

- Наблюдались 13 ожидаемых RED regressions до реализации, включая загрузку
  сохранённого legacy patch через LibraryProvider после code-only deployment.
- Дополнительная RED проверка подтвердила сохранение прежнего запрета unbound
  attachments operations: отсутствие версии означает 1 только при наличии
  существующей program binding, а не разрешает операции без привязки к программе.
- Focused verification: 6 файлов, 61 passed. Проверены новые/legacy операции,
  compatible nondefault version, source roundtrip/invalid values, ручное/local
  разрешение concurrent conflict, независимые timestamps, добавление/удаление
  изображений, blobs, incompatible-version recoverability и runtime/CAS guard.
- Итоговый `npm test`: 131 файл, 2557 passed, 22 skipped. `npm run build`: успешно;
  прежнее предупреждение о больших chunks. Проверки не меняли authored data.
- Независимый review source/validation/reconcile/persistence/asset dependency
  paths: без замечаний. Старые конфликты пересчитываются при загрузке актуальной
  базы и автоматически снимаются, когда единственной причиной была смена hash.
