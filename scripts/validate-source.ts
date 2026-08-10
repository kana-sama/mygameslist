import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assembleSourceTree, type SourceAssembly } from "../src/source";
import { createFileSystemSourceReader } from "./source-tree-fs";

const SOURCE_COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface ValidateSourceTreeOptions {
  /** Physical directory mounted as logical `data`. */
  sourceRoot: string;
  /** `null` for authored/local validation; exact checked-out SHA for build callers. */
  sourceCommitSha: string | null;
}

export async function validateSourceTree(
  options: ValidateSourceTreeOptions,
): Promise<SourceAssembly> {
  return assembleSourceTree(createFileSystemSourceReader(options.sourceRoot), {
    sourceCommitSha: options.sourceCommitSha,
  });
}

interface ValidateCliOptions {
  sourceRoot: string;
  sourceCommitSha: string | null;
}

function parseCliArguments(arguments_: readonly string[]): ValidateCliOptions {
  const positional: string[] = [];
  let sourceCommitSha: string | null = null;
  let sawSourceCommitSha = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--source-commit-sha") {
      if (sawSourceCommitSha) throw new Error("Duplicate --source-commit-sha");
      sawSourceCommitSha = true;
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error("Missing value for --source-commit-sha");
      if (!SOURCE_COMMIT_SHA.test(value)) throw new Error("--source-commit-sha must be lowercase 40- or 64-character hex");
      sourceCommitSha = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown argument ${argument}`);
    positional.push(argument);
  }
  if (positional.length !== 1) throw new Error("Usage: validate-source.ts <source-root> [--source-commit-sha <sha>]");
  return { sourceRoot: positional[0], sourceCommitSha };
}

async function runCli(arguments_: readonly string[]): Promise<void> {
  const options = parseCliArguments(arguments_);
  const assembly = await validateSourceTree(options);
  const root = resolve(options.sourceRoot);
  process.stdout.write(
    `validated ${root} games=${Object.keys(assembly.database.games).length} notes=${Object.keys(assembly.database.notes).length} `
    + `assets=${Object.keys(assembly.database.assets).length} occurrences=${assembly.sourceAssetOccurrences} revision=${assembly.database.revision}\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
