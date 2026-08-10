/// <reference lib="dom" />

import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertSourceRepresentable,
  assertValidPublishedLibrary,
  canonicalStringify,
  computeLibraryRevision,
  runtimeAssetFilename,
  sha256Bytes,
  type LibraryDatabase,
} from "../src/domain";
import {
  collectSourceAssetOccurrences,
  inspectSourceAsset,
  projectSourceTree,
  type SourceAssembly,
  type SourceProjection,
} from "../src/source";
import {
  createFileSystemSourceReader,
  materializeProjectedSourceTree,
} from "./source-tree-fs";
import { validateSourceTree } from "./validate-source";

const SHA256 = /^[0-9a-f]{64}$/;

export interface MigrationCounts {
  games: number;
  notes: number;
  uniqueAssets: number;
  sourceAssetOccurrences: number;
}

export const MIGRATION_PHASES = [
  "legacy-validated",
  "staging-materialized",
  "staging-validated",
  "journal-persisted",
  "target-installed",
  "target-validated",
  "journal-removed",
] as const;

export type MigrationPhase = (typeof MIGRATION_PHASES)[number];

export interface MigrateLibrarySourceOptions {
  legacyLibraryPath: string;
  legacyMediaRoot: string;
  targetSourceRoot: string;
  expectedCounts: MigrationCounts;
  /** Stable sibling path is derived when omitted. */
  journalPath?: string;
  /** Test-only crash injection. Throwing must leave a state recoverable by an identical rerun. */
  afterPhase?: (phase: MigrationPhase) => void | Promise<void>;
}

type MigrationFileSystemOperation =
  | "recovered-temporary-journal-sync"
  | "temporary-journal-promote"
  | "journal-parent-sync"
  | "staging-target-install";

interface MigrationFileSystemOperationDetails {
  path?: string;
  from?: string;
  to?: string;
  flags?: number;
}

interface MigrationFileSystemTestSeam {
  execute(
    operation: MigrationFileSystemOperation,
    details: Readonly<MigrationFileSystemOperationDetails>,
    perform: () => Promise<void>,
  ): Promise<void>;
}

interface MigrateLibrarySourceInternalOptions extends MigrateLibrarySourceOptions {
  /** @internal A deliberately undisclosed seam used only to prove filesystem durability ordering. */
  fileSystemTestSeam?: MigrationFileSystemTestSeam;
}

export interface MigrationReport {
  status: "installed" | "recovered" | "already-applied";
  counts: MigrationCounts;
  legacyRevision: string;
  sourceRevision: string;
  revisionChangedByAllowedNormalization: boolean;
  legacyDatabaseSha256: string;
  legacyMediaSha256: string;
  sourceTreeSha256: string;
  noteBodiesSha256: string;
}

interface ResolvedMigrationPaths {
  legacyLibraryPath: string;
  legacyMediaRoot: string;
  targetSourceRoot: string;
  stagingSourceRoot: string;
  journalPath: string;
  journalTemporaryPath: string;
  commonParent: string;
  outputParentIdentity: StableDirectoryChain;
  journalParentIdentity: StableDirectoryChain;
}

interface StableDirectoryIdentity {
  path: string;
  device: bigint;
  inode: bigint;
}

interface StableDirectoryChain {
  directory: string;
  entries: readonly StableDirectoryIdentity[];
}

interface StableLeafIdentity {
  path: string;
  device: bigint;
  inode: bigint;
  kind: "directory" | "file";
}

interface MigrationJournalV1 {
  version: 1;
  operation: "install-source-tree";
  legacyLibraryPath: string;
  legacyMediaRoot: string;
  targetSourceRoot: string;
  stagingSourceRoot: string;
  legacyDatabaseSha256: string;
  legacyMediaSha256: string;
  sourceTreeSha256: string;
  noteBodiesSha256: string;
  legacyRevision: string;
  sourceRevision: string;
  counts: MigrationCounts;
}

interface ValidatedLegacyInput {
  legacyDatabase: LibraryDatabase;
  expectedDatabase: LibraryDatabase;
  projection: SourceProjection;
  mediaByRuntimePath: ReadonlyMap<string, Uint8Array>;
  journal: MigrationJournalV1;
  report: Omit<MigrationReport, "status">;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function validationErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "issues" in error && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: readonly unknown[] }).issues.map((issue) => {
      if (typeof issue !== "object" || issue === null) return String(issue);
      const record = issue as Record<string, unknown>;
      return `${String(record.path ?? "<unknown>")}: ${String(record.message ?? "invalid")}`;
    });
    if (issues.length) return `${errorMessage(error)} (${issues.join("; ")})`;
  }
  return errorMessage(error);
}

function digestCanonical(value: unknown): string {
  return sha256Bytes(new TextEncoder().encode(canonicalStringify(value)));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (canonicalStringify(actual) !== canonicalStringify(wanted)) {
    throw new Error(`${label} must contain exactly ${wanted.join(", ")}`);
  }
}

function resolvePathInput(input: string, label: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error(`${label} must be a nonempty path`);
  if (input.includes("\0")) throw new Error(`${label} contains NUL`);
  return resolve(input);
}

function assertNonRoot(path: string, label: string): void {
  if (path === parse(path).root) throw new Error(`${label} must not be a filesystem root: ${path}`);
}

function pathsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  return leftToRight !== "" && !leftToRight.startsWith("..") && !parse(leftToRight).root
    || rightToLeft !== "" && !rightToLeft.startsWith("..") && !parse(rightToLeft).root;
}

async function optionalLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(`Cannot inspect ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

async function bigIntLstat(path: string, label: string): Promise<BigIntStats> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error(`Cannot inspect ${label} ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

async function inspectRealDirectoryIdentity(path: string, label: string): Promise<StableDirectoryIdentity> {
  const stat = await bigIntLstat(path, label);
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink or alias: ${path}`);
  if (!stat.isDirectory()) throw new Error(`${label} is not a real directory: ${path}`);
  return { path, device: stat.dev, inode: stat.ino };
}

async function captureStableDirectoryChain(directory: string, label: string): Promise<StableDirectoryChain> {
  const root = parse(directory).root;
  const segments = directory.slice(root.length).split(/[\\/]/).filter(Boolean);
  const entries: StableDirectoryIdentity[] = [];
  let current = root;
  entries.push(await inspectRealDirectoryIdentity(current, `${label} component`));
  for (const segment of segments) {
    current = join(current, segment);
    entries.push(await inspectRealDirectoryIdentity(current, `${label} component`));
  }
  return { directory, entries };
}

async function assertStableDirectoryIdentity(expected: StableDirectoryIdentity, label: string): Promise<void> {
  let actual: StableDirectoryIdentity;
  try {
    actual = await inspectRealDirectoryIdentity(expected.path, label);
  } catch (error) {
    throw new Error(`${label} identity changed at ${expected.path}: ${errorMessage(error)}`, { cause: error });
  }
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new Error(`${label} identity changed at ${expected.path}`);
  }
}

async function assertStableDirectoryChain(expected: StableDirectoryChain, label: string): Promise<void> {
  for (const entry of expected.entries) await assertStableDirectoryIdentity(entry, `${label} component`);
}

async function inspectLeafIdentity(
  path: string,
  kind: StableLeafIdentity["kind"],
  label: string,
): Promise<StableLeafIdentity> {
  const stat = await bigIntLstat(path, label);
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink or alias: ${path}`);
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`${label} is not a real ${kind}: ${path}`);
  }
  return { path, kind, device: stat.dev, inode: stat.ino };
}

async function assertStableLeafIdentity(expected: StableLeafIdentity, label: string): Promise<void> {
  let actual: StableLeafIdentity;
  try {
    actual = await inspectLeafIdentity(expected.path, expected.kind, label);
  } catch (error) {
    throw new Error(`${label} identity changed at ${expected.path}: ${errorMessage(error)}`, { cause: error });
  }
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new Error(`${label} identity changed at ${expected.path}`);
  }
}

function internalOptions(options: MigrateLibrarySourceOptions): MigrateLibrarySourceInternalOptions {
  return options as MigrateLibrarySourceInternalOptions;
}

async function executeFileSystemOperation(
  options: MigrateLibrarySourceOptions,
  operation: MigrationFileSystemOperation,
  details: Readonly<MigrationFileSystemOperationDetails>,
  perform: () => Promise<void>,
): Promise<void> {
  const seam = internalOptions(options).fileSystemTestSeam;
  if (seam) {
    await seam.execute(operation, details, perform);
    return;
  }
  await perform();
}

async function assertPathAbsentUnderStableParent(
  path: string,
  parentIdentity: StableDirectoryChain,
  label: string,
): Promise<void> {
  await assertStableDirectoryChain(parentIdentity, label);
  const stat = await optionalLstat(path);
  await assertStableDirectoryChain(parentIdentity, label);
  if (stat !== null) throw new Error(`${label} must not exist: ${path}`);
}

async function assertNoSymlinkedAncestors(path: string, includeLeaf: boolean): Promise<void> {
  const root = parse(path).root;
  const segments = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  const limit = includeLeaf ? segments.length : Math.max(0, segments.length - 1);
  for (let index = 0; index < limit; index += 1) {
    current = join(current, segments[index]);
    const stat = await optionalLstat(current);
    if (stat === null) throw new Error(`Required path component is missing: ${current}`);
    if (stat.isSymbolicLink()) throw new Error(`Path contains a symlinked component: ${current}`);
    if (index < limit - 1 && !stat.isDirectory()) throw new Error(`Path ancestor is not a directory: ${current}`);
  }
}

function defaultJournalTemporaryPath(journalPath: string): string {
  return journalPath.endsWith(".json") ? `${journalPath.slice(0, -5)}.tmp` : `${journalPath}.tmp`;
}

async function resolveAndValidatePaths(options: MigrateLibrarySourceOptions): Promise<ResolvedMigrationPaths> {
  const legacyLibraryPath = resolvePathInput(options.legacyLibraryPath, "Legacy library path");
  const legacyMediaRoot = resolvePathInput(options.legacyMediaRoot, "Legacy media root");
  const targetSourceRoot = resolvePathInput(options.targetSourceRoot, "Target source root");
  assertNonRoot(targetSourceRoot, "Target source root");
  const commonParent = dirname(targetSourceRoot);
  const targetName = basename(targetSourceRoot);
  const stagingSourceRoot = join(commonParent, `.${targetName}.mygameslist-migration-staging`);
  const journalPath = options.journalPath === undefined
    ? join(commonParent, `.${targetName}.mygameslist-migration-journal.json`)
    : resolvePathInput(options.journalPath, "Migration journal path");
  const journalTemporaryPath = defaultJournalTemporaryPath(journalPath);
  for (const [path, label] of [
    [legacyLibraryPath, "Legacy library path"],
    [legacyMediaRoot, "Legacy media root"],
    [stagingSourceRoot, "Migration staging root"],
    [journalPath, "Migration journal path"],
    [journalTemporaryPath, "Migration temporary journal path"],
  ] as const) assertNonRoot(path, label);

  const protectedPaths = [legacyLibraryPath, legacyMediaRoot];
  const outputPaths = [targetSourceRoot, stagingSourceRoot, journalPath, journalTemporaryPath];
  for (const output of outputPaths) {
    for (const protectedPath of protectedPaths) {
      if (pathsOverlap(output, protectedPath)) {
        throw new Error(`Migration output ${output} overlaps protected legacy input ${protectedPath}`);
      }
    }
  }
  for (let left = 0; left < outputPaths.length; left += 1) {
    for (let right = left + 1; right < outputPaths.length; right += 1) {
      if (pathsOverlap(outputPaths[left], outputPaths[right])) {
        throw new Error(`Migration output paths overlap: ${outputPaths[left]} and ${outputPaths[right]}`);
      }
    }
  }

  await assertNoSymlinkedAncestors(legacyLibraryPath, true);
  await assertNoSymlinkedAncestors(legacyMediaRoot, true);
  await assertNoSymlinkedAncestors(targetSourceRoot, false);
  await assertNoSymlinkedAncestors(stagingSourceRoot, false);
  await assertNoSymlinkedAncestors(journalPath, false);
  await assertNoSymlinkedAncestors(journalTemporaryPath, false);

  const legacyLibraryReal = await realpath(legacyLibraryPath);
  const legacyMediaReal = await realpath(legacyMediaRoot);
  if (pathsOverlap(legacyLibraryReal, legacyMediaReal)) {
    throw new Error("Legacy library and media inputs overlap or alias one another");
  }
  for (const output of outputPaths) {
    const stat = await optionalLstat(output);
    if (stat !== null) {
      if (stat.isSymbolicLink()) throw new Error(`Migration output path is a symlink: ${output}`);
      const outputReal = await realpath(output);
      if (pathsOverlap(outputReal, legacyLibraryReal) || pathsOverlap(outputReal, legacyMediaReal)) {
        throw new Error(`Migration output ${output} aliases a protected legacy input`);
      }
    }
  }
  const outputParentIdentity = await captureStableDirectoryChain(commonParent, "Migration output parent");
  const journalParentIdentity = await captureStableDirectoryChain(dirname(journalPath), "Migration journal parent");
  return {
    legacyLibraryPath,
    legacyMediaRoot,
    targetSourceRoot,
    stagingSourceRoot,
    journalPath,
    journalTemporaryPath,
    commonParent,
    outputParentIdentity,
    journalParentIdentity,
  };
}

function assertCounts(value: unknown, label: string): asserts value is MigrationCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  exactKeys(record, ["games", "notes", "uniqueAssets", "sourceAssetOccurrences"], label);
  for (const key of ["games", "notes", "uniqueAssets", "sourceAssetOccurrences"] as const) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0) {
      throw new Error(`${label}.${key} must be a nonnegative safe integer`);
    }
  }
}

function databaseCounts(database: LibraryDatabase, sourceAssetOccurrences: number): MigrationCounts {
  return {
    games: Object.keys(database.games).length,
    notes: Object.keys(database.notes).length,
    uniqueAssets: Object.keys(database.assets).length,
    sourceAssetOccurrences,
  };
}

function requireCounts(actual: MigrationCounts, expected: MigrationCounts, label: string): void {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`${label} count mismatch: expected ${canonicalStringify(expected)}, received ${canonicalStringify(actual)}`);
  }
}

function allowedLegacyNormalization(database: LibraryDatabase): LibraryDatabase {
  const normalized = structuredClone(database);
  for (const game of Object.values(normalized.games)) {
    if (game.progressItems?.length === 0) delete game.progressItems;
  }
  for (const note of Object.values(normalized.notes)) {
    if (note.groupRank === 1024) delete note.groupRank;
    if (note.doubleWidth === false) delete note.doubleWidth;
    if (note.doubleHeight === false) delete note.doubleHeight;
    if (note.collapsedChecklistSections?.length === 0) delete note.collapsedChecklistSections;
  }
  normalized.revision = computeLibraryRevision(normalized);
  return normalized;
}

function decodeJsonBytes(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8: ${errorMessage(error)}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${errorMessage(error)}`, { cause: error });
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function noteBodiesSha256(database: LibraryDatabase): string {
  const entries = Object.values(database.notes)
    .map((note) => {
      const bytes = new TextEncoder().encode(note.bodyMarkdown);
      return { noteId: note.id, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes) };
    })
    .sort((left, right) => compareText(left.noteId, right.noteId));
  return digestCanonical(entries);
}

function legacyMediaSha256(media: ReadonlyMap<string, Uint8Array>): string {
  const entries = [...media]
    .map(([path, bytes]) => ({ path, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes) }))
    .sort((left, right) => compareText(left.path, right.path));
  return digestCanonical(entries);
}

function projectionBytes(
  projection: SourceProjection,
  database: LibraryDatabase,
  media: ReadonlyMap<string, Uint8Array>,
): readonly { path: string; bytes: Uint8Array }[] {
  return projection.leaves.map((leaf) => {
    if (leaf.kind === "text") return { path: leaf.path, bytes: new TextEncoder().encode(leaf.text) };
    const asset = database.assets[leaf.assetId];
    const bytes = asset ? media.get(runtimeAssetFilename(asset)) : undefined;
    if (!bytes) throw new Error(`Legacy media bytes are missing for projected asset ${leaf.assetId}`);
    return { path: leaf.path, bytes };
  });
}

function projectedSourceTreeSha256(
  projection: SourceProjection,
  database: LibraryDatabase,
  media: ReadonlyMap<string, Uint8Array>,
): string {
  const entries = projectionBytes(projection, database, media)
    .map(({ path, bytes }) => ({ path, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes) }))
    .sort((left, right) => compareText(left.path, right.path));
  return digestCanonical(entries);
}

async function sourceTreeSha256(sourceRoot: string): Promise<string> {
  const reader = createFileSystemSourceReader(sourceRoot);
  const entries = (await reader.listEntries()).filter((entry) => entry.kind === "file").sort((left, right) => compareText(left.path, right.path));
  const facts: { path: string; byteLength: number; sha256: string }[] = [];
  for (const entry of entries) {
    const bytes = await reader.readFile(entry.path);
    facts.push({ path: entry.path, byteLength: bytes.byteLength, sha256: sha256Bytes(bytes) });
  }
  return digestCanonical(facts);
}

async function readLegacyMedia(
  paths: ResolvedMigrationPaths,
  database: LibraryDatabase,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const rootStat = await lstat(paths.legacyMediaRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Legacy media root must be a real directory: ${paths.legacyMediaRoot}`);
  }
  const expected = new Map(Object.values(database.assets).map((asset) => [runtimeAssetFilename(asset), asset]));
  const names = (await readdir(paths.legacyMediaRoot)).sort(compareText);
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new Error(`Legacy media inventory has case-colliding paths at ${paths.legacyMediaRoot}`);
  }
  const actualNames = new Set(names);
  for (const name of names) if (!expected.has(name)) throw new Error(`Unexpected legacy media entry ${join(paths.legacyMediaRoot, name)}`);
  for (const name of expected.keys()) if (!actualNames.has(name)) throw new Error(`Missing legacy media file ${join(paths.legacyMediaRoot, name)}`);

  const occurrences = collectSourceAssetOccurrences(database);
  const byAsset = new Map<string, typeof occurrences[number][]>();
  for (const occurrence of occurrences) {
    const grouped = byAsset.get(occurrence.assetId) ?? [];
    grouped.push(occurrence);
    byAsset.set(occurrence.assetId, grouped);
  }
  const media = new Map<string, Uint8Array>();
  for (const name of [...expected.keys()].sort(compareText)) {
    const asset = expected.get(name)!;
    const path = join(paths.legacyMediaRoot, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Legacy media entry must be a regular non-symlink file: ${path}`);
    if (stat.size !== asset.byteLength) {
      throw new Error(`Legacy media byteLength mismatch at ${path}: expected ${asset.byteLength}, received ${stat.size}`);
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(await handle.readFile());
    } finally {
      await handle.close();
    }
    const inspected = inspectSourceAsset(byAsset.get(asset.id) ?? [], bytes);
    if (canonicalStringify(inspected) !== canonicalStringify(asset)) {
      throw new Error(`Legacy media facts disagree with database asset ${asset.id} at ${path}`);
    }
    media.set(name, bytes);
  }
  return media;
}

async function validateLegacyInput(
  paths: ResolvedMigrationPaths,
  expectedCounts: MigrationCounts,
): Promise<ValidatedLegacyInput> {
  assertCounts(expectedCounts, "Expected migration counts");
  const libraryStat = await lstat(paths.legacyLibraryPath);
  if (libraryStat.isSymbolicLink() || !libraryStat.isFile()) {
    throw new Error(`Legacy library must be a real regular non-symlink file: ${paths.legacyLibraryPath}`);
  }
  const rawLibrary = Uint8Array.from(await readFile(paths.legacyLibraryPath));
  const parsed = decodeJsonBytes(rawLibrary, `Legacy library ${paths.legacyLibraryPath}`);
  try {
    assertValidPublishedLibrary(parsed);
    assertSourceRepresentable(parsed);
  } catch (error) {
    throw new Error(`Legacy library validation failed at ${paths.legacyLibraryPath}: ${validationErrorMessage(error)}`, { cause: error });
  }
  const legacyDatabase = parsed;
  const expectedDatabase = allowedLegacyNormalization(legacyDatabase);
  try {
    assertValidPublishedLibrary(expectedDatabase);
    assertSourceRepresentable(expectedDatabase);
  } catch (error) {
    throw new Error(`Normalized legacy library validation failed: ${validationErrorMessage(error)}`, { cause: error });
  }
  const projection = await projectSourceTree(expectedDatabase);
  if (canonicalStringify(projection.database) !== canonicalStringify(expectedDatabase)) {
    throw new Error("Projector introduced a migration difference outside the explicit default-normalization allowlist");
  }
  const occurrences = collectSourceAssetOccurrences(expectedDatabase);
  const counts = databaseCounts(expectedDatabase, occurrences.length);
  requireCounts(counts, expectedCounts, "Legacy database");
  const mediaByRuntimePath = await readLegacyMedia(paths, expectedDatabase);
  const legacyDatabaseSha256 = sha256Bytes(rawLibrary);
  const legacyMediaDigest = legacyMediaSha256(mediaByRuntimePath);
  const sourceTreeDigest = projectedSourceTreeSha256(projection, expectedDatabase, mediaByRuntimePath);
  const noteDigest = noteBodiesSha256(legacyDatabase);
  const journal: MigrationJournalV1 = {
    version: 1,
    operation: "install-source-tree",
    legacyLibraryPath: paths.legacyLibraryPath,
    legacyMediaRoot: paths.legacyMediaRoot,
    targetSourceRoot: paths.targetSourceRoot,
    stagingSourceRoot: paths.stagingSourceRoot,
    legacyDatabaseSha256,
    legacyMediaSha256: legacyMediaDigest,
    sourceTreeSha256: sourceTreeDigest,
    noteBodiesSha256: noteDigest,
    legacyRevision: legacyDatabase.revision,
    sourceRevision: expectedDatabase.revision,
    counts,
  };
  return {
    legacyDatabase,
    expectedDatabase,
    projection,
    mediaByRuntimePath,
    journal,
    report: {
      counts,
      legacyRevision: legacyDatabase.revision,
      sourceRevision: expectedDatabase.revision,
      revisionChangedByAllowedNormalization: legacyDatabase.revision !== expectedDatabase.revision,
      legacyDatabaseSha256,
      legacyMediaSha256: legacyMediaDigest,
      sourceTreeSha256: sourceTreeDigest,
      noteBodiesSha256: noteDigest,
    },
  };
}

function parseJournal(value: unknown, path: string): MigrationJournalV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Migration journal is not an object: ${path}`);
  const record = value as Record<string, unknown>;
  exactKeys(record, [
    "version",
    "operation",
    "legacyLibraryPath",
    "legacyMediaRoot",
    "targetSourceRoot",
    "stagingSourceRoot",
    "legacyDatabaseSha256",
    "legacyMediaSha256",
    "sourceTreeSha256",
    "noteBodiesSha256",
    "legacyRevision",
    "sourceRevision",
    "counts",
  ], `Migration journal ${path}`);
  if (record.version !== 1 || record.operation !== "install-source-tree") throw new Error(`Migration journal has unsupported version/operation: ${path}`);
  for (const key of ["legacyLibraryPath", "legacyMediaRoot", "targetSourceRoot", "stagingSourceRoot"] as const) {
    if (typeof record[key] !== "string" || resolve(record[key] as string) !== record[key]) {
      throw new Error(`Migration journal ${key} must be an absolute resolved path: ${path}`);
    }
  }
  for (const key of [
    "legacyDatabaseSha256",
    "legacyMediaSha256",
    "sourceTreeSha256",
    "noteBodiesSha256",
    "legacyRevision",
    "sourceRevision",
  ] as const) {
    if (typeof record[key] !== "string" || !SHA256.test(record[key] as string)) {
      throw new Error(`Migration journal ${key} is not a canonical SHA-256: ${path}`);
    }
  }
  assertCounts(record.counts, `Migration journal counts at ${path}`);
  return record as unknown as MigrationJournalV1;
}

function assertOpenedLeafIdentity(
  stat: BigIntStats,
  expected: StableLeafIdentity,
  label: string,
): void {
  const kindMatches = expected.kind === "directory" ? stat.isDirectory() : stat.isFile();
  if (!kindMatches || stat.dev !== expected.device || stat.ino !== expected.inode) {
    throw new Error(`${label} identity changed while opening ${expected.path}`);
  }
}

function parseCanonicalJournalBytes(bytes: Uint8Array, path: string): MigrationJournalV1 {
  const journal = parseJournal(decodeJsonBytes(bytes, `Migration journal ${path}`), path);
  const canonicalBytes = new TextEncoder().encode(`${canonicalStringify(journal)}\n`);
  if (!sameBytes(bytes, canonicalBytes)) {
    throw new Error(`Migration journal is noncanonical, ambiguous, or contains duplicate keys: ${path}`);
  }
  return journal;
}

async function readJournal(path: string): Promise<MigrationJournalV1> {
  const identity = await inspectLeafIdentity(path, "file", "Migration journal");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Uint8Array;
  try {
    assertOpenedLeafIdentity(await handle.stat({ bigint: true }), identity, "Migration journal");
    bytes = Uint8Array.from(await handle.readFile());
    assertOpenedLeafIdentity(await handle.stat({ bigint: true }), identity, "Migration journal");
  } finally {
    await handle.close();
  }
  return parseCanonicalJournalBytes(bytes, path);
}

function requireExpectedJournal(actual: MigrationJournalV1, expected: MigrationJournalV1, path: string): void {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`Migration journal path/fingerprint does not match current validated inputs: ${path}`);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(errorCode(error) ?? "")) throw error;
  } finally {
    await handle?.close();
  }
}

async function writeJournal(paths: ResolvedMigrationPaths, journal: MigrationJournalV1): Promise<void> {
  await assertPathAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Migration journal");
  await assertPathAbsentUnderStableParent(paths.journalTemporaryPath, paths.journalParentIdentity, "Migration temporary journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  const handle = await open(paths.journalTemporaryPath, "wx", 0o644);
  try {
    await handle.chmod(0o644);
    await handle.writeFile(`${canonicalStringify(journal)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const temporaryIdentity = await inspectLeafIdentity(paths.journalTemporaryPath, "file", "Migration temporary journal");
  await assertPathAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Migration journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await assertStableLeafIdentity(temporaryIdentity, "Migration temporary journal");
  await assertPathAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Migration journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await assertStableLeafIdentity(temporaryIdentity, "Migration temporary journal");
  await rename(paths.journalTemporaryPath, paths.journalPath);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await syncDirectory(dirname(paths.journalPath));
  requireExpectedJournal(await readJournal(paths.journalPath), journal, paths.journalPath);
}

async function validateAndSyncRecoveredTemporaryJournal(
  paths: ResolvedMigrationPaths,
  expected: MigrationJournalV1,
  options: MigrateLibrarySourceOptions,
): Promise<StableLeafIdentity> {
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  const identity = await inspectLeafIdentity(paths.journalTemporaryPath, "file", "Migration temporary journal");
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(paths.journalTemporaryPath, flags);
  try {
    assertOpenedLeafIdentity(await handle.stat({ bigint: true }), identity, "Migration temporary journal");
    const bytes = Uint8Array.from(await handle.readFile());
    assertOpenedLeafIdentity(await handle.stat({ bigint: true }), identity, "Migration temporary journal");
    requireExpectedJournal(
      parseCanonicalJournalBytes(bytes, paths.journalTemporaryPath),
      expected,
      paths.journalTemporaryPath,
    );
    await executeFileSystemOperation(
      options,
      "recovered-temporary-journal-sync",
      { path: paths.journalTemporaryPath, flags },
      async () => {
        assertOpenedLeafIdentity(await handle.stat({ bigint: true }), identity, "Migration temporary journal");
        await handle.sync();
      },
    );
  } finally {
    await handle.close();
  }
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await assertStableLeafIdentity(identity, "Migration temporary journal");
  return identity;
}

async function safeRemoveOwnedDirectory(path: string, parentIdentity: StableDirectoryChain): Promise<void> {
  await assertStableDirectoryChain(parentIdentity, "Owned migration staging parent");
  const stat = await optionalLstat(path);
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Owned migration staging path is not a real directory: ${path}`);
  const identity = await inspectLeafIdentity(path, "directory", "Owned migration staging path");
  await assertStableDirectoryChain(parentIdentity, "Owned migration staging parent");
  await assertStableLeafIdentity(identity, "Owned migration staging path");
  await assertStableDirectoryChain(parentIdentity, "Owned migration staging parent");
  await assertStableLeafIdentity(identity, "Owned migration staging path");
  await rm(path, { recursive: true });
  await assertStableDirectoryChain(parentIdentity, "Owned migration staging parent");
  await syncDirectory(dirname(path));
}

async function materializeStaging(paths: ResolvedMigrationPaths, legacy: ValidatedLegacyInput): Promise<void> {
  await materializeProjectedSourceTree({
    targetSourceRoot: paths.stagingSourceRoot,
    projection: legacy.projection,
    async resolveAssetBytes(leaf) {
      const asset = legacy.expectedDatabase.assets[leaf.assetId];
      if (!asset) throw new Error(`Projected asset ${leaf.assetId} is missing from migration database`);
      const bytes = legacy.mediaByRuntimePath.get(runtimeAssetFilename(asset));
      if (!bytes) throw new Error(`Legacy media resolver is missing ${leaf.assetId}`);
      return bytes.slice();
    },
  });
}

async function validateExactSourceRoot(
  sourceRoot: string,
  legacy: ValidatedLegacyInput,
): Promise<SourceAssembly> {
  const assembly = await validateSourceTree({ sourceRoot, sourceCommitSha: null });
  if (canonicalStringify(assembly.database) !== canonicalStringify(legacy.expectedDatabase)) {
    throw new Error(`Assembled source database differs from the normalized legacy database at ${sourceRoot}`);
  }
  requireCounts(
    databaseCounts(assembly.database, assembly.sourceAssetOccurrences),
    legacy.report.counts,
    `Assembled source tree ${sourceRoot}`,
  );
  const actualMediaPaths = [...assembly.runtimeMedia.keys()].sort(compareText);
  const expectedMediaPaths = [...legacy.mediaByRuntimePath.keys()].sort(compareText);
  if (canonicalStringify(actualMediaPaths) !== canonicalStringify(expectedMediaPaths)) {
    throw new Error(`Assembled runtime media inventory differs at ${sourceRoot}`);
  }
  for (const path of expectedMediaPaths) {
    if (!sameBytes(assembly.runtimeMedia.get(path)!, legacy.mediaByRuntimePath.get(path)!)) {
      throw new Error(`Assembled runtime media bytes differ for ${path} at ${sourceRoot}`);
    }
  }
  if (noteBodiesSha256(assembly.database) !== legacy.report.noteBodiesSha256) {
    throw new Error(`Assembled note body bytes differ at ${sourceRoot}`);
  }
  const secondProjection = await projectSourceTree(assembly.database);
  if (canonicalStringify(secondProjection.leaves) !== canonicalStringify(legacy.projection.leaves)) {
    throw new Error(`Second source projection differs at ${sourceRoot}`);
  }
  const treeDigest = await sourceTreeSha256(sourceRoot);
  if (treeDigest !== legacy.report.sourceTreeSha256) {
    throw new Error(`Source tree digest differs at ${sourceRoot}: expected ${legacy.report.sourceTreeSha256}, received ${treeDigest}`);
  }
  return assembly;
}

async function callPhase(options: MigrateLibrarySourceOptions, phase: MigrationPhase): Promise<void> {
  await options.afterPhase?.(phase);
}

async function removeJournal(paths: ResolvedMigrationPaths): Promise<void> {
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  const identity = await inspectLeafIdentity(paths.journalPath, "file", "Migration journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await assertStableLeafIdentity(identity, "Migration journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await assertStableLeafIdentity(identity, "Migration journal");
  await unlink(paths.journalPath);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
  await syncDirectory(dirname(paths.journalPath));
}

function reportWithStatus(
  legacy: ValidatedLegacyInput,
  status: MigrationReport["status"],
): MigrationReport {
  return { status, ...legacy.report };
}

export async function migrateLibrarySource(
  options: MigrateLibrarySourceOptions,
): Promise<MigrationReport> {
  const paths = await resolveAndValidatePaths(options);
  const legacy = await validateLegacyInput(paths, options.expectedCounts);
  await callPhase(options, "legacy-validated");
  await assertStableDirectoryChain(paths.outputParentIdentity, "Migration output parent");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");

  const journalStat = await optionalLstat(paths.journalPath);
  const temporaryJournalStat = await optionalLstat(paths.journalTemporaryPath);
  if (journalStat !== null && temporaryJournalStat !== null) {
    throw new Error(`Both final and temporary migration journals exist; preserving both for diagnosis`);
  }

  let journalExists = journalStat !== null;
  let temporaryJournalExists = temporaryJournalStat !== null;
  if (journalExists) {
    requireExpectedJournal(await readJournal(paths.journalPath), legacy.journal, paths.journalPath);
  }
  if (temporaryJournalExists) {
    requireExpectedJournal(await readJournal(paths.journalTemporaryPath), legacy.journal, paths.journalTemporaryPath);
  }

  const targetStat = await optionalLstat(paths.targetSourceRoot);
  if (targetStat !== null) {
    if (!journalExists || temporaryJournalExists) {
      if (temporaryJournalExists) {
        throw new Error(`Target exists while only a temporary migration journal is present; preserving both`);
      }
      try {
        await validateExactSourceRoot(paths.targetSourceRoot, legacy);
      } catch (error) {
        throw new Error(`Existing target differs from expected source tree and will not be replaced: ${errorMessage(error)}`, { cause: error });
      }
      const stagingStat = await optionalLstat(paths.stagingSourceRoot);
      if (stagingStat !== null) {
        await validateExactSourceRoot(paths.stagingSourceRoot, legacy);
        await safeRemoveOwnedDirectory(paths.stagingSourceRoot, paths.outputParentIdentity);
      }
      return reportWithStatus(legacy, "already-applied");
    }

    try {
      await validateExactSourceRoot(paths.targetSourceRoot, legacy);
    } catch (error) {
      throw new Error(`Journaled target is present but invalid/different; preserving target and journal: ${errorMessage(error)}`, { cause: error });
    }
    const stagingStat = await optionalLstat(paths.stagingSourceRoot);
    if (stagingStat !== null) {
      await validateExactSourceRoot(paths.stagingSourceRoot, legacy);
      await safeRemoveOwnedDirectory(paths.stagingSourceRoot, paths.outputParentIdentity);
    }
    await removeJournal(paths);
    await callPhase(options, "journal-removed");
    return reportWithStatus(legacy, "recovered");
  }

  let recovery = journalExists || temporaryJournalExists;
  const stagingStat = await optionalLstat(paths.stagingSourceRoot);
  if (stagingStat !== null) {
    if (journalExists || temporaryJournalExists) {
      try {
        await validateExactSourceRoot(paths.stagingSourceRoot, legacy);
      } catch {
        await safeRemoveOwnedDirectory(paths.stagingSourceRoot, paths.outputParentIdentity);
        await materializeStaging(paths, legacy);
        await callPhase(options, "staging-materialized");
        await validateExactSourceRoot(paths.stagingSourceRoot, legacy);
        await callPhase(options, "staging-validated");
      }
    } else {
      recovery = true;
      await safeRemoveOwnedDirectory(paths.stagingSourceRoot, paths.outputParentIdentity);
      await materializeStaging(paths, legacy);
      await callPhase(options, "staging-materialized");
      await validateExactSourceRoot(paths.stagingSourceRoot, legacy);
      await callPhase(options, "staging-validated");
    }
  } else {
    await materializeStaging(paths, legacy);
    await callPhase(options, "staging-materialized");
    await validateExactSourceRoot(paths.stagingSourceRoot, legacy);
    await callPhase(options, "staging-validated");
  }

  if (temporaryJournalExists) {
    const temporaryIdentity = await validateAndSyncRecoveredTemporaryJournal(paths, legacy.journal, options);
    await assertPathAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Migration journal");
    await executeFileSystemOperation(
      options,
      "temporary-journal-promote",
      { from: paths.journalTemporaryPath, to: paths.journalPath },
      async () => {
        await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
        await assertStableLeafIdentity(temporaryIdentity, "Migration temporary journal");
        await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
        await assertStableLeafIdentity(temporaryIdentity, "Migration temporary journal");
        if (await optionalLstat(paths.journalPath)) {
          throw new Error(`Migration journal appeared before temporary journal promotion: ${paths.journalPath}`);
        }
        await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
        await assertStableLeafIdentity(temporaryIdentity, "Migration temporary journal");
        await rename(paths.journalTemporaryPath, paths.journalPath);
      },
    );
    await executeFileSystemOperation(
      options,
      "journal-parent-sync",
      { path: dirname(paths.journalPath) },
      async () => {
        await assertStableDirectoryChain(paths.journalParentIdentity, "Migration journal parent");
        await syncDirectory(dirname(paths.journalPath));
      },
    );
    requireExpectedJournal(await readJournal(paths.journalPath), legacy.journal, paths.journalPath);
    temporaryJournalExists = false;
    journalExists = true;
    await callPhase(options, "journal-persisted");
  } else if (!journalExists) {
    await writeJournal(paths, legacy.journal);
    journalExists = true;
    await callPhase(options, "journal-persisted");
  }

  await assertPathAbsentUnderStableParent(paths.targetSourceRoot, paths.outputParentIdentity, "Target source root before install");
  const stagingIdentity = await inspectLeafIdentity(paths.stagingSourceRoot, "directory", "Migration staging root");
  await executeFileSystemOperation(
    options,
    "staging-target-install",
    { from: paths.stagingSourceRoot, to: paths.targetSourceRoot },
    async () => {
      await assertStableDirectoryChain(paths.outputParentIdentity, "Migration output parent");
      await assertStableLeafIdentity(stagingIdentity, "Migration staging root");
      await assertPathAbsentUnderStableParent(paths.targetSourceRoot, paths.outputParentIdentity, "Target source root before install");
      await assertStableDirectoryChain(paths.outputParentIdentity, "Migration output parent");
      await assertStableLeafIdentity(stagingIdentity, "Migration staging root");
      await rename(paths.stagingSourceRoot, paths.targetSourceRoot);
    },
  );
  await assertStableDirectoryChain(paths.outputParentIdentity, "Migration output parent");
  await syncDirectory(paths.commonParent);
  await callPhase(options, "target-installed");
  await validateExactSourceRoot(paths.targetSourceRoot, legacy);
  await callPhase(options, "target-validated");
  await removeJournal(paths);
  await callPhase(options, "journal-removed");
  return reportWithStatus(legacy, recovery ? "recovered" : "installed");
}

interface MigrationCliOptions extends MigrateLibrarySourceOptions {}

function parseNonnegativeInteger(value: string | undefined, flag: string): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${flag} requires a nonnegative safe integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${flag} requires a nonnegative safe integer`);
  return number;
}

function parseCliArguments(arguments_: readonly string[]): MigrationCliOptions {
  const values = new Map<string, string>();
  const known = new Set([
    "--library",
    "--media",
    "--target",
    "--journal",
    "--expect-games",
    "--expect-notes",
    "--expect-assets",
    "--expect-occurrences",
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (!known.has(flag)) throw new Error(`Unknown migration argument ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate migration argument ${flag}`);
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  for (const flag of [
    "--library",
    "--media",
    "--target",
    "--expect-games",
    "--expect-notes",
    "--expect-assets",
    "--expect-occurrences",
  ]) {
    if (!values.has(flag)) throw new Error(`Missing required migration argument ${flag}`);
  }
  return {
    legacyLibraryPath: values.get("--library")!,
    legacyMediaRoot: values.get("--media")!,
    targetSourceRoot: values.get("--target")!,
    ...(values.has("--journal") ? { journalPath: values.get("--journal")! } : {}),
    expectedCounts: {
      games: parseNonnegativeInteger(values.get("--expect-games"), "--expect-games"),
      notes: parseNonnegativeInteger(values.get("--expect-notes"), "--expect-notes"),
      uniqueAssets: parseNonnegativeInteger(values.get("--expect-assets"), "--expect-assets"),
      sourceAssetOccurrences: parseNonnegativeInteger(values.get("--expect-occurrences"), "--expect-occurrences"),
    },
  };
}

async function runCli(arguments_: readonly string[]): Promise<void> {
  const report = await migrateLibrarySource(parseCliArguments(arguments_));
  process.stdout.write(`${canonicalStringify(report)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
