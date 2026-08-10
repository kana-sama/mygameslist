import { forwardRef, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import "./diff-sync.css";

export type DiffSyncStage =
  | "idle"
  | "connecting"
  | "reading"
  | "validating"
  | "uploading"
  | "committing"
  | "updating"
  | "complete";

export type DiffSyncPersistence = "none" | "session" | "persistent";

export interface DiffSyncPublicationController {
  status: "waiting" | "memory-only" | "recovery" | "problem" | "corrupt" | "legacy" | "read-failure";
  check?: "waiting-source" | "checking" | "asset-verification" | "non-current" | "unrelated" | "unverifiable" | "revision-mismatch" | "finalize-failed" | null;
  targetCommitUrl?: string;
  exportCompleted: boolean;
  onRetryPersistence: () => void | Promise<void>;
  onRetryCheck: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onReload: () => void;
}

export interface DiffSyncController {
  connected: boolean;
  connectMode?: "sync" | "verify" | "recovery";
  persistence: DiffSyncPersistence;
  busy: boolean;
  stage: DiffSyncStage;
  error: string | null;
  commitUrl?: string;
  pagesPending: boolean;
  repository?: string;
  patCreationHref?: string;
  actionLabel?: string;
  publication?: DiffSyncPublicationController;
  onConnect: (token: string, remember: boolean, selectedPaths?: readonly string[]) => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onSync: (selectedPaths?: readonly string[]) => void | Promise<void>;
  onDismissError?: () => void;
}

interface DiffSyncButtonProps {
  actionLabel?: string;
  busy: boolean;
  expanded: boolean;
  onClick: () => void;
}

interface DiffSyncPanelProps {
  blockedReason?: string;
  controller: DiffSyncController;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  open: boolean;
}

const stageLabels: Record<Exclude<DiffSyncStage, "idle">, string> = {
  connecting: "Проверяем PAT…",
  reading: "Загружаем текущую версию…",
  validating: "Проверяем изменения…",
  uploading: "Загружаем файлы…",
  committing: "Создаём коммит…",
  updating: "Обновляем ветку…",
  complete: "Синхронизация завершена",
};

export function isDiffSyncBusy(stage: DiffSyncStage | undefined): boolean {
  return Boolean(stage && stage !== "idle" && stage !== "complete");
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Не удалось синхронизировать библиотеку";
}

export const DiffSyncButton = forwardRef<HTMLButtonElement, DiffSyncButtonProps>(function DiffSyncButton({ actionLabel, busy, expanded, onClick }, ref) {
  return (
    <button
      aria-controls="diff-sync-panel"
      aria-expanded={expanded}
      className="button button--primary diff-sync-button"
      onClick={onClick}
      ref={ref}
      type="button"
    >
      <Icon name="upload" size={16} />
      {busy ? "Синхронизация…" : actionLabel ?? "Синхронизировать"}
    </button>
  );
});

export function DiffSyncPanel({ blockedReason, controller, onBusyChange, onClose, open }: DiffSyncPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const savedSyncRef = useRef<HTMLButtonElement>(null);
  const [pat, setPat] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const stage = controller.stage;
  const busy = submitting || controller.busy || isDiffSyncBusy(stage);
  const showPatForm = !controller.connected;
  const connectWithoutSync = showPatForm && controller.connectMode === "verify";
  const recoveryConnection = showPatForm && controller.connectMode === "recovery";
  const publicationBlocked = controller.publication !== undefined;
  const actionLabel = controller.actionLabel ?? "Синхронизировать";

  useEffect(() => {
    if (!open || !showPatForm || busy) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [busy, open, showPatForm]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!open) {
      setPat("");
      setRemember(false);
      setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const runSync = async () => {
    if (blockedReason || busy) return;
    setLocalError(null);
    controller.onDismissError?.();
    setSubmitting(true);
    try {
      await controller.onSync();
    } catch (reason) {
      setLocalError(errorMessage(reason));
    } finally {
      setSubmitting(false);
      requestAnimationFrame(() => savedSyncRef.current?.focus());
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = pat.trim();
    if (!value) {
      setLocalError("Введите fine-grained PAT");
      inputRef.current?.focus();
      return;
    }
    void connect(value);
  };

  const connect = async (token: string) => {
    setLocalError(null);
    controller.onDismissError?.();
    setSubmitting(true);
    try {
      await controller.onConnect(token, remember);
      setPat("");
      setRemember(false);
    } catch (reason) {
      setLocalError(errorMessage(reason));
    } finally {
      setSubmitting(false);
      requestAnimationFrame(() => savedSyncRef.current?.focus());
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setLocalError(null);
    try {
      await controller.onDisconnect();
    } catch (reason) {
      setLocalError(errorMessage(reason));
    }
  };

  const runPublicationAction = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setLocalError(null);
    setSubmitting(true);
    try { await action(); }
    catch (reason) { setLocalError(errorMessage(reason)); }
    finally { setSubmitting(false); }
  };

  const visibleError = localError ?? controller.error;
  const showProgress = stage !== "idle" && !controller.publication;
  const dismissError = () => {
    setLocalError(null);
    controller.onDismissError?.();
  };

  return (
    <section aria-label="Синхронизация с GitHub" className="diff-sync-panel" id="diff-sync-panel">
      <header className="diff-sync-panel__header">
        <div>
          <strong>GitHub</strong>
          {controller.repository ? <span>{controller.repository}</span> : null}
        </div>
        <button aria-label="Закрыть синхронизацию" className="icon-button" onClick={onClose} type="button">
          <Icon name="close" size={15} />
        </button>
      </header>

      {blockedReason && !connectWithoutSync && !recoveryConnection ? <p className="diff-sync-panel__blocked"><Icon name="warning" size={15} />{blockedReason}</p> : null}

      {controller.publication ? (
        <div
          aria-live={controller.publication.status === "waiting" ? "polite" : undefined}
          className={controller.publication.status === "waiting" ? "diff-sync-progress" : "inline-alert inline-alert--error diff-sync-panel__error"}
          role={controller.publication.status === "waiting" ? "status" : "alert"}
        >
          <Icon name={controller.publication.status === "waiting" ? "check" : "warning"} size={15} />
          <span>{controller.publication.status === "waiting"
            ? "Коммит создан. Ждём обновления GitHub Pages…"
            : controller.publication.status === "memory-only"
              ? "Браузер не сохранил состояние восстановления. Не закрывайте вкладку."
              : controller.publication.status === "recovery"
                ? "Новая публикация опередила этот коммит. Локальные правки сохранены; завершите восстановление и конфликты."
                : controller.publication.status === "corrupt" || controller.publication.status === "legacy"
                  ? "Состояние ожидающей публикации повреждено или устарело. Сначала экспортируйте локальную копию."
                  : controller.publication.status === "read-failure"
                    ? "Браузер не разрешил прочитать состояние публикации. Экспортируйте копию или перезагрузите страницу."
                    : controller.publication.check === "non-current"
                      ? "GitHub Pages показывает не текущую версию main. Локальные данные сохранены."
                      : controller.publication.check === "unrelated"
                        ? "На сайте опубликован другой коммит. Требуется восстановление локальных данных."
                        : controller.publication.check === "revision-mismatch"
                          ? "Опубликованная версия не совпала с ожидаемой. Локальные данные сохранены."
                          : controller.publication.check === "finalize-failed"
                            ? "Сайт обновился, но браузер не завершил локальное восстановление."
                            : "Пока не удалось проверить публикацию. Локальные данные сохранены."}</span>
          {controller.publication.targetCommitUrl ? <a href={controller.publication.targetCommitUrl} rel="noreferrer" target="_blank">Коммит<Icon name="external" size={12} /></a> : null}
          <span>
            {controller.publication.status === "memory-only" ? <button disabled={busy} onClick={() => void runPublicationAction(controller.publication!.onRetryPersistence)} type="button">Повторить сохранение</button> : null}
            {controller.publication.status === "waiting" || controller.publication.status === "recovery" || controller.publication.status === "problem" ? <button disabled={busy} onClick={() => void runPublicationAction(controller.publication!.onRetryCheck)} type="button">Повторить проверку</button> : null}
            <button disabled={busy} onClick={() => void runPublicationAction(controller.publication!.onExport)} type="button">Экспортировать локальную копию</button>
            {(controller.publication.status === "problem" || controller.publication.status === "read-failure") ? <button disabled={busy} onClick={controller.publication.onReload} type="button">Перезагрузить страницу</button> : null}
            {controller.publication.exportCompleted && (controller.publication.status === "recovery" || controller.publication.status === "corrupt" || controller.publication.status === "legacy") ? <button disabled={busy} onClick={() => void runPublicationAction(controller.publication!.onDiscard)} type="button">Сбросить после экспорта</button> : null}
          </span>
        </div>
      ) : null}

      {showProgress || controller.pagesPending && !controller.publication ? (
        <div aria-live="polite" className={`diff-sync-progress${stage === "complete" ? " is-complete" : ""}`} role="status">
          <span className="diff-sync-progress__marker">{stage === "complete" ? <Icon name="check" size={15} /> : null}</span>
          <span>{controller.pagesPending ? "Коммит создан. Ждём обновления GitHub Pages…" : stage === "idle" ? "Синхронизация…" : stageLabels[stage]}</span>
          {controller.commitUrl ? <a href={controller.commitUrl} rel="noreferrer" target="_blank">Коммит<Icon name="external" size={12} /></a> : null}
        </div>
      ) : null}

      {visibleError ? (
        <div className="inline-alert inline-alert--error diff-sync-panel__error" role="alert">
          <Icon name="warning" size={15} />
          <span>{visibleError}</span>
          <button onClick={dismissError} type="button">Скрыть</button>
        </div>
      ) : null}

      {showPatForm ? (
        <form className="diff-sync-auth" onSubmit={submit}>
          <label htmlFor="diff-sync-pat">Fine-grained PAT</label>
          <div className="diff-sync-auth__input">
            <input
              autoComplete="off"
              disabled={busy}
              id="diff-sync-pat"
              name="github-fine-grained-pat"
              onChange={(event) => setPat(event.currentTarget.value)}
              placeholder="github_pat_…"
              ref={inputRef}
              spellCheck={false}
              type="password"
              value={pat}
            />
            <button className="button button--primary" disabled={(Boolean(blockedReason) && !connectWithoutSync && !recoveryConnection) || busy || !pat.trim()} type="submit">
              {busy ? "Подключаем…" : connectWithoutSync ? "Подключить" : recoveryConnection ? "Подключить и проверить" : "Подключить и синхронизировать"}
            </button>
          </div>
          <label className="diff-sync-auth__remember">
            <input checked={remember} disabled={busy} onChange={(event) => setRemember(event.currentTarget.checked)} type="checkbox" />
            <span>Запомнить PAT на этом устройстве</span>
          </label>
          <p className="diff-sync-auth__hint">{connectWithoutSync
            ? "Для проверки доступа создадим отдельную временную ветку со служебным коммитом и сразу удалим её. Ветка main не изменится."
            : "Кнопка сразу создаст коммит в main. Выберите только репозиторий mygameslist и право Contents: write."}</p>
          {controller.patCreationHref ? <a className="diff-sync-auth__create" href={controller.patCreationHref} rel="noreferrer" target="_blank">Создать fine-grained PAT<Icon name="external" size={11} /></a> : null}
        </form>
      ) : (
        <div className="diff-sync-saved">
          <div><Icon name="check" size={15} /><span>{controller.persistence === "persistent" ? "PAT сохранён на этом устройстве" : "PAT хранится до закрытия вкладки"}</span></div>
          <button className="button button--primary" disabled={publicationBlocked || Boolean(blockedReason) || busy} onClick={() => void runSync()} ref={savedSyncRef} type="button">{actionLabel}</button>
          <button className="button button--ghost button--danger-text" disabled={busy} onClick={() => void disconnect()} type="button">Отключить</button>
        </div>
      )}
    </section>
  );
}
