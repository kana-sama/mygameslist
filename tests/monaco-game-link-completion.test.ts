import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { installMonacoGameLinkCompletion as exportedInstaller } from "../src/components";
import {
  installMonacoGameLinkCompletion,
  type MonacoGameLinkCompletionOptions,
} from "../src/components/monacoGameLinkCompletion";
import type { MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import type { Game } from "../src/domain/types";

const NOW = "2026-08-04T12:00:00.000Z";

function game(id: string, title: string, platforms: string[] = ["PC"]): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms,
    tags: [],
    status: "playing",
    placement: { tierId: "unranked", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class TestRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

interface TestModel extends Monaco.editor.ITextModel {
  setDisposed(disposed: boolean): void;
  setTestValue(value: string): void;
}

function createModel(initialValue: string): TestModel {
  let value = initialValue;
  let disposed = false;

  const lineStarts = () => {
    const starts = [0];
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === "\n") starts.push(index + 1);
    }
    return starts;
  };

  return {
    getOffsetAt(position: Monaco.IPosition) {
      const starts = lineStarts();
      return starts[position.lineNumber - 1] + position.column - 1;
    },
    getPositionAt(offset: number) {
      const starts = lineStarts();
      let lineIndex = starts.length - 1;
      while (lineIndex > 0 && starts[lineIndex] > offset) lineIndex -= 1;
      return { lineNumber: lineIndex + 1, column: offset - starts[lineIndex] + 1 };
    },
    getValue: () => value,
    isDisposed: () => disposed,
    setDisposed(nextDisposed) {
      disposed = nextDisposed;
    },
    setTestValue(nextValue) {
      value = nextValue;
    },
  } as TestModel;
}

interface CompletionHarness {
  context: MonacoMarkdownEditorReadyContext;
  disposable: Monaco.IDisposable;
  getGames: ReturnType<typeof vi.fn<MonacoGameLinkCompletionOptions["getGames"]>>;
  model: TestModel;
  provider: Monaco.languages.CompletionItemProvider;
  register: ReturnType<typeof vi.fn>;
  registrationDispose: ReturnType<typeof vi.fn>;
  setCurrentModel(model: Monaco.editor.ITextModel | null): void;
}

function createHarness(
  value = "[]",
  games: readonly Game[] = [],
  options: Partial<MonacoGameLinkCompletionOptions> = {},
): CompletionHarness {
  const model = createModel(value);
  let currentModel: Monaco.editor.ITextModel | null = model;
  let provider: Monaco.languages.CompletionItemProvider | undefined;
  const registrationDispose = vi.fn();
  const register = vi.fn((
    _selector: Monaco.languages.LanguageSelector,
    nextProvider: Monaco.languages.CompletionItemProvider,
  ) => {
    provider = nextProvider;
    return { dispose: registrationDispose };
  });
  const getGames = vi.fn<MonacoGameLinkCompletionOptions["getGames"]>(() => games);
  const context = {
    editor: { getModel: () => currentModel },
    model,
    monaco: {
      languages: {
        CompletionItemKind: { Reference: 21 },
        registerCompletionItemProvider: register,
      },
      Range: TestRange,
    },
  } as unknown as MonacoMarkdownEditorReadyContext;
  const disposable = installMonacoGameLinkCompletion(context, {
    getGames,
    ...options,
  });
  if (!provider) throw new Error("Completion provider was not registered");

  return {
    context,
    disposable,
    getGames,
    model,
    provider,
    register,
    registrationDispose,
    setCurrentModel(nextModel) {
      currentModel = nextModel;
    },
  };
}

const activeContext = { triggerKind: 1, triggerCharacter: "[" } as Monaco.languages.CompletionContext;

function cancellationToken(cancelled = false): Monaco.CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: () => ({ dispose() {} }),
  };
}

async function provide(
  harness: CompletionHarness,
  model: Monaco.editor.ITextModel = harness.model,
  offset = model.getValue().length - (model.getValue().endsWith("]") ? 1 : 0),
  cancelled = false,
): Promise<Monaco.languages.CompletionList> {
  const result = await harness.provider.provideCompletionItems(
    model,
    model.getPositionAt(offset),
    activeContext,
    cancellationToken(cancelled),
  );
  if (!result) throw new Error("Provider returned no completion list");
  return result;
}

describe("installMonacoGameLinkCompletion", () => {
  it("registers the native Markdown provider, exports it publicly, and disposes its registration", () => {
    const harness = createHarness();

    expect(exportedInstaller).toBe(installMonacoGameLinkCompletion);
    expect(harness.register).toHaveBeenCalledOnce();
    expect(harness.register.mock.calls[0][0]).toEqual({ language: "markdown", scheme: "inmemory" });
    expect(harness.provider.triggerCharacters).toEqual(["["]);

    harness.disposable.dispose();
    expect(harness.registrationDispose).toHaveBeenCalledOnce();
  });

  it("returns no items for foreign, detached, disposed, cancelled, and ineligible requests", async () => {
    const target = game("target", "Target");
    const harness = createHarness("[]", [target]);
    const foreign = createModel("[]");

    expect((await provide(harness, foreign)).suggestions).toEqual([]);
    harness.setCurrentModel(null);
    expect((await provide(harness)).suggestions).toEqual([]);
    harness.setCurrentModel(harness.model);
    harness.model.setDisposed(true);
    expect((await provide(harness)).suggestions).toEqual([]);
    harness.model.setDisposed(false);
    expect((await provide(harness, harness.model, 1, true)).suggestions).toEqual([]);
    harness.model.setTestValue("ordinary paragraph");
    expect((await provide(harness, harness.model, "ordinary paragraph".length)).suggestions).toEqual([]);
    expect(harness.getGames).not.toHaveBeenCalled();
  });

  it("reads fresh uncapped games and reapplies current-game exclusion on every invocation", async () => {
    const excluded = game("current", "Current game");
    let currentGames: readonly Game[] = [
      excluded,
      ...Array.from({ length: 10 }, (_, index) => game(`game-${index}`, `Game ${index}`)),
    ];
    const sourceGetter = vi.fn(() => currentGames);
    const harness = createHarness("[]", [], {
      excludeGameId: excluded.id,
      getGames: sourceGetter,
    });

    const first = await provide(harness);
    expect(first.suggestions).toHaveLength(10);
    expect(first.suggestions.map((item) => item.insertText)).not.toContain(
      "Current game](#/games/current)",
    );

    currentGames = [excluded, game("fresh", "Fresh game")];
    const second = await provide(harness);
    expect(second.suggestions.map((item) => item.insertText)).toEqual([
      "Fresh game](#/games/fresh)",
    ]);
    expect(sourceGetter).toHaveBeenCalledTimes(2);
  });

  it("keeps duplicate titles distinct with structured platform descriptions", async () => {
    const harness = createHarness("[]", [
      game("first/id", "Same title", ["PC", "Switch", "PS5"]),
      game("second/id", "Same title", ["NES"]),
    ]);

    const result = await provide(harness);

    expect(result.suggestions.map((item) => item.label)).toEqual([
      { label: "Same title", description: "PC · Switch" },
      { label: "Same title", description: "NES" },
    ]);
    expect(result.suggestions.map((item) => item.insertText)).toEqual([
      "Same title](#/games/first%2Fid)",
      "Same title](#/games/second%2Fid)",
    ]);
  });

  it("returns one native single-line range that preserves the opening bracket and consumes one closing bracket", async () => {
    const target = game("game/id with spaces", "The Legend of Zelda", ["NES"]);
    const harness = createHarness("Before\n[Super M]", [target]);

    const result = await provide(harness, harness.model, 15);
    const item = result.suggestions[0];

    expect(item).toEqual({
      label: { label: "The Legend of Zelda", description: "NES" },
      kind: 21,
      filterText: "The Legend of Zelda",
      insertText: "The Legend of Zelda](#/games/game%2Fid%20with%20spaces)",
      range: new TestRange(2, 2, 2, 10),
    });
    expect(Object.keys(item).sort()).toEqual([
      "filterText",
      "insertText",
      "kind",
      "label",
      "range",
    ]);
  });

  it("ends the replacement range at the caret when there is no immediate closing bracket", async () => {
    const harness = createHarness("[zel", [game("zelda", "Zelda")]);

    const result = await provide(harness, harness.model, 4);

    expect(result.suggestions[0].range).toEqual(new TestRange(1, 2, 1, 5));
  });
});
