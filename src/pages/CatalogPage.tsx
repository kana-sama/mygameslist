import { useEffect, useMemo, useState } from "react";
import { gameMatchesFilters } from "../domain/catalogue";
import { CATALOG_FILTERS_EVENT, parseCatalogSearch, sameCatalogSearch, serializeCatalogSearch, type CatalogSearchFilters } from "../domain/catalogSearch";
import { type Asset, type Game } from "../domain/types";
import { GameCard } from "../components/GameCard";
import { Icon } from "../components/Icon";
import { STATUS_LABELS, TIER_LABELS } from "../components/libraryUi";

export interface CatalogPageProps {
  games: Game[];
  assets: Record<string, Asset>;
  onOpenGame?: (gameId: string) => void;
  resolveAssetUrl?: (assetId: string) => string | null;
}

function initialFilters(): CatalogSearchFilters {
  return parseCatalogSearch(typeof window === "undefined" ? "" : window.location.hash.split("?")[1] ?? "");
}

export function CatalogPage({ games, assets, onOpenGame, resolveAssetUrl }: CatalogPageProps) {
  const [filters, setFilters] = useState<CatalogSearchFilters>(initialFilters);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = serializeCatalogSearch(filters);
    history.replaceState(null, "", `#/games${query ? `?${query}` : ""}`);
    window.dispatchEvent(new Event(CATALOG_FILTERS_EVENT));
  }, [filters]);

  useEffect(() => {
    const sync = () => {
      const next = initialFilters();
      setFilters((current) => sameCatalogSearch(current, next) ? current : next);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener(CATALOG_FILTERS_EVENT, sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(CATALOG_FILTERS_EVENT, sync);
    };
  }, []);

  const filtered = useMemo(() => {
    return games.filter((game) => {
      return gameMatchesFilters(game, {
        query: filters.q,
        statuses: filters.statuses,
        tiers: filters.tiers,
        platforms: filters.platforms,
        tags: filters.tags,
      });
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [filters, games]);
  const activeFilters = [
    ...filters.statuses.map((value) => ({ key: `status:${value}`, label: STATUS_LABELS[value], remove: () => setFilters((current) => ({ ...current, statuses: current.statuses.filter((item) => item !== value) })) })),
    ...filters.tiers.map((value) => ({ key: `tier:${value}`, label: `Тир ${TIER_LABELS[value]}`, remove: () => setFilters((current) => ({ ...current, tiers: current.tiers.filter((item) => item !== value) })) })),
    ...filters.platforms.map((value) => ({ key: `platform:${value}`, label: value, remove: () => setFilters((current) => ({ ...current, platforms: current.platforms.filter((item) => item !== value) })) })),
    ...filters.tags.map((value) => ({ key: `tag:${value}`, label: `#${value}`, remove: () => setFilters((current) => ({ ...current, tags: current.tags.filter((item) => item !== value) })) })),
  ];
  const clearFilters = () => setFilters({ q: "", statuses: [], tiers: [], platforms: [], tags: [] });
  const clearActiveFilters = () => setFilters((current) => ({ ...current, statuses: [], tiers: [], platforms: [], tags: [] }));

  return (
    <div className="page catalog-page">
      {activeFilters.length ? <section aria-label="Активные фильтры" className="catalog-active-filters"><div className="catalog-active-filters__chips">{activeFilters.map((filter) => <button aria-label={`Убрать фильтр: ${filter.label}`} key={filter.key} onClick={filter.remove} type="button"><span>{filter.label}</span><Icon name="close" size={13} /></button>)}</div><button className="catalog-active-filters__reset" onClick={clearActiveFilters} type="button">Сбросить</button></section> : null}
      {filtered.length ? <div className="catalog-list">{filtered.map((game) => <GameCard asset={game.coverAssetId ? assets[game.coverAssetId] : undefined} game={game} key={game.id} onOpen={onOpenGame} resolveAssetUrl={resolveAssetUrl} variant="list" />)}</div> : <div className="empty-state"><span className="empty-state__icon"><Icon name={games.length ? "search" : "gamepad"} /></span><h2>{games.length ? "Ничего не найдено" : "Добавьте первую игру"}</h2><p>{games.length ? "Попробуйте изменить запрос или убрать часть фильтров." : "Используйте постоянную кнопку в хедере — игра сразу появится здесь и в тирлисте."}</p>{games.length ? <button className="button button--secondary" onClick={clearFilters} type="button">Сбросить фильтры</button> : null}</div>}
    </div>
  );
}
