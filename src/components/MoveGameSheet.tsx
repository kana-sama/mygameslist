import { useEffect, useRef, useState } from "react";
import { TIER_IDS, type Game, type TierId } from "../domain/types";
import { Icon } from "./Icon";
import { TIER_LABELS } from "./libraryUi";

export interface MoveGameTarget {
  tierId: TierId;
  index: number;
}

export interface MoveGameSheetProps {
  game: Game | null;
  games: Game[];
  onMove: (gameId: string, target: MoveGameTarget) => void;
  onClose: () => void;
}

export function MoveGameSheet({ game, games, onMove, onClose }: MoveGameSheetProps) {
  const [tierId, setTierId] = useState<TierId>(game?.placement.tierId ?? "unranked");
  const [position, setPosition] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!game) return;
    const siblings = games
      .filter((item) => item.placement.tierId === game.placement.tierId)
      .sort((left, right) => left.placement.rank - right.placement.rank);
    setTierId(game.placement.tierId);
    setPosition(Math.max(0, siblings.findIndex((item) => item.id === game.id)));
    requestAnimationFrame(() => closeRef.current?.focus());
  }, [game, games]);

  useEffect(() => {
    if (!game) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest<HTMLElement>("[role='dialog']");
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), [tabindex='0']") ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [game, onClose]);

  if (!game) return null;
  const targetGames = games
    .filter((item) => item.id !== game.id && item.placement.tierId === tierId)
    .sort((left, right) => left.placement.rank - right.placement.rank);
  const maxPosition = targetGames.length;
  const safePosition = Math.min(position, maxPosition);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="move-sheet-title" aria-modal="true" className="move-sheet" role="dialog">
        <div className="modal-handle" aria-hidden="true" />
        <header className="modal-header">
          <div>
            <span className="eyebrow">Перемещение</span>
            <h2 id="move-sheet-title">{game.title}</h2>
          </div>
          <button aria-label="Закрыть" className="icon-button" onClick={onClose} ref={closeRef} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="move-sheet__fields">
          <label className="field-group">
            <span className="field-label">Тир</span>
            <span className="select-wrap">
              <select value={tierId} onChange={(event) => { setTierId(event.currentTarget.value as TierId); setPosition(0); }}>
                {TIER_IDS.map((tier) => <option key={tier} value={tier}>{TIER_LABELS[tier]}</option>)}
              </select>
              <Icon name="chevron-down" size={17} />
            </span>
          </label>
          <label className="field-group">
            <span className="field-label">Позиция</span>
            <span className="select-wrap">
              <select value={safePosition} onChange={(event) => setPosition(Number(event.currentTarget.value))}>
                {Array.from({ length: maxPosition + 1 }, (_, index) => {
                  const label = index === 0 ? "В начало" : index === maxPosition ? "В конец" : `После «${targetGames[index - 1]?.title}»`;
                  return <option key={index} value={index}>{label}</option>;
                })}
              </select>
              <Icon name="chevron-down" size={17} />
            </span>
          </label>
        </div>
        <footer className="modal-footer">
          <button className="button button--secondary" onClick={onClose} type="button">Отмена</button>
          <button className="button button--primary" onClick={() => { onMove(game.id, { tierId, index: safePosition }); onClose(); }} type="button">
            Переместить
          </button>
        </footer>
      </section>
    </div>
  );
}
