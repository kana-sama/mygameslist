import type * as Monaco from "monaco-editor";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";

export function installMonacoMarkdownTableOverflowWrap(
  context: MonacoMarkdownEditorReadyContext,
): Monaco.IDisposable {
  const editingCard = context.editor.getDomNode()?.closest<HTMLElement>(".note-card--editing");
  if (!editingCard) return { dispose() {} };

  let disposed = false;
  let appliedWordWrap: "on" | "off" = "on";
  const refreshWordWrap = () => {
    if (disposed) return;
    const desiredWordWrap = editingCard.dataset.shelfTableOverflow === "true" ? "off" : "on";
    if (desiredWordWrap === appliedWordWrap) return;
    context.editor.updateOptions({ wordWrap: desiredWordWrap });
    appliedWordWrap = desiredWordWrap;
  };
  const observer = new MutationObserver(refreshWordWrap);
  observer.observe(editingCard, {
    attributeFilter: ["data-shelf-table-overflow"],
    attributes: true,
  });
  refreshWordWrap();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
    },
  };
}
