import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build, type Manifest, type Plugin } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const outputs: string[] = [];

function graph(manifest: Manifest, key: string): string[] {
  const seen = new Set<string>();
  const visit = (next: string) => {
    if (seen.has(next)) return;
    seen.add(next);
    for (const imported of manifest[next]?.imports ?? []) visit(imported);
  };
  visit(key);
  return [...seen];
}

async function productionBuild(probe: string, existingOutDir?: string) {
  const outDir = existingOutDir ?? await mkdtemp(join(tmpdir(), "mygameslist-chunks-"));
  if (!existingOutDir) outputs.push(outDir);
  const entryProbe: Plugin = {
    name: "entry-probe",
    enforce: "post",
    transform(code, id) {
      return id.endsWith("/src/main.tsx")
        ? { code: `${code}\nconsole.debug(${JSON.stringify(probe)});`, map: null }
        : undefined;
    },
  };
  await build({
    configFile: "vite.config.ts",
    plugins: [entryProbe],
    build: { emptyOutDir: true, manifest: true, outDir },
  });
  const manifest = JSON.parse(await readFile(join(outDir, ".vite/manifest.json"), "utf8")) as Manifest;
  return { manifest, outDir };
}

afterAll(async () => {
  await Promise.all(outputs.map((outDir) => rm(outDir, { force: true, recursive: true })));
});

describe("production chunking", () => {
  it("defers Monaco while keeping named vendor chunks stable", async () => {
    const first = await productionBuild("first");
    const entryKey = Object.keys(first.manifest).find((key) => first.manifest[key].isEntry);
    expect(entryKey).toBeDefined();
    const initial = graph(first.manifest, entryKey!);
    const initialFiles = initial.map((key) => first.manifest[key].file);
    const initialCss = new Set(initial.flatMap((key) => first.manifest[key].css ?? []));
    const editorKey = Object.keys(first.manifest).find((key) => key.includes("src/components/MonacoNoteEditor.tsx"));
    expect(editorKey).toBeDefined();
    const editorGraph = graph(first.manifest, editorKey!);

    expect(initialFiles.some((file) => file.includes("vendor-monaco"))).toBe(false);
    expect([...initialCss].some((file) => file.includes("vendor-monaco"))).toBe(false);
    expect(editorGraph.map((key) => first.manifest[key].file)).toContainEqual(expect.stringContaining("vendor-monaco"));
    const editorCss = editorGraph.flatMap((key) => first.manifest[key].css ?? []);
    const deferredEditorCss = editorCss.filter((file) => !initialCss.has(file));
    expect(deferredEditorCss.length).toBeGreaterThan(0);
    expect(initial.reduce((total, key) => total + gzipSync(readFileSync(join(first.outDir, first.manifest[key].file))).byteLength, 0)).toBeLessThanOrEqual(350 * 1024);
    expect(initialFiles.some((file) => file.includes("webp"))).toBe(false);
    const html = await readFile(join(first.outDir, "index.html"), "utf8");
    expect(html).not.toContain("@jsquash/webp");
    for (const css of deferredEditorCss) expect(html).not.toContain(css);

    const second = await productionBuild("second", first.outDir);
    const secondEntry = Object.keys(second.manifest).find((key) => second.manifest[key].isEntry);
    expect(secondEntry).toBeDefined();
    expect(second.manifest[secondEntry!].file).not.toBe(first.manifest[entryKey!].file);
    for (const name of ["vendor-monaco", "vendor-framework", "vendor-markdown", "vendor-tools"]) {
      const firstFile = Object.values(first.manifest).find((chunk) => chunk.file.includes(name) && chunk.file.endsWith(".js"))?.file;
      const secondFile = Object.values(second.manifest).find((chunk) => chunk.file.includes(name) && chunk.file.endsWith(".js"))?.file;
      expect(firstFile).toBeDefined();
      expect(secondFile).toBe(firstFile);
    }
  });
});
