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

  it("detaches the model listener before extension cleanup on unmount", () => {
    const firstOnChange = vi.fn();
    const latestOnChange = vi.fn();
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={firstOnChange}
        onReady={({ model }) => ({
          dispose: () => model.setValue("Текст из очистки расширения"),
        })}
        value="Текст"
      />,
    );

    view.rerender(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={latestOnChange}
        value="Текст"
      />,
    );
    view.unmount();

    expect(firstOnChange).not.toHaveBeenCalled();
    expect(latestOnChange).not.toHaveBeenCalled();
    expect(fakeMonaco.models[0].getValue()).toBe("Текст из очистки расширения");
  });

  it("detaches the old model listener before extension cleanup on modelKey change", () => {
    const oldOnChange = vi.fn();
    const newOnChange = vi.fn();
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Первая заметка"
        modelKey="note-1"
        onChange={oldOnChange}
        onReady={({ model }) => ({
          dispose: () => model.setValue("Старый текст из очистки расширения"),
        })}
        value="Первый текст"
      />,
    );

    view.rerender(
      <MonacoMarkdownEditor
        ariaLabel="Вторая заметка"
        modelKey="note-2"
        onChange={newOnChange}
        value="Второй текст"
      />,
    );

    expect(fakeMonaco.models[0].getValue()).toBe(
      "Старый текст из очистки расширения",
    );
    expect(fakeMonaco.models[1].getValue()).toBe("Второй текст");
    expect(oldOnChange).not.toHaveBeenCalled();
    expect(newOnChange).not.toHaveBeenCalled();
  });

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

  it("does not forward a provisional extension edit when initialization fails", () => {
    const failure = new Error("extension initialization failed");
    const onChange = vi.fn();
    const onError = vi.fn();
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={onChange}
        onError={onError}
        onReady={({ model }) => {
          model.setValue("Предварительное изменение");
          throw failure;
        }}
        value="Сохранённый родителем текст"
      />,
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(view.getByRole("alert")).toHaveTextContent("Не удалось открыть редактор.");
    expect(fakeMonaco.editors[0].dispose).toHaveBeenCalledOnce();
    expect(fakeMonaco.models[0].dispose).toHaveBeenCalledOnce();
  });

  it("renders the failure state when initialization throws a falsy value", () => {
    const onError = vi.fn();
    const view = render(
      <MonacoMarkdownEditor
        ariaLabel="Текст заметки"
        modelKey="note-1"
        onChange={vi.fn()}
        onError={onError}
        onReady={() => { throw null; }}
        value="Текст"
      />,
    );

    expect(onError).toHaveBeenCalledWith(null);
    expect(view.getByRole("alert")).toHaveTextContent("Не удалось открыть редактор.");
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
});
