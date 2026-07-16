import { useMemo, useRef, useState, type AnchorHTMLAttributes, type CSSProperties, type HTMLAttributes } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TIER_IDS, type Asset, type Game, type TierId } from "../domain/types";
import { GameCard } from "../components/GameCard";
import { Icon } from "../components/Icon";
import { sortGamesByPlacement, TIER_DESCRIPTIONS, TIER_LABELS } from "../components/libraryUi";

export interface MoveGameTarget {
  tierId: TierId;
  index: number;
}

export interface TierListPageProps {
  games: Game[];
  assets: Record<string, Asset>;
  onMoveGame: (gameId: string, target: MoveGameTarget) => void;
  onOpenGame?: (gameId: string) => void;
}

export class NonTouchPointerSensor extends PointerSensor {
  static activators: typeof PointerSensor.activators = [{
    eventName: "onPointerDown",
    handler: (event, options) => {
      if (event.nativeEvent.pointerType === "touch") return false;
      return PointerSensor.activators[0].handler(event, options);
    },
  }];
}

export const TIER_LIST_SENSOR_TYPES = {
  pointer: NonTouchPointerSensor,
  touch: TouchSensor,
  keyboard: KeyboardSensor,
} as const;

export const TIER_LIST_SORTING_STRATEGY = rectSortingStrategy;

export const TIER_LIST_SENSOR_OPTIONS = {
  pointer: { activationConstraint: { distance: 8 } },
  touch: { activationConstraint: { delay: 180, tolerance: 8 } },
  keyboard: {
    coordinateGetter: sortableKeyboardCoordinates,
    keyboardCodes: {
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    },
  },
};

export const tierListCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);

  const collisions = pointerWithin(args);
  const gameCollision = collisions.find((collision) => collision.data?.droppableContainer.data.current?.type === "game");
  if (gameCollision) return [gameCollision];

  const tierCollision = collisions.find((collision) => collision.data?.droppableContainer.data.current?.type === "tier");
  return tierCollision ? [tierCollision] : [];
};

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

function SortableGame({ game, asset, onOpenGame }: { game: Game; asset?: Asset; onOpenGame?: (id: string) => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `game:${game.id}`,
    attributes: { roleDescription: "перетаскиваемая игра" },
    data: { type: "game", gameId: game.id, tierId: game.placement.tierId },
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  return (
    <GameCard
      asset={asset}
      dragLinkProps={{
        "aria-describedby": attributes["aria-describedby"],
        "aria-disabled": attributes["aria-disabled"],
        "aria-roledescription": attributes["aria-roledescription"],
        onKeyDown: listeners?.onKeyDown,
        tabIndex: attributes.tabIndex,
      } as AnchorHTMLAttributes<HTMLAnchorElement>}
      dragLinkRef={setActivatorNodeRef}
      dragRootProps={{ onPointerDown: listeners?.onPointerDown, onTouchStart: listeners?.onTouchStart } as HTMLAttributes<HTMLElement>}
      game={game}
      isDragging={isDragging}
      onOpen={onOpenGame}
      ref={setNodeRef}
      style={style}
    />
  );
}

function TierRow({ tierId, games, assets, onOpenGame }: { tierId: TierId; games: Game[]; assets: Record<string, Asset>; onOpenGame?: (id: string) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `tier:${tierId}`, data: { type: "tier", tierId } });
  const compactLabel = tierId === "unranked" ? "—" : TIER_LABELS[tierId];
  return (
    <section className={`tier-row tier-row--${tierId}${isOver ? " is-over" : ""}`} aria-labelledby={`tier-${tierId}`}>
      <header className="tier-row__label">
        <strong aria-hidden="true" title={TIER_LABELS[tierId]}>{compactLabel}</strong>
        <span className="visually-hidden" id={`tier-${tierId}`}>{TIER_LABELS[tierId]}</span>
        <span>{TIER_DESCRIPTIONS[tierId]}</span>
      </header>
      <div className="tier-row__games" ref={setNodeRef}>
        <SortableContext items={games.map((game) => `game:${game.id}`)} strategy={TIER_LIST_SORTING_STRATEGY}>
          {games.map((game) => <SortableGame asset={game.coverAssetId ? assets[game.coverAssetId] : undefined} game={game} key={game.id} onOpenGame={onOpenGame} />)}
        </SortableContext>
        {!games.length ? <div className="tier-row__empty"><Icon name="plus" size={18} />Перетащите игру сюда</div> : null}
      </div>
    </section>
  );
}

export function TierListPage({ games, assets, onMoveGame, onOpenGame }: TierListPageProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const suppressOpenFor = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(TIER_LIST_SENSOR_TYPES.pointer, TIER_LIST_SENSOR_OPTIONS.pointer),
    useSensor(TIER_LIST_SENSOR_TYPES.touch, TIER_LIST_SENSOR_OPTIONS.touch),
    useSensor(TIER_LIST_SENSOR_TYPES.keyboard, TIER_LIST_SENSOR_OPTIONS.keyboard),
  );
  const byTier = useMemo(() => Object.fromEntries(TIER_IDS.map((tierId) => [tierId, sortGamesByPlacement(games.filter((game) => game.placement.tierId === tierId))])) as Record<TierId, Game[]>, [games]);
  const activeGame = activeId ? games.find((game) => game.id === activeId) ?? null : null;

  const onDragStart = ({ active }: DragStartEvent) => {
    const gameId = String(active.data.current?.gameId ?? "");
    suppressOpenFor.current = gameId;
    setActiveId(gameId);
  };
  const finishDrag = () => {
    setActiveId(null);
    window.setTimeout(() => {
      suppressOpenFor.current = null;
    }, 0);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    finishDrag();
    if (!over) return;
    if (over.id === active.id) return;
    const gameId = String(active.data.current?.gameId ?? "");
    const targetTier = (over.data.current?.tierId ?? active.data.current?.tierId) as TierId;
    const overGameId = over.data.current?.type === "game" ? String(over.data.current.gameId) : null;
    const target = getTierDropTarget(games, gameId, targetTier, overGameId);
    if (target) onMoveGame(gameId, target);
  };
  const openGame = onOpenGame ? (gameId: string) => {
    if (suppressOpenFor.current === gameId) return;
    onOpenGame(gameId);
  } : undefined;
  return (
    <div className={`page tier-page${games.length ? "" : " tier-page--empty"}`}>
      <h1 className="visually-hidden">Тирлист игр</h1>
      {!games.length ? (
        <div className="empty-state empty-state--hero"><span className="empty-state__icon"><Icon name="gamepad" /></span><h2>Здесь появится ваш тирлист</h2><p>Добавьте первую игру, а затем перемещайте карточки между тирами.</p><a className="button button--primary" href="#/games/new"><Icon name="plus" size={18} />Добавить первую игру</a></div>
      ) : (
        <DndContext
          accessibility={{ announcements: { onDragStart: ({ active }) => `Вы взяли игру ${games.find((game) => `game:${game.id}` === active.id)?.title ?? ""}.`, onDragOver: ({ over }) => over ? "Выберите это место, чтобы переместить игру." : "Игра вне списка.", onDragEnd: ({ over }) => over ? "Игра перемещена." : "Перемещение отменено.", onDragCancel: () => "Перемещение отменено." } }}
          autoScroll
          collisionDetection={tierListCollisionDetection}
          onDragCancel={finishDrag}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          sensors={sensors}
        >
          <div className="tier-board">
            {TIER_IDS.map((tierId) => <TierRow assets={assets} games={byTier[tierId]} key={tierId} onOpenGame={openGame} tierId={tierId} />)}
          </div>
          <DragOverlay>{activeGame ? <GameCard asset={activeGame.coverAssetId ? assets[activeGame.coverAssetId] : undefined} game={activeGame} isDragging /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
