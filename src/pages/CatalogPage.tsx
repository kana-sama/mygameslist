import { useEffect, useMemo, useState } from "react";
import { gameMatchesFilters } from "../domain/catalogue";
import { STATUS_IDS, TIER_IDS, type Asset, type Collection, type CollectionItem, type Game, type StatusId, type TierId } from "../domain/types";
import { GameCard } from "../components/GameCard";
import { Icon } from "../components/Icon";
import { STATUS_LABELS, TIER_LABELS } from "../components/libraryUi";

type SortId = "updated" | "title" | "created" | "status" | "tier";
interface CatalogFilters { q: string; statuses: StatusId[]; tiers: TierId[]; platforms: string[]; tags: string[]; collections: string[]; sort: SortId }

export interface CatalogPageProps {
  games: Game[];
  assets: Record<string, Asset>;
  collections: Collection[];
  collectionItems: CollectionItem[];
  onOpenGame?: (gameId: string) => void;
  onCreateCollection?: (input: { title: string; descriptionMarkdown: string }) => void;
  onRenameCollection?: (collectionId: string, title: string) => void;
  onDeleteCollection?: (collectionId: string) => void;
  onAddGamesToCollection?: (collectionId: string, gameIds: string[]) => void;
}

function initialFilters(): CatalogFilters {
  const query = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  return {
    q: query.get("q") ?? "",
    statuses: query.getAll("status").filter((value): value is StatusId => STATUS_IDS.includes(value as StatusId)),
    tiers: query.getAll("tier").filter((value): value is TierId => TIER_IDS.includes(value as TierId)),
    platforms: query.getAll("platform"), tags: query.getAll("tag"), collections: query.getAll("collection"),
    sort: (["updated", "title", "created", "status", "tier"].includes(query.get("sort") ?? "") ? query.get("sort") : "updated") as SortId,
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

export function CatalogPage({ games, assets, collections, collectionItems, onOpenGame, onCreateCollection, onRenameCollection, onDeleteCollection, onAddGamesToCollection }: CatalogPageProps) {
  const [filters, setFilters] = useState<CatalogFilters>(initialFilters);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkCollection, setBulkCollection] = useState("");
  const platforms = useMemo(() => [...new Set(games.flatMap((game) => game.platforms))].sort((a, b) => a.localeCompare(b, "ru")), [games]);
  const tags = useMemo(() => [...new Set(games.flatMap((game) => game.tags))].sort((a, b) => a.localeCompare(b, "ru")), [games]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.sort !== "updated") query.set("sort", filters.sort);
    filters.statuses.forEach((value) => query.append("status", value)); filters.tiers.forEach((value) => query.append("tier", value));
    filters.platforms.forEach((value) => query.append("platform", value)); filters.tags.forEach((value) => query.append("tag", value)); filters.collections.forEach((value) => query.append("collection", value));
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
        collectionIds: filters.collections,
      }, collectionItems);
    }).sort((left, right) => {
      if (filters.sort === "title") return left.title.localeCompare(right.title, "ru");
      if (filters.sort === "created") return right.createdAt.localeCompare(left.createdAt);
      if (filters.sort === "status") return STATUS_IDS.indexOf(left.status) - STATUS_IDS.indexOf(right.status) || left.title.localeCompare(right.title, "ru");
      if (filters.sort === "tier") return TIER_IDS.indexOf(left.placement.tierId) - TIER_IDS.indexOf(right.placement.tierId) || left.placement.rank - right.placement.rank;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [collectionItems, filters, games]);
  const activeFilterCount = filters.statuses.length + filters.tiers.length + filters.platforms.length + filters.tags.length + filters.collections.length;
  const clearFilters = () => setFilters({ q: "", statuses: [], tiers: [], platforms: [], tags: [], collections: [], sort: "updated" });

  return (
    <div className="page catalog-page">
      <header className="page-heading"><div><span className="eyebrow">Все игры</span><h1>Каталог</h1><p>{games.length ? `${games.length} игр в библиотеке` : "Библиотека пока пуста"}</p></div><a className="button button--primary" href="#/games/new"><Icon name="plus" size={18} />Добавить игру</a></header>
      <section className="catalog-controls" aria-label="Поиск и фильтры">
        <label className="search-field"><Icon name="search" /><input aria-label="Поиск игр" onChange={(event) => setFilters((value) => ({ ...value, q: event.currentTarget.value }))} placeholder="Название, платформа или тег…" type="search" value={filters.q} />{filters.q ? <button aria-label="Очистить поиск" onClick={() => setFilters((value) => ({ ...value, q: "" }))} type="button"><Icon name="close" size={17} /></button> : null}</label>
        <div className="filter-row">
          <FilterChecks label="Статус" onChange={(statuses) => setFilters((value) => ({ ...value, statuses: statuses as StatusId[] }))} renderLabel={(value) => STATUS_LABELS[value as StatusId]} selected={filters.statuses} values={[...STATUS_IDS]} />
          <FilterChecks label="Тир" onChange={(tiers) => setFilters((value) => ({ ...value, tiers: tiers as TierId[] }))} renderLabel={(value) => TIER_LABELS[value as TierId]} selected={filters.tiers} values={[...TIER_IDS]} />
          <FilterChecks label="Платформа" onChange={(value) => setFilters((current) => ({ ...current, platforms: value }))} selected={filters.platforms} values={platforms} />
          <FilterChecks label="Тег" onChange={(value) => setFilters((current) => ({ ...current, tags: value }))} renderLabel={(value) => `#${value}`} selected={filters.tags} values={tags} />
          <FilterChecks label="Коллекция" onChange={(value) => setFilters((current) => ({ ...current, collections: value }))} renderLabel={(value) => collections.find((item) => item.id === value)?.title ?? value} selected={filters.collections} values={collections.map((item) => item.id)} />
          {activeFilterCount ? <button className="clear-filters" onClick={clearFilters} type="button">Сбросить · {activeFilterCount}</button> : null}
        </div>
      </section>
      <div className="catalog-subbar">
        <span>Найдено: <strong>{filtered.length}</strong></span>
        <label>Сортировка <span className="select-wrap"><select onChange={(event) => setFilters((value) => ({ ...value, sort: event.currentTarget.value as SortId }))} value={filters.sort}><option value="updated">Последние изменения</option><option value="title">По названию</option><option value="created">Сначала новые</option><option value="status">По статусу</option><option value="tier">По тиру</option></select><Icon name="chevron-down" size={16} /></span></label>
      </div>
      {selected.length ? <div className="bulk-bar"><strong>Выбрано: {selected.length}</strong><span className="select-wrap"><select onChange={(event) => setBulkCollection(event.currentTarget.value)} value={bulkCollection}><option value="">Выберите коллекцию</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select><Icon name="chevron-down" size={16} /></span><button className="button button--primary" disabled={!bulkCollection} onClick={() => { onAddGamesToCollection?.(bulkCollection, selected); setSelected([]); }} type="button">Добавить</button><button className="button button--ghost" onClick={() => setSelected([])} type="button">Отмена</button></div> : null}
      {filtered.length ? <div className="catalog-list">{filtered.map((game) => <GameCard asset={game.coverAssetId ? assets[game.coverAssetId] : undefined} game={game} key={game.id} onOpen={onOpenGame} onSelect={onAddGamesToCollection ? (id, checked) => setSelected((values) => checked ? [...values, id] : values.filter((value) => value !== id)) : undefined} selected={selected.includes(game.id)} variant="list" />)}</div> : <div className="empty-state"><span className="empty-state__icon"><Icon name={games.length ? "search" : "gamepad"} /></span><h2>{games.length ? "Ничего не найдено" : "Каталог ждёт первую игру"}</h2><p>{games.length ? "Попробуйте изменить запрос или убрать часть фильтров." : "Добавьте игру — она сразу появится здесь и в тирлисте."}</p>{games.length ? <button className="button button--secondary" onClick={clearFilters} type="button">Сбросить фильтры</button> : <a className="button button--primary" href="#/games/new">Добавить игру</a>}</div>}
      <section className="collections-strip"><header><div><h2>Коллекции</h2><p>Ручные подборки игр</p></div>{onCreateCollection ? <button className="button button--secondary" onClick={() => { const title = window.prompt("Название коллекции"); if (title?.trim()) onCreateCollection({ title: title.trim(), descriptionMarkdown: "" }); }} type="button"><Icon name="plus" size={17} />Создать</button> : null}</header>{collections.length ? <div className="collection-cards">{collections.map((collection) => <article key={collection.id}><span><Icon name="collection" /></span><div><strong>{collection.title}</strong><small>{collectionItems.filter((item) => item.collectionId === collection.id).length} игр</small></div>{onRenameCollection || onDeleteCollection ? <details><summary aria-label="Действия"><Icon name="more" /></summary><div>{onRenameCollection ? <button onClick={() => { const title = window.prompt("Новое название", collection.title); if (title?.trim()) onRenameCollection(collection.id, title.trim()); }} type="button">Переименовать</button> : null}{onDeleteCollection ? <button className="danger" onClick={() => window.confirm(`Удалить коллекцию «${collection.title}»? Игры останутся в библиотеке.`) && onDeleteCollection(collection.id)} type="button">Удалить</button> : null}</div></details> : null}</article>)}</div> : <p className="collections-strip__empty">Коллекций пока нет. Например, соберите все игры Mario в одну подборку.</p>}</section>
    </div>
  );
}
