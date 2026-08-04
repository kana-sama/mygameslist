import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  COMPACT_MARKDOWN_THEME,
  COMPACT_MARKDOWN_THEME_NAME,
  createCompactMarkdownEditorOptions,
  defineCompactMarkdownTheme,
} from "../src/components/monacoMarkdownEditorConfig";

describe("compact Monaco Markdown configuration", () => {
  it("keeps Markdown editing useful while removing persistent chrome", () => {
    const model = {} as Monaco.editor.ITextModel;

    const options = createCompactMarkdownEditorOptions({
      ariaLabel: "Текст заметки",
      model,
      readOnly: false,
    });

    expect(options).toMatchObject({
      model,
      ariaLabel: "Текст заметки",
      readOnly: false,
      theme: COMPACT_MARKDOWN_THEME_NAME,
      accessibilitySupport: "auto",
      automaticLayout: true,
      contextmenu: true,
      fontSize: 12,
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 6,
      lineNumbers: "off",
      links: true,
      minimap: { enabled: false },
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      padding: { bottom: 6, top: 6 },
      quickSuggestions: false,
      renderLineHighlight: "none",
      rulers: [],
      scrollbar: {
        arrowSize: 0,
        horizontal: "hidden",
        horizontalHasArrows: false,
        horizontalScrollbarSize: 0,
        useShadows: false,
        vertical: "visible",
        verticalHasArrows: false,
        verticalScrollbarSize: 3,
      },
      stickyScroll: { enabled: false },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "currentDocument",
      wordWrap: "on",
    });
    expect(options.guides).toMatchObject({
      highlightActiveIndentation: true,
      indentation: true,
    });
  });

  it("defines a project-matched theme through the public Monaco API", () => {
    const defineTheme = vi.fn();
    const api = { editor: { defineTheme } } as unknown as typeof Monaco;

    defineCompactMarkdownTheme(api);

    expect(defineTheme).toHaveBeenCalledOnce();
    expect(defineTheme).toHaveBeenCalledWith(
      COMPACT_MARKDOWN_THEME_NAME,
      COMPACT_MARKDOWN_THEME,
    );
    expect(COMPACT_MARKDOWN_THEME).toMatchObject({
      base: "vs-dark",
      inherit: true,
      colors: {
        "editor.background": "#0E0F11",
        "editor.foreground": "#E7E7E9",
        "editorIndentGuide.background1": "#292B2F",
        "editorIndentGuide.activeBackground1": "#6C9FC8",
        "scrollbar.shadow": "#00000000",
      },
    });
    expect(COMPACT_MARKDOWN_THEME.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: "keyword.md" }),
      expect.objectContaining({ token: "string.link.md" }),
      expect.objectContaining({ token: "strong.md" }),
      expect.objectContaining({ token: "emphasis.md" }),
      expect.objectContaining({ token: "variable.source.md" }),
    ]));
  });
});
