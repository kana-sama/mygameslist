import type { Game, StatusId } from "../domain/types";

const RANDOM_GAME_STATUSES = new Set<StatusId>(["wishlist", "playing", "played"]);

export const RANDOM_GAME_STEP_DELAYS_MS = [
  70, 70, 70, 70, 75, 75, 80, 80, 85, 90, 95, 105, 115, 130, 145, 165, 190, 220, 260, 310, 370,
] as const;
export const RANDOM_GAME_FINAL_HOLD_MS = 430;
// The first 64.9% preserves the accepted approach to center; the longer tail is
// reserved for a clearly visible spring around the final position.
export const RANDOM_GAME_SETTLE_DURATION_MS = 650;
export const RANDOM_GAME_TOTAL_DURATION_MS = RANDOM_GAME_STEP_DELAYS_MS.reduce((total, delay) => total + delay, 0) + RANDOM_GAME_SETTLE_DURATION_MS + RANDOM_GAME_FINAL_HOLD_MS;
export const RANDOM_GAME_REDUCED_MOTION_DURATION_MS = 180;

function randomItem<T>(items: T[], random: () => number): T {
  const value = random();
  const bounded = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9999999999999999) : 0;
  return items[Math.floor(bounded * items.length)];
}

export function getRandomGameCandidates(games: Game[]): Game[] {
  return games.filter((game) => RANDOM_GAME_STATUSES.has(game.status));
}

export function createRandomGameRoll(games: Game[], random: () => number = Math.random): Game[] {
  const candidates = getRandomGameCandidates(games);
  if (!candidates.length) return [];
  const winner = randomItem(candidates, random);
  const reel: Game[] = [];

  for (let step = 0; step < RANDOM_GAME_STEP_DELAYS_MS.length; step += 1) {
    const previous = reel.at(-1);
    const besideWinner = step === 0 || step === RANDOM_GAME_STEP_DELAYS_MS.length - 1;
    let pool = candidates.filter((game) => game.id !== previous?.id && (!besideWinner || game.id !== winner.id));
    if (!pool.length && besideWinner) pool = candidates.filter((game) => game.id !== winner.id);
    if (!pool.length) pool = candidates.filter((game) => game.id !== previous?.id);
    reel.push(randomItem(pool.length ? pool : candidates, random));
  }

  reel.push(winner);
  return reel;
}
