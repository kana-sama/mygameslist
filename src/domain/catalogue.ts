import { STATUS_IDS, TIER_IDS, type Game, type LibraryDatabase, type StatusId, type TierId } from "./types";

export interface CatalogueFilters {
  query?: string;
  statuses?: readonly StatusId[];
  platforms?: readonly string[];
  tags?: readonly string[];
  tiers?: readonly TierId[];
}

export type CatalogueSort = "updated-desc" | "updated-asc" | "title-asc" | "title-desc" | "created-desc" | "created-asc" | "status-asc" | "tier-asc";

const ENGLISH_KEYBOARD = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const RUSSIAN_KEYBOARD = "ёйцукенгшщзхъфывапролджэячсмитьбю.";

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ё/g, "е").trim().toLocaleLowerCase("ru");
}

function swapKeyboardLayout(value: string, source: string, target: string): string {
  return [...value.toLocaleLowerCase("ru")].map((character) => {
    const index = source.indexOf(character);
    return index === -1 ? character : target[index];
  }).join("");
}

export function searchQueryVariants(value: string): string[] {
  return [...new Set([
    normalized(value),
    normalized(swapKeyboardLayout(value, ENGLISH_KEYBOARD, RUSSIAN_KEYBOARD)),
    normalized(swapKeyboardLayout(value, RUSSIAN_KEYBOARD, ENGLISH_KEYBOARD)),
  ])].filter(Boolean);
}

function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row;
  for (let column = 0; column <= b.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}

function allowedEditDistance(length: number): number {
  if (length < 4) return 0;
  if (length < 7) return 1;
  return 2;
}

function subsequenceGap(term: string, word: string): number | null {
  if (term.length < 3 || term.length >= word.length) return null;
  let termIndex = 0;
  for (const character of word) {
    if (character === term[termIndex]) termIndex += 1;
    if (termIndex === term.length) break;
  }
  if (termIndex !== term.length) return null;
  const gap = word.length - term.length;
  return gap <= Math.max(2, Math.floor(term.length / 2)) ? gap : null;
}

function fuzzyTermScore(searchable: string, title: string, term: string): number {
  if (title === term) return 0;
  if (title.startsWith(term)) return 10;
  const titleWords = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const initials = titleWords.map((word) => word[0]).join("");
  const initialismIndex = term.length >= 2 ? initials.indexOf(term) : -1;
  if (initialismIndex !== -1) return 15 + initialismIndex;
  if (title.includes(term)) return 20;
  if (searchable.includes(term)) return 30;
  const words = searchable.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let smallestGap = Number.POSITIVE_INFINITY;
  for (const word of words) {
    const gap = subsequenceGap(term, word);
    if (gap !== null) smallestGap = Math.min(smallestGap, gap);
  }
  if (Number.isFinite(smallestGap)) return 35 + smallestGap;
  const maximum = allowedEditDistance(term.length);
  if (!maximum) return Number.POSITIVE_INFINITY;
  let closest = Number.POSITIVE_INFINITY;
  for (const word of words) {
    if (Math.abs(word.length - term.length) > maximum) continue;
    closest = Math.min(closest, editDistance(term, word));
  }
  return closest <= maximum ? 40 + closest : Number.POSITIVE_INFINITY;
}

export function gameSearchScore(game: Game, query = ""): number {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const title = normalized(game.title);
  const searchable = normalized([game.title, ...game.platforms, ...game.tags].join(" "));
  let total = 0;
  for (const term of terms) {
    const variants = searchQueryVariants(term);
    const score = Math.min(...variants.map((variant, index) => fuzzyTermScore(searchable, title, variant) + index));
    if (!Number.isFinite(score)) return Number.POSITIVE_INFINITY;
    total += score;
  }
  return total;
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
