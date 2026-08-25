# Vitest Superpowers Workspace Exclusion Design

## Problem

The root `npm test` command recursively discovers tests inside `.superpowers/workspaces`. Those directories are independent temporary checkouts with their own source tree and configuration. When one of their tests runs under the root Vitest process, relative imports still resolve inside that checkout while `process.cwd()` points at the main checkout, so the test can combine code and assets from different revisions and fail spuriously.

The reproduced failure in `shelfgrid-offscreen-measurement/tests/markdown-tasks.test.tsx` passes when run from its own workspace and fails only when discovered by the root test command.

## Approved behavior

- Root Vitest discovery must exclude every file under `.superpowers/**`.
- Vitest's built-in exclusions, including `node_modules` and `.git`, must remain active.
- Tests in a `.superpowers` workspace remain runnable from that workspace's own root and configuration.
- Application code and authored tests remain unchanged.
- The raw root command `npm test` must complete without discovering the temporary workspace test.

## Implementation

Import `configDefaults` from `vitest/config` in `vite.config.ts` and set `test.exclude` to the existing Vitest defaults plus `.superpowers/**`. Extending `configDefaults.exclude` is required because a user-provided exclude array replaces, rather than augments, the defaults.

## Verification

The existing failing root `npm test` run is the RED reproduction. After the configuration change, run raw `npm test` and confirm that no `.superpowers` test file is listed and all discovered project tests pass. Run `npm run build` to type-check the configuration. No permanent source-inspection test is added because it would assert configuration text rather than observable behavior.
