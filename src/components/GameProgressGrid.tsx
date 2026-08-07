import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useId, useMemo, useRef, useState, type CSSProperties } from "react";
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
  sortingDisabled?: boolean;
  onAdd(): void;
  onEdit(itemId: string, trigger: HTMLButtonElement): void;
  onReorder(activeItemId: string, overItemId: string): void | Promise<void>;
}

export class NonTouchProgressPointerSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators = [{
    eventName: "onPointerDown",
    handler: (event, options) => {
      if (event.nativeEvent.pointerType === "touch") return false;
      return PointerSensor.activators[0].handler(event, options);
    },
  }];
}

export const PROGRESS_GRID_SENSOR_TYPES = {
  pointer: NonTouchProgressPointerSensor,
  touch: TouchSensor,
  keyboard: KeyboardSensor,
} as const;

export const PROGRESS_GRID_SENSOR_OPTIONS = {
  pointer: { activationConstraint: { distance: 8 } },
  touch: { activationConstraint: { delay: 180, tolerance: 8 } },
  keyboard: {
    coordinateGetter: sortableKeyboardCoordinates,
    keyboardCodes: {
      start: [KeyboardCode.Space, KeyboardCode.Enter],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    },
  },
};

export function createProgressGridAnnouncements(items: readonly GameProgressItem[]): Announcements {
  const itemIndex = (entry: { data: { current?: { itemId?: unknown } } } | null) => {
    const itemId = String(entry?.data.current?.itemId ?? "");
    return items.findIndex((item) => item.id === itemId);
  };

  return {
    onDragStart: ({ active }) => `Вы взяли элемент прогресса ${itemIndex(active) + 1} из ${items.length}.`,
    onDragOver: ({ over }) => over ? `Новое место: ${itemIndex(over) + 1} из ${items.length}.` : "Элемент вне списка прогресса.",
    onDragEnd: ({ over }) => over ? "Порядок элементов прогресса изменён." : "Перемещение элемента прогресса отменено.",
    onDragCancel: () => "Перемещение элемента прогресса отменено.",
  };
}

interface ProgressCellContentProps {
  iconUrl: string | null;
  resolution: NoteChecklistResolution;
}

function ProgressCellContent({ iconUrl, resolution }: ProgressCellContentProps) {
  return <>
    <span className="game-progress__icon">
      {iconUrl ? <img alt="" height={64} src={iconUrl} width={64} /> : <Icon aria-hidden="true" name="image" size={24} />}
    </span>
    <span className="game-progress__value">
      {resolution.status === "ok" ? (
        <>
          <span className="game-progress__checked">{resolution.checked}</span>
          <span className="game-progress__slash">/</span>
          <span className="game-progress__total">{resolution.total}</span>
        </>
      ) : "ошибка"}
    </span>
  </>;
}

interface SortableProgressItemProps {
  iconUrl: string | null;
  item: GameProgressItem;
  onEdit(itemId: string, trigger: HTMLButtonElement): void;
  resolution: NoteChecklistResolution;
  sortingDisabled: boolean;
  suppressEditFor: React.MutableRefObject<string | null>;
}

function SortableProgressItem({ iconUrl, item, onEdit, resolution, sortingDisabled, suppressEditFor }: SortableProgressItemProps) {
  const sortableId = `progress:${item.id}`;
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: sortableId,
    animateLayoutChanges: () => false,
    attributes: { roleDescription: "перетаскиваемый элемент прогресса" },
    data: { type: "progress-item", itemId: item.id },
    disabled: sortingDisabled,
  });
  const complete = resolution.status === "ok" && resolution.checked === resolution.total;
  const ariaLabel = resolution.status === "ok"
    ? `Редактировать элемент прогресса: ${resolution.checked} из ${resolution.total}${complete ? ", завершено" : ""}`
    : "Редактировать элемент прогресса: ошибка прогресса";
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      {...attributes}
      {...listeners}
      aria-label={ariaLabel}
      className={`game-progress__item${complete ? " is-complete" : ""}${resolution.status === "error" ? " is-error" : ""}${isDragging ? " is-dragging" : ""}${!isDragging && isOver ? " is-drop-target" : ""}`}
      data-progress-item-id={item.id}
      onClick={(event) => {
        if (suppressEditFor.current === item.id) return;
        onEdit(item.id, event.currentTarget);
      }}
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      style={style}
      type="button"
    >
      <ProgressCellContent iconUrl={iconUrl} resolution={resolution} />
    </button>
  );
}

export function GameProgressGrid({
  gameId,
  items,
  notes,
  assets,
  resolveAssetUrl,
  disabled = false,
  sortingDisabled = false,
  onAdd,
  onEdit,
  onReorder,
}: GameProgressGridProps) {
  const headingId = useId();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const suppressEditFor = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PROGRESS_GRID_SENSOR_TYPES.pointer, PROGRESS_GRID_SENSOR_OPTIONS.pointer),
    useSensor(PROGRESS_GRID_SENSOR_TYPES.touch, PROGRESS_GRID_SENSOR_OPTIONS.touch),
    useSensor(PROGRESS_GRID_SENSOR_TYPES.keyboard, PROGRESS_GRID_SENSOR_OPTIONS.keyboard),
  );
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
  const renderedItems = useMemo(() => items.map((item) => {
    const resolution = itemResolutions.get(item.id) ?? { status: "error" as const };
    const asset = assets[item.iconAssetId];
    const iconUrl = resolveAssetUrl?.(item.iconAssetId) ?? getAssetUrl(asset);
    return { item, resolution, iconUrl };
  }), [assets, itemResolutions, items, resolveAssetUrl]);
  const activeItem = renderedItems.find(({ item }) => item.id === activeItemId) ?? null;
  const announcements = useMemo(() => createProgressGridAnnouncements(items), [items]);
  const finishDrag = (itemId: string | null) => {
    setActiveItemId(null);
    window.setTimeout(() => {
      if (suppressEditFor.current === itemId) suppressEditFor.current = null;
    }, 0);
  };
  const startDrag = ({ active }: DragStartEvent) => {
    const itemId = String(active.data.current?.itemId ?? "");
    suppressEditFor.current = itemId;
    setActiveItemId(itemId);
  };
  const endDrag = ({ active, over }: DragEndEvent) => {
    const activeId = String(active.data.current?.itemId ?? "");
    const overId = String(over?.data.current?.itemId ?? "");
    finishDrag(activeId);
    if (!activeId || !overId || activeId === overId) return;
    void onReorder(activeId, overId);
  };

  return (
    <section aria-labelledby={headingId} className="game-progress" data-game-id={gameId} tabIndex={-1}>
      <h2 className="game-progress__heading" id={headingId}>Прогресс</h2>
      <DndContext
        accessibility={{ announcements }}
        onDragCancel={() => finishDrag(suppressEditFor.current)}
        onDragEnd={endDrag}
        onDragStart={startDrag}
        sensors={sensors}
      >
        <div className="game-progress__grid">
          <SortableContext items={items.map((item) => `progress:${item.id}`)} strategy={rectSortingStrategy}>
            {renderedItems.map(({ iconUrl, item, resolution }) => <SortableProgressItem iconUrl={iconUrl} item={item} key={item.id} onEdit={onEdit} resolution={resolution} sortingDisabled={sortingDisabled} suppressEditFor={suppressEditFor} />)}
          </SortableContext>
          <button aria-label="Добавить элемент прогресса" className="game-progress__add" disabled={disabled} onClick={(event) => {
            event.currentTarget.focus();
            onAdd();
          }} type="button">
            <Icon name="plus" size={22} />
          </button>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeItem ? <div aria-hidden="true" className={`game-progress__item game-progress__drag-overlay${activeItem.resolution.status === "ok" && activeItem.resolution.checked === activeItem.resolution.total ? " is-complete" : ""}${activeItem.resolution.status === "error" ? " is-error" : ""}`}>
            <ProgressCellContent iconUrl={activeItem.iconUrl} resolution={activeItem.resolution} />
          </div> : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
