import type * as Monaco from "monaco-editor";
import type { MonacoEditorApi } from "./monacoEditorRuntime";

export const COMPACT_MARKDOWN_THEME_NAME = "mygameslist-compact-markdown";

export const COMPACT_MARKDOWN_THEME: Monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword.md", foreground: "83B4DC" },
    { token: "keyword.table.header.md", foreground: "83B4DC", fontStyle: "bold" },
    { token: "comment.md", foreground: "74777E" },
    { token: "string.md", foreground: "C8A260" },
    { token: "string.link.md", foreground: "83B4DC", fontStyle: "underline" },
    { token: "string.target.md", foreground: "6FA686" },
    { token: "variable.md", foreground: "C8A260" },
    { token: "variable.source.md", foreground: "A2A4AA" },
    { token: "strong.md", foreground: "E7E7E9", fontStyle: "bold" },
    { token: "emphasis.md", foreground: "E7E7E9", fontStyle: "italic" },
    { token: "meta.separator.md", foreground: "74777E" },
  ],
  colors: {
    "editor.background": "#0E0F11",
    "editor.foreground": "#E7E7E9",
    "editor.selectionBackground": "#386589",
    "editor.inactiveSelectionBackground": "#2F4D64",
    "editorCursor.foreground": "#83B4DC",
    "editorIndentGuide.background1": "#292B2F",
    "editorIndentGuide.activeBackground1": "#6C9FC8",
    "editorWidget.background": "#1C1D21",
    "editorWidget.border": "#35373C",
    "editorSuggestWidget.background": "#1C1D21",
    "editorSuggestWidget.border": "#35373C",
    "editorSuggestWidget.selectedBackground": "#24262A",
    "editorSuggestWidget.highlightForeground": "#83B4DC",
    "editor.findMatchBackground": "#C8A26066",
    "editor.findMatchHighlightBackground": "#C8A26033",
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#74777E66",
    "scrollbarSlider.hoverBackground": "#A2A4AA88",
    "scrollbarSlider.activeBackground": "#83B4DCAA",
  },
};

export function defineCompactMarkdownTheme(api: MonacoEditorApi): void {
  api.editor.defineTheme(COMPACT_MARKDOWN_THEME_NAME, COMPACT_MARKDOWN_THEME);
}

export function createCompactMarkdownEditorOptions({
  ariaLabel,
  model,
  readOnly,
}: {
  ariaLabel: string;
  model: Monaco.editor.ITextModel;
  readOnly: boolean;
}): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    model,
    ariaLabel,
    readOnly,
    theme: COMPACT_MARKDOWN_THEME_NAME,
    accessibilitySupport: "auto",
    automaticLayout: true,
    contextmenu: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    folding: false,
    glyphMargin: false,
    guides: {
      highlightActiveIndentation: true,
      indentation: true,
    },
    hideCursorInOverviewRuler: true,
    lineDecorationsWidth: 6,
    lineNumbers: "off",
    lineNumbersMinChars: 0,
    links: true,
    minimap: { enabled: false },
    overviewRulerBorder: false,
    overviewRulerLanes: 0,
    padding: { bottom: 6, top: 6 },
    quickSuggestions: false,
    renderLineHighlight: "none",
    rulers: [],
    scrollBeyondLastColumn: 0,
    scrollBeyondLastLine: false,
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
    wrappingIndent: "same",
  };
}
