import { useId, useMemo } from "react";
import { resolveNoteChecklistProgress, type NoteChecklistResolution } from "../domain/markdownChecklist";
import type { Asset, GameProgressItem, Note } from "../domain/types";
import { Icon } from "./Icon";
import { getAssetUrl } from "./libraryUi";

export interface GameProgressGridProps {
  gameId: string;
  items: readonly GameProgressItem[];
  notes: readonly Note[];
  assets: Record<string, Asset>;
  resolveAssetUrl?: (assetId: string) => string | null;
  disabled?: boolean;
  onAdd(): void;
  onEdit(itemId: string, trigger: HTMLButtonElement): void;
}

export function GameProgressGrid({
  gameId,
  items,
  notes,
  assets,
  resolveAssetUrl,
  disabled = false,
  onAdd,
  onEdit,
}: GameProgressGridProps) {
  const headingId = useId();
  const itemResolutions = useMemo(() => {
    const notesById = new Map(notes
      .filter((note) => note.gameId === gameId)
      .map((note) => [note.id, note]));
    const resolutionsByBody = new Map<string, NoteChecklistResolution>();
    const resolutions = new Map<string, NoteChecklistResolution>();

    for (const item of items) {
      const note = notesById.get(item.noteId);
      if (!note) {
        resolutions.set(item.id, { status: "error" });
        continue;
      }
      let resolution = resolutionsByBody.get(note.bodyMarkdown);
      if (!resolution) {
        resolution = resolveNoteChecklistProgress(note.bodyMarkdown);
        resolutionsByBody.set(note.bodyMarkdown, resolution);
      }
      resolutions.set(item.id, resolution);
    }
    return resolutions;
  }, [gameId, items, notes]);

  return (
    <section aria-labelledby={headingId} className="game-progress" data-game-id={gameId} tabIndex={-1}>
      <h2 className="game-progress__heading" id={headingId}>Прогресс</h2>
      <div className="game-progress__grid">
        {items.map((item) => {
          const resolution = itemResolutions.get(item.id) ?? { status: "error" as const };
          const complete = resolution.status === "ok" && resolution.checked === resolution.total;
          const value = resolution.status === "ok" ? `${resolution.checked}/${resolution.total}` : "ошибка";
          const ariaLabel = resolution.status === "ok"
            ? `Редактировать элемент прогресса: ${resolution.checked} из ${resolution.total}${complete ? ", завершено" : ""}`
            : "Редактировать элемент прогресса: ошибка прогресса";
          const asset = assets[item.iconAssetId];
          const iconUrl = resolveAssetUrl?.(item.iconAssetId) ?? getAssetUrl(asset);

          return (
            <button
              aria-label={ariaLabel}
              className={`game-progress__item${complete ? " is-complete" : ""}${resolution.status === "error" ? " is-error" : ""}`}
              key={item.id}
              onClick={(event) => onEdit(item.id, event.currentTarget)}
              type="button"
            >
              <span className="game-progress__icon">
                {iconUrl ? <img alt="" height={64} src={iconUrl} width={64} /> : <Icon aria-hidden="true" name="image" size={24} />}
              </span>
              <span className="game-progress__value">{value}</span>
            </button>
          );
        })}
        <button aria-label="Добавить элемент прогресса" className="game-progress__add" disabled={disabled} onClick={(event) => {
          event.currentTarget.focus();
          onAdd();
        }} type="button">
          <Icon name="plus" size={22} />
        </button>
      </div>
    </section>
  );
}
