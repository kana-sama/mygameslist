import type * as Monaco from "monaco-editor";
import { findMarkdownTableSourceLines } from "./markdownTableStructure";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";

export interface MonacoMarkdownTableWidthOptions {
  onRequiredWidthChange(width: number): void;
}

export function requiredMarkdownTableWidth(
  lines: readonly string[],
  measureLine: (line: string) => number,
  editorChromeWidth: number,
  safetyWidth: number,
): number {
  const tableLines = findMarkdownTableSourceLines(lines);
  if (!tableLines.length) return 0;
  const finitePixels = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const textWidth = Math.max(0, ...tableLines.map(({ text }) => finitePixels(measureLine(text))));
  return Math.ceil(textWidth + finitePixels(editorChromeWidth) + finitePixels(safetyWidth));
}

export function installMonacoMarkdownTableWidth(
  context: MonacoMarkdownEditorReadyContext,
  options: MonacoMarkdownTableWidthOptions,
): Monaco.IDisposable {
  const { editor, model } = context;
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, {
    contain: "layout style",
    left: "-100000px",
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "pre",
  });
  editor.applyFontInfo(probe);
  probe.style.tabSize = String(model.getOptions().tabSize);
  document.body.append(probe);

  const measureLine = (line: string) => {
    probe.textContent = line;
    return probe.getBoundingClientRect().width;
  };
  let frame: number | undefined;
  let lastPublishedWidth: number | undefined;
  let disposed = false;

  const measure = () => {
    frame = undefined;
    if (disposed) return;
    const layout = editor.getLayoutInfo();
    const font = editor.getOption(context.monaco.editor.EditorOption.fontInfo);
    editor.applyFontInfo(probe);
    probe.style.tabSize = String(model.getOptions().tabSize);
    probe.textContent = "M";
    const metricWidth = probe.getBoundingClientRect().width;
    if (!(layout.width > 0 && font.typicalHalfwidthCharacterWidth > 0 && metricWidth > 0)) return;
    const width = requiredMarkdownTableWidth(
      model.getLinesContent(),
      measureLine,
      layout.contentLeft + layout.verticalScrollbarWidth + 2,
      font.typicalHalfwidthCharacterWidth,
    );
    if (width === lastPublishedWidth) return;
    lastPublishedWidth = width;
    options.onRequiredWidthChange(width);
  };

  const schedule = () => {
    if (!disposed && frame === undefined) frame = window.requestAnimationFrame(measure);
  };
  const contentSubscription = model.onDidChangeContent(schedule);
  const layoutSubscription = editor.onDidLayoutChange(schedule);
  schedule();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      layoutSubscription.dispose();
      contentSubscription.dispose();
      const pendingFrame = frame;
      frame = undefined;
      if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame);
      probe.remove();
    },
  };
}
