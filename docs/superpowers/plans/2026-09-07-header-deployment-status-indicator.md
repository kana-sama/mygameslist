# Header Deployment Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task by task. Steps use checkbox syntax for tracking. Project rules require subagents and one final feature commit; do not create task, specification, or plan commits.

**Goal:** Добавить на всех маршрутах цветной индикатор актуальности открытой страницы непосредственно слева от «Случайная игра».

**Architecture:** Чистая модель вычисляет цвет из версии документа, установленной базы и наблюдения GitHub/Pages. Отдельный клиент выполняет условные GET, контроллер управляет расписанием, а React-компонент отображает состояние и подсказку. Сборщик добавляет SHA в HTML и корневой `version.json` после подготовки полной или кешированной оболочки.

**Tech Stack:** TypeScript, React 19, Vite, Fetch API, AbortController, Vitest, Testing Library, существующий Node.js build pipeline. Новые зависимости не нужны.

**Spec:** [Индикатор версии и деплоя в хедере](../specs/2026-09-06-header-deployment-status-indicator-design.md).

## Global Constraints

- Уточнение пользователя от 2026-09-07: «нет, игнорируй узкие экраны». Сохранить текущий однострочный хедер; адаптация узких экранов и известное обрезание coarse pointer на 360/736 CSS px исключены из области фичи и не блокируют приёмку.

- Порядок: `Индикатор версии → Случайная игра → Локальные правки → Добавить игру → Настройки`.
- Ровно одна точка `8px`, область `30 × 30px`, для coarse pointer — `44 × 44px`; промежуток действий `5px`.
- Использовать `--success`, `--warning`, `--danger`, `--muted-2`; без постоянных рамки, фона, подписи, счётчика и анимации.
- Подсказка под индикатором, максимум `320px`, отступ от краёв окна `8px`; hover, focus, click, Enter, Space, touch, Escape и outside click.
- Зелёный только при равенстве SHA документа, фактически установленной базы и `main`.
- Красный только при успешном workflow целевого SHA и подтверждении того же SHA через Pages `version.json`.
- Интервалы: `30 секунд` с PAT, `15 секунд` в подтверждённом жёлтом состоянии с PAT, `300 секунд` без PAT; hidden/offline приостанавливают опрос.
- Сетевой timeout `15 секунд`; локальные сроки ожидания запуска `60 секунд` и публикации `10 минут` не инициируют дополнительные GET.
- ETag/304, X-Poll-Interval, Retry-After, remaining/reset, последовательные запросы, backoff до `15 минут`, отмена и защита от устаревших ответов обязательны.
- Использовать существующий личный PAT. Мониторинг не удаляет PAT, не изменяет права, не пишет в GitHub, patch, journal или authored `data/`.
- Сохранять `paths-ignore: docs/**`, workflow concurrency, формат `data/library.json` и ускоренный путь сборки.
- Не добавлять сервер, настройки, refresh-кнопку, автоматическую перезагрузку, модальное окно или межвкладочную координацию.
- Permanent tests используют независимые фикстуры. Проверки конкретного сгенерированного HTML/JSON и полной/кешированной сборки временные и удаляются до коммита.
- Только `jj` для status/diff/history/commit. Итог: `jj describe`, затем `jj new`. Существующие завершённые коммиты неизменяемы.

## Файлы и ответственность

| Файл | Действие и ответственность |
| --- | --- |
| `src/shared/deploymentVersion.ts` | Создать: общий валидатор SHA и строгий парсер маленького version JSON |
| `src/state/deploymentStatusModel.ts` | Создать: типы, временные константы, чистая классификация, русские тексты |
| `src/state/deploymentStatusClient.ts` | Создать: GitHub/Pages GET, ETag, валидация ответов, информация об ограничениях |
| `src/state/deploymentStatusMonitor.ts` | Создать: расписание, наблюдения, отмена, смена SHA/PAT, subscribe/getSnapshot |
| `src/state/useDeploymentStatus.ts` | Создать: lifecycle React, версия документа, visibility/online, подключение контроллера |
| `src/components/DeploymentStatusIndicator.tsx` | Создать: чистое отображение и одна подсказка через portal |
| `src/components/deployment-status.css` | Создать: геометрия точки, области и подсказки |
| `src/components/AppShell.tsx` | Изменить: один слот перед `RandomGameButton`, без сетевой логики |
| `src/App.tsx` | Изменить: подписка на `sourceCommitSha`, передача текущего PAT в наблюдатель |
| `scripts/deployment-version.ts` | Создать: запись/проверка метаданных внутри staging root |
| `scripts/build-site.ts` | Изменить: общий шаг метаданных перед окончательной проверкой и flush |
| `tests/deployment-version.test.ts` | Создать: только общий парсер/валидатор, без build output assertions |
| `tests/deployment-status-model.test.ts` | Создать: таблица классификации и сроков |
| `tests/deployment-status-client.test.ts` | Создать: клиент на вымышленных HTTP-ответах |
| `tests/deployment-status-monitor.test.ts` | Создать: контроллер с поддельными часами и управляемыми запросами |
| `tests/deployment-status-indicator.test.tsx` | Создать: взаимодействие и доступность |
| `tests/use-deployment-status.test.tsx` | Создать: React lifecycle и неизменность SHA документа |
| `tests/ui-acceptance.test.tsx` | Изменить: число и соседство действий хедера |
| `tests/app-selective-diff.test.tsx` | Изменить: подключение PAT/версии без вмешательства в sync |
| `scripts/verify-header-deployment-artifact.ts` | Временно создать и удалить в Task 6: проверка обеих сборок |

`LibraryContextValue` уже содержит `sourceCommitSha` через `LibrarySnapshot`;
добавлять второй источник SHA или менять `LibraryContext` не требуется.
`index.html` уже разрешает `connect-src 'self' https://api.github.com`;
ослабление CSP не требуется. Каталог `data/` сохраняет существующий контракт.

## Исполнение и зависимости

Последовательность: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6.
Каждый исполнитель получает свой раздел плана, всю спецификацию и перечисленные
в ней исходники/документы. После каждого этапа reviewer проверяет требования
этапа и качество изменений; замечания исправляет тот же исполнитель.
Промежуточные результаты остаются в рабочей копии одной фичи.

Во всех UI-брифах передавать точные reference paths:

- `src/components/AppShell.tsx` и `src/styles.css`;
- `docs/superpowers/specs/2026-09-06-header-deployment-status-indicator-design.md`;
- `docs/superpowers/specs/2026-08-29-settings-trigger-and-dialog-motion-design.md`.

Структурные инварианты: ровно один индикатор; непосредственный предыдущий
сосед контейнера случайной игры; настройки — последнее действие; одна подсказка;
все заданные состояния при 1440/1024 CSS px; узкие размеры исключены последующим уточнением пользователя. Пользователь одобрил исполнение плана командой «делай».

### Task 1: Контракт версии и чистая модель состояния

**Files:** создать `src/shared/deploymentVersion.ts`, `src/state/deploymentStatusModel.ts`,
`tests/deployment-version.test.ts`, `tests/deployment-status-model.test.ts`.

**Interfaces:** экспортировать следующие контракты; следующие задачи импортируют
их, а не создают собственные варианты тех же типов.

```ts
// src/shared/deploymentVersion.ts
export interface DeploymentVersion { sourceCommitSha: string | null }
export function isDeploymentCommitSha(value: unknown): value is string;
export function parseDeploymentVersion(value: unknown): DeploymentVersion;

// src/state/deploymentStatusModel.ts
export type DeploymentColor = "green" | "yellow" | "red" | "gray";
export type DeploymentState =
  | "checking" | "development" | "unknown-version" | "current"
  | "waiting-run" | "building" | "propagating" | "update-available"
  | "not-published" | "docs-only" | "unconfirmed" | "error";
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
export function emptyDeploymentObservation(): DeploymentObservation;
export function deriveDeploymentStatus(
  local: DeploymentLocalVersion,
  observation: DeploymentObservation,
  now: number,
): DeploymentStatusSnapshot;
```

- [x] **Step 1: Написать тесты парсера и модельных сценариев.**

Начальные независимые fixtures и два обязательных различающих примера:

```ts
const A = "a".repeat(40);
const B = "b".repeat(40);
const local = {
  development: false, ready: true, documentCommitSha: A, dataCommitSha: B,
};
const observation = {
  ...emptyDeploymentObservation(),
  headCommitSha: B,
  workflow: { kind: "success" } as const,
  publishedCommitSha: B,
  lastCheckedAt: 100,
};
expect(deriveDeploymentStatus(local, observation, 100).state)
  .toBe("update-available");
expect(deriveDeploymentStatus({ ...local, documentCommitSha: B }, observation, 100).state)
  .toBe("current");
expect(() => parseDeploymentVersion({ sourceCommitSha: A, extra: true })).toThrow();
expect(parseDeploymentVersion({ sourceCommitSha: null })).toEqual({ sourceCommitSha: null });
```

Добавить всю таблицу спецификации: initial/development/invalid metadata;
старые HTML и база по отдельности; pending workflow; success без подтверждения
Pages; failure/cancelled/skipped/unknown conclusion; docs-only; ошибки и offline.
Границы `59_999/60_000` и `599_999/600_000ms` проверять явными значениями `now`.
SHA — только lowercase 40 или 64 hex; неверные типы, длины и ключи отклоняются.

- [x] **Step 2: Запустить тесты и подтвердить отсутствие нового поведения.**

```sh
npm test -- tests/deployment-version.test.ts tests/deployment-status-model.test.ts
```

После добавления необходимых экспортов ожидаемое падение должно быть на
утверждении поведения; ошибки test setup исправить до реализации правил.

- [x] **Step 3: Реализовать валидацию и классификацию без I/O.**

```ts
export const AUTH_POLL_MS = 30_000;
export const ACTIVE_POLL_MS = 15_000;
export const ANONYMOUS_POLL_MS = 300_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const RUN_GRACE_MS = 60_000;
export const PUBLICATION_GRACE_MS = 600_000;
export const MAX_BACKOFF_MS = 900_000;

const current = local.documentCommitSha === observation.headCommitSha
  && local.dataCommitSha === observation.headCommitSha;
```

Выражение `current` применять только после проверки валидности ненулевых SHA.
Порядок ветвлений: development/not ready/unknown metadata/error → current →
workflow state → подтверждение Pages/сроки. Для отсутствующего workflow
подтверждённый docs-only имеет приоритет над ожиданием запуска. Все русские
названия/пояснения брать из таблицы спецификации; неизвестные ответы не
превращать в успех. Изменение `lastCheckedAt` не меняет смысловой state.

- [x] **Step 4: Повторить два focused-файла до PASS и передать reviewer.**

### Task 2: Клиент GitHub и Pages с условными запросами

**Files:** создать `src/state/deploymentStatusClient.ts` и
`tests/deployment-status-client.test.ts`.

**Consumes:** SHA/parser из Task 1 и `WorkflowObservation`.
**Produces:**

```ts
export interface RateHints {
  minIntervalMs: number;
  notBefore: number | null;
  remaining: number | null;
}
export interface StatusRead<T> { value: T; limits: RateHints }
export type RateHintsObserver = (limits: RateHints) => void;
export type StatusRequestFailure = "unauthorized" | "rate-limit"
  | "network" | "timeout" | "http" | "invalid-response";
export class DeploymentStatusRequestError extends Error {
  kind: StatusRequestFailure;
  limits: RateHints;
  constructor(kind: StatusRequestFailure, message: string, limits: RateHints);
}
export interface DeploymentStatusClient {
  readHead(token: string | null, signal: AbortSignal, onRateHints?: RateHintsObserver): Promise<StatusRead<string>>;
  readWorkflow(sha: string, token: string | null, signal: AbortSignal, onRateHints?: RateHintsObserver): Promise<StatusRead<WorkflowObservation>>;
  readPublishedVersion(signal: AbortSignal, onRateHints?: RateHintsObserver): Promise<StatusRead<string>>;
  readDocsOnly(base: string, head: string, token: string | null, signal: AbortSignal, onRateHints?: RateHintsObserver): Promise<StatusRead<boolean | null>>;
  clearCredentialCache(): void;
}
export function createDeploymentStatusClient(options: {
  owner: string; repo: string; pagesBaseUrl: URL;
  fetch: typeof fetch; now: () => number;
}): DeploymentStatusClient;
```

- [x] **Step 1: Написать транспортные тесты на вымышленных ответах.**

```ts
const sha = "a".repeat(40);
const fetchMock = vi.fn<typeof fetch>()
  .mockResolvedValueOnce(new Response(sha, { headers: { ETag: '"head-a"' } }))
  .mockResolvedValueOnce(new Response(null, { status: 304 }));
const client = createDeploymentStatusClient({
  owner: "fixture-owner", repo: "fixture-repo",
  pagesBaseUrl: new URL("https://example.test/library/"),
  fetch: fetchMock, now: () => 0,
});
const signal = new AbortController().signal;
expect((await client.readHead(null, signal)).value).toBe(sha);
expect((await client.readHead(null, signal)).value).toBe(sha);
const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
expect(headers.get("If-None-Match")).toBe('"head-a"');
```

Другие случаи: wrong SHA/branch/workflow, queued/in_progress/waiting/pending,
success/failure/cancelled/skipped, ручной запуск, повторная попытка и старый
success рядом с новым pending; 304 без кеша; смена токена; 401; 403/429 с
лимитом и без него; 5xx; неверный JSON; исключение fetch; timeout/abort.
Для compare: ahead + все пути docs, кодовый путь, rename из/вне docs,
пустой список, не-ahead, список из 300 файлов и неполный ответ.

- [x] **Step 2: Запустить `npm test -- tests/deployment-status-client.test.ts` и получить ожидаемые падения.**

- [x] **Step 3: Реализовать только GET и строгую обработку ответа.**

Использовать следующие адреса и представления:

```ts
const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const headPath = `${repositoryPath}/commits/main`;
const runsPath = `${repositoryPath}/actions/workflows/deploy.yml/runs?branch=main&head_sha=${sha}&per_page=30`;
const comparePath = `${repositoryPath}/compare/${base}...${head}`;
const pagesVersionUrl = new URL("version.json", pagesBaseUrl);
```

Head запрашивается как `application/vnd.github.sha`; остальные GitHub-ответы
как JSON. Pages URL строится из базового пути приложения, а не текущего hash route.
`version.json` читается с `cache: "no-store"`, без PAT и без загрузки библиотеки.

Для каждого ответа разобрать rate hints до проверки HTTP status. `remaining=0`
устанавливает `notBefore` по reset; Retry-After также преобразуется в deadline.
403 без признаков rate limit остаётся ошибкой доступа, не бесконечным
«лимит исчерпан». Не показывать пользователю сырое тело ответа или токен.
При 304 возвращать ранее проверенное значение вместе со свежими headers.
ETag namespace разделён по URL, Accept и конкретной credential generation.

Каждый фактический fetch имеет собственный timeout 15000ms и AbortController,
связанный с переданным signal; timer/listener очищаются в `finally`. Внешний
abort не преобразовывать в пользовательскую сетевую ошибку. Это timeout одного
HTTP-запроса, а не общий timeout всего обхода страниц workflow.

Запуски валидируются против целевого SHA/ветки/workflow. Учитывать последнее
начатое выполнение, включая `run_attempt`, а не отфильтровывать только success.
При нескольких страницах списка не считать старый rerun отсутствующим только
потому, что он не попал в первую страницу; следовать доверенному GitHub Link
последовательно, применяя ограничения к дополнительным запросам. Внутри этого
метода клиент сам накапливает rate hints каждой страницы и проверяет `notBefore`
перед следующей: контроллер ещё не получил итоговый результат метода.
Если возникает запрет, завершить метод типизированной rate-limit ошибкой с
накопленными hints; не ждать внутри метода и не продолжать pagination. На успехе
вернуть максимальный minInterval/notBefore и последнее известное remaining
вместе с результатом. Новый page URL не является повторным опросом уже
прочитанной страницы; X-Poll-Interval ограничивает следующий цикл наблюдения,
а исчерпание общего бюджета блокирует и новые страницы.
Неизвестное
состояние возвращает `invalid`, а не pending по умолчанию.

Compare возвращает `true` только при доказанном docs-only: `status=ahead`,
непустой список меньше 300 файлов, допустимые filename/previous_filename,
все изменённые пути внутри `docs/`. `false` — достоверные изменения сайта;
`null` — недостаточно сведений. Это сравнение служит классификации содержимого
между публикацией и `main`, не утверждению, какой push запускал workflow.

- [x] **Step 4: Получить PASS focused client tests и передать reviewer.**

### Task 3: Наблюдатель и расписание

**Files:** создать `src/state/deploymentStatusMonitor.ts`,
`src/state/useDeploymentStatus.ts`, `tests/deployment-status-monitor.test.ts`,
`tests/use-deployment-status.test.tsx`.

**Consumes:** модель/константы Task 1, клиент Task 2.
**Produces:**

```ts
export interface DeploymentMonitorInput {
  ready: boolean;
  dataCommitSha: string | null;
  token: string | null;
  visible: boolean;
  online: boolean;
}
export interface DeploymentStatusMonitor {
  getSnapshot(): DeploymentStatusSnapshot;
  subscribe(listener: () => void): () => void;
  update(input: DeploymentMonitorInput): void;
  dispose(): void;
}
export function createDeploymentStatusMonitor(options: {
  development: boolean;
  documentCommitSha: string | null;
  client: DeploymentStatusClient;
  now: () => number;
}): DeploymentStatusMonitor;
export function useDeploymentStatus(input: {
  ready: boolean;
  dataCommitSha: string | null;
  token: string | null;
}): DeploymentStatusSnapshot;
```

- [x] **Step 1: Написать тесты расписания с fake timers и реальным клиентом на fake fetch.**

```ts
vi.useFakeTimers();
vi.setSystemTime(0);
const sha = "a".repeat(40);
const fetchMock = vi.fn<typeof fetch>()
  .mockImplementation(async () => new Response(sha));
const client = createDeploymentStatusClient({
  owner: "fixture-owner", repo: "fixture-repo",
  pagesBaseUrl: new URL("https://example.test/"), fetch: fetchMock, now: Date.now,
});
const monitor = createDeploymentStatusMonitor({
  development: false, documentCommitSha: sha, client, now: Date.now,
});
monitor.update({ ready: true, dataCommitSha: sha, token: null, visible: true, online: true });
await vi.advanceTimersByTimeAsync(0);
expect(monitor.getSnapshot().state).toBe("current");
expect(fetchMock).toHaveBeenCalledTimes(1);
await vi.advanceTimersByTimeAsync(299_999);
expect(fetchMock).toHaveBeenCalledTimes(1);
await vi.advanceTimersByTimeAsync(1);
expect(fetchMock).toHaveBeenCalledTimes(2);
monitor.dispose();
vi.useRealTimers();
```

Дополнить 30/15-second cases; no polling в dev/unknown/not ready/hidden/offline;
return visible/online с fresh/stale observation; отсутствие overlapping requests;
401 → анонимный режим без повторного использования отклонённого PAT;
замена PAT во время запроса; смена `main` и поздний ответ старой цели;
X-Poll-Interval/Retry-After/reset после успеха и ошибки; repeated failures;
одно сравнение на пару SHA; отсутствие сети при локальных deadline transitions.

- [x] **Step 2: Запустить два focused-файла и подтвердить ожидаемые падения.**

```sh
npm test -- tests/deployment-status-monitor.test.ts tests/use-deployment-status.test.tsx
```

- [x] **Step 3: Реализовать цикл как последовательность наблюдений с guard между GET.**

```text
readHead → проверить generation и rate hints
  SHA совпадают с документом и базой → current, завершить цикл
  иначе readWorkflow → проверить generation и rate hints
    pending/failed/invalid → классифицировать
    success → readPublishedVersion → классифицировать
    absent → readPublishedVersion → cached/new readDocsOnly → классифицировать
```

Каждый physical response немедленно передаёт rate hints через optional `onRateHints`, до чтения тела ответа. Контроллер сохраняет эти ограничения независимо от отмены поколения, но не принимает устаревшие данные. Это сохраняет лимиты уже прочитанных страниц при отмене пагинации. После dispose callback ничего не меняет.

Хранить отдельно deadline следующего цикла, deadline серверного запрета,
AbortController запроса и generation. Проверять запрет перед каждым GET,
включая последующие страницы workflow. Если бюджет закончился между GET,
прервать цепочку в серое состояние и не выполнять остаток немедленно.
Не считать полный цикл успешным до получения всех необходимых данных.

Правило расписания после завершения запроса:

```ts
const delayFromStart = Math.max(nominalIntervalMs, requiredPollIntervalMs, backoffMs);
const nextAllowedAt = Math.max(cycleStartedAt + delayFromStart, serverNotBefore ?? 0);
const delay = Math.max(0, nextAllowedAt - now());
```

Не догонять пропущенные циклы пачкой. Header minima применяются также к
изменившемуся query SHA того же endpoint. Сроки missing-run/publication-wait
отсчитываются на целевой SHA и не сбрасываются от каждого одинакового ответа.
Локальный таймер срока только пересчитывает snapshot. Смена цели очищает её
старые сроки и результат docs-only. Смена данных библиотеки пересчитывает
состояние, не подменяет document SHA и сама по себе не форсирует GET.

Для Network/5xx/timeout применять экспоненциальную задержку с ограничением
900000ms, не уменьшая более поздний server deadline. 401 запоминает отклонённое
значение PAT в памяти, очищает его transport cache и планирует анонимный цикл
через 300000ms. Монитор не вызывает `clearGitHubPat`.

- [x] **Step 4: Подключить контроллер к React lifecycle и протестировать неизменность документа.**

`useDeploymentStatus` читает meta один раз для жизни текущего документа;
нулевое или несколько совпадений в production дают unknown-version. Использует
`useSyncExternalStore` со стабильным snapshot, а не новым объектом на каждый getter.
Создание/cleanup контроллера должно выдерживать React StrictMode effect replay.
Подписки `visibilitychange`, `online`, `offline` удаляются при cleanup.

Hook получает `development` из dev/runtime environment: в `import.meta.env.DEV`
и на localhost/loopback автоматических GitHub GET нет. В production meta не
обновляется при смене маршрута или DOM mutation. Hook-тест после первого
чтения заменяет meta и rerender-ит компонент: document SHA остаётся прежним.
Тесты production hook используют вымышленный origin и управляемый env,
не реальную авторизацию/сеть.

- [x] **Step 5: Получить PASS model/client/monitor/hook tests и передать reviewer.**

### Task 4: Метаданные полной и кешированной публикации

**Files:** создать `scripts/deployment-version.ts`; изменить
`scripts/build-site.ts`; временно создать
`scripts/verify-header-deployment-artifact.ts`.

**Consumes:** `DeploymentVersion`, `isDeploymentCommitSha`, `parseDeploymentVersion`.
**Produces:**

```ts
export async function stampDeploymentVersion(root: string, sha: string | null): Promise<void>;
export async function validateDeploymentVersion(root: string, sha: string | null): Promise<void>;
```

- [x] **Step 1: Создать временный verifier с синтетическим source tree и минимальным Vite app.**

Использовать `projectSourceTree`, `materializeProjectedSourceTree` и уже
существующие `fixtureDatabase`, `IMAGE_BYTES`, `FILE_BYTES`, `IMAGE_ID` из
`tests/fixtures/source-tree.ts`; не читать реальный authored database.

```ts
const projection = await projectSourceTree(fixtureDatabase());
await materializeProjectedSourceTree({
  targetSourceRoot: sourceRoot,
  projection,
  async resolveAssetBytes(leaf) {
    return leaf.assetId === IMAGE_ID ? IMAGE_BYTES.slice() : FILE_BYTES.slice();
  },
});
await writeFile(join(appRoot, "index.html"),
  '<!doctype html><html><head></head><body><script type="module" src="/main.js"></script></body></html>');
await writeFile(join(appRoot, "main.js"), 'document.body.dataset.fixture = "ready";');
await buildSite({
  sourceRoot, sourceCommitSha: "a".repeat(40),
  shell: { kind: "vite", projectRoot: appRoot, configFile: false },
  destination: { kind: "staging", artifactRoot: fullRoot },
});
await buildSite({
  sourceRoot, sourceCommitSha: "b".repeat(40),
  shell: { kind: "cached", shellRoot: fullRoot },
  destination: { kind: "staging", artifactRoot: cachedRoot },
});
```

Verifier создаёт app/source/output пути под `mkdtemp` в `/tmp`, разбирает HTML
через `JSDOM` из имеющейся dev dependency, проверяет ровно один нужный meta,
строгое содержимое `version.json`, равенство SHA трёх носителей, замену A → B
на кешированном пути и сохранность исходной кешированной оболочки A.
Проверяет также null локальной сборки, 64-character SHA, отсутствие лишних
файлов в `data/`, прежнюю валидацию media и отказ при противоречивых метаданных.
Удаляет временную директорию в `finally`.

- [x] **Step 2: Запустить verifier и получить ожидаемое отсутствие метаданных.**

```sh
node --import tsx scripts/verify-header-deployment-artifact.ts
```

- [x] **Step 3: Добавить stamping перед окончательной проверкой staging root.**

В `buildSite`, после уже существующего `buildArtifactData` и перед
окончательным flush/promote, последовательность должна стать такой:

```ts
const assembly = await buildArtifactData(sourceRoot, artifactRoot, options.sourceCommitSha);
await stampDeploymentVersion(artifactRoot, options.sourceCommitSha);
await validateArtifactRoot(artifactRoot, assembly);
await validateDeploymentVersion(artifactRoot, options.sourceCommitSha);
await flushCompleteRoot(artifactRoot);
```

Сохранить существующие проверки directory/file identity вокруг этих шагов.
Не менять низкоуровневый контракт `buildArtifactData`: он уже сам вызывает
`validateArtifactRoot` до возврата. Новая проверка метаданных принадлежит
сборке полного сайта, а не независимой сборке JSON/media.

Stamping работает только с обычным HTML-файлом в проверенном staging root.
Для ожидаемого HTML заменить имеющийся deployment meta или вставить один
перед `</head>`; некорректную структуру/дубли не принимать за валидный документ.
Для null использовать пустой content meta и `{ "sourceCommitSha": null }`.
Корневой `version.json` заменяется заново на обоих путях; не следовать symlink
при записи. Не добавлять SHA к cache key и не пересобирать Vite на fast path.

- [x] **Step 4: Проверить verifier и существующую сборочную suite.**

```sh
node --import tsx scripts/verify-header-deployment-artifact.ts
npm test -- tests/artifact-build.test.ts
```

Новые assertions конкретных build artifacts не переносить в permanent tests.
Существующие generic tests не ослаблять; если fixture HTML требует `<head>`,
исправить только fixture setup, не превращая его в проверку topology/manifest.
Передать reviewer результаты полной и кешированной сборок.

### Task 5: Индикатор, подсказка и подключение к хедеру

**Files:** создать `src/components/DeploymentStatusIndicator.tsx`,
`src/components/deployment-status.css`, `tests/deployment-status-indicator.test.tsx`;
изменить `src/components/AppShell.tsx`, `src/App.tsx`,
`tests/ui-acceptance.test.tsx`, `tests/app-selective-diff.test.tsx`.

**Consumes:** `DeploymentStatusSnapshot` и `useDeploymentStatus`.
**Produces:**

```ts
export interface DeploymentStatusIndicatorProps { snapshot: DeploymentStatusSnapshot }
export function DeploymentStatusIndicator(props: DeploymentStatusIndicatorProps): React.ReactNode;
// AppShellProps:
deploymentStatusIndicator?: React.ReactNode;
```

- [x] **Step 1: Сохранить baseline хедера на заданных viewport и написать UI tests.**

Зафиксировать существующий порядок и вид при 1440/1024/736/360px с обычным
и coarse pointer. Не считать размеры картинки размером browser viewport.

В `tests/ui-acceptance.test.tsx` расширить текущий AppShell case:

```tsx
const actions = document.querySelector(".app-header__actions")!;
const indicator = screen.getByRole("button", { name: /^Версия сайта:/ });
const random = screen.getByRole("button", { name: "Случайная игра" });
const picker = random.closest(".random-game-picker")!;
expect(actions.querySelectorAll(".deployment-status")).toHaveLength(1);
expect(picker.previousElementSibling).toBe(indicator.closest(".deployment-status"));
expect(actions.lastElementChild).toBe(screen.getByRole("button", { name: "Настройки" }));
```

В component tests проверить: hover/focus открывают; pointer может перейти в
подсказку; click/Enter/Space закрепляют; второй click/outside/Escape закрывают;
Escape не вызывает мгновенное повторное открытие; touch работает; состояние
и SHA читаемы; одинаковые повторы не вызывают live announcement; одна подсказка.
Открытие/закрытие не вызывает fetch/reload/sync. Незнакомое значение не рисует
зелёный. Проверить смену цветов при открытой подсказке.

- [x] **Step 2: Запустить focused UI tests и подтвердить ожидаемые падения.**

```sh
npm test -- tests/deployment-status-indicator.test.tsx tests/ui-acceptance.test.tsx
```

- [x] **Step 3: Реализовать представление и геометрию без сетевых действий.**

```css
.deployment-status { flex: 0 0 auto; }
.deployment-status__trigger {
  display: grid; place-items: center; width: 30px; height: 30px;
  padding: 0; border: 0; background: transparent;
}
.deployment-status__dot { width: 8px; height: 8px; border-radius: 50%; }
.deployment-status[data-color="green"] .deployment-status__dot { background: var(--success); }
.deployment-status[data-color="yellow"] .deployment-status__dot { background: var(--warning); }
.deployment-status[data-color="red"] .deployment-status__dot { background: var(--danger); }
.deployment-status[data-color="gray"] .deployment-status__dot { background: var(--muted-2); }
@media (pointer: coarse) {
  .deployment-status__trigger { width: 44px; height: 44px; }
}
```

Сохранить общий `:focus-visible` outline. Подсказка выводится portal-ом в body,
позиционируется по trigger rect, ширина `min(320px, viewport - 16px)`, нижнее
размещение и clamp по краям окна. Пересчитывать при resize/scroll, не менять
размеры хедера. Кнопка использует `aria-describedby` для открытой подсказки;
визуальная точка `aria-hidden`. Escape/outside suppress state отделить от
hover/focus, чтобы закрытие работало без потери клавиатурного фокуса.

- [x] **Step 4: Подключить готовое состояние в AppShell и App.**

Добавить slot непосредственно перед `RandomGameButton`. В прямом рендере
AppShell без провайдера использовать пассивный fallback «Проверяем версию
сайта»; он не создаёт монитор и не выполняет fetch.

В `App.tsx` создать `SubscribedDeploymentStatusIndicator`, который через
`useLibrarySelector` читает только `loading` и `sourceCommitSha`, вызывает hook
и передаёт результат компоненту. Сравнение селектора — по этим двум полям,
чтобы правка текста заметки не перезапускала мониторинг.

Текущий PAT хранится в `githubPatRef`; добавить реактивное значение для
наблюдателя и синхронно обновлять его во всех существующих местах присваивания:
initial load, connect, disconnect, отклонение PAT существующей синхронизацией.
Не менять последовательность верификации, сохранения и публикации PAT.
Не читать/публиковать токен через snapshot UI и не сохранять его дополнительно.

```tsx
<AppShell
  deploymentStatusIndicator={<SubscribedDeploymentStatusIndicator token={statusPat} />}
  // остальные существующие props сохраняются
>
```

Добавить App integration checks: первый stored PAT передаётся наблюдателю;
disconnect/замена доходят до него; собственный 401 мониторинга не вызывает
disconnect sync; смена маршрута сохраняет controller; изменение базы обновляет
data SHA, но не document SHA. Использовать имеющийся synthetic libraryHarness.

- [x] **Step 5: Выполнить focused UI/App/hook checks и передать reviewer.**

```sh
npm test -- tests/deployment-status-indicator.test.tsx tests/use-deployment-status.test.tsx tests/ui-acceptance.test.tsx tests/app-selective-diff.test.tsx
```

### Task 6: Итоговая проверка, cleanup и один коммит

**Files:** все файлы фичи; удалить
`scripts/verify-header-deployment-artifact.ts` после успешной проверки.

- [x] **Step 1: Проверить цепочку целиком в локальном браузере на управляемых данных.**

Использовать browser skill. Для production-состояний создать временный browser
harness, который рендерит настоящий AppShell/индикатор и создаёт настоящий
контроллер с `development: false`, вымышленными SHA и fake fetch. Harness
передаёт состояние контроллера в компонент; тестовый переключатель не добавлять
в production UI или production hook. Так production-состояния можно проверить
на localhost, сохранив запрет сети для localhost в настоящем приложении.
Dev-сервер самого приложения должен показывать серое development и не
обращаться к GitHub; это отдельный проверяемый сценарий. Реальный PAT не нужен.

Проверить переход A/A/A → новый main B, pending → success при Pages A →
Pages B → reload с B/B/B. Также проверить новый C до завершения B, workflow
failure/cancelled/rerun, docs-only, API timeout/rate-limit, hidden/online.
Просмотр не публикует сайт и не создаёт реальные коммиты через API.

- [x] **Step 2: Исполнитель и reviewer непосредственно сверяют UI с reference paths.**

Обязательное сравнение при 1440/1024 CSS px, обычном/coarse pointer: idle, hover,
focus, pinned/unpinned tooltip, Escape, каждый цвет/ошибка. Структурно
проверить число индикаторов, прямое соседство с random picker, один tooltip,
последние настройки; визуально — точку/цвет/геометрию, отсутствие рамки/фона,
перекрытий, обрезания и сдвига соседей. Не заменять эту проверку скриншотом
одного зелёного состояния или количеством кнопок. Выполненные сравнения
736/360 CSS px сохранены как наблюдения; после уточнения пользователя
узкие экраны и известное обрезание действий не входят в приёмку этой фичи.

- [x] **Step 3: Выполнить сборочный verifier, затем удалить его.**

```sh
node --import tsx scripts/verify-header-deployment-artifact.ts
rm scripts/verify-header-deployment-artifact.ts
```

Также удалить только созданные этой задачей временные browser/fixture/harness
файлы из рабочей копии. Сохранить permanent tests общих контрактов и поведения.

- [x] **Step 4: Пройти полную suite и production build.**

```sh
npm test
npm run build
```

Сборка включает `tsc -b`. После успешных проверок повторять их только при
новых изменениях или новых обоснованных рисках. Ошибки в неизменённой базе
отделять от регрессий по доказательствам, не ослаблять проверки ради PASS.

- [x] **Step 5: Выполнить финальное review всей фичи и исправить замечания через исполнителя.**

Reviewer получает полный spec/plan, diff одной фичи, результаты проверок и
визуальные материалы. Особое внимание: старый HTML + новая база, cache path,
rate hints между запросами и страницами, pending deadlines без лишней сети,
все пути обновления PAT, отсутствие token leakage и изменений journal.
Повторное review проверяет исправления и их непосредственные последствия.

- [x] **Step 6: Проверить область изменений и финализировать один коммит.**

```sh
jj status
jj diff
jj describe -m "Add deployment status indicator to the header"
jj new
jj status
```

Перед `describe` в рабочей фиче должны быть только её спецификация, план,
реализация и необходимые permanent tests. Посторонние параллельные изменения
сохранить вне финализируемой фичи средствами `jj`, не переписывая завершённые
коммиты. Не создавать отдельный документационный коммит и не выполнять push
или deploy в рамках этого плана.

## Покрытие спецификации

| Раздел спецификации | Задачи и доказательство |
| --- | --- |
| Размещение и внешний вид | Task 5 DOM/CSS, Task 6 прямое сравнение обязательных размеров/состояний; узкие экраны вне области |
| Пояснение и взаимодействие | Task 5 component tests, Task 6 mouse/keyboard/touch |
| Версия открытой страницы | Task 1 модель/схема, Task 3 immutable document SHA, Task 4 metadata, Task 5 selector |
| Состояния | Task 1 таблица, Task 2 разбор workflow, Task 3 сроки, Task 6 сквозные переходы |
| Источники и согласованность | Task 2 SHA filters/ETag/compare, Task 3 поколения и последовательный цикл |
| Опрос и PAT | Task 2 headers/errors, Task 3 fake-clock cases, Task 5 существующие auth transitions |
| Staging и cached shell | Task 4 временный verifier, Task 6 повторная проверка и удаление verifier |
| Границы и данные | Task 5 не меняет journal; Task 6 проверяет diff, permanent fixture tests и один коммит |

План подготовлен 2026-09-07. Шаги исполнения остаются неотмеченными до их
фактического выполнения и проверки.

## Execution checkpoint

Реализация и заключительное ревью кода завершены без открытых замечаний. Полная suite: 2105 passed, 22 skipped; 98 файлов. Production build успешен. Временный сборочный verifier удалён.

Пользователь уточнил область: «нет, игнорируй узкие экраны» в ответ на предложение двухстрочного хедера. Текущий однострочный UI сохранён без дополнительных изменений кода, CSS и тестов. Известное обрезание при coarse pointer на 360px (край настроек 385px вместо 354px в baseline) и 736px (739.06px вместо 726px) не исправлено; оно исключено из области фичи и не блокирует её приёмку. Остальные размеры и состояния непосредственно проверены исполнителем и reviewer; заключительное review кода — PASS.

Временные `harness.html`, `harness.tsx` и `BaselineAppShell.tsx` удалены из игнорируемого каталога SDD. Отчёты, скриншоты и исходные baseline-материалы сохранены. Неизменённые тесты и сборка повторно не запускались. Область проверена через `jj status`/`jj diff`. Финализация этой фичи выполняется одним коммитом через `jj describe`, затем `jj new` создаёт чистую рабочую копию.
