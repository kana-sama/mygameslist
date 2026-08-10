// @vitest-environment node

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { beforeAll, describe, expect, test } from "vitest";

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Workflow {
  jobs: {
    build: {
      steps: WorkflowStep[];
    };
  };
}

let workflow: Workflow;
let steps: WorkflowStep[];

beforeAll(async () => {
  workflow = parse(await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")) as Workflow;
  steps = workflow.jobs.build.steps;
});

function stepById(id: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Missing workflow step id=${id}`);
  return step;
}

function stepByName(name: string): WorkflowStep {
  const step = steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing workflow step ${name}`);
  return step;
}

async function classify(options: {
  eventName?: string;
  forced?: boolean;
  before?: string;
  after?: string;
  response?: unknown;
  requestError?: Error;
} = {}): Promise<{ sourceOnly: string | undefined; notices: string[]; warnings: string[] }> {
  const outputs = new Map<string, string>();
  const notices: string[] = [];
  const warnings: string[] = [];
  const before = options.before ?? "1".repeat(40);
  const after = options.after ?? "2".repeat(40);
  const github = {
    request: async () => {
      if (options.requestError) throw options.requestError;
      return options.response ?? { data: { status: "ahead", files: [{ filename: "data/manifest.yaml" }] } };
    },
  };
  const context = {
    eventName: options.eventName ?? "push",
    sha: after,
    repo: { owner: "owner", repo: "repo" },
    payload: { before, forced: options.forced ?? false },
  };
  const core = {
    setOutput: (name: string, value: string) => outputs.set(name, value),
    notice: (message: string) => notices.push(message),
    warning: (message: string) => warnings.push(message),
  };
  const Script = Object.getPrototypeOf(async function () { /* compile embedded workflow behavior */ }).constructor as new (
    ...arguments_: string[]
  ) => (...values: unknown[]) => Promise<void>;
  await new Script("github", "context", "core", stepById("changes").with?.script ?? "")(github, context, core);
  return { sourceOnly: outputs.get("source_only"), notices, warnings };
}

describe("Pages changed-file classifier", () => {
  test("selects the fast route only for a complete nonempty data-only ahead push", async () => {
    await expect(classify()).resolves.toMatchObject({ sourceOnly: "true" });
    await expect(classify({
      response: { data: { status: "ahead", files: [{ filename: "data/new.md", previous_filename: "data/old.md" }] } },
    })).resolves.toMatchObject({ sourceOnly: "true" });
  });

  test.each([
    ["non-push", { eventName: "workflow_dispatch" }],
    ["forced push", { forced: true }],
    ["zero before", { before: "0".repeat(40) }],
    ["unchanged range", { before: "2".repeat(40), after: "2".repeat(40) }],
    ["comparison API failure", { requestError: new Error("offline") }],
    ["non-ahead status", { response: { data: { status: "diverged", files: [{ filename: "data/a" }] } } }],
    ["missing file list", { response: { data: { status: "ahead" } } }],
    ["empty file list", { response: { data: { status: "ahead", files: [] } } }],
    ["outside path", { response: { data: { status: "ahead", files: [{ filename: "src/App.tsx" }] } } }],
    ["renamed from outside", { response: { data: { status: "ahead", files: [{ filename: "data/a", previous_filename: "public/a" }] } } }],
    ["sibling prefix", { response: { data: { status: "ahead", files: [{ filename: "database/a" }] } } }],
    ["truncated 300-file list", { response: { data: { status: "ahead", files: Array.from({ length: 300 }, (_, index) => ({ filename: `data/${index}` })) } } }],
  ])("uses the full route for %s", async (_name, options) => {
    await expect(classify(options)).resolves.toMatchObject({ sourceOnly: "false" });
  });

  test("accepts the complete 299-file boundary", async () => {
    await expect(classify({
      response: { data: { status: "ahead", files: Array.from({ length: 299 }, (_, index) => ({ filename: `data/${index}` })) } },
    })).resolves.toMatchObject({ sourceOnly: "true" });
  });
});

describe("Pages build routes", () => {
  test("installs locked dependencies unconditionally before validation and assembly", () => {
    const install = stepByName("Install dependencies");
    const validate = stepByName("Validate source");
    const site = stepById("site");
    expect(install.run).toBe("npm ci");
    expect(install.if).toBeUndefined();
    expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(validate));
    expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(site));
    expect(validate.run).toBe("npm run data:validate");
    expect(validate.if).toBeUndefined();
  });

  test("caches shell-only paths and keys without generated data or media namespaces", () => {
    const cache = stepById("shell_cache");
    expect(cache.with?.path?.trim().split(/\s+/u)).toEqual(["dist/index.html", "dist/assets", "dist/.nojekyll"]);
    expect(cache.with?.key).toContain("package-lock.json");
    expect(cache.with?.key).toContain("src/**");
    expect(cache.with?.key).not.toMatch(/(?:^|[,'"\s])data(?:\/\*\*)?(?:[,'"\s]|$)/u);
    expect(cache.with?.key).not.toMatch(/(?:^|[,'"\s])media(?:\/\*\*)?(?:[,'"\s]|$)/u);
  });

  test("full route runs tests and TypeScript before the guarded builder", () => {
    const tests = stepByName("Test");
    const typecheck = stepByName("Typecheck");
    const site = stepById("site");
    expect(tests.run).toBe("npm test");
    expect(typecheck.run).toBe("npx tsc -b");
    expect(tests.if).toContain("fast != 'true'");
    expect(typecheck.if).toContain("fast != 'true'");
    expect(steps.indexOf(tests)).toBeLessThan(steps.indexOf(site));
    expect(steps.indexOf(typecheck)).toBeLessThan(steps.indexOf(site));
  });

  test("both routes call one builder between checkout capture and verification with exact provenance", () => {
    const site = stepById("site");
    const run = site.run ?? "";
    expect(site.env?.SOURCE_COMMIT_SHA).toBe("${{ github.sha }}");
    expect(run).toContain("captureCheckoutSource");
    expect(run).toContain("buildSite");
    expect(run).toContain("verifyCheckoutSource");
    expect(run.indexOf("captureCheckoutSource(")).toBeLessThan(run.indexOf("buildSite("));
    expect(run.indexOf("buildSite(")).toBeLessThan(run.indexOf("verifyCheckoutSource("));
    expect(run).toContain('sourceRoot: "data"');
    expect(run).toContain("sourceCommitSha: process.env.SOURCE_COMMIT_SHA");
    expect(run).toContain('kind: "cached"');
    expect(run).toContain('kind: "vite"');
    expect(run).not.toContain("cp -R public");
  });

  test("fast route writes a fresh runner-temp artifact while full route produces validated dist", () => {
    const site = stepById("site");
    expect(site.env?.FAST).toContain("steps.build_path.outputs.fast");
    expect(site.env?.FAST_ARTIFACT_ROOT).toContain("runner.temp");
    expect(site.run).toContain('process.env.FAST === "true"');
    expect(site.run).toContain('artifactRoot: process.env.FAST_ARTIFACT_ROOT');
    expect(site.run).toContain('artifactRoot: "dist"');
  });

  test("uploads the verified builder output immediately without a public overlay", () => {
    const siteIndex = steps.findIndex((step) => step.id === "site");
    const upload = steps[siteIndex + 1];
    expect(upload?.uses).toBe("actions/upload-pages-artifact@v3");
    expect(upload?.with?.path).toBe("${{ steps.site.outputs.artifact_root }}");
    expect(steps.map((step) => step.run ?? "").join("\n")).not.toContain("cp -R public");
  });
});
