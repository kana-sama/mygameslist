# Barbuta: обычный размер карточки

Пользователь просит дефолтную заметку без двойной ширины и высоты: 1×1.
Убрать authored `doubleWidth: true` в note.json; doubleHeight уже отсутствует
и по общему контракту false. Не менять fullscreen/map sizing, preview graphics,
скрипты, состояние комнат или другие заметки. Контентная правка отдельным коммитом.

Временная проверка: собрать authored data и убедиться, что обе проекции
doubleWidth/doubleHeight false/absent. Permanent tests не содержат конкретную БД.
