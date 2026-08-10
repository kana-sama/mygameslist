/// <reference lib="dom" />

import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import {
  canonicalStringify,
  runtimeAssetFilename,
  sha256Bytes,
} from "../src/domain";
import {
  parsePublishedLibraryEnvelope,
  type SourceAssembly,
} from "../src/source";
import { validateSourceTree } from "./validate-source";

export interface RuntimeArtifactFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface RuntimeArtifactSnapshot {
  libraryJson: Uint8Array;
  media: ReadonlyMap<string, RuntimeArtifactFile>;
}

interface StableIdentity {
  path: string;
  device: bigint;
  inode: bigint;
  kind: "directory" | "file" | "symlink" | "other";
}

interface StableDirectoryChain {
  directory: string;
  entries: readonly StableIdentity[];
}

interface ArtifactInventoryEntry {
  path: string;
  kind: "directory" | "file";
}

interface ArtifactFingerprintFileEntry {
  path: string;
  kind: "file";
  byteLength: number;
  sha256: string;
}

type ArtifactFingerprintEntry =
  | { path: string; kind: "directory" }
  | ArtifactFingerprintFileEntry;

export const ARTIFACT_PROMOTION_PHASES = [
  "staging-validated",
  "journal-persisted",
  "previous-backed-up",
  "staging-promoted",
  "promoted-validated",
  "backup-removed",
  "journal-removed",
] as const;

export type ArtifactPromotionPhase = (typeof ARTIFACT_PROMOTION_PHASES)[number];

export interface PromotionOptions {
  stagingRoot: string;
  outputRoot: string;
  expected: SourceAssembly;
  journalPath?: string;
  afterPhase?: (phase: ArtifactPromotionPhase) => void | Promise<void>;
}

export interface PromotionRecoveryOptions {
  outputRoot: string;
  journalPath?: string;
}

interface ArtifactPromotionJournalV1 {
  version: 1;
  operation: "promote-artifact-root";
  operationId: string;
  outputRoot: string;
  stagingRoot: string;
  backupRoot: string;
  recoveryRoot: string;
  newRootSha256: string;
  previousRootSha256: string | null;
}

interface PromotionPaths {
  outputRoot: string;
  outputParent: string;
  stagingRoot: string;
  backupRoot: string;
  recoveryRoot: string;
  journalPath: string;
  journalTemporaryPath: string;
  operationId: string;
  outputParentIdentity: StableDirectoryChain;
  journalParentIdentity: StableDirectoryChain;
  authoritativeJournal?: {
    identity: StableIdentity;
    bytes: Uint8Array;
  };
  beforeJournalRemoval?: (journalPath: string) => void | Promise<void>;
}

interface InternalPromotionRecoveryOptions {
  beforeJournalRemoval?: (journalPath: string) => void | Promise<void>;
}

interface InternalPromotionOptions {
  rootIdentityForAliasCheck?: (path: string) => Promise<RootAliasIdentity>;
}

interface RootState {
  exists: boolean;
  identity?: StableIdentity;
  fingerprint?: string;
  fingerprintError?: Error;
}

interface RootAliasIdentity {
  device: bigint;
  inode: bigint;
}

interface InternalBuildArtifactDataOptions {
  rootIdentityForAliasCheck?: (path: string) => Promise<RootAliasIdentity>;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function resolveNonRoot(input: string, label: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error(`${label} must be a nonempty path`);
  if (input.includes("\0")) throw new Error(`${label} contains NUL`);
  const path = resolve(input);
  if (path === parse(path).root) throw new Error(`${label} must not be a filesystem root: ${path}`);
  return path;
}

function pathsOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  return leftToRight !== "" && !leftToRight.startsWith(`..${sep}`) && leftToRight !== ".." && !parse(leftToRight).root
    || rightToLeft !== "" && !rightToLeft.startsWith(`..${sep}`) && rightToLeft !== ".." && !parse(rightToLeft).root;
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(`Cannot inspect ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

function identityKind(stat: BigIntStats): StableIdentity["kind"] {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

async function inspectRawIdentity(path: string, label: string): Promise<StableIdentity> {
  let stat: BigIntStats;
  try {
    stat = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error(`Cannot inspect ${label} ${path}: ${errorMessage(error)}`, { cause: error });
  }
  return { path, device: stat.dev, inode: stat.ino, kind: identityKind(stat) };
}

async function inspectIdentity(path: string, label: string): Promise<StableIdentity> {
  const identity = await inspectRawIdentity(path, label);
  if (identity.kind === "symlink") throw new Error(`${label} is a symlink: ${path}`);
  return identity;
}

async function inspectDirectoryIdentity(path: string, label: string): Promise<StableIdentity> {
  const identity = await inspectIdentity(path, label);
  if (identity.kind !== "directory") throw new Error(`${label} must be a real directory: ${path}`);
  return identity;
}

async function assertSameIdentity(expected: StableIdentity, label: string): Promise<void> {
  let actual: StableIdentity;
  try {
    actual = await inspectIdentity(expected.path, label);
  } catch (error) {
    throw new Error(`${label} identity changed at ${expected.path}: ${errorMessage(error)}`, { cause: error });
  }
  if (
    actual.device !== expected.device
    || actual.inode !== expected.inode
    || actual.kind !== expected.kind
  ) {
    throw new Error(`${label} identity changed at ${expected.path}`);
  }
}

async function assertSameRawIdentity(expected: StableIdentity, label: string): Promise<void> {
  let actual: StableIdentity;
  try {
    actual = await inspectRawIdentity(expected.path, label);
  } catch (error) {
    throw new Error(`${label} identity changed at ${expected.path}: ${errorMessage(error)}`, { cause: error });
  }
  if (
    actual.device !== expected.device
    || actual.inode !== expected.inode
    || actual.kind !== expected.kind
  ) {
    throw new Error(`${label} identity changed at ${expected.path}`);
  }
}

async function assertRealDirectoryChain(path: string, label: string): Promise<void> {
  const root = parse(path).root;
  const segments = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  await inspectDirectoryIdentity(current, `${label} component`);
  for (const segment of segments) {
    current = join(current, segment);
    await inspectDirectoryIdentity(current, `${label} component`);
  }
}

async function captureStableDirectoryChain(path: string, label: string): Promise<StableDirectoryChain> {
  const root = parse(path).root;
  const segments = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  const entries: StableIdentity[] = [];
  let current = root;
  entries.push(await inspectDirectoryIdentity(current, `${label} component`));
  for (const segment of segments) {
    current = join(current, segment);
    entries.push(await inspectDirectoryIdentity(current, `${label} component`));
  }
  return { directory: path, entries };
}

async function assertStableDirectoryChain(chain: StableDirectoryChain, label: string): Promise<void> {
  for (const entry of chain.entries) await assertSameIdentity(entry, `${label} component`);
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(errorCode(error) ?? "")) throw error;
  } finally {
    await handle?.close();
  }
}

async function readExactRegularFile(path: string, label: string): Promise<Uint8Array> {
  const identity = await inspectIdentity(path, label);
  if (identity.kind !== "file") throw new Error(`${label} must be a regular file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== identity.device || opened.ino !== identity.inode) {
      throw new Error(`${label} identity changed while opening ${path}`);
    }
    const bytes = Uint8Array.from(await handle.readFile());
    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || after.dev !== identity.device || after.ino !== identity.inode) {
      throw new Error(`${label} identity changed while reading ${path}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function writeExclusiveFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "wx", 0o644);
  try {
    await handle.chmod(0o644);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function requireExactKeys(actual: readonly string[], expected: readonly string[], label: string): void {
  const sortedActual = [...actual].sort(compareText);
  const sortedExpected = [...expected].sort(compareText);
  if (canonicalStringify(sortedActual) !== canonicalStringify(sortedExpected)) {
    throw new Error(`${label} has wrong entries: expected ${sortedExpected.join(", ") || "<empty>"}, received ${sortedActual.join(", ") || "<empty>"}`);
  }
}

export function createRuntimeArtifactSnapshot(
  assembly: SourceAssembly,
): RuntimeArtifactSnapshot {
  const envelope = parsePublishedLibraryEnvelope(assembly.envelope);
  if (
    canonicalStringify(envelope.database) !== canonicalStringify(assembly.database)
    || canonicalStringify(envelope) !== canonicalStringify(assembly.envelope)
  ) {
    throw new Error("Source assembly database and envelope disagree");
  }

  const expected = Object.values(envelope.database.assets)
    .map((asset) => ({ asset, filename: runtimeAssetFilename(asset) }))
    .sort((left, right) => compareText(left.filename, right.filename));
  requireExactKeys([...assembly.runtimeMedia.keys()], expected.map(({ filename }) => filename), "Assembly runtime media");

  const media = new Map<string, RuntimeArtifactFile>();
  for (const { asset, filename } of expected) {
    const sourceBytes = assembly.runtimeMedia.get(filename);
    if (!(sourceBytes instanceof Uint8Array)) throw new Error(`Assembly runtime media is missing bytes for ${filename}`);
    const bytes = Uint8Array.from(sourceBytes);
    if (bytes.byteLength !== asset.byteLength) {
      throw new Error(`Runtime media byteLength mismatch for ${filename}: expected ${asset.byteLength}, received ${bytes.byteLength}`);
    }
    const actualSha = sha256Bytes(bytes);
    if (actualSha !== asset.id) throw new Error(`Runtime media SHA mismatch for ${filename}: expected ${asset.id}, received ${actualSha}`);
    media.set(filename, {
      bytes,
      contentType: asset.kind === "image" ? "image/webp" : asset.mime,
    });
  }

  return {
    libraryJson: textEncoder.encode(`${canonicalStringify(envelope)}\n`),
    media,
  };
}

async function enumerateArtifactRoot(root: string): Promise<readonly ArtifactInventoryEntry[]> {
  const rootIdentity = await inspectDirectoryIdentity(root, "Artifact root");
  const entries: ArtifactInventoryEntry[] = [];

  const visit = async (directory: string, logicalDirectory: string): Promise<void> => {
    const before = await inspectDirectoryIdentity(directory, `Artifact directory ${logicalDirectory || "."}`);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      throw new Error(`Cannot enumerate artifact directory ${directory}: ${errorMessage(error)}`, { cause: error });
    }
    names.sort(compareText);
    await assertSameIdentity(before, `Artifact directory ${logicalDirectory || "."}`);
    for (const name of names) {
      const physicalPath = join(directory, name);
      const logicalPath = logicalDirectory === "" ? name : `${logicalDirectory}/${name}`;
      let stat: BigIntStats;
      try {
        stat = await lstat(physicalPath, { bigint: true });
      } catch (error) {
        throw new Error(`Cannot inspect artifact entry ${logicalPath} at ${physicalPath}: ${errorMessage(error)}`, { cause: error });
      }
      if (stat.isSymbolicLink()) throw new Error(`Artifact entry must not be a symlink: ${physicalPath}`);
      if (stat.isDirectory()) {
        entries.push({ path: logicalPath, kind: "directory" });
        await visit(physicalPath, logicalPath);
      } else if (stat.isFile()) {
        entries.push({ path: logicalPath, kind: "file" });
      } else {
        throw new Error(`Artifact entry has unsupported kind: ${physicalPath}`);
      }
    }
    await assertSameIdentity(before, `Artifact directory ${logicalDirectory || "."}`);
  };

  await visit(root, "");
  await assertSameIdentity(rootIdentity, "Artifact root");
  return entries.sort((left, right) => compareText(left.path, right.path));
}

async function fingerprintArtifactRoot(root: string): Promise<string> {
  const rootIdentity = await inspectDirectoryIdentity(root, "Artifact fingerprint root");
  const inventory = await enumerateArtifactRoot(root);
  const entries: ArtifactFingerprintEntry[] = [];
  for (const entry of inventory) {
    if (entry.kind === "directory") {
      entries.push({ path: entry.path, kind: "directory" });
      continue;
    }
    await assertSameIdentity(rootIdentity, "Artifact fingerprint root");
    const bytes = await readExactRegularFile(join(root, ...entry.path.split("/")), `Artifact fingerprint file ${entry.path}`);
    entries.push({
      path: entry.path,
      kind: "file",
      byteLength: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    });
  }
  await assertSameIdentity(rootIdentity, "Artifact fingerprint root");
  return sha256Bytes(textEncoder.encode(canonicalStringify(entries)));
}

async function flushArtifactRoot(root: string): Promise<void> {
  const rootIdentity = await inspectDirectoryIdentity(root, "Artifact durability root");
  const inventory = await enumerateArtifactRoot(root);
  for (const entry of inventory) {
    if (entry.kind !== "file") continue;
    await assertSameIdentity(rootIdentity, "Artifact durability root");
    const path = join(root, ...entry.path.split("/"));
    const identity = await inspectIdentity(path, `Artifact file ${entry.path}`);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== identity.device || opened.ino !== identity.inode) {
        throw new Error(`Artifact file identity changed while flushing ${path}`);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  const directories = [
    ...inventory.filter((entry) => entry.kind === "directory").map((entry) => join(root, ...entry.path.split("/"))),
    root,
  ].sort((left, right) => right.split(sep).length - left.split(sep).length || compareText(left, right));
  for (const directory of directories) await syncDirectory(directory);
  await assertSameIdentity(rootIdentity, "Artifact durability root");
}

export async function validateArtifactRoot(
  rootInput: string,
  expected: SourceAssembly,
): Promise<void> {
  const root = resolveNonRoot(rootInput, "Artifact root");
  const rootIdentity = await inspectDirectoryIdentity(root, "Artifact root");
  const snapshot = createRuntimeArtifactSnapshot(expected);
  const entries = await enumerateArtifactRoot(root);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  if (byPath.get("index.html")?.kind !== "file") {
    throw new Error(`Artifact root must contain regular application shell entry ${join(root, "index.html")}`);
  }
  if (byPath.get("data")?.kind !== "directory") throw new Error(`Artifact data must be a real directory: ${join(root, "data")}`);
  if (byPath.get("media")?.kind !== "directory") throw new Error(`Artifact media must be a real directory: ${join(root, "media")}`);

  const dataChildren = entries
    .filter((entry) => entry.path.startsWith("data/"))
    .map((entry) => `${entry.path}:${entry.kind}`);
  requireExactKeys(dataChildren, ["data/library.json:file"], `Artifact data namespace ${join(root, "data")}`);

  const expectedMediaNames = [...snapshot.media.keys()].sort(compareText);
  const mediaChildren = entries
    .filter((entry) => entry.path.startsWith("media/"))
    .map((entry) => `${entry.path.slice("media/".length)}:${entry.kind}`);
  requireExactKeys(
    mediaChildren,
    expectedMediaNames.map((name) => `${name}:file`),
    `Artifact media namespace ${join(root, "media")}`,
  );

  const libraryPath = join(root, "data", "library.json");
  await assertSameIdentity(rootIdentity, "Artifact root");
  const libraryBytes = await readExactRegularFile(libraryPath, "Artifact library JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(libraryBytes));
  } catch (error) {
    throw new Error(`Artifact library JSON is not canonical UTF-8 JSON at ${libraryPath}: ${errorMessage(error)}`, { cause: error });
  }
  let envelope: ReturnType<typeof parsePublishedLibraryEnvelope>;
  try {
    envelope = parsePublishedLibraryEnvelope(parsed);
  } catch (error) {
    throw new Error(`Artifact library envelope is invalid at ${libraryPath}: ${errorMessage(error)}`, { cause: error });
  }
  if (canonicalStringify(envelope) !== canonicalStringify(expected.envelope)) {
    throw new Error(`Artifact library envelope differs from expected assembly at ${libraryPath}`);
  }
  if (!sameBytes(libraryBytes, snapshot.libraryJson)) {
    throw new Error(`Artifact library JSON bytes differ from the canonical snapshot at ${libraryPath}`);
  }

  for (const [filename, artifact] of snapshot.media) {
    await assertSameIdentity(rootIdentity, "Artifact root");
    const path = join(root, "media", filename);
    const bytes = await readExactRegularFile(path, `Artifact media ${filename}`);
    if (!sameBytes(bytes, artifact.bytes)) throw new Error(`Artifact media bytes differ at ${path}`);
  }
  await assertSameIdentity(rootIdentity, "Artifact root");
}

async function removeOwnedNamespace(
  stagingRoot: string,
  stagingIdentity: StableIdentity,
  stagingChain: StableDirectoryChain,
  name: "data" | "media",
): Promise<void> {
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(stagingIdentity, "Artifact staging root");
  const path = join(stagingRoot, name);
  const stat = await optionalLstat(path);
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  if (stat === null) return;
  const leaf = await inspectRawIdentity(path, `Owned artifact ${name} namespace`);
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(stagingIdentity, "Artifact staging root");
  await assertSameRawIdentity(leaf, `Owned artifact ${name} namespace`);
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(stagingIdentity, "Artifact staging root");
  await assertSameRawIdentity(leaf, `Owned artifact ${name} namespace`);
  if (leaf.kind === "directory") await rm(path, { recursive: true });
  else await unlink(path);
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(stagingIdentity, "Artifact staging root");
  await syncDirectory(stagingRoot);
}

export function buildArtifactData(
  sourceRootInput: string,
  stagingRootInput: string,
  sourceCommitSha: string | null,
): Promise<SourceAssembly>;
export async function buildArtifactData(
  sourceRootInput: string,
  stagingRootInput: string,
  sourceCommitSha: string | null,
  internal: InternalBuildArtifactDataOptions = {},
): Promise<SourceAssembly> {
  const sourceRoot = resolveNonRoot(sourceRootInput, "Source root");
  const stagingRoot = resolveNonRoot(stagingRootInput, "Artifact staging root");
  if (pathsOverlap(sourceRoot, stagingRoot)) throw new Error(`Source and artifact staging roots overlap: ${sourceRoot} and ${stagingRoot}`);
  const sourceChain = await captureStableDirectoryChain(sourceRoot, "Source root");
  const stagingChain = await captureStableDirectoryChain(stagingRoot, "Artifact staging root");
  const sourceIdentity = sourceChain.entries[sourceChain.entries.length - 1];
  const stagingIdentity = stagingChain.entries[stagingChain.entries.length - 1];
  const [sourceAliasIdentity, stagingAliasIdentity] = internal.rootIdentityForAliasCheck === undefined
    ? [
      { device: sourceIdentity.device, inode: sourceIdentity.inode },
      { device: stagingIdentity.device, inode: stagingIdentity.inode },
    ]
    : await Promise.all([
      internal.rootIdentityForAliasCheck(sourceRoot),
      internal.rootIdentityForAliasCheck(stagingRoot),
    ]);
  if (
    sourceAliasIdentity.device === stagingAliasIdentity.device
    && sourceAliasIdentity.inode === stagingAliasIdentity.inode
  ) {
    throw new Error(`Source and artifact staging roots have the same filesystem identity and alias each other: ${sourceRoot} and ${stagingRoot}`);
  }
  const [sourceReal, stagingReal] = await Promise.all([realpath(sourceRoot), realpath(stagingRoot)]);
  if (pathsOverlap(sourceReal, stagingReal)) throw new Error(`Source and artifact staging roots alias or overlap: ${sourceReal} and ${stagingReal}`);

  const assembly = await validateSourceTree({ sourceRoot, sourceCommitSha });
  const snapshot = createRuntimeArtifactSnapshot(assembly);
  await assertStableDirectoryChain(sourceChain, "Source root");
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await removeOwnedNamespace(stagingRoot, stagingIdentity, stagingChain, "data");
  await removeOwnedNamespace(stagingRoot, stagingIdentity, stagingChain, "media");

  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(stagingIdentity, "Artifact staging root");
  await mkdir(join(stagingRoot, "data"), { mode: 0o755 });
  await chmod(join(stagingRoot, "data"), 0o755);
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await mkdir(join(stagingRoot, "media"), { mode: 0o755 });
  await chmod(join(stagingRoot, "media"), 0o755);
  const dataIdentity = await inspectDirectoryIdentity(join(stagingRoot, "data"), "Artifact data namespace");
  const mediaIdentity = await inspectDirectoryIdentity(join(stagingRoot, "media"), "Artifact media namespace");
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(dataIdentity, "Artifact data namespace");
  await writeExclusiveFile(join(stagingRoot, "data", "library.json"), snapshot.libraryJson);
  for (const [filename, artifact] of snapshot.media) {
    await assertStableDirectoryChain(stagingChain, "Artifact staging root");
    await assertSameIdentity(mediaIdentity, "Artifact media namespace");
    await writeExclusiveFile(join(stagingRoot, "media", filename), artifact.bytes);
  }
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  await assertSameIdentity(dataIdentity, "Artifact data namespace");
  await assertSameIdentity(mediaIdentity, "Artifact media namespace");
  await syncDirectory(join(stagingRoot, "data"));
  await syncDirectory(join(stagingRoot, "media"));
  await syncDirectory(stagingRoot);
  await validateArtifactRoot(stagingRoot, assembly);
  await assertStableDirectoryChain(stagingChain, "Artifact staging root");
  return assembly;
}

function defaultPromotionJournalPath(outputRoot: string): string {
  return join(dirname(outputRoot), `.${basename(outputRoot)}.mygameslist-artifact-promotion.json`);
}

function promotionTemporaryJournalPath(journalPath: string): string {
  return journalPath.endsWith(".json") ? `${journalPath.slice(0, -5)}.tmp` : `${journalPath}.tmp`;
}

function operationRootPath(outputRoot: string, role: "staging" | "backup" | "recovery", operationId: string): string {
  return join(dirname(outputRoot), `.${basename(outputRoot)}.mygameslist-artifact-${role}-${operationId}`);
}

function operationIdFromStaging(outputRoot: string, stagingRoot: string): string {
  if (dirname(stagingRoot) !== dirname(outputRoot)) {
    throw new Error(`Artifact staging and output roots must share one parent: ${stagingRoot} and ${outputRoot}`);
  }
  const prefix = `.${basename(outputRoot)}.mygameslist-artifact-staging-`;
  const stagingName = basename(stagingRoot);
  if (!stagingName.startsWith(prefix)) throw new Error(`Artifact staging root has a malformed operation-owned name: ${stagingRoot}`);
  const operationId = stagingName.slice(prefix.length);
  if (!UUID.test(operationId)) throw new Error(`Artifact staging root has an invalid operation UUID: ${stagingRoot}`);
  return operationId;
}

async function resolvePromotionPaths(
  outputRootInput: string,
  operationId: string,
  journalPathInput?: string,
): Promise<PromotionPaths> {
  const outputRoot = resolveNonRoot(outputRootInput, "Artifact output root");
  if (!UUID.test(operationId)) throw new Error(`Artifact promotion operation ID is not a canonical UUID: ${operationId}`);
  const outputParent = dirname(outputRoot);
  const stagingRoot = operationRootPath(outputRoot, "staging", operationId);
  const backupRoot = operationRootPath(outputRoot, "backup", operationId);
  const recoveryRoot = operationRootPath(outputRoot, "recovery", operationId);
  const journalPath = journalPathInput === undefined
    ? defaultPromotionJournalPath(outputRoot)
    : resolveNonRoot(journalPathInput, "Artifact promotion journal");
  const journalTemporaryPath = promotionTemporaryJournalPath(journalPath);
  for (const [path, label] of [
    [stagingRoot, "Artifact staging root"],
    [backupRoot, "Artifact backup root"],
    [recoveryRoot, "Artifact recovery root"],
    [journalTemporaryPath, "Artifact temporary promotion journal"],
  ] as const) resolveNonRoot(path, label);

  const movedRoots = [outputRoot, stagingRoot, backupRoot, recoveryRoot];
  for (let left = 0; left < movedRoots.length; left += 1) {
    for (let right = left + 1; right < movedRoots.length; right += 1) {
      if (pathsOverlap(movedRoots[left], movedRoots[right])) {
        throw new Error(`Artifact promotion roots overlap: ${movedRoots[left]} and ${movedRoots[right]}`);
      }
    }
  }
  for (const journal of [journalPath, journalTemporaryPath]) {
    for (const root of movedRoots) {
      if (pathsOverlap(journal, root)) throw new Error(`Artifact promotion journal ${journal} overlaps moved root ${root}`);
    }
  }
  if (journalPath === journalTemporaryPath) throw new Error("Artifact final and temporary journal paths must differ");

  const outputParentIdentity = await captureStableDirectoryChain(outputParent, "Artifact output parent");
  const journalParentIdentity = await captureStableDirectoryChain(dirname(journalPath), "Artifact journal parent");
  return {
    outputRoot,
    outputParent,
    stagingRoot,
    backupRoot,
    recoveryRoot,
    journalPath,
    journalTemporaryPath,
    operationId,
    outputParentIdentity,
    journalParentIdentity,
  };
}

async function resolveNewPromotionPaths(options: PromotionOptions): Promise<PromotionPaths> {
  const outputRoot = resolveNonRoot(options.outputRoot, "Artifact output root");
  const stagingRoot = resolveNonRoot(options.stagingRoot, "Artifact staging root");
  const operationId = operationIdFromStaging(outputRoot, stagingRoot);
  const paths = await resolvePromotionPaths(outputRoot, operationId, options.journalPath);
  if (paths.stagingRoot !== stagingRoot) throw new Error(`Artifact staging root does not match its operation ID: ${stagingRoot}`);
  return paths;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  requireExactKeys(Object.keys(record), expected, label);
}

function parsePromotionJournalBytes(
  bytes: Uint8Array,
  knownJournalPath: string,
): ArtifactPromotionJournalV1 {
  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new Error(`Artifact promotion journal is not canonical UTF-8 JSON at ${knownJournalPath}: ${errorMessage(error)}`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Artifact promotion journal must be an object: ${knownJournalPath}`);
  }
  const record = value as Record<string, unknown>;
  exactKeys(record, [
    "version",
    "operation",
    "operationId",
    "outputRoot",
    "stagingRoot",
    "backupRoot",
    "recoveryRoot",
    "newRootSha256",
    "previousRootSha256",
  ], `Artifact promotion journal ${knownJournalPath}`);
  if (record.version !== 1 || record.operation !== "promote-artifact-root") {
    throw new Error(`Artifact promotion journal has an unsupported version or operation: ${knownJournalPath}`);
  }
  if (typeof record.operationId !== "string" || !UUID.test(record.operationId)) {
    throw new Error(`Artifact promotion journal has an invalid operation ID: ${knownJournalPath}`);
  }
  for (const key of ["outputRoot", "stagingRoot", "backupRoot", "recoveryRoot"] as const) {
    if (typeof record[key] !== "string" || resolve(record[key]) !== record[key]) {
      throw new Error(`Artifact promotion journal ${key} must be an absolute resolved path: ${knownJournalPath}`);
    }
  }
  if (typeof record.newRootSha256 !== "string" || !SHA256.test(record.newRootSha256)) {
    throw new Error(`Artifact promotion journal has an invalid new-root fingerprint: ${knownJournalPath}`);
  }
  if (record.previousRootSha256 !== null && (typeof record.previousRootSha256 !== "string" || !SHA256.test(record.previousRootSha256))) {
    throw new Error(`Artifact promotion journal has an invalid previous-root fingerprint: ${knownJournalPath}`);
  }
  const canonicalBytes = textEncoder.encode(`${canonicalStringify(record)}\n`);
  if (!sameBytes(bytes, canonicalBytes)) {
    throw new Error(`Artifact promotion journal is noncanonical, ambiguous, or contains duplicate keys: ${knownJournalPath}`);
  }
  return record as unknown as ArtifactPromotionJournalV1;
}

async function readPromotionJournalAt(
  outputRootInput: string,
  journalPathInput: string | undefined,
  readPathInput?: string,
): Promise<{ journal: ArtifactPromotionJournalV1; paths: PromotionPaths }> {
  const outputRoot = resolveNonRoot(outputRootInput, "Artifact output root");
  const journalPath = journalPathInput === undefined
    ? defaultPromotionJournalPath(outputRoot)
    : resolveNonRoot(journalPathInput, "Artifact promotion journal");
  const readPath = readPathInput === undefined
    ? journalPath
    : resolveNonRoot(readPathInput, "Artifact promotion journal source");
  const identity = await inspectIdentity(readPath, "Artifact promotion journal");
  if (identity.kind !== "file") throw new Error(`Artifact promotion journal must be a regular file: ${readPath}`);
  const bytes = await readExactRegularFile(readPath, "Artifact promotion journal");
  const journal = parsePromotionJournalBytes(bytes, readPath);
  const paths = await resolvePromotionPaths(outputRoot, journal.operationId, journalPath);
  for (const [actual, expected, label] of [
    [journal.outputRoot, paths.outputRoot, "outputRoot"],
    [journal.stagingRoot, paths.stagingRoot, "stagingRoot"],
    [journal.backupRoot, paths.backupRoot, "backupRoot"],
    [journal.recoveryRoot, paths.recoveryRoot, "recoveryRoot"],
  ] as const) {
    if (actual !== expected) throw new Error(`Artifact promotion journal ${label} does not match independently resolved path at ${readPath}`);
  }
  paths.authoritativeJournal = { identity, bytes: Uint8Array.from(bytes) };
  return { journal, paths };
}

async function readPromotionJournal(
  outputRootInput: string,
  journalPathInput?: string,
): Promise<{ journal: ArtifactPromotionJournalV1; paths: PromotionPaths }> {
  return readPromotionJournalAt(outputRootInput, journalPathInput);
}

async function assertAbsentUnderStableParent(
  path: string,
  parentIdentity: StableDirectoryChain,
  label: string,
): Promise<void> {
  await assertStableDirectoryChain(parentIdentity, label);
  const stat = await optionalLstat(path);
  await assertStableDirectoryChain(parentIdentity, label);
  if (stat !== null) throw new Error(`${label} must not exist: ${path}`);
}

async function writePromotionJournal(paths: PromotionPaths, journal: ArtifactPromotionJournalV1): Promise<void> {
  await assertAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Artifact promotion journal");
  await assertAbsentUnderStableParent(paths.journalTemporaryPath, paths.journalParentIdentity, "Artifact temporary promotion journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  const handle = await open(paths.journalTemporaryPath, "wx", 0o644);
  try {
    await handle.chmod(0o644);
    await handle.writeFile(`${canonicalStringify(journal)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const temporaryIdentity = await inspectIdentity(paths.journalTemporaryPath, "Artifact temporary promotion journal");
  if (temporaryIdentity.kind !== "file") throw new Error(`Artifact temporary promotion journal must be a regular file: ${paths.journalTemporaryPath}`);
  await assertAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Artifact promotion journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await assertSameIdentity(temporaryIdentity, "Artifact temporary promotion journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await assertSameIdentity(temporaryIdentity, "Artifact temporary promotion journal");
  await rename(paths.journalTemporaryPath, paths.journalPath);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await syncDirectory(dirname(paths.journalPath));
  const readBack = await readPromotionJournal(paths.outputRoot, paths.journalPath);
  if (canonicalStringify(readBack.journal) !== canonicalStringify(journal)) {
    throw new Error(`Artifact promotion journal readback differs at ${paths.journalPath}`);
  }
  paths.authoritativeJournal = readBack.paths.authoritativeJournal;
}

async function promoteRecoveredTemporaryJournal(
  outputRoot: string,
  journalPath: string,
  temporaryJournalPath: string,
): Promise<void> {
  const recovered = await readPromotionJournalAt(outputRoot, journalPath, temporaryJournalPath);
  const paths = recovered.paths;
  if (paths.journalTemporaryPath !== temporaryJournalPath) {
    throw new Error(`Temporary artifact promotion journal has an unexpected stable path: ${temporaryJournalPath}`);
  }
  const temporary = paths.authoritativeJournal;
  if (temporary === undefined) throw new Error(`Temporary artifact promotion journal was not captured: ${temporaryJournalPath}`);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await assertSameIdentity(temporary.identity, "Artifact temporary promotion journal");
  const bytesBeforePromotion = await readExactRegularFile(temporaryJournalPath, "Artifact temporary promotion journal");
  if (!sameBytes(bytesBeforePromotion, temporary.bytes)) {
    throw new Error(`Temporary artifact promotion journal changed before recovery: ${temporaryJournalPath}`);
  }
  const handle = await open(temporaryJournalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile()
      || opened.dev !== temporary.identity.device
      || opened.ino !== temporary.identity.inode
    ) {
      throw new Error(`Temporary artifact promotion journal identity changed while opening ${temporaryJournalPath}`);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertAbsentUnderStableParent(journalPath, paths.journalParentIdentity, "Artifact promotion journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await assertSameIdentity(temporary.identity, "Artifact temporary promotion journal");
  await rename(temporaryJournalPath, journalPath);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await syncDirectory(dirname(journalPath));
  const final = await readPromotionJournal(outputRoot, journalPath);
  if (canonicalStringify(final.journal) !== canonicalStringify(recovered.journal)) {
    throw new Error(`Recovered artifact promotion journal changed during installation: ${journalPath}`);
  }
}

async function renameLeafUnderStableParent(
  source: string,
  destination: string,
  parentIdentity: StableDirectoryChain,
  label: string,
  requiredKind?: StableIdentity["kind"],
): Promise<void> {
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  const sourceIdentity = await inspectRawIdentity(source, label);
  if (requiredKind !== undefined && sourceIdentity.kind !== requiredKind) {
    throw new Error(`${label} has wrong kind at ${source}: expected ${requiredKind}, received ${sourceIdentity.kind}`);
  }
  await assertAbsentUnderStableParent(destination, parentIdentity, `${label} destination`);
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  await assertSameRawIdentity(sourceIdentity, label);
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  await assertSameRawIdentity(sourceIdentity, label);
  await rename(source, destination);
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  await syncDirectory(parentIdentity.directory);
}

async function rootState(path: string): Promise<RootState> {
  const stat = await optionalLstat(path);
  if (stat === null) return { exists: false };
  let identity: StableIdentity;
  try {
    identity = await inspectRawIdentity(path, "Artifact promotion root");
  } catch (error) {
    return { exists: true, fingerprintError: error instanceof Error ? error : new Error(String(error)) };
  }
  if (identity.kind !== "directory") {
    return { exists: true, identity, fingerprintError: new Error(`Artifact promotion root is ${identity.kind}: ${path}`) };
  }
  try {
    return { exists: true, identity, fingerprint: await fingerprintArtifactRoot(path) };
  } catch (error) {
    return { exists: true, identity, fingerprintError: error instanceof Error ? error : new Error(String(error)) };
  }
}

function isExactRoot(state: RootState, fingerprint: string | null): boolean {
  return fingerprint !== null && state.exists && state.fingerprint === fingerprint;
}

async function removeExactRoot(
  path: string,
  expectedFingerprint: string,
  parentIdentity: StableDirectoryChain,
  label: string,
): Promise<void> {
  const actual = await fingerprintArtifactRoot(path);
  if (actual !== expectedFingerprint) throw new Error(`${label} fingerprint changed at ${path}`);
  const identity = await inspectDirectoryIdentity(path, label);
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  await assertSameIdentity(identity, label);
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  await assertSameIdentity(identity, label);
  await rm(path, { recursive: true });
  await assertStableDirectoryChain(parentIdentity, `${label} parent`);
  await syncDirectory(parentIdentity.directory);
}

async function removePromotionJournal(paths: PromotionPaths): Promise<void> {
  const authoritative = paths.authoritativeJournal;
  if (authoritative === undefined) {
    throw new Error(`Artifact promotion journal has no validated identity: ${paths.journalPath}`);
  }
  await paths.beforeJournalRemoval?.(paths.journalPath);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  const identity = await inspectIdentity(paths.journalPath, "Artifact promotion journal");
  if (identity.kind !== "file") throw new Error(`Artifact promotion journal must be a regular file: ${paths.journalPath}`);
  if (
    identity.device !== authoritative.identity.device
    || identity.inode !== authoritative.identity.inode
  ) {
    throw new Error(`Artifact promotion journal identity changed before removal: ${paths.journalPath}`);
  }
  const bytes = await readExactRegularFile(paths.journalPath, "Artifact promotion journal");
  if (!sameBytes(bytes, authoritative.bytes)) {
    throw new Error(`Artifact promotion journal bytes changed before removal: ${paths.journalPath}`);
  }
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await assertSameIdentity(identity, "Artifact promotion journal");
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await assertSameIdentity(identity, "Artifact promotion journal");
  await unlink(paths.journalPath);
  await assertStableDirectoryChain(paths.journalParentIdentity, "Artifact journal parent");
  await syncDirectory(dirname(paths.journalPath));
}

async function callPromotionPhase(options: PromotionOptions, phase: ArtifactPromotionPhase): Promise<void> {
  await options.afterPhase?.(phase);
}

async function finishRecoveredPromotion(
  paths: PromotionPaths,
  journal: ArtifactPromotionJournalV1,
): Promise<void> {
  const outputFingerprint = await fingerprintArtifactRoot(paths.outputRoot);
  if (outputFingerprint !== journal.newRootSha256) {
    throw new Error(`Recovered artifact output fingerprint differs at ${paths.outputRoot}`);
  }
  const backupState = await rootState(paths.backupRoot);
  if (backupState.exists) {
    if (journal.previousRootSha256 === null || backupState.fingerprint !== journal.previousRootSha256) {
      throw new Error(`Artifact backup cannot be proven before removal: ${paths.backupRoot}`);
    }
    await removeExactRoot(
      paths.backupRoot,
      journal.previousRootSha256,
      paths.outputParentIdentity,
      "Artifact backup root",
    );
  }
  await removePromotionJournal(paths);
}

export async function recoverArtifactPromotion(
  options: PromotionRecoveryOptions,
): Promise<void> {
  const internal = options as PromotionRecoveryOptions & InternalPromotionRecoveryOptions;
  const outputRoot = resolveNonRoot(options.outputRoot, "Artifact output root");
  const journalPath = options.journalPath === undefined
    ? defaultPromotionJournalPath(outputRoot)
    : resolveNonRoot(options.journalPath, "Artifact promotion journal");
  const temporaryJournalPath = promotionTemporaryJournalPath(journalPath);
  const finalStat = await optionalLstat(journalPath);
  const temporaryStat = await optionalLstat(temporaryJournalPath);
  if (finalStat === null && temporaryStat === null) return;
  if (finalStat !== null && temporaryStat !== null) {
    throw new Error(`Both final and temporary artifact promotion journals exist; preserving both for diagnosis`);
  }
  if (finalStat === null) {
    await promoteRecoveredTemporaryJournal(outputRoot, journalPath, temporaryJournalPath);
  }

  const { journal, paths } = await readPromotionJournal(outputRoot, journalPath);
  paths.beforeJournalRemoval = internal.beforeJournalRemoval;
  const [output, staging, backup, recovery] = await Promise.all([
    rootState(paths.outputRoot),
    rootState(paths.stagingRoot),
    rootState(paths.backupRoot),
    rootState(paths.recoveryRoot),
  ]);
  const outputIsNew = isExactRoot(output, journal.newRootSha256);
  const outputIsOld = isExactRoot(output, journal.previousRootSha256);
  const stagingIsNew = isExactRoot(staging, journal.newRootSha256);
  const backupIsOld = isExactRoot(backup, journal.previousRootSha256);

  const recoveryIsRecordedRoot = isExactRoot(recovery, journal.newRootSha256)
    || isExactRoot(recovery, journal.previousRootSha256);
  if (recovery.exists && !recoveryIsRecordedRoot) {
    if (!output.exists && backupIsOld && !staging.exists) {
      await renameLeafUnderStableParent(
        paths.backupRoot,
        paths.outputRoot,
        paths.outputParentIdentity,
        "Artifact backup restoration",
        "directory",
      );
      await removePromotionJournal(paths);
      return;
    }
    if (outputIsOld && !staging.exists && !backup.exists) {
      await removePromotionJournal(paths);
      return;
    }
  }
  if (recovery.exists) {
    throw new Error(`Artifact recovery path already exists; preserving every promotion path: ${paths.recoveryRoot}`);
  }

  if (outputIsNew && !staging.exists) {
    if (backup.exists && !backupIsOld) {
      throw new Error(`Artifact output is new but backup is not the recorded previous root: ${paths.backupRoot}`);
    }
    await finishRecoveredPromotion(paths, journal);
    return;
  }

  if (outputIsOld && stagingIsNew && !backup.exists) {
    await renameLeafUnderStableParent(
      paths.outputRoot,
      paths.backupRoot,
      paths.outputParentIdentity,
      "Artifact previous output",
      "directory",
    );
    await renameLeafUnderStableParent(
      paths.stagingRoot,
      paths.outputRoot,
      paths.outputParentIdentity,
      "Artifact staged output",
      "directory",
    );
    await finishRecoveredPromotion(paths, journal);
    return;
  }

  if (!output.exists && stagingIsNew && backupIsOld) {
    await renameLeafUnderStableParent(
      paths.stagingRoot,
      paths.outputRoot,
      paths.outputParentIdentity,
      "Artifact staged output",
      "directory",
    );
    await finishRecoveredPromotion(paths, journal);
    return;
  }

  if (!output.exists && stagingIsNew && journal.previousRootSha256 === null && !backup.exists) {
    await renameLeafUnderStableParent(
      paths.stagingRoot,
      paths.outputRoot,
      paths.outputParentIdentity,
      "Artifact staged output",
      "directory",
    );
    await finishRecoveredPromotion(paths, journal);
    return;
  }

  const exactOldCopyAvailable = outputIsOld || backupIsOld;
  if (exactOldCopyAvailable && !stagingIsNew && (!output.exists || outputIsOld)) {
    if (staging.exists) {
      await renameLeafUnderStableParent(
        paths.stagingRoot,
        paths.recoveryRoot,
        paths.outputParentIdentity,
        "Invalid artifact staging root",
      );
    }
    if (!output.exists) {
      if (!backupIsOld) throw new Error(`Recorded previous artifact is unavailable for restoration`);
      await renameLeafUnderStableParent(
        paths.backupRoot,
        paths.outputRoot,
        paths.outputParentIdentity,
        "Artifact backup restoration",
        "directory",
      );
    } else if (backup.exists) {
      throw new Error(`Both output and backup contain the recorded previous root; preserving both for diagnosis`);
    }
    await removePromotionJournal(paths);
    return;
  }

  if (output.exists && !outputIsNew && !outputIsOld && backupIsOld && !staging.exists) {
    await renameLeafUnderStableParent(
      paths.outputRoot,
      paths.recoveryRoot,
      paths.outputParentIdentity,
      "Unexpected artifact output",
    );
    await renameLeafUnderStableParent(
      paths.backupRoot,
      paths.outputRoot,
      paths.outputParentIdentity,
      "Artifact backup restoration",
      "directory",
    );
    await removePromotionJournal(paths);
    return;
  }

  const details = [
    `output=${output.fingerprint ?? (output.exists ? "invalid" : "absent")}`,
    `staging=${staging.fingerprint ?? (staging.exists ? "invalid" : "absent")}`,
    `backup=${backup.fingerprint ?? (backup.exists ? "invalid" : "absent")}`,
  ].join(", ");
  throw new Error(`Artifact promotion state cannot prove a safe recovery; preserving every path and journal (${details})`);
}

export async function promoteArtifactRoot(options: PromotionOptions): Promise<void> {
  const internal = options as PromotionOptions & InternalPromotionOptions;
  const paths = await resolveNewPromotionPaths(options);
  const assertStagingDoesNotAliasOutput = async (): Promise<void> => {
    const outputStat = await optionalLstat(paths.outputRoot);
    if (outputStat === null) return;
    const stagingIdentity = await inspectDirectoryIdentity(paths.stagingRoot, "Artifact staging root");
    const outputIdentity = await inspectDirectoryIdentity(paths.outputRoot, "Artifact output root");
    const [stagingReal, outputReal] = await Promise.all([
      realpath(paths.stagingRoot),
      realpath(paths.outputRoot),
    ]);
    if (pathsOverlap(stagingReal, outputReal)) {
      throw new Error(`Artifact staging and output roots alias or overlap: ${stagingReal} and ${outputReal}`);
    }
    const [stagingAliasIdentity, outputAliasIdentity] = internal.rootIdentityForAliasCheck === undefined
      ? [
        { device: stagingIdentity.device, inode: stagingIdentity.inode },
        { device: outputIdentity.device, inode: outputIdentity.inode },
      ]
      : await Promise.all([
        internal.rootIdentityForAliasCheck(paths.stagingRoot),
        internal.rootIdentityForAliasCheck(paths.outputRoot),
      ]);
    if (
      stagingAliasIdentity.device === outputAliasIdentity.device
      && stagingAliasIdentity.inode === outputAliasIdentity.inode
    ) {
      throw new Error(`Artifact staging and output roots have the same filesystem identity and alias each other: ${paths.stagingRoot} and ${paths.outputRoot}`);
    }
  };
  if (await optionalLstat(paths.stagingRoot) !== null) {
    await assertStagingDoesNotAliasOutput();
  }
  await recoverArtifactPromotion({ outputRoot: options.outputRoot, journalPath: options.journalPath });

  if (await optionalLstat(paths.stagingRoot) === null) {
    await assertAbsentUnderStableParent(paths.backupRoot, paths.outputParentIdentity, "Artifact backup root");
    await assertAbsentUnderStableParent(paths.recoveryRoot, paths.outputParentIdentity, "Artifact recovery root");
    await assertAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Artifact promotion journal");
    await assertAbsentUnderStableParent(paths.journalTemporaryPath, paths.journalParentIdentity, "Artifact temporary promotion journal");
    await validateArtifactRoot(paths.outputRoot, options.expected);
    return;
  }

  await assertStagingDoesNotAliasOutput();
  await assertStableDirectoryChain(paths.outputParentIdentity, "Artifact output parent");
  const stagingIdentity = await inspectDirectoryIdentity(paths.stagingRoot, "Artifact staging root");
  await assertAbsentUnderStableParent(paths.backupRoot, paths.outputParentIdentity, "Artifact backup root");
  await assertAbsentUnderStableParent(paths.recoveryRoot, paths.outputParentIdentity, "Artifact recovery root");
  await assertAbsentUnderStableParent(paths.journalPath, paths.journalParentIdentity, "Artifact promotion journal");
  await assertAbsentUnderStableParent(paths.journalTemporaryPath, paths.journalParentIdentity, "Artifact temporary promotion journal");

  await validateArtifactRoot(paths.stagingRoot, options.expected);
  await flushArtifactRoot(paths.stagingRoot);
  await assertSameIdentity(stagingIdentity, "Artifact staging root");
  const newRootSha256 = await fingerprintArtifactRoot(paths.stagingRoot);
  const outputState = await rootState(paths.outputRoot);
  if (outputState.exists && outputState.fingerprint === undefined) {
    throw new Error(`Previous artifact output is not a safe regular tree: ${paths.outputRoot}: ${errorMessage(outputState.fingerprintError)}`);
  }
  const previousRootSha256 = outputState.fingerprint ?? null;
  await callPromotionPhase(options, "staging-validated");

  const journal: ArtifactPromotionJournalV1 = {
    version: 1,
    operation: "promote-artifact-root",
    operationId: paths.operationId,
    outputRoot: paths.outputRoot,
    stagingRoot: paths.stagingRoot,
    backupRoot: paths.backupRoot,
    recoveryRoot: paths.recoveryRoot,
    newRootSha256,
    previousRootSha256,
  };
  await writePromotionJournal(paths, journal);
  await callPromotionPhase(options, "journal-persisted");

  if (await fingerprintArtifactRoot(paths.stagingRoot) !== newRootSha256) {
    throw new Error(`Artifact staging fingerprint changed before promotion: ${paths.stagingRoot}`);
  }
  if (previousRootSha256 !== null) {
    if (await fingerprintArtifactRoot(paths.outputRoot) !== previousRootSha256) {
      throw new Error(`Previous artifact output changed before backup: ${paths.outputRoot}`);
    }
    await renameLeafUnderStableParent(
      paths.outputRoot,
      paths.backupRoot,
      paths.outputParentIdentity,
      "Artifact previous output",
      "directory",
    );
  } else {
    await assertAbsentUnderStableParent(paths.outputRoot, paths.outputParentIdentity, "Artifact output root");
  }
  await callPromotionPhase(options, "previous-backed-up");

  await renameLeafUnderStableParent(
    paths.stagingRoot,
    paths.outputRoot,
    paths.outputParentIdentity,
    "Artifact staged output",
    "directory",
  );
  await callPromotionPhase(options, "staging-promoted");

  await validateArtifactRoot(paths.outputRoot, options.expected);
  if (await fingerprintArtifactRoot(paths.outputRoot) !== newRootSha256) {
    throw new Error(`Promoted artifact fingerprint differs at ${paths.outputRoot}`);
  }
  await callPromotionPhase(options, "promoted-validated");

  if (previousRootSha256 !== null) {
    await removeExactRoot(
      paths.backupRoot,
      previousRootSha256,
      paths.outputParentIdentity,
      "Artifact backup root",
    );
  }
  await callPromotionPhase(options, "backup-removed");

  await removePromotionJournal(paths);
  await callPromotionPhase(options, "journal-removed");
}
