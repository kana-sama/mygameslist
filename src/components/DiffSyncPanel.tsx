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

export interface DiffSyncController {
  connected: boolean;
  persistence: DiffSyncPersistence;
  busy: boolean;
  stage: DiffSyncStage;
  error: string | null;
  commitUrl?: string;
  pagesPending: boolean;
  repository?: string;
  patCreationHref?: string;
  onConnect: (token: string, remember: boolean) => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onSync: () => void | Promise<void>;
  onDismissError?: () => void;
}

interface DiffSyncButtonProps {
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

export const DiffSyncButton = forwardRef<HTMLButtonElement, DiffSyncButtonProps>(function DiffSyncButton({ busy, expanded, onClick }, ref) {
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
      {busy ? "Синхронизация…" : "Синхронизировать"}
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

  const visibleError = localError ?? controller.error;
  const showProgress = stage !== "idle";
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

      {blockedReason ? <p className="diff-sync-panel__blocked"><Icon name="warning" size={15} />{blockedReason}</p> : null}

      {showProgress || controller.pagesPending ? (
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
            <button className="button button--primary" disabled={Boolean(blockedReason) || busy || !pat.trim()} type="submit">
              {busy ? "Подключаем…" : "Подключить и синхронизировать"}
            </button>
          </div>
          <label className="diff-sync-auth__remember">
            <input checked={remember} disabled={busy} onChange={(event) => setRemember(event.currentTarget.checked)} type="checkbox" />
            <span>Запомнить PAT на этом устройстве</span>
          </label>
          <p className="diff-sync-auth__hint">Кнопка сразу создаст коммит в main. Выберите только репозиторий mygameslist и право Contents: write.</p>
          {controller.patCreationHref ? <a className="diff-sync-auth__create" href={controller.patCreationHref} rel="noreferrer" target="_blank">Создать fine-grained PAT<Icon name="external" size={11} /></a> : null}
        </form>
      ) : (
        <div className="diff-sync-saved">
          <div><Icon name="check" size={15} /><span>{controller.persistence === "persistent" ? "PAT сохранён на этом устройстве" : "PAT хранится до закрытия вкладки"}</span></div>
          <button className="button button--primary" disabled={Boolean(blockedReason) || busy} onClick={() => void runSync()} ref={savedSyncRef} type="button">Синхронизировать</button>
          <button className="button button--ghost button--danger-text" disabled={busy} onClick={() => void disconnect()} type="button">Отключить</button>
        </div>
      )}
    </section>
  );
}
