import { useEffect, useMemo, useState } from "react";
import { gameMatchesFilters } from "../domain/catalogue";
import { STATUS_IDS, TIER_IDS, type Asset, type Game, type StatusId, type TierId } from "../domain/types";
import { GameCard } from "../components/GameCard";
import { Icon } from "../components/Icon";
import { STATUS_LABELS, TIER_LABELS } from "../components/libraryUi";

interface CatalogFilters { q: string; statuses: StatusId[]; tiers: TierId[]; platforms: string[]; tags: string[] }

export interface CatalogPageProps {
  games: Game[];
  assets: Record<string, Asset>;
  onOpenGame?: (gameId: string) => void;
  resolveAssetUrl?: (assetId: string) => string | null;
}

function initialFilters(): CatalogFilters {
  const query = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  return {
    q: query.get("q") ?? "",
    statuses: query.getAll("status").filter((value): value is StatusId => STATUS_IDS.includes(value as StatusId)),
    tiers: query.getAll("tier").filter((value): value is TierId => TIER_IDS.includes(value as TierId)),
    platforms: query.getAll("platform"), tags: query.getAll("tag"),
  };
}

function FilterChecks({ label, values, selected, onChange, renderLabel = (value) => value }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void; renderLabel?: (value: string) => string }) {
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  return (
    <details className="filter-menu">
      <summary>{label}{selected.length ? <b>{selected.length}</b> : null}<Icon name="chevron-down" size={16} /></summary>
      <div className="filter-menu__panel">
        {values.length ? values.map((value) => <label key={value}><input checked={selected.includes(value)} onChange={() => toggle(value)} type="checkbox" /><span><Icon name="check" size={14} /></span>{renderLabel(value)}</label>) : <p>Пока нет вариантов</p>}
      </div>
    </details>
  );
}

export function CatalogPage({ games, assets, onOpenGame, resolveAssetUrl }: CatalogPageProps) {
  const [filters, setFilters] = useState<CatalogFilters>(initialFilters);
  const platforms = useMemo(() => [...new Set(games.flatMap((game) => game.platforms))].sort((a, b) => a.localeCompare(b, "ru")), [games]);
  const tags = useMemo(() => [...new Set(games.flatMap((game) => game.tags))].sort((a, b) => a.localeCompare(b, "ru")), [games]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    filters.statuses.forEach((value) => query.append("status", value)); filters.tiers.forEach((value) => query.append("tier", value));
    filters.platforms.forEach((value) => query.append("platform", value)); filters.tags.forEach((value) => query.append("tag", value));
    history.replaceState(null, "", `#/games${query.size ? `?${query}` : ""}`);
  }, [filters]);

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
  const activeFilterCount = filters.statuses.length + filters.tiers.length + filters.platforms.length + filters.tags.length;
  const clearFilters = () => setFilters({ q: "", statuses: [], tiers: [], platforms: [], tags: [] });

  return (
    <div className="page catalog-page">
      <section className="catalog-controls" aria-label="Поиск и фильтры">
        <div className="filter-row">
          <FilterChecks label="Статус" onChange={(statuses) => setFilters((value) => ({ ...value, statuses: statuses as StatusId[] }))} renderLabel={(value) => STATUS_LABELS[value as StatusId]} selected={filters.statuses} values={[...STATUS_IDS]} />
          <FilterChecks label="Тир" onChange={(tiers) => setFilters((value) => ({ ...value, tiers: tiers as TierId[] }))} renderLabel={(value) => TIER_LABELS[value as TierId]} selected={filters.tiers} values={[...TIER_IDS]} />
          <FilterChecks label="Платформа" onChange={(value) => setFilters((current) => ({ ...current, platforms: value }))} selected={filters.platforms} values={platforms} />
          <FilterChecks label="Тег" onChange={(value) => setFilters((current) => ({ ...current, tags: value }))} renderLabel={(value) => `#${value}`} selected={filters.tags} values={tags} />
          {activeFilterCount ? <button className="clear-filters" onClick={clearFilters} type="button">Сбросить · {activeFilterCount}</button> : null}
        </div>
        <label className="search-field"><Icon name="search" /><input aria-label="Поиск игр" onChange={(event) => { const q = event.currentTarget.value; setFilters((value) => ({ ...value, q })); }} placeholder="Поиск…" type="search" value={filters.q} />{filters.q ? <button aria-label="Очистить поиск" onClick={() => setFilters((value) => ({ ...value, q: "" }))} type="button"><Icon name="close" size={17} /></button> : null}</label>
      </section>
      {filtered.length ? <div className="catalog-list">{filtered.map((game) => <GameCard asset={game.coverAssetId ? assets[game.coverAssetId] : undefined} game={game} key={game.id} onOpen={onOpenGame} resolveAssetUrl={resolveAssetUrl} variant="list" />)}</div> : <div className="empty-state"><span className="empty-state__icon"><Icon name={games.length ? "search" : "gamepad"} /></span><h2>{games.length ? "Ничего не найдено" : "Добавьте первую игру"}</h2><p>{games.length ? "Попробуйте изменить запрос или убрать часть фильтров." : "Используйте постоянную кнопку в хедере — игра сразу появится здесь и в тирлисте."}</p>{games.length ? <button className="button button--secondary" onClick={clearFilters} type="button">Сбросить фильтры</button> : null}</div>}
    </div>
  );
}
