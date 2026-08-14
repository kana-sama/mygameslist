import type * as Monaco from "monaco-editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import { installMonacoMarkdownTableOverflowWrap } from "../src/components/monacoMarkdownTableOverflowWrap";

function createHarness(options: { overflow?: boolean; owner?: boolean } = {}) {
  const editorDom = document.createElement("div");
  const editingCard = document.createElement("article");
  editingCard.className = "note-card--editing";
  if (options.overflow) editingCard.dataset.shelfTableOverflow = "true";
  if (options.owner !== false) editingCard.append(editorDom);
  else document.body.append(editorDom);
  document.body.append(editingCard);

  const editor = {
    getDomNode: () => editorDom,
    updateOptions: vi.fn(),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;

  return {
    context: { editor } as MonacoMarkdownEditorReadyContext,
    editingCard,
    editor,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("installMonacoMarkdownTableOverflowWrap", () => {
  it("turns wrapping off for residual overflow and restores it when the marker clears", async () => {
    const harness = createHarness();
    const disposable = installMonacoMarkdownTableOverflowWrap(harness.context);

    harness.editingCard.dataset.shelfTableOverflow = "true";
    await Promise.resolve();
    expect(harness.editor.updateOptions).toHaveBeenLastCalledWith({ wordWrap: "off" });

    harness.editingCard.removeAttribute("data-shelf-table-overflow");
    await Promise.resolve();
    expect(harness.editor.updateOptions).toHaveBeenLastCalledWith({ wordWrap: "on" });

    disposable.dispose();
  });

  it("applies initially marked overflow once and ignores equivalent mutations", async () => {
    const harness = createHarness({ overflow: true });
    const disposable = installMonacoMarkdownTableOverflowWrap(harness.context);
    expect(harness.editor.updateOptions).toHaveBeenCalledTimes(1);
    expect(harness.editor.updateOptions).toHaveBeenLastCalledWith({ wordWrap: "off" });

    harness.editingCard.dataset.shelfTableOverflow = "true";
    await Promise.resolve();
    expect(harness.editor.updateOptions).toHaveBeenCalledTimes(1);

    disposable.dispose();
  });

  it("does nothing without an owning editing card", () => {
    const harness = createHarness({ owner: false });
    const disposable = installMonacoMarkdownTableOverflowWrap(harness.context);

    expect(harness.editor.updateOptions).not.toHaveBeenCalled();
    disposable.dispose();
  });

  it("stops reacting after disposal", async () => {
    const harness = createHarness();
    const disposable = installMonacoMarkdownTableOverflowWrap(harness.context);
    disposable.dispose();

    harness.editingCard.dataset.shelfTableOverflow = "true";
    await Promise.resolve();
    expect(harness.editor.updateOptions).not.toHaveBeenCalled();
  });
});
