# Docs-only CI Skip Implementation Plan

> **Execution:** Apply this small configuration change directly, without subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent documentation-only pushes from starting the GitHub Pages deploy workflow.

**Architecture:** Use GitHub Actions' push path filter at the workflow trigger boundary. Keep the existing build classifier, jobs, and manual trigger unchanged.

**Tech Stack:** GitHub Actions YAML, Jujutsu (`jj`).

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-12-docs-ci-skip-design.md` as the approved specification.
- Do not add or run tests.
- Do not perform a review audit.
- Use Jujutsu exclusively for repository inspection and finalization.

---

### Task 1: Ignore documentation-only pushes

**Files:**

- Modify: `.github/workflows/deploy.yml`

**Interfaces:**

- Consumes: GitHub Actions `on.push.paths-ignore` filtering.
- Produces: A deploy workflow that does not start for pushes changing only `docs/**`.

- [x] **Step 1: Add the ignored path**

Under the existing `on.push.branches` entry, add:

```yaml
    paths-ignore:
      - docs/**
```

Keep `workflow_dispatch` and every job step unchanged.

- [x] **Step 2: Inspect the change without running tests**

Run `jj status` and `jj diff`. Confirm the workflow change is limited to the
new `docs/**` push exclusion and that the specification and plan are included in
the same working-copy change.
