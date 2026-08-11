# Library Source Projection Performance Design

## Problem

Cold source validation for the current library takes roughly 35 seconds even though the generated `library.json` is only about 400 KiB. Profiling shows that aggregate projection calls the checked single-game projection entrypoint once per game. Each call revalidates, renormalizes, and reindexes the complete library, so total work grows superlinearly with the number of games and assets.

## Goal

Make cold `library.json` source assembly scale with the size of the source tree while preserving the exact generated database, source projection, validation behavior, ordering, and public APIs.

## Design

`projectSourceTree` will remain the aggregate checked entrypoint. It will normalize and validate the complete database once, collect asset occurrences once, group occurrences and notes by game once, and then call an internal canonical-game projector that consumes those prepared indexes.

`projectGameSourceBundle` will remain a strict standalone public boundary. It will still reject noncanonical databases and missing games, but after its one boundary validation it will use the same internal projector and prepared indexes as aggregate projection.

Owner-derived image alt normalization will build `indexAssetOwners` once per normalization or source-representability validation. A small owner-list helper will derive one image alt from that shared index. The existing `deriveImageAssetAlt(database, assetId)` API will remain intact and delegate through the helper.

## Compatibility

- Generated YAML, Markdown, paths, leaf order, runtime database, revision, and `library.json` bytes must not change.
- Direct `projectGameSourceBundle` validation and error behavior must remain strict.
- No persistent cache, invalidation protocol, schema change, dependency, or Node-only domain implementation will be introduced.
- All repository operations continue to use Jujutsu.

## Validation

- Add a performance regression test using a deterministic synthetic library large enough for the previous per-game whole-library work to exceed a generous time bound.
- Keep the existing projection, normalization, round-trip, and invalid-input tests green.
- Run `npm run data:validate` against the real 308-game tree and require a substantial reduction from the measured 35.5-second baseline; the local target is at most 5 seconds.
- Compare the resulting revision with the pre-change revision `b7f15d00960d48b76b1832281528cfbf69c5f8e77c6fa6ac3b3c13c75d030324`.

## Out of Scope

Artifact snapshot reuse, native Node hashing, incremental development rebuilds, and filesystem-read parallelism are follow-up optimizations only if the aggregate projection fix leaves cold assembly materially slow.
