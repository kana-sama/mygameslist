import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardSensor, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffDialog } from "../src/components/DiffDialog";
import type { Collection, CollectionItem, Game, Note } from "../src/domain/types";
import { CatalogPage } from "../src/pages/CatalogPage";
import { GamePage, type GameSaveInput } from "../src/pages/GamePage";
import {
  getTierDropTarget,
  TIER_LIST_SENSOR_OPTIONS,
  TIER_LIST_SENSOR_TYPES,
  TierListPage,
} from "../src/pages/TierListPage";

const DUCK_ID = "11111111-1111-4111-8111-111111111111";
const MARIO_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const COLLECTION_ID = "44444444-4444-4444-8444-444444444444";
const ZELDA_ID = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-07-16T10:00:00.000Z";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  return window.setTimeout(() => callback(performance.now()), 0);
});
vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: DUCK_ID,
    title: "DuckTales",
    coverAssetId: null,
    platforms: ["NES"],
    tags: ["platformer"],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "Хорошая игра",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
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

const collection: Collection = {
  id: COLLECTION_ID,
  title: "Disney",
  descriptionMarkdown: "",
  createdAt: NOW,
  updatedAt: NOW,
};

const collectionItem: CollectionItem = {
  id: "55555555-5555-4555-8555-555555555555",
  collectionId: COLLECTION_ID,
  gameId: DUCK_ID,
  rank: 1024,
};

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CatalogPage", () => {
  it("restores search and filters from the hash, applies group logic, and persists changes", async () => {
    const user = userEvent.setup();
    const games = [
      makeGame(),
      makeGame({
        id: MARIO_ID,
        title: "Super Mario Odyssey",
        platforms: ["Switch"],
        tags: ["platformer", "mario"],
        status: "completed",
        placement: { tierId: "s", rank: 1024 },
        updatedAt: "2026-07-15T10:00:00.000Z",
      }),
    ];
    window.location.hash = "#/games?q=duck&status=playing";

    render(
      <CatalogPage
        assets={{}}
        collectionItems={[collectionItem]}
        collections={[collection]}
        games={games}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Поиск игр" });
    expect(search).toHaveValue("duck");
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    expect(screen.queryByText("Super Mario Odyssey")).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    expect(screen.queryByText("Super Mario Odyssey")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Играю"));
    expect(screen.getByText("Super Mario Odyssey")).toBeInTheDocument();

    await user.click(screen.getByLabelText("NES"));
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    expect(screen.queryByText("Super Mario Odyssey")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Switch"));
    expect(screen.getByText("Super Mario Odyssey")).toBeInTheDocument();

    await user.click(screen.getByLabelText("#mario"));
    expect(screen.queryByText("DuckTales")).not.toBeInTheDocument();
    expect(screen.getByText("Super Mario Odyssey")).toBeInTheDocument();

    await waitFor(() => {
      expect(window.location.hash).toContain("platform=NES");
      expect(window.location.hash).toContain("platform=Switch");
      expect(window.location.hash).toContain("tag=mario");
      expect(window.location.hash).not.toContain("status=playing");
      expect(window.location.hash).not.toContain("q=duck");
    });
  });
});

describe("GamePage", () => {
  it("creates a game with multiple platforms and a linked note", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("https://example.com/ducktales")
      .mockReturnValueOnce("Гайд по уровням");

    render(
      <GamePage
        assets={{}}
        collectionItems={[]}
        collections={[collection]}
        mode="new"
        notes={[]}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Название *" }), "DuckTales");
    const platforms = screen.getByRole("combobox", { name: "Платформы" });
    await user.type(platforms, "NES{Enter}");
    await user.type(platforms, "Switch{Enter}");
    await user.click(screen.getByLabelText("Disney"));
    await user.type(screen.getByRole("textbox", { name: "Отзыв" }), "Люблю **музыку**.");

    await user.click(screen.getByRole("button", { name: "Добавить заметку" }));
    const noteEditor = screen.getByText("Заметка 1").closest("article");
    expect(noteEditor).not.toBeNull();
    await user.type(within(noteEditor!).getByRole("textbox", { name: "Текст заметки" }), "Секреты уровня Amazon");
    const linkButtons = within(noteEditor!).getAllByRole("button", { name: "Ссылка" });
    await user.click(linkButtons[linkButtons.length - 1]);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: undefined,
      title: "DuckTales",
      platforms: ["NES", "Switch"],
      collectionIds: [COLLECTION_ID],
      reviewMarkdown: "Люблю **музыку**.",
      notes: [expect.objectContaining({
        bodyMarkdown: "Секреты уровня Amazon",
        rank: 1024,
        attachments: [{ type: "link", url: "https://example.com/ducktales", label: "Гайд по уровням" }],
      })],
    }));
  });

  it("edits an existing game and preserves stable game and note ids", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Старая заметка",
      attachments: [{ type: "link", url: "./files/map.pdf", label: "Карта" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(
      <GamePage
        assets={{}}
        collectionItems={[collectionItem]}
        collections={[collection]}
        game={makeGame()}
        mode="edit"
        notes={[note]}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Название *" });
    await user.clear(title);
    await user.type(title, "DuckTales Remastered");
    await user.type(screen.getByRole("combobox", { name: "Платформы" }), "Switch{Enter}");
    const noteText = screen.getByRole("textbox", { name: "Текст заметки" });
    await user.clear(noteText);
    await user.type(noteText, "Обновлённая заметка");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(DUCK_ID);
    expect(saved.platforms).toEqual(["NES", "Switch"]);
    expect(saved.notes[0]).toEqual(expect.objectContaining({
      id: NOTE_ID,
      clientId: NOTE_ID,
      bodyMarkdown: "Обновлённая заметка",
      attachments: [{ type: "link", url: "./files/map.pdf", label: "Карта" }],
    }));
  });
});

describe("DiffDialog", () => {
  const item = { id: "title-op", group: "changed" as const, title: "DuckTales: название" };

  it("blocks publication for conflicts and forwards conflict and undo actions", async () => {
    const user = userEvent.setup();
    const onResolveConflict = vi.fn();
    const onUndoItem = vi.fn();
    const onUndoGroup = vi.fn();
    const onClearAll = vi.fn();
    const copyCommand = vi.fn().mockResolvedValue(true);

    render(
      <DiffDialog
        command="node scripts/publish-patch.mjs"
        conflicts={[{
          id: "title-conflict",
          path: `/games/${DUCK_ID}/title`,
          label: "Название DuckTales",
          staticValue: "DuckTales Remastered",
          localValue: "DuckTales Local",
        }]}
        copyCommand={copyCommand}
        items={[item]}
        onClearAll={onClearAll}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onResolveConflict={onResolveConflict}
        onUndoGroup={onUndoGroup}
        onUndoItem={onUndoItem}
        open
        patchBytes={2048}
      />,
    );

    expect(screen.getByRole("button", { name: "Скопировать команду" })).toBeDisabled();
    expect(screen.getByText("Сначала разрешите все конфликты.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Оставить локальное" }));
    expect(onResolveConflict).toHaveBeenCalledWith("title-conflict", "local");
    await user.click(screen.getByRole("button", { name: `Отменить: ${item.title}` }));
    expect(onUndoItem).toHaveBeenCalledWith(item.id);
    await user.click(screen.getByRole("button", { name: "Отменить группу" }));
    expect(onUndoGroup).toHaveBeenCalledWith("changed");
    await user.click(screen.getByRole("button", { name: "Отменить все правки" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(copyCommand).not.toHaveBeenCalled();
  });

  it("shows a manual Safari fallback when clipboard copying is rejected", async () => {
    const user = userEvent.setup();
    const command = "node scripts/publish-patch.mjs <<'MYLIB_PATCH'\npayload\nMYLIB_PATCH";
    const copyCommand = vi.fn().mockResolvedValue(false);

    render(
      <DiffDialog
        command={command}
        copyCommand={copyCommand}
        items={[item]}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        open
        patchBytes={1024}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Скопировать команду" }));
    const fallback = await screen.findByLabelText(/Safari не разрешил доступ к буферу/);
    expect(fallback).toHaveValue(command);
    expect(copyCommand).toHaveBeenCalledTimes(1);
  });
});

describe("TierListPage", () => {
  it("wires pointer, touch, and keyboard sensors with deliberate activation constraints", () => {
    expect(TIER_LIST_SENSOR_TYPES).toEqual({
      pointer: PointerSensor,
      touch: TouchSensor,
      keyboard: KeyboardSensor,
    });
    expect(TIER_LIST_SENSOR_OPTIONS.pointer).toEqual({ activationConstraint: { distance: 8 } });
    expect(TIER_LIST_SENSOR_OPTIONS.touch).toEqual({ activationConstraint: { delay: 180, tolerance: 8 } });
    expect(TIER_LIST_SENSOR_OPTIONS.keyboard.coordinateGetter).toBe(sortableKeyboardCoordinates);
  });

  it("calculates same-tier forward and backward drops after removing the active game", () => {
    const games = [
      makeGame({ placement: { tierId: "a", rank: 1024 } }),
      makeGame({ id: MARIO_ID, title: "Mario", placement: { tierId: "a", rank: 2048 } }),
      makeGame({ id: ZELDA_ID, title: "Zelda", placement: { tierId: "a", rank: 3072 } }),
    ];

    expect(getTierDropTarget(games, DUCK_ID, "a", ZELDA_ID)).toEqual({ tierId: "a", index: 2 });
    expect(getTierDropTarget(games, ZELDA_ID, "a", DUCK_ID)).toEqual({ tierId: "a", index: 0 });
    expect(getTierDropTarget(games, MARIO_ID, "a", ZELDA_ID)).toEqual({ tierId: "a", index: 2 });
    expect(getTierDropTarget(games, MARIO_ID, "a", DUCK_ID)).toEqual({ tierId: "a", index: 0 });
    expect(getTierDropTarget(games, DUCK_ID, "a", DUCK_ID)).toBeNull();
  });

  it("supports a keyboard drag between adjacent cards", async () => {
    const user = userEvent.setup();
    const onMoveGame = vi.fn();
    const games = [
      makeGame({ placement: { tierId: "a", rank: 1024 } }),
      makeGame({ id: MARIO_ID, title: "Mario", placement: { tierId: "a", rank: 2048 } }),
      makeGame({ id: ZELDA_ID, title: "Zelda", placement: { tierId: "a", rank: 3072 } }),
    ];
    const cardLeft = new Map([["DuckTales", 0], ["Mario", 140], ["Zelda", 280]]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-card")) {
        const title = this.querySelector(".game-card__title")?.textContent ?? "";
        return domRect(cardLeft.get(title) ?? 0, 100, 120, 160);
      }
      if (this.matches(".tier-row__games")) return domRect(0, 100, 560, 180);
      return domRect(0, 0, 1024, 768);
    });

    render(<TierListPage assets={{}} games={games} onMoveGame={onMoveGame} />);
    const handle = screen.getByRole("button", { name: "Перетащить DuckTales" });
    handle.focus();

    await user.keyboard("[Space]");
    await waitFor(() => expect(handle.closest("article")).toHaveClass("is-dragging"));
    await user.keyboard("[ArrowRight]");
    await user.keyboard("[Space]");

    await waitFor(() => {
      expect(onMoveGame).toHaveBeenCalledWith(DUCK_ID, { tierId: "a", index: 1 });
    });
  });

  it("moves a game through the action-sheet fallback without pointer DnD", async () => {
    const user = userEvent.setup();
    const onMoveGame = vi.fn();
    const games = [
      makeGame(),
      makeGame({
        id: MARIO_ID,
        title: "Super Mario Odyssey",
        platforms: ["Switch"],
        status: "completed",
        placement: { tierId: "b", rank: 1024 },
      }),
    ];

    render(<TierListPage assets={{}} games={games} onMoveGame={onMoveGame} />);

    await user.click(screen.getByRole("button", { name: "Переместить DuckTales" }));
    const dialog = screen.getByRole("dialog", { name: "DuckTales" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Тир" }), "b");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Позиция" }), "1");
    await user.click(within(dialog).getByRole("button", { name: "Переместить" }));

    expect(onMoveGame).toHaveBeenCalledWith(DUCK_ID, { tierId: "b", index: 1 });
    expect(screen.queryByRole("dialog", { name: "DuckTales" })).not.toBeInTheDocument();
  });

  it("supports a primary-pointer drag after the distance threshold", async () => {
    const user = userEvent.setup();
    const onMoveGame = vi.fn();
    const games = [
      makeGame({ placement: { tierId: "a", rank: 1024 } }),
      makeGame({ id: MARIO_ID, title: "Mario", placement: { tierId: "a", rank: 2048 } }),
      makeGame({ id: ZELDA_ID, title: "Zelda", placement: { tierId: "a", rank: 3072 } }),
    ];
    const cardLeft = new Map([["DuckTales", 0], ["Mario", 140], ["Zelda", 280]]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-card")) {
        const title = this.querySelector(".game-card__title")?.textContent ?? "";
        return domRect(cardLeft.get(title) ?? 0, 100, 120, 160);
      }
      if (this.matches(".tier-row__games")) return domRect(0, 100, 560, 180);
      return domRect(0, 0, 1024, 768);
    });

    render(<TierListPage assets={{}} games={games} onMoveGame={onMoveGame} />);
    const handle = screen.getByRole("button", { name: "Перетащить DuckTales" });

    await user.pointer([{ keys: "[MouseLeft>]", target: handle, coords: { clientX: 10, clientY: 120 } }]);
    expect(handle.closest("article")).not.toHaveClass("is-dragging");
    await user.pointer([{ target: handle, coords: { clientX: 170, clientY: 120 } }]);
    await waitFor(() => expect(handle.closest("article")).toHaveClass("is-dragging"));
    await user.pointer([{ target: handle, coords: { clientX: 180, clientY: 120 } }]);
    await user.pointer([{ keys: "[/MouseLeft]", target: handle, coords: { clientX: 180, clientY: 120 } }]);

    await waitFor(() => {
      expect(onMoveGame).toHaveBeenCalledWith(DUCK_ID, { tierId: "a", index: 1 });
    });
  });
});
