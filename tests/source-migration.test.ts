import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  computeLibraryRevision,
  runtimeAssetFilename,
  sha256Bytes,
  type LibraryDatabase,
} from "../src/domain";
import { projectSourceTree } from "../src/source";
import {
  FILE_BYTES,
  FILE_ID,
  GAME_B_ID,
  IMAGE_BYTES,
  IMAGE_ID,
  NOTE_ATTACHMENTS_ID,
  NOTE_EMPTY_ID,
  fixtureDatabase,
} from "./fixtures/source-tree";
import { validateSourceTree } from "../scripts/validate-source";
import {
  MIGRATION_PHASES,
  migrateLibrarySource,
  type MigrateLibrarySourceOptions,
  type MigrationCounts,
  type MigrationPhase,
  type MigrationReport,
} from "../scripts/migrate-library-source";

const execFileAsync = promisify(execFile);
const EXPECTED_COUNTS: MigrationCounts = {
  games: 2,
  notes: 3,
  uniqueAssets: 2,
  sourceAssetOccurrences: 3,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalFixtureHash(value: readonly Record<string, unknown>[]): string {
  const orderedKeys = value.map((entry) => Object.fromEntries(Object.entries(entry).sort(([left], [right]) => compareText(left, right))));
  return sha(new TextEncoder().encode(JSON.stringify(orderedKeys)));
}

interface LegacyFixture {
  root: string;
  legacyLibraryPath: string;
  legacyMediaRoot: string;
  targetSourceRoot: string;
  journalPath: string;
  stagingSourceRoot: string;
  legacyDatabase: LibraryDatabase;
  expectedDatabase: LibraryDatabase;
  rawLibrary: Uint8Array;
  media: ReadonlyMap<string, Uint8Array>;
}

type MigrationFileSystemTestOperation =
  | "recovered-temporary-journal-sync"
  | "temporary-journal-promote"
  | "journal-parent-sync"
  | "staging-target-install";

interface TestMigrationOptions extends MigrateLibrarySourceOptions {
  fileSystemTestSeam?: {
    execute(
      operation: MigrationFileSystemTestOperation,
      details: Readonly<{ path?: string; from?: string; to?: string; flags?: number }>,
      perform: () => Promise<void>,
    ): Promise<void>;
  };
}

async function allFileBytes(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const visit = async (directory: string): Promise<void> => {
    const names = (await readdir(directory)).sort(compareText);
    for (const name of names) {
      const path = join(directory, name);
      const stat = await lstat(path);
      if (stat.isDirectory()) await visit(path);
      else if (stat.isFile()) files.set(relative(root, path).split("\\").join("/"), new Uint8Array(await readFile(path)));
    }
  };
  await visit(root);
  return files;
}

async function snapshotPath(path: string): Promise<Map<string, Uint8Array>> {
  const stat = await lstat(path);
  if (stat.isFile()) return new Map([[".", new Uint8Array(await readFile(path))]]);
  return allFileBytes(path);
}

function expectByteMapsEqual(actual: ReadonlyMap<string, Uint8Array>, expected: ReadonlyMap<string, Uint8Array>): void {
  expect([...actual.keys()].sort(compareText)).toEqual([...expected.keys()].sort(compareText));
  for (const [path, bytes] of expected) expect(actual.get(path), path).toEqual(bytes);
}

async function exactSourceTreeDigest(sourceRoot: string): Promise<string> {
  const files = await allFileBytes(sourceRoot);
  const entries = [...files]
    .map(([path, bytes]) => ({
      byteLength: bytes.byteLength,
      path: `data/${path}`,
      sha256: sha(bytes),
    }))
    .sort((left, right) => compareText(left.path, right.path));
  return canonicalFixtureHash(entries);
}

function noteBodiesDigest(database: LibraryDatabase): string {
  const entries = Object.values(database.notes)
    .map((note) => {
      const bytes = new TextEncoder().encode(note.bodyMarkdown);
      return { byteLength: bytes.byteLength, noteId: note.id, sha256: sha(bytes) };
    })
    .sort((left, right) => compareText(left.noteId, right.noteId));
  return canonicalFixtureHash(entries);
}

function legacyMediaDigest(media: ReadonlyMap<string, Uint8Array>): string {
  const entries = [...media]
    .map(([path, bytes]) => ({ byteLength: bytes.byteLength, path, sha256: sha(bytes) }))
    .sort((left, right) => compareText(left.path, right.path));
  return canonicalFixtureHash(entries);
}

describe("journaled legacy library migration", () => {
  let sandbox = "";

  beforeEach(async () => {
    sandbox = await mkdtemp(join(await realpath("/tmp"), "mglmigration-"));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  async function createFixture(name: string): Promise<LegacyFixture> {
    const root = join(sandbox, name);
    const legacyLibraryPath = join(root, "public", "data", "library.json");
    const legacyMediaRoot = join(root, "public", "media");
    const targetSourceRoot = join(root, "data");
    const journalPath = join(root, ".data.mygameslist-migration-journal.json");
    const stagingSourceRoot = join(root, ".data.mygameslist-migration-staging");
    await mkdir(dirname(legacyLibraryPath), { recursive: true });
    await mkdir(legacyMediaRoot, { recursive: true });

    const expectedDatabase = (await projectSourceTree(fixtureDatabase())).database;
    const legacyDatabase = structuredClone(expectedDatabase);
    legacyDatabase.games[GAME_B_ID].progressItems = [];
    legacyDatabase.notes[NOTE_EMPTY_ID].groupRank = 1024;
    legacyDatabase.notes[NOTE_EMPTY_ID].doubleWidth = false;
    legacyDatabase.notes[NOTE_EMPTY_ID].doubleHeight = false;
    legacyDatabase.notes[NOTE_EMPTY_ID].collapsedChecklistSections = [];
    legacyDatabase.revision = computeLibraryRevision(legacyDatabase);
    const rawLibrary = new TextEncoder().encode(`${JSON.stringify(legacyDatabase, null, 2)}\n`);
    await writeFile(legacyLibraryPath, rawLibrary);

    const media = new Map<string, Uint8Array>([
      [runtimeAssetFilename(legacyDatabase.assets[FILE_ID]), FILE_BYTES.slice()],
      [runtimeAssetFilename(legacyDatabase.assets[IMAGE_ID]), IMAGE_BYTES.slice()],
    ]);
    for (const [filename, bytes] of media) await writeFile(join(legacyMediaRoot, filename), bytes);
    return {
      root,
      legacyLibraryPath,
      legacyMediaRoot,
      targetSourceRoot,
      journalPath,
      stagingSourceRoot,
      legacyDatabase,
      expectedDatabase,
      rawLibrary,
      media,
    };
  }

  function options(fixture: LegacyFixture, overrides: Partial<TestMigrationOptions> = {}): TestMigrationOptions {
    return {
      legacyLibraryPath: fixture.legacyLibraryPath,
      legacyMediaRoot: fixture.legacyMediaRoot,
      targetSourceRoot: fixture.targetSourceRoot,
      expectedCounts: EXPECTED_COUNTS,
      ...overrides,
    };
  }

  async function legacySnapshots(fixture: LegacyFixture): Promise<{
    library: Map<string, Uint8Array>;
    media: Map<string, Uint8Array>;
  }> {
    return {
      library: await snapshotPath(fixture.legacyLibraryPath),
      media: await snapshotPath(fixture.legacyMediaRoot),
    };
  }

  async function expectLegacyUnchanged(fixture: LegacyFixture, snapshot: Awaited<ReturnType<typeof legacySnapshots>>): Promise<void> {
    expectByteMapsEqual(await snapshotPath(fixture.legacyLibraryPath), snapshot.library);
    expectByteMapsEqual(await snapshotPath(fixture.legacyMediaRoot), snapshot.media);
  }

  test("installs an exact production-assembled source tree and reports independent digests", async () => {
    const fixture = await createFixture("success");
    const before = await legacySnapshots(fixture);

    const report = await migrateLibrarySource(options(fixture));
    const assembly = await validateSourceTree({ sourceRoot: fixture.targetSourceRoot, sourceCommitSha: null });

    expect(report).toEqual({
      status: "installed",
      counts: EXPECTED_COUNTS,
      legacyRevision: fixture.legacyDatabase.revision,
      sourceRevision: fixture.expectedDatabase.revision,
      revisionChangedByAllowedNormalization: fixture.legacyDatabase.revision !== fixture.expectedDatabase.revision,
      legacyDatabaseSha256: sha(fixture.rawLibrary),
      legacyMediaSha256: legacyMediaDigest(fixture.media),
      sourceTreeSha256: await exactSourceTreeDigest(fixture.targetSourceRoot),
      noteBodiesSha256: noteBodiesDigest(fixture.legacyDatabase),
    } satisfies MigrationReport);
    expect(assembly.database).toEqual(fixture.expectedDatabase);
    expect(assembly.sourceAssetOccurrences).toBe(3);
    expect([...assembly.runtimeMedia]).toEqual([...fixture.media]);
    expect((await projectSourceTree(assembly.database)).leaves.map((leaf) => leaf.path)).toEqual(
      (await projectSourceTree(fixture.expectedDatabase)).leaves.map((leaf) => leaf.path),
    );
    expect(assembly.database.notes[NOTE_EMPTY_ID].bodyMarkdown).toBe("");
    expect(assembly.database.notes[NOTE_ATTACHMENTS_ID].bodyMarkdown).toBe("No final LF");
    expect(assembly.database.notes[NOTE_ATTACHMENTS_ID].attachments.map((attachment) => attachment.type)).toEqual(["image", "file", "link"]);
    await expectLegacyUnchanged(fixture, before);
    await expect(lstat(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fixture.stagingSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("returns already-applied without rewriting an exact existing target", async () => {
    const fixture = await createFixture("idempotent");
    await migrateLibrarySource(options(fixture));
    const targetBefore = await snapshotPath(fixture.targetSourceRoot);
    const targetStats = new Map<string, number>();
    for (const path of targetBefore.keys()) targetStats.set(path, (await lstat(join(fixture.targetSourceRoot, path))).mtimeMs);

    const report = await migrateLibrarySource(options(fixture));

    expect(report.status).toBe("already-applied");
    expectByteMapsEqual(await snapshotPath(fixture.targetSourceRoot), targetBefore);
    for (const [path, mtime] of targetStats) expect((await lstat(join(fixture.targetSourceRoot, path))).mtimeMs).toBe(mtime);
  });

  test.each(MIGRATION_PHASES)("is rerunnable after interruption at %s and never changes legacy bytes", async (phase) => {
    const fixture = await createFixture(`phase-${phase}`);
    const before = await legacySnapshots(fixture);
    const reached: MigrationPhase[] = [];

    await expect(migrateLibrarySource(options(fixture, {
      async afterPhase(reachedPhase) {
        reached.push(reachedPhase);
        if (reachedPhase === phase) throw new Error(`injected crash after ${phase}`);
      },
    }))).rejects.toThrow(`injected crash after ${phase}`);

    expect(reached).toContain(phase);
    await expectLegacyUnchanged(fixture, before);
    const targetStat = await lstat(fixture.targetSourceRoot).catch(() => null);
    if (targetStat !== null) {
      expect(targetStat.isDirectory()).toBe(true);
      expect((await validateSourceTree({ sourceRoot: fixture.targetSourceRoot, sourceCommitSha: null })).database).toEqual(fixture.expectedDatabase);
    }

    const report = await migrateLibrarySource(options(fixture));
    expect(["installed", "recovered", "already-applied"]).toContain(report.status);
    expect((await validateSourceTree({ sourceRoot: fixture.targetSourceRoot, sourceCommitSha: null })).database).toEqual(fixture.expectedDatabase);
    await expectLegacyUnchanged(fixture, before);
  });

  test("persists and read-verifies a strict journal outside protected roots before target mutation", async () => {
    const fixture = await createFixture("durable-journal");
    await expect(migrateLibrarySource(options(fixture, {
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop after journal");
      },
    }))).rejects.toThrow("stop after journal");

    const raw = await readFile(fixture.journalPath, "utf8");
    const journal = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(journal).sort(compareText)).toEqual([
      "counts",
      "legacyDatabaseSha256",
      "legacyLibraryPath",
      "legacyMediaRoot",
      "legacyMediaSha256",
      "legacyRevision",
      "noteBodiesSha256",
      "operation",
      "sourceRevision",
      "sourceTreeSha256",
      "stagingSourceRoot",
      "targetSourceRoot",
      "version",
    ]);
    expect(journal).toMatchObject({
      version: 1,
      operation: "install-source-tree",
      legacyLibraryPath: fixture.legacyLibraryPath,
      legacyMediaRoot: fixture.legacyMediaRoot,
      targetSourceRoot: fixture.targetSourceRoot,
      stagingSourceRoot: fixture.stagingSourceRoot,
    });
    expect(fixture.journalPath.startsWith(`${fixture.targetSourceRoot}/`)).toBe(false);
    expect(fixture.journalPath.startsWith(`${fixture.legacyMediaRoot}/`)).toBe(false);
    expect(fixture.journalPath.startsWith(`${dirname(fixture.legacyLibraryPath)}/`)).toBe(false);
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(`${fixture.journalPath.slice(0, -".json".length)}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["partial JSON", (_journal: Record<string, unknown>) => "{"],
    ["duplicate key", (journal: Record<string, unknown>) => `{"version":1,${JSON.stringify(journal).slice(1)}`],
    ["unknown version", (journal: Record<string, unknown>) => JSON.stringify({ ...journal, version: 2 })],
    ["unknown key", (journal: Record<string, unknown>) => JSON.stringify({ ...journal, unexpected: true })],
    ["path mismatch", (journal: Record<string, unknown>) => JSON.stringify({ ...journal, targetSourceRoot: `${journal.targetSourceRoot}-other` })],
    ["fingerprint mismatch", (journal: Record<string, unknown>) => JSON.stringify({ ...journal, legacyDatabaseSha256: "0".repeat(64) })],
  ])("preserves and blocks a %s journal without target writes", async (label, corrupt) => {
    const fixture = await createFixture(`journal-${label.replaceAll(" ", "-")}`);
    await expect(migrateLibrarySource(options(fixture, {
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop");
      },
    }))).rejects.toThrow("stop");
    const journal = JSON.parse(await readFile(fixture.journalPath, "utf8")) as Record<string, unknown>;
    const corruptRaw = corrupt(journal);
    await writeFile(fixture.journalPath, corruptRaw);

    await expect(migrateLibrarySource(options(fixture))).rejects.toThrow(/journal/i);
    expect(await readFile(fixture.journalPath, "utf8")).toBe(corruptRaw);
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each(["missing", "partial"])("reconstructs %s deterministic staging under a valid journal", async (kind) => {
    const fixture = await createFixture(`reconstruct-${kind}`);
    await expect(migrateLibrarySource(options(fixture, {
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop");
      },
    }))).rejects.toThrow("stop");
    if (kind === "missing") await rm(fixture.stagingSourceRoot, { recursive: true });
    else await rm(join(fixture.stagingSourceRoot, "manifest.yaml"));

    const report = await migrateLibrarySource(options(fixture));

    expect(report.status).toBe("recovered");
    expect((await validateSourceTree({ sourceRoot: fixture.targetSourceRoot, sourceCommitSha: null })).database).toEqual(fixture.expectedDatabase);
    await expect(lstat(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("durably promotes and successfully recovers an exact canonical temporary journal", async () => {
    const fixture = await createFixture("temporary-journal-success");
    await expect(migrateLibrarySource(options(fixture, {
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop after journal");
      },
    }))).rejects.toThrow("stop after journal");
    const temporaryJournalPath = `${fixture.journalPath.slice(0, -".json".length)}.tmp`;
    await rename(fixture.journalPath, temporaryJournalPath);
    const events: string[] = [];
    const temporaryJournalOpenFlags: number[] = [];

    const report = await migrateLibrarySource(options(fixture, {
      fileSystemTestSeam: {
        async execute(operation, details, perform) {
          if (operation === "recovered-temporary-journal-sync") temporaryJournalOpenFlags.push(details.flags!);
          await perform();
          events.push(operation);
        },
      },
    }));

    expect(report.status).toBe("recovered");
    expect(events.slice(0, 4)).toEqual([
      "recovered-temporary-journal-sync",
      "temporary-journal-promote",
      "journal-parent-sync",
      "staging-target-install",
    ]);
    expect(temporaryJournalOpenFlags).toHaveLength(1);
    expect(temporaryJournalOpenFlags[0] & fileSystemConstants.O_NOFOLLOW).toBe(fileSystemConstants.O_NOFOLLOW);
    expect((await validateSourceTree({ sourceRoot: fixture.targetSourceRoot, sourceCommitSha: null })).database).toEqual(fixture.expectedDatabase);
    await expect(lstat(temporaryJournalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves temp journal, staging, target absence, and legacy bytes when recovered temp sync fails", async () => {
    const fixture = await createFixture("temporary-journal-sync-failure");
    await expect(migrateLibrarySource(options(fixture, {
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop after journal");
      },
    }))).rejects.toThrow("stop after journal");
    const temporaryJournalPath = `${fixture.journalPath.slice(0, -".json".length)}.tmp`;
    await rename(fixture.journalPath, temporaryJournalPath);
    const temporaryJournalBefore = await readFile(temporaryJournalPath);
    const stagingBefore = await snapshotPath(fixture.stagingSourceRoot);
    const legacyBefore = await legacySnapshots(fixture);
    const events: string[] = [];

    await expect(migrateLibrarySource(options(fixture, {
      fileSystemTestSeam: {
        async execute(operation, _details, perform) {
          if (operation === "recovered-temporary-journal-sync") {
            events.push("temp-file-sync-failed");
            throw new Error("injected recovered temp sync failure");
          }
          await perform();
          events.push(operation);
        },
      },
    }))).rejects.toThrow("injected recovered temp sync failure");

    expect(events).toEqual(["temp-file-sync-failed"]);
    expect(await readFile(temporaryJournalPath)).toEqual(temporaryJournalBefore);
    expectByteMapsEqual(await snapshotPath(fixture.stagingSourceRoot), stagingBefore);
    await expect(lstat(fixture.journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expectLegacyUnchanged(fixture, legacyBefore);
  });

  test("detects freshly changed immutable legacy input after journal installation", async () => {
    const fixture = await createFixture("changed-input");
    await expect(migrateLibrarySource(options(fixture, {
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop");
      },
    }))).rejects.toThrow("stop");
    await writeFile(fixture.legacyLibraryPath, Uint8Array.from([...fixture.rawLibrary, 0x20]));

    await expect(migrateLibrarySource(options(fixture))).rejects.toThrow(/fingerprint|journal|digest/i);
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(fixture.journalPath)).isFile()).toBe(true);
  });

  test("never replaces a different existing target", async () => {
    const fixture = await createFixture("different-target");
    await mkdir(fixture.targetSourceRoot);
    const sentinel = join(fixture.targetSourceRoot, "sentinel.txt");
    await writeFile(sentinel, "keep me");

    await expect(migrateLibrarySource(options(fixture))).rejects.toThrow(/target|source/i);
    expect(await readFile(sentinel, "utf8")).toBe("keep me");
  });

  test("rejects a checked output-parent identity swap before deleting through the alias", async () => {
    const fixture = await createFixture("output-parent-swap");
    const outputParent = join(fixture.root, "output-parent");
    const movedOutputParent = join(fixture.root, "moved-output-parent");
    const victimParent = join(fixture.root, "victim-parent");
    const targetSourceRoot = join(outputParent, "data");
    const victimStagingRoot = join(victimParent, ".data.mygameslist-migration-staging");
    await mkdir(outputParent);
    await mkdir(victimStagingRoot, { recursive: true });
    await writeFile(join(outputParent, "owner-sentinel.txt"), "owner");
    await writeFile(join(victimParent, "victim-sentinel.txt"), "victim");
    await writeFile(join(victimStagingRoot, "staging-sentinel.txt"), "do not delete");
    const before = await legacySnapshots(fixture);

    await expect(migrateLibrarySource(options(fixture, {
      targetSourceRoot,
      async afterPhase(phase) {
        if (phase !== "legacy-validated") return;
        await rename(outputParent, movedOutputParent);
        await symlink(victimParent, outputParent);
      },
    }))).rejects.toThrow(/identity|changed|alias|symlink/i);

    expect(await readFile(join(victimStagingRoot, "staging-sentinel.txt"), "utf8")).toBe("do not delete");
    expect(await readFile(join(victimParent, "victim-sentinel.txt"), "utf8")).toBe("victim");
    expect(await readFile(join(movedOutputParent, "owner-sentinel.txt"), "utf8")).toBe("owner");
    await expect(lstat(join(movedOutputParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(victimParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expectLegacyUnchanged(fixture, before);
  });

  test("rejects an output-parent identity swap at the staging-to-target install boundary", async () => {
    const fixture = await createFixture("install-parent-swap");
    const outputParent = join(fixture.root, "install-output-parent");
    const movedOutputParent = join(fixture.root, "install-moved-output-parent");
    const victimParent = join(fixture.root, "install-victim-parent");
    const targetSourceRoot = join(outputParent, "data");
    const stagingSourceRoot = join(outputParent, ".data.mygameslist-migration-staging");
    const journalPath = join(outputParent, ".data.mygameslist-migration-journal.json");
    await mkdir(outputParent);
    await mkdir(victimParent);
    await writeFile(join(victimParent, "victim-sentinel.txt"), "victim");
    const before = await legacySnapshots(fixture);

    await expect(migrateLibrarySource(options(fixture, {
      targetSourceRoot,
      async afterPhase(phase) {
        if (phase !== "journal-persisted") return;
        await rename(outputParent, movedOutputParent);
        await symlink(victimParent, outputParent);
      },
    }))).rejects.toThrow(/identity|changed|alias|symlink/i);

    expect(await readFile(join(victimParent, "victim-sentinel.txt"), "utf8")).toBe("victim");
    expect((await lstat(join(movedOutputParent, relative(outputParent, stagingSourceRoot)))).isDirectory()).toBe(true);
    expect((await lstat(join(movedOutputParent, relative(outputParent, journalPath)))).isFile()).toBe(true);
    await expect(lstat(join(movedOutputParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(victimParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expectLegacyUnchanged(fixture, before);
  });

  test("rejects a journal-parent identity swap at the removal boundary without unlinking the alias target", async () => {
    const fixture = await createFixture("journal-removal-parent-swap");
    const journalParent = join(fixture.root, "journal-parent");
    const movedJournalParent = join(fixture.root, "moved-journal-parent");
    const victimParent = join(fixture.root, "journal-victim-parent");
    const journalPath = join(journalParent, "migration.json");
    const victimJournalPath = join(victimParent, "migration.json");
    await mkdir(journalParent);
    await mkdir(victimParent);
    await writeFile(victimJournalPath, "victim journal bytes");
    const before = await legacySnapshots(fixture);

    await expect(migrateLibrarySource(options(fixture, {
      journalPath,
      async afterPhase(phase) {
        if (phase !== "target-validated") return;
        await rename(journalParent, movedJournalParent);
        await symlink(victimParent, journalParent);
      },
    }))).rejects.toThrow(/identity|changed|alias|symlink/i);

    expect(await readFile(victimJournalPath, "utf8")).toBe("victim journal bytes");
    expect((await lstat(join(movedJournalParent, "migration.json"))).isFile()).toBe(true);
    expect((await validateSourceTree({ sourceRoot: fixture.targetSourceRoot, sourceCommitSha: null })).database).toEqual(fixture.expectedDatabase);
    await expectLegacyUnchanged(fixture, before);
  });

  test("rejects a journal-parent identity swap inside temporary-journal promotion", async () => {
    const fixture = await createFixture("journal-promotion-parent-swap");
    const journalParent = join(fixture.root, "promotion-journal-parent");
    const movedJournalParent = join(fixture.root, "promotion-moved-journal-parent");
    const victimParent = join(fixture.root, "promotion-victim-parent");
    const journalPath = join(journalParent, "migration.json");
    const temporaryJournalPath = join(journalParent, "migration.tmp");
    await mkdir(journalParent);
    await mkdir(victimParent);
    await expect(migrateLibrarySource(options(fixture, {
      journalPath,
      afterPhase(phase) {
        if (phase === "journal-persisted") throw new Error("stop after journal");
      },
    }))).rejects.toThrow("stop after journal");
    await rename(journalPath, temporaryJournalPath);
    const temporaryBefore = await readFile(temporaryJournalPath);
    const stagingBefore = await snapshotPath(fixture.stagingSourceRoot);
    const before = await legacySnapshots(fixture);
    await writeFile(join(victimParent, "migration.tmp"), "victim temporary journal");

    await expect(migrateLibrarySource(options(fixture, {
      journalPath,
      fileSystemTestSeam: {
        async execute(operation, _details, perform) {
          if (operation === "temporary-journal-promote") {
            await rename(journalParent, movedJournalParent);
            await symlink(victimParent, journalParent);
          }
          await perform();
        },
      },
    }))).rejects.toThrow(/identity|changed|alias|symlink/i);

    expect(await readFile(join(victimParent, "migration.tmp"), "utf8")).toBe("victim temporary journal");
    expect(await readFile(join(movedJournalParent, "migration.tmp"))).toEqual(temporaryBefore);
    await expect(lstat(join(movedJournalParent, "migration.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expectByteMapsEqual(await snapshotPath(fixture.stagingSourceRoot), stagingBefore);
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expectLegacyUnchanged(fixture, before);
  });

  test("rejects protected-root overlaps and symlinked target components before writes", async () => {
    const fixture = await createFixture("unsafe-paths");
    await expect(migrateLibrarySource(options(fixture, { targetSourceRoot: fixture.legacyMediaRoot }))).rejects.toThrow(/overlap|same|protected/i);
    await expect(migrateLibrarySource(options(fixture, { journalPath: join(fixture.legacyMediaRoot, "journal.json") }))).rejects.toThrow(/overlap|inside|protected/i);

    const realParent = join(fixture.root, "real-target-parent");
    const linkedParent = join(fixture.root, "linked-target-parent");
    await mkdir(realParent);
    await symlink(realParent, linkedParent);
    await expect(migrateLibrarySource(options(fixture, { targetSourceRoot: join(linkedParent, "data") }))).rejects.toThrow(/symlink|alias/i);
    await expect(lstat(join(realParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects symlinked legacy JSON and media roots without following them", async () => {
    const fixture = await createFixture("legacy-symlinks");
    const libraryLink = join(fixture.root, "library-link.json");
    const mediaLink = join(fixture.root, "media-link");
    await symlink(fixture.legacyLibraryPath, libraryLink);
    await symlink(fixture.legacyMediaRoot, mediaLink);

    await expect(migrateLibrarySource(options(fixture, { legacyLibraryPath: libraryLink }))).rejects.toThrow(/symlink/i);
    await expect(migrateLibrarySource(options(fixture, { legacyMediaRoot: mediaLink }))).rejects.toThrow(/symlink/i);
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["extra media", async (fixture: LegacyFixture) => writeFile(join(fixture.legacyMediaRoot, "orphan.bin"), "orphan")],
    ["missing media", async (fixture: LegacyFixture) => rm(join(fixture.legacyMediaRoot, runtimeAssetFilename(fixture.legacyDatabase.assets[FILE_ID])))],
    ["wrong-case media", async (fixture: LegacyFixture) => {
      const filename = runtimeAssetFilename(fixture.legacyDatabase.assets[IMAGE_ID]);
      await rename(join(fixture.legacyMediaRoot, filename), join(fixture.legacyMediaRoot, filename.replace(".webp", ".WEBP")));
    }],
    ["nested directory", async (fixture: LegacyFixture) => mkdir(join(fixture.legacyMediaRoot, "nested"))],
    ["symlinked media", async (fixture: LegacyFixture) => {
      const filename = runtimeAssetFilename(fixture.legacyDatabase.assets[FILE_ID]);
      await rm(join(fixture.legacyMediaRoot, filename));
      await symlink(join(fixture.root, "outside-file"), join(fixture.legacyMediaRoot, filename));
      await writeFile(join(fixture.root, "outside-file"), FILE_BYTES);
    }],
  ])("rejects %s inventory without creating a target", async (label, mutate) => {
    const fixture = await createFixture(`media-${label.replaceAll(" ", "-")}`);
    await mutate(fixture);

    await expect(migrateLibrarySource(options(fixture))).rejects.toThrow(/media|asset|file|inventory/i);
    await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects corrupt media bytes before staging", async () => {
    const fixture = await createFixture("corrupt-media");
    const imagePath = join(fixture.legacyMediaRoot, runtimeAssetFilename(fixture.legacyDatabase.assets[IMAGE_ID]));
    const corrupt = IMAGE_BYTES.slice();
    corrupt[0] ^= 0xff;
    await writeFile(imagePath, corrupt);

    await expect(migrateLibrarySource(options(fixture))).rejects.toThrow(/SHA|byte|asset/i);
    await expect(lstat(fixture.stagingSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects an invalid revision, nonrepresentable source value, and count mismatch before staging", async () => {
    const revisionFixture = await createFixture("bad-revision");
    const badRevision = structuredClone(revisionFixture.legacyDatabase);
    badRevision.games[GAME_B_ID].title = "changed without revision";
    await writeFile(revisionFixture.legacyLibraryPath, JSON.stringify(badRevision));
    await expect(migrateLibrarySource(options(revisionFixture))).rejects.toThrow(/revision/i);

    const sourceFixture = await createFixture("nonrepresentable");
    const nonrepresentable = structuredClone(sourceFixture.legacyDatabase);
    const attachment = nonrepresentable.notes[NOTE_ATTACHMENTS_ID].attachments[2];
    if (attachment.type !== "link") throw new Error("fixture link missing");
    attachment.url = "/relative";
    nonrepresentable.revision = computeLibraryRevision(nonrepresentable);
    await writeFile(sourceFixture.legacyLibraryPath, JSON.stringify(nonrepresentable));
    await expect(migrateLibrarySource(options(sourceFixture))).rejects.toThrow(/source|представима|http/i);

    const countsFixture = await createFixture("bad-counts");
    await expect(migrateLibrarySource(options(countsFixture, {
      expectedCounts: { ...EXPECTED_COUNTS, games: 99 },
    }))).rejects.toThrow(/count|games|expected/i);

    for (const fixture of [revisionFixture, sourceFixture, countsFixture]) {
      await expect(lstat(fixture.stagingSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(fixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("migration CLI uses explicit roots and counts and prints the stable report", async () => {
    const fixture = await createFixture("cli");
    const script = resolve(dirname(new URL(import.meta.url).pathname), "../scripts/migrate-library-source.ts");
    const args = [
      "--import", "tsx", script,
      "--library", fixture.legacyLibraryPath,
      "--media", fixture.legacyMediaRoot,
      "--target", fixture.targetSourceRoot,
      "--expect-games", "2",
      "--expect-notes", "3",
      "--expect-assets", "2",
      "--expect-occurrences", "3",
    ];

    const successful = await execFileAsync(process.execPath, args, { cwd: resolve(dirname(new URL(import.meta.url).pathname), "..") });
    expect(successful.stderr).toBe("");
    expect(JSON.parse(successful.stdout)).toMatchObject({ status: "installed", counts: EXPECTED_COUNTS });

    const badFixture = await createFixture("cli-bad");
    await expect(execFileAsync(process.execPath, [
      "--import", "tsx", script,
      "--library", badFixture.legacyLibraryPath,
      "--media", badFixture.legacyMediaRoot,
      "--target", badFixture.targetSourceRoot,
      "--expect-games", "308",
      "--expect-notes", "210",
      "--expect-assets", "378",
      "--expect-occurrences", "383",
    ])).rejects.toMatchObject({ code: expect.any(Number) });
    await expect(lstat(badFixture.targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });

    await expect(execFileAsync(process.execPath, ["--import", "tsx", script, "--library", fixture.legacyLibraryPath])).rejects.toMatchObject({ code: expect.any(Number) });
  });

  test("fixture SHA constants remain independently checked", () => {
    expect(sha256Bytes(IMAGE_BYTES)).toBe(IMAGE_ID);
    expect(sha(IMAGE_BYTES)).toBe(IMAGE_ID);
    expect(sha256Bytes(FILE_BYTES)).toBe(FILE_ID);
    expect(sha(FILE_BYTES)).toBe(FILE_ID);
  });
});
