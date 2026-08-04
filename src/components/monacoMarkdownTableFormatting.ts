import type * as Monaco from "monaco-editor";
import { isInsideFencedMarkdownCode } from "./markdownListEditing";
import {
  deriveMinimalMarkdownTableLineEdit,
  formatMarkdownTableAtLine,
} from "./markdownTableFormatting";
import { scanMarkdownTableLine } from "./markdownTableSyntax";

export function createMonacoMarkdownTableOnTypeProvider(
  monaco: Pick<typeof Monaco, "Range">,
): Monaco.languages.OnTypeFormattingEditProvider {
  return {
    autoFormatTriggerCharacters: ["|"],
    provideOnTypeFormattingEdits(model, position, character, _options, token) {
      if (token.isCancellationRequested || character !== "|") return [];
      const lineIndex = position.lineNumber - 1;
      const line = model.getLineContent(position.lineNumber);
      const typedPipeIndex = position.column - 2;
      const syntax = scanMarkdownTableLine(line);
      if (!syntax?.pipeIndices.includes(typedPipeIndex)) return [];
      const typedOffset = model.getOffsetAt(position) - 1;
      if (isInsideFencedMarkdownCode(model.getValue(), typedOffset)) return [];

      const lines = Array.from(
        { length: model.getLineCount() },
        (_, index) => model.getLineContent(index + 1),
      );
      const formatted = formatMarkdownTableAtLine(lines, lineIndex);
      if (!formatted) return [];
      return formatted.lines.flatMap((formattedLine) => {
        const edit = deriveMinimalMarkdownTableLineEdit(
          lines[formattedLine.lineIndex],
          formattedLine.text,
        );
        if (!edit) return [];
        return [{
          range: new monaco.Range(
            formattedLine.lineIndex + 1,
            edit.startColumn + 1,
            formattedLine.lineIndex + 1,
            edit.endColumn + 1,
          ),
          text: edit.text,
        }];
      });
    },
  };
}

export function registerMonacoMarkdownTableFormatting(
  monaco: Pick<typeof Monaco, "Range" | "languages">,
): Monaco.IDisposable {
  return monaco.languages.registerOnTypeFormattingEditProvider(
    "markdown",
    createMonacoMarkdownTableOnTypeProvider(monaco),
  );
}
