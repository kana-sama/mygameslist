export const GRAPH_NOTE_EXAMPLE = `digraph {
  label="Путь к храму";
  start [label="Найти карту", state=done];
  subgraph forest {
    label="Лес";
    key [label="Добыть ключ", subtitle="Северный лес", kind=special];
    shrine [label="Открыть храм", kind=milestone, state=doing];
    hint [label="Вход с севера", kind=note, task=false];
    key -> shrine [label="открывает"];
  }
  start -> key;
}`;
