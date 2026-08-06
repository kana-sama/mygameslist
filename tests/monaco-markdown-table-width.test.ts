import type * as Monaco from "monaco-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import {
  installMonacoMarkdownTableWidth,
  requiredMarkdownTableWidth,
} from "../src/components/monacoMarkdownTableWidth";

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

afterEach(() => {
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  document.body.replaceChildren();
});

describe("requiredMarkdownTableWidth", () => {
  it("uses the widest valid table source line plus editor chrome and safety", () => {
    const lines = [
      "prose | only",
      "| A | B |",
      "| --- | --- |",
      "| Длинная строка | [ ] |",
    ];
    const measure = vi.fn((line: string) => line.length * 8);

    expect(requiredMarkdownTableWidth(lines, measure, 12, 8))
      .toBe(lines[3].length * 8 + 20);
    expect(measure).toHaveBeenCalledTimes(3);
  });

  it("returns zero without a valid table", () => {
    expect(requiredMarkdownTableWidth(["text | value"], () => 999, 12, 8)).toBe(0);
  });

  it("sanitizes unavailable numeric measurements", () => {
    const lines = ["| A | B |", "| --- | --- |", "| x | y |"];
    expect(requiredMarkdownTableWidth(lines, () => Number.NaN, Number.NaN, Number.NaN))
      .toBe(0);
  });
});

function visualWidth(line: string): number {
  return [...line].reduce((width, character) => {
    if (character === "\t") return width + 32;
    if (/^\p{Script=Cyrillic}$/u.test(character)) return width + 12;
    if (/^[\u{2E80}-\u{9FFF}\u{FF00}-\u{FFEF}]$/u.test(character)) return width + 16;
    if (/^[\u{1F300}-\u{1FAFF}]$/u.test(character)) return width + 16;
    return width + 8;
  }, 0);
}

function createWidthHarness(initialLines: string[], frameId = 41) {
  let lines = [...initialLines];
  let frameCallback: FrameRequestCallback | undefined;
  let metricsAvailable = true;
  const contentListeners = new Set<() => void>();
  const layoutListeners = new Set<() => void>();
  const shelf = document.createElement("div");
  document.body.append(shelf);
  const contentSubscription = { dispose: vi.fn() };
  const layoutSubscription = { dispose: vi.fn() };

  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    frameCallback = callback;
    return frameId;
  });
  window.cancelAnimationFrame = vi.fn();

  const model = {
    getLinesContent: () => [...lines],
    getOptions: () => ({ tabSize: 4 }),
    onDidChangeContent: (listener: () => void) => {
      contentListeners.add(listener);
      return {
        dispose: () => {
          contentListeners.delete(listener);
          contentSubscription.dispose();
        },
      };
    },
  } as unknown as Monaco.editor.ITextModel;
  const editor = {
    applyFontInfo: (target: HTMLElement) => {
      target.getBoundingClientRect = () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: metricsAvailable ? visualWidth(target.textContent ?? "") : 0,
        toJSON: () => ({}),
        top: 0,
        width: metricsAvailable ? visualWidth(target.textContent ?? "") : 0,
        x: 0,
        y: 0,
      }) as DOMRect;
    },
    getLayoutInfo: () => ({ contentLeft: 10, verticalScrollbarWidth: 3, width: 400 }),
    getOffsetForColumn: vi.fn(),
    getOption: () => ({ typicalHalfwidthCharacterWidth: 8 }),
    getWidthOfLine: vi.fn(),
    onDidLayoutChange: (listener: () => void) => {
      layoutListeners.add(listener);
      return {
        dispose: () => {
          layoutListeners.delete(listener);
          layoutSubscription.dispose();
        },
      };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;

  return {
    context: {
      editor,
      model,
      monaco: { editor: { EditorOption: { fontInfo: 1 } } },
    } as unknown as MonacoMarkdownEditorReadyContext,
    contentSubscription,
    layoutSubscription,
    probe: {
      get isConnected() {
        return document.body.querySelector("span[aria-hidden='true']") !== null;
      },
    },
    editor,
    flushFrame() {
      const callback = frameCallback;
      frameCallback = undefined;
      callback?.(0);
    },
    emitContentChange() {
      for (const listener of contentListeners) listener();
    },
    emitLayoutChange() {
      for (const listener of layoutListeners) listener();
    },
    replaceLines(nextLines: string[]) {
      lines = [...nextLines];
    },
    setMetricsAvailable(available: boolean) {
      metricsAvailable = available;
    },
    shelf,
  };
}

describe("installMonacoMarkdownTableWidth", () => {
  it("measures initially, batches edits, publishes changes once, and disposes", () => {
    const harness = createWidthHarness([
      "| A | B |",
      "| --- | --- |",
      "| x | y |",
    ]);
    const onRequiredWidthChange = vi.fn();
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange,
    });

    harness.flushFrame();
    expect(onRequiredWidthChange).toHaveBeenCalledTimes(1);

    harness.replaceLines([
      "| A much wider value | B |",
      "| --- | --- |",
      "| x | y |",
    ]);
    harness.emitContentChange();
    harness.emitContentChange();
    harness.flushFrame();
    expect(onRequiredWidthChange).toHaveBeenCalledTimes(2);

    harness.replaceLines(["plain prose"]);
    harness.emitContentChange();
    harness.flushFrame();
    expect(onRequiredWidthChange).toHaveBeenLastCalledWith(0);

    disposable.dispose();
    expect(harness.probe.isConnected).toBe(false);
    expect(harness.contentSubscription.dispose).toHaveBeenCalledOnce();
    expect(harness.layoutSubscription.dispose).toHaveBeenCalledOnce();
  });

  it("measures full model lines with tabs and full-width characters instead of visible columns", () => {
    const harness = createWidthHarness([
      "| A | B |",
      "| --- | --- |",
      "| \tДлинная界😀 | y |",
    ]);
    const onRequiredWidthChange = vi.fn();
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange,
    });

    harness.flushFrame();

    expect(onRequiredWidthChange).toHaveBeenLastCalledWith(
      visualWidth("| \tДлинная界😀 | y |") + 23,
    );
    expect(harness.editor.getOffsetForColumn).not.toHaveBeenCalled();
    expect(harness.editor.getWidthOfLine).not.toHaveBeenCalled();
    expect(harness.shelf.contains(document.body.querySelector("span[aria-hidden='true']"))).toBe(false);
    disposable.dispose();
  });

  it("does not republish an unchanged width after layout", () => {
    const harness = createWidthHarness(["| A | B |", "| --- | --- |", "| x | y |"]);
    const onRequiredWidthChange = vi.fn();
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange,
    });

    harness.flushFrame();
    harness.emitLayoutChange();
    harness.flushFrame();

    expect(onRequiredWidthChange).toHaveBeenCalledTimes(1);
    disposable.dispose();
  });

  it("waits for usable font and DOM metrics before publishing", () => {
    const harness = createWidthHarness(["| A | B |", "| --- | --- |", "| x | y |"]);
    const onRequiredWidthChange = vi.fn();
    harness.setMetricsAvailable(false);
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange,
    });

    harness.flushFrame();
    expect(onRequiredWidthChange).not.toHaveBeenCalled();

    harness.setMetricsAvailable(true);
    harness.emitLayoutChange();
    harness.flushFrame();
    expect(onRequiredWidthChange).toHaveBeenCalledTimes(1);
    disposable.dispose();
  });

  it("does not measure a cancelled frame after disposal", () => {
    const harness = createWidthHarness(["| A | B |", "| --- | --- |", "| x | y |"]);
    const onRequiredWidthChange = vi.fn();
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange,
    });

    disposable.dispose();
    harness.flushFrame();

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(onRequiredWidthChange).not.toHaveBeenCalled();
  });

  it("batches and cancels a frame whose ID is zero", () => {
    const harness = createWidthHarness(["| A | B |", "| --- | --- |", "| x | y |"], 0);
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange: vi.fn(),
    });

    harness.emitContentChange();
    harness.emitLayoutChange();
    disposable.dispose();

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(0);
  });

  it("measures after queued table formatting updates the model", async () => {
    const harness = createWidthHarness(["| A | B |", "| --- | --- |", "| x | y |"]);
    const onRequiredWidthChange = vi.fn();
    const disposable = installMonacoMarkdownTableWidth(harness.context, {
      onRequiredWidthChange,
    });

    queueMicrotask(() => {
      harness.replaceLines(["| formatted much wider | B |", "| --- | --- |", "| x | y |"]);
      harness.emitContentChange();
    });
    await Promise.resolve();
    harness.flushFrame();

    expect(onRequiredWidthChange).toHaveBeenLastCalledWith(
      visualWidth("| formatted much wider | B |") + 23,
    );
    disposable.dispose();
  });
});
