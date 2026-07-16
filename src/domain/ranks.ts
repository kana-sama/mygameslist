import type { LibraryDatabase, TierId } from "./types";

export const RANK_STEP = 1024;
export interface Ranked { id: string; rank: number }

export function rankBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) { const rank = Math.floor((after as number) / 2); return rank >= 0 && rank < (after as number) ? rank : null; }
  if (after === null) return Number.isSafeInteger(before + RANK_STEP) ? before + RANK_STEP : null;
  if (after <= before) return null;
  const rank = before + Math.floor((after - before) / 2);
  return rank > before && rank < after ? rank : null;
}

export function compareRanked(a: Ranked, b: Ranked): number { return a.rank - b.rank || a.id.localeCompare(b.id); }

export function rebalanceRanks<T extends Ranked>(items: readonly T[]): T[] {
  return [...items].sort(compareRanked).map((item, index) => ({ ...item, rank: (index + 1) * RANK_STEP }));
}

export interface MoveRankedResult<T> { items: T[]; rank: number; rebalanced: boolean }

export function moveRanked<T extends Ranked>(items: readonly T[], id: string, targetIndex: number): MoveRankedResult<T> {
  const moving = items.find((item) => item.id === id); if (!moving) throw new Error(`Элемент ${id} не найден`);
  let ordered = [...items].filter((item) => item.id !== id).sort(compareRanked);
  const index = Math.max(0, Math.min(targetIndex, ordered.length));
  let rank = rankBetween(ordered[index - 1]?.rank ?? null, ordered[index]?.rank ?? null); let rebalanced = false;
  if (rank === null) {
    ordered = rebalanceRanks(ordered); rank = rankBetween(ordered[index - 1]?.rank ?? null, ordered[index]?.rank ?? null); rebalanced = true;
  }
  if (rank === null) throw new Error("Не удалось подобрать ранг");
  const updated = { ...moving, rank };
  ordered.splice(index, 0, updated);
  return { items: ordered, rank, rebalanced };
}

export function moveGameToTier(database: LibraryDatabase, gameId: string, tierId: TierId, targetIndex: number): LibraryDatabase {
  const game = database.games[gameId]; if (!game) throw new Error(`Игра ${gameId} не найдена`);
  const result = structuredClone(database);
  let target = Object.values(result.games).filter((item) => item.id !== gameId && item.placement.tierId === tierId).sort((a, b) => a.placement.rank - b.placement.rank || a.id.localeCompare(b.id));
  const index = Math.max(0, Math.min(targetIndex, target.length));
  let rank = rankBetween(target[index - 1]?.placement.rank ?? null, target[index]?.placement.rank ?? null);
  if (rank === null) {
    target = target.map((item, position) => ({ ...item, placement: { ...item.placement, rank: (position + 1) * RANK_STEP } }));
    for (const item of target) result.games[item.id] = item;
    rank = rankBetween(target[index - 1]?.placement.rank ?? null, target[index]?.placement.rank ?? null);
  }
  if (rank === null) throw new Error("Не удалось подобрать позицию");
  result.games[gameId].placement = { tierId, rank };
  return result;
}
