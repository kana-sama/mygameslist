import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonacoMarkdownEditorProps, MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import { MonacoNoteEditor } from "../src/components/MonacoNoteEditor";

const boundary = vi.hoisted(() => ({
  actionOptions: undefined as unknown,
  completionOptions: undefined as unknown,
  disposals: [] as string[],
  table: vi.fn(),
  width: vi.fn(),
  widthOptions: undefined as unknown,
  list: vi.fn(),
  actions: vi.fn(),
  completion: vi.fn(),
  props: undefined as MonacoMarkdownEditorProps | undefined,
}));

vi.mock("../src/components/MonacoMarkdownEditor", () => ({
  MonacoMarkdownEditor: (props: MonacoMarkdownEditorProps) => {
    boundary.props = props;
    return null;
  },
}));

vi.mock("../src/components/monacoMarkdownListEditing", () => ({
  installMonacoMarkdownListEditing: (...args: unknown[]) => boundary.list(...args),
}));

vi.mock("../src/components/monacoMarkdownTableFormatting", () => ({
  installMonacoMarkdownTableTyping: (...args: unknown[]) => boundary.table(...args),
}));

vi.mock("../src/components/monacoMarkdownTableWidth", () => ({
  installMonacoMarkdownTableWidth: (...args: unknown[]) => boundary.width(...args),
}));

vi.mock("../src/components/monacoGameLinkCompletion", () => ({
  installMonacoGameLinkCompletion: (...args: unknown[]) => boundary.completion(...args),
}));

vi.mock("../src/components/monacoNoteActions", () => ({
  installMonacoNoteActions: (...args: unknown[]) => boundary.actions(...args),
}));

function disposable(name: string, throws = false) {
  return {
    dispose: vi.fn(() => {
      boundary.disposals.push(name);
      if (throws) throw new Error(`${name} dispose`);
    }),
  };
}

function props(overrides: Partial<React.ComponentProps<typeof MonacoNoteEditor>> = {}) {
  return {
    autoFocus: true,
    excludeGameId: "current-game",
    filesDisabled: false,
    gameSuggestions: [{ id: "other-game", title: "Other", platforms: [], tags: [], status: "playing", placement: null, coverAssetId: null, reviewMarkdown: "", createdAt: "", updatedAt: "" }],
    modelKey: "note:client-id",
    onCancel: vi.fn(),
    onChange: vi.fn(),
    onFileFiles: vi.fn(),
    onImageFiles: vi.fn(),
    onSubmit: vi.fn(),
    submitDisabled: false,
    value: "# Draft",
    ...overrides,
  };
}

const context = {} as MonacoMarkdownEditorReadyContext;

describe("MonacoNoteEditor", () => {
  beforeEach(() => {
    boundary.actionOptions = undefined;
    boundary.completionOptions = undefined;
    boundary.disposals = [];
    boundary.props = undefined;
    boundary.table.mockReset().mockImplementation(() => disposable("table"));
    boundary.widthOptions = undefined;
    boundary.width.mockReset().mockImplementation((_context: unknown, options: unknown) => {
      boundary.widthOptions = options;
      return disposable("width");
    });
    boundary.list.mockReset().mockImplementation(() => disposable("list"));
    boundary.completion.mockReset().mockImplementation((_context: unknown, options: unknown) => {
      boundary.completionOptions = options;
      return disposable("completion");
    });
    boundary.actions.mockReset().mockImplementation((_context: unknown, options: unknown) => {
      boundary.actionOptions = options;
      return disposable("actions");
    });
  });

  it("renders the note transfer boundary, forwards base props, and routes captured image files", () => {
    const input = props();
    const view = render(<MonacoNoteEditor {...input} />);
    const root = view.container.firstElementChild as HTMLDivElement;
    const image = new File(["image"], "cover.png", { type: "image/png" });
    const attachment = new File(["attachment"], "walkthrough.pdf", { type: "application/pdf" });

    expect(root).toHaveClass("monaco-note-editor", "note-file-transfer-boundary");
    expect(root).toHaveAttribute("data-model-key", "note:client-id");
    expect(boundary.props).toMatchObject({
      ariaLabel: "Текст заметки",
      autoFocus: true,
      modelKey: "note:client-id",
      value: "# Draft",
    });

    fireEvent.paste(root, {
      clipboardData: { files: [image, attachment], items: [], types: ["Files"] },
    });
    expect(input.onImageFiles).toHaveBeenCalledWith([image]);
    expect(input.onFileFiles).toHaveBeenCalledWith([attachment]);
  });

  it("installs table typing, width measurement, list, completion, and note actions in order with live values", () => {
    const first = props();
    const view = render(<MonacoNoteEditor {...first} />);
    const extension = boundary.props?.onReady?.(context);

    expect(boundary.table.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.width.mock.invocationCallOrder[0]);
    expect(boundary.width.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.list.mock.invocationCallOrder[0]);
    expect(boundary.list.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.completion.mock.invocationCallOrder[0]);
    expect(boundary.completion.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.actions.mock.invocationCallOrder[0]);
    expect(boundary.completionOptions).toMatchObject({ excludeGameId: "current-game" });

    const secondSubmit = vi.fn();
    const nextGames = [{ id: "new-game", title: "New", platforms: [], tags: [], status: "playing", placement: null, coverAssetId: null, reviewMarkdown: "", createdAt: "", updatedAt: "" }];
    view.rerender(<MonacoNoteEditor {...props({ gameSuggestions: nextGames, onSubmit: secondSubmit, submitDisabled: true })} />);

    const completion = boundary.completionOptions as { getGames(): readonly unknown[] };
    const actions = boundary.actionOptions as { isSubmitDisabled(): boolean; submit?(): void | Promise<void> };
    expect(completion.getGames()).toBe(nextGames);
    expect(actions.isSubmitDisabled()).toBe(true);
    actions.submit?.();
    expect(secondSubmit).toHaveBeenCalledOnce();

    extension?.dispose();
    expect(boundary.disposals).toEqual(["actions", "completion", "list", "width", "table"]);
  });

  it("installs width measurement after table typing and routes live reports", () => {
    const firstWidth = vi.fn();
    const view = render(<MonacoNoteEditor {...props({ onRequiredTableWidthChange: firstWidth })} />);
    const extension = boundary.props?.onReady?.(context);

    expect(boundary.table.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.width.mock.invocationCallOrder[0]);
    const options = boundary.widthOptions as { onRequiredWidthChange(width: number): void };
    options.onRequiredWidthChange(720);
    expect(firstWidth).toHaveBeenCalledWith(720);

    const nextWidth = vi.fn();
    view.rerender(<MonacoNoteEditor {...props({ onRequiredTableWidthChange: nextWidth })} />);
    options.onRequiredWidthChange(880);
    expect(nextWidth).toHaveBeenCalledWith(880);

    extension?.dispose();
    expect(boundary.disposals).toEqual(["actions", "completion", "list", "width", "table"]);
  });

  it("cleans up partial extension installation and skips note actions for new-game props", () => {
    boundary.list.mockImplementationOnce(() => { throw new Error("list failed"); });
    render(<MonacoNoteEditor {...props()} />);
    expect(() => boundary.props?.onReady?.(context)).toThrow("list failed");
    expect(boundary.disposals).toEqual(["width", "table"]);

    const noActions = props({ onCancel: undefined, onSubmit: undefined });
    render(<MonacoNoteEditor {...noActions} />);
    boundary.props?.onReady?.(context);
    expect(boundary.actions).not.toHaveBeenCalled();
  });

  it("passes only the note callbacks present when actions are installed", () => {
    render(<MonacoNoteEditor {...props({ onCancel: undefined })} />);
    boundary.props?.onReady?.(context);
    expect(boundary.actionOptions).toMatchObject({ submit: expect.any(Function) });
    expect((boundary.actionOptions as { cancel?: unknown }).cancel).toBeUndefined();

    boundary.actions.mockClear();
    boundary.actionOptions = undefined;
    render(<MonacoNoteEditor {...props({ onSubmit: undefined })} />);
    boundary.props?.onReady?.(context);
    expect(boundary.actionOptions).toMatchObject({ cancel: expect.any(Function) });
    expect((boundary.actionOptions as { submit?: unknown }).submit).toBeUndefined();
  });

  it("continues reverse cleanup when an extension disposer throws", () => {
    boundary.actions.mockImplementationOnce(() => disposable("actions", true));
    render(<MonacoNoteEditor {...props()} />);
    const extension = boundary.props?.onReady?.(context);

    extension?.dispose();
    expect(boundary.disposals).toEqual(["actions", "completion", "list", "width", "table"]);
  });
});
