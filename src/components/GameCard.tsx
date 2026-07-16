import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent } from "react";
import type { Asset, Game } from "../domain/types";
import { Icon } from "./Icon";
import { getAssetUrl, joinHuman, STATUS_LABELS } from "./libraryUi";

export interface GameCardProps {
  game: Game;
  asset?: Asset;
  variant?: "tier" | "list" | "compact";
  selected?: boolean;
  isDragging?: boolean;
  style?: CSSProperties;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onMoveRequest?: (game: Game) => void;
  onSelect?: (gameId: string, selected: boolean) => void;
  onOpen?: (gameId: string) => void;
}

export const GameCard = forwardRef<HTMLElement, GameCardProps>(function GameCard(
  {
    game,
    asset,
    variant = "tier",
    selected = false,
    isDragging = false,
    style,
    dragHandleProps,
    onMoveRequest,
    onSelect,
    onOpen,
  },
  ref,
) {
  const coverUrl = getAssetUrl(asset);
  const openGame = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen) return;
    event.preventDefault();
    onOpen(game.id);
  };

  return (
    <article
      className={`game-card game-card--${variant}${isDragging ? " is-dragging" : ""}${selected ? " is-selected" : ""}`}
      ref={ref}
      style={style}
    >
      {onSelect ? (
        <label className="game-card__select" aria-label={`Выбрать ${game.title}`}>
          <input
            checked={selected}
            onChange={(event) => onSelect(game.id, event.currentTarget.checked)}
            type="checkbox"
          />
          <span><Icon name="check" size={14} /></span>
        </label>
      ) : null}

      <a className="game-card__cover" href={`#/games/${encodeURIComponent(game.id)}`} onClick={openGame}>
        {coverUrl ? (
          <img alt={asset?.alt || `Обложка ${game.title}`} draggable="false" loading="lazy" src={coverUrl} />
        ) : (
          <span className="game-card__placeholder" aria-label="Обложки пока нет">
            <Icon name="gamepad" size={variant === "list" ? 34 : 42} />
            <span>{game.title.slice(0, 1).toLocaleUpperCase("ru")}</span>
          </span>
        )}
        <span className={`status-dot status-dot--${game.status}`} aria-hidden="true" />
      </a>

      <div className="game-card__body">
        <a className="game-card__title" href={`#/games/${encodeURIComponent(game.id)}`} onClick={openGame}>
          {game.title}
        </a>
        <span className="game-card__platforms" title={game.platforms.join(", ")}>
          {game.platforms.length ? joinHuman(game.platforms) : "Платформа не указана"}
        </span>
        {variant !== "list" ? <span className="game-card__status-text">{STATUS_LABELS[game.status]}</span> : null}
        {variant === "list" ? (
          <>
            <span className={`status-label status-label--${game.status}`}>{STATUS_LABELS[game.status]}</span>
            <div className="game-card__tags">
              {game.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
              {game.tags.length > 4 ? <span>+{game.tags.length - 4}</span> : null}
            </div>
          </>
        ) : null}
      </div>

      {dragHandleProps ? (
        <button
          {...dragHandleProps}
          aria-label={`Перетащить ${game.title}`}
          className={`icon-button game-card__drag ${dragHandleProps.className ?? ""}`}
          type="button"
        >
          <Icon name="drag" />
        </button>
      ) : null}
      {onMoveRequest ? (
        <button
          aria-label={`Переместить ${game.title}`}
          className="icon-button game-card__move"
          onClick={() => onMoveRequest(game)}
          type="button"
        >
          <Icon name="more" />
        </button>
      ) : null}
    </article>
  );
});
