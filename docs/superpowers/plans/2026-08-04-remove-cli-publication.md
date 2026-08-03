# Remove CLI Publication Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make GitHub synchronization in the website the only publication path, remove the clipboard/local-repository publisher, and retain independent recovery plus shared validator and commit-message coverage.

**Architecture:** `App` and `DiffDialog` will stop creating, copying, and displaying a CLI payload. The local entrypoints and their package command will be deleted. Website publication continues through `GitHubGitDatabaseSync`, domain `applyPatch`, and the shared semantic commit-message builder; export/import recovery and deploy-time data validation remain intact.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, Node.js 22.13+, Jujutsu (`jj`) for repository operations.

**Constraints:** Do not add dependencies. Do not remove website GitHub sync, PAT handling, conflicts, pending-publication recovery, export/import, `scripts/validate-data.mjs`, inline-asset migration, or `src/shared/commitMessage.js`. Use `jj`, never `git`, for repository status, diff, history, and commits.

---

## Task 1: Preserve shared publication coverage outside the CLI suite

**Files:**

- Create: `tests/commit-message.test.ts`
- Create: `tests/published-data-validation.test.mjs`
- Modify: `tests/patch-publication-integration.test.ts`
- Reference: `tests/cli-publish.test.mjs`
- Test: `tests/commit-message.test.ts`
- Test: `tests/published-data-validation.test.mjs`
- Test: `tests/patch-publication-integration.test.ts`

- [ ] **Step 1: Move semantic commit-message cases into a focused test**

Create `tests/commit-message.test.ts`. Import `buildCommitMessage` directly from the module used by website publication and copy the small database fixture builders plus these four behaviors from `tests/cli-publish.test.mjs`:

- dynamic subject and semantic body without embedded image data;
- `collapsedChecklistSections` reported as `collapsed checklists`;
- bounded and sanitized subjects/bodies for large patches;
- bounded note details with Markdown paragraph injection removed.

The focused test starts with this shape:

```ts
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildCommitMessage } from "../src/shared/commitMessage.js";

describe("semantic publication commit messages", () => {
  it("builds a dynamic subject and semantic body without embedding image data", () => {
    const before = emptyDatabase();
    const after = structuredClone(before);
    after.games[GAME_ID] = game();

    const result = buildCommitMessage(before, after);

    expect(result.subject).toBe("Add DuckTales");
    expect(result.body).toContain('- Add "DuckTales"');
    expect(result.message).not.toContain("base64");
  });
});
```

Keep the exact stronger expectations from the existing cases rather than weakening them to only the short example above. Do not import anything from `scripts/publish-patch.mjs`.

- [ ] **Step 2: Move deploy-validator cases into a focused test**

Create `tests/published-data-validation.test.mjs`. Import `validateLibrary` and `computeRevision` from `scripts/validate-data.mjs`, and copy only the fixture helpers required for these retained behaviors:

- optional `doubleHeight` and `doubleWidth` booleans are accepted;
- non-boolean note-size values are rejected;
- an invalid asset id never causes an external media path to be derived;
- a symlinked media root is rejected before traversal;
- a symlinked media ancestor is rejected before traversal;
- file size is checked before reading or hashing;
- orphan files in `public/media` are rejected.

Use per-test temporary directories and recover permissions before cleanup:

```js
// @vitest-environment node

import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeRevision, validateLibrary } from "../scripts/validate-data.mjs";

const temporaryPaths = [];

afterEach(() => {
  while (temporaryPaths.length > 0) {
    rmSync(temporaryPaths.pop(), { recursive: true, force: true });
  }
});

describe("published data validation", () => {
  it.each(["doubleHeight", "doubleWidth"])("rejects non-boolean %s note size values", (field) => {
    const database = populatedDatabase({ [field]: "yes" });
    database.revision = computeRevision(database);
    expect(() => validateLibrary(database)).toThrow(new RegExp(`${field}.*must be a boolean`));
  });
});
```

Retain the existing exact error assertions and symlink/permission cleanup. Do not copy payload decoding, patch validation, repository transaction, Git, or Jujutsu helpers.

- [ ] **Step 3: Switch browser patch lifecycle integration to the domain implementation**

In `tests/patch-publication-integration.test.ts`, add `applyPatch` to the existing `../src/domain` import. Delete the import and type alias for `applyCliPatch`, then replace every `applyCliPatch(...)` call with `applyPatch(...)`.

The import should become:

```ts
import {
  applyPatch,
  diffLibrary,
  reconcilePatch,
  withComputedRevision,
  type Game,
  type LibraryDatabase,
  type Note,
  type PatchEnvelope,
} from "../src/domain";
```

Rename `publishes a note group move through the CLI patch path` to `publishes a note group move through the domain patch path`.

- [ ] **Step 4: Run the retained focused coverage**

Run:

```sh
npx vitest run tests/commit-message.test.ts tests/published-data-validation.test.mjs tests/patch-publication-integration.test.ts
```

Expected: all focused tests pass. If a moved test fails, compare it with its original assertion and fixture before changing production code.

- [ ] **Step 5: Inspect and commit the coverage migration**

Run:

```sh
jj status
jj diff
jj describe -m "Preserve website publication coverage"
jj new
```

Expected: the described change contains only the two new focused tests and the domain integration-test migration; the new working-copy change is empty.

## Task 2: Remove the browser clipboard-publication fallback

**Files:**

- Modify: `tests/diff-sync-panel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/DiffDialog.tsx`
- Modify: `src/components/diff-sync.css`
- Modify: `src/styles.css`
- Modify: `tests/ui-acceptance.test.tsx`
- Modify: `tests/local-assets-ui.test.tsx`
- Delete: `src/state/publishCommand.ts`
- Delete: `tests/publish-command.test.ts`
- Test: `tests/diff-sync-panel.test.tsx`
- Test: `tests/ui-acceptance.test.tsx`
- Test: `tests/local-assets-ui.test.tsx`

- [ ] **Step 1: Replace the legacy fallback expectation with the desired public surface**

In `tests/diff-sync-panel.test.tsx`, replace `keeps the legacy clipboard flow collapsed as a fallback` with a regression test that says local publication is absent:

```tsx
it("does not expose the removed local publication fallback", () => {
  renderDialog({
    busy: false,
    connected: true,
    error: null,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onSync: vi.fn(),
    pagesPending: false,
    persistence: "session",
    stage: "idle",
  });

  expect(screen.queryByText("Локальная публикация")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Скопировать патч" })).not.toBeInTheDocument();
  expect(screen.queryByText("npm run publish:clipboard")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the regression test and confirm RED**

Run:

```sh
npx vitest run tests/diff-sync-panel.test.tsx -t "does not expose the removed local publication fallback"
```

Expected: FAIL because `DiffDialog` still renders `Локальная публикация` and `npm run publish:clipboard`.

- [ ] **Step 3: Remove payload creation and copying from `App`**

In `src/App.tsx`:

- remove `PUBLISH_CLIPBOARD_COMMAND`, `copyText`, and `createPublishPayload` imports;
- remove `PatchEnvelope` if it is no longer otherwise used;
- remove `preparedPayload` and `publishFailure` state;
- remove `publishPayload`, `publishError`, and `publishPayloadPreparing` derivations;
- remove the effect that calls `createPublishPayload` when the patch changes;
- remove the `copyPatch` callback;
- stop passing `copyPatch`, `payload`, `payloadPreparing`, and `publishCommand` to `DiffDialog`;
- reduce the dialog error expression to the remaining application and persistence errors.

The resulting dialog call should contain the existing website-sync and recovery props without clipboard props:

```tsx
<DiffDialog
  error={actionError ?? library.persistenceError}
  items={diffItems}
  onClose={() => setDiffOpen(false)}
  onExport={exportPatch}
  onImport={importPatch}
  open={diffOpen}
  patchBytes={patchBytes}
  sync={diffSyncController}
/>
```

Preserve all other existing props in the real call, including conflicts, undo handlers, corrupted-raw recovery, and local assets.

- [ ] **Step 4: Remove fallback props, state, behavior, and markup from `DiffDialog`**

In `src/components/DiffDialog.tsx`:

- remove `payload`, `payloadPreparing`, `publishCommand`, and `copyPatch` from `DiffDialogProps` and function destructuring;
- remove `copyAttemptRef`, `copyState`, the payload-reset effect, and `copy()`;
- remove the `<details className="publish-panel publish-panel--fallback">` block;
- keep dialog, file-input, and sync-toggle refs;
- change the empty-state sentence to `Локальный патч пуст — синхронизировать нечего.`.

The retained prop surface should begin:

```ts
export interface DiffDialogProps {
  open: boolean;
  items: DiffItem[];
  conflicts?: DiffConflictItem[];
  patchBytes: number;
  error?: string;
  onClose: () => void;
  onExport: () => void;
  onImport: (text: string, fileName: string) => void | Promise<void>;
}
```

Keep the rest of the independent conflict, undo, recovery, sync, and local-assets props.

- [ ] **Step 5: Remove fallback-only CSS**

Delete selectors used only by local publication from `src/components/diff-sync.css` and `src/styles.css`, including:

```css
.publish-panel--fallback
.publish-panel__fallback-body
.publish-panel__blocked
.publish-panel__command
.copy-fallback
.section-icon--publish
```

Before removing the shared `.publish-panel` selector, verify with `rg -n 'publish-panel' src tests` that it has no website-sync or unrelated consumer. Remove the coarse-pointer summary rule for `.publish-panel--fallback` as well.

- [ ] **Step 6: Update component tests and delete clipboard-only tests**

Remove clipboard props from every `DiffDialog` render and rerender in:

- `tests/diff-sync-panel.test.tsx`;
- `tests/ui-acceptance.test.tsx`;
- `tests/local-assets-ui.test.tsx`.

In `tests/ui-acceptance.test.tsx`:

- keep the export/import and action-error cases;
- rename the conflicts case to describe conflict resolution and undo forwarding;
- remove its `copyPatch` mock and clipboard-only assertions;
- delete `shows a manual Safari fallback when clipboard copying is rejected`.

Delete `tests/publish-command.test.ts` with `src/state/publishCommand.ts` because its payload encoding and clipboard fallback no longer have a consumer.

- [ ] **Step 7: Run browser/UI coverage**

Run:

```sh
npx vitest run tests/diff-sync-panel.test.tsx tests/ui-acceptance.test.tsx tests/local-assets-ui.test.tsx
npm run build
```

Expected: all selected tests pass and TypeScript reports no stale clipboard props or imports.

- [ ] **Step 8: Inspect and commit the browser fallback removal**

Run:

```sh
jj status
jj diff
jj describe -m "Remove clipboard publication fallback"
jj new
```

Expected: only browser fallback implementation, styling, and directly related test changes are described; the new working-copy change is empty.

## Task 3: Remove the local publication command, scripts, suite, and documentation

**Files:**

- Create: `tests/publication-surface.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Delete: `scripts/publish-clipboard.mjs`
- Delete: `scripts/publish-patch.mjs`
- Delete: `tests/cli-publish.test.mjs`
- Delete: `tests/publish-clipboard.test.mjs`
- Test: `tests/publication-surface.test.ts`

- [ ] **Step 1: Add a public-surface removal test**

Create `tests/publication-surface.test.ts` so future changes cannot silently restore the unsupported path:

```ts
// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("publication surface", () => {
  it("exposes website synchronization as the only publication path", () => {
    expect(packageJson.scripts).not.toHaveProperty("publish:clipboard");
    expect(existsSync(new URL("../scripts/publish-clipboard.mjs", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../scripts/publish-patch.mjs", import.meta.url))).toBe(false);
    expect(readme).not.toContain("publish:clipboard");
    expect(readme).not.toContain("Скопировать патч");
  });
});
```

- [ ] **Step 2: Run the public-surface test and confirm RED**

Run:

```sh
npx vitest run tests/publication-surface.test.ts
```

Expected: FAIL because the npm command, entrypoint files, and legacy README instructions still exist.

- [ ] **Step 3: Delete the CLI publication surface**

Remove `publish:clipboard` from `package.json`, leaving the surrounding scripts valid JSON. Delete:

```text
scripts/publish-clipboard.mjs
scripts/publish-patch.mjs
tests/cli-publish.test.mjs
tests/publish-clipboard.test.mjs
```

Do not delete `scripts/validate-data.mjs`, `scripts/migrate-inline-assets.mjs`, `src/shared/commitMessage.js`, or their retained focused tests.

- [ ] **Step 4: Make README publication instructions website-only**

In `README.md`, keep the current GitHub Git Database API, PAT, branch-protection, and GitHub Pages guidance. Remove the complete block starting with `Старый локальный способ остаётся резервным:` through the macOS `/usr/bin/pbpaste` paragraph.

Keep export/import recovery in `## Safari и резервные копии`. Make the publication section unambiguous with wording equivalent to:

```md
## Публикация данных

Публикация выполняется кнопкой **Синхронизировать** вверху окна «Локальные правки».
```

- [ ] **Step 5: Run the public-surface and retained publication tests**

Run:

```sh
npx vitest run tests/publication-surface.test.ts tests/commit-message.test.ts tests/published-data-validation.test.mjs tests/patch-publication-integration.test.ts tests/diff-sync-panel.test.tsx
```

Expected: all selected tests pass and no test imports a deleted script.

- [ ] **Step 6: Scan for stale local-publication references**

Run:

```sh
rg -n 'publish:clipboard|publish-clipboard|publish-patch|PUBLISH_CLIPBOARD_COMMAND|createPublishPayload|Локальная публикация|Скопировать патч' . --glob '!docs/superpowers/**'
rg -n 'copyText|clipboard' src tests --glob '!src/components/ImagePicker.tsx' --glob '!src/components/Icon.tsx'
```

Expected: the first command finds no stale implementation, UI, test, package, or README reference. Review the second command manually: clipboard image input is independent and must remain; no result may refer to publication payload copying.

- [ ] **Step 7: Run full verification and compare test duration**

Run:

```sh
time npm test
npm run build
npm run data:validate
```

Expected: tests, TypeScript/Vite build, and deploy validator pass. Record the new `npm test` duration and compare it with the earlier local full-suite measurement of approximately 18.6 seconds; the Git/Jujutsu-heavy file that previously took approximately 17.6 seconds under full-suite contention is absent.

- [ ] **Step 8: Inspect and commit the CLI removal**

Run:

```sh
jj status
jj diff
jj describe -m "Remove local publication CLI"
jj new
jj status
```

Expected: the CLI removal, website-only README, and public-surface regression test are committed; the final working-copy change is empty.

## Final acceptance checklist

- [ ] Website GitHub synchronization remains visible and tested.
- [ ] PAT persistence, conflicts, undo, pending publication, export, and import still work.
- [ ] No clipboard publication UI, npm command, entrypoint, implementation, or CLI-only suite remains.
- [ ] `scripts/validate-data.mjs`, inline-asset migration, and shared commit-message generation remain.
- [ ] `npm test`, `npm run build`, and `npm run data:validate` pass.
- [ ] The repository-wide reference scan contains no stale local-publication references.
- [ ] Every implementation task is finalized with `jj describe` followed by `jj new`.
