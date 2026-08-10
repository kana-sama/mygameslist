import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { canonicalStringify } from "../src/domain/canonical";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SOURCE_DIGEST = /^[0-9a-f]{64}$/;

export interface CheckoutSourceSnapshot {
  sourceCommitSha: string;
  sourceTreeSha256: string;
}

interface EntryIdentity {
  path: string;
  device: bigint;
  inode: bigint;
  kind: "directory" | "file";
}

interface SourceDigestEntry {
  path: string;
  byteLength: number;
  sha256: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveNonRoot(input: string, label: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error(`${label} must be a nonempty path`);
  if (input.includes("\0")) throw new Error(`${label} contains NUL`);
  const resolved = resolve(input);
  if (resolved === parse(resolved).root) throw new Error(`${label} must not be a filesystem root: ${resolved}`);
  return resolved;
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
  if (!stat.isDirectory() && !stat.isFile()) throw new Error(`${label} has unsupported filesystem kind: ${path}`);
  return {
    path,
    device: stat.dev,
    inode: stat.ino,
    kind: stat.isDirectory() ? "directory" : "file",
  };
}

async function assertSameEntry(expected: EntryIdentity, label: string): Promise<void> {
  const actual = await inspectEntry(expected.path, label);
  if (actual.device !== expected.device || actual.inode !== expected.inode || actual.kind !== expected.kind) {
    throw new Error(`${label} identity changed at ${expected.path}`);
  }
}

async function assertRealDirectoryChain(path: string, label: string): Promise<void> {
  const root = parse(path).root;
  const segments = path.slice(root.length).split(/[\\/]/u).filter(Boolean);
  let current = root;
  for (const segment of ["", ...segments]) {
    if (segment) current = join(current, segment);
    const entry = await inspectEntry(current, `${label} component`);
    if (entry.kind !== "directory") throw new Error(`${label} component must be a real directory: ${current}`);
  }
}

async function canonicalRealDirectory(input: string, label: string): Promise<string> {
  const resolved = resolveNonRoot(input, label);
  const identity = await inspectEntry(resolved, label);
  if (identity.kind !== "directory") throw new Error(`${label} must be a real directory: ${resolved}`);
  const physical = await realpath(resolved);
  await assertRealDirectoryChain(physical, label);
  return physical;
}

async function readStableFile(path: string, label: string): Promise<Uint8Array> {
  await assertRealDirectoryChain(dirname(path), `${label} parent`);
  const identity = await inspectEntry(path, label);
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
    await assertSameEntry(identity, label);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readControlText(path: string, label: string): Promise<string> {
  const bytes = await readStableFile(path, label);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function oneLine(value: string, label: string): string {
  if (value.includes("\0") || value.includes("\r")) throw new Error(`${label} is malformed`);
  const withoutFinalLf = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (withoutFinalLf.length === 0 || withoutFinalLf.includes("\n")) throw new Error(`${label} must contain exactly one value`);
  return withoutFinalLf;
}

function assertObjectId(value: string, label: string): string {
  if (!OBJECT_ID.test(value)) throw new Error(`${label} must be a lowercase 40- or 64-character object ID`);
  return value;
}

function safeRefName(value: string): string {
  if (!value.startsWith("refs/") || isAbsolute(value) || value.includes("\\") || /[\u0000-\u0020\u007f~^:?*[\]]/u.test(value)) {
    throw new Error(`HEAD contains an unsafe symbolic ref: ${value}`);
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.endsWith(".lock"))
    || value.includes("..")
    || value.endsWith("/")
  ) {
    throw new Error(`HEAD contains an unsafe symbolic ref: ${value}`);
  }
  return value;
}

function resolveContained(base: string, child: string, label: string): string {
  const path = resolve(base, child);
  const fromBase = relative(base, path);
  if (fromBase === "" || fromBase === ".." || fromBase.startsWith(`..${sep}`) || isAbsolute(fromBase)) {
    throw new Error(`${label} escapes ${base}`);
  }
  return path;
}

async function resolveGitDirectories(repositoryRoot: string): Promise<{ gitDir: string; commonDir: string }> {
  const repository = await canonicalRealDirectory(repositoryRoot, "Repository root");
  const dotGit = join(repository, ".git");
  const dotGitIdentity = await inspectEntry(dotGit, "Git metadata root");
  let gitDir: string;
  if (dotGitIdentity.kind === "directory") {
    gitDir = dotGit;
  } else {
    const line = oneLine(await readControlText(dotGit, "Git metadata file"), "Git metadata file");
    if (!line.startsWith("gitdir: ")) throw new Error(`Git metadata file is malformed: ${dotGit}`);
    const target = line.slice("gitdir: ".length);
    if (!target || target.includes("\0")) throw new Error(`Git metadata file has an invalid gitdir: ${dotGit}`);
    const targetPath = isAbsolute(target) ? resolve(target) : resolve(repository, target);
    gitDir = await canonicalRealDirectory(targetPath, "Git directory");
  }

  const commonDirFile = join(gitDir, "commondir");
  const commonStat = await optionalLstat(commonDirFile);
  if (commonStat === null) return { gitDir, commonDir: gitDir };
  if (commonStat.isSymbolicLink() || !commonStat.isFile()) throw new Error(`Git commondir must be a regular control file: ${commonDirFile}`);
  const target = oneLine(await readControlText(commonDirFile, "Git commondir"), "Git commondir");
  const targetPath = isAbsolute(target) ? resolve(target) : resolve(gitDir, target);
  const commonDir = await canonicalRealDirectory(targetPath, "Git common directory");
  return { gitDir, commonDir };
}

async function readLooseRef(base: string, refName: string): Promise<string | null> {
  const path = resolveContained(base, refName, "Git loose ref");
  const stat = await optionalLstat(path);
  if (stat === null) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Git loose ref must be a regular file: ${path}`);
  return assertObjectId(oneLine(await readControlText(path, "Git loose ref"), "Git loose ref"), "Git loose ref");
}

async function readPackedRef(path: string, refName: string): Promise<string | null> {
  const stat = await optionalLstat(path);
  if (stat === null) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Git packed-refs must be a regular file: ${path}`);
  const text = await readControlText(path, "Git packed-refs");
  if (text.includes("\0") || text.includes("\r")) throw new Error(`Git packed-refs is malformed: ${path}`);
  const matches: string[] = [];
  let objectIdLength: number | undefined;
  let previousWasRef = false;
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) {
      previousWasRef = false;
      continue;
    }
    if (line.startsWith("^")) {
      if (!previousWasRef || !OBJECT_ID.test(line.slice(1))) throw new Error(`Git packed-refs has malformed peeled line ${index + 1}`);
      continue;
    }
    const match = /^([0-9a-f]+) ([^ ]+)$/u.exec(line);
    if (!match || !OBJECT_ID.test(match[1])) throw new Error(`Git packed-refs has malformed line ${index + 1}`);
    objectIdLength ??= match[1].length;
    if (match[1].length !== objectIdLength) throw new Error("Git packed-refs mixes object ID lengths");
    safeRefName(match[2]);
    if (match[2] === refName) matches.push(match[1]);
    previousWasRef = true;
  }
  if (matches.length > 1) throw new Error(`Git packed-refs is ambiguous for ${refName}`);
  return matches[0] ?? null;
}

async function resolveCheckoutCommit(repositoryRoot: string): Promise<string> {
  const { gitDir, commonDir } = await resolveGitDirectories(repositoryRoot);
  const headPath = join(gitDir, "HEAD");
  const head = oneLine(await readControlText(headPath, "Git HEAD"), "Git HEAD");
  if (!head.startsWith("ref: ")) return assertObjectId(head, "Git HEAD");

  const refName = safeRefName(head.slice("ref: ".length));
  const gitLoose = await readLooseRef(gitDir, refName);
  if (gitLoose !== null) return gitLoose;
  if (commonDir !== gitDir) {
    const commonLoose = await readLooseRef(commonDir, refName);
    if (commonLoose !== null) return commonLoose;
  }
  const packed = await readPackedRef(join(commonDir, "packed-refs"), refName);
  if (packed === null) throw new Error(`Git symbolic ref is missing: ${refName}`);
  return packed;
}

async function computeSourceTreeDigest(sourceRoot: string): Promise<string> {
  const physicalRoot = await canonicalRealDirectory(sourceRoot, "Source root");
  const entries: SourceDigestEntry[] = [];

  const visit = async (directory: string, logicalSegments: readonly string[]): Promise<void> => {
    const identity = await inspectEntry(directory, "Source directory");
    if (identity.kind !== "directory") throw new Error(`Source directory must remain a directory: ${directory}`);
    const names = (await readdir(directory)).sort(compareText);
    await assertSameEntry(identity, "Source directory");
    for (const name of names) {
      const physicalPath = join(directory, name);
      const entry = await inspectEntry(physicalPath, "Source entry");
      if (entry.kind === "directory") {
        await visit(physicalPath, [...logicalSegments, name]);
        continue;
      }
      const bytes = await readStableFile(physicalPath, "Source file");
      entries.push({
        path: ["data", ...logicalSegments, name].join("/"),
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await assertSameEntry(identity, "Source directory");
  };

  await visit(physicalRoot, []);
  entries.sort((left, right) => compareText(left.path, right.path));
  return createHash("sha256").update(canonicalStringify(entries), "utf8").digest("hex");
}

function assertSnapshot(value: CheckoutSourceSnapshot): void {
  assertObjectId(value.sourceCommitSha, "Captured source commit SHA");
  if (!SOURCE_DIGEST.test(value.sourceTreeSha256)) throw new Error("Captured source tree digest must be a lowercase SHA-256");
}

export async function captureCheckoutSource(options: {
  repositoryRoot: string;
  sourceRoot: string;
  expectedCommitSha: string;
}): Promise<CheckoutSourceSnapshot> {
  const expectedCommitSha = assertObjectId(options.expectedCommitSha, "Expected checkout commit SHA");
  const actualCommitSha = await resolveCheckoutCommit(options.repositoryRoot);
  if (actualCommitSha.length !== expectedCommitSha.length || actualCommitSha !== expectedCommitSha) {
    throw new Error(`Checkout commit mismatch: expected ${expectedCommitSha}, got ${actualCommitSha}`);
  }
  return {
    sourceCommitSha: actualCommitSha,
    sourceTreeSha256: await computeSourceTreeDigest(options.sourceRoot),
  };
}

export async function verifyCheckoutSource(options: {
  repositoryRoot: string;
  sourceRoot: string;
  expected: CheckoutSourceSnapshot;
}): Promise<void> {
  assertSnapshot(options.expected);
  const actualCommitSha = await resolveCheckoutCommit(options.repositoryRoot);
  if (actualCommitSha.length !== options.expected.sourceCommitSha.length || actualCommitSha !== options.expected.sourceCommitSha) {
    throw new Error(`Checkout commit changed: expected ${options.expected.sourceCommitSha}, got ${actualCommitSha}`);
  }
  const sourceTreeSha256 = await computeSourceTreeDigest(options.sourceRoot);
  if (sourceTreeSha256 !== options.expected.sourceTreeSha256) {
    throw new Error(`Source tree digest changed: expected ${options.expected.sourceTreeSha256}, got ${sourceTreeSha256}`);
  }
}
