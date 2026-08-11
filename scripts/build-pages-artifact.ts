import { appendFile } from "node:fs/promises";
import { buildSite } from "./build-site";
import { captureCheckoutSource, verifyCheckoutSource } from "./checkout-source-guard";

function requiredEnvironment(name: "GITHUB_OUTPUT" | "SOURCE_COMMIT_SHA"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function run(): Promise<void> {
  const repositoryRoot = process.cwd();
  const sourceRoot = "data";
  const sourceCommitSha = requiredEnvironment("SOURCE_COMMIT_SHA");
  const expected = await captureCheckoutSource({
    repositoryRoot,
    sourceRoot,
    expectedCommitSha: sourceCommitSha,
  });
  const fast = process.env.FAST === "true";
  const artifactRoot = fast ? process.env.FAST_ARTIFACT_ROOT : "dist";
  if (!artifactRoot) throw new Error("FAST_ARTIFACT_ROOT is required for a fast build");
  const result = await buildSite({
    sourceRoot,
    sourceCommitSha,
    shell: fast
      ? { kind: "cached", shellRoot: "dist" }
      : { kind: "vite", projectRoot: repositoryRoot },
    destination: { kind: "staging", artifactRoot },
  });
  await verifyCheckoutSource({ repositoryRoot, sourceRoot, expected });
  await appendFile(requiredEnvironment("GITHUB_OUTPUT"), `artifact_root=${result.artifactRoot}\n`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
