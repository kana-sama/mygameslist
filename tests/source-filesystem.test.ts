import { execFile } from "node:child_process";
import { renameSync, symlinkSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { projectSourceTree, type ProjectedSourceLeaf, type SourceProjection } from "../src/source";
import {
  EXPECTED_LEAVES,
  FILE_BYTES,
  FILE_PATH,
  GAME_A_YAML_PATH,
  IMAGE_BYTES,
  IMAGE_ID,
  MANIFEST_YAML,
  fixtureDatabase,
} from "./fixtures/source-tree";
import {
  createFileSystemSourceReader,
  materializeProjectedSourceTree,
} from "../scripts/source-tree-fs";
import { validateSourceTree } from "../scripts/validate-source";

const execFileAsync = promisify(execFile);
const textEncoder = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bytesForAsset(assetId: string): Uint8Array {
  if (assetId === IMAGE_ID) return IMAGE_BYTES.slice();
  return FILE_BYTES.slice();
}

function sourcePhysicalPath(sourceRoot: string, logicalPath: string): string {
  if (!logicalPath.startsWith("data/")) throw new Error(`Unexpected fixture path ${logicalPath}`);
  return join(sourceRoot, ...logicalPath.slice("data/".length).split("/"));
}

async function physicalInventory(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const names = await readdir(directory);
    names.sort(compareText);
    for (const name of names) {
      const path = join(directory, name);
      const entry = await lstat(path);
      const relativePath = relative(root, path).split("\\").join("/");
      result.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(root);
  return result;
}

function expectedPhysicalInventory(): string[] {
  const files = EXPECTED_LEAVES.map((leaf) => leaf.path.slice("data/".length));
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(`${parts.slice(0, index).join("/")}/`);
    }
  }
  return [...directories, ...files].sort(compareText);
}

function expectedLogicalEntries(): { kind: "directory" | "file"; path: string }[] {
  return [
    { kind: "directory", path: "data" },
    ...expectedPhysicalInventory().map((path) => path.endsWith("/")
      ? { kind: "directory" as const, path: `data/${path.slice(0, -1)}` }
      : { kind: "file" as const, path: `data/${path}` }),
  ].sort((left, right) => compareText(left.path, right.path));
}

function projectionWithLeaves(projection: SourceProjection, leaves: readonly ProjectedSourceLeaf[]): SourceProjection {
  return { ...projection, leaves };
}

describe("filesystem source adapter", () => {
  let sandbox = "";
  let projection: SourceProjection;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(await realpath("/tmp"), "mglfs-"));
    projection = await projectSourceTree(fixtureDatabase());
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  async function materialize(name = "data"): Promise<{ sourceRoot: string; calls: string[] }> {
    const sourceRoot = join(sandbox, name);
    const calls: string[] = [];
    await materializeProjectedSourceTree({
      targetSourceRoot: sourceRoot,
      projection,
      async resolveAssetBytes(leaf) {
        calls.push(leaf.assetId);
        return bytesForAsset(leaf.assetId);
      },
    });
    return { sourceRoot, calls };
  }

  test("materializes only canonical source leaves with exact bytes and modes", async () => {
    const { sourceRoot } = await materialize();

    expect(await physicalInventory(sourceRoot)).toEqual(expectedPhysicalInventory());
    expect(await readFile(sourcePhysicalPath(sourceRoot, "data/manifest.yaml"), "utf8")).toBe(MANIFEST_YAML);
    expect(new Uint8Array(await readFile(sourcePhysicalPath(sourceRoot, FILE_PATH)))).toEqual(FILE_BYTES);

    for (const item of await physicalInventory(sourceRoot)) {
      const physicalPath = join(sourceRoot, item.replace(/\/$/, ""));
      const mode = (await lstat(physicalPath)).mode & 0o777;
      expect(mode, item).toBe(item.endsWith("/") ? 0o755 : 0o644);
    }
    expect(await lstat(join(sourceRoot, "library.json")).catch(() => null)).toBeNull();
    expect(await lstat(join(sourceRoot, "media")).catch(() => null)).toBeNull();
  });

  test("resolves shared binary bytes once per unique SHA", async () => {
    const { calls } = await materialize();
    expect(calls.sort(compareText)).toEqual([
      "08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48db414871f51c9cb35283d",
      "995f88d98ba63a015ed5b1179d2454be029d3205ac707911c046dcd86fcb3c97",
    ]);
  });

  test("enumerates deterministic logical data entries without Git metadata", async () => {
    const { sourceRoot } = await materialize();
    const reader = createFileSystemSourceReader(sourceRoot);

    const entries = await reader.listEntries();
    expect(entries).toEqual(expectedLogicalEntries());
    expect(entries.every((entry) => entry.git === undefined)).toBe(true);
  });

  test("returns fresh exact byte arrays for text, zeroes, controls, and binary data", async () => {
    const { sourceRoot } = await materialize();
    const reader = createFileSystemSourceReader(sourceRoot);

    const first = await reader.readFile(FILE_PATH);
    first[0] = 255;
    const second = await reader.readFile(FILE_PATH);

    expect(second).toEqual(new Uint8Array([0, 1, 2, 3, 4]));
    expect([...await reader.readFile("data/manifest.yaml")]).toEqual([...textEncoder.encode(MANIFEST_YAML)]);
  });

  test.each([
    ["bare logical root", "data"],
    ["absolute path", "/data/manifest.yaml"],
    ["backslash", "data\\manifest.yaml"],
    ["NUL", "data/manifest\0.yaml"],
    ["empty segment", "data//manifest.yaml"],
    ["dot segment", "data/./manifest.yaml"],
    ["dot-dot segment", "data/games/../manifest.yaml"],
    ["outside namespace", "outside.txt"],
  ])("rejects %s before reading it", async (_label, logicalPath) => {
    const { sourceRoot } = await materialize();
    const outside = join(sandbox, "outside.txt");
    await writeFile(outside, "sentinel");
    const reader = createFileSystemSourceReader(sourceRoot);

    await expect(reader.readFile(logicalPath)).rejects.toThrow(/unsafe|canonical|data\//i);
    expect(await readFile(outside, "utf8")).toBe("sentinel");
  });

  test("rejects directories and missing leaves at read time", async () => {
    const { sourceRoot } = await materialize();
    const reader = createFileSystemSourceReader(sourceRoot);

    await expect(reader.readFile("data/games")).rejects.toThrow(/regular.*file|directory/i);
    await expect(reader.readFile("data/missing.yaml")).rejects.toThrow(/data\/missing\.yaml/);
  });

  test("reports but never follows file and directory symlinks", async () => {
    const { sourceRoot } = await materialize();
    const outsideFile = join(sandbox, "outside-secret.txt");
    const outsideDirectory = join(sandbox, "outside-directory");
    await writeFile(outsideFile, "secret");
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "nested.txt"), "nested secret");
    await symlink(outsideFile, join(sourceRoot, "file-link"));
    await symlink(outsideDirectory, join(sourceRoot, "directory-link"));

    const reader = createFileSystemSourceReader(sourceRoot);
    const entries = await reader.listEntries();
    expect(entries).toContainEqual({ kind: "symlink", path: "data/file-link" });
    expect(entries).toContainEqual({ kind: "symlink", path: "data/directory-link" });
    expect(entries.some((entry) => entry.path.includes("nested.txt"))).toBe(false);
    await expect(reader.readFile("data/file-link")).rejects.toThrow(/symlink|regular.*file/i);
    await expect(reader.readFile("data/directory-link/nested.txt")).rejects.toThrow(/symlink|directory/i);
  });

  test("rejects a symlink physical root without following it", async () => {
    const { sourceRoot } = await materialize("real-data");
    const rootLink = join(sandbox, "linked-data");
    await symlink(sourceRoot, rootLink);
    const reader = createFileSystemSourceReader(rootLink);

    await expect(reader.listEntries()).rejects.toThrow(/root.*symlink|symlink.*root/i);
    await expect(reader.readFile("data/manifest.yaml")).rejects.toThrow(/root.*symlink|symlink.*root/i);
  });

  test("reports unsupported filesystem leaves without reading them", async () => {
    const { sourceRoot } = await materialize();
    const fifoPath = join(sourceRoot, "unsupported.fifo");
    await execFileAsync("mkfifo", [fifoPath]);

    const reader = createFileSystemSourceReader(sourceRoot);
    expect(await reader.listEntries()).toContainEqual({ kind: "unsupported", path: "data/unsupported.fifo" });
    await expect(reader.readFile("data/unsupported.fifo")).rejects.toThrow(/regular.*file|unsupported/i);
  });

  test("rejects missing and regular-file physical roots with path-rich errors", async () => {
    const missing = join(sandbox, "missing-data");
    const file = join(sandbox, "file-data");
    await writeFile(file, "not a directory");

    await expect(createFileSystemSourceReader(missing).listEntries()).rejects.toThrow(missing);
    await expect(createFileSystemSourceReader(file).listEntries()).rejects.toThrow(file);
  });

  test.each([
    ["wrong-case manifest", async (root: string) => {
      await import("node:fs/promises").then(({ rename }) => rename(join(root, "manifest.yaml"), join(root, "Manifest.yaml")));
    }],
    ["missing manifest", async (root: string) => {
      await rm(join(root, "manifest.yaml"));
    }],
    ["extra leaf", async (root: string) => {
      await writeFile(join(root, "extra.txt"), "extra");
    }],
    ["empty optional directory", async (root: string) => {
      const notesDirectory = expectedPhysicalInventory().find((item) => item.endsWith("/notes/"))!;
      await rm(join(root, notesDirectory), { recursive: true });
      await mkdir(join(root, notesDirectory), { recursive: true });
    }],
    ["directory in manifest slot", async (root: string) => {
      await rm(join(root, "manifest.yaml"));
      await mkdir(join(root, "manifest.yaml"));
    }],
  ])("production validation rejects %s", async (_label, mutate) => {
    const { sourceRoot } = await materialize();
    await mutate(sourceRoot);

    await expect(validateSourceTree({ sourceRoot, sourceCommitSha: null })).rejects.toThrow();
  });

  test("validation returns the production assembly with exact provenance", async () => {
    const { sourceRoot } = await materialize();
    const sha = "a".repeat(40);

    const local = await validateSourceTree({ sourceRoot, sourceCommitSha: null });
    const deployed = await validateSourceTree({ sourceRoot, sourceCommitSha: sha });

    expect(local.envelope.sourceCommitSha).toBeNull();
    expect(deployed.envelope.sourceCommitSha).toBe(sha);
    expect(local.database).toEqual(projection.database);
    expect([...local.runtimeMedia]).toEqual([
      [`08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48db414871f51c9cb35283d.bin`, FILE_BYTES],
      [`${IMAGE_ID}.webp`, IMAGE_BYTES],
    ]);
    expect(local.sourceAssetOccurrences).toBe(3);
  });

  test("materializer rejects an existing target without merging or deleting it", async () => {
    const targetSourceRoot = join(sandbox, "existing");
    await mkdir(targetSourceRoot);
    await writeFile(join(targetSourceRoot, "sentinel.txt"), "keep");

    await expect(materializeProjectedSourceTree({
      targetSourceRoot,
      projection,
      resolveAssetBytes: async (leaf) => bytesForAsset(leaf.assetId),
    })).rejects.toThrow(/must not exist|already exists/i);
    expect(await readFile(join(targetSourceRoot, "sentinel.txt"), "utf8")).toBe("keep");
  });

  test("rejects an output-parent identity change across the asynchronous resolver boundary", async () => {
    const outputParent = join(sandbox, "output-parent");
    const movedOutputParent = join(sandbox, "moved-output-parent");
    const victimParent = join(sandbox, "victim-parent");
    const targetSourceRoot = join(outputParent, "data");
    await mkdir(outputParent);
    await mkdir(victimParent);
    await writeFile(join(outputParent, "owner-sentinel.txt"), "owner");
    await writeFile(join(victimParent, "victim-sentinel.txt"), "victim");
    let swapped = false;

    await expect(materializeProjectedSourceTree({
      targetSourceRoot,
      projection,
      async resolveAssetBytes(leaf) {
        if (!swapped) {
          swapped = true;
          await rename(outputParent, movedOutputParent);
          await symlink(victimParent, outputParent);
        }
        return bytesForAsset(leaf.assetId);
      },
    })).rejects.toThrow(/identity|changed|alias|symlink/i);

    expect(await readFile(join(movedOutputParent, "owner-sentinel.txt"), "utf8")).toBe("owner");
    expect(await readFile(join(victimParent, "victim-sentinel.txt"), "utf8")).toBe("victim");
    await expect(lstat(join(movedOutputParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(victimParent, "data"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("refuses cleanup through a changed parent after creating its exact target", async () => {
    const outputParent = join(sandbox, "cleanup-output-parent");
    const movedOutputParent = join(sandbox, "cleanup-moved-output-parent");
    const victimParent = join(sandbox, "cleanup-victim-parent");
    const targetSourceRoot = join(outputParent, "data");
    const victimSourceRoot = join(victimParent, "data");
    const victimGamePath = sourcePhysicalPath(victimSourceRoot, GAME_A_YAML_PATH);
    await mkdir(outputParent);
    await mkdir(dirname(victimGamePath), { recursive: true });
    await writeFile(victimGamePath, "victim game bytes");
    await writeFile(join(victimParent, "victim-sentinel.txt"), "victim");

    const guardedLeaves = projection.leaves.map((leaf) => {
      if (leaf.kind !== "text" || leaf.path !== GAME_A_YAML_PATH) return leaf;
      let reads = 0;
      return Object.defineProperty({ ...leaf }, "text", {
        enumerable: true,
        get() {
          reads += 1;
          if (reads === 2) {
            renameSync(outputParent, movedOutputParent);
            symlinkSync(victimParent, outputParent);
          }
          return leaf.text;
        },
      }) as ProjectedSourceLeaf;
    });

    await expect(materializeProjectedSourceTree({
      targetSourceRoot,
      projection: projectionWithLeaves(projection, guardedLeaves),
      resolveAssetBytes: async (leaf) => bytesForAsset(leaf.assetId),
    })).rejects.toThrow(/identity|changed|cleanup|alias|symlink/i);

    expect(await readFile(victimGamePath, "utf8")).toBe("victim game bytes");
    expect(await readFile(join(victimParent, "victim-sentinel.txt"), "utf8")).toBe("victim");
    expect((await lstat(join(movedOutputParent, "data"))).isDirectory()).toBe(true);
  });

  test.each([
    ["duplicate", (leaves: readonly ProjectedSourceLeaf[]) => [...leaves, leaves[0]]],
    ["traversal", (leaves: readonly ProjectedSourceLeaf[]) => [{ ...leaves[0], path: "data/../escape" }, ...leaves.slice(1)]],
    ["backslash", (leaves: readonly ProjectedSourceLeaf[]) => [{ ...leaves[0], path: "data\\escape" }, ...leaves.slice(1)]],
    ["empty segment", (leaves: readonly ProjectedSourceLeaf[]) => [{ ...leaves[0], path: "data//manifest.yaml" }, ...leaves.slice(1)]],
    ["file-prefix collision", (leaves: readonly ProjectedSourceLeaf[]) => [
      { ...leaves[0], path: "data/collision" },
      { ...leaves[1], path: "data/collision/child" },
      ...leaves.slice(2),
    ]],
  ])("rejects %s projected paths before creating the target", async (_label, mutate) => {
    const targetSourceRoot = join(sandbox, `invalid-${_label}`);
    await expect(materializeProjectedSourceTree({
      targetSourceRoot,
      projection: projectionWithLeaves(projection, mutate(projection.leaves)),
      resolveAssetBytes: async (leaf) => bytesForAsset(leaf.assetId),
    })).rejects.toThrow();
    await expect(lstat(targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["wrong length", (bytes: Uint8Array) => bytes.slice(0, -1)],
    ["wrong SHA", (bytes: Uint8Array) => Uint8Array.from(bytes, (value, index) => index === 0 ? value ^ 0xff : value)],
  ])("rejects resolver %s and removes only its newly-created target", async (_label, corrupt) => {
    const targetSourceRoot = join(sandbox, `bad-bytes-${_label}`);
    await expect(materializeProjectedSourceTree({
      targetSourceRoot,
      projection,
      resolveAssetBytes: async (leaf) => corrupt(bytesForAsset(leaf.assetId)),
    })).rejects.toThrow(/byteLength|SHA|hash/i);
    await expect(lstat(targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects conflicting byteLength declarations for reused SHA while resolving it at most once", async () => {
    const targetSourceRoot = join(sandbox, "conflicting-shared-length");
    let sawSharedLeaf = false;
    const leaves = projection.leaves.map((leaf) => {
      if (leaf.kind !== "binary" || leaf.assetId !== IMAGE_ID) return leaf;
      if (!sawSharedLeaf) {
        sawSharedLeaf = true;
        return leaf;
      }
      return { ...leaf, byteLength: leaf.byteLength + 1 };
    });
    let resolverCalls = 0;

    await expect(materializeProjectedSourceTree({
      targetSourceRoot,
      projection: projectionWithLeaves(projection, leaves),
      async resolveAssetBytes(leaf) {
        resolverCalls += 1;
        return bytesForAsset(leaf.assetId);
      },
    })).rejects.toThrow(/byteLength|same SHA|reused/i);
    expect(resolverCalls).toBeLessThanOrEqual(1);
    await expect(lstat(targetSourceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("validation CLI succeeds for an explicit root and rejects malformed arguments", async () => {
    const { sourceRoot } = await materialize();
    const script = resolve(dirname(new URL(import.meta.url).pathname), "../scripts/validate-source.ts");
    const successful = await execFileAsync(process.execPath, ["--import", "tsx", script, sourceRoot], {
      cwd: resolve(dirname(new URL(import.meta.url).pathname), ".."),
    });

    expect(successful.stderr).toBe("");
    expect(successful.stdout).toMatch(new RegExp(`validated ${sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*games=2.*notes=3.*assets=2.*occurrences=3.*revision=[0-9a-f]{64}`, "i"));

    await expect(execFileAsync(process.execPath, ["--import", "tsx", script, "--unknown", sourceRoot])).rejects.toMatchObject({ code: expect.any(Number) });
    await expect(execFileAsync(process.execPath, ["--import", "tsx", script, sourceRoot, join(sandbox, "other")])).rejects.toMatchObject({ code: expect.any(Number) });
  });
});
