import { STATUS_IDS, TIER_IDS, type StatusId, type TierId } from "./types";

export const CATALOG_FILTERS_EVENT = "mylib-catalog-filters";

export interface CatalogSearchFilters {
  q: string;
  statuses: StatusId[];
  tiers: TierId[];
  platforms: string[];
  tags: string[];
}

export function emptyCatalogSearchFilters(): CatalogSearchFilters {
  return { q: "", statuses: [], tiers: [], platforms: [], tags: [] };
}

export function parseCatalogSearch(value: string): CatalogSearchFilters {
  const source = value.startsWith("?") ? value.slice(1) : value;
  const query = new URLSearchParams(source);
  return {
    q: query.get("q") ?? "",
    statuses: query.getAll("status").filter((item): item is StatusId => STATUS_IDS.includes(item as StatusId)),
    tiers: query.getAll("tier").filter((item): item is TierId => TIER_IDS.includes(item as TierId)),
    platforms: query.getAll("platform"),
    tags: query.getAll("tag"),
  };
}

export function serializeCatalogSearch(filters: CatalogSearchFilters): string {
  const query = new URLSearchParams();
  if (filters.q.trim()) query.set("q", filters.q.trim());
  filters.statuses.forEach((value) => query.append("status", value));
  filters.tiers.forEach((value) => query.append("tier", value));
  filters.platforms.forEach((value) => query.append("platform", value));
  filters.tags.forEach((value) => query.append("tag", value));
  return query.toString();
}

export function sameCatalogSearch(left: CatalogSearchFilters, right: CatalogSearchFilters): boolean {
  return serializeCatalogSearch(left) === serializeCatalogSearch(right);
}
