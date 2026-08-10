/// <reference lib="dom" />

import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build as viteBuild } from "vite";
import type { SourceAssembly } from "../src/source";
import {
  buildArtifactData,
  promoteArtifactRoot,
  recoverArtifactPromotion,
  validateArtifactRoot,
} from "./artifact-root";

export type SiteShellInput =
  | {
      kind: "vite";
      projectRoot: string;
      configFile?: string | false;
    }
  | {
      kind: "cached";
      shellRoot: string;
    };

export type SiteDestination =
  | {
      kind: "staging";
      artifactRoot: string;
    }
  | {
      kind: "promoted";
      outputRoot: string;
      journalPath?: string;
    };

export interface BuildSiteOptions {
  sourceRoot: string;
  sourceCommitSha: string | null;
  shell: SiteShellInput;
  destination: SiteDestination;
}

export interface BuildSiteResult {
  artifactRoot: string;
  assembly: SourceAssembly;
}

interface EntryIdentity {
  path: string;
  device: bigint;
  inode: bigint;
  kind: "directory" | "file";
}

interface DirectoryChain {
  directory: string;
  entries: readonly EntryIdentity[];
}

interface InternalBuildSiteOptions {
  beforeCleanup?: (artifactRoot: string) => void | Promise<void>;
  rootIdentityForAliasCheck?: (path: string) => Promise<{ device: bigint; inode: bigint }>;
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
  return leftToRight !== "" && leftToRight !== ".." && !leftToRight.startsWith(`..${sep}`) && !parse(leftToRight).root
    || rightToLeft !== "" && rightToLeft !== ".." && !rightToLeft.startsWith(`..${sep}`) && !parse(rightToLeft).root;
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(`Cannot inspect ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

async function inspectEntry(path: string, label: string): Promise<EntryIdentity> {
  let stat: BigIntStats;
  try {
    stat = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error(`Cannot inspect ${label} ${path}: ${errorMessage(error)}`, { cause: error });
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${path}`);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error(`${label} has unsupported kind: ${path}`);
  return {
    path,
    device: stat.dev,
    inode: stat.ino,
    kind: stat.isDirectory() ? "directory" : "file",
  };
}

async function assertSameEntry(expected: EntryIdentity, label: string): Promise<void> {
  const actual = await inspectEntry(expected.path, label);
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
  for (const segment of ["", ...segments]) {
    if (segment !== "") current = join(current, segment);
    const identity = await inspectEntry(current, `${label} component`);
    if (identity.kind !== "directory") throw new Error(`${label} component must be a real directory: ${current}`);
  }
}

async function captureRealDirectoryChain(path: string, label: string): Promise<DirectoryChain> {
  const root = parse(path).root;
  const segments = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  const entries: EntryIdentity[] = [];
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment !== "") current = join(current, segment);
    const identity = await inspectEntry(current, `${label} component`);
    if (identity.kind !== "directory") throw new Error(`${label} component must be a real directory: ${current}`);
    entries.push(identity);
  }
  return { directory: path, entries };
}

async function assertDirectoryChain(chain: DirectoryChain, label: string): Promise<void> {
  for (const entry of chain.entries) await assertSameEntry(entry, `${label} component`);
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

async function copyRegularFile(source: string, destination: string, mode: number): Promise<void> {
  const sourceIdentity = await inspectEntry(source, "Cached shell file");
  if (sourceIdentity.kind !== "file") throw new Error(`Cached shell leaf must be a regular file: ${source}`);
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Uint8Array;
  try {
    const opened = await sourceHandle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== sourceIdentity.device || opened.ino !== sourceIdentity.inode) {
      throw new Error(`Cached shell file identity changed while opening ${source}`);
    }
    bytes = Uint8Array.from(await sourceHandle.readFile());
  } finally {
    await sourceHandle.close();
  }
  const destinationHandle = await open(destination, "wx", mode);
  try {
    await destinationHandle.chmod(mode);
    await destinationHandle.writeFile(bytes);
    await destinationHandle.sync();
  } finally {
    await destinationHandle.close();
  }
}

async function copyCachedShell(shellRoot: string, artifactRoot: string): Promise<void> {
  const sourceRootIdentity = await inspectEntry(shellRoot, "Cached shell root");
  if (sourceRootIdentity.kind !== "directory") throw new Error(`Cached shell root must be a real directory: ${shellRoot}`);

  const copyDirectory = async (sourceDirectory: string, destinationDirectory: string, depth: number): Promise<void> => {
    const directoryIdentity = await inspectEntry(sourceDirectory, "Cached shell directory");
    if (directoryIdentity.kind !== "directory") throw new Error(`Cached shell directory must remain real: ${sourceDirectory}`);
    const names = (await readdir(sourceDirectory)).sort(compareText);
    await assertSameEntry(directoryIdentity, "Cached shell directory");
    for (const name of names) {
      if (depth === 0 && (name === "data" || name === "media")) continue;
      const source = join(sourceDirectory, name);
      const destination = join(destinationDirectory, name);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) throw new Error(`Cached shell must not contain a symlink: ${source}`);
      if (stat.isDirectory()) {
        const mode = stat.mode & 0o777;
        await mkdir(destination, { mode });
        await chmod(destination, mode);
        await copyDirectory(source, destination, depth + 1);
        await syncDirectory(destination);
      } else if (stat.isFile()) {
        await copyRegularFile(source, destination, stat.mode & 0o777);
      } else {
        throw new Error(`Cached shell contains unsupported entry: ${source}`);
      }
    }
    await assertSameEntry(directoryIdentity, "Cached shell directory");
  };

  await copyDirectory(shellRoot, artifactRoot, 0);
  await assertSameEntry(sourceRootIdentity, "Cached shell root");
  await syncDirectory(artifactRoot);
}

async function flushCompleteRoot(root: string): Promise<void> {
  const directories: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const identity = await inspectEntry(directory, "Artifact durability directory");
    if (identity.kind !== "directory") throw new Error(`Artifact durability path must be a directory: ${directory}`);
    directories.push(directory);
    const names = (await readdir(directory)).sort(compareText);
    await assertSameEntry(identity, "Artifact durability directory");
    for (const name of names) {
      const path = join(directory, name);
      const entry = await inspectEntry(path, "Artifact durability entry");
      if (entry.kind === "directory") {
        await visit(path);
        continue;
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.dev !== entry.device || opened.ino !== entry.inode) {
          throw new Error(`Artifact file identity changed while flushing ${path}`);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await assertSameEntry(identity, "Artifact durability directory");
  };
  await visit(root);
  directories.sort((left, right) => right.split(sep).length - left.split(sep).length || compareText(left, right));
  for (const directory of directories) await syncDirectory(directory);
}

function defaultPromotionJournalPath(outputRoot: string): string {
  return join(dirname(outputRoot), `.${basename(outputRoot)}.mygameslist-artifact-promotion.json`);
}

async function safelyRemoveFreshRoot(
  root: string,
  identity: EntryIdentity,
  parent: DirectoryChain,
): Promise<void> {
  await assertDirectoryChain(parent, "Fresh artifact staging parent");
  await assertSameEntry(identity, "Fresh artifact staging root");
  await assertDirectoryChain(parent, "Fresh artifact staging parent");
  await assertSameEntry(identity, "Fresh artifact staging root");
  await rm(root, { recursive: true });
  await assertDirectoryChain(parent, "Fresh artifact staging parent");
  await syncDirectory(dirname(root));
}

async function prepareShell(shell: SiteShellInput, artifactRoot: string): Promise<void> {
  if (shell.kind === "cached") {
    const shellRoot = resolveNonRoot(shell.shellRoot, "Cached shell root");
    await assertRealDirectoryChain(shellRoot, "Cached shell root");
    if (pathsOverlap(shellRoot, artifactRoot)) throw new Error(`Cached shell and artifact roots overlap: ${shellRoot} and ${artifactRoot}`);
    await copyCachedShell(shellRoot, artifactRoot);
    return;
  }

  const projectRoot = resolveNonRoot(shell.projectRoot, "Vite project root");
  await assertRealDirectoryChain(projectRoot, "Vite project root");
  await viteBuild({
    root: projectRoot,
    ...(shell.configFile === undefined ? {} : { configFile: shell.configFile }),
    build: {
      outDir: artifactRoot,
      emptyOutDir: false,
    },
  });
}

export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const internal = options as BuildSiteOptions & InternalBuildSiteOptions;
  const sourceRoot = resolveNonRoot(options.sourceRoot, "Source root");
  const sourceIdentityChain = await captureRealDirectoryChain(sourceRoot, "Source root");
  const sourceIdentity = sourceIdentityChain.entries[sourceIdentityChain.entries.length - 1];
  const sourceReal = await realpath(sourceRoot);
  let artifactRoot: string;
  let outputRoot: string | undefined;
  let journalPath: string | undefined;

  if (options.destination.kind === "staging") {
    artifactRoot = resolveNonRoot(options.destination.artifactRoot, "Artifact staging destination");
    if (await optionalLstat(artifactRoot)) throw new Error(`Artifact staging destination must not exist: ${artifactRoot}`);
  } else {
    outputRoot = resolveNonRoot(options.destination.outputRoot, "Artifact output root");
    journalPath = options.destination.journalPath === undefined
      ? defaultPromotionJournalPath(outputRoot)
      : resolveNonRoot(options.destination.journalPath, "Artifact promotion journal");
    if (pathsOverlap(sourceRoot, outputRoot)) {
      throw new Error(`Source and artifact output roots overlap: ${sourceRoot} and ${outputRoot}`);
    }
    const temporaryJournalPath = journalPath.endsWith(".json")
      ? `${journalPath.slice(0, -5)}.tmp`
      : `${journalPath}.tmp`;
    if (pathsOverlap(sourceRoot, journalPath) || pathsOverlap(sourceRoot, temporaryJournalPath)) {
      throw new Error(`Source root overlaps an artifact promotion journal: ${sourceRoot} and ${journalPath}`);
    }
    await assertRealDirectoryChain(dirname(outputRoot), "Artifact output parent");
    const assertOutputDoesNotAliasSource = async (): Promise<void> => {
      const outputStat = await optionalLstat(outputRoot!);
      if (outputStat === null) return;
      const outputChain = await captureRealDirectoryChain(outputRoot!, "Artifact output root");
      const outputIdentity = outputChain.entries[outputChain.entries.length - 1];
      const outputReal = await realpath(outputRoot!);
      if (pathsOverlap(sourceReal, outputReal)) {
        throw new Error(`Source and artifact output roots alias or overlap: ${sourceReal} and ${outputReal}`);
      }
      const [sourceAliasIdentity, outputAliasIdentity] = internal.rootIdentityForAliasCheck === undefined
        ? [
          { device: sourceIdentity.device, inode: sourceIdentity.inode },
          { device: outputIdentity.device, inode: outputIdentity.inode },
        ]
        : await Promise.all([
          internal.rootIdentityForAliasCheck(sourceRoot),
          internal.rootIdentityForAliasCheck(outputRoot!),
        ]);
      if (
        sourceAliasIdentity.device === outputAliasIdentity.device
        && sourceAliasIdentity.inode === outputAliasIdentity.inode
      ) {
        throw new Error(`Source and artifact output roots have the same filesystem identity and alias each other: ${sourceRoot} and ${outputRoot}`);
      }
    };
    await assertOutputDoesNotAliasSource();
    await assertDirectoryChain(sourceIdentityChain, "Source root");
    await recoverArtifactPromotion({ outputRoot, journalPath });
    await assertDirectoryChain(sourceIdentityChain, "Source root");
    await assertOutputDoesNotAliasSource();
    const operationId = randomUUID();
    artifactRoot = join(dirname(outputRoot), `.${basename(outputRoot)}.mygameslist-artifact-staging-${operationId}`);
    if (await optionalLstat(artifactRoot)) throw new Error(`Unique artifact staging root already exists: ${artifactRoot}`);
  }

  if (pathsOverlap(sourceRoot, artifactRoot)) throw new Error(`Source and artifact roots overlap: ${sourceRoot} and ${artifactRoot}`);
  await assertDirectoryChain(sourceIdentityChain, "Source root");
  const artifactParent = dirname(artifactRoot);
  const artifactParentIdentity = await captureRealDirectoryChain(artifactParent, "Artifact staging parent");
  await assertDirectoryChain(artifactParentIdentity, "Artifact staging parent");
  if (await optionalLstat(artifactRoot)) throw new Error(`Fresh artifact staging root must not exist: ${artifactRoot}`);
  let promotionJournalExists = false;
  let freshRootIdentity: EntryIdentity | undefined;
  try {
    await assertDirectoryChain(artifactParentIdentity, "Artifact staging parent");
    await mkdir(artifactRoot, { mode: 0o755 });
    await chmod(artifactRoot, 0o755);
    freshRootIdentity = await inspectEntry(artifactRoot, "Fresh artifact staging root");
    if (freshRootIdentity.kind !== "directory") throw new Error(`Fresh artifact staging root must be a directory: ${artifactRoot}`);
    await prepareShell(options.shell, artifactRoot);
    await assertDirectoryChain(artifactParentIdentity, "Artifact staging parent");
    await assertSameEntry(freshRootIdentity, "Fresh artifact staging root");
    const assembly = await buildArtifactData(sourceRoot, artifactRoot, options.sourceCommitSha);
    await assertDirectoryChain(artifactParentIdentity, "Artifact staging parent");
    await assertSameEntry(freshRootIdentity, "Fresh artifact staging root");
    await validateArtifactRoot(artifactRoot, assembly);
    await flushCompleteRoot(artifactRoot);
    await assertDirectoryChain(artifactParentIdentity, "Artifact staging parent");
    await assertSameEntry(freshRootIdentity, "Fresh artifact staging root");

    if (outputRoot !== undefined) {
      await promoteArtifactRoot({
        stagingRoot: artifactRoot,
        outputRoot,
        expected: assembly,
        journalPath,
      });
      artifactRoot = outputRoot;
    }
    return { artifactRoot, assembly };
  } catch (error) {
    if (outputRoot !== undefined && journalPath !== undefined) {
      promotionJournalExists = await optionalLstat(journalPath) !== null
        || await optionalLstat(journalPath.endsWith(".json") ? `${journalPath.slice(0, -5)}.tmp` : `${journalPath}.tmp`) !== null;
    }
    if (!promotionJournalExists) {
      try {
        if (freshRootIdentity !== undefined) {
          await internal.beforeCleanup?.(artifactRoot);
          await safelyRemoveFreshRoot(artifactRoot, freshRootIdentity, artifactParentIdentity);
        }
      } catch (cleanupError) {
        throw new Error(
          `Site build failed (${errorMessage(error)}) and cleanup of ${artifactRoot} failed: ${errorMessage(cleanupError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  buildSite({
    sourceRoot: resolve("data"),
    sourceCommitSha: null,
    shell: { kind: "vite", projectRoot: process.cwd() },
    destination: { kind: "promoted", outputRoot: resolve("dist") },
  }).then(({ artifactRoot }) => {
    process.stdout.write(`built ${artifactRoot}\n`);
  }).catch((error) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
