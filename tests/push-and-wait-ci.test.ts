// @vitest-environment node

import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const HELPER = new URL("../scripts/push-and-wait-ci.sh", import.meta.url).pathname;
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

let sandbox = "";

afterEach(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
  sandbox = "";
});

async function executable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function runHelper(remoteList: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  jjCalls: string[];
  curlCalls: string[];
}> {
  sandbox = await mkdtemp(join(tmpdir(), "mygameslist-push-ci-"));
  const fakeBin = join(sandbox, "bin");
  const jjLog = join(sandbox, "jj.log");
  const curlLog = join(sandbox, "curl.log");
  await mkdir(fakeBin);

  await executable(join(fakeBin, "jj"), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_JJ_LOG"
if [[ "$*" == "--ignore-working-copy git remote list" ]]; then
  printf '%s\\n' "\${FAKE_REMOTE_LIST-}"
elif [[ "$1" == "--color" ]]; then
  printf '%s\\n' "$FAKE_COMMIT_SHA"
fi
`);
  await executable(join(fakeBin, "curl"), `#!/bin/bash
set -euo pipefail
url="\${!#}"
printf '%s\\n' "$url" >> "$FAKE_CURL_LOG"
if [[ "$url" == *"/actions/runs?"* ]]; then
  printf '%s\\n' '{"workflow_runs":[{"id":4242,"path":".github/workflows/deploy.yml","created_at":"2026-08-11T00:00:00Z","html_url":"https://github.com/owner/repo/actions/runs/4242"}]}'
else
  printf '%s\\n' '{"status":"completed","conclusion":"success"}'
fi
`);
  await executable(join(fakeBin, "jq"), `#!/bin/bash
set -euo pipefail
query="\${!#}"
case "$query" in
  *'.id // empty'*) printf '%s\\n' '4242' ;;
  *'.html_url // empty'*) printf '%s\\n' 'https://github.com/owner/repo/actions/runs/4242' ;;
  *'.status // "unknown"'*) printf '%s\\n' 'completed' ;;
  *'.conclusion // empty'*) printf '%s\\n' 'success' ;;
  *) exit 2 ;;
esac
`);
  await executable(join(fakeBin, "sed"), `#!/bin/bash
set -euo pipefail
IFS= read -r value || true
value="\${value#git@github.com:}"
value="\${value#https://github.com/}"
value="\${value%.git}"
printf '%s' "$value"
`);
  await executable(join(fakeBin, "date"), `#!/bin/bash
printf '%s\\n' '1000'
`);

  const child = spawn("/bin/bash", [HELPER], {
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: fakeBin,
      FAKE_REMOTE_LIST: remoteList,
      FAKE_COMMIT_SHA: COMMIT_SHA,
      FAKE_JJ_LOG: jjLog,
      FAKE_CURL_LOG: curlLog,
      CI_WAIT_TIMEOUT_SECONDS: "5",
      CI_WAIT_POLL_SECONDS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const readLines = async (path: string): Promise<string[]> => {
    try {
      return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  return {
    code,
    stdout,
    stderr,
    jjCalls: await readLines(jjLog),
    curlCalls: await readLines(curlLog),
  };
}

describe("Jujutsu-only push and CI helper", () => {
  test.each([
    "origin git@github.com:owner/repo.git",
    "origin https://github.com/owner/repo.git",
  ])("discovers %s with Jujutsu and completes one CI poll", async (remote) => {
    const result = await runHelper(remote);

    expect(result.code, result.stderr).toBe(0);
    expect(result.jjCalls[0]).toBe("--ignore-working-copy git remote list");
    expect(result.jjCalls).toContain("b a");
    expect(result.jjCalls).toContain("git push");
    expect(result.jjCalls).not.toContain("git remote get-url origin");
    expect(result.curlCalls[0]).toBe(
      `https://api.github.com/repos/owner/repo/actions/runs?head_sha=${COMMIT_SHA}&event=push&per_page=20`,
    );
    expect(result.stdout).toContain("CI: https://github.com/owner/repo/actions/runs/4242");
    expect(result.stdout).toContain("Deploy GitHub Pages прошёл успешно.");
  });

  test.each([
    ["missing origin", "upstream git@github.com:owner/repo.git"],
    ["empty origin URL", "origin"],
    ["multiple origin entries", "origin git@github.com:owner/repo.git\norigin https://github.com/other/repo.git"],
    ["unsupported origin URL", "origin https://example.com/owner/repo.git"],
  ])("rejects %s before advancing the bookmark", async (_name, remoteList) => {
    const result = await runHelper(remoteList);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/origin|GitHub/u);
    expect(result.jjCalls[0]).toBe("--ignore-working-copy git remote list");
    expect(result.jjCalls).not.toContain("b a");
    expect(result.jjCalls).not.toContain("git push");
    expect(result.curlCalls).toEqual([]);
  });
});
