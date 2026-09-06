import { isDeploymentCommitSha } from "../shared/deploymentVersion";

export const AUTH_POLL_MS = 30_000;
export const ACTIVE_POLL_MS = 15_000;
export const ANONYMOUS_POLL_MS = 300_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const RUN_GRACE_MS = 60_000;
export const PUBLICATION_GRACE_MS = 600_000;
export const MAX_BACKOFF_MS = 900_000;

export type DeploymentColor = "green" | "yellow" | "red" | "gray";

export type DeploymentState =
  | "checking"
  | "development"
  | "unknown-version"
  | "current"
  | "waiting-run"
  | "building"
  | "propagating"
  | "update-available"
  | "not-published"
  | "docs-only"
  | "unconfirmed"
  | "error";

export type WorkflowObservation =
  | { kind: "absent" }
  | { kind: "pending"; reason: string }
  | { kind: "success" }
  | { kind: "failed"; reason: string }
  | { kind: "invalid" };

export interface DeploymentObservation {
  headCommitSha: string | null;
  workflow: WorkflowObservation | null;
  publishedCommitSha: string | null;
  docsOnly: boolean | null;
  missingRunSince: number | null;
  publicationWaitingSince: number | null;
  lastCheckedAt: number | null;
  error: string | null;
}

export interface DeploymentLocalVersion {
  development: boolean;
  ready: boolean;
  documentCommitSha: string | null;
  dataCommitSha: string | null;
}

export interface DeploymentStatusSnapshot {
  state: DeploymentState;
  color: DeploymentColor;
  title: string;
  description: string;
  documentCommitSha: string | null;
  dataCommitSha: string | null;
  headCommitSha: string | null;
  lastCheckedAt: number | null;
}

interface StatusText {
  state: DeploymentState;
  color: DeploymentColor;
  title: string;
  description: string;
}

export function emptyDeploymentObservation(): DeploymentObservation {
  return {
    headCommitSha: null,
    workflow: null,
    publishedCommitSha: null,
    docsOnly: null,
    missingRunSince: null,
    publicationWaitingSince: null,
    lastCheckedAt: null,
    error: null,
  };
}

export function deriveDeploymentStatus(
  local: DeploymentLocalVersion,
  observation: DeploymentObservation,
  now: number,
): DeploymentStatusSnapshot {
  const snapshot = (status: StatusText): DeploymentStatusSnapshot => ({
    ...status,
    documentCommitSha: local.documentCommitSha,
    dataCommitSha: local.dataCommitSha,
    headCommitSha: observation.headCommitSha,
    lastCheckedAt: observation.lastCheckedAt,
  });

  if (local.development) {
    return snapshot({
      state: "development",
      color: "gray",
      title: "Локальная разработка",
      description: "Автоматическая проверка публикации отключена для локальной сборки.",
    });
  }

  if (!local.ready) {
    return snapshot({
      state: "checking",
      color: "gray",
      title: "Проверяем версию сайта",
      description: "Загружаем сведения о версии открытой страницы.",
    });
  }

  if (!isDeploymentCommitSha(local.documentCommitSha) || !isDeploymentCommitSha(local.dataCommitSha)) {
    return snapshot({
      state: "unknown-version",
      color: "gray",
      title: "Версия открытой страницы неизвестна",
      description: "Не удалось подтвердить версию документа или загруженной базы.",
    });
  }

  if (observation.error !== null) {
    return snapshot({
      state: "error",
      color: "gray",
      title: "Не удалось проверить версию",
      description: observation.error,
    });
  }

  if (
    isDeploymentCommitSha(observation.headCommitSha)
    && local.documentCommitSha === observation.headCommitSha
    && local.dataCommitSha === observation.headCommitSha
  ) {
    return snapshot({
      state: "current",
      color: "green",
      title: "Открыта последняя версия",
      description: "Код страницы и загруженная база соответствуют последнему коммиту main.",
    });
  }

  if (observation.headCommitSha === null && observation.workflow === null) {
    return snapshot({
      state: "checking",
      color: "gray",
      title: "Проверяем версию сайта",
      description: "Получаем сведения о последнем коммите main.",
    });
  }

  if (!isDeploymentCommitSha(observation.headCommitSha)) {
    return unconfirmed(snapshot);
  }

  switch (observation.workflow?.kind) {
    case "pending":
      return snapshot({
        state: "building",
        color: "yellow",
        title: "Новая версия готовится",
        description: observation.workflow.reason,
      });

    case "failed":
      return snapshot({
        state: "not-published",
        color: "gray",
        title: "Новая версия не опубликована",
        description: observation.workflow.reason,
      });

    case "invalid":
      return unconfirmed(snapshot);

    case "absent": {
      if (observation.docsOnly === true) {
        return snapshot({
          state: "docs-only",
          color: "gray",
          title: "Последний коммит меняет только документацию. Деплой не требуется",
          description: "Все подтверждённые изменения находятся в каталоге docs/.",
        });
      }

      if (beforeDeadline(observation.missingRunSince, now, RUN_GRACE_MS)) {
        return snapshot({
          state: "waiting-run",
          color: "yellow",
          title: "Новая версия готовится",
          description: "Ожидаем запуска деплоя.",
        });
      }

      return unconfirmed(snapshot);
    }

    case "success": {
      if (
        isDeploymentCommitSha(observation.publishedCommitSha)
        && observation.publishedCommitSha === observation.headCommitSha
      ) {
        return snapshot({
          state: "update-available",
          color: "red",
          title: "Доступна новая версия. Обновите страницу",
          description: "Сайт уже опубликовал последний коммит main. Обновите страницу в браузере.",
        });
      }

      if (beforeDeadline(observation.publicationWaitingSince, now, PUBLICATION_GRACE_MS)) {
        return snapshot({
          state: "propagating",
          color: "yellow",
          title: "Новая версия публикуется",
          description: "Деплой завершён, но сайт ещё отдаёт предыдущую версию.",
        });
      }

      return snapshot({
        state: "unconfirmed",
        color: "gray",
        title: "Публикация сайта не подтверждена",
        description: "Успешный деплой не появился на сайте за отведённое время.",
      });
    }

    case undefined:
      return snapshot({
        state: "checking",
        color: "gray",
        title: "Проверяем версию сайта",
        description: "Получаем сведения о деплое последнего коммита.",
      });
  }
}

function beforeDeadline(since: number | null, now: number, duration: number): boolean {
  return since !== null
    && Number.isFinite(since)
    && Number.isFinite(now)
    && since <= now
    && now - since < duration;
}

function unconfirmed(
  snapshot: (status: StatusText) => DeploymentStatusSnapshot,
): DeploymentStatusSnapshot {
  return {
    ...snapshot({
      state: "unconfirmed",
      color: "gray",
      title: "Не удалось подтвердить деплой последнего коммита",
      description: "Ответы источников не позволяют подтвердить состояние публикации.",
    }),
  };
}
