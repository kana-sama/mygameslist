import { STATUS_IDS, TIER_IDS, type Game, type LibraryDatabase, type StatusId, type TierId } from "./types";
import { fuzzySearch, searchQueryVariants } from "./fuzzySearch";

export interface CatalogueFilters {
  query?: string;
  statuses?: readonly StatusId[];
  platforms?: readonly string[];
  tags?: readonly string[];
  tiers?: readonly TierId[];
}

export type CatalogueSort = "updated-desc" | "updated-asc" | "title-asc" | "title-desc" | "created-desc" | "created-asc" | "status-asc" | "tier-asc";

function normalized(value: string): string {
  return searchQueryVariants(value)[0] ?? "";
}

export function gameSearchScore(game: Game, query = ""): number {
  if (!normalized(query)) return 0;
  const match = fuzzySearch(query, [
    { id: "title", priority: "primary", text: game.title },
    ...game.platforms.map((text, index) => ({ id: `platform:${index}`, priority: "secondary" as const, text })),
    ...game.tags.map((text, index) => ({ id: `tag:${index}`, priority: "secondary" as const, text })),
  ]);
  return match?.score ?? Number.POSITIVE_INFINITY;
}

function selectedMatch(values: readonly string[], selected: readonly string[] | undefined): boolean {
  if (!selected?.length) return true;
  const haystack = new Set(values.map(normalized));
  return selected.some((value) => haystack.has(normalized(value)));
}

/** OR inside every filter group; AND between non-empty groups. */
export function gameMatchesFilters(game: Game, filters: CatalogueFilters): boolean {
  if (!Number.isFinite(gameSearchScore(game, filters.query))) return false;
  if (filters.statuses?.length && !filters.statuses.includes(game.status)) return false;
  if (filters.tiers?.length && !filters.tiers.includes(game.placement.tierId)) return false;
  if (!selectedMatch(game.platforms, filters.platforms)) return false;
  if (!selectedMatch(game.tags, filters.tags)) return false;
  return true;
}

const statusOrder = new Map(STATUS_IDS.map((id, index) => [id, index]));
const tierOrder = new Map(TIER_IDS.map((id, index) => [id, index]));

export function compareGames(sort: CatalogueSort = "updated-desc"): (a: Game, b: Game) => number {
  const title = (a: Game, b: Game) => a.title.localeCompare(b.title, "ru", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);
  return (a, b) => {
    let result = 0;
    switch (sort) {
      case "updated-desc": result = b.updatedAt.localeCompare(a.updatedAt); break;
      case "updated-asc": result = a.updatedAt.localeCompare(b.updatedAt); break;
      case "created-desc": result = b.createdAt.localeCompare(a.createdAt); break;
      case "created-asc": result = a.createdAt.localeCompare(b.createdAt); break;
      case "title-desc": result = -title(a, b); break;
      case "title-asc": result = title(a, b); break;
      case "status-asc": result = (statusOrder.get(a.status) ?? 99) - (statusOrder.get(b.status) ?? 99); break;
      case "tier-asc": result = (tierOrder.get(a.placement.tierId) ?? 99) - (tierOrder.get(b.placement.tierId) ?? 99) || a.placement.rank - b.placement.rank; break;
    }
    return result || title(a, b);
  };
}

export function queryGames(database: LibraryDatabase, filters: CatalogueFilters = {}, sort: CatalogueSort = "updated-desc"): Game[] {
  return Object.values(database.games).filter((game) => gameMatchesFilters(game, filters)).sort(compareGames(sort));
}

export function catalogueFacets(database: LibraryDatabase): { platforms: string[]; tags: string[] } {
  const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
  const unique = (values: string[]) => [...new Map(values.map((value) => [normalized(value), value.trim()])).values()].sort(collator.compare);
  const games = Object.values(database.games);
  return { platforms: unique(games.flatMap((game) => game.platforms)), tags: unique(games.flatMap((game) => game.tags)) };
}
