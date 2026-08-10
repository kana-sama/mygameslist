// @vitest-environment node

import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  captureCheckoutSource,
  verifyCheckoutSource,
} from "../scripts/checkout-source-guard";

const SHA40 = "0123456789abcdef0123456789abcdef01234567";
const SHA64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_SHA40 = "89abcdef0123456789abcdef0123456789abcdef";
const SOURCE_DIGEST = "660964a9b766fe64d6f4db632c150c258936214ef40ccd6f1d6f0c3897975564";

let sandbox = "";

afterEach(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
  sandbox = "";
});

async function createSource(root: string, reverse = false): Promise<string> {
  const sourceRoot = join(root, "data");
  await mkdir(sourceRoot, { recursive: true });
  const files: readonly [string, string | Uint8Array][] = reverse
    ? [["z.bin", new Uint8Array([0, 1, 2, 3, 4])], ["a.txt", "alpha\n"]]
    : [["a.txt", "alpha\n"], ["z.bin", new Uint8Array([0, 1, 2, 3, 4])]];
  for (const [name, bytes] of files) await writeFile(join(sourceRoot, name), bytes);
  return sourceRoot;
}

async function createDetachedRepository(sha = SHA40, reverseSource = false): Promise<{
  repositoryRoot: string;
  sourceRoot: string;
}> {
  sandbox = await mkdtemp(join(tmpdir(), "mygameslist-checkout-guard-"));
  const repositoryRoot = join(sandbox, "repository");
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  await writeFile(join(repositoryRoot, ".git", "HEAD"), `${sha}\n`);
  const sourceRoot = await createSource(repositoryRoot, reverseSource);
  return { repositoryRoot, sourceRoot };
}

async function writeLooseRef(repositoryRoot: string, sha: string): Promise<void> {
  const refPath = join(repositoryRoot, ".git", "refs", "heads", "main");
  await mkdir(dirname(refPath), { recursive: true });
  await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(refPath, `${sha}\n`);
}

describe("checkout source guard", () => {
  test.each([SHA40, SHA64])("captures detached %s HEAD and a literal source digest", async (sha) => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository(sha);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: sha })).resolves.toEqual({
      sourceCommitSha: sha,
      sourceTreeSha256: SOURCE_DIGEST,
    });
  });

  test("resolves a safe symbolic loose ref", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await writeLooseRef(repositoryRoot, SHA40);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).resolves.toMatchObject({
      sourceCommitSha: SHA40,
    });
  });

  test("falls back to one unambiguous packed ref", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(repositoryRoot, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled\n${SHA40} refs/heads/main\n`);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).resolves.toMatchObject({
      sourceCommitSha: SHA40,
    });
  });

  test("resolves worktree gitdir and commondir metadata", async () => {
    sandbox = await mkdtemp(join(tmpdir(), "mygameslist-checkout-worktree-"));
    const repositoryRoot = join(sandbox, "worktree");
    const gitDir = join(sandbox, "metadata", "worktrees", "current");
    const commonDir = join(sandbox, "metadata");
    await mkdir(repositoryRoot, { recursive: true });
    await mkdir(gitDir, { recursive: true });
    await mkdir(join(commonDir, "refs", "heads"), { recursive: true });
    await writeFile(join(repositoryRoot, ".git"), `gitdir: ${gitDir}\n`);
    await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(gitDir, "commondir"), "../..\n");
    await writeFile(join(commonDir, "refs", "heads", "main"), `${SHA40}\n`);
    const sourceRoot = await createSource(repositoryRoot);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).resolves.toEqual({
      sourceCommitSha: SHA40,
      sourceTreeSha256: SOURCE_DIGEST,
    });
  });

  test("rejects a supplied commit mismatch before reading source bytes", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await rm(sourceRoot, { recursive: true });

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: OTHER_SHA40 })).rejects.toThrow(/commit|HEAD|mismatch/i);
  });

  test.each([
    ["uppercase expected SHA", SHA40.toUpperCase(), `${SHA40}\n`],
    ["uppercase detached HEAD", SHA40, `${SHA40.toUpperCase()}\n`],
    ["malformed detached HEAD", SHA40, "not-a-commit\n"],
    ["multiple detached values", SHA40, `${SHA40}\n${OTHER_SHA40}\n`],
    ["mixed object-id length", SHA40, `${SHA64}\n`],
  ])("rejects %s", async (_name, expectedCommitSha, head) => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await writeFile(join(repositoryRoot, ".git", "HEAD"), head);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha })).rejects.toThrow();
  });

  test.each([
    ["absolute ref", "ref: /refs/heads/main\n"],
    ["traversing ref", "ref: refs/heads/../../outside\n"],
    ["backslash ref", "ref: refs\\heads\\main\n"],
    ["non-ref namespace", "ref: objects/main\n"],
  ])("rejects an unsafe symbolic %s", async (_name, head) => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await writeFile(join(repositoryRoot, ".git", "HEAD"), head);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).rejects.toThrow(/ref|HEAD/i);
  });

  test("rejects a missing symbolic ref", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/missing\n");

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).rejects.toThrow(/ref|missing|inspect/i);
  });

  test("rejects duplicate packed-ref entries as ambiguous", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(repositoryRoot, ".git", "packed-refs"), `${SHA40} refs/heads/main\n${OTHER_SHA40} refs/heads/main\n`);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).rejects.toThrow(/ambiguous|duplicate|packed/i);
  });

  test.each(["HEAD", "packed-refs"])('rejects symlinked Git control file "$name"', async (name) => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    const controlPath = join(repositoryRoot, ".git", name);
    const outside = join(sandbox, `${name}.outside`);
    if (name === "packed-refs") {
      await writeFile(join(repositoryRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    } else {
      await unlink(controlPath);
    }
    await writeFile(outside, name === "HEAD" ? `${SHA40}\n` : `${SHA40} refs/heads/main\n`);
    await symlink(outside, controlPath);

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).rejects.toThrow(/symlink|control|HEAD|packed/i);
  });

  test("rejects a symlinked .git metadata root", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    const metadata = join(sandbox, "metadata-copy");
    await rename(join(repositoryRoot, ".git"), metadata);
    await symlink(metadata, join(repositoryRoot, ".git"));

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).rejects.toThrow(/symlink|git/i);
  });

  test("source digest is independent of file creation order", async () => {
    const first = await createDetachedRepository(SHA40, true);
    const snapshot = await captureCheckoutSource({ ...first, expectedCommitSha: SHA40 });

    expect(snapshot.sourceTreeSha256).toBe(SOURCE_DIGEST);
  });

  test.each([
    ["byte edit", async (sourceRoot: string) => writeFile(join(sourceRoot, "a.txt"), "changed\n")],
    ["addition", async (sourceRoot: string) => writeFile(join(sourceRoot, "new.txt"), "new")],
    ["removal", async (sourceRoot: string) => unlink(join(sourceRoot, "a.txt"))],
    ["rename", async (sourceRoot: string) => rename(join(sourceRoot, "a.txt"), join(sourceRoot, "renamed.txt"))],
    ["symlink replacement", async (sourceRoot: string) => {
      const outside = join(dirname(sourceRoot), "outside.txt");
      await writeFile(outside, "alpha\n");
      await unlink(join(sourceRoot, "a.txt"));
      await symlink(outside, join(sourceRoot, "a.txt"));
    }],
  ])("verify rejects source %s after capture", async (_name, mutate) => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    const expected = await captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 });
    await mutate(sourceRoot);

    await expect(verifyCheckoutSource({ repositoryRoot, sourceRoot, expected })).rejects.toThrow(/source|digest|symlink/i);
  });

  test("verify rejects a checkout HEAD change after capture", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    const expected = await captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 });
    await writeFile(join(repositoryRoot, ".git", "HEAD"), `${OTHER_SHA40}\n`);

    await expect(verifyCheckoutSource({ repositoryRoot, sourceRoot, expected })).rejects.toThrow(/commit|HEAD|mismatch/i);
  });

  test("unchanged verify preserves the captured literal snapshot", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    const expected = await captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 });

    await expect(verifyCheckoutSource({ repositoryRoot, sourceRoot, expected })).resolves.toBeUndefined();
    expect(expected).toEqual({ sourceCommitSha: SHA40, sourceTreeSha256: SOURCE_DIGEST });
    expect(await readFile(join(sourceRoot, "a.txt"), "utf8")).toBe("alpha\n");
  });

  test("capture rejects a source symlink instead of producing a snapshot", async () => {
    const { repositoryRoot, sourceRoot } = await createDetachedRepository();
    const outside = join(sandbox, "outside-source.txt");
    await writeFile(outside, "alpha\n");
    await unlink(join(sourceRoot, "a.txt"));
    await symlink(outside, join(sourceRoot, "a.txt"));

    await expect(captureCheckoutSource({ repositoryRoot, sourceRoot, expectedCommitSha: SHA40 })).rejects.toThrow(/symlink/i);
  });
});
