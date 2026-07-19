import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { Game } from "../domain/types";
import { Icon } from "./Icon";
import { STATUS_LABELS } from "./libraryUi";
import {
  createRandomGameRoll,
  getRandomGameCandidates,
  RANDOM_GAME_REDUCED_MOTION_DURATION_MS,
  RANDOM_GAME_SETTLE_DURATION_MS,
  RANDOM_GAME_STEP_DELAYS_MS,
  RANDOM_GAME_TOTAL_DURATION_MS,
} from "./randomGame";

const SLOT_OFFSETS = [-2, -1, 0, 1, 2] as const;
type SlotOffset = (typeof SLOT_OFFSETS)[number];

export interface RandomGameButtonProps {
  games: Game[];
  onNavigate?: (href: string) => void;
  resolveAssetUrl?: (assetId: string) => string | null;
}

interface DisplayedGame {
  animate: boolean;
  durationMs: number;
  game: Game;
  settled: boolean;
  step: number;
}

interface ReelEntry {
  game: Game;
  index: number;
}

function reelEntryAt(reel: Game[], step: number, offset: SlotOffset, fallback: Game): ReelEntry {
  if (!reel.length) return { game: fallback, index: offset + 2 };
  const index = (step + offset + reel.length) % reel.length;
  return { game: reel[index], index };
}

function preloadReelCovers(reel: Game[], resolveAssetUrl?: (assetId: string) => string | null): Promise<void>[] {
  if (!resolveAssetUrl || typeof Image === "undefined") return [];
  const urls = new Set<string>();
  reel.forEach((game) => {
    if (!game.coverAssetId) return;
    const url = resolveAssetUrl(game.coverAssetId);
    if (url) urls.add(url);
  });
  return [...urls].flatMap((url) => {
    const image = new Image();
    image.src = url;
    if (typeof image.decode !== "function") return [];
    return [image.decode().catch(() => undefined).then(() => { void image; })];
  });
}

function SlotGameItem({ game, offset, reelIndex, resolveAssetUrl }: {
  game: Game;
  offset: SlotOffset;
  reelIndex: number;
  resolveAssetUrl?: (assetId: string) => string | null;
}) {
  const coverUrl = game.coverAssetId ? resolveAssetUrl?.(game.coverAssetId) ?? null : null;
  const style = { "--random-game-slot-angle": `${offset * -30}deg` } as CSSProperties;
  return (
    <div
      className="random-game-slot__item"
      data-random-game-id={offset === 0 ? game.id : undefined}
      data-random-game-reel-index={reelIndex}
      data-random-game-slot-offset={offset}
      data-random-game-slot-id={game.id}
      style={style}
    >
      <span className="random-game-slot__cover">
        {coverUrl ? <img alt="" draggable="false" src={coverUrl} /> : <Icon name="gamepad" size={28} />}
      </span>
      <span className="random-game-slot__copy">
        <strong>{game.title}</strong>
        <small>{[...game.platforms.slice(0, 2), STATUS_LABELS[game.status]].join(" · ")}</small>
      </span>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function RandomGameButton({ games, onNavigate, resolveAssetUrl }: RandomGameButtonProps) {
  const candidates = useMemo(() => getRandomGameCandidates(games), [games]);
  const candidateFingerprint = useMemo(() => candidates.map((game) => `${game.id}:${game.status}:${game.updatedAt}`).join("|"), [candidates]);
  const [displayed, setDisplayed] = useState<DisplayedGame | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLAnchorElement>(null);
  const reelRef = useRef<Game[]>([]);
  const rollCandidateFingerprintRef = useRef("");
  const preparationRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const active = preparing || displayed !== null;

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const cancelRoll = useCallback(() => {
    preparationRef.current += 1;
    clearTimers();
    setPreparing(false);
    setDisplayed(null);
    setAnnouncement("");
  }, [clearTimers]);

  useEffect(() => () => {
    preparationRef.current += 1;
    clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    if (active && rollCandidateFingerprintRef.current !== candidateFingerprint) cancelRoll();
  }, [active, candidateFingerprint, cancelRoll]);

  useEffect(() => {
    if (!active) return;
    const cancelOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) cancelRoll();
    };
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRoll();
    };
    document.addEventListener("pointerdown", cancelOutside);
    window.addEventListener("hashchange", cancelRoll);
    window.addEventListener("keydown", cancelWithEscape);
    return () => {
      document.removeEventListener("pointerdown", cancelOutside);
      window.removeEventListener("hashchange", cancelRoll);
      window.removeEventListener("keydown", cancelWithEscape);
    };
  }, [active, cancelRoll]);

  const finishNavigation = (game: Game) => {
    preparationRef.current += 1;
    clearTimers();
    setPreparing(false);
    setDisplayed(null);
    setAnnouncement("");
    const href = `#/games/${encodeURIComponent(game.id)}`;
    const anchor = navigationRef.current;
    if (!anchor) return;
    anchor.setAttribute("href", href);
    anchor.click();
  };

  const startRoll = () => {
    if (active || !candidates.length) return;
    const reel = createRandomGameRoll(candidates);
    const winner = reel.at(-1);
    if (!winner) return;
    clearTimers();
    reelRef.current = reel;
    rollCandidateFingerprintRef.current = candidateFingerprint;
    const preparation = preparationRef.current + 1;
    preparationRef.current = preparation;
    const reducedMotion = prefersReducedMotion();

    const beginRoll = () => {
      if (preparationRef.current !== preparation) return;
      setPreparing(false);
      if (reducedMotion) {
        setDisplayed({ animate: false, durationMs: RANDOM_GAME_REDUCED_MOTION_DURATION_MS, game: winner, settled: true, step: reel.length - 1 });
        setAnnouncement(`Выбрана игра: ${winner.title}`);
        timersRef.current.push(window.setTimeout(() => finishNavigation(winner), RANDOM_GAME_REDUCED_MOTION_DURATION_MS));
        return;
      }

      setDisplayed({ animate: false, durationMs: RANDOM_GAME_STEP_DELAYS_MS[0], game: reel[0], settled: false, step: 0 });
      setAnnouncement(`Выбираем случайную игру из ${candidates.length}`);
      let elapsed = 0;
      for (let step = 1; step < reel.length; step += 1) {
        elapsed += RANDOM_GAME_STEP_DELAYS_MS[step - 1];
        const settled = step === reel.length - 1;
        const game = reel[step];
        timersRef.current.push(window.setTimeout(() => {
          setDisplayed({
            animate: true,
            durationMs: settled ? RANDOM_GAME_SETTLE_DURATION_MS : RANDOM_GAME_STEP_DELAYS_MS[step],
            game,
            settled,
            step,
          });
          if (settled) setAnnouncement(`Выбрана игра: ${game.title}`);
        }, elapsed));
      }
      timersRef.current.push(window.setTimeout(() => finishNavigation(winner), RANDOM_GAME_TOTAL_DURATION_MS));
    };

    const coverDecodes = reducedMotion ? [] : preloadReelCovers(reel, resolveAssetUrl);
    if (!coverDecodes.length) {
      beginRoll();
      return;
    }
    setPreparing(true);
    setAnnouncement(`Готовим случайную игру из ${candidates.length}`);
    void Promise.all(coverDecodes).then(beginRoll);
  };

  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate) return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    if (href) onNavigate(href);
  };

  const buttonLabel = candidates.length
    ? active ? "Случайная игра: идёт выбор" : "Случайная игра"
    : "Случайная игра: нет непройденных игр";
  const stepStyle = displayed ? { "--random-game-step-duration": `${displayed.durationMs}ms` } as CSSProperties : undefined;
  const reelPassClass = displayed?.animate && !displayed.settled
    ? ` random-game-slot__reel--pass-${displayed.step % 2 === 0 ? "even" : "odd"}`
    : "";

  return (
    <div className="random-game-picker" ref={rootRef}>
      <button
        aria-busy={active || undefined}
        aria-controls="random-game-slot"
        aria-disabled={active || !candidates.length || undefined}
        aria-expanded={displayed !== null}
        aria-label={buttonLabel}
        className={`button button--secondary random-game-button${active ? " is-spinning" : ""}`}
        disabled={active}
        onClick={startRoll}
        title={candidates.length ? "Выбрать случайную непройденную игру" : "Нет игр со статусом «Хочу поиграть», «Играю» или «Играл»"}
        type="button"
      >
        <Icon name="sparkles" size={17} />
        <span>Случайная игра</span>
      </button>
      {displayed ? (
        <div className={`random-game-slot${displayed.settled ? " is-settled" : " is-spinning"}${displayed.animate ? " is-animating" : " is-static"}`} id="random-game-slot">
          <div className="random-game-slot__heading">
            <Icon name="sparkles" size={14} />
            <span>{displayed.settled ? "Твой выбор" : `Выбираем из ${candidates.length}`}</span>
          </div>
          <div aria-hidden="true" className="random-game-slot__window">
            <div
              className={`random-game-slot__reel${reelPassClass}`}
              style={stepStyle}
            >
              {SLOT_OFFSETS.map((offset) => {
                const entry = reelEntryAt(reelRef.current, displayed.step, offset, displayed.game);
                return (
                  <SlotGameItem
                    game={entry.game}
                    key={entry.index}
                    offset={offset}
                    reelIndex={entry.index}
                    resolveAssetUrl={resolveAssetUrl}
                  />
                );
              })}
            </div>
            <div className="random-game-slot__selection" />
          </div>
        </div>
      ) : null}
      {announcement ? <span aria-atomic="true" className="visually-hidden" role="status">{announcement}</span> : null}
      <a aria-hidden="true" hidden href="#/" onClick={navigate} ref={navigationRef} tabIndex={-1} />
    </div>
  );
}
