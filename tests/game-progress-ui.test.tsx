import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardCode, KeyboardSensor, PointerSensor, TouchSensor, type Active, type Over } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { readFileSync } from "node:fs";
import { startTransition, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipboardImageFile, readClipboardImage } from "../src/components/clipboardImage";
import {
  GameProgressGrid,
  NonTouchProgressPointerSensor,
  PROGRESS_GRID_SENSOR_OPTIONS,
  PROGRESS_GRID_SENSOR_TYPES,
  createProgressGridAnnouncements,
} from "../src/components/GameProgressGrid";
import { GameProgressItemDialog } from "../src/components/GameProgressItemDialog";
import { resolveNoteChecklistProgress } from "../src/domain/markdownChecklist";
import { optimizeProgressIcon } from "../src/domain/progressIcon";
import type { Asset, GameProgressItem, Note } from "../src/domain/types";
import type { EditableGameProgressItem } from "../src/pages/GamePage";

vi.mock("../src/components/clipboardImage", async () => {
  const actual = await vi.importActual<typeof import("../src/components/clipboardImage")>("../src/components/clipboardImage");
  return { ...actual, readClipboardImage: vi.fn(actual.readClipboardImage) };
});

vi.mock("../src/domain/progressIcon", async () => {
  const actual = await vi.importActual<typeof import("../src/domain/progressIcon")>("../src/domain/progressIcon");
  return { ...actual, optimizeProgressIcon: vi.fn(actual.optimizeProgressIcon) };
});

vi.mock("../src/domain/markdownChecklist", async () => {
  const actual = await vi.importActual<typeof import("../src/domain/markdownChecklist")>("../src/domain/markdownChecklist");
  return { ...actual, resolveNoteChecklistProgress: vi.fn(actual.resolveNoteChecklistProgress) };
});

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_A = "22222222-2222-4222-8222-222222222222";
const ITEM_B = "33333333-3333-4333-8333-333333333333";
const ITEM_C = "44444444-4444-4444-8444-444444444444";
const ICON_ID = "a".repeat(64);
const PENDING_ICON_ID = "b".repeat(64);
const NOTE_VALID = "55555555-5555-4555-8555-555555555555";
const NOTE_COMPLETE = "66666666-6666-4666-8666-666666666666";
const NOTE_INVALID = "77777777-7777-4777-8777-777777777777";
const NOTE_OTHER_GAME = "88888888-8888-4888-8888-888888888888";
const NOW = "2026-08-07T10:00:00.000Z";

function iconAsset(id = ICON_ID): Asset {
  return {
    id,
    kind: "image",
    mime: "image/webp",
    width: 64,
    height: 64,
    byteLength: 128,
    alt: "Иконка прогресса",
    originalName: "progress.webp",
  };
}

function note(id: string, bodyMarkdown: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    gameId: GAME_ID,
    bodyMarkdown,
    attachments: [],
    rank: 1024,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const notes: Note[] = [
  note(NOTE_VALID, "# До финала\n- [x] Глава 1\n- [x] Глава 2\n- [ ] Глава 3\n- [ ] Глава 4\n- [ ] Глава 5"),
  note(NOTE_COMPLETE, "# Всё сделано\n- [x] A\n- [x] B\n- [x] C", { rank: 2048 }),
  note(NOTE_INVALID, "# Без задач\nОбычный текст", { rank: 3072 }),
  note(NOTE_OTHER_GAME, "# Другая игра\n- [x] A", { gameId: ITEM_A, rank: 4096 }),
];

function existingItem(overrides: Partial<EditableGameProgressItem> = {}): EditableGameProgressItem {
  return {
    id: ITEM_A,
    iconAssetId: ICON_ID,
    noteId: NOTE_VALID,
    pendingIcon: null,
    ...overrides,
  };
}

function imageTransfer(file: File): DataTransfer {
  return {
    files: [file],
    items: [{ kind: "file", type: file.type, getAsFile: () => file }],
    types: ["Files"],
    getData: () => "",
    setData: () => undefined,
  } as unknown as DataTransfer;
}

function textTransfer(value: string): DataTransfer {
  return {
    files: [],
    items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
    types: ["text/plain"],
    getData: (type: string) => type === "text" || type === "text/plain" ? value : "",
    setData: () => undefined,
  } as unknown as DataTransfer;
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  } as DOMRect;
}

function dragActive(itemId: string): Active {
  return {
    id: `progress:${itemId}`,
    data: { current: { type: "progress-item", itemId } },
    rect: { current: { initial: null, translated: null } },
  };
}

function dragOver(itemId: string): Over {
  return {
    id: `progress:${itemId}`,
    data: { current: { type: "progress-item", itemId } },
    disabled: false,
    rect: domRect(0, 0, 88, 88),
  };
}

beforeEach(() => {
  vi.mocked(resolveNoteChecklistProgress).mockClear();
  vi.mocked(optimizeProgressIcon).mockResolvedValue({
    asset: iconAsset(PENDING_ICON_ID),
    blob: new Blob(["webp"], { type: "image/webp" }),
    byteLength: 4,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GameProgressGrid", () => {
  it("renders exactly icon and progress value for saved cells and routes every click by id", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    const items: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
      { id: ITEM_C, iconAssetId: ICON_ID, noteId: NOTE_INVALID },
    ];

    render(<GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={items} notes={notes} onAdd={onAdd} onEdit={onEdit} onReorder={vi.fn()} resolveAssetUrl={() => "/icon.webp"} />);

    expect(screen.getByRole("heading", { name: "Прогресс" })).toBeVisible();
    const valid = screen.getByRole("button", { name: "Редактировать элемент прогресса: 2 из 5" });
    const complete = screen.getByRole("button", { name: "Редактировать элемент прогресса: 3 из 3, завершено" });
    const broken = screen.getByRole("button", { name: "Редактировать элемент прогресса: ошибка прогресса" });
    expect(within(valid).getByText("2")).toHaveClass("game-progress__checked");
    expect(within(valid).getByText("/")).toHaveClass("game-progress__slash");
    expect(within(valid).getByText("5")).toHaveClass("game-progress__total");
    expect(valid).toHaveTextContent("2/5");
    expect(valid.children).toHaveLength(2);
    expect(broken.querySelector(".game-progress__checked")).toBeNull();
    expect(broken.querySelector(".game-progress__value")).toHaveTextContent("ошибка");
    expect(complete).toHaveTextContent("3/3");
    expect(broken).toHaveTextContent("ошибка");
    expect(valid).not.toHaveTextContent("До финала");
    expect(complete).not.toHaveTextContent("Всё сделано");
    expect(valid.querySelectorAll("img")).toHaveLength(1);
    for (const image of document.querySelectorAll(".game-progress__item img")) {
      expect(image).toHaveAttribute("width", "64");
      expect(image).toHaveAttribute("height", "64");
    }
    expect(complete).toHaveClass("is-complete");
    expect(valid).not.toHaveClass("is-complete");
    expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeVisible();

    await user.click(valid);
    expect(onEdit).toHaveBeenLastCalledWith(ITEM_A, valid);
    await user.click(broken);
    expect(onEdit).toHaveBeenLastCalledWith(ITEM_C, broken);
    await user.click(screen.getByRole("button", { name: "Добавить элемент прогресса" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("uses non-touch pointer, delayed touch, and sortable keyboard sensors", () => {
    expect(PROGRESS_GRID_SENSOR_TYPES).toEqual({
      pointer: NonTouchProgressPointerSensor,
      touch: TouchSensor,
      keyboard: KeyboardSensor,
    });
    expect(NonTouchProgressPointerSensor.prototype).toBeInstanceOf(PointerSensor);
    expect(PROGRESS_GRID_SENSOR_OPTIONS.pointer).toEqual({ activationConstraint: { distance: 8 } });
    expect(PROGRESS_GRID_SENSOR_OPTIONS.touch).toEqual({ activationConstraint: { delay: 180, tolerance: 8 } });
    expect(PROGRESS_GRID_SENSOR_OPTIONS.keyboard.coordinateGetter).toBe(sortableKeyboardCoordinates);
    expect(PROGRESS_GRID_SENSOR_OPTIONS.keyboard.keyboardCodes).toEqual({
      start: [KeyboardCode.Space, KeyboardCode.Enter],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    });

    const onActivation = vi.fn();
    const handler = NonTouchProgressPointerSensor.activators[0].handler;
    expect(handler({ nativeEvent: { pointerType: "touch", isPrimary: true, button: 0 } } as never, { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
    expect(handler({ nativeEvent: { pointerType: "mouse", isPrimary: true, button: 0 } } as never, { onActivation })).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it("activates the runtime touch sensor only after its hold delay and reorders the whole cell", async () => {
    const onReorder = vi.fn();
    const items: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
    ];
    const rects = new Map([
      [ITEM_A, domRect(0, 0, 88, 88)],
      [ITEM_B, domRect(92, 0, 88, 88)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-progress__grid")) return domRect(0, 0, 180, 88);
      if (this.matches(".game-progress__drag-overlay")) return domRect(0, 0, 88, 88);
      if (this.dataset.progressItemId) return rects.get(this.dataset.progressItemId) ?? domRect(0, 0, 88, 88);
      return domRect(0, 0, 1024, 768);
    });

    render(<GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={items} notes={notes} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={onReorder} resolveAssetUrl={() => "/icon.webp"} />);
    const first = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${ITEM_A}"]`)!;
    const second = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${ITEM_B}"]`)!;

    act(() => {
      fireEvent.touchStart(first, { touches: [{ identifier: 1, clientX: 20, clientY: 40 }] });
    });
    expect(first).not.toHaveClass("is-dragging");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    });
    expect(first).not.toHaveClass("is-dragging");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    });
    await waitFor(() => expect(first).toHaveClass("is-dragging"));

    act(() => {
      fireEvent.touchMove(first, { touches: [{ identifier: 1, clientX: 130, clientY: 40 }] });
    });
    await waitFor(() => expect(second).toHaveClass("is-drop-target"));
    act(() => {
      fireEvent.touchEnd(first, { changedTouches: [{ identifier: 1, clientX: 130, clientY: 40 }], touches: [] });
    });

    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(ITEM_A, ITEM_B));
    expect(onReorder).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });
  });

  it("returns the exact Russian pickup, target, outside, completion, and cancellation announcements", () => {
    const items: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
      { id: ITEM_C, iconAssetId: ICON_ID, noteId: NOTE_INVALID },
    ];
    const announcements = createProgressGridAnnouncements(items);
    const active = dragActive(ITEM_A);
    const over = dragOver(ITEM_C);

    expect(announcements.onDragStart({ active })).toBe("Вы взяли элемент прогресса 1 из 3.");
    expect(announcements.onDragOver({ active, over })).toBe("Новое место: 3 из 3.");
    expect(announcements.onDragOver({ active, over: null })).toBe("Элемент вне списка прогресса.");
    expect(announcements.onDragEnd({ active, over })).toBe("Порядок элементов прогресса изменён.");
    expect(announcements.onDragEnd({ active, over: null })).toBe("Перемещение элемента прогресса отменено.");
    expect(announcements.onDragCancel({ active, over: null })).toBe("Перемещение элемента прогресса отменено.");
  });

  it("uses the whole saved cell for click and drag while keeping the add cell outside sorting", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onReorder = vi.fn();
    const items: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
      { id: ITEM_C, iconAssetId: ICON_ID, noteId: NOTE_INVALID },
    ];
    const rects = new Map([
      [ITEM_A, domRect(0, 0, 88, 88)],
      [ITEM_B, domRect(92, 0, 88, 88)],
      [ITEM_C, domRect(92, 93, 88, 88)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-progress__grid")) return domRect(0, 0, 272, 181);
      if (this.matches(".game-progress__drag-overlay")) return domRect(0, 0, 88, 88);
      if (this.dataset.progressItemId) return rects.get(this.dataset.progressItemId) ?? domRect(0, 0, 88, 88);
      return domRect(0, 0, 1024, 768);
    });

    render(<GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={items} notes={notes} onAdd={vi.fn()} onEdit={onEdit} onReorder={onReorder} resolveAssetUrl={() => "/icon.webp"} />);
    const first = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${ITEM_A}"]`)!;
    const third = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${ITEM_C}"]`)!;
    const add = screen.getByRole("button", { name: "Добавить элемент прогресса" });
    const grid = document.querySelector(".game-progress__grid")!;

    for (const saved of document.querySelectorAll(".game-progress__item")) {
      expect(saved).toHaveAttribute("aria-roledescription", "перетаскиваемый элемент прогресса");
      expect(saved).toHaveAttribute("data-progress-item-id");
    }
    expect(add).not.toHaveAttribute("aria-roledescription");
    expect(add).not.toHaveAttribute("data-progress-item-id");
    expect(grid.lastElementChild).toBe(add);
    expect(document.querySelector(".game-progress__drag-overlay")).not.toBeInTheDocument();

    await user.click(first);
    expect(onEdit).toHaveBeenCalledWith(ITEM_A, first);
    onEdit.mockClear();

    await user.pointer([
      { keys: "[MouseLeft>]", target: first, coords: { clientX: 20, clientY: 40 } },
      { target: first, coords: { clientX: 32, clientY: 40 } },
    ]);
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    const overlay = document.querySelector<HTMLElement>(".game-progress__drag-overlay")!;
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay.tagName).toBe("DIV");
    expect(within(overlay).getByText("2")).toHaveClass("game-progress__checked");

    await user.pointer([
      { target: third, coords: { clientX: 160, clientY: 130 } },
    ]);
    await waitFor(() => expect(third).toHaveClass("is-drop-target"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Новое место: 3 из 3."));
    await user.pointer([
      { keys: "[/MouseLeft]", target: third, coords: { clientX: 160, clientY: 130 } },
    ]);
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(ITEM_A, ITEM_C));
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    expect(document.querySelector(".game-progress__drag-overlay")).not.toBeInTheDocument();
    expect(grid.lastElementChild).toBe(add);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Порядок элементов прогресса изменён."));
  });

  it("does not reorder after cancellation or an outside drop", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    const items: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
      { id: ITEM_C, iconAssetId: ICON_ID, noteId: NOTE_INVALID },
    ];
    const rects = new Map([
      [ITEM_A, domRect(0, 0, 88, 88)],
      [ITEM_B, domRect(92, 0, 88, 88)],
      [ITEM_C, domRect(0, 93, 88, 88)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-progress__grid")) return domRect(0, 0, 272, 181);
      if (this.dataset.progressItemId) return rects.get(this.dataset.progressItemId) ?? domRect(0, 0, 88, 88);
      return domRect(0, 0, 1024, 768);
    });

    render(<GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={items} notes={notes} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={onReorder} resolveAssetUrl={() => "/icon.webp"} />);
    const first = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${ITEM_A}"]`)!;

    first.focus();
    await user.keyboard("[Space][Escape]");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Перемещение элемента прогресса отменено."));
    await user.pointer([
      { keys: "[MouseLeft>]", target: first, coords: { clientX: 20, clientY: 40 } },
      { target: first, coords: { clientX: 32, clientY: 40 } },
      { keys: "[/MouseLeft]", target: first, coords: { clientX: 32, clientY: 40 } },
    ]);
    expect(onReorder).not.toHaveBeenCalled();
    await user.pointer([
      { keys: "[MouseLeft>]", target: first, coords: { clientX: 20, clientY: 40 } },
      { target: first, coords: { clientX: 32, clientY: 40 } },
      { target: document.body, coords: { clientX: 900, clientY: 700 } },
    ]);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Элемент вне списка прогресса."));
    await user.pointer([
      { keys: "[/MouseLeft]", target: document.body, coords: { clientX: 900, clientY: 700 } },
    ]);

    await waitFor(() => expect(document.querySelector(".game-progress__drag-overlay")).not.toBeInTheDocument());
    expect(onReorder).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Перемещение элемента прогресса отменено."));
  });

  it("matches the approved metadata heading and transparent large-count grid contract", () => {
    const items: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_COMPLETE },
      { id: ITEM_C, iconAssetId: ICON_ID, noteId: NOTE_INVALID },
    ];
    const installProductionStyle = () => {
      const style = document.createElement("style");
      style.textContent = readFileSync("src/styles.css", "utf8");
      document.head.append(style);
      return style;
    };
    let productionStyle = installProductionStyle();
    render(<>
      <dl className="game-sidebar__meta"><div><dt>Теги</dt><dd>LEGO</dd></div></dl>
      <GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={items} notes={notes} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={vi.fn()} resolveAssetUrl={() => "/icon.webp"} />
    </>);

    const assertVisualContract = () => {
      const stylesheet = productionStyle.sheet!;
      const sharedHeadingRules = Array.from(stylesheet.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .filter((rule) => {
          const selectors = rule.selectorText.split(",").map((selector) => selector.trim());
          return selectors.includes(".game-sidebar__meta dt") && selectors.includes(".game-progress__heading");
        });
      expect(sharedHeadingRules).toHaveLength(1);
      expect(sharedHeadingRules[0].selectorText.split(",").map((selector) => selector.trim())).toEqual([
        ".game-sidebar__meta dt",
        ".game-progress__heading",
      ]);
      expect(sharedHeadingRules[0].style.fontSize).toBe("8px");

      const headingStyle = getComputedStyle(screen.getByRole("heading", { name: "Прогресс" }));
      const termStyle = getComputedStyle(screen.getByText("Теги"));
      for (const property of ["color", "fontSize", "fontWeight", "letterSpacing", "textTransform"] as const) {
        expect(headingStyle[property]).toBe(termStyle[property]);
      }
      expect(headingStyle.color).toBe("var(--muted-2)");
      expect(headingStyle.fontSize).toBe("8px");
      expect(headingStyle.fontWeight).toBe("650");
      expect(headingStyle.letterSpacing).toBe("0.07em");
      expect(headingStyle.textTransform).toBe("uppercase");

      const gridStyle = getComputedStyle(document.querySelector(".game-progress__grid")!);
      expect(gridStyle.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");

      const styleRule = (selector: string) => {
        const rules = Array.from(stylesheet.cssRules)
          .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
          .filter((rule) => rule.selectorText === selector);
        expect(rules).toHaveLength(1);
        return rules[0].style;
      };
      const baseDragStyle = styleRule(".game-progress__item");
      expect(baseDragStyle.touchAction).toBe("manipulation");
      expect(baseDragStyle.transition).toBe("border-color .12s, background .12s, opacity .12s, transform .16s ease");
      const sharedCellStyle = styleRule(".game-progress__item, .game-progress__add");
      expect(sharedCellStyle.borderStyle).toBe("solid");
      const savedInteractionStyle = styleRule(".game-progress__item:hover, .game-progress__item:focus-visible");
      expect(savedInteractionStyle.borderColor).toBe("rgb(48, 52, 58)");
      expect(savedInteractionStyle.background).toBe("rgb(23, 25, 28)");
      const addInteractionStyle = styleRule(".game-progress__add:hover:not(:disabled), .game-progress__add:focus-visible");
      expect(addInteractionStyle.borderColor).toBe("rgb(48, 52, 58)");
      expect(addInteractionStyle.borderStyle).toBe("dashed");
      expect(addInteractionStyle.background).toBe("rgb(23, 25, 28)");
      const draggingStyle = styleRule(".game-progress__item.is-dragging");
      expect(draggingStyle.opacity).toBe("0.25");
      expect(draggingStyle.cursor).toBe("grabbing");
      const activeSurfaceStyle = styleRule(".game-progress__item.is-drop-target, .game-progress__drag-overlay");
      expect(activeSurfaceStyle.borderColor).toBe("rgb(48, 52, 58)");
      expect(activeSurfaceStyle.background).toBe("rgb(23, 25, 28)");
      const overlayStyle = styleRule(".game-progress__drag-overlay");
      expect(overlayStyle.width).toBe("100%");
      expect(overlayStyle.cursor).toBe("grabbing");
      expect(overlayStyle.boxShadow).toBe("0 8px 20px rgba(0, 0, 0, .28)");

      const saved = screen.getByRole("button", { name: "Редактировать элемент прогресса: 2 из 5" });
      const complete = screen.getByRole("button", { name: "Редактировать элемент прогресса: 3 из 3, завершено" });
      const add = screen.getByRole("button", { name: "Добавить элемент прогресса" });
      const savedStyle = getComputedStyle(saved);
      const completeStyle = getComputedStyle(complete);
      const addStyle = getComputedStyle(add);
      const borderColors = ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"] as const;
      expect(savedStyle.height).toBe("88px");
      expect(savedStyle.borderStyle).toBe("solid");
      expect(savedStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(addStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(completeStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(completeStyle.textDecorationLine).toBe("none");
      for (const style of [savedStyle, addStyle, completeStyle]) {
        for (const borderColor of borderColors) {
          expect(style[borderColor]).toBe("rgba(0, 0, 0, 0)");
        }
      }

      const valueStyle = getComputedStyle(within(saved).getByText("2").closest(".game-progress__value")!);
      expect(valueStyle.fontSize).toBe("14px");
      expect(valueStyle.fontWeight).toBe("690");
      expect(valueStyle.lineHeight).toBe("17px");
      expect(valueStyle.letterSpacing).toBe("-0.07em");
      expect(valueStyle.fontVariantNumeric).toBe("tabular-nums");
      const expectedFonts = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      const normalParts = [
        [within(saved).getByText("2"), "690", "rgb(240, 241, 242)"],
        [within(saved).getByText("/"), "350", "rgb(80, 86, 94)"],
        [within(saved).getByText("5"), "560", "rgb(147, 153, 161)"],
      ] as const;
      for (const [part, weight, color] of normalParts) {
        const style = getComputedStyle(part);
        expect(style.fontFamily).toBe(expectedFonts);
        expect(style.fontSize).toBe("14px");
        expect(style.fontWeight).toBe(weight);
        expect(style.fontVariantNumeric).toBe("tabular-nums");
        expect(style.letterSpacing).toBe("-0.07em");
        expect(style.lineHeight).toBe("17px");
        expect(style.textDecorationLine).toBe("none");
        expect(style.color).toBe(color);
      }
      const completeParts = Array.from(complete.querySelectorAll(".game-progress__checked, .game-progress__slash, .game-progress__total"));
      expect(completeParts).toHaveLength(3);
      for (const [index, completePart] of completeParts.entries()) {
        const normalStyle = getComputedStyle(normalParts[index][0]);
        const completePartStyle = getComputedStyle(completePart);
        for (const property of ["fontFamily", "fontSize", "fontWeight", "fontVariantNumeric", "letterSpacing", "lineHeight", "textDecorationLine"] as const) {
          expect(completePartStyle[property]).toBe(normalStyle[property]);
        }
        expect(completePartStyle.color).toBe("var(--success)");
      }

      const totalRules = Array.from(stylesheet.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .filter((rule) => rule.selectorText === ".game-progress__total");
      expect(totalRules).toHaveLength(1);
      expect(totalRules[0].style.textDecorationLine).toBe("");

      const itemStyle = getComputedStyle(saved);
      expect(itemStyle.gridTemplateRows).toBe("64px 17px");
      const errorStyle = getComputedStyle(screen.getByText("ошибка"));
      expect(errorStyle.fontSize).toBe("11px");
    };

    try {
      assertVisualContract();
      const sharedHeadingRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-sidebar__meta dt, .game-progress__heading")!;
      sharedHeadingRule.style.fontSize = "9px";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
      const totalRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-progress__total")!;
      totalRule.style.textDecorationLine = "underline";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
      const draggingRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-progress__item.is-dragging")!;
      draggingRule.style.opacity = "1";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
      const savedInteractionRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-progress__item:hover, .game-progress__item:focus-visible")!;
      savedInteractionRule.selectorText = ".game-progress__item:hover";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
      const addInteractionRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-progress__add:hover:not(:disabled), .game-progress__add:focus-visible")!;
      addInteractionRule.selectorText = ".game-progress__add:hover:not(:disabled)";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
      const savedBaseRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-progress__item, .game-progress__add")!;
      savedBaseRule.style.borderStyle = "dashed";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
      const addDashedRule = Array.from(productionStyle.sheet!.cssRules)
        .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
        .find((rule) => rule.selectorText === ".game-progress__add:hover:not(:disabled), .game-progress__add:focus-visible")!;
      addDashedRule.style.borderStyle = "solid";
      expect(assertVisualContract).toThrow();
      productionStyle.remove();
      productionStyle = installProductionStyle();
      assertVisualContract();
    } finally {
      productionStyle.remove();
    }
  });

  it("treats a missing or cross-game note as a broken value without leaking a normal label", () => {
    render(<GameProgressGrid assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} items={[
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_OTHER_GAME },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: "99999999-9999-4999-8999-999999999999" },
    ]} notes={notes} onAdd={vi.fn()} onEdit={vi.fn()} onReorder={vi.fn()} resolveAssetUrl={() => "/icon.webp"} />);

    expect(screen.getAllByText("ошибка")).toHaveLength(2);
    expect(screen.queryByText("Другая игра")).not.toBeInTheDocument();
  });

  it("resolves one shared note body once per stable render and refreshes after the body changes", () => {
    const sharedItems: GameProgressItem[] = [
      { id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID },
      { id: ITEM_B, iconAssetId: ICON_ID, noteId: NOTE_VALID },
    ];
    const props = {
      assets: { [ICON_ID]: iconAsset() },
      gameId: GAME_ID,
      items: sharedItems,
      notes,
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      onReorder: vi.fn(),
      resolveAssetUrl: () => "/icon.webp",
    };
    const view = render(<GameProgressGrid {...props} />);

    expect(resolveNoteChecklistProgress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Редактировать элемент прогресса: 2 из 5" })).toHaveLength(2);

    const changedNotes = notes.map((candidate) => candidate.id === NOTE_VALID
      ? { ...candidate, bodyMarkdown: "# До финала\n- [x] Глава 1\n- [ ] Глава 2" }
      : candidate);
    view.rerender(<GameProgressGrid {...props} notes={changedNotes} />);
    expect(resolveNoteChecklistProgress).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" })).toHaveLength(2);

    view.rerender(<GameProgressGrid {...props} notes={changedNotes} />);
    expect(resolveNoteChecklistProgress).toHaveBeenCalledTimes(2);
  });
});

describe("GameProgressItemDialog", () => {
  it("uses one optimized image pipeline for file selection, the visible paste button, and dialog paste", async () => {
    const user = userEvent.setup();
    const canAddBlob = vi.fn(() => null);
    const clipboardFile = new File(["clipboard"], "clipboard.png", { type: "image/png" });
    vi.mocked(readClipboardImage).mockResolvedValue(clipboardFile);
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} canAddBlob={canAddBlob} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    const dialog = screen.getByRole("dialog", { name: "Элемент прогресса" });
    const selectedFile = new File(["selected"], "selected.png", { type: "image/png" });
    await user.upload(within(dialog).getByLabelText("Выбрать файл"), selectedFile);
    await waitFor(() => expect(optimizeProgressIcon).toHaveBeenCalledWith(selectedFile, ""));

    await user.click(within(dialog).getByRole("button", { name: "Вставить" }));
    await waitFor(() => expect(optimizeProgressIcon).toHaveBeenCalledWith(clipboardFile, ""));

    const pastedFile = new File(["pasted"], "pasted.png", { type: "image/png" });
    await user.click(within(dialog).getByRole("combobox", { name: "Заметка" }));
    await user.paste(imageTransfer(pastedFile));
    await waitFor(() => expect(optimizeProgressIcon).toHaveBeenCalledWith(pastedFile, ""));
    expect(canAddBlob).toHaveBeenCalledTimes(3);

    const callsBeforeText = vi.mocked(optimizeProgressIcon).mock.calls.length;
    const text = textTransfer("not an image");
    await user.paste(text);
    expect(optimizeProgressIcon).toHaveBeenCalledTimes(callsBeforeText);
    expect(clipboardImageFile(text)).toBeNull();
  });

  it("identifies an accepted icon preview as exact 64×64 WebP output", async () => {
    const user = userEvent.setup();
    render(<GameProgressItemDialog assets={{}} gameId={GAME_ID} item={existingItem({ iconAssetId: null })} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} storageLocked={false} />);

    expect(screen.queryByText("64×64 WebP")).not.toBeInTheDocument();
    await user.upload(screen.getByLabelText("Выбрать файл"), new File(["image"], "image.png", { type: "image/png" }));
    expect(await screen.findByText("64×64 WebP")).toBeVisible();
    expect(screen.getByAltText("Предпросмотр иконки прогресса")).toHaveAttribute("width", "64");
    expect(screen.getByAltText("Предпросмотр иконки прогресса")).toHaveAttribute("height", "64");
  });

  it("announces icon processing as busy until optimization finishes", async () => {
    const user = userEvent.setup();
    let finish!: (image: Awaited<ReturnType<typeof optimizeProgressIcon>>) => void;
    vi.mocked(optimizeProgressIcon).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    const dialog = screen.getByRole("dialog", { name: "Элемент прогресса" });
    await user.upload(screen.getByLabelText("Выбрать файл"), new File(["image"], "image.png", { type: "image/png" }));
    expect(dialog).toHaveAttribute("aria-busy", "true");

    finish({ asset: iconAsset(PENDING_ICON_ID), blob: new Blob(["webp"], { type: "image/webp" }), byteLength: 4 });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
  });

  it("keeps the selected note when React defers its draft update after image processing", async () => {
    const user = userEvent.setup();
    const clipboardFile = new File(["clipboard"], "clipboard.gif", { type: "image/gif" });
    vi.mocked(readClipboardImage).mockResolvedValueOnce(clipboardFile);
    const onSave = vi.fn();
    render(<GameProgressItemDialog assets={{}} gameId={GAME_ID} item={existingItem({ iconAssetId: null, noteId: "" })} notes={notes} onCancel={vi.fn()} onSave={onSave} storageLocked={false} />);

    await user.click(screen.getByRole("button", { name: "Вставить" }));
    await waitFor(() => expect(screen.getByAltText("Предпросмотр иконки прогресса")).toBeVisible());

    const select = screen.getByRole("combobox", { name: "Заметка" }) as HTMLSelectElement;
    select.value = NOTE_VALID;
    await act(async () => {
      startTransition(() => select.dispatchEvent(new Event("change", { bubbles: true })));
    });

    await waitFor(() => expect(select).toHaveValue(NOTE_VALID));
    expect(screen.getByText("2/5").closest(".game-progress-dialog__progress")).not.toHaveClass("is-error");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ noteId: NOTE_VALID, pendingIcon: expect.any(Object) })));
  });

  it("covers clipboard permission and read delay with the same busy lifecycle", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    let finishRead!: (file: File) => void;
    vi.mocked(readClipboardImage).mockClear();
    vi.mocked(readClipboardImage).mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={onCancel} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    const dialog = screen.getByRole("dialog", { name: "Элемент прогресса" });
    await user.click(screen.getByRole("button", { name: "Вставить" }));
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Вставить" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(readClipboardImage).toHaveBeenCalledTimes(1);

    const file = new File(["clipboard"], "clipboard.png", { type: "image/png" });
    finishRead(file);
    await waitFor(() => expect(optimizeProgressIcon).toHaveBeenCalledWith(file, ""));
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
  });

  it("shows the visible file label focus treatment when its hidden input receives keyboard focus", () => {
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    const input = screen.getByLabelText("Выбрать файл");
    const label = input.closest("label")!;
    input.focus();
    expect(input).toHaveFocus();
    expect(label.matches(":focus-within")).toBe(true);
    const styles = readFileSync("src/styles.css", "utf8");
    const focusRuleSource = styles.match(/\.game-progress-dialog__image-actions label:focus-within\s*\{[^}]+\}/)?.[0];
    expect(focusRuleSource).toBeDefined();
    const style = document.createElement("style");
    style.textContent = focusRuleSource!;
    document.head.append(style);
    const focusRule = style.sheet!.cssRules[0] as CSSStyleRule;
    expect(focusRule.selectorText).toBe(".game-progress-dialog__image-actions label:focus-within");
    expect(focusRule.style.outline).toBe("2px solid var(--accent)");
    expect(focusRule.style.outlineOffset).toBe("2px");
    style.remove();
  });

  it("orders selectable notes by group and rank and only enables save for finite checklist progress", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const groupedNotes = [
      note(NOTE_INVALID, "Без заголовка", { groupRank: 2048, rank: 100 }),
      note(NOTE_VALID, "# Второй\n- [x] A\n- [x] B\n- [ ] C\n- [ ] D\n- [ ] E", { groupRank: 1024, rank: 200 }),
      note(NOTE_COMPLETE, "# Первый\n- [x] A", { groupRank: 1024, rank: 100 }),
    ];
    const onSave = vi.fn();
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem({ noteId: NOTE_INVALID })} notes={groupedNotes} onCancel={vi.fn()} onSave={onSave} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    const select = screen.getByRole("combobox", { name: "Заметка" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Выберите заметку", "Первый", "Второй", "Заметка 3"]);
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    expect(screen.getByText("ошибка").closest(".game-progress-dialog__progress")).toHaveClass("is-error");

    await user.selectOptions(select, NOTE_VALID);
    await waitFor(() => expect(select).toHaveFocus());
    expect(screen.getByText("2/5").closest(".game-progress-dialog__progress")).not.toHaveClass("is-error");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: ITEM_A, iconAssetId: ICON_ID, noteId: NOTE_VALID })));
  });

  it("shows remove and confirmed delete only when those existing-item actions are available", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={vi.fn()} onDelete={onDelete} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    expect(screen.getByRole("button", { name: "Убрать" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(confirm).toHaveBeenCalledWith("Удалить элемент прогресса?");
    expect(onDelete).toHaveBeenCalledTimes(1);

    view.rerender(<GameProgressItemDialog assets={{}} gameId={GAME_ID} item={existingItem({ iconAssetId: null })} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} storageLocked={false} />);
    expect(screen.queryByRole("button", { name: "Убрать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
  });

  it("keeps existing configuration viewable while storage lock disables image growth", () => {
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked />);

    expect(screen.getByRole("dialog", { name: "Элемент прогресса" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Заметка" })).toHaveValue(NOTE_VALID);
    expect(screen.getByLabelText("Выбрать файл")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Вставить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Убрать" })).toBeEnabled();
  });

  it("asks before discarding a dirty draft from Escape or the backdrop", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={onCancel} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Заметка" }), NOTE_COMPLETE);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledWith("Закрыть без сохранения изменений?");
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.querySelector(".game-progress-dialog-layer")!);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.mouseDown(document.querySelector(".game-progress-dialog-layer")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cycles focus from the first control to the last and back", async () => {
    render(<GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={vi.fn()} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} />);

    const close = screen.getByRole("button", { name: "Закрыть" });
    const save = screen.getByRole("button", { name: "Сохранить" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("restores the grid trigger focus after Escape and Cancel through parent coordination", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      const trigger = useRef<HTMLButtonElement | null>(null);
      const close = () => {
        setOpen(false);
        requestAnimationFrame(() => trigger.current?.focus());
      };
      return <>
        <button onClick={(event) => { trigger.current = event.currentTarget; setOpen(true); }} type="button">Открыть прогресс</button>
        {open ? <GameProgressItemDialog assets={{ [ICON_ID]: iconAsset() }} gameId={GAME_ID} item={existingItem()} notes={notes} onCancel={close} onSave={vi.fn()} resolveAssetUrl={() => "/icon.webp"} storageLocked={false} /> : null}
      </>;
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Открыть прогресс" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
