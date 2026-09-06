import {
  PUBLICATION_GRACE_MS,
  RUN_GRACE_MS,
  deriveDeploymentStatus,
  emptyDeploymentObservation,
  type DeploymentLocalVersion,
  type DeploymentObservation,
} from "../src/state/deploymentStatusModel";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(64);

const local: DeploymentLocalVersion = {
  development: false,
  ready: true,
  documentCommitSha: A,
  dataCommitSha: A,
};

function observation(overrides: Partial<DeploymentObservation> = {}): DeploymentObservation {
  return {
    ...emptyDeploymentObservation(),
    headCommitSha: B,
    lastCheckedAt: 100,
    ...overrides,
  };
}

describe("deployment status model", () => {
  it("returns a complete empty observation", () => {
    expect(emptyDeploymentObservation()).toEqual({
      headCommitSha: null,
      workflow: null,
      publishedCommitSha: null,
      docsOnly: null,
      missingRunSince: null,
      publicationWaitingSince: null,
      lastCheckedAt: null,
      error: null,
    });
  });

  it("reports the initial read before local data is ready", () => {
    const result = deriveDeploymentStatus(
      { ...local, ready: false },
      emptyDeploymentObservation(),
      0,
    );

    expect(result).toMatchObject({
      state: "checking",
      color: "gray",
      title: "Проверяем версию сайта",
      lastCheckedAt: null,
    });
  });

  it("reports local development before attempting remote classification", () => {
    const result = deriveDeploymentStatus(
      { ...local, development: true, ready: false, documentCommitSha: null, dataCommitSha: null },
      observation({ error: "Нет подключения к сети" }),
      100,
    );

    expect(result).toMatchObject({
      state: "development",
      color: "gray",
      title: "Локальная разработка",
    });
  });

  it.each([
    { field: "documentCommitSha", value: null },
    { field: "dataCommitSha", value: null },
    { field: "documentCommitSha", value: "A".repeat(40) },
    { field: "dataCommitSha", value: "a".repeat(39) },
  ] as const)("does not infer production status from invalid $field", ({ field, value }) => {
    const result = deriveDeploymentStatus(
      { ...local, [field]: value },
      observation({ workflow: { kind: "success" }, publishedCommitSha: B }),
      100,
    );

    expect(result).toMatchObject({
      state: "unknown-version",
      color: "gray",
      title: "Версия открытой страницы неизвестна",
    });
  });

  it("reports an observation error before an otherwise current version", () => {
    const result = deriveDeploymentStatus(
      local,
      observation({ headCommitSha: A, error: "Нет подключения к сети" }),
      100,
    );

    expect(result).toMatchObject({
      state: "error",
      color: "gray",
      title: "Не удалось проверить версию",
      description: "Нет подключения к сети",
      lastCheckedAt: 100,
    });
  });

  it("is green only when document, installed data, and main all match", () => {
    const current = deriveDeploymentStatus(
      local,
      observation({ headCommitSha: A }),
      100,
    );

    expect(current).toMatchObject({
      state: "current",
      color: "green",
      title: "Открыта последняя версия",
      documentCommitSha: A,
      dataCommitSha: A,
      headCommitSha: A,
    });
  });

  it("keeps old HTML with current data red after publication is confirmed", () => {
    const result = deriveDeploymentStatus(
      { ...local, documentCommitSha: A, dataCommitSha: B },
      observation({ workflow: { kind: "success" }, publishedCommitSha: B }),
      100,
    );

    expect(result).toMatchObject({ state: "update-available", color: "red" });
  });

  it("keeps current HTML with old data red after publication is confirmed", () => {
    const result = deriveDeploymentStatus(
      { ...local, documentCommitSha: B, dataCommitSha: A },
      observation({ workflow: { kind: "success" }, publishedCommitSha: B }),
      100,
    );

    expect(result).toMatchObject({ state: "update-available", color: "red" });
  });

  it("distinguishes a stale document from an actually current document", () => {
    const splitLocal = { ...local, documentCommitSha: A, dataCommitSha: B };
    const observed = observation({
      workflow: { kind: "success" },
      publishedCommitSha: B,
    });

    expect(deriveDeploymentStatus(splitLocal, observed, 100).state).toBe("update-available");
    expect(deriveDeploymentStatus({ ...splitLocal, documentCommitSha: B }, observed, 100).state).toBe("current");
  });

  it.each(["queued", "in_progress", "waiting", "pending"])(
    "reports a pending workflow reason (%s) as building",
    (reason) => {
      const result = deriveDeploymentStatus(
        local,
        observation({ workflow: { kind: "pending", reason } }),
        100,
      );

      expect(result).toMatchObject({
        state: "building",
        color: "yellow",
        title: "Новая версия готовится",
        description: reason,
      });
    },
  );

  it("waits for a missing workflow strictly before the 60-second deadline", () => {
    const observed = observation({ workflow: { kind: "absent" }, missingRunSince: 1_000 });

    expect(deriveDeploymentStatus(local, observed, 1_000 + 59_999)).toMatchObject({
      state: "waiting-run",
      color: "yellow",
      title: "Новая версия готовится",
    });
    expect(deriveDeploymentStatus(local, observed, 1_000 + RUN_GRACE_MS)).toMatchObject({
      state: "unconfirmed",
      color: "gray",
      title: "Не удалось подтвердить деплой последнего коммита",
    });
  });

  it("gives confirmed docs-only changes priority over the missing-run grace", () => {
    const result = deriveDeploymentStatus(
      local,
      observation({ workflow: { kind: "absent" }, docsOnly: true, missingRunSince: 100 }),
      200,
    );

    expect(result).toMatchObject({
      state: "docs-only",
      color: "gray",
      title: "Последний коммит меняет только документацию. Деплой не требуется",
    });
  });

  it("does not turn a failed docs-only comparison into a docs-only claim", () => {
    const result = deriveDeploymentStatus(
      local,
      observation({ workflow: { kind: "absent" }, docsOnly: null, missingRunSince: 0 }),
      RUN_GRACE_MS,
    );

    expect(result.state).toBe("unconfirmed");
  });

  it("reports successful deployment as propagating strictly before ten minutes", () => {
    const observed = observation({
      workflow: { kind: "success" },
      publishedCommitSha: A,
      publicationWaitingSince: 2_000,
    });

    expect(deriveDeploymentStatus(local, observed, 2_000 + 599_999)).toMatchObject({
      state: "propagating",
      color: "yellow",
      title: "Новая версия публикуется",
    });
    expect(deriveDeploymentStatus(local, observed, 2_000 + PUBLICATION_GRACE_MS)).toMatchObject({
      state: "unconfirmed",
      color: "gray",
      title: "Публикация сайта не подтверждена",
    });
  });

  it("requires Pages to confirm the same head SHA before reporting an update", () => {
    const wrongTarget = deriveDeploymentStatus(
      local,
      observation({ workflow: { kind: "success" }, publishedCommitSha: C, publicationWaitingSince: 0 }),
      1,
    );
    const confirmed = deriveDeploymentStatus(
      local,
      observation({ workflow: { kind: "success" }, publishedCommitSha: B, publicationWaitingSince: 0 }),
      1,
    );

    expect(wrongTarget.state).toBe("propagating");
    expect(confirmed).toMatchObject({
      state: "update-available",
      color: "red",
      title: "Доступна новая версия. Обновите страницу",
    });
  });

  it.each([
    "Деплой завершился ошибкой",
    "Деплой отменён",
    "Деплой пропущен",
    "Деплой требует действия",
  ])("reports an unsuccessful workflow with its concrete reason: %s", (reason) => {
    const result = deriveDeploymentStatus(
      local,
      observation({ workflow: { kind: "failed", reason } }),
      100,
    );

    expect(result).toMatchObject({
      state: "not-published",
      color: "gray",
      title: "Новая версия не опубликована",
      description: reason,
    });
  });

  it("does not interpret an unknown workflow response as progress or success", () => {
    const result = deriveDeploymentStatus(
      local,
      observation({ workflow: { kind: "invalid" }, publishedCommitSha: B }),
      100,
    );

    expect(result).toMatchObject({
      state: "unconfirmed",
      color: "gray",
      title: "Не удалось подтвердить деплой последнего коммита",
    });
  });

  it.each([
    "Нет подключения к сети",
    "GitHub API недоступен",
    "Токен отклонён",
    "Лимит запросов исчерпан",
    "Не удалось прочитать version.json",
  ])("reports an observation error without discarding the last successful time: %s", (error) => {
    const result = deriveDeploymentStatus(local, observation({ error }), 100);

    expect(result).toMatchObject({
      state: "error",
      color: "gray",
      title: "Не удалось проверить версию",
      description: error,
      lastCheckedAt: 100,
    });
  });

  it("does not let lastCheckedAt change semantic state", () => {
    const observed = observation({ workflow: { kind: "pending", reason: "Деплой выполняется" } });

    expect(deriveDeploymentStatus(local, { ...observed, lastCheckedAt: 100 }, 200).state).toBe("building");
    expect(deriveDeploymentStatus(local, { ...observed, lastCheckedAt: 9_999 }, 200).state).toBe("building");
  });
});
