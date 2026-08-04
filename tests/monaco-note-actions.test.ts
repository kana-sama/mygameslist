import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import { installMonacoNoteActions } from "../src/components/monacoNoteActions";

function createHarness() {
  const descriptors: Monaco.editor.IActionDescriptor[] = [];
  const disposals: Array<ReturnType<typeof vi.fn>> = [];
  const hideHover = { run: vi.fn() };
  let inComposition = false;
  const addAction = vi.fn((descriptor: Monaco.editor.IActionDescriptor) => {
      descriptors.push(descriptor);
      const dispose = vi.fn();
      disposals.push(dispose);
      return { dispose };
    });
  const editor = {
    addAction,
    getAction: vi.fn((id: string) => id === "editor.action.hideHover" ? hideHover : null),
    get inComposition() { return inComposition; },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const monaco = {
    KeyCode: { Enter: 3, Escape: 9 },
    KeyMod: { CtrlCmd: 2048 },
  } as unknown as MonacoMarkdownEditorReadyContext["monaco"];

  return {
    context: { editor, monaco } as MonacoMarkdownEditorReadyContext,
    addAction,
    descriptors,
    disposals,
    editor,
    hideHover,
    setComposing(value: boolean) { inComposition = value; },
  };
}

function action(harness: ReturnType<typeof createHarness>, id: string) {
  const descriptor = harness.descriptors.find((candidate) => candidate.id === id);
  if (!descriptor) throw new Error(`Missing action ${id}`);
  return descriptor;
}

describe("installMonacoNoteActions", () => {
  it("registers native save, cancel, and hover actions after transient Monaco UI", () => {
    const harness = createHarness();

    installMonacoNoteActions(harness.context, {
      cancel: vi.fn(),
      isSubmitDisabled: () => false,
      submit: vi.fn(),
    });

    expect(action(harness, "mygameslist.note.submit")).toMatchObject({
      keybindings: [2051],
      keybindingContext: "!suggestWidgetVisible && !findWidgetVisible && !editorHoverVisible && !inSnippetMode && !renameInputVisible && !parameterHintsVisible && !inlineSuggestionVisible && !isComposing",
      precondition: "editorTextFocus && !editorReadonly",
    });
    expect(action(harness, "mygameslist.note.cancel")).toMatchObject({
      keybindings: [9],
      keybindingContext: "!suggestWidgetVisible && !findWidgetVisible && !editorHoverVisible && !inSnippetMode && !renameInputVisible && !parameterHintsVisible && !inlineSuggestionVisible && !isComposing && !editorHasMultipleSelections",
      precondition: "editorTextFocus",
    });
    expect(action(harness, "mygameslist.note.dismissHover")).toMatchObject({
      keybindings: [9],
      keybindingContext: "editorHoverVisible && !isComposing",
      precondition: "editorFocus",
    });
  });

  it("reads live callbacks and submit state while refusing actions during composition", async () => {
    const harness = createHarness();
    let disabled = true;
    const firstSubmit = vi.fn();
    const latestSubmit = vi.fn();
    const firstCancel = vi.fn();
    const latestCancel = vi.fn();
    let submit = firstSubmit;
    let cancel = firstCancel;
    installMonacoNoteActions(harness.context, {
      cancel: () => cancel(),
      isSubmitDisabled: () => disabled,
      submit: () => submit(),
    });

    await action(harness, "mygameslist.note.submit").run!(harness.editor);
    expect(firstSubmit).not.toHaveBeenCalled();

    disabled = false;
    submit = latestSubmit;
    cancel = latestCancel;
    await action(harness, "mygameslist.note.submit").run!(harness.editor);
    await action(harness, "mygameslist.note.cancel").run!(harness.editor);
    expect(latestSubmit).toHaveBeenCalledOnce();
    expect(latestCancel).toHaveBeenCalledOnce();

    harness.setComposing(true);
    await action(harness, "mygameslist.note.submit").run!(harness.editor);
    await action(harness, "mygameslist.note.cancel").run!(harness.editor);
    await action(harness, "mygameslist.note.dismissHover").run!(harness.editor);
    expect(latestSubmit).toHaveBeenCalledOnce();
    expect(latestCancel).toHaveBeenCalledOnce();
    expect(harness.hideHover.run).not.toHaveBeenCalled();
  });

  it("uses Monaco's public hover action and disposes every installed action", async () => {
    const harness = createHarness();
    const resources = installMonacoNoteActions(harness.context, {
      cancel: vi.fn(),
      isSubmitDisabled: () => false,
      submit: vi.fn(),
    });

    await action(harness, "mygameslist.note.dismissHover").run!(harness.editor);
    expect(harness.editor.getAction).toHaveBeenCalledWith("editor.action.hideHover");
    expect(harness.hideHover.run).toHaveBeenCalledOnce();

    resources.dispose();
    expect(harness.disposals).toHaveLength(3);
    for (const dispose of harness.disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it("installs only the actions backed by callbacks present at setup", () => {
    const submitOnly = createHarness();
    installMonacoNoteActions(submitOnly.context, {
      isSubmitDisabled: () => false,
      submit: vi.fn(),
    });
    expect(submitOnly.descriptors.map(({ id }) => id)).toEqual(["mygameslist.note.submit"]);

    const cancelOnly = createHarness();
    installMonacoNoteActions(cancelOnly.context, {
      cancel: vi.fn(),
      isSubmitDisabled: () => false,
    });
    expect(cancelOnly.descriptors.map(({ id }) => id)).toEqual([
      "mygameslist.note.cancel",
      "mygameslist.note.dismissHover",
    ]);
  });

  it("disposes already-registered actions when a later registration throws", () => {
    const harness = createHarness();
    const firstDispose = vi.fn();
    harness.addAction
      .mockImplementationOnce(() => ({ dispose: firstDispose }))
      .mockImplementationOnce(() => { throw new Error("cancel registration failed"); });

    expect(() => installMonacoNoteActions(harness.context, {
      cancel: vi.fn(),
      isSubmitDisabled: () => false,
      submit: vi.fn(),
    })).toThrow("cancel registration failed");
    expect(firstDispose).toHaveBeenCalledOnce();
  });
});
