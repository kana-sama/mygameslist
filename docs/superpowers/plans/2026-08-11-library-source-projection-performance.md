# Library Source Projection Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repeated whole-library validation and indexing from aggregate source projection without changing generated output or public validation behavior.

**Architecture:** Prepare immutable per-game projection inputs once at each checked public boundary, then pass them to one internal canonical-game projector. Reuse one asset-owner index inside normalization and source-representability validation.

**Tech Stack:** TypeScript 7, Vitest 4, Node.js 22, Jujutsu

## Global Constraints

- Generated YAML, Markdown, paths, leaf order, runtime database, revision, and `library.json` bytes must not change.
- `projectGameSourceBundle(database, gameId)` must remain a strict checked public API.
- Do not add a persistent cache, schema change, dependency, or Node-only domain implementation.
- Use Jujutsu exclusively; the completed feature, specification, plan, tests, and implementation form exactly one commit.
- Verification is intentionally compact: focused tests, `npm run data:validate`, and one timing comparison.

---

### Task 1: Linearize aggregate source projection

**Files:**
- Modify: `src/domain/assetOwnership.ts`
- Modify: `src/domain/libraryNormalization.ts`
- Modify: `src/domain/validation.ts`
- Modify: `src/source/project.ts`
- Modify: `tests/source-roundtrip.test.ts`
- Test: `tests/domain-normalization.test.ts`
- Include: `docs/superpowers/specs/2026-08-11-library-source-projection-performance-design.md`
- Include: `docs/superpowers/plans/2026-08-11-library-source-projection-performance.md`

**Interfaces:**
- Preserve: `deriveImageAssetAlt(database: LibraryDatabase, assetId: string): string`
- Preserve: `projectGameSourceBundle(database: LibraryDatabase, gameId: string): ProjectedGameBundle`
- Preserve: `projectSourceTree(database: LibraryDatabase): Promise<SourceProjection>`
- Add internally reusable owner-list derivation that accepts `readonly AssetOwner[] | undefined` and returns the selected alt string.
- Add an internal projection context containing occurrences and notes already grouped by game.

- [ ] **Step 1: Write the failing aggregate performance regression**

In `tests/source-roundtrip.test.ts`, add a deterministic synthetic published-source database with about 160 games and one cover asset per game. UUIDs and SHA-256 identifiers must be generated in canonical lowercase formats, and expected behavior must be asserted from literals: the projection contains 160 game bundles and finishes within a generous 1.5-second budget. Give this test a 15-second Vitest timeout so the old implementation fails on the performance assertion rather than the test harness timeout.

The production regression this catches is reintroducing a whole-library normalization, validation, owner-index construction, occurrence collection, or note scan inside the per-game aggregate loop.

- [ ] **Step 2: Run RED**

Run:

```sh
npm test -- tests/source-roundtrip.test.ts
```

Expected: the new large-library test fails because the current aggregate projection exceeds 1.5 seconds; existing functional assertions remain green.

- [ ] **Step 3: Reuse one owner index per domain operation**

In `src/domain/assetOwnership.ts`, extract the owner-list-to-alt selection from `deriveImageAssetAlt` into a reusable helper. Keep cover precedence, then first ordered note-image alt, then the empty string.

In `src/domain/libraryNormalization.ts`, call `indexAssetOwners(normalized)` once after unreferenced assets are removed and derive every image alt from that map.

In `sourceRepresentabilityIssues` in `src/domain/validation.ts`, build one owner index, use it both for image-alt checks and for owner consistency checks, and preserve the existing issue paths and messages.

- [ ] **Step 4: Reuse one aggregate projection context**

In `src/source/project.ts`, introduce an internal context builder that calls `collectSourceAssetOccurrences` once, groups occurrences by `gameId`, groups notes by `gameId`, and preserves deterministic ordering.

Move bundle serialization into an internal projector that assumes its database has already passed `assertCanonicalProjectionInput` and consumes the prepared per-game arrays. `projectGameSourceBundle` must validate once and then call it. `projectSourceTree` must normalize and validate once, create one context, and call the internal projector directly for every sorted game ID.

- [ ] **Step 5: Run GREEN and focused compatibility tests**

Run:

```sh
npm test -- tests/source-roundtrip.test.ts tests/domain-normalization.test.ts tests/source-asset-facts.test.ts
```

Expected: all tests pass with pristine output, including the 1.5-second regression.

- [ ] **Step 6: Verify the real source tree and performance**

Run:

```sh
/usr/bin/time -lp npm run data:validate
```

Expected: validation succeeds, reports 308 games and revision `b7f15d00960d48b76b1832281528cfbf69c5f8e77c6fa6ac3b3c13c75d030324`, and the measured real time is at most 5 seconds on the same local machine where the baseline was 35.5 seconds. Ignore only `/usr/bin/time`'s sandbox-specific `sysctl kern.clockrate` warning after confirming the npm command itself succeeded.

- [ ] **Step 7: Self-review and leave the feature ready for the single final commit**

Run `jj status` and `jj diff`, confirm only the listed specification, plan, tests, and implementation files changed, and write the implementation report. Do not run `jj describe` or `jj new`; the controller will perform the one final commit after the compact review.
