# YAML Game Source Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with the parallel-wave override below. Every behavior change uses superpowers:test-driven-development: write one focused test, observe the intended failure, add the minimum implementation, observe green, then refactor. Workers may finalize temporary Jujutsu changes in isolated workspaces; the controller combines them into exactly one final feature commit after the whole feature is verified and reviewed.

**Goal:** Replace the committed monolithic runtime database and global source media directory with one readable YAML/Markdown/assets directory per game, while continuing to deploy one deterministic JSON database and deduplicated media set and preserving safe browser-to-GitHub publication.

**Architecture:** A browser-safe pure source layer owns normalization, canonical paths, strict YAML, note documents, source projection, source-tree validation, and assembly. Node adapters provide filesystem migration/build/dev serving, while the GitHub adapter publishes the same projected leaves with a strict deployed-commit precondition. Runtime state loads a provenance envelope and uses one durable pending-publication journal.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Vitest 4, YAML 1.2 via `yaml`, unified/remark GFM, Node 22, GitHub Git Data API, Jujutsu.

## Global Constraints

- The approved contract is [2026-08-11-yaml-game-source-tree-design.md](../specs/2026-08-11-yaml-game-source-tree-design.md). If this plan is ambiguous, that specification governs.
- Repository source version is exactly `1`; assembled runtime schema version remains exactly `2`.
- The committed source root is exactly `data/`. The deployed runtime surface is exactly `data/library.json` plus flat `media/<sha>.<runtime-extension>`.
- All source naming, YAML, note-envelope, attachment projection, asset inspection, projection, and assembly rules have one browser-safe implementation under `src/source/`. Filesystem, Vite, and GitHub adapters call it; they do not copy it.
- Every boundary normalizes with the same domain function. `assemble(project(database))` must equal the normalized, source-representable database, including its recomputed revision.
- A game directory is the deletion boundary. Projection deletes only leaves from the old bundle of an affected logical game that are absent from its desired bundle. No filesystem or remote-tree garbage collector may delete unrelated `data/**` leaves.
- The GitHub publisher makes no write if deployed `sourceCommitSha` differs from current branch HEAD, performs no remote reconcile/rebase/retry, and uses a non-force ref update.
- The pending-publication record is one validated v3 journal key. While valid or corrupt pending state exists, another publication is blocked and protected local bytes are retained.
- The migration baseline is exactly 308 games, 210 notes, 378 unique runtime assets, and 383 unique `(gameId, assetId)` source occurrences. User-visible content and exact note-body bytes must round-trip.
- Generated `library.json`, generated runtime media, build staging directories, and migration journals are not committed. The old `public/data/library.json` and `public/media/**` remain intact until a production assembly proves the migrated tree.
- Existing unrelated working-copy changes, if any appear, are preserved. Workers edit only the files named by their task or an explicitly necessary adjacent type/export.
- Independent implementation tasks run concurrently in isolated Jujutsu workspaces and temporary changes. Each worker describes only its scoped temporary change. After task reviews and integration, the controller combines all temporary changes, resolves dependencies, and squashes the complete feature to one final commit containing specification, plan, tests, data migration, and implementation; only then does it run `jj new`.

## Parallel execution waves

```text
approved spec + plan
        │
        ▼
Task 1: shared domain contract
        │
        ▼
Task 2A: shared source types/dependencies
        │
        ├──────────────┬──────────────┐
        ▼              ▼              ▼
Task 2B: YAML     Task 2C: paths  Task 4: asset facts
        │              │              │
        ▼              │              │
Task 3: notes          │              │
        └──────────────┴──────────────┘
                       │
                       ▼
             Task 5: projector/assembler
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
Task 6: FS/migrate             Task 7: envelope
        └──────────────┬──────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
Task 8: build/dev Task 9: GitHub Task 10: journal/assets
        └──────────────┴──────────────┘
                       ▼
              Task 11: provider/UI
                       │
                       ▼
              Task 12: cutover/acceptance
```

- Task 2A is a short serialized bootstrap that installs the direct dependencies and freezes browser-safe shared source types. Task 2B, Task 2C, and Task 4 then run concurrently because metadata, paths, and binary facts have disjoint files. Task 3 begins as soon as reviewed Task 2B freezes the strict metadata codecs; it can overlap any still-running path/asset work because asset filenames are injected into its API.
- Tasks 6 and 7 start from the reviewed integrated Tasks 1–5 change and run concurrently.
- Tasks 8, 9, and 10 start after Tasks 6 and 7 are integrated and run concurrently. This gives the build its filesystem adapter and gives transport/journal code the deployed-envelope contract without making those three tasks overlap.
- Task 11 integrates the reviewed transport and journal changes. Task 12 is the single serialized cutover because it mutates the real source representation and workflow.
- Review happens per temporary task change before integration. Each wave receives an integration test/review after its temporary changes are merged; findings are fixed in a new temporary descendant and included in the final squash.

---

## Task 1: Domain ownership, normalization, and source representability

**Files:**

- Create: `src/domain/assetOwnership.ts`
- Create: `src/domain/libraryNormalization.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/validation.ts`
- Modify: `src/domain/patch.ts`
- Modify: `src/domain/index.ts`
- Test: `tests/domain-normalization.test.ts`
- Test: `tests/domain-core.test.ts`

**Public interfaces:**

```ts
export type AssetOwner =
  | { role: "cover"; gameId: string; alt: string; originalName: string }
  | { role: "progress"; gameId: string; progressItemId: string; originalName: string }
  | { role: "note-image"; gameId: string; noteId: string; index: number; alt: string; originalName: string }
  | { role: "note-file"; gameId: string; noteId: string; index: number; label: string; originalName: string; mime: string };

export function indexAssetOwners(database: LibraryDatabase): ReadonlyMap<string, readonly AssetOwner[]>;
export function deriveImageAssetAlt(database: LibraryDatabase, assetId: string): string;
export function normalizeLibraryDatabase(database: LibraryDatabase): LibraryDatabase;
export function normalizePublishedLibrary(database: LibraryDatabase): Promise<LibraryDatabase>;
export function assertSourceRepresentable(database: LibraryDatabase): void;
```

- [ ] Write focused tests proving deterministic owner order, cover-first global image `alt`, first `(gameId,noteId,index)` image fallback, agreement of shared `originalName`/file MIME/cover alt, source-safe HTTP(S) links, control-free single-line presentation strings, canonical lowercase UUID/SHA values, and rejection of direct service-managed `publicationId`/derived-alt patches.
- [ ] Run `npm test -- tests/domain-normalization.test.ts tests/domain-core.test.ts` and record RED caused by the missing APIs/validation branches.
- [ ] Implement ownership indexing without changing the runtime `Asset` schema. Normalize defaults, entity order/reachability, global image alt, and recompute revision only in `normalizePublishedLibrary`.
- [ ] Make source representability explicit at mutation/import/publication boundaries; do not silently rewrite invalid identifiers or lossy strings.
- [ ] Update patch validation so `publicationId` and a noncanonical global image `alt` cannot be authored as ordinary local operations.
- [ ] Run the focused tests to GREEN, then `npm test -- tests/asset-garbage-collection.test.ts tests/domain-storage-assets.test.ts tests/patch-publication-integration.test.ts`.
- [ ] Self-review every normalization call for idempotence and confirm no unrelated asset is removed.

## Task 2: Source contracts, strict YAML, and canonical paths

### Task 2A bootstrap checkpoint: source types and locked dependencies

**Files:**

- Create: `src/source/types.ts`
- Create: `src/source/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.node.json`
- Test: `tests/source-types.test.ts`

- [ ] Add direct locked dependencies: `yaml` under dependencies and `tsx` under devDependencies. Expand Node TypeScript inputs to `scripts/**/*.ts` and `vite.config.ts`.
- [ ] Define the browser-safe source DTOs, exact source-tree entry kinds, logical leaf identities, reader contract, manifest/game/note shapes, and asset occurrence/owner shapes required by Tasks 2B–5. No file in `src/source/**` may import Node, filesystem, process, Buffer, or GitHub APIs.
- [ ] Write a compile/runtime shape test for the discriminated entry/leaf/source-attachment contracts, run it RED before the exports exist, then GREEN.
- [ ] Review and integrate this small temporary change before dispatching Tasks 2B, 3, and 4.

### Task 2B: strict YAML and metadata codecs

**Files:**

- Create: `src/source/yaml.ts`
- Create: `src/source/metadata.ts`
- Test: `tests/source-yaml.test.ts`

**Public interfaces:**

```ts
export interface SourceTreeReader {
  listEntries(): Promise<readonly SourceTreeEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
}

export type ProjectedSourceLeaf =
  | { kind: "text"; path: string; logicalId: string; text: string }
  | { kind: "binary"; path: string; logicalId: string; assetId: string; byteLength: number };

export function parseManifestYaml(text: string): SourceManifestV1;
export function serializeManifestYaml(value: SourceManifestV1): string;
export function parseGameYaml(text: string): SourceGameV1;
export function serializeGameYaml(value: SourceGameV1): string;
export function parseNoteMetadataYaml(text: string): SourceNoteMetadataV1;
export function serializeNoteMetadataYaml(value: SourceNoteMetadataV1): string;
```

- [ ] Write YAML RED tests for one-document YAML 1.2 Core parsing, duplicate keys detected before construction, unknown keys, directives, aliases, anchors, merge keys, tags, non-string keys, canonical key order, LF output, exact default omission, explicit block indentation/chomping for LF-only `reviewMarkdown`, and quoted `\r`/`\n` preservation when CR exists.
- [ ] Run `npm test -- tests/source-yaml.test.ts` and record RED for missing codecs.
- [ ] Implement CST/token preflight before semantic YAML construction, exact schemas with unknown-key rejection, and stable serializer order. The serializer may discard comments/hand formatting but must be byte-stable when reserializing canonical data.
- [ ] Run the focused tests to GREEN.
- [ ] Self-review that `src/source/**` has no Node filesystem, process, Buffer, or GitHub imports.

### Task 2C: canonical paths

**Files:**

- Create: `src/source/paths.ts`
- Test: `tests/source-paths.test.ts`

**Public interfaces:**

```ts
export function slugifySourceName(value: string, fallback: string): string;
export function gameSourceDirectoryName(game: Game): string;
export function deriveNoteFilename(note: Note): string;
export function sourceAssetFilename(occurrence: SourceAssetOccurrence, asset: Asset): string;
export function runtimeAssetFilename(asset: Asset): string;
```

- [ ] Write path RED tests with literal expectations for NFKC/lowercase Unicode slugs, 48-code-point and 160-byte limits, empty fallback, full UUID/SHA suffixes, note heading/plain-text fallback selection, skipped images/links/tables/fences, `archive.tar.gz`, `.gitignore`, `file.`, unsafe extensions, WebP/MP4/runtime extensions, and complete component byte limits.
- [ ] Run `npm test -- tests/source-paths.test.ts` and record RED.
- [ ] Implement all source/runtime path helpers through one shared normalizer and the approved Markdown AST selection rules.
- [ ] Run the focused tests to GREEN and `npm test -- tests/markdown-game-links.test.ts tests/markdown-table-structure.test.ts`.
- [ ] Do not edit `src/source/index.ts` in this parallel task; Task 5 integrates the barrel after all three branches merge.

## Task 3: Exact note document codec and GitHub attachment projection

**Files:**

- Create: `src/source/noteDocument.ts`
- Test: `tests/source-note-document.test.ts`

**Public interfaces:**

```ts
export interface ParsedNoteDocument {
  metadata: SourceNoteMetadataV1;
  bodyMarkdown: string;
}

export function parseNoteDocument(text: string, sourcePath: string, assetNames: ReadonlyMap<string, string>): ParsedNoteDocument;
export function serializeNoteDocument(document: ParsedNoteDocument, assetNames: ReadonlyMap<string, string>): string;
export function renderAttachmentProjection(metadata: SourceNoteMetadataV1, assetNames: ReadonlyMap<string, string>): string;
```

- [ ] Write byte-level RED fixtures for byte-zero marker, exact closing line, no BOM, one structural LF, empty body, body with zero/one/multiple final LF, no-attachment EOF behavior, exact suffix validation for attachments, marker-like fenced-code content, and rejection of raw HTML markers in the body.
- [ ] Add canonical-envelope cases proving every YAML string is double quoted and a literal `--` is removed from the comment payload by escaping every second hyphen as `\x2D`, then restored exactly on parse.
- [ ] Add visible projection cases for image, file, ordinary HTTP(S), and YouTube links; preserve attachment order; escape all CommonMark punctuation in alt/label; wrap destinations in `<...>`; reject controls; encode whitespace/`<`/`>` as uppercase UTF-8 percent bytes; preserve and uppercase valid `%HH`; encode lone `%` as `%25`.
- [ ] Run `npm test -- tests/source-note-document.test.ts` and record RED for missing parsing/serialization behavior.
- [ ] Implement exact prefix/suffix parsing without a whole-document regex or first-marker search. Extract metadata and generated suffix before passing only `bodyMarkdown` to current Markdown validation.
- [ ] Run the focused test to GREEN, then `npm test -- tests/markdown-diff.test.ts tests/markdown-tasks.test.tsx tests/note-groups.test.tsx`.
- [ ] Self-review that YAML attachments are the only authority and the generated section never enters runtime body text or filename derivation.
- [ ] Do not edit `src/source/index.ts` in this parallel task; Task 5 integrates the barrel.

## Task 4: Asset byte facts and shared-owner agreement

**Files:**

- Create: `src/source/assetFacts.ts`
- Modify: `src/domain/assets.ts`
- Test: `tests/source-asset-facts.test.ts`
- Test: `tests/progress-icon.test.ts`

**Public interfaces:**

```ts
export function parseWebPDimensions(bytes: Uint8Array): { width: number; height: number };
export function collectSourceAssetOccurrences(database: LibraryDatabase): readonly SourceAssetOccurrence[];
export function inspectSourceAsset(occurrences: readonly SourceAssetOccurrence[], bytes: Uint8Array): Asset;
```

- [ ] Write RED tests for VP8/VP8L/VP8X WebP dimensions, malformed/truncated WebP, SHA-256 and byte-length mismatch, canonical image/MP4/arbitrary-file kinds and MIME, 64×64 progress icon validation, and shared-owner `originalName`/MIME/cover-alt disagreement.
- [ ] Include the current exceptional `application/octet-stream` file behavior and prove arbitrary MIME is not inferred from `.bin`.
- [ ] Run `npm test -- tests/source-asset-facts.test.ts tests/progress-icon.test.ts` and record RED.
- [ ] Implement byte inspection using browser-compatible `Uint8Array`/Web Crypto primitives and the single runtime filename helper. Do not lazily derive dimensions in the browser UI.
- [ ] Run focused tests to GREEN, then `npm test -- tests/domain-storage-assets.test.ts tests/note-media-gallery.test.tsx tests/image-lightbox.test.tsx`.
- [ ] Self-review that each unique runtime SHA yields one asset fact while source occurrences may be duplicated across game folders.
- [ ] Do not edit `src/source/index.ts` in this parallel task; Task 5 integrates the barrel.

## Task 5: Pure source projection, inventory validation, and assembly

**Files:**

- Create: `src/source/project.ts`
- Create: `src/source/assemble.ts`
- Create: `tests/fixtures/source-tree.ts`
- Test: `tests/source-roundtrip.test.ts`
- Modify: `src/source/index.ts`

**Public interfaces:**

```ts
export interface SourceProjection {
  database: LibraryDatabase;
  leaves: readonly ProjectedSourceLeaf[];
  gameBundles: ReadonlyMap<string, ProjectedGameBundle>;
}

export interface PublishedLibraryEnvelope {
  sourceCommitSha: string | null;
  database: LibraryDatabase;
}

export interface SourceAssembly {
  database: LibraryDatabase;
  envelope: PublishedLibraryEnvelope;
  runtimeMedia: ReadonlyMap<string, Uint8Array>;
  sourceAssetOccurrences: number;
}

export function projectGameSourceBundle(database: LibraryDatabase, gameId: string): ProjectedGameBundle;
export function projectSourceTree(database: LibraryDatabase): SourceProjection;
export function validateProjectedSourceInventory(
  projection: SourceProjection,
  entries: readonly SourceTreeEntry[],
): ValidatedSourceInventory;
export async function assembleSourceTree(reader: SourceTreeReader, options: { sourceCommitSha: string | null }): Promise<SourceAssembly>;
export function parsePublishedLibraryEnvelope(value: unknown): PublishedLibraryEnvelope;
```

- [ ] Build a hand-authored in-memory fixture with two games, anonymous note groups, empty/exact-newline bodies, image/file/YouTube attachments, a shared SHA in both games, a progress icon, and a title/body edit that renames a directory/note.
- [ ] Write RED tests that project exact canonical leaf paths and bytes, recursively reject every extra/missing/wrong-kind/duplicate/symlink-like inventory entry, verify directory/path IDs equal embedded IDs, ensure every reference has exactly one owning-game binary occurrence, deduplicate runtime media, and reject bytes under an incorrect SHA suffix. The inventory-only validator accepts Git tree mode/type/blob-SHA metadata without reading binary contents and returns a trusted `path → blobSha` map plus asset occurrences for browser publication.
- [ ] Assert with independent literals that `assemble(project(normalize(database)))` equals the normalized database and that a second projection is byte-identical. Include exact `sourceCommitSha` envelope parsing and exclusion of provenance from revision.
- [ ] Run `npm test -- tests/source-roundtrip.test.ts` and record RED.
- [ ] Implement projectors as pure descriptors. Implement assembly by enumerating the complete reader inventory first, then parsing/validating all semantic leaves and bytes, normalizing, recomputing revision, and creating the envelope/runtime media map.
- [ ] Run the focused tests to GREEN, followed by `npm test -- tests/domain-normalization.test.ts tests/source-yaml.test.ts tests/source-note-document.test.ts tests/source-asset-facts.test.ts`.
- [ ] Self-review the inverse contract and prove projection order cannot depend on object insertion order or filesystem enumeration order.

## Task 6: Filesystem adapter, validation CLI, and journaled migration engine

**Files:**

- Create: `scripts/source-tree-fs.ts`
- Create: `scripts/validate-source.ts`
- Create: `scripts/migrate-library-source.ts`
- Create: `tests/source-filesystem.test.ts`
- Create: `tests/source-migration.test.ts`
- Retain until Task 12: `scripts/validate-data.mjs`, `scripts/migrate-inline-assets.mjs`, and `tests/migrate-inline-assets.test.mjs`

**Public interfaces:**

```ts
export function createFileSystemSourceReader(sourceRoot: string): SourceTreeReader;
export async function materializeProjectedSourceTree(options: MaterializeSourceTreeOptions): Promise<void>;
export async function validateSourceTree(options: ValidateSourceTreeOptions): Promise<SourceAssembly>;
export async function migrateLibrarySource(options: MigrateLibrarySourceOptions): Promise<MigrationReport>;
```

- [ ] Write filesystem RED tests in a temporary directory for strict `lstat` regular-file/directory checks, symlink rejection, deterministic recursion, traversal protection, exact inventory, binary preservation, missing/wrong-case leaves, and materialization through injected byte resolution.
- [ ] Write migration RED tests for a small legacy aggregate/media corpus: temporary generation, production assembler comparison, count/hash report, each failure-injection phase, durable journal detection, intact legacy input on failure, rerun after interruption, and idempotent already-applied success.
- [ ] Run `npm test -- tests/source-filesystem.test.ts tests/source-migration.test.ts` and record RED.
- [ ] Implement Node-only adapters around the pure source layer. Place journals and temporary roots outside both the source target and legacy inputs; validate explicit resolved targets before replace/delete operations.
- [ ] Leave default package commands and legacy scripts intact until the Task 12 representation cutover. Exercise the new CLI entry points directly against explicit fixture roots in this task.
- [ ] Run focused tests to GREEN and migrate retained behavior from `tests/published-data-validation.test.mjs`, `tests/note-image-dimensions-cli.test.mjs`, and `tests/platinum-status-cli.test.mjs` into source assembly/asset tests; defer deleting obsolete files to Task 12.
- [ ] Self-review every destructive/move phase for explicit roots, journal recovery, and preservation of legacy inputs.

## Task 7: Runtime provenance envelope and patch-selection dependencies

**Files:**

- Modify: `src/domain/patchSelection.ts`
- Modify: `src/state/LibraryContext.tsx`
- Modify: `tests/patch-selection.test.ts`
- Modify: `tests/library-context.test.tsx`

- [ ] Write RED tests for the derived-global-alt selection closure, rejection of an alt-only nonrepresentable selected patch, and an owner metadata change selecting all dependent operations required for source agreement.
- [ ] Change both initial and polling static database test helpers to serve `{sourceCommitSha,database}`. Add RED cases for exact envelope validation, `null` provenance in development, deployed provenance retention across local edits, and invalid envelope rejection.
- [ ] Run `npm test -- tests/patch-selection.test.ts tests/library-context.test.tsx` and record RED.
- [ ] Implement the closure via domain ownership/normalization helpers and unwrap the envelope at both runtime fetch boundaries without yet changing GitHub transport semantics.
- [ ] Normalize after mutation, patch application, reconciliation, import, and effective-database construction so every downstream diff observes canonical state.
- [ ] Run focused tests to GREEN, then `npm test -- tests/app-selective-diff.test.tsx tests/change-review.test.ts`.
- [ ] Self-review that provenance is metadata alongside the deployed base, never part of semantic revision or ordinary local patch operations.

## Task 8: Deterministic staging artifact, atomic promotion, and Vite development snapshot

**Files:**

- Create: `scripts/artifact-root.ts`
- Create: `scripts/build-site.ts`
- Create: `scripts/vite-library-source-plugin.ts`
- Create: `tests/artifact-build.test.ts`
- Create: `tests/vite-library-source-plugin.test.ts`
- Modify: `vite.config.ts`
- Modify: `.gitignore`

**Public interfaces:**

```ts
export async function buildArtifactData(sourceRoot: string, stagingRoot: string, sourceCommitSha: string | null): Promise<SourceAssembly>;
export async function validateArtifactRoot(root: string, expected: SourceAssembly): Promise<void>;
export async function promoteArtifactRoot(options: PromotionOptions): Promise<void>;
export async function recoverArtifactPromotion(options: PromotionRecoveryOptions): Promise<void>;
export function librarySourcePlugin(options: LibrarySourcePluginOptions): Plugin;
```

- [ ] Write artifact RED tests proving a successful staging root contains exactly shell files, `data/library.json`, and one flat runtime media file per unique SHA; JSON is the exact envelope; no source YAML/Markdown is copied; full and cached-shell builds produce identical data/media bytes.
- [ ] Add failure injection for every promotion phase and prove the journal is outside replaced roots, recovery yields either the old complete artifact or new complete artifact, and invalid staging is never promoted.
- [ ] Write Vite plugin RED tests for immutable whole-snapshot swaps, `GET`/`HEAD`, exact media 404, `Cache-Control: no-store`, invalid-edit 503/error reporting, no partial old/new mix, and recovery/full reload after a valid edit. Compare served bytes with production assembly bytes.
- [ ] Run `npm test -- tests/artifact-build.test.ts tests/vite-library-source-plugin.test.ts` and record RED.
- [ ] Implement one `build-site.ts` orchestrator for full shell build and cached-shell input. It always assembles and validates into a unique staging root before optional local promotion.
- [ ] Install the development plugin before static fallback; watch `data/**`, assemble a fresh immutable snapshot, and atomically replace the previous snapshot only on full success.
- [ ] Keep default `npm run build`/`data:validate` wiring unchanged until Task 12 creates the real `data/` tree. Test the builder and Vite plugin only with explicit source fixture roots. Ignore only stable local journal/staging patterns.
- [ ] Run focused tests to GREEN and typecheck the new scripts through the Node TypeScript project; defer default-root build/validation commands to Task 12.
- [ ] Self-review the final artifact inventory rather than just comparing expected row counts.

## Task 9: Strict GitHub source-tree transport

**Files:**

- Rewrite: `src/state/githubGitDatabaseSync.ts`
- Rewrite: `tests/github-git-database-sync.test.ts`
- Modify: `src/shared/commitMessage.js`
- Modify: `src/shared/commitMessage.d.ts`
- Modify: `tests/commit-message.test.ts`

**Transport contract:**

```ts
export interface GitHubPublishSourceTreeOptions {
  deployed: PublishedLibraryEnvelope & { sourceCommitSha: string };
  selectedPatch: PatchEnvelope;
  localAssets: ReadonlyMap<string, Blob>;
}

export type GitHubSourceTreePublishResult =
  | { status: "up_to_date"; sourceCommitSha: string; database: LibraryDatabase }
  | { status: "published"; sourceCommitSha: string; targetCommitSha: string; database: LibraryDatabase; uploadedLocalAssetIds: readonly string[]; lostResponseConfirmed: boolean };
```

- [ ] Rewrite tests first. Preserve access-check, secret redaction, branch configuration, temporary access branch cleanup, lost-response confirmation, and unrelated 422 handling.
- [ ] Add RED cases: stale HEAD returns `stale_deployment` with zero write calls; truncated/invalid/mode/type/inventory trees reject; semantic no-op writes nothing and creates no UUID; title/note filename rename reuses validated blob SHA; game/note/asset deletion removes exact old bundle leaves; shared SHA across games reuses a remote blob without GET; one new SHA uploads once and reuses it across paths; unrelated paths remain untouched; non-force race is not retried; lost response distinguishes target/descendant/unknown.
- [ ] Run `npm test -- tests/github-git-database-sync.test.ts tests/commit-message.test.ts` and record RED.
- [ ] Retain the existing request/redaction/Git-object primitives. Replace aggregate fetch/publication and remove remote reconcile/conflict types. Validate current HEAD before any write and validate the recursive `data/**` tree with the shared source layer.
- [ ] Apply the frozen selected patch, normalize, return early on semantic no-op, generate the publication UUID, set it on target, recompute revision, then project manifest and affected game bundles.
- [ ] Build one flat add/delete leaf map, reuse exact validated blob SHAs for unchanged bytes/renames/shared occurrences, create text/new binary blobs only when needed, then create one base tree, one commit, and one `force:false` ref update.
- [ ] Run focused tests to GREEN, then `npm test -- tests/github-pat.test.ts tests/patch-publication-integration.test.ts`.
- [ ] Self-review that no code scans or garbage-collects unrelated `data/**` and no stale publication writes even a blob.

## Task 10: Durable v3 publication journal and protected local assets

**Files:**

- Rewrite: `src/state/pendingPublication.ts`
- Modify: `src/domain/localAssets.ts`
- Modify: `src/state/recoveryExport.ts`
- Rewrite: `tests/pending-publication.test.ts`
- Modify: `tests/localstorage-local-assets.test.ts`

**Journal contract:**

```ts
export interface PendingPublicationJournalV3 {
  version: 3;
  sourceCommitSha: string;
  targetCommitSha: string;
  targetRevision: string;
  targetDatabase: LibraryDatabase;
  remainderPatch: PatchEnvelope;
  localAssetIdsAwaitingVerification: readonly string[];
  owner: string;
  repo: string;
  branch: string;
  createdAt: string;
  phase: "awaiting-deployment" | "recovery-required";
}
```

- [ ] Write RED tests for exact-key v3 parsing, single-key install plus readback verification, ordinary patch untouched/ignored while journal is valid, corrupt raw preservation and sync block, legacy v1/v2 recovery policy, storage failure returning memory-only state, and crash-safe finalize order: persist/read-verify remainder against deployed target, then clear journal.
- [ ] Add RED tests proving every `localAssetIdsAwaitingVerification` entry and unreferenced records in `publishing`/`awaiting-verification` survive cleanup; only verified safe local records are deleted. Include journal/provenance/raw-corrupt data in recovery archives.
- [ ] Run `npm test -- tests/pending-publication.test.ts tests/localstorage-local-assets.test.ts` and record RED.
- [ ] Implement one journal storage key and strict discriminated validation. Never silently fall back to the ordinary patch if the journal exists but is corrupt.
- [ ] Make finalization idempotent and interruption-safe. Keep local bytes until deployed target media verification succeeds or a user recovery action explicitly exports them.
- [ ] Run focused tests to GREEN, then `npm test -- tests/domain-storage-assets.test.ts`.
- [ ] Self-review every storage write/read/clear ordering and ensure a second publication cannot bypass pending/corrupt state.

## Task 11: Provider publication state machine and recovery UI

**Files:**

- Modify: `src/state/LibraryContext.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/DiffSyncPanel.tsx`
- Modify: `tests/library-context.test.tsx`
- Modify: `tests/diff-sync-panel.test.tsx`
- Modify: `tests/app-selective-diff.test.tsx`

- [ ] Rewrite provider sync tests first for frozen click base/effective/selection/deferred operations; local edits during upload; unconditional pending block; storage-failure memory-only mode; source/target/proven-descendant/unrelated deployed commit states; revision mismatch; descendant clean reconciliation; descendant conflict recovery; retry/export actions; protected/deleted local bytes; and cross-tab journal installation.
- [ ] Encode the exact post-click remainder with tests:

```ts
const postClick = diffLibrary(clickEffective, liveEffective);
const rebasedPostClick = rebasePostClickOverlaps(deferred, postClick);
const merged = mergePatchEnvelopes(deferred, rebasedPostClick);
const remainder = reconcilePatch(targetDatabase, merged);
```

- [ ] Invert the existing panel behavior that permits another sync after edits while deployment is pending. Add RED UI tests for waiting, memory-only, recovery-required, stale-deployment/reload, export, and retry messages/actions using user-visible roles rather than implementation test IDs.
- [ ] Run `npm test -- tests/library-context.test.tsx tests/diff-sync-panel.test.tsx tests/app-selective-diff.test.tsx` and record RED.
- [ ] Implement deployed provenance separately from the pending target base. Reject publication with `null` provenance or any valid/corrupt/memory pending state. Remove concurrent-update retry and remote conflict installation.
- [ ] After transport acceptance, compute the exact remainder, install durable journal or retain explicit memory-only recovery state, and register unload protection. Poll by source commit: source waits; target plus revision/media verifies then finalizes; a proven current descendant reconciles or enters recovery; unrelated/noncurrent commits retain the journal.
- [ ] Update UI to expose `targetCommitSha`, pending phase, recovery explanation, and retry/export without technical implementation details.
- [ ] Run focused tests to GREEN, then `npm test -- tests/ui-acceptance.test.tsx tests/local-assets-ui.test.tsx tests/change-review.test.ts`.
- [ ] Self-review that every pending phase blocks sync and every recovery route preserves enough state and bytes for export.

## Task 12: Real migration, deploy workflow, documentation, and end-to-end acceptance

**Files:**

- Create: `data/manifest.yaml`
- Create: `data/games/**`
- Remove: `public/data/library.json`
- Remove: `public/media/**`
- Modify: `.github/workflows/deploy.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/push-and-wait-ci.sh`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `src/domain/types.ts`
- Modify or remove obsolete CLI tests identified in Task 6
- Test: `tests/source-migration.test.ts`
- Test: `tests/artifact-build.test.ts`

- [ ] Before changing repository data, run the production migration command into its temporary root and assemble it. Verify exact baseline literals: 308 games, 210 notes, 378 unique runtime assets, 383 source occurrences; exact normalized semantic database; every legacy media SHA/byte length/dimension; and all 210 note body byte sequences.
- [ ] Wire `npm run data:validate` to `tsx scripts/validate-source.ts data`, add the explicit `data:migrate-source` command, and wire `npm run build` through typecheck plus the staged artifact orchestrator now that the real source root exists.
- [ ] Run the journaled apply into `data/`. Re-run migration to prove idempotence, then run the newly wired `npm run data:validate`. Only after these checks remove the legacy aggregate and 378 legacy media files from `public/`.
- [ ] Update deploy workflow tests/fixtures or artifact integration tests first so the cached route fails unless changes are restricted to `data/**`, both routes run `npm ci`, the shell cache excludes `data/` and `media/`, both invoke the same builder with exact `GITHUB_SHA`, and only a validated staging artifact root is uploaded. Add failure tests for a supplied SHA that differs from the actual checked-out HEAD and for any pre/post-build `data/**` digest change.
- [ ] Update the workflow accordingly. Verify checkout provenance by resolving `.git/HEAD`/refs without invoking Git, compute the deterministic source digest immediately before and after assembly, and abort if either SHA or digest differs. Replace direct `git` use in the touched helper with the equivalent Jujutsu remote lookup and preserve its existing user-facing behavior.
- [ ] Update documentation to describe per-game YAML/Markdown sources, generated runtime envelope/media, validation/migration commands, strict stale-deployment publication, and pending recovery. Remove statements that `public/data/library.json` or `public/media` are source-of-truth.
- [ ] Run `npm test -- tests/source-migration.test.ts tests/source-filesystem.test.ts tests/source-roundtrip.test.ts tests/source-asset-facts.test.ts tests/artifact-build.test.ts`; remove the obsolete validator/migration scripts and legacy CLI tests only after their behavior is represented by these green replacement tests.
- [ ] Run `npm run data:validate`, `npm run build`, and a cached-shell build into separate temporary roots. Compare exact `data/library.json` and `media/**` inventories/bytes, then validate both complete artifact roots.
- [ ] Run the full `npm test` suite and TypeScript/build checks with pristine output. Inspect the built `dist/` inventory and verify the app loads the envelope and all referenced media.
- [ ] Have both the implementer and reviewer compare the final repository tree and runtime artifact directly against the approved specification, including the exact note rendering structure on GitHub-style Markdown fixtures.
- [ ] Add a documented post-push acceptance command/checklist that opens real GitHub blob views for one note with an image, one arbitrary file, one YouTube link, one empty body, and one note with multiple attachments. If this feature is pushed during execution, run that gate and record the five URLs/results; otherwise report it explicitly as the only post-push external gate rather than claiming it ran locally.
- [ ] Perform final whole-feature review, address its complete finding set in one reviewed fix wave, then inspect `jj status` and `jj diff` for task-only changes.
- [ ] Finalize exactly one commit with `jj describe -m "Store each game as YAML and Markdown source"`, then create a clean descendant with `jj new`.
