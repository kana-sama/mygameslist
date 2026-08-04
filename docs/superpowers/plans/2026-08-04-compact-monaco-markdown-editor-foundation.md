# Compact Monaco Markdown Editor Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, controlled React wrapper around Monaco 0.56.0 that provides the approved compact Markdown editing surface without replacing the current note textarea yet.

**Architecture:** A small runtime module owns Monaco's package-exported modular editor, built-in feature and Markdown registrations, and the single editor worker required by Markdown. A pure configuration module owns the theme and compact options, while `MonacoMarkdownEditor` owns one model, one editor instance, controlled-value synchronization, extension cleanup, error reporting, and React Strict Mode lifecycle behavior.

**Tech Stack:** React 19, TypeScript 7, Monaco Editor 0.56.0, Vite 8 worker imports, Vitest 4, Testing Library, Jujutsu.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-04-compact-monaco-markdown-editor-foundation-design.md` as the product contract.
- Use the official `monaco-editor@^0.56.0` package directly; do not add a React wrapper, AMD loader, CDN runtime, TextMate integration, or another editor.
- Use Monaco's package-exported modular editor, built-in feature registry, Markdown registration, and official Vite `editor.worker?worker` integration. Markdown needs no JSON, CSS, HTML, or TypeScript language-service worker.
- Do not replace or modify `GameLinkMarkdownTextarea`, `PlainMarkdownTextarea`, `GamePage`, note attachments, note save/cancel behavior, list editing, game-link completion, or table formatting in this feature.
- Do not add a mobile fallback. The supported product target for this migration is the user's Mac.
- Hide persistent editor chrome but retain indentation guides, word wrapping, native Monaco commands, search/replace, context menu, accessibility UI, and a 3 px built-in vertical scrollbar.
- Do not auto-open generic word suggestions during ordinary typing. Keep provider trigger suggestions and manual completion available.
- Use only public Monaco APIs for lifecycle, models, options, theme, commands, and later extension hooks; do not target Monaco's private DOM classes.
- Monaco 0.56's `features/suggest/register` omits the built-in suggestion controller. Isolate the package-exported import of Monaco's own `suggestController`, document its upgrade risk, and do not implement application completion logic.
- Use Jujutsu only. Never invoke `git` for status, diff, history, staging, or commits.
- The specification, this plan, dependency, implementation, tests, smoke-check fixes, and documentation all belong to the existing feature change `mvtnvsvoomsr`.
- At each task boundary inspect `jj status` and `jj diff`, then fold the task into `mvtnvsvoomsr` with `jj squash --from @ --into mvtnvsvoomsr`. Do not leave task commits in the final stack.
- If a later test or review finds a foundation defect, fix it in a descendant change and squash that fix into `mvtnvsvoomsr`.
- Follow test-driven development: observe the requested test fail for the expected reason before adding the production behavior.

---

## File Map

- `package.json`: declares Monaco as a direct runtime dependency.
- `package-lock.json`: locks Monaco and its transitive packages.
- `src/components/monacoEditorRuntime.ts`: configures the official Vite editor worker and exports the loaded public Monaco API.
- `src/components/monacoMarkdownEditorConfig.ts`: contains the named theme and the complete compact editor-options factory.
- `src/components/MonacoMarkdownEditor.tsx`: owns the React/Monaco lifecycle and exposes the reusable controlled component.
- `src/components/index.ts`: exports only the public component and its public types.
- `src/styles.css`: gives the component a parent-sized surface and compact error state without styling Monaco internals.
- `tests/monaco-markdown-editor-config.test.ts`: locks the theme and visual/behavioral option contract.
- `tests/monaco-markdown-editor.test.tsx`: tests controlled data flow, resource ownership, errors, extension cleanup, and Strict Mode behavior through a narrow Monaco mock.
- `monaco-smoke.html` and `src/monacoSmoke.tsx`: temporary local-only browser harnesses created and deleted during final verification.

### Task 1: Monaco Runtime, Theme, and Compact Configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/monacoEditorRuntime.ts`
- Create: `src/components/monacoMarkdownEditorConfig.ts`
- Create: `tests/monaco-markdown-editor-config.test.ts`

**Interfaces:**
- Consumes: Vite's existing `vite/client` types from `src/vite-env.d.ts`; Monaco's package-exported `editor`, `features/register.all`, Markdown registration, built-in suggestion controller compatibility entry, and `editor/editor.worker?worker`.
- Produces: `MonacoEditorApi`, `monacoEditor`, `COMPACT_MARKDOWN_THEME_NAME`, `COMPACT_MARKDOWN_THEME`, `defineCompactMarkdownTheme(api)`, and `createCompactMarkdownEditorOptions({ ariaLabel, model, readOnly })`.

- [ ] **Step 1: Install the exact current Monaco feature line**

Run:

```bash
npm install "monaco-editor@^0.56.0"
```

Expected: `package.json` contains `"monaco-editor": "^0.56.0"` under `dependencies`, and `package-lock.json` records the resolved 0.56.x package.

- [ ] **Step 2: Write the failing compact-configuration test**

Create `tests/monaco-markdown-editor-config.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test and confirm the missing module is the only failure**

Run:

```bash
npm test -- tests/monaco-markdown-editor-config.test.ts
```

Expected: FAIL because `src/components/monacoMarkdownEditorConfig.ts` does not exist.

- [ ] **Step 4: Add the modular ESM runtime and official editor worker**

Create `src/components/monacoEditorRuntime.ts`:

```ts
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/markdown/register";
// Monaco 0.56's features/suggest/register omits the built-in SuggestController.
// Re-audit this package-exported compatibility import whenever Monaco is upgraded.
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

type MonacoWorkerEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
};

type MonacoWorkerGlobal = typeof globalThis & {
  MonacoEnvironment?: MonacoWorkerEnvironment;
};

const workerGlobal = globalThis as MonacoWorkerGlobal;
workerGlobal.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export type MonacoEditorApi = typeof monaco;
export const monacoEditor: MonacoEditorApi = monaco;
```

The runtime deliberately creates only `editor.worker`. Do not add JSON, CSS, HTML, or TypeScript worker imports. The isolated suggestion-controller import registers Monaco's built-in completion UI/action; it is not custom completion logic and must be checked against the package on every Monaco upgrade.

- [ ] **Step 5: Implement the complete compact theme and options factory**

Create `src/components/monacoMarkdownEditorConfig.ts`:

```ts
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
```

- [ ] **Step 6: Run the focused test and type/build verification**

Run:

```bash
npm test -- tests/monaco-markdown-editor-config.test.ts
npm run build
```

Expected: the two configuration tests PASS; TypeScript accepts the official Monaco and Vite worker types; the production build exits 0.

- [ ] **Step 7: Inspect and fold Task 1 into the foundation feature change**

Run:

```bash
jj status
jj diff
jj squash --from @ --into mvtnvsvoomsr
```

Expected: only the Monaco dependency, lockfile, runtime, configuration, and focused configuration test are folded into `mvtnvsvoomsr`; the working copy becomes an empty child.

### Task 2: Controlled React Editor and Model Lifecycle

**Files:**
- Create: `src/components/MonacoMarkdownEditor.tsx`
- Create: `tests/monaco-markdown-editor.test.tsx`

**Interfaces:**
- Consumes: `monacoEditor`, `defineCompactMarkdownTheme(api)`, and `createCompactMarkdownEditorOptions({ ariaLabel, model, readOnly })` from Task 1.
- Produces: a controlled `MonacoMarkdownEditor` component accepting `modelKey`, `value`, `onChange`, `ariaLabel`, `autoFocus`, `readOnly`, and `className`; one unique `inmemory://mygameslist/markdown/<encoded-key>.md` model per mount.

- [ ] **Step 1: Write a deterministic narrow Monaco test runtime**

Create `tests/monaco-markdown-editor.test.tsx` with this test harness:

```tsx
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { MonacoMarkdownEditor } from "../src/components/MonacoMarkdownEditor";

const monacoSpies = vi.hoisted(() => ({
  create: vi.fn(),
  createModel: vi.fn(),
  defineTheme: vi.fn(),
  getModel: vi.fn(),
  parseUri: vi.fn(),
}));

vi.mock("../src/components/monacoEditorRuntime", () => ({
  monacoEditor: {
    Uri: { parse: monacoSpies.parseUri },
    editor: {
      create: monacoSpies.create,
      createModel: monacoSpies.createModel,
      defineTheme: monacoSpies.defineTheme,
      getModel: monacoSpies.getModel,
    },
  },
}));

type Listener = () => void;

type FakeModel = Monaco.editor.ITextModel & {
  emitUserValue(nextValue: string): void;
};

type FakeEditor = Monaco.editor.IStandaloneCodeEditor;

function installFakeMonaco() {
  const modelsByUri = new Map<string, FakeModel>();
  const models: FakeModel[] = [];
  const editors: FakeEditor[] = [];
  const subscriptions: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];

  monacoSpies.parseUri.mockImplementation((value: string) => ({
    toString: () => value,
  }));
  monacoSpies.getModel.mockImplementation((uri: { toString(): string }) => (
    modelsByUri.get(uri.toString()) ?? null
  ));
  monacoSpies.createModel.mockImplementation((initialValue: string, _language: string, uri: { toString(): string }) => {
    let value = initialValue;
    const listeners = new Set<Listener>();
    const key = uri.toString();
    const model = {
      dispose: vi.fn(() => modelsByUri.delete(key)),
      emitUserValue(nextValue: string) {
        value = nextValue;
        for (const listener of listeners) listener();
      },
      getValue: vi.fn(() => value),
      onDidChangeContent: vi.fn((listener: Listener) => {
        listeners.add(listener);
        const subscription = { dispose: vi.fn(() => { listeners.delete(listener); }) };
        subscriptions.push(subscription);
        return subscription;
      }),
      setValue: vi.fn((nextValue: string) => {
        value = nextValue;
        for (const listener of listeners) listener();
      }),
      uri,
      validatePosition: vi.fn((position: Monaco.IPosition) => position),
    } as unknown as FakeModel;
    modelsByUri.set(key, model);
    models.push(model);
    return model;
  });
  monacoSpies.create.mockImplementation((_container: HTMLElement, options: Monaco.editor.IStandaloneEditorConstructionOptions) => {
    let position: Monaco.IPosition | null = { column: 1, lineNumber: 1 };
    const editor = {
      dispose: vi.fn(),
      focus: vi.fn(),
      getPosition: vi.fn(() => position),
      setPosition: vi.fn((nextPosition: Monaco.IPosition) => { position = nextPosition; }),
      updateOptions: vi.fn(),
      getModel: vi.fn(() => options.model ?? null),
    } as unknown as FakeEditor;
    editors.push(editor);
    return editor;
  });

  return { editors, models, modelsByUri, subscriptions };
}

let fakeMonaco: ReturnType<typeof installFakeMonaco>;

beforeEach(() => {
  for (const spy of Object.values(monacoSpies)) spy.mockReset();
  fakeMonaco = installFakeMonaco();
});

afterEach(cleanup);
```

- [ ] **Step 2: Add the initial failing behavior tests**

Append these tests to `tests/monaco-markdown-editor.test.tsx`:

```tsx
describe("MonacoMarkdownEditor", () => {
  it("creates one accessible Markdown model and a compact editor", () => {
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={vi.fn()}
        value="# Заголовок"
      />,
    );

    expect(monacoSpies.parseUri).toHaveBeenCalledWith(
      "inmemory://mygameslist/markdown/note-1.md",
    );
    expect(monacoSpies.createModel).toHaveBeenCalledWith(
      "# Заголовок",
      "markdown",
      expect.anything(),
    );
    expect(monacoSpies.create).toHaveBeenCalledWith(
      view.container.querySelector(".monaco-markdown-editor__surface"),
      expect.objectContaining({
        ariaLabel: "Текст заметки",
        lineNumbers: "off",
        model: fakeMonaco.models[0],
        wordWrap: "on",
      }),
    );
  });

  it("forwards a user model edit exactly once", () => {
    const onChange = vi.fn();
    render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={onChange}
        value="Начало"
      />,
    );

    act(() => fakeMonaco.models[0].emitUserValue("Новый текст"));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("Новый текст");
  });

  it("accepts controlled echoes and external replacements without feedback", () => {
    const onChange = vi.fn();
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={onChange}
        value="Начало"
      />,
    );
    const model = fakeMonaco.models[0];
    const editor = fakeMonaco.editors[0];

    act(() => model.emitUserValue("Локальный текст"));
    view.rerender(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={onChange}
        value="Локальный текст"
      />,
    );
    expect(model.setValue).not.toHaveBeenCalled();

    view.rerender(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={onChange}
        value="Внешний сброс"
      />,
    );

    expect(model.setValue).toHaveBeenCalledOnce();
    expect(model.setValue).toHaveBeenCalledWith("Внешний сброс");
    expect(editor.setPosition).toHaveBeenCalledWith({ column: 1, lineNumber: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("disposes the old document and creates fresh state when modelKey changes", () => {
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={vi.fn()}
        value="Первый"
      />,
    );
    const firstModel = fakeMonaco.models[0];
    const firstEditor = fakeMonaco.editors[0];

    view.rerender(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note/2"
        onChange={vi.fn()}
        value="Второй"
      />,
    );

    expect(firstEditor.dispose).toHaveBeenCalledOnce();
    expect(firstModel.dispose).toHaveBeenCalledOnce();
    expect(monacoSpies.parseUri).toHaveBeenLastCalledWith(
      "inmemory://mygameslist/markdown/note%2F2.md",
    );
    expect(monacoSpies.createModel).toHaveBeenLastCalledWith(
      "Второй",
      "markdown",
      expect.anything(),
    );
  });
});
```

- [ ] **Step 3: Run the test and confirm the component is missing**

Run:

```bash
npm test -- tests/monaco-markdown-editor.test.tsx
```

Expected: FAIL because `src/components/MonacoMarkdownEditor.tsx` does not exist.

- [ ] **Step 4: Implement the minimal controlled lifecycle**

Create `src/components/MonacoMarkdownEditor.tsx`:

```tsx
import { useEffect, useRef, type ReactElement } from "react";
import type * as Monaco from "monaco-editor";
import {
  createCompactMarkdownEditorOptions,
  defineCompactMarkdownTheme,
} from "./monacoMarkdownEditorConfig";
import { monacoEditor } from "./monacoEditorRuntime";

export interface MonacoMarkdownEditorProps {
  modelKey: string;
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  readOnly?: boolean;
}

export function MonacoMarkdownEditor({
  ariaLabel,
  autoFocus = false,
  className,
  modelKey,
  onChange,
  readOnly = false,
  value,
}: MonacoMarkdownEditorProps): ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const applyingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const uri = monacoEditor.Uri.parse(
      `inmemory://mygameslist/markdown/${encodeURIComponent(modelKey)}.md`,
    );
    const existingModel = monacoEditor.editor.getModel(uri);
    if (existingModel) {
      throw new Error(`Monaco modelKey "${modelKey}" is already mounted.`);
    }

    defineCompactMarkdownTheme(monacoEditor);
    const model = monacoEditor.editor.createModel(valueRef.current, "markdown", uri);
    const editor = monacoEditor.editor.create(
      surface,
      createCompactMarkdownEditorOptions({ ariaLabel, model, readOnly }),
    );
    const changeSubscription = model.onDidChangeContent(() => {
      if (!applyingExternalValueRef.current) {
        onChangeRef.current(model.getValue());
      }
    });

    modelRef.current = model;
    editorRef.current = editor;
    if (autoFocus) editor.focus();

    return () => {
      changeSubscription.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [modelKey]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.getValue() === value) return;

    const position = editor.getPosition();
    applyingExternalValueRef.current = true;
    try {
      model.setValue(value);
    } finally {
      applyingExternalValueRef.current = false;
    }
    if (position) editor.setPosition(model.validatePosition(position));
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ ariaLabel, readOnly });
  }, [ariaLabel, readOnly]);

  const rootClassName = ["monaco-markdown-editor", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <div className="monaco-markdown-editor__surface" ref={surfaceRef} />
    </div>
  );
}
```

Using `model.setValue` only for a genuinely different external value intentionally resets that document's local undo history; user edits continue through Monaco's normal undo stack.

- [ ] **Step 5: Run focused lifecycle tests**

Run:

```bash
npm test -- tests/monaco-markdown-editor.test.tsx
```

Expected: all four component tests PASS with no real Monaco DOM loaded by jsdom.

- [ ] **Step 6: Inspect and fold Task 2 into the foundation feature change**

Run:

```bash
jj status
jj diff
jj squash --from @ --into mvtnvsvoomsr
```

Expected: only the controlled component and its lifecycle test are folded into `mvtnvsvoomsr`; the working copy becomes an empty child.

### Task 3: Extension Boundary, Error Recovery, Strict Mode, Styles, and Public Export

**Files:**
- Modify: `src/components/MonacoMarkdownEditor.tsx`
- Modify: `src/components/index.ts`
- Modify: `src/styles.css`
- Modify: `tests/monaco-markdown-editor.test.tsx`

**Interfaces:**
- Consumes: the controlled component and fake Monaco runtime from Task 2.
- Produces: `MonacoMarkdownEditorReadyContext`, `MonacoMarkdownEditorExtension`, optional `onReady` and `onError` props, a compact `role="alert"` failure state, deterministic disposal of partial initialization, and a public barrel export.

- [ ] **Step 1: Add failing tests for the extension and dynamic options**

Append inside the existing `describe("MonacoMarkdownEditor")` block:

```tsx
it("focuses on request, updates mutable options, and cleans up the extension", () => {
  const extensionDisposable = { dispose: vi.fn() };
  const onReady = vi.fn(() => extensionDisposable);
  const view = render(
    <MonacoMarkdownEditor
      ariaLabel="Текст заметки"
      autoFocus
      className="note-input"
      modelKey="note-1"
      onChange={vi.fn()}
      onReady={onReady}
      value="Текст"
    />,
  );
  const editor = fakeMonaco.editors[0];
  const model = fakeMonaco.models[0];

  expect(editor.focus).toHaveBeenCalledOnce();
  expect(onReady).toHaveBeenCalledWith({
    editor,
    model,
    monaco: expect.anything(),
  });
  expect(view.container.firstElementChild).toHaveClass(
    "monaco-markdown-editor",
    "note-input",
  );

  view.rerender(
    <MonacoMarkdownEditor
      ariaLabel="Заметка только для чтения"
      className="note-input"
      modelKey="note-1"
      onChange={vi.fn()}
      onReady={onReady}
      readOnly
      value="Текст"
    />,
  );
  expect(editor.updateOptions).toHaveBeenLastCalledWith({
    ariaLabel: "Заметка только для чтения",
    readOnly: true,
  });

  view.unmount();
  expect(extensionDisposable.dispose).toHaveBeenCalledOnce();
});

it("uses the latest onChange callback without recreating Monaco", () => {
  const firstOnChange = vi.fn();
  const secondOnChange = vi.fn();
  const view = render(
    <MonacoMarkdownEditor
      ariaLabel="Текст заметки"
      modelKey="note-1"
      onChange={firstOnChange}
      value="Текст"
    />,
  );

  view.rerender(
    <MonacoMarkdownEditor
      ariaLabel="Текст заметки"
      modelKey="note-1"
      onChange={secondOnChange}
      value="Текст"
    />,
  );
  act(() => fakeMonaco.models[0].emitUserValue("Изменение"));

  expect(monacoSpies.create).toHaveBeenCalledOnce();
  expect(firstOnChange).not.toHaveBeenCalled();
  expect(secondOnChange).toHaveBeenCalledWith("Изменение");
});
```

- [ ] **Step 2: Add failing tests for duplicate keys, initialization errors, and Strict Mode**

Append inside the same `describe` block:

```tsx
it("reports a duplicate live modelKey without coupling editor state", () => {
  const onError = vi.fn();
  const view = render(
    <>
      <MonacoMarkdownEditor
        ariaLabel="Первая заметка"
        modelKey="shared"
        onChange={vi.fn()}
        value="Первая"
      />
      <MonacoMarkdownEditor
        ariaLabel="Вторая заметка"
        modelKey="shared"
        onChange={vi.fn()}
        onError={onError}
        value="Вторая"
      />
    </>,
  );

  expect(view.getByRole("alert")).toHaveTextContent("Не удалось открыть редактор.");
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0]).toEqual(expect.objectContaining({
    message: 'Monaco modelKey "shared" is already mounted.',
  }));
  expect(monacoSpies.createModel).toHaveBeenCalledOnce();
});

it("disposes partial resources and reports the original initialization error", () => {
  const failure = new Error("editor create failed");
  const onError = vi.fn();
  monacoSpies.create.mockImplementationOnce(() => { throw failure; });

  const view = render(
    <MonacoMarkdownEditor
      ariaLabel="Текст заметки"
      modelKey="note-1"
      onChange={vi.fn()}
      onError={onError}
      value="Сохранённый родителем текст"
    />,
  );

  expect(view.getByRole("alert")).toHaveTextContent("Не удалось открыть редактор.");
  expect(onError).toHaveBeenCalledWith(failure);
  expect(fakeMonaco.models[0].dispose).toHaveBeenCalledOnce();
});

it("replays cleanly in Strict Mode and releases every owned resource", () => {
  const view = render(
    <StrictMode>
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="strict-note"
        onChange={vi.fn()}
        value="Текст"
      />
    </StrictMode>,
  );

  expect(monacoSpies.createModel).toHaveBeenCalledTimes(2);
  expect(fakeMonaco.models[0].dispose).toHaveBeenCalledOnce();
  expect(fakeMonaco.editors[0].dispose).toHaveBeenCalledOnce();
  expect(fakeMonaco.subscriptions[0].dispose).toHaveBeenCalledOnce();

  view.unmount();
  expect(fakeMonaco.models[1].dispose).toHaveBeenCalledOnce();
  expect(fakeMonaco.editors[1].dispose).toHaveBeenCalledOnce();
  expect(fakeMonaco.subscriptions[1].dispose).toHaveBeenCalledOnce();
});

it("continues cleanup when one disposable throws", () => {
  const extensionDisposable = {
    dispose: vi.fn(() => { throw new Error("extension cleanup failed"); }),
  };
  const view = render(
    <MonacoMarkdownEditor
      ariaLabel="Текст заметки"
      modelKey="note-1"
      onChange={vi.fn()}
      onReady={() => extensionDisposable}
      value="Текст"
    />,
  );

  expect(() => view.unmount()).not.toThrow();
  expect(fakeMonaco.subscriptions[0].dispose).toHaveBeenCalledOnce();
  expect(fakeMonaco.editors[0].dispose).toHaveBeenCalledOnce();
  expect(fakeMonaco.models[0].dispose).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run the focused test and confirm the missing public props and recovery behavior**

Run:

```bash
npm test -- tests/monaco-markdown-editor.test.tsx
```

Expected: FAIL because `onReady` and `onError` are not accepted and initialization errors are not rendered as a compact alert.

- [ ] **Step 4: Replace the component with the complete hardened implementation**

Replace `src/components/MonacoMarkdownEditor.tsx` with:

```tsx
import { useEffect, useRef, useState, type ReactElement } from "react";
import type * as Monaco from "monaco-editor";
import {
  createCompactMarkdownEditorOptions,
  defineCompactMarkdownTheme,
} from "./monacoMarkdownEditorConfig";
import { monacoEditor, type MonacoEditorApi } from "./monacoEditorRuntime";

type Disposable = { dispose(): void };

export interface MonacoMarkdownEditorReadyContext {
  editor: Monaco.editor.IStandaloneCodeEditor;
  model: Monaco.editor.ITextModel;
  monaco: MonacoEditorApi;
}

export type MonacoMarkdownEditorExtension = (
  context: MonacoMarkdownEditorReadyContext,
) => Monaco.IDisposable | void;

export interface MonacoMarkdownEditorProps {
  modelKey: string;
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  onError?(error: unknown): void;
  onReady?: MonacoMarkdownEditorExtension;
  readOnly?: boolean;
}

function disposeAll(resources: Array<Disposable | null | undefined>): void {
  for (const resource of resources) {
    try {
      resource?.dispose();
    } catch {
      // Continue disposing the remaining resources owned by this component.
    }
  }
}

export function MonacoMarkdownEditor({
  ariaLabel,
  autoFocus = false,
  className,
  modelKey,
  onChange,
  onError,
  onReady,
  readOnly = false,
  value,
}: MonacoMarkdownEditorProps): ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const applyingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const autoFocusRef = useRef(autoFocus);
  const valueRef = useRef(value);
  const [initializationError, setInitializationError] = useState<unknown>(null);

  onChangeRef.current = onChange;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  autoFocusRef.current = autoFocus;
  valueRef.current = value;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let model: Monaco.editor.ITextModel | null = null;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let changeSubscription: Monaco.IDisposable | null = null;
    let extensionDisposable: Monaco.IDisposable | void;
    setInitializationError(null);

    try {
      const uri = monacoEditor.Uri.parse(
        `inmemory://mygameslist/markdown/${encodeURIComponent(modelKey)}.md`,
      );
      if (monacoEditor.editor.getModel(uri)) {
        throw new Error(`Monaco modelKey "${modelKey}" is already mounted.`);
      }

      defineCompactMarkdownTheme(monacoEditor);
      model = monacoEditor.editor.createModel(valueRef.current, "markdown", uri);
      editor = monacoEditor.editor.create(
        surface,
        createCompactMarkdownEditorOptions({ ariaLabel, model, readOnly }),
      );
      changeSubscription = model.onDidChangeContent(() => {
        if (!applyingExternalValueRef.current && model) {
          onChangeRef.current(model.getValue());
        }
      });
      modelRef.current = model;
      editorRef.current = editor;
      extensionDisposable = onReadyRef.current?.({
        editor,
        model,
        monaco: monacoEditor,
      });
      if (autoFocusRef.current) editor.focus();
    } catch (error) {
      disposeAll([extensionDisposable, changeSubscription, editor, model]);
      extensionDisposable = undefined;
      changeSubscription = null;
      editor = null;
      model = null;
      editorRef.current = null;
      modelRef.current = null;
      setInitializationError(error);
      onErrorRef.current?.(error);
    }

    return () => {
      disposeAll([extensionDisposable, changeSubscription, editor, model]);
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [modelKey]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model || model.getValue() === value) return;

    const position = editor.getPosition();
    applyingExternalValueRef.current = true;
    try {
      model.setValue(value);
    } finally {
      applyingExternalValueRef.current = false;
    }
    if (position) editor.setPosition(model.validatePosition(position));
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ ariaLabel, readOnly });
  }, [ariaLabel, readOnly]);

  const rootClassName = ["monaco-markdown-editor", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <div
        aria-hidden={initializationError ? true : undefined}
        className="monaco-markdown-editor__surface"
        ref={surfaceRef}
      />
      {initializationError ? (
        <div className="monaco-markdown-editor__error" role="alert">
          Не удалось открыть редактор.
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Add the public export and parent-sized component styles**

Add to `src/components/index.ts`:

```ts
export * from "./MonacoMarkdownEditor";
```

Add near the current note editor styles in `src/styles.css`:

```css
.monaco-markdown-editor {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--text);
  background: var(--field);
}
.monaco-markdown-editor__surface { width: 100%; height: 100%; min-height: 0; }
.monaco-markdown-editor__error {
  position: absolute;
  inset: 0;
  display: grid;
  padding: 12px;
  place-items: center;
  color: var(--danger);
  background: var(--field);
  font-size: 11px;
  text-align: center;
}
```

Do not add selectors for `.monaco-editor`, `.margin`, `.view-lines`, or another private Monaco DOM class.

- [ ] **Step 6: Run focused tests, all tests, and the production build**

Run:

```bash
npm test -- tests/monaco-markdown-editor-config.test.ts tests/monaco-markdown-editor.test.tsx
npm test
npm run build
```

Expected: all focused and project tests PASS; the production build exits 0 and emits the Monaco editor worker without worker-fallback warnings in the build output.

- [ ] **Step 7: Inspect and fold Task 3 into the foundation feature change**

Run:

```bash
jj status
jj diff
jj squash --from @ --into mvtnvsvoomsr
```

Expected: only the hardened component, public export, styles, and tests are folded into `mvtnvsvoomsr`; the working copy becomes an empty child.

### Task 4: Real Browser Smoke Check and Final Feature Verification

**Files:**
- Temporarily create, then delete: `monaco-smoke.html`
- Temporarily create, then delete: `src/monacoSmoke.tsx`
- Verify: all permanent files from Tasks 1–3
- Update description: Jujutsu change `mvtnvsvoomsr`

**Interfaces:**
- Consumes: the completed `MonacoMarkdownEditor` public component and actual Monaco/Vite worker runtime.
- Produces: browser evidence for syntax highlighting, native editing commands, compact chrome, scrolling, wrapping, and accessibility; a clean final feature change with no smoke-only files.

- [ ] **Step 1: Create a disposable browser harness**

Create `monaco-smoke.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Monaco Markdown smoke check</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/monacoSmoke.tsx"></script>
  </body>
</html>
```

Create `src/monacoSmoke.tsx`:

```tsx
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MonacoMarkdownEditor } from "./components/MonacoMarkdownEditor";
import "./styles.css";

const INITIAL_MARKDOWN = `# Monaco Markdown

- Parent item with enough words to demonstrate wrapping inside a deliberately narrow editor surface
  - Nested item
    - Deep nested item

**Bold**, _italic_, \`inline code\`, and [a link](https://example.com).

| Game | Status |
| --- | --- |
| Zelda | Playing |

> Quote

\`\`\`ts
const answer = 42;
\`\`\`
`;

function SmokeEditor() {
  const [value, setValue] = useState(INITIAL_MARKDOWN);
  return (
    <main style={{ padding: 24 }}>
      <div style={{ border: "1px solid #35373c", height: 300, width: 420 }}>
        <MonacoMarkdownEditor
          ariaLabel="Проверка редактора Markdown"
          autoFocus
          modelKey="foundation-smoke"
          onChange={setValue}
          value={value}
        />
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Smoke root is missing");
createRoot(root).render(<StrictMode><SmokeEditor /></StrictMode>);
```

- [ ] **Step 2: Start Vite and open the smoke page in the in-app browser**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/monaco-smoke.html` in the in-app browser.

Expected: a focused 420×300 Markdown editor appears with no alert and no worker fallback error in the browser console.

- [ ] **Step 3: Verify the approved visual contract in the real editor**

Inspect the editor and confirm all of the following:

- Markdown headings, emphasis, links, lists, quotes, code, and table delimiters have distinct syntax colors.
- Line numbers, glyph margin, fold controls, minimap, overview ruler, sticky scroll, rulers, and current-line highlight are absent.
- Indentation guides are visible for the nested list.
- The long list item wraps inside the 420 px surface and no horizontal scrollbar appears.
- The vertical scrollbar is Monaco's native indicator, 3 px wide, without arrows or scroll shadows.
- Text begins with a compact 6 px top/bottom inset and 6 px left inset.
- No toolbar or preview is present; temporary native Monaco widgets remain allowed.

Expected: every item matches the design specification. If an item fails, add a focused regression assertion where possible, fix the foundation implementation, rerun Tasks 1–3 verification, and keep the fix in `mvtnvsvoomsr`.

- [ ] **Step 4: Verify native Monaco interaction on macOS**

In the smoke editor:

1. Type two lines and use `Cmd+Z`, then `Shift+Cmd+Z`; undo and redo must restore the exact text.
2. Use `Option+Click` to create a second cursor and type; both cursors must edit.
3. Use `Cmd+F`, search for `Nested`, then use `Option+Cmd+F`; Monaco's temporary find/replace widget must work.
4. Use `Ctrl+Space`; manual completion may show words from the current document, while ordinary prose typing must not auto-open generic suggestions.
5. Right-click; Monaco's native context menu must open.
6. Scroll with the trackpad or mouse wheel and with the keyboard; content and the thin vertical indicator must move normally.
7. Confirm the editor is announced as `Проверка редактора Markdown`, open Monaco's built-in command palette with `F1`, and clear the `>` command prefix to inspect the default standalone command/keyboard help provider. Record that Monaco 0.56 standalone does not register VS Code's `editor.action.accessibilityHelp`, so `Option+F1` is not expected to open an accessibility-help panel.

Expected: all native commands work without application-specific handlers or permanent UI.

- [ ] **Step 5: Delete the disposable harness with a patch**

Use `apply_patch` to delete exactly:

```text
monaco-smoke.html
src/monacoSmoke.tsx
```

Run:

```bash
jj status
```

Expected: neither smoke file appears in the working-copy changes.

- [ ] **Step 6: Run final automated verification from a clean smoke state**

Run:

```bash
npm test
npm run build
```

Expected: the complete test suite passes and the production build exits 0 after the temporary harness has been removed.

- [ ] **Step 7: Inspect the complete feature diff and apply the detailed feature description**

Run:

```bash
jj status
jj diff -r mvtnvsvoomsr
jj describe -r mvtnvsvoomsr -m 'Add compact Monaco Markdown editor foundation

Introduce the reusable editor core for the stacked note-editor migration:
- add Monaco 0.56 through its modular package exports and official Vite editor worker
- own a unique Markdown model and editor lifecycle per mounted React component
- synchronize controlled values without feedback while preserving ordinary Monaco undo history
- expose a disposable editor-ready extension boundary for later note features
- match the application dark theme with Markdown token colors and compact 12 px typography
- hide line numbers, gutters, folding, minimap, overview chrome, sticky scroll, and horizontal scrolling
- retain indentation guides, word wrapping, standard Monaco commands, accessibility UI, and a 3 px native vertical scroll indicator
- report initialization failures without replacing or losing the parent-owned value

Keep the existing note textarea unchanged until later feature-parity changes. Cover compact options, controlled updates, document replacement, duplicate keys, partial failures, extension cleanup, and React Strict Mode; verify the real ESM worker, Markdown highlighting, native commands, wrapping, guides, and scrolling in a disposable browser harness.'
jj new mvtnvsvoomsr
```

Expected: `mvtnvsvoomsr` contains the specification, implementation plan, dependency, implementation, tests, and fixes for this foundation only; the new working copy is an empty child ready for the next stacked feature.
