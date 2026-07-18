import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { gameMatchesFilters, gameSearchScore } from "../domain/catalogue";
import { CATALOG_FILTERS_EVENT, emptyCatalogSearchFilters, parseCatalogSearch, sameCatalogSearch, serializeCatalogSearch, type CatalogSearchFilters } from "../domain/catalogSearch";
import { STATUS_IDS, TIER_IDS, type Game, type StatusId, type TierId } from "../domain/types";
import { STATUS_LABELS, TIER_LABELS } from "./libraryUi";
import { Icon } from "./Icon";

export interface GlobalGameSearchProps {
  games: Game[];
  onNavigate?: (href: string) => void;
}

function catalogHash(): boolean {
  return /^#\/games(?:\?|$)/.test(window.location.hash);
}

function filtersFromLocation(): CatalogSearchFilters {
  return parseCatalogSearch(window.location.hash.split("?")[1] ?? "");
}

function writeCatalogLocation(filters: CatalogSearchFilters): void {
  if (!catalogHash()) return;
  const query = serializeCatalogSearch(filters);
  history.replaceState(null, "", `#/games${query ? `?${query}` : ""}`);
  window.dispatchEvent(new Event(CATALOG_FILTERS_EVENT));
}

function resultOrder(query: string): (left: Game, right: Game) => number {
  return (left, right) => gameSearchScore(left, query) - gameSearchScore(right, query)
    || left.title.localeCompare(right.title, "ru", { sensitivity: "base", numeric: true })
    || left.id.localeCompare(right.id);
}

function FilterMenu({ label, values, selected, renderLabel = (value) => value, onChange }: {
  label: string;
  values: string[];
  selected: string[];
  renderLabel?: (value: string) => string;
  onChange: (values: string[]) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);

  useEffect(() => {
    const closeWhenOutside = (event: Event) => {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
    };
  }, []);

  return <details className="filter-menu global-game-search__filter" ref={detailsRef}><summary>{label}{selected.length ? <b>{selected.length}</b> : null}<Icon name="chevron-down" size={16} /></summary><div className="filter-menu__panel">{values.length ? values.map((value) => <label key={value}><input checked={selected.includes(value)} onChange={() => toggle(value)} type="checkbox" /><span><Icon name="check" size={14} /></span>{renderLabel(value)}</label>) : <p>Пока нет вариантов</p>}</div></details>;
}

export function resolveGlobalSearchEnter(matches: Game[], selectedIndex: number | null): { kind: "game"; gameId: string } | { kind: "catalog" } {
  const selected = selectedIndex === null ? undefined : matches[selectedIndex];
  if (selected) return { kind: "game", gameId: selected.id };
  if (matches.length === 1) return { kind: "game", gameId: matches[0].id };
  return { kind: "catalog" };
}

export function GlobalGameSearch({ games, onNavigate }: GlobalGameSearchProps) {
  const [filters, setFilters] = useState<CatalogSearchFilters>(() => typeof window === "undefined" ? emptyCatalogSearchFilters() : filtersFromLocation());
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const isCatalog = typeof window !== "undefined" && catalogHash();
  const platforms = useMemo(() => [...new Set(games.flatMap((game) => game.platforms))].sort((left, right) => left.localeCompare(right, "ru")), [games]);
  const tags = useMemo(() => [...new Set(games.flatMap((game) => game.tags))].sort((left, right) => left.localeCompare(right, "ru")), [games]);
  const matches = useMemo(() => games.filter((game) => gameMatchesFilters(game, {
    query: filters.q,
    statuses: filters.statuses,
    tiers: filters.tiers,
    platforms: filters.platforms,
    tags: filters.tags,
  })).sort(resultOrder(filters.q)), [filters, games]);
  const visibleMatches = matches.slice(0, 8);
  const activeFilterCount = filters.statuses.length + filters.tiers.length + filters.platforms.length + filters.tags.length;

  const navigate = (href: string) => {
    setOpen(false);
    setSelectedIndex(null);
    if (onNavigate) onNavigate(href);
    else window.location.hash = href.slice(1);
  };
  const openGame = (gameId: string) => {
    setFilters(emptyCatalogSearchFilters());
    navigate(`#/games/${gameId}`);
  };
  const openCatalog = () => {
    const query = serializeCatalogSearch(filters);
    navigate(`#/games${query ? `?${query}` : ""}`);
  };
  const updateFilters = (next: CatalogSearchFilters) => {
    setFilters(next);
    setSelectedIndex(null);
    writeCatalogLocation(next);
  };
  const syncFromLocation = () => {
    if (!catalogHash()) return;
    const next = filtersFromLocation();
    setFilters((current) => sameCatalogSearch(current, next) ? current : next);
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLElement && target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k" || event.key === "/" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        syncFromLocation();
        setOpen(!catalogHash());
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener(CATALOG_FILTERS_EVENT, syncFromLocation);
    return () => {
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener(CATALOG_FILTERS_EVENT, syncFromLocation);
    };
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (isCatalog) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setSelectedIndex((current) => visibleMatches.length ? current === null ? 0 : (current + 1) % visibleMatches.length : null);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setSelectedIndex((current) => visibleMatches.length ? current === null ? visibleMatches.length - 1 : (current - 1 + visibleMatches.length) % visibleMatches.length : null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setSelectedIndex(null);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const action = resolveGlobalSearchEnter(matches, selectedIndex);
    if (action.kind === "game") openGame(action.gameId);
    else openCatalog();
  };

  const chips = [
    ...filters.statuses.map((value) => ({ key: `status:${value}`, label: STATUS_LABELS[value] })),
    ...filters.tiers.map((value) => ({ key: `tier:${value}`, label: `Тир ${TIER_LABELS[value]}` })),
    ...filters.platforms.map((value) => ({ key: `platform:${value}`, label: value })),
    ...filters.tags.map((value) => ({ key: `tag:${value}`, label: `#${value}` })),
  ];

  return <div className={`global-game-search${open ? " is-open" : ""}${isCatalog ? " is-catalog" : ""}`} ref={rootRef}>
    <div className="global-game-search__field" onClick={() => { if (isCatalog) setOpen(false); else setOpen(true); inputRef.current?.focus(); }}>
      <Icon name="search" size={16} />
      <input
        aria-activedescendant={!isCatalog && selectedIndex !== null ? `${listId}-${visibleMatches[selectedIndex]?.id}` : undefined}
        aria-autocomplete={isCatalog ? undefined : "list"}
        aria-controls={isCatalog ? undefined : listId}
        aria-expanded={isCatalog ? undefined : open}
        aria-label="Глобальный поиск игр"
        onChange={(event) => {
          if (!catalogHash()) setOpen(true);
          updateFilters({ ...filters, q: event.currentTarget.value });
        }}
        onFocus={() => { syncFromLocation(); setOpen(!isCatalog); }}
        onKeyDown={onKeyDown}
        placeholder="Поиск игр…"
        ref={inputRef}
        role={isCatalog ? "searchbox" : "combobox"}
        type="search"
        value={filters.q}
      />
      <span aria-hidden="true" className="global-game-search__shortcut">⌘K</span>
      <button aria-expanded={isCatalog ? open : undefined} aria-haspopup={isCatalog ? "dialog" : undefined} aria-label={`Фильтры${activeFilterCount ? `: выбрано ${activeFilterCount}` : ""}`} className="global-game-search__filter-button" onClick={(event) => { event.stopPropagation(); if (isCatalog) setOpen((current) => !current); else { setOpen(true); inputRef.current?.focus(); } }} type="button"><Icon name="filter" size={15} />{activeFilterCount ? <b>{activeFilterCount}</b> : null}</button>
      <button aria-label="Закрыть поиск" className="global-game-search__close" onClick={(event) => { event.stopPropagation(); setOpen(false); setSelectedIndex(null); inputRef.current?.blur(); }} type="button"><Icon name="close" size={17} /></button>
    </div>
    {open ? <div aria-label={isCatalog ? "Фильтры каталога" : undefined} className={`global-game-search__popover${isCatalog ? " is-filters-only" : ""}`} role={isCatalog ? "dialog" : undefined}>
      <div aria-label="Фильтры поиска" className="global-game-search__filters">
        <FilterMenu label="Статус" onChange={(statuses) => updateFilters({ ...filters, statuses: statuses as StatusId[] })} renderLabel={(value) => STATUS_LABELS[value as StatusId]} selected={filters.statuses} values={[...STATUS_IDS]} />
        <FilterMenu label="Тир" onChange={(tiers) => updateFilters({ ...filters, tiers: tiers as TierId[] })} renderLabel={(value) => TIER_LABELS[value as TierId]} selected={filters.tiers} values={[...TIER_IDS]} />
        <FilterMenu label="Платформа" onChange={(values) => updateFilters({ ...filters, platforms: values })} selected={filters.platforms} values={platforms} />
        <FilterMenu label="Тег" onChange={(values) => updateFilters({ ...filters, tags: values })} selected={filters.tags} values={tags} />
        {activeFilterCount ? <button className="global-game-search__reset" onClick={() => updateFilters({ ...emptyCatalogSearchFilters(), q: filters.q })} type="button">Сбросить · {activeFilterCount}</button> : null}
      </div>
      {!isCatalog && chips.length ? <div className="global-game-search__chips">{chips.map((chip) => <span key={chip.key}>{chip.label}</span>)}</div> : null}
      {!isCatalog ? <div aria-label="Результаты поиска" className="global-game-search__results" id={listId} role="listbox">
        {visibleMatches.map((game, index) => <button aria-selected={selectedIndex === index} className={selectedIndex === index ? "is-selected" : undefined} id={`${listId}-${game.id}`} key={game.id} onClick={() => openGame(game.id)} onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setSelectedIndex(index)} role="option" type="button"><span><strong>{game.title}</strong><small>{[...game.platforms.slice(0, 2), STATUS_LABELS[game.status]].join(" · ")}</small></span><Icon className="global-game-search__forward" name="arrow-left" size={15} /></button>)}
        {!visibleMatches.length ? <p>Ничего не найдено</p> : null}
      </div> : null}
      {!isCatalog ? <button className="global-game-search__all" onClick={openCatalog} type="button">{matches.length ? `Показать все результаты · ${matches.length}` : "Открыть каталог"}<Icon className="global-game-search__forward" name="arrow-left" size={15} /></button> : null}
    </div> : null}
  </div>;
}
