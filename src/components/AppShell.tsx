import type { ReactNode, MouseEvent } from "react";
import { Icon } from "./Icon";
import { formatBytes } from "./libraryUi";

export type AppRoute = "tiers" | "catalog" | "game" | "new";

export interface StorageSummary {
  bytes: number;
  budgetBytes?: number;
  operationCount: number;
  conflictCount?: number;
}

export interface AppShellProps {
  children: ReactNode;
  route: AppRoute;
  storage: StorageSummary;
  onOpenDiff: () => void;
  onNavigate?: (href: string) => void;
  showLocalOnlyNotice?: boolean;
  onDismissLocalOnlyNotice?: () => void;
  onExportPatch?: () => void;
  onRequestPersistentStorage?: () => void;
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
  showLocalOnlyNotice = false,
  onDismissLocalOnlyNotice,
  onExportPatch,
  onRequestPersistentStorage,
}: AppShellProps) {
  const budget = storage.budgetBytes ?? 4 * 1024 * 1024;
  const ratio = budget ? storage.bytes / budget : 0;
  const storageLevel = ratio >= 0.95 ? "blocked" : ratio >= 0.85 ? "critical" : ratio >= 0.7 ? "warning" : "ok";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">К основному содержимому</a>
      <header className="app-header">
        <a className="brand" href="#/" onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate("#/"); } : undefined}>
          <span className="brand__mark"><Icon name="gamepad" size={23} /></span>
          <span className="brand__text">
            <strong>Моя игровая</strong>
            <small>библиотека</small>
          </span>
        </a>
        <nav aria-label="Основная навигация" className="app-nav app-nav--desktop">
          <NavLink active={route === "tiers"} href="#/" icon="book" label="Тирлист" onNavigate={onNavigate} />
          <NavLink active={route === "catalog"} href="#/games" icon="collection" label="Каталог" onNavigate={onNavigate} />
        </nav>
        <div className="app-header__actions">
          <button className={`patch-pill patch-pill--${storageLevel}`} onClick={onOpenDiff} type="button">
            <span className="patch-pill__pulse" aria-hidden="true" />
            <span>Локальные правки</span>
            <strong>{storage.operationCount}</strong>
            <span className="patch-pill__size">{formatBytes(storage.bytes)}</span>
            {storage.conflictCount ? <span className="patch-pill__conflicts" aria-label={`${storage.conflictCount} конфликтов`}><Icon name="warning" size={15} /></span> : null}
          </button>
          <a className="button button--primary button--new-game" href="#/games/new" onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate("#/games/new"); } : undefined}>
            <Icon name="plus" size={18} />Добавить игру
          </a>
        </div>
      </header>

      {storageLevel !== "ok" ? (
        <div className={`storage-banner storage-banner--${storageLevel}`} role={storageLevel === "blocked" ? "alert" : "status"}>
          <Icon name="warning" />
          <div>
            <strong>
              {storageLevel === "blocked" ? "Локальное хранилище почти заполнено" : storageLevel === "critical" ? "Осталось мало места" : "Патч стал довольно большим"}
            </strong>
            <span>{formatBytes(storage.bytes)} из безопасного бюджета {formatBytes(budget)} для Safari. {storageLevel === "blocked" ? "Добавление данных приостановлено — экспортируйте или опубликуйте патч." : "Рекомендуем сделать резервную копию."}</span>
          </div>
          {onExportPatch ? <button className="button button--secondary" onClick={onExportPatch} type="button"><Icon name="download" size={17} />Экспорт</button> : null}
        </div>
      ) : null}

      {showLocalOnlyNotice ? (
        <aside className="local-notice" aria-label="Важно о локальных правках">
          <Icon name="info" />
          <div>
            <strong>Правки живут только в этом Safari</strong>
            <p>Они не синхронизируются между Mac и iPhone и могут быть удалены браузером. Регулярно экспортируйте резервную копию.</p>
            <div className="local-notice__actions">
              {onExportPatch ? <button onClick={onExportPatch} type="button">Скачать копию</button> : null}
              {onRequestPersistentStorage ? <button onClick={onRequestPersistentStorage} type="button">Попросить Safari хранить дольше</button> : null}
            </div>
          </div>
          {onDismissLocalOnlyNotice ? <button aria-label="Закрыть уведомление" className="icon-button" onClick={onDismissLocalOnlyNotice} type="button"><Icon name="close" /></button> : null}
        </aside>
      ) : null}

      <main id="main-content" className="app-main">{children}</main>

      <nav aria-label="Основная навигация" className="app-nav app-nav--mobile">
        <NavLink active={route === "tiers"} href="#/" icon="book" label="Тирлист" onNavigate={onNavigate} />
        <NavLink active={route === "catalog"} href="#/games" icon="collection" label="Каталог" onNavigate={onNavigate} />
        <NavLink active={route === "new"} href="#/games/new" icon="plus" label="Добавить" onNavigate={onNavigate} />
        <button aria-current={false} className="app-nav__link" onClick={onOpenDiff} type="button">
          <span className="app-nav__patch-icon"><Icon name="clipboard" /><b>{storage.operationCount}</b></span>
          <span>Правки</span>
        </button>
      </nav>
    </div>
  );
}
