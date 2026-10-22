# Совместимость локального стейта при обновлении программы

Пользователь: если формат стейта не менялся, опубликованное исправление программы
не должно конфликтовать с локальным стейтом смарт-заметки. Текущая причина:
staleSmartProgramPaths сравнивает smartProgramHash патча с текущей программой,
поэтому смена любых JS/CSS/ресурсов блокирует локальные данные.

- Разделить идентичность исполняемого кода и совместимость JSON. В source note.json
  и runtime SmartNoteDefinition добавить optional `stateVersion`, положительный
  safe integer, default 1. Это декларация автора; сервис не читает предметную схему.
- В PatchOperation для state/attachments сохранять `smartStateVersion` вместе с
  существующим smartProgramHash. Старые операции без нового поля означают version 1,
  включая уже сохранённые и уже показанные пользователю конфликты.
- Разные program hash при одинаковой stateVersion совместимы. При code-only update
  локальные state, image ownership и blobs сохраняются и автоматически reconciled.
  Старые patch operations должны работать без ручного пересохранения/сброса данных.
- При несовпадении версий оставить recoverable conflict, запрет применения через
  applyPatch/local/manual resolution; сохранить связанные assets и удаление изображений
  в прежних dependency groups. Одновременное изменение самого стейта по-прежнему
  создаёт обычный baseHash conflict даже при одинаковой stateVersion.
- Отсутствующая stateVersion и явная 1 семантически равны; program hash старых
  definitions без нового поля не меняется. Для version >1 включить её в identity,
  чтобы изменение одной декларации версии тоже вызывало remount/cache invalidation.
- Оставить runtime запрет работы старого mount после смены program hash и CAS revision
  как есть: это lifetime кода, а не конфликт совместимого сохранённого JSON.
- Source parse/serialize и structural/patch validation поддерживают новое поле,
  отклоняют 0, negative, fractional, unsafe и неподходящие metadata paths.
  Сайт не может менять definition/stateVersion; версии меняют только в репозитории.
- Не менять authored state/данные игр и не добавлять миграции предметного JSON.

Проверка: synthetic domain/source/patch/context fixtures. Code-only hash change
с новыми и legacy patches, assets add/remove и blobs; stateVersion bump; обычный
concurrent state conflict/resolution; roundtrip optional version; invalid metadata;
старые hashes/default1; runtime guard. Полный test suite и build в конце.
