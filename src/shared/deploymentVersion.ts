export interface DeploymentVersion {
  sourceCommitSha: string | null;
}

const DEPLOYMENT_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isDeploymentCommitSha(value: unknown): value is string {
  return typeof value === "string" && DEPLOYMENT_COMMIT_SHA.test(value);
}

export function parseDeploymentVersion(value: unknown): DeploymentVersion {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Некорректные метаданные версии деплоя");
  }

  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "sourceCommitSha") {
    throw new Error("Некорректные метаданные версии деплоя");
  }

  const sourceCommitSha = (value as Record<string, unknown>).sourceCommitSha;
  if (sourceCommitSha !== null && !isDeploymentCommitSha(sourceCommitSha)) {
    throw new Error("Некорректный SHA версии деплоя");
  }

  return { sourceCommitSha };
}
