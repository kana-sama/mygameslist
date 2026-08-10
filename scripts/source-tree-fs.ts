/// <reference lib="dom" />

import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { sha256Bytes } from "../src/domain";
import type {
  ProjectedBinaryLeaf,
  ProjectedSourceLeaf,
  SourceProjection,
  SourceTreeEntry,
  SourceTreeReader,
} from "../src/source";

const SHA256 = /^[0-9a-f]{64}$/;

export interface MaterializeSourceTreeOptions {
  /** Physical directory mounted as logical `data`. It must not exist. */
  targetSourceRoot: string;
  projection: SourceProjection;
  /** Called at most once per unique asset SHA; returned bytes are reused for owner copies. */
  resolveAssetBytes(leaf: ProjectedBinaryLeaf): Promise<Uint8Array>;
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

function resolveNonRootPath(input: string, label: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error(`${label} must be a nonempty path`);
  if (input.includes("\0")) throw new Error(`${label} contains NUL`);
  const physicalPath = resolve(input);
  if (physicalPath === parse(physicalPath).root) throw new Error(`${label} must not be a filesystem root: ${physicalPath}`);
  return physicalPath;
}

function safeLogicalFilePath(logicalPath: unknown): asserts logicalPath is string {
  if (typeof logicalPath !== "string" || logicalPath.length === 0) {
    throw new Error("Source logical path must be a nonempty string beginning data/");
  }
  if (logicalPath.includes("\0") || logicalPath.startsWith("/") || logicalPath.includes("\\")) {
    throw new Error(`Unsafe source logical path ${JSON.stringify(logicalPath)}`);
  }
  const segments = logicalPath.split("/");
  if (segments[0] !== "data" || segments.length < 2 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Source logical path must be canonical data/**: ${JSON.stringify(logicalPath)}`);
  }
}

async function pathStat(physicalPath: string, logicalPath: string) {
  try {
    return await lstat(physicalPath);
  } catch (error) {
    throw new Error(`Cannot inspect ${logicalPath} at ${physicalPath}: ${errorMessage(error)}`, { cause: error });
  }
}

function classifyEntry(logicalPath: string, stat: Awaited<ReturnType<typeof lstat>>): SourceTreeEntry {
  if (stat.isSymbolicLink()) return { kind: "symlink", path: logicalPath };
  if (stat.isDirectory()) return { kind: "directory", path: logicalPath };
  if (stat.isFile()) return { kind: "file", path: logicalPath };
  return { kind: "unsupported", path: logicalPath };
}

async function assertReaderRoot(physicalRoot: string): Promise<void> {
  const stat = await pathStat(physicalRoot, "data");
  if (stat.isSymbolicLink()) throw new Error(`Source root is a symlink: ${physicalRoot}`);
  if (!stat.isDirectory()) throw new Error(`Source root must be a real directory: ${physicalRoot}`);
}

export function createFileSystemSourceReader(sourceRoot: string): SourceTreeReader {
  const physicalRoot = resolveNonRootPath(sourceRoot, "Source root");

  return {
    async listEntries(): Promise<readonly SourceTreeEntry[]> {
      await assertReaderRoot(physicalRoot);
      const entries: SourceTreeEntry[] = [{ kind: "directory", path: "data" }];

      const enumerate = async (physicalDirectory: string, logicalDirectory: string): Promise<void> => {
        const before = await pathStat(physicalDirectory, logicalDirectory);
        if (before.isSymbolicLink() || !before.isDirectory()) {
          throw new Error(`Source directory changed kind at ${logicalDirectory} (${physicalDirectory})`);
        }
        let names: string[];
        try {
          names = await readdir(physicalDirectory);
        } catch (error) {
          throw new Error(`Cannot enumerate ${logicalDirectory} at ${physicalDirectory}: ${errorMessage(error)}`, { cause: error });
        }
        names.sort(compareText);
        const after = await pathStat(physicalDirectory, logicalDirectory);
        if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) {
          throw new Error(`Source directory changed during enumeration at ${logicalDirectory} (${physicalDirectory})`);
        }
        for (const name of names) {
          const childPhysical = join(physicalDirectory, name);
          const childLogical = `${logicalDirectory}/${name}`;
          const childStat = await pathStat(childPhysical, childLogical);
          const entry = classifyEntry(childLogical, childStat);
          entries.push(entry);
          if (entry.kind === "directory") await enumerate(childPhysical, childLogical);
        }
      };

      await enumerate(physicalRoot, "data");
      return entries.sort((left, right) => compareText(left.path, right.path));
    },

    async readFile(logicalPath: string): Promise<Uint8Array> {
      safeLogicalFilePath(logicalPath);
      await assertReaderRoot(physicalRoot);
      const segments = logicalPath.split("/").slice(1);
      let physicalPath = physicalRoot;
      for (const [index, segment] of segments.entries()) {
        physicalPath = join(physicalPath, segment);
        const currentLogical = `data/${segments.slice(0, index + 1).join("/")}`;
        const stat = await pathStat(physicalPath, currentLogical);
        const isLeaf = index === segments.length - 1;
        if (stat.isSymbolicLink()) throw new Error(`Refusing to follow symlink at ${currentLogical} (${physicalPath})`);
        if (!isLeaf && !stat.isDirectory()) {
          throw new Error(`Source ancestor must be a real directory at ${currentLogical} (${physicalPath})`);
        }
        if (isLeaf && !stat.isFile()) {
          throw new Error(`Source leaf must be a regular file at ${currentLogical} (${physicalPath})`);
        }
      }

      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(physicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const openedStat = await handle.stat();
        if (!openedStat.isFile()) throw new Error(`Source leaf must remain a regular file at ${logicalPath} (${physicalPath})`);
        const bytes = await handle.readFile();
        return Uint8Array.from(bytes);
      } catch (error) {
        throw new Error(`Cannot read ${logicalPath} at ${physicalPath}: ${errorMessage(error)}`, { cause: error });
      } finally {
        await handle?.close();
      }
    },
  };
}

interface ValidatedLeaf {
  leaf: ProjectedSourceLeaf;
  relativeSegments: readonly string[];
}

function validateProjectedLeaves(leaves: readonly ProjectedSourceLeaf[]): readonly ValidatedLeaf[] {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  const byteLengthByAssetId = new Map<string, number>();
  const validated = leaves.map((leaf): ValidatedLeaf => {
    if (leaf === null || typeof leaf !== "object" || (leaf.kind !== "text" && leaf.kind !== "binary")) {
      throw new Error("Projected source leaf has an unsupported kind");
    }
    safeLogicalFilePath(leaf.path);
    if (exact.has(leaf.path)) throw new Error(`Duplicate projected source path ${leaf.path}`);
    exact.add(leaf.path);
    const caseKey = leaf.path.toLowerCase();
    const previousCase = folded.get(caseKey);
    if (previousCase !== undefined && previousCase !== leaf.path) {
      throw new Error(`Case-colliding projected source paths ${previousCase} and ${leaf.path}`);
    }
    folded.set(caseKey, leaf.path);
    if (leaf.kind === "text") {
      if (typeof leaf.text !== "string") throw new Error(`Projected text leaf ${leaf.path} has invalid text`);
    } else {
      if (!SHA256.test(leaf.assetId)) throw new Error(`Projected binary leaf ${leaf.path} has invalid lowercase SHA`);
      if (!Number.isSafeInteger(leaf.byteLength) || leaf.byteLength < 0) {
        throw new Error(`Projected binary leaf ${leaf.path} has invalid byteLength`);
      }
      const previousByteLength = byteLengthByAssetId.get(leaf.assetId);
      if (previousByteLength !== undefined && previousByteLength !== leaf.byteLength) {
        throw new Error(
          `Projected leaves for the same SHA ${leaf.assetId} disagree on byteLength: ${previousByteLength} and ${leaf.byteLength}`,
        );
      }
      byteLengthByAssetId.set(leaf.assetId, leaf.byteLength);
    }
    return { leaf, relativeSegments: leaf.path.split("/").slice(1) };
  });

  const sortedPaths = [...exact].sort(compareText);
  for (let index = 0; index < sortedPaths.length - 1; index += 1) {
    if (sortedPaths[index + 1].startsWith(`${sortedPaths[index]}/`)) {
      throw new Error(`Projected file/directory prefix collision at ${sortedPaths[index]}`);
    }
  }
  return validated.sort((left, right) => compareText(left.leaf.path, right.leaf.path));
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

async function inspectRealDirectoryIdentity(
  physicalDirectory: string,
  label: string,
): Promise<StableDirectoryIdentity> {
  let stat: BigIntStats;
  try {
    stat = await lstat(physicalDirectory, { bigint: true });
  } catch (error) {
    throw new Error(`Cannot inspect ${label} ${physicalDirectory}: ${errorMessage(error)}`, { cause: error });
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} is or contains a symlinked component: ${physicalDirectory}`);
  if (!stat.isDirectory()) throw new Error(`${label} is not a real directory: ${physicalDirectory}`);
  return {
    path: physicalDirectory,
    device: stat.dev,
    inode: stat.ino,
  };
}

async function captureRealDirectoryChain(physicalDirectory: string): Promise<StableDirectoryChain> {
  const root = parse(physicalDirectory).root;
  const relativeSegments = physicalDirectory.slice(root.length).split(/[\\/]/).filter(Boolean);
  const entries: StableDirectoryIdentity[] = [];
  let current = root;
  entries.push(await inspectRealDirectoryIdentity(current, "Target parent component"));
  for (const segment of relativeSegments) {
    current = join(current, segment);
    entries.push(await inspectRealDirectoryIdentity(current, "Target parent component"));
  }
  return { directory: physicalDirectory, entries };
}

async function assertStableDirectoryIdentity(
  expected: StableDirectoryIdentity,
  label: string,
): Promise<void> {
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

async function assertStableDirectoryChain(expected: StableDirectoryChain): Promise<void> {
  for (const entry of expected.entries) await assertStableDirectoryIdentity(entry, "Target parent component");
}

async function assertTargetAbsent(targetSourceRoot: string): Promise<void> {
  try {
    await lstat(targetSourceRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new Error(`Cannot inspect target source root ${targetSourceRoot}: ${errorMessage(error)}`, { cause: error });
  }
  throw new Error(`Target source root must not exist: ${targetSourceRoot}`);
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

export async function materializeProjectedSourceTree(
  options: MaterializeSourceTreeOptions,
): Promise<void> {
  const targetSourceRoot = resolveNonRootPath(options.targetSourceRoot, "Target source root");
  const parent = dirname(targetSourceRoot);
  const parentIdentity = await captureRealDirectoryChain(parent);
  await assertTargetAbsent(targetSourceRoot);
  const leaves = validateProjectedLeaves(options.projection.leaves);

  const binaryBytes = new Map<string, Uint8Array>();
  for (const { leaf } of leaves) {
    if (leaf.kind !== "binary" || binaryBytes.has(leaf.assetId)) continue;
    const resolved = await options.resolveAssetBytes(leaf);
    if (!(resolved instanceof Uint8Array)) throw new Error(`Asset resolver returned non-bytes for ${leaf.assetId}`);
    const bytes = Uint8Array.from(resolved);
    if (bytes.byteLength !== leaf.byteLength) {
      throw new Error(`Asset ${leaf.assetId} byteLength mismatch: expected ${leaf.byteLength}, received ${bytes.byteLength}`);
    }
    const actualSha = sha256Bytes(bytes);
    if (actualSha !== leaf.assetId) throw new Error(`Asset ${leaf.assetId} SHA mismatch: received ${actualSha}`);
    binaryBytes.set(leaf.assetId, bytes);
  }

  await assertStableDirectoryChain(parentIdentity);
  await assertTargetAbsent(targetSourceRoot);

  const directories = new Set<string>();
  for (const { relativeSegments } of leaves) {
    for (let index = 1; index < relativeSegments.length; index += 1) {
      directories.add(join(targetSourceRoot, ...relativeSegments.slice(0, index)));
    }
  }
  const orderedDirectories = [...directories].sort((left, right) => {
    const depth = left.split(/[\\/]/).length - right.split(/[\\/]/).length;
    return depth || compareText(left, right);
  });

  let createdTarget = false;
  let createdTargetIdentity: StableDirectoryIdentity | undefined;
  const assertCreatedTargetStable = async (): Promise<void> => {
    if (createdTargetIdentity === undefined) throw new Error("Created target source root identity is unavailable");
    await assertStableDirectoryChain(parentIdentity);
    await assertStableDirectoryIdentity(createdTargetIdentity, "Created target source root");
    await assertStableDirectoryChain(parentIdentity);
    await assertStableDirectoryIdentity(createdTargetIdentity, "Created target source root");
  };
  try {
    await assertStableDirectoryChain(parentIdentity);
    await assertTargetAbsent(targetSourceRoot);
    await assertStableDirectoryChain(parentIdentity);
    await mkdir(targetSourceRoot, { mode: 0o755 });
    createdTarget = true;
    createdTargetIdentity = await inspectRealDirectoryIdentity(targetSourceRoot, "Created target source root");
    await assertCreatedTargetStable();
    await chmod(targetSourceRoot, 0o755);
    for (const directory of orderedDirectories) {
      await assertCreatedTargetStable();
      await mkdir(directory, { mode: 0o755 });
      await assertCreatedTargetStable();
      await chmod(directory, 0o755);
    }
    for (const { leaf, relativeSegments } of leaves) {
      const path = join(targetSourceRoot, ...relativeSegments);
      const bytes = leaf.kind === "text"
        ? new TextEncoder().encode(leaf.text)
        : binaryBytes.get(leaf.assetId)!.slice();
      await assertCreatedTargetStable();
      await writeExclusiveFile(path, bytes);
    }
    for (const directory of [...orderedDirectories].sort((left, right) => right.length - left.length || compareText(left, right))) {
      await assertCreatedTargetStable();
      await syncDirectory(directory);
    }
    await assertCreatedTargetStable();
    await syncDirectory(targetSourceRoot);
    await assertCreatedTargetStable();
    await syncDirectory(parent);
  } catch (error) {
    if (createdTarget) {
      try {
        if (createdTargetIdentity === undefined) {
          throw new Error("created target identity was not captured; refusing path-based cleanup");
        }
        await assertStableDirectoryChain(parentIdentity);
        await assertStableDirectoryIdentity(createdTargetIdentity, "Created target source root");
        await assertStableDirectoryChain(parentIdentity);
        await assertStableDirectoryIdentity(createdTargetIdentity, "Created target source root");
        await rm(targetSourceRoot, { recursive: true, force: true });
        await assertStableDirectoryChain(parentIdentity);
        await syncDirectory(parent);
      } catch (cleanupError) {
        throw new Error(
          `Materialization failed (${errorMessage(error)}) and cleanup of ${targetSourceRoot} failed: ${errorMessage(cleanupError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}
