# Vitest Superpowers Workspace Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the root Vitest run from collecting tests stored in temporary `.superpowers` workspaces.

**Architecture:** Extend Vitest's existing discovery exclusions in the shared Vite configuration. Preserve upstream defaults through `configDefaults.exclude` and add one repository-specific glob.

**Tech Stack:** Vite 8, Vitest 4, TypeScript 7, Jujutsu.

**Spec:** `docs/superpowers/specs/2026-08-25-vitest-superpowers-exclusion-design.md`

## Global Constraints

- Root Vitest discovery excludes `.superpowers/**`.
- Vitest's default exclusions remain active.
- Application source and authored test files remain unchanged.
- Verification uses the real root `npm test` command; no permanent source-text or generated-artifact test is added.
- Specification, plan, implementation, and verification belong to one feature commit finalized only after review.

---

### Task 1: Exclude temporary Superpowers workspaces from Vitest discovery

**Files:**
- Modify: `vite.config.ts:2-6,33-37`
- No permanent test file; the test runner's real discovery behavior is the contract.

**Interfaces:**
- Consumes: Vitest's exported `configDefaults.exclude: string[]`.
- Produces: root `test.exclude` containing all Vitest defaults followed by `.superpowers/**`.

- [ ] **Step 1: Record the behavioral RED reproduction**

Run:

```bash
npm test
```

Expected: the root process discovers `.superpowers/workspaces/shelfgrid-offscreen-measurement/tests/markdown-tasks.test.tsx` and fails its disclosure-chevron assertion. Record the failing path, assertion, and aggregate result in the task report.

- [ ] **Step 2: Extend Vitest's default exclusions**

Add the Vitest defaults import without replacing the existing Vite `defineConfig` import:

```ts
import { configDefaults } from "vitest/config";
```

Then extend the root test configuration:

```ts
test: {
  environment: "jsdom",
  exclude: [...configDefaults.exclude, ".superpowers/**"],
  globals: true,
  setupFiles: ["./src/test/setup.ts"],
},
```

- [ ] **Step 3: Verify GREEN with real discovery**

Run:

```bash
npm test
```

Expected: exit code 0; no collected test path begins with `.superpowers/`; all root project tests pass.

- [ ] **Step 4: Verify the typed production configuration**

Run:

```bash
npm run build
```

Expected: exit code 0. The repository's existing Vite chunk-size warning is accepted.

- [ ] **Step 5: Self-review without finalizing the commit**

Run `jj status` and `jj diff`. Confirm the working-copy change contains only this specification, this plan, and `vite.config.ts`; no permanent verifier or unrelated file is present. Write RED/GREEN evidence and self-review findings to the task report. Do not describe or finalize the Jujutsu change until independent review completes.

- [ ] **Step 6: Final verification and Jujutsu commit**

After review is clean, run fresh `npm test` and `npm run build`, inspect `jj status` and `jj diff`, describe the single fix commit, and create a fresh working-copy change with `jj new`.
