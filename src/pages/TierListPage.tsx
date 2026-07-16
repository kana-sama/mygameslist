import { useMemo, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TIER_IDS, type Asset, type Game, type TierId } from "../domain/types";
import { GameCard } from "../components/GameCard";
import { Icon } from "../components/Icon";
import { MoveGameSheet, type MoveGameTarget } from "../components/MoveGameSheet";
import { sortGamesByPlacement, TIER_DESCRIPTIONS, TIER_LABELS } from "../components/libraryUi";

export interface TierListPageProps {
  games: Game[];
  assets: Record<string, Asset>;
  onMoveGame: (gameId: string, target: MoveGameTarget) => void;
  onOpenGame?: (gameId: string) => void;
}

export const TIER_LIST_SENSOR_TYPES = {
  pointer: PointerSensor,
  touch: TouchSensor,
  keyboard: KeyboardSensor,
} as const;

export const TIER_LIST_SENSOR_OPTIONS = {
  pointer: { activationConstraint: { distance: 8 } },
  touch: { activationConstraint: { delay: 180, tolerance: 8 } },
  keyboard: { coordinateGetter: sortableKeyboardCoordinates },
} as const;

export function getTierDropTarget(
  games: Game[],
  activeGameId: string,
  targetTierId: TierId,
  overGameId: string | null,
): MoveGameTarget | null {
  const activeGame = games.find((game) => game.id === activeGameId);
  if (!activeGame || overGameId === activeGameId) return null;

  const targetGames = sortGamesByPlacement(games.filter((game) => game.placement.tierId === targetTierId));
  const destination = targetGames.filter((game) => game.id !== activeGameId);
  if (!overGameId) return { tierId: targetTierId, index: destination.length };

  let index = destination.findIndex((game) => game.id === overGameId);
  if (index < 0) return null;

  if (activeGame.placement.tierId === targetTierId) {
    const sourceGames = sortGamesByPlacement(games.filter((game) => game.placement.tierId === targetTierId));
    const sourceIndex = sourceGames.findIndex((game) => game.id === activeGameId);
    const overIndex = sourceGames.findIndex((game) => game.id === overGameId);
    if (sourceIndex >= 0 && overIndex >= 0 && sourceIndex < overIndex) index += 1;
  }

  return { tierId: targetTierId, index: Math.min(index, destination.length) };
}

function SortableGame({ game, asset, onMoveRequest, onOpenGame }: { game: Game; asset?: Asset; onMoveRequest: (game: Game) => void; onOpenGame?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `game:${game.id}`,
    data: { type: "game", gameId: game.id, tierId: game.placement.tierId },
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <GameCard
      asset={asset}
      dragHandleProps={{ ...attributes, ...listeners } as ButtonHTMLAttributes<HTMLButtonElement>}
      game={game}
      isDragging={isDragging}
      onMoveRequest={onMoveRequest}
      onOpen={onOpenGame}
      ref={setNodeRef}
      style={style}
    />
  );
}

function TierRow({ tierId, games, assets, onMoveRequest, onOpenGame }: { tierId: TierId; games: Game[]; assets: Record<string, Asset>; onMoveRequest: (game: Game) => void; onOpenGame?: (id: string) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `tier:${tierId}`, data: { type: "tier", tierId } });
  return (
    <section className={`tier-row tier-row--${tierId}${isOver ? " is-over" : ""}`} aria-labelledby={`tier-${tierId}`}>
      <header className="tier-row__label">
        <strong id={`tier-${tierId}`}>{TIER_LABELS[tierId]}</strong>
        <span>{TIER_DESCRIPTIONS[tierId]}</span>
        <small>{games.length}</small>
      </header>
      <div className="tier-row__games" ref={setNodeRef}>
        <SortableContext items={games.map((game) => `game:${game.id}`)} strategy={horizontalListSortingStrategy}>
          {games.map((game) => <SortableGame asset={game.coverAssetId ? assets[game.coverAssetId] : undefined} game={game} key={game.id} onMoveRequest={onMoveRequest} onOpenGame={onOpenGame} />)}
        </SortableContext>
        {!games.length ? <div className="tier-row__empty"><Icon name="plus" size={18} />Перетащите игру сюда</div> : null}
      </div>
    </section>
  );
}

export function TierListPage({ games, assets, onMoveGame, onOpenGame }: TierListPageProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [moveGame, setMoveGame] = useState<Game | null>(null);
  const sensors = useSensors(
    useSensor(TIER_LIST_SENSOR_TYPES.pointer, TIER_LIST_SENSOR_OPTIONS.pointer),
    useSensor(TIER_LIST_SENSOR_TYPES.touch, TIER_LIST_SENSOR_OPTIONS.touch),
    useSensor(TIER_LIST_SENSOR_TYPES.keyboard, TIER_LIST_SENSOR_OPTIONS.keyboard),
  );
  const byTier = useMemo(() => Object.fromEntries(TIER_IDS.map((tierId) => [tierId, sortGamesByPlacement(games.filter((game) => game.placement.tierId === tierId))])) as Record<TierId, Game[]>, [games]);
  const activeGame = activeId ? games.find((game) => game.id === activeId) ?? null : null;

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.data.current?.gameId ?? ""));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    if (over.id === active.id) return;
    const gameId = String(active.data.current?.gameId ?? "");
    const targetTier = (over.data.current?.tierId ?? active.data.current?.tierId) as TierId;
    const overGameId = over.data.current?.type === "game" ? String(over.data.current.gameId) : null;
    const target = getTierDropTarget(games, gameId, targetTier, overGameId);
    if (target) onMoveGame(gameId, target);
  };

  return (
    <div className="page tier-page">
      <header className="page-heading">
        <div><span className="eyebrow">Личная коллекция</span><h1>Тирлист</h1><p>Расставьте игры по впечатлениям. Потяните за ручку на карточке или используйте меню.</p></div>
        <a className="button button--primary" href="#/games/new"><Icon name="plus" size={18} />Добавить игру</a>
      </header>
      {!games.length ? (
        <div className="empty-state empty-state--hero"><span className="empty-state__icon"><Icon name="gamepad" /></span><h2>Здесь появится ваш тирлист</h2><p>Добавьте первую игру, а затем перемещайте карточки между тирами.</p><a className="button button--primary" href="#/games/new"><Icon name="plus" size={18} />Добавить первую игру</a></div>
      ) : (
        <DndContext
          accessibility={{ announcements: { onDragStart: ({ active }) => `Вы взяли игру ${games.find((game) => `game:${game.id}` === active.id)?.title ?? ""}.`, onDragOver: ({ over }) => over ? "Выберите это место, чтобы переместить игру." : "Игра вне списка.", onDragEnd: ({ over }) => over ? "Игра перемещена." : "Перемещение отменено.", onDragCancel: () => "Перемещение отменено." } }}
          autoScroll
          collisionDetection={closestCenter}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          sensors={sensors}
        >
          <div className="tier-board">
            {TIER_IDS.map((tierId) => <TierRow assets={assets} games={byTier[tierId]} key={tierId} onMoveRequest={setMoveGame} onOpenGame={onOpenGame} tierId={tierId} />)}
          </div>
          <DragOverlay>{activeGame ? <GameCard asset={activeGame.coverAssetId ? assets[activeGame.coverAssetId] : undefined} game={activeGame} isDragging /> : null}</DragOverlay>
        </DndContext>
      )}
      <MoveGameSheet game={moveGame} games={games} onClose={() => setMoveGame(null)} onMove={onMoveGame} />
    </div>
  );
}
