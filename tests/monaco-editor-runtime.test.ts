import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeBoundary = vi.hoisted(() => ({
  editorApi: {
    Uri: { parse: vi.fn() },
    editor: { create: vi.fn() },
    languages: {
      registerOnTypeFormattingEditProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
  },
  registrations: [] as string[],
  workerInstances: [] as object[],
}));

vi.mock("monaco-editor", () => {
  throw new Error("The full Monaco package entry must not be loaded.");
});

vi.mock("monaco-editor/editor", () => {
  runtimeBoundary.registrations.push("editor");
  return runtimeBoundary.editorApi;
});

vi.mock("monaco-editor/features/register.all", () => {
  runtimeBoundary.registrations.push("features");
  return {};
});

vi.mock("monaco-editor/languages/definitions/markdown/register", () => {
  runtimeBoundary.registrations.push("markdown");
  return {};
});

vi.mock(
  "monaco-editor/editor/contrib/suggest/browser/suggestController",
  () => {
    runtimeBoundary.registrations.push("suggest-controller");
    return {};
  },
);

vi.mock("monaco-editor/editor/editor.worker?worker", () => ({
  default: class EditorWorker {
    constructor() {
      runtimeBoundary.workerInstances.push(this);
    }
  },
}));

afterEach(() => {
  delete (globalThis as typeof globalThis & { MonacoEnvironment?: unknown })
    .MonacoEnvironment;
});

describe("Monaco editor runtime boundary", () => {
  it("loads only the modular editor, built-in features, Markdown, and completion controller", async () => {
    const runtime = await import("../src/components/monacoEditorRuntime");

    expect(runtime.monacoEditor.editor).toBe(runtimeBoundary.editorApi.editor);
    expect(runtime.monacoEditor.Uri).toBe(runtimeBoundary.editorApi.Uri);
    expect(runtimeBoundary.registrations).toEqual([
      "editor",
      "features",
      "markdown",
      "suggest-controller",
    ]);

    const workerEnvironment = (
      globalThis as typeof globalThis & {
        MonacoEnvironment?: { getWorker(): Worker };
      }
    ).MonacoEnvironment;
    expect(workerEnvironment).toBeDefined();
    expect(workerEnvironment?.getWorker()).toBe(runtimeBoundary.workerInstances[0]);
    expect(runtimeBoundary.workerInstances).toHaveLength(1);
    expect(runtimeBoundary.editorApi.languages.registerOnTypeFormattingEditProvider)
      .toHaveBeenCalledWith("markdown", expect.objectContaining({ autoFormatTriggerCharacters: ["|"] }));
  });
});
