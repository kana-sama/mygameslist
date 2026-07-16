import type { Asset, Game, StatusId, TierId } from "../domain/types";
import { publishedAssetUrl } from "../domain/assets";

export const STATUS_LABELS: Record<StatusId, string> = {
  wishlist: "Хочу поиграть",
  playing: "Играю",
  played: "Играл",
  completed: "Пройдено",
  dropped: "Брошено",
};

export const TIER_LABELS: Record<TierId, string> = {
  s: "S",
  a: "A",
  b: "B",
  c: "C",
  d: "D",
  f: "F",
  unranked: "Без оценки",
};

export const TIER_DESCRIPTIONS: Record<TierId, string> = {
  s: "Лучшее из лучшего",
  a: "Отличные игры",
  b: "Очень хорошие",
  c: "Хорошие",
  d: "На любителя",
  f: "Не понравилось",
  unranked: "Ещё не в тирлисте",
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("ru-RU", {
    maximumFractionDigits: index === 0 ? 0 : 1,
  })} ${units[index]}`;
}

export function formatRelativeDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Дата не указана";
  const now = Date.now();
  const deltaDays = Math.round((timestamp - now) / 86_400_000);
  const relative = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  if (Math.abs(deltaDays) < 1) return "сегодня";
  if (Math.abs(deltaDays) < 30) return relative.format(deltaDays, "day");
  const deltaMonths = Math.round(deltaDays / 30);
  if (Math.abs(deltaMonths) < 12) return relative.format(deltaMonths, "month");
  return new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

export function getAssetUrl(asset: Asset | undefined): string | null {
  return asset ? publishedAssetUrl(asset, import.meta.env.BASE_URL) : null;
}

export function sortGamesByPlacement(games: Game[]): Game[] {
  return [...games].sort((left, right) =>
    left.placement.rank - right.placement.rank || left.title.localeCompare(right.title, "ru"),
  );
}

export function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/") && !trimmed.startsWith("//") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function joinHuman(items: string[], limit = 2): string {
  if (items.length <= limit) return items.join(" · ");
  return `${items.slice(0, limit).join(" · ")} +${items.length - limit}`;
}
