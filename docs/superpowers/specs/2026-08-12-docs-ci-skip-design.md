# Docs-only CI Skip Design

## Goal

Prevent documentation-only pushes from starting the GitHub Pages deploy
workflow, because files under `docs/` do not affect the published application.

## Design

Add `docs/**` to `on.push.paths-ignore` in `.github/workflows/deploy.yml` while
retaining the existing `main` branch filter and manual `workflow_dispatch`
entrypoint. A push that changes only files under `docs/` will therefore skip
the workflow entirely. Mixed pushes that also change a non-ignored path will
still run the existing changed-file classifier and deploy logic unchanged.

## Constraints

- Do not change the build-path classifier or any job steps.
- Do not add tests or run the test suite for this configuration-only change.
- Do not perform a separate review audit.

## Success Criteria

- `push` events on `main` ignore `docs/**`.
- Manual workflow dispatch remains available.
- All existing deploy behavior for non-documentation changes is preserved.
