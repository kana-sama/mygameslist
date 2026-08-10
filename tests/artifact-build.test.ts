// @vitest-environment node

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { LibraryDatabase } from "../src/domain";
import { projectSourceTree, type SourceAssembly } from "../src/source";
import {
  buildArtifactData,
  createRuntimeArtifactSnapshot,
  ARTIFACT_PROMOTION_PHASES,
  promoteArtifactRoot,
  recoverArtifactPromotion,
  validateArtifactRoot,
} from "../scripts/artifact-root";
import { materializeProjectedSourceTree } from "../scripts/source-tree-fs";
import { validateSourceTree } from "../scripts/validate-source";
import { buildSite } from "../scripts/build-site";
import {
  FILE_BYTES,
  FILE_ID,
  IMAGE_BYTES,
  IMAGE_ID,
  fixtureDatabase,
} from "./fixtures/source-tree";

const SOURCE_SHA = "a".repeat(40);
const EMPTY_REVISION = "fb8456dfea41c6c94ce1c68428b20c666a9070fee01a2a3024951243d30566c4";
const EMPTY_LIBRARY_JSON = "{\"database\":{\"assets\":{},\"games\":{},\"notes\":{},\"publicationId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"revision\":\"fb8456dfea41c6c94ce1c68428b20c666a9070fee01a2a3024951243d30566c4\",\"schemaVersion\":2},\"sourceCommitSha\":null}\n";
const execFileAsync = promisify(execFile);

function emptyAssembly(): SourceAssembly {
  const database: LibraryDatabase = {
    schemaVersion: 2,
    revision: EMPTY_REVISION,
    publicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    games: {},
    notes: {},
    assets: {},
  };
  return {
    database,
    envelope: { sourceCommitSha: null, database },
    runtimeMedia: new Map(),
    sourceAssetOccurrences: 0,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function inventory(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const names = (await readdir(directory)).sort(compareText);
    for (const name of names) {
      const path = join(directory, name);
      const stat = await lstat(path);
      const logical = relative(root, path).split("\\").join("/");
      result.push(stat.isDirectory() ? `${logical}/` : logical);
      if (stat.isDirectory()) await visit(path);
    }
  };
  await visit(root);
  return result.sort(compareText);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function exactTreeState(root: string): Promise<readonly unknown[]> {
  const result: unknown[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort(compareText)) {
      const path = join(directory, name);
      const info = await lstat(path);
      const logical = relative(root, path).split("\\").join("/");
      if (info.isDirectory()) {
        result.push({ path: logical, kind: "directory" });
        await visit(path);
      } else if (info.isFile()) {
        result.push({ path: logical, kind: "file", bytes: [...await readFile(path)] });
      } else if (info.isSymbolicLink()) {
        result.push({ path: logical, kind: "symlink" });
      } else {
        result.push({ path: logical, kind: "unsupported" });
      }
    }
  };
  await visit(root);
  return result;
}

describe("deterministic artifact roots", () => {
  let sandbox = "";

  beforeEach(async () => {
    sandbox = await mkdtemp(join(await realpath("/tmp"), "mglartifact-"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  async function createSource(name: string, sourceCommitSha: string | null = SOURCE_SHA): Promise<{
    sourceRoot: string;
    assembly: SourceAssembly;
  }> {
    const sourceRoot = join(sandbox, name, "data");
    await mkdir(join(sandbox, name), { recursive: true });
    const projection = await projectSourceTree(fixtureDatabase());
    await materializeProjectedSourceTree({
      targetSourceRoot: sourceRoot,
      projection,
      async resolveAssetBytes(leaf) {
        return leaf.assetId === IMAGE_ID ? IMAGE_BYTES.slice() : FILE_BYTES.slice();
      },
    });
    const assembly = await validateSourceTree({ sourceRoot, sourceCommitSha });
    return { sourceRoot, assembly };
  }

  async function createValidatedArtifact(
    sourceRoot: string,
    root: string,
    sourceCommitSha: string | null = SOURCE_SHA,
  ): Promise<SourceAssembly> {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<main>new shell</main>");
    await writeFile(join(root, "assets", "new.js"), "new shell bytes");
    return buildArtifactData(sourceRoot, root, sourceCommitSha);
  }

  async function createPreviousArtifact(root: string): Promise<void> {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<main>old shell</main>");
    await writeFile(join(root, "assets", "old.js"), "old shell bytes");
  }

  function promotionPaths(outputRoot: string, operationId: string) {
    const parent = dirname(outputRoot);
    const outputName = basename(outputRoot);
    return {
      stagingRoot: join(parent, `.${outputName}.mygameslist-artifact-staging-${operationId}`),
      backupRoot: join(parent, `.${outputName}.mygameslist-artifact-backup-${operationId}`),
      recoveryRoot: join(parent, `.${outputName}.mygameslist-artifact-recovery-${operationId}`),
      journalPath: join(parent, `.${outputName}.mygameslist-artifact-promotion.json`),
      temporaryJournalPath: join(parent, `.${outputName}.mygameslist-artifact-promotion.tmp`),
    };
  }

  async function generatedBytes(root: string): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    for (const path of await inventory(root)) {
      if (path.endsWith("/") || (!path.startsWith("data/") && !path.startsWith("media/"))) continue;
      files.set(path, new Uint8Array(await readFile(join(root, ...path.split("/")))));
    }
    return files;
  }

  function expectByteMapsEqual(actual: ReadonlyMap<string, Uint8Array>, expected: ReadonlyMap<string, Uint8Array>): void {
    expect([...actual.keys()].sort(compareText)).toEqual([...expected.keys()].sort(compareText));
    for (const [path, bytes] of expected) expect(actual.get(path), path).toEqual(bytes);
  }

  test("creates literal canonical envelope bytes and clones every runtime byte array", async () => {
    const emptySnapshot = createRuntimeArtifactSnapshot(emptyAssembly());
    expect(new TextDecoder().decode(emptySnapshot.libraryJson)).toBe(EMPTY_LIBRARY_JSON);
    expect([...emptySnapshot.media]).toEqual([]);

    const { assembly } = await createSource("snapshot");
    const snapshot = createRuntimeArtifactSnapshot(assembly);
    expect([...snapshot.media.keys()]).toEqual([
      `${FILE_ID}.bin`,
      `${IMAGE_ID}.webp`,
    ]);
    expect(snapshot.media.get(`${FILE_ID}.bin`)).toEqual({
      bytes: FILE_BYTES,
      contentType: "application/x-mygameslist-save",
    });
    expect(snapshot.media.get(`${IMAGE_ID}.webp`)).toEqual({
      bytes: IMAGE_BYTES,
      contentType: "image/webp",
    });

    assembly.runtimeMedia.get(`${FILE_ID}.bin`)![0] = 255;
    expect(snapshot.media.get(`${FILE_ID}.bin`)!.bytes).toEqual(FILE_BYTES);
  });

  test("replaces stale generated namespaces with one exact validated data/media snapshot", async () => {
    const { sourceRoot, assembly } = await createSource("artifact");
    const stagingRoot = join(sandbox, "site-staging");
    await mkdir(join(stagingRoot, "assets"), { recursive: true });
    await mkdir(join(stagingRoot, "data", "stale"), { recursive: true });
    await mkdir(join(stagingRoot, "media", "nested"), { recursive: true });
    await writeFile(join(stagingRoot, "index.html"), "<main>shell</main>");
    await writeFile(join(stagingRoot, ".nojekyll"), "");
    await writeFile(join(stagingRoot, "assets", "shell.js"), "shell bytes");
    await writeFile(join(stagingRoot, "data", "stale", "old.yaml"), "stale source");
    await writeFile(join(stagingRoot, "media", "nested", "orphan.bin"), "orphan");

    const result = await buildArtifactData(sourceRoot, stagingRoot, SOURCE_SHA);

    expect(result.envelope).toEqual(assembly.envelope);
    expect(await inventory(stagingRoot)).toEqual([
      ".nojekyll",
      "assets/",
      "assets/shell.js",
      "data/",
      "data/library.json",
      "index.html",
      "media/",
      `media/${FILE_ID}.bin`,
      `media/${IMAGE_ID}.webp`,
    ]);
    expect(await readFile(join(stagingRoot, "index.html"), "utf8")).toBe("<main>shell</main>");
    expect(await readFile(join(stagingRoot, "assets", "shell.js"), "utf8")).toBe("shell bytes");
    expect(new Uint8Array(await readFile(join(stagingRoot, "media", `${FILE_ID}.bin`)))).toEqual(FILE_BYTES);
    expect(new Uint8Array(await readFile(join(stagingRoot, "media", `${IMAGE_ID}.webp`)))).toEqual(IMAGE_BYTES);
    await expect(validateArtifactRoot(stagingRoot, assembly)).resolves.toBeUndefined();
  });

  test("unlinks top-level generated symlinks without following them and installs real namespaces", async () => {
    const { sourceRoot, assembly } = await createSource("linked-generated-source");
    const stagingRoot = join(sandbox, "linked-generated-staging");
    const outsideData = join(sandbox, "outside-data");
    const outsideMedia = join(sandbox, "outside-media");
    await mkdir(stagingRoot);
    await mkdir(outsideData);
    await mkdir(outsideMedia);
    await writeFile(join(stagingRoot, "index.html"), "<main>shell</main>");
    await writeFile(join(outsideData, "sentinel.txt"), "data sentinel");
    await writeFile(join(outsideMedia, "sentinel.txt"), "media sentinel");
    await symlink(outsideData, join(stagingRoot, "data"));
    await symlink(outsideMedia, join(stagingRoot, "media"));

    await expect(buildArtifactData(sourceRoot, stagingRoot, SOURCE_SHA)).resolves.toEqual(assembly);

    expect((await lstat(join(stagingRoot, "data"))).isDirectory()).toBe(true);
    expect((await lstat(join(stagingRoot, "media"))).isDirectory()).toBe(true);
    expect(await readFile(join(outsideData, "sentinel.txt"), "utf8")).toBe("data sentinel");
    expect(await readFile(join(outsideMedia, "sentinel.txt"), "utf8")).toBe("media sentinel");
    await expect(validateArtifactRoot(stagingRoot, assembly)).resolves.toBeUndefined();
  });

  test("rejects source and staging roots that have distinct paths but the same device/inode identity", async () => {
    const { sourceRoot } = await createSource("identity-alias-source");
    const stagingRoot = join(sandbox, "identity-alias-staging");
    await mkdir(stagingRoot);
    await writeFile(join(stagingRoot, "index.html"), "<main>shell</main>");
    const sourceIdentity = await stat(sourceRoot, { bigint: true });
    const buildWithIdentityFixture = buildArtifactData as unknown as (
      source: string,
      staging: string,
      sha: string | null,
      fixture: { rootIdentityForAliasCheck(path: string): Promise<{ device: bigint; inode: bigint }> },
    ) => Promise<SourceAssembly>;

    await expect(buildWithIdentityFixture(sourceRoot, stagingRoot, SOURCE_SHA, {
      async rootIdentityForAliasCheck() {
        return { device: sourceIdentity.dev, inode: sourceIdentity.ino };
      },
    })).rejects.toThrow(/alias|identity/i);
    expect(await readFile(join(stagingRoot, "index.html"), "utf8")).toBe("<main>shell</main>");
  });

  test("rejects distinct staging/output promotion roots with the same device/inode fixture", async () => {
    const { sourceRoot } = await createSource("promotion-identity-source");
    const outputRoot = join(sandbox, "promotion-identity", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const paths = promotionPaths(outputRoot, randomUUID());
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    const stagingIdentity = await stat(paths.stagingRoot, { bigint: true });
    const options = {
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      async rootIdentityForAliasCheck(_path: string) {
        return { device: stagingIdentity.dev, inode: stagingIdentity.ino };
      },
    };

    await expect(promoteArtifactRoot(options)).rejects.toThrow(/alias|identity/i);
    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
    expect(await exists(paths.journalPath)).toBe(false);
  });

  test.each([
    {
      name: "missing library",
      mutate: async (root: string) => rm(join(root, "data", "library.json")),
    },
    {
      name: "extra source YAML",
      mutate: async (root: string) => writeFile(join(root, "data", "game.yaml"), "source: forbidden\n"),
    },
    {
      name: "wrong-case media name",
      mutate: async (root: string) => rename(
        join(root, "media", `${IMAGE_ID}.webp`),
        join(root, "media", `${IMAGE_ID.toUpperCase()}.webp`),
      ),
    },
    {
      name: "nested media",
      mutate: async (root: string) => {
        await mkdir(join(root, "media", "nested"));
        await rename(join(root, "media", `${IMAGE_ID}.webp`), join(root, "media", "nested", `${IMAGE_ID}.webp`));
      },
    },
    {
      name: "same-count corrupt media",
      mutate: async (root: string) => writeFile(join(root, "media", `${FILE_ID}.bin`), new Uint8Array([4, 3, 2, 1, 0])),
    },
    {
      name: "symlink anywhere in shell",
      mutate: async (root: string) => {
        const outside = join(dirname(root), "outside-shell-target.txt");
        await writeFile(outside, "outside");
        await symlink(outside, join(root, "linked-shell.txt"));
      },
    },
  ])("rejects $name with the physical artifact path", async ({ name: _name, mutate }) => {
    const { sourceRoot, assembly } = await createSource(`invalid-structure-${_name.replaceAll(" ", "-")}`);
    const root = join(sandbox, `invalid-structure-artifact-${_name.replaceAll(" ", "-")}`);
    await createValidatedArtifact(sourceRoot, root);
    await mutate(root);

    await expect(validateArtifactRoot(root, assembly)).rejects.toThrow(root);
  });

  test("rejects an unsupported filesystem entry anywhere in the shell", async () => {
    const { sourceRoot, assembly } = await createSource("unsupported-shell-source");
    const root = join(sandbox, "unsupported-shell-artifact");
    await createValidatedArtifact(sourceRoot, root);
    const fifoPath = join(root, "unsupported.fifo");
    await execFileAsync("mkfifo", [fifoPath]);

    await expect(validateArtifactRoot(root, assembly)).rejects.toThrow(fifoPath);
  });

  test.each([
    {
      name: "malformed JSON",
      mutate: (_parsed: Record<string, unknown>) => "{\n",
    },
    {
      name: "extra envelope key",
      mutate: (parsed: Record<string, unknown>) => `${JSON.stringify({ ...parsed, unexpected: true })}\n`,
    },
    {
      name: "extra database key",
      mutate: (parsed: Record<string, unknown>) => `${JSON.stringify({
        ...parsed,
        database: { ...(parsed.database as Record<string, unknown>), unexpected: true },
      })}\n`,
    },
    {
      name: "wrong provenance",
      mutate: (parsed: Record<string, unknown>) => `${JSON.stringify({ ...parsed, sourceCommitSha: "b".repeat(40) })}\n`,
    },
    {
      name: "noncanonical whitespace",
      mutate: (parsed: Record<string, unknown>) => `${JSON.stringify(parsed, null, 2)}\n`,
    },
  ])("rejects $name library bytes with the physical library path", async ({ name, mutate }) => {
    const { sourceRoot, assembly } = await createSource(`invalid-library-${name.replaceAll(" ", "-")}`);
    const root = join(sandbox, `invalid-library-artifact-${name.replaceAll(" ", "-")}`);
    await createValidatedArtifact(sourceRoot, root);
    const libraryPath = join(root, "data", "library.json");
    const parsed = JSON.parse(await readFile(libraryPath, "utf8")) as Record<string, unknown>;
    await writeFile(libraryPath, mutate(parsed));

    await expect(validateArtifactRoot(root, assembly)).rejects.toThrow(libraryPath);
  });

  test.each(ARTIFACT_PROMOTION_PHASES)("recovers an exact complete new root after interruption at %s", async (phase) => {
    const { sourceRoot } = await createSource(`phase-source-${phase}`);
    const outputRoot = join(sandbox, `phase-${phase}`, "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);

    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(current) {
        if (current === phase) throw new Error(`stop at ${phase}`);
      },
    })).rejects.toThrow(`stop at ${phase}`);

    const expectedDurableState = {
      "staging-validated": { output: "old", staging: true, backup: false, journal: false },
      "journal-persisted": { output: "old", staging: true, backup: false, journal: true },
      "previous-backed-up": { output: "absent", staging: true, backup: true, journal: true },
      "staging-promoted": { output: "new", staging: false, backup: true, journal: true },
      "promoted-validated": { output: "new", staging: false, backup: true, journal: true },
      "backup-removed": { output: "new", staging: false, backup: false, journal: true },
      "journal-removed": { output: "new", staging: false, backup: false, journal: false },
    } as const;
    const durable = expectedDurableState[phase];
    expect(await exists(outputRoot), `output after ${phase}`).toBe(durable.output !== "absent");
    expect(await exists(paths.stagingRoot), `staging after ${phase}`).toBe(durable.staging);
    expect(await exists(paths.backupRoot), `backup after ${phase}`).toBe(durable.backup);
    expect(await exists(paths.journalPath), `journal after ${phase}`).toBe(durable.journal);
    expect(await exists(paths.temporaryJournalPath), `temporary journal after ${phase}`).toBe(false);
    if (durable.output !== "absent") {
      expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe(
        durable.output === "old" ? "<main>old shell</main>" : "<main>new shell</main>",
      );
    }
    if (durable.backup) {
      expect(await readFile(join(paths.backupRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
    }

    if (phase === "staging-validated") {
      expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
      await expect(lstat(paths.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await promoteArtifactRoot({ stagingRoot: paths.stagingRoot, outputRoot, expected });

    await expect(validateArtifactRoot(outputRoot, expected)).resolves.toBeUndefined();
    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>new shell</main>");
    await expect(lstat(paths.stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(paths.backupRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(paths.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(paths.temporaryJournalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves a corrupt staged root under recovery and restores the exact previous artifact", async () => {
    const { sourceRoot } = await createSource("restore-source");
    const outputRoot = join(sandbox, "restore", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(phase) {
        if (phase === "previous-backed-up") throw new Error("stop after backup");
      },
    })).rejects.toThrow("stop after backup");
    await writeFile(join(paths.stagingRoot, "data", "library.json"), "corrupt staged bytes");

    await recoverArtifactPromotion({ outputRoot });

    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
    expect(await readFile(join(paths.recoveryRoot, "data", "library.json"), "utf8")).toBe("corrupt staged bytes");
    await expect(lstat(paths.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("moves an invalid promoted root aside before restoring the exact backup", async () => {
    const { sourceRoot } = await createSource("invalid-promoted-source");
    const outputRoot = join(sandbox, "invalid-promoted", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(phase) {
        if (phase === "staging-promoted") throw new Error("stop after promote");
      },
    })).rejects.toThrow("stop after promote");
    await writeFile(join(outputRoot, "index.html"), "unexpected promoted bytes");

    await recoverArtifactPromotion({ outputRoot });

    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
    expect(await readFile(join(paths.recoveryRoot, "index.html"), "utf8")).toBe("unexpected promoted bytes");
    await expect(lstat(paths.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("freshly syncs and promotes an exact temporary journal before recovery mutates roots", async () => {
    const { sourceRoot } = await createSource("temporary-journal-source");
    const outputRoot = join(sandbox, "temporary-journal", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop after journal install");
      },
    })).rejects.toThrow("stop after journal install");
    await rename(paths.journalPath, paths.temporaryJournalPath);

    await recoverArtifactPromotion({ outputRoot });

    await expect(validateArtifactRoot(outputRoot, expected)).resolves.toBeUndefined();
    await expect(lstat(paths.stagingRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(paths.backupRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(paths.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(paths.temporaryJournalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    {
      name: "partial JSON",
      mutate: (_journal: Record<string, unknown>) => "{\"version\":1",
    },
    {
      name: "unknown key",
      mutate: (journal: Record<string, unknown>) => `${JSON.stringify({ ...journal, unknown: true })}\n`,
    },
    {
      name: "unknown version",
      mutate: (journal: Record<string, unknown>) => `${JSON.stringify({ ...journal, version: 2 })}\n`,
    },
    {
      name: "wrong output",
      mutate: (journal: Record<string, unknown>) => `${JSON.stringify({
        ...journal,
        outputRoot: join(dirname(String(journal.outputRoot)), "other-output"),
      })}\n`,
    },
    {
      name: "wrong operation ID",
      mutate: (journal: Record<string, unknown>) => `${JSON.stringify({ ...journal, operationId: randomUUID() })}\n`,
    },
    {
      name: "unsafe recovery path",
      mutate: (journal: Record<string, unknown>) => `${JSON.stringify({ ...journal, recoveryRoot: "/" })}\n`,
    },
    {
      name: "malformed fingerprint",
      mutate: (journal: Record<string, unknown>) => `${JSON.stringify({ ...journal, newRootSha256: "f".repeat(63) })}\n`,
    },
  ])("preserves every byte and path for a $name promotion journal", async ({ name, mutate }) => {
    const { sourceRoot } = await createSource(`bad-journal-source-${name.replaceAll(" ", "-")}`);
    const outputRoot = join(sandbox, `bad-journal-${name.replaceAll(" ", "-")}`, "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop with journal");
      },
    })).rejects.toThrow("stop with journal");
    const journal = JSON.parse(await readFile(paths.journalPath, "utf8")) as Record<string, unknown>;
    await writeFile(paths.journalPath, mutate(journal));
    const before = await exactTreeState(dirname(outputRoot));

    await expect(recoverArtifactPromotion({ outputRoot })).rejects.toThrow();

    expect(await exactTreeState(dirname(outputRoot))).toEqual(before);
    expect(await exists(paths.journalPath)).toBe(true);
  });

  test("a corrupt temporary journal is never promoted and causes zero root mutation", async () => {
    const { sourceRoot } = await createSource("corrupt-temporary-source");
    const outputRoot = join(sandbox, "corrupt-temporary", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop with journal");
      },
    })).rejects.toThrow("stop with journal");
    await rename(paths.journalPath, paths.temporaryJournalPath);
    await writeFile(paths.temporaryJournalPath, "corrupt temporary journal");
    const before = await exactTreeState(dirname(outputRoot));

    await expect(recoverArtifactPromotion({ outputRoot })).rejects.toThrow();

    expect(await exactTreeState(dirname(outputRoot))).toEqual(before);
    expect(await exists(paths.temporaryJournalPath)).toBe(true);
    expect(await exists(paths.journalPath)).toBe(false);
  });

  test("never unlinks journal bytes that changed after authoritative recovery parsing", async () => {
    const { sourceRoot } = await createSource("journal-removal-race-source");
    const outputRoot = join(sandbox, "journal-removal-race", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(phase) {
        if (phase === "backup-removed") throw new Error("stop before journal removal");
      },
    })).rejects.toThrow("stop before journal removal");
    let hookCalls = 0;
    const recoveryOptions = {
      outputRoot,
      async beforeJournalRemoval(journalPath: string) {
        hookCalls += 1;
        await writeFile(journalPath, "replacement diagnostic journal");
      },
    };

    await expect(recoverArtifactPromotion(recoveryOptions)).rejects.toThrow(/changed before removal/i);

    expect(hookCalls).toBe(1);
    expect(await readFile(paths.journalPath, "utf8")).toBe("replacement diagnostic journal");
    await expect(validateArtifactRoot(outputRoot, expected)).resolves.toBeUndefined();
  });

  test("promotes with no previous output and preserves an unrecoverable no-previous journal", async () => {
    const { sourceRoot } = await createSource("no-previous-source");
    const successfulOutput = join(sandbox, "no-previous-success", "dist");
    await mkdir(dirname(successfulOutput), { recursive: true });
    const successfulPaths = promotionPaths(successfulOutput, randomUUID());
    const successfulExpected = await createValidatedArtifact(sourceRoot, successfulPaths.stagingRoot);

    await expect(promoteArtifactRoot({
      stagingRoot: successfulPaths.stagingRoot,
      outputRoot: successfulOutput,
      expected: successfulExpected,
      afterPhase(phase) {
        if (phase === "previous-backed-up") throw new Error("stop with valid no-previous staging");
      },
    })).rejects.toThrow("stop with valid no-previous staging");
    expect(await exists(successfulOutput)).toBe(false);
    expect(await exists(successfulPaths.stagingRoot)).toBe(true);
    expect(await exists(successfulPaths.journalPath)).toBe(true);
    await recoverArtifactPromotion({ outputRoot: successfulOutput });
    await expect(validateArtifactRoot(successfulOutput, successfulExpected)).resolves.toBeUndefined();

    const failedOutput = join(sandbox, "no-previous-failure", "dist");
    await mkdir(dirname(failedOutput), { recursive: true });
    const failedPaths = promotionPaths(failedOutput, randomUUID());
    const failedExpected = await createValidatedArtifact(sourceRoot, failedPaths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: failedPaths.stagingRoot,
      outputRoot: failedOutput,
      expected: failedExpected,
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop with no previous root");
      },
    })).rejects.toThrow("stop with no previous root");
    await rm(failedPaths.stagingRoot, { recursive: true });

    await expect(recoverArtifactPromotion({ outputRoot: failedOutput })).rejects.toThrow(/preserv/i);
    expect(await exists(failedOutput)).toBe(false);
    expect(await exists(failedPaths.journalPath)).toBe(true);
  });

  test.each([
    { phase: "previous-backed-up", movedRoot: "staging", outputInitiallyExists: false },
    { phase: "staging-promoted", movedRoot: "output", outputInitiallyExists: true },
    { phase: "journal-persisted", movedRoot: "staging", outputInitiallyExists: true },
  ] as const)("resumes recovery after its invalid $movedRoot preservation move from $phase", async ({ phase, movedRoot, outputInitiallyExists }) => {
    const { sourceRoot } = await createSource(`restart-recovery-source-${phase}`);
    const outputRoot = join(sandbox, `restart-recovery-${phase}`, "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const operationId = randomUUID();
    const paths = promotionPaths(outputRoot, operationId);
    const expected = await createValidatedArtifact(sourceRoot, paths.stagingRoot);
    await expect(promoteArtifactRoot({
      stagingRoot: paths.stagingRoot,
      outputRoot,
      expected,
      afterPhase(current) {
        if (current === phase) throw new Error(`stop at ${phase}`);
      },
    })).rejects.toThrow(`stop at ${phase}`);
    const corruptRoot = movedRoot === "output" ? outputRoot : paths.stagingRoot;
    await writeFile(join(corruptRoot, "index.html"), `corrupt ${phase}`);
    await rename(corruptRoot, paths.recoveryRoot);

    await recoverArtifactPromotion({ outputRoot });

    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
    expect(await readFile(join(paths.recoveryRoot, "index.html"), "utf8")).toBe(`corrupt ${phase}`);
    expect((await lstat(outputRoot)).isDirectory()).toBe(outputInitiallyExists || phase === "previous-backed-up");
    await expect(lstat(paths.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("semantic library validation includes the physical library path", async () => {
    const { sourceRoot, assembly } = await createSource("semantic-library-path");
    const root = join(sandbox, "semantic-library-artifact");
    await createValidatedArtifact(sourceRoot, root);
    const libraryPath = join(root, "data", "library.json");
    const parsed = JSON.parse(await readFile(libraryPath, "utf8"));
    parsed.unexpected = true;
    await writeFile(libraryPath, `${JSON.stringify(parsed)}\n`);

    await expect(validateArtifactRoot(root, assembly)).rejects.toThrow(libraryPath);
  });

  test("full Vite and cached-shell builds converge on byte-identical generated namespaces", async () => {
    const { sourceRoot } = await createSource("site-source");
    const cachedShell = join(sandbox, "cached-shell");
    await mkdir(join(cachedShell, "assets"), { recursive: true });
    await mkdir(join(cachedShell, "data", "stale"), { recursive: true });
    await mkdir(join(cachedShell, "media", "nested"), { recursive: true });
    await writeFile(join(cachedShell, "index.html"), "<main>cached shell</main>");
    await writeFile(join(cachedShell, ".nojekyll"), "");
    await writeFile(join(cachedShell, "assets", "cached.js"), "cached shell bytes");
    await writeFile(join(cachedShell, "data", "stale", "source.yaml"), "stale");
    await writeFile(join(cachedShell, "media", "nested", "orphan.bin"), "orphan");

    const viteRoot = join(sandbox, "vite-shell");
    await mkdir(join(viteRoot, "public", "data"), { recursive: true });
    await mkdir(join(viteRoot, "public", "media"), { recursive: true });
    await writeFile(join(viteRoot, "index.html"), "<main id=app></main><script type=module src=/main.js></script>");
    await writeFile(join(viteRoot, "main.js"), "document.querySelector('#app').textContent = 'vite shell';");
    await writeFile(join(viteRoot, "public", ".nojekyll"), "");
    await writeFile(join(viteRoot, "public", "data", "library.json"), "stale legacy database");
    await writeFile(join(viteRoot, "public", "media", "orphan.bin"), "stale legacy media");

    const cachedArtifact = join(sandbox, "cached-artifact");
    const viteArtifact = join(sandbox, "vite-artifact");
    const cachedResult = await buildSite({
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "cached", shellRoot: cachedShell },
      destination: { kind: "staging", artifactRoot: cachedArtifact },
    });
    const viteResult = await buildSite({
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "vite", projectRoot: viteRoot, configFile: false },
      destination: { kind: "staging", artifactRoot: viteArtifact },
    });

    expect(cachedResult.artifactRoot).toBe(cachedArtifact);
    expect(viteResult.artifactRoot).toBe(viteArtifact);
    expect(cachedResult.assembly.envelope).toEqual(viteResult.assembly.envelope);
    expectByteMapsEqual(await generatedBytes(cachedArtifact), await generatedBytes(viteArtifact));
    expect(await readFile(join(cachedArtifact, "assets", "cached.js"), "utf8")).toBe("cached shell bytes");
    expect(await readFile(join(viteArtifact, ".nojekyll"), "utf8")).toBe("");
    expect((await inventory(cachedArtifact)).some((path) => path.includes("stale") || path.includes("orphan"))).toBe(false);
    expect((await inventory(viteArtifact)).some((path) => path.includes("orphan"))).toBe(false);
  });

  test("null, 40-hex, and 64-hex provenance change only the envelope and never the semantic revision", async () => {
    const { sourceRoot } = await createSource("provenance-source");
    const cases = [null, "c".repeat(40), "d".repeat(64)] as const;
    const assemblies: SourceAssembly[] = [];
    for (const [index, sourceCommitSha] of cases.entries()) {
      const root = join(sandbox, `provenance-artifact-${index}`);
      await mkdir(root);
      await writeFile(join(root, "index.html"), "<main>shell</main>");
      const assembly = await buildArtifactData(sourceRoot, root, sourceCommitSha);
      const envelope = JSON.parse(await readFile(join(root, "data", "library.json"), "utf8"));
      expect(envelope.sourceCommitSha).toBe(sourceCommitSha);
      assemblies.push(assembly);
    }

    expect(new Set(assemblies.map((assembly) => assembly.database.revision))).toHaveProperty("size", 1);
    expect(assemblies.map((assembly) => assembly.database)).toEqual([
      assemblies[0].database,
      assemblies[0].database,
      assemblies[0].database,
    ]);
  });

  test("reversed source materialization order produces byte-identical generated namespaces", async () => {
    const projection = await projectSourceTree(fixtureDatabase());
    const sourceRoots = [join(sandbox, "ordered-source"), join(sandbox, "reversed-source")];
    await materializeProjectedSourceTree({
      targetSourceRoot: sourceRoots[0],
      projection,
      async resolveAssetBytes(leaf) {
        return leaf.assetId === IMAGE_ID ? IMAGE_BYTES.slice() : FILE_BYTES.slice();
      },
    });
    await materializeProjectedSourceTree({
      targetSourceRoot: sourceRoots[1],
      projection: { ...projection, leaves: [...projection.leaves].reverse() },
      async resolveAssetBytes(leaf) {
        return leaf.assetId === IMAGE_ID ? IMAGE_BYTES.slice() : FILE_BYTES.slice();
      },
    });
    const roots = [join(sandbox, "ordered-artifact"), join(sandbox, "reversed-artifact")];
    for (const root of roots) {
      await mkdir(root);
      await writeFile(join(root, "index.html"), "<main>same shell</main>");
    }

    await buildArtifactData(sourceRoots[0], roots[0], SOURCE_SHA);
    await buildArtifactData(sourceRoots[1], roots[1], SOURCE_SHA);

    expectByteMapsEqual(await generatedBytes(roots[0]), await generatedBytes(roots[1]));
  });

  test("a cached-shell symlink fails without mutating the previous promoted output", async () => {
    const { sourceRoot } = await createSource("invalid-shell-source");
    const outputRoot = join(sandbox, "invalid-shell-output", "dist");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    const previousInventory = await inventory(outputRoot);
    const shellRoot = join(sandbox, "invalid-cached-shell");
    await mkdir(shellRoot);
    await writeFile(join(shellRoot, "index.html"), "<main>shell</main>");
    await writeFile(join(sandbox, "outside-shell.txt"), "outside bytes");
    await symlink(join(sandbox, "outside-shell.txt"), join(shellRoot, "linked-shell.txt"));

    await expect(buildSite({
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "cached", shellRoot },
      destination: { kind: "promoted", outputRoot },
    })).rejects.toThrow(/symlink|shell/i);

    expect(await inventory(outputRoot)).toEqual(previousInventory);
    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
  });

  test("invalid source generation removes only its fresh staging root and leaves the old output byte-exact", async () => {
    const { sourceRoot } = await createSource("invalid-promoted-source-build");
    await writeFile(join(sourceRoot, "manifest.yaml"), "invalid: source\n");
    const outputRoot = join(sandbox, "invalid-promoted-source-output", "dist");
    const shellRoot = join(sandbox, "invalid-promoted-source-shell");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    await mkdir(shellRoot);
    await writeFile(join(shellRoot, "index.html"), "<main>new shell</main>");
    const before = await exactTreeState(dirname(outputRoot));

    await expect(buildSite({
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "cached", shellRoot },
      destination: { kind: "promoted", outputRoot },
    })).rejects.toThrow(/manifest|source/i);

    expect(await exactTreeState(dirname(outputRoot))).toEqual(before);
    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
  });

  test("rejects a promoted output that equals or overlaps the source tree before recovery or shell mutation", async () => {
    const { sourceRoot } = await createSource("source-output-overlap");
    const manifestBefore = await readFile(join(sourceRoot, "manifest.yaml"));
    const shellRoot = join(sandbox, "source-output-overlap-shell");
    await mkdir(shellRoot);
    await writeFile(join(shellRoot, "index.html"), "<main>shell</main>");

    await expect(buildSite({
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "cached", shellRoot },
      destination: { kind: "promoted", outputRoot: sourceRoot },
    })).rejects.toThrow(/overlap|source/i);

    expect(await readFile(join(sourceRoot, "manifest.yaml"))).toEqual(manifestBefore);
    expect(await exists(join(dirname(sourceRoot), `.${basename(sourceRoot)}.mygameslist-artifact-promotion.json`))).toBe(false);
  });

  test("rejects distinct source/output paths with the same device/inode fixture before output mutation", async () => {
    const { sourceRoot } = await createSource("source-output-identity");
    const outputRoot = join(sandbox, "source-output-identity-output", "dist");
    const shellRoot = join(sandbox, "source-output-identity-shell");
    await mkdir(dirname(outputRoot), { recursive: true });
    await createPreviousArtifact(outputRoot);
    await mkdir(shellRoot);
    await writeFile(join(shellRoot, "index.html"), "<main>shell</main>");
    const sourceIdentity = await stat(sourceRoot, { bigint: true });
    const options = {
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "cached", shellRoot } as const,
      destination: { kind: "promoted", outputRoot } as const,
      async rootIdentityForAliasCheck(_path: string) {
        return { device: sourceIdentity.dev, inode: sourceIdentity.ino };
      },
    };

    await expect(buildSite(options)).rejects.toThrow(/alias|identity/i);
    expect(await readFile(join(outputRoot, "index.html"), "utf8")).toBe("<main>old shell</main>");
    expect(await exists(join(dirname(outputRoot), `.${basename(outputRoot)}.mygameslist-artifact-promotion.json`))).toBe(false);
  });

  test("full Vite mode rejects a symlinked staging parent before writing through it", async () => {
    const { sourceRoot } = await createSource("vite-parent-source");
    const viteRoot = join(sandbox, "vite-parent-project");
    const victimParent = join(sandbox, "vite-parent-victim");
    const aliasParent = join(sandbox, "vite-parent-alias");
    await mkdir(viteRoot);
    await mkdir(victimParent);
    await writeFile(join(viteRoot, "index.html"), "<main>safe shell</main>");
    await symlink(victimParent, aliasParent);
    const victimMtimeBefore = (await stat(victimParent, { bigint: true })).mtimeNs;

    await expect(buildSite({
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "vite", projectRoot: viteRoot, configFile: false },
      destination: { kind: "staging", artifactRoot: join(aliasParent, "artifact") },
    })).rejects.toThrow(/symlink|parent/i);

    expect(await readdir(victimParent)).toEqual([]);
    expect((await stat(victimParent, { bigint: true })).mtimeNs).toBe(victimMtimeBefore);
  });

  test("cleanup preserves a replacement that is not the fresh staging root created by buildSite", async () => {
    const { sourceRoot } = await createSource("cleanup-identity-source");
    await writeFile(join(sourceRoot, "manifest.yaml"), "invalid: source\n");
    const shellRoot = join(sandbox, "cleanup-shell");
    const artifactRoot = join(sandbox, "cleanup-artifact");
    const movedOriginal = join(sandbox, "cleanup-original");
    await mkdir(shellRoot);
    await writeFile(join(shellRoot, "index.html"), "<main>shell</main>");
    const options = {
      sourceRoot,
      sourceCommitSha: SOURCE_SHA,
      shell: { kind: "cached", shellRoot } as const,
      destination: { kind: "staging", artifactRoot } as const,
      async beforeCleanup(path: string) {
        await rename(path, movedOriginal);
        await mkdir(path);
        await writeFile(join(path, "replacement-sentinel.txt"), "replacement");
      },
    };

    await expect(buildSite(options)).rejects.toThrow(/cleanup|identity changed/i);

    expect(await readFile(join(artifactRoot, "replacement-sentinel.txt"), "utf8")).toBe("replacement");
    expect(await readFile(join(movedOriginal, "index.html"), "utf8")).toBe("<main>shell</main>");
  });
});
