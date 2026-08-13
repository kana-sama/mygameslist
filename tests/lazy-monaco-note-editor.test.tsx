import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonacoNoteEditorProps } from "../src/components/MonacoNoteEditor";
import { LazyMonacoNoteEditor } from "../src/components/LazyMonacoNoteEditor";

const editorModule = vi.hoisted(() => {
  let resolve: ((module: { MonacoNoteEditor: (props: MonacoNoteEditorProps) => React.ReactElement }) => void) | undefined;
  return {
    props: undefined as MonacoNoteEditorProps | undefined,
    reset() {
      this.props = undefined;
      this.promise = new Promise((nextResolve) => { resolve = nextResolve; });
    },
    resolve() {
      resolve?.({
        MonacoNoteEditor: (props) => {
          editorModule.props = props;
          return <div data-testid="fake-monaco-editor" />;
        },
      });
    },
    promise: undefined as Promise<{ MonacoNoteEditor: (props: MonacoNoteEditorProps) => React.ReactElement }> | undefined,
  };
});

editorModule.reset();

vi.mock("../src/components/MonacoNoteEditor", () => editorModule.promise);

describe("LazyMonacoNoteEditor", () => {
  beforeEach(() => {
    editorModule.reset();
  });

  it("shows a busy editor surface until the editor module loads, then preserves props", async () => {
    const input: MonacoNoteEditorProps = {
      autoFocus: true,
      excludeGameId: "current-game",
      filesDisabled: false,
      gameSuggestions: [],
      modelKey: "note:client-id",
      onCancel: vi.fn(),
      onChange: vi.fn(),
      onFileFiles: vi.fn(),
      onImageFiles: vi.fn(),
      onRequiredTableWidthChange: vi.fn(),
      onSubmit: vi.fn(),
      submitDisabled: false,
      value: "# Draft",
    };

    render(<LazyMonacoNoteEditor {...input} />);

    const loading = screen.getByRole("status");
    expect(loading).toHaveClass("monaco-note-editor");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveTextContent("Загружаем редактор…");

    editorModule.resolve();

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByTestId("fake-monaco-editor")).toBeInTheDocument();
    expect(editorModule.props).toMatchObject({
      autoFocus: input.autoFocus,
      modelKey: input.modelKey,
      value: input.value,
      onChange: input.onChange,
      onSubmit: input.onSubmit,
    });
  });
});
