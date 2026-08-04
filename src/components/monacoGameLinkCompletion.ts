import type * as Monaco from "monaco-editor";
import type { Game } from "../domain/types";
import type { MonacoMarkdownEditorReadyContext } from "./MonacoMarkdownEditor";
import {
  findActiveBracketGameLinkQuery,
  formatGameMarkdownCompletionInsertText,
} from "./markdownGameLinks";

export interface MonacoGameLinkCompletionOptions {
  getGames(): readonly Game[];
  excludeGameId?: string;
}

function emptyCompletionList(): Monaco.languages.CompletionList {
  return { suggestions: [] };
}

export function installMonacoGameLinkCompletion(
  context: MonacoMarkdownEditorReadyContext,
  options: MonacoGameLinkCompletionOptions,
): Monaco.IDisposable {
  return context.monaco.languages.registerCompletionItemProvider(
    { language: "markdown", scheme: "inmemory" },
    {
      triggerCharacters: ["["],
      provideCompletionItems(candidateModel, position, _completionContext, token) {
        if (
          token.isCancellationRequested
          || candidateModel !== context.model
          || context.editor.getModel() !== context.model
          || candidateModel.isDisposed()
        ) return emptyCompletionList();

        const activeQuery = findActiveBracketGameLinkQuery(
          candidateModel.getValue(),
          candidateModel.getOffsetAt(position),
        );
        if (!activeQuery) return emptyCompletionList();

        const start = candidateModel.getPositionAt(activeQuery.queryStartOffset);
        const end = candidateModel.getPositionAt(activeQuery.replaceEndOffset);
        if (start.lineNumber !== end.lineNumber) return emptyCompletionList();
        const range = new context.monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        );

        return {
          suggestions: options.getGames()
            .filter((game) => game.id !== options.excludeGameId)
            .map((game) => {
              const description = game.platforms.slice(0, 2).join(" · ");
              return {
                label: description
                  ? { label: game.title, description }
                  : { label: game.title },
                kind: context.monaco.languages.CompletionItemKind.Reference,
                filterText: game.title,
                insertText: formatGameMarkdownCompletionInsertText(game),
                range,
              };
            }),
        };
      },
    },
  );
}
