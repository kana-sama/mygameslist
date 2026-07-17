import { forwardRef, type AnchorHTMLAttributes, type CSSProperties, type HTMLAttributes, type MouseEvent, type Ref } from "react";
import type { Asset, Game } from "../domain/types";
import { Icon } from "./Icon";
import { getAssetUrl, joinHuman, STATUS_LABELS } from "./libraryUi";

export interface GameCardProps {
  game: Game;
  asset?: Asset;
  variant?: "tier" | "list" | "compact";
  isDragging?: boolean;
  style?: CSSProperties;
  dragLinkProps?: AnchorHTMLAttributes<HTMLAnchorElement>;
  dragLinkRef?: Ref<HTMLAnchorElement>;
  dragRootProps?: HTMLAttributes<HTMLElement>;
  onOpen?: (gameId: string) => void;
  resolveAssetUrl?: (assetId: string) => string | null;
}

export const GameCard = forwardRef<HTMLElement, GameCardProps>(function GameCard(
  {
    game,
    asset,
    variant = "tier",
    isDragging = false,
    style,
    dragLinkProps,
    dragLinkRef,
    dragRootProps,
    onOpen,
    resolveAssetUrl,
  },
  ref,
) {
  const coverUrl = game.coverAssetId ? resolveAssetUrl?.(game.coverAssetId) ?? getAssetUrl(asset) : null;
  const isTierCard = variant === "tier";
  const tierAccessibleLabel = `${game.title}, статус: ${STATUS_LABELS[game.status]}. Открыть; пробел — перетащить`;
  const openGame = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen) return;
    event.preventDefault();
    onOpen(game.id);
  };

  return (
    <article
      {...dragRootProps}
      className={`game-card game-card--${variant}${isTierCard && game.status === "completed" ? " game-card--completed" : ""}${isDragging ? " is-dragging" : ""}${dragRootProps?.className ? ` ${dragRootProps.className}` : ""}`}
      ref={ref}
      style={{ ...dragRootProps?.style, ...style }}
      title={isTierCard ? game.title : dragRootProps?.title}
    >
      <a
        {...dragLinkProps}
        aria-label={isTierCard ? tierAccessibleLabel : undefined}
        className={`game-card__cover${dragLinkProps?.className ? ` ${dragLinkProps.className}` : ""}`}
        draggable={isTierCard ? false : undefined}
        href={`#/games/${encodeURIComponent(game.id)}`}
        onClick={openGame}
        ref={dragLinkRef}
        title={isTierCard ? game.title : dragLinkProps?.title}
      >
        {coverUrl ? (
          <img alt={asset && "alt" in asset ? asset.alt || `Обложка ${game.title}` : `Обложка ${game.title}`} draggable="false" loading="lazy" src={coverUrl} />
        ) : (
          <span className="game-card__placeholder" aria-label="Обложки пока нет">
            <Icon name="gamepad" size={variant === "list" ? 34 : 42} />
            {!isTierCard ? <span>{game.title.slice(0, 1).toLocaleUpperCase("ru")}</span> : null}
          </span>
        )}
        {!isTierCard ? <span className={`status-dot status-dot--${game.status}`} aria-hidden="true" /> : null}
      </a>

      {!isTierCard ? <div className="game-card__body">
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
              {game.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
              {game.tags.length > 4 ? <span>+{game.tags.length - 4}</span> : null}
            </div>
          </>
        ) : null}
      </div> : null}
    </article>
  );
});
