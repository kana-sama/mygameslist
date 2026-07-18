import type { ReactNode, MouseEvent } from "react";
import { Icon } from "./Icon";
import { formatBytes } from "./libraryUi";

export type AppRoute = "tiers" | "catalog" | "game" | "new";

export interface StorageSummary {
  bytes: number;
  budgetBytes?: number;
  localAssetCount?: number;
  localAssetBytes?: number;
  quotaLevel?: "unknown" | "ok" | "warning" | "critical" | "blocked";
  persistent?: boolean;
  oldestLocalAssetAt?: number | null;
  operationCount: number;
  conflictCount?: number;
  error?: string;
}

export interface AppShellProps {
  children: ReactNode;
  route: AppRoute;
  storage: StorageSummary;
  onOpenDiff: () => void;
  onNavigate?: (href: string) => void;
}

function NavLink({
  active,
  href,
  icon,
  label,
  onNavigate,
}: {
  active: boolean;
  href: string;
  icon: "book" | "collection" | "plus";
  label: string;
  onNavigate?: (href: string) => void;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate) return;
    event.preventDefault();
    onNavigate(href);
  };
  return (
    <a aria-current={active ? "page" : undefined} className="app-nav__link" href={href} onClick={onClick}>
      <Icon name={icon} />
      <span>{label}</span>
    </a>
  );
}

export function AppShell({
  children,
  route,
  storage,
  onOpenDiff,
  onNavigate,
}: AppShellProps) {
  const budget = storage.budgetBytes ?? 4 * 1024 * 1024;
  const ratio = budget ? storage.bytes / budget : 0;
  const localAssetCount = storage.localAssetCount ?? 0;
  const localAssetBytes = storage.localAssetBytes ?? 0;
  const localLevel = storage.quotaLevel ?? "unknown";
  const localAgeDays = storage.oldestLocalAssetAt ? Math.floor((Date.now() - storage.oldestLocalAssetAt) / (24 * 60 * 60 * 1000)) : 0;
  const localWarning = localAssetCount > 0 && (localLevel === "warning" || localLevel === "critical" || localLevel === "blocked" || !storage.persistent || localAssetBytes >= 100 * 1024 * 1024 || localAgeDays >= 7);
  const storageLevel = storage.error
    ? "error"
    : localLevel === "blocked" || ratio >= 0.95
      ? "blocked"
      : localLevel === "critical" || localAssetBytes >= 250 * 1024 * 1024 || ratio >= 0.85
        ? "critical"
        : localWarning || ratio >= 0.7
          ? "warning"
          : "ok";
  const storageNeedsAttention = storageLevel === "warning" || storageLevel === "critical" || storageLevel === "blocked";
  const displayedBytes = storage.bytes + localAssetBytes;

  return (
    <div className="app-shell" data-route={route}>
      <a className="skip-link" href="#main-content">К основному содержимому</a>
      <header className="app-header">
        <nav aria-label="Основная навигация" className="app-nav app-nav--desktop">
          <NavLink active={route === "tiers"} href="#/" icon="book" label="Тирлист" onNavigate={onNavigate} />
          <NavLink active={route === "catalog"} href="#/games" icon="collection" label="Каталог" onNavigate={onNavigate} />
        </nav>
        <div className="app-header__actions">
          <button
            aria-label={`Локальные правки: ${storage.operationCount}, ${formatBytes(displayedBytes)}${localAssetCount ? `, локальных файлов: ${localAssetCount}` : ""}${storage.conflictCount ? `, конфликтов: ${storage.conflictCount}` : ""}${storageNeedsAttention ? ", хранилище требует внимания" : ""}${storage.error ? `, ошибка: ${storage.error}` : ""}`}
            className={`patch-pill patch-pill--${storageLevel}`}
            onClick={onOpenDiff}
            title={storage.error}
            type="button"
          >
            <span className="patch-pill__pulse" aria-hidden="true" />
            <span>Локальные правки</span>
            <strong>{storage.operationCount}</strong>
            <span className="patch-pill__size">{formatBytes(displayedBytes)}</span>
            {storage.conflictCount ? <span className="patch-pill__conflicts" aria-label={`${storage.conflictCount} конфликтов`}><Icon name="warning" size={15} /></span> : null}
          </button>
          {storage.error ? <span className="visually-hidden" role="alert">{storage.error}</span> : null}
          <a className="button button--primary button--new-game" href="#/games/new" onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate("#/games/new"); } : undefined}>
            <Icon name="plus" size={18} />Добавить игру
          </a>
        </div>
      </header>

      <main id="main-content" className="app-main">{children}</main>
    </div>
  );
}
