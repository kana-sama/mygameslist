import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardCode, KeyboardSensor, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffDialog } from "../src/components/DiffDialog";
import { AppShell } from "../src/components/AppShell";
import { optimizeNoteImage } from "../src/domain/assets";
import type { Asset, Game, Note } from "../src/domain/types";
import { CatalogPage } from "../src/pages/CatalogPage";
import {
  GamePage,
  getNoteDropIndex,
  NonTouchNotePointerSensor,
  NOTE_LIST_SENSOR_OPTIONS,
  NOTE_LIST_SENSOR_TYPES,
  NOTE_LIST_SORTING_STRATEGY,
  type EditableNote,
  type GameSaveInput,
} from "../src/pages/GamePage";
import {
  getTierDropTarget,
  NonTouchPointerSensor,
  TIER_LIST_SENSOR_OPTIONS,
  TIER_LIST_SORTING_STRATEGY,
  TIER_LIST_SENSOR_TYPES,
  TierListPage,
} from "../src/pages/TierListPage";

vi.mock("../src/domain/assets", async () => {
  const actual = await vi.importActual<typeof import("../src/domain/assets")>("../src/domain/assets");
  return { ...actual, optimizeNoteImage: vi.fn(actual.optimizeNoteImage) };
});

const DUCK_ID = "11111111-1111-4111-8111-111111111111";
const MARIO_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const NOTE_TWO_ID = "44444444-4444-4444-8444-444444444444";
const NOTE_THREE_ID = "55555555-5555-4555-8555-555555555555";
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

beforeEach(() => {
  window.location.hash = "#/";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("keeps exactly the same header structure between the tier list and catalog", () => {
    const view = render(<AppShell onOpenDiff={vi.fn()} route="tiers" storage={{ bytes: 0, operationCount: 0 }}><div>Тирлист</div></AppShell>);
    const tierHeader = view.container.querySelector(".app-header");
    expect(tierHeader).not.toBeNull();
    const tierMarkup = tierHeader!.outerHTML.replace(/ aria-current="page"/g, "");
    expect(view.container.firstElementChild).toHaveClass("app-shell");
    expect(view.container.firstElementChild).not.toHaveClass("app-shell--tiers");
    expect(view.container.firstElementChild).toHaveAttribute("data-route", "tiers");

    view.rerender(<AppShell onOpenDiff={vi.fn()} route="catalog" storage={{ bytes: 0, operationCount: 0 }}><div>Каталог</div></AppShell>);
    const catalogHeader = view.container.querySelector(".app-header");
    expect(catalogHeader).not.toBeNull();
    expect(catalogHeader!.outerHTML.replace(/ aria-current="page"/g, "")).toBe(tierMarkup);
    expect(view.container.firstElementChild).toHaveAttribute("data-route", "catalog");
    expect(within(catalogHeader!).getByRole("link", { name: "Каталог" })).toHaveAttribute("aria-current", "page");
    expect(within(catalogHeader!).getByRole("link", { name: "Тирлист" })).not.toHaveAttribute("aria-current");
  });

  it("keeps only the two navigation tabs on the left side of the header", () => {
    render(<AppShell onOpenDiff={vi.fn()} route="tiers" storage={{ bytes: 0, operationCount: 0 }}><div>Тирлист</div></AppShell>);

    const header = document.querySelector(".app-header");
    expect(header?.firstElementChild).toHaveClass("app-nav");
    expect(within(header as HTMLElement).getAllByRole("link").slice(0, 2).map((link) => link.textContent)).toEqual(["Тирлист", "Каталог"]);
    expect(header?.querySelector(".brand")).not.toBeInTheDocument();
    expect(within(header as HTMLElement).queryByText("Моя игровая библиотека")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Локальные правки: 0, 0 Б" })).toBeInTheDocument();
  });

  it("keeps low-storage feedback in the header instead of rendering notifications", () => {
    render(<AppShell onOpenDiff={vi.fn()} route="catalog" storage={{ bytes: 86, budgetBytes: 100, operationCount: 3 }}><div>Каталог</div></AppShell>);

    expect(screen.getByRole("button", { name: "Локальные правки: 3, 86 Б, хранилище почти заполнено" })).toHaveClass("patch-pill--critical");
    expect(screen.queryByText("Осталось мало места")).not.toBeInTheDocument();
    expect(screen.queryByText("Правки живут только в этом Safari")).not.toBeInTheDocument();
  });

  it("keeps persistence errors in the header instead of adding another page block", () => {
    render(<AppShell onOpenDiff={vi.fn()} route="tiers" storage={{ bytes: 12, error: "Safari отклонил запись", operationCount: 2 }}><div>Тирлист</div></AppShell>);

    expect(screen.getByRole("button", { name: "Локальные правки: 2, 12 Б, ошибка: Safari отклонил запись" })).toHaveClass("patch-pill--error");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("CatalogPage", () => {
  it("keeps the add-game action in the shared header instead of duplicating it in the catalog", () => {
    render(
      <CatalogPage
        assets={{}}
        games={[]}
      />,
    );

    expect(screen.queryByRole("link", { name: "Добавить игру" })).not.toBeInTheDocument();
  });

  it("keeps only compact search controls and always orders games by the latest change", async () => {
    window.location.hash = "#/games?sort=title";
    const games = [
      makeGame({ id: MARIO_ID, title: "A game", updatedAt: "2026-07-15T10:00:00.000Z" }),
      makeGame({ title: "Z game", updatedAt: "2026-07-16T10:00:00.000Z" }),
    ];

    render(<CatalogPage assets={{}} games={games} />);

    expect(screen.queryByRole("heading", { name: "Каталог" })).not.toBeInTheDocument();
    expect(screen.queryByText("Все игры")).not.toBeInTheDocument();
    expect(screen.queryByText(/игр в библиотеке/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Найдено:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Сортировка")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Поиск игр" })).toHaveAttribute("placeholder", "Поиск…");
    expect(Array.from(document.querySelectorAll(".catalog-list .game-card__title")).map((node) => node.textContent)).toEqual(["Z game", "A game"]);
    const controls = screen.getByRole("region", { name: "Поиск и фильтры" });
    expect(controls.children).toHaveLength(2);
    expect(controls.firstElementChild).toHaveClass("filter-row");
    expect(controls.lastElementChild).toHaveClass("search-field");
    await waitFor(() => expect(window.location.hash).toBe("#/games"));
  });

  it("renders a metadata-only cover through the shared asset resolver", () => {
    const assetId = "a".repeat(64);
    const game = makeGame({ coverAssetId: assetId });
    const asset = {
      id: assetId,
      kind: "image",
      mime: "image/webp",
      width: 512,
      height: 512,
      byteLength: 128,
      alt: "Обложка DuckTales",
      originalName: "cover.webp",
    } as Asset;
    const resolveAssetUrl = vi.fn(() => "/mylib/media/cover.webp");

    render(<CatalogPage assets={{ [assetId]: asset }} games={[game]} resolveAssetUrl={resolveAssetUrl} />);

    expect(screen.getByRole("img", { name: "Обложка DuckTales" })).toHaveAttribute("src", "/mylib/media/cover.webp");
    expect(resolveAssetUrl).toHaveBeenCalledWith(assetId);
  });

  it("marks platinum catalog covers and leaves completed covers plain", () => {
    render(<CatalogPage assets={{}} games={[
      makeGame({ title: "Platinum game", status: "platinum" }),
      makeGame({ id: MARIO_ID, title: "Completed game", status: "completed" }),
    ]} />);

    const platinumCard = screen.getByRole("link", { name: "Platinum game" }).closest("article")!;
    const completedCard = screen.getByRole("link", { name: "Completed game" }).closest("article")!;
    expect(platinumCard.querySelector(".game-card__cover")).toHaveClass("cover--platinum");
    expect(completedCard.querySelector(".game-card__cover")).not.toHaveClass("cover--platinum");
    expect(within(platinumCard).getByText("Платина")).toBeInTheDocument();
    expect(within(completedCard).getByText("Пройдено")).toBeInTheDocument();
    expect(screen.getByLabelText("Платина")).toBeInTheDocument();
  });

  it("keeps search stable when StrictMode replays state updaters", async () => {
    const user = userEvent.setup();
    render(<StrictMode><CatalogPage assets={{}} games={[makeGame()]} /></StrictMode>);

    const search = screen.getByRole("searchbox", { name: "Поиск игр" });
    await user.type(search, "du");

    expect(search).toHaveValue("du");
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    const renderedTag = document.querySelector(".game-card__tags span");
    expect(renderedTag).toHaveTextContent("platformer");
    expect(renderedTag).not.toHaveTextContent("#platformer");
    await waitFor(() => expect(window.location.hash).toBe("#/games?q=du"));
  });

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

    await user.click(screen.getByLabelText("mario"));
    expect(screen.queryByText("DuckTales")).not.toBeInTheDocument();
    expect(screen.getByText("Super Mario Odyssey")).toBeInTheDocument();

    await waitFor(() => {
      expect(window.location.hash).toContain("platform=NES");
      expect(window.location.hash).toContain("platform=Switch");
      expect(window.location.hash).toContain("tag=mario");
      expect(window.location.hash).not.toContain("status=playing");
      expect(window.location.hash).not.toContain("q=duck");
    });
    expect(screen.queryByText("Коллекции")).not.toBeInTheDocument();
    expect(screen.queryByText("Коллекция")).not.toBeInTheDocument();
  });
});

describe("GamePage", () => {
  it("shows the platinum frame only on a platinum game cover", () => {
    const view = render(<GamePage assets={{}} game={makeGame({ status: "platinum" })} mode="game" notes={[]} onSave={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Изменить обложку" })).toHaveClass("cover--platinum");
    expect(screen.getByText("Платина")).toBeInTheDocument();

    view.rerender(<GamePage assets={{}} game={makeGame({ status: "completed" })} mode="game" notes={[]} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Изменить обложку" })).not.toHaveClass("cover--platinum");
    expect(screen.getByText("Пройдено")).toBeInTheDocument();
  });

  it("blocks growing actions without rendering a separate storage notification", () => {
    render(
      <GamePage
        assets={{}}
        mode="new"
        notes={[]}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        storageLocked
      />,
    );

    expect(screen.queryByText(/Хранилище Safari заполнено/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить заметку" })).toBeDisabled();
  });

  it("guards the shared header navigation while a draft is unsaved", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <AppShell onNavigate={onNavigate} onOpenDiff={vi.fn()} route="new" storage={{ bytes: 0, operationCount: 0 }}>
        <GamePage assets={{}} mode="new" notes={[]} onCancel={vi.fn()} onSave={vi.fn()} />
      </AppShell>,
    );

    await user.type(screen.getByRole("textbox", { name: "Название *" }), "DuckTales");
    await user.click(screen.getByRole("link", { name: "Каталог" }));
    expect(confirm).toHaveBeenCalledWith("Уйти без сохранения? Черновик будет потерян.");
    expect(onNavigate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("link", { name: "Каталог" }));
    expect(onNavigate).toHaveBeenCalledWith("#/games");
  });

  it("restores the current hash when Safari Back is cancelled", async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 40 }, "", "#/games");
    window.history.pushState({ idx: 41 }, "", "#/games/new");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GamePage assets={{}} mode="new" notes={[]} onCancel={vi.fn()} onSave={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Название *" }), "DuckTales");
    window.history.back();

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("Уйти без сохранения? Черновик будет потерян."));
    await waitFor(() => expect(window.location.hash).toBe("#/games/new"));
    expect(window.history.state.idx).toBe(41);
  });

  it("keeps the game page minimal and opens a note editor inside its card", async () => {
    const user = userEvent.setup();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Старая заметка",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(
      <GamePage
        assets={{}}
        game={makeGame()}
        mode="game"
        notes={[note]}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Отзыв" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Заметки" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "К каталогу" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Редактировать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Редактировать заметку" })).not.toBeInTheDocument();
    const layout = document.querySelector(".game-view-layout");
    const sidebar = screen.getByRole("complementary", { name: "DuckTales" });
    const notesSection = screen.getByRole("region", { name: "Заметки" });
    expect(layout).not.toBeNull();
    expect(sidebar).toHaveClass("game-sidebar");
    expect(layout).toContainElement(sidebar);
    expect(layout).toHaveProperty("childElementCount", 2);
    expect(layout!.firstElementChild).toBe(sidebar);
    expect(sidebar.querySelector(".game-sidebar__cover")).toBeInTheDocument();
    expect(within(sidebar).getByRole("heading", { level: 1, name: "DuckTales" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "DuckTales" })).toHaveTextContent("DuckTales");
    expect(within(sidebar).getByText("Играю")).toBeInTheDocument();
    expect(sidebar.querySelector("dl.game-sidebar__meta")).toHaveTextContent("ТирA");
    expect(sidebar.querySelector("dl.game-sidebar__meta")).toHaveTextContent("ПлатформыNES");
    expect(sidebar.querySelector("dl.game-sidebar__meta")).toHaveTextContent("platformer");
    expect(sidebar.querySelector("dl.game-sidebar__meta")).not.toHaveTextContent("#platformer");
    expect(sidebar.querySelector("dl.game-sidebar__meta")).toHaveTextContent("Изменено");
    const shortMetadata = sidebar.querySelectorAll(".game-sidebar__meta-short");
    expect(shortMetadata).toHaveLength(2);
    expect(shortMetadata[0]).toHaveTextContent("СтатусИграю");
    expect(shortMetadata[1]).toHaveTextContent("ТирA");
    expect(notesSection).toHaveClass("game-notes");
    expect(layout).toContainElement(notesSection);
    expect(sidebar.nextElementSibling).toBe(notesSection);
    expect(notesSection.querySelector(":scope > header")).not.toBeInTheDocument();
    const cards = notesSection.querySelectorAll(".note-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("Хорошая игра")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText("Старая заметка")).toBeInTheDocument();
    expect(notesSection.querySelector(".note-card__number")).not.toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).queryByText(/^Изменено/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Переместить заметку выше" })).not.toBeInTheDocument();

    await user.click(cards[0] as HTMLElement);
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    expect(editor.closest("article")).toBe(notesSection.querySelectorAll(".note-card")[0]);
    expect(editor).toHaveValue("Хорошая игра");
    expect(document.querySelector(".markdown-editor__toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Предпросмотр" })).not.toBeInTheDocument();
    expect((cards[0] as HTMLElement).querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Переместить заметку выше" })).toBeInTheDocument();

    await user.type(editor, " — черновик");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(cards[1] as HTMLElement);
    expect(confirm).toHaveBeenCalledWith("Отменить несохранённые изменения заметки?");
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("Хорошая игра — черновик");
    await user.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    const restoredCard = notesSection.querySelectorAll(".note-card")[0] as HTMLElement;
    expect(within(restoredCard).getByText("Хорошая игра")).toBeInTheDocument();
    restoredCard.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("Хорошая игра");
  });

  it("uses Safari-safe sensors and calculates note drops against rank order", () => {
    const editableNotes: EditableNote[] = [
      { clientId: NOTE_ID, bodyMarkdown: "A", attachments: [], rank: 1024 },
      { clientId: NOTE_TWO_ID, bodyMarkdown: "B", attachments: [], rank: 2048 },
      { clientId: NOTE_THREE_ID, bodyMarkdown: "C", attachments: [], rank: 3072 },
    ];

    expect(getNoteDropIndex(editableNotes, NOTE_ID, NOTE_THREE_ID)).toBe(2);
    expect(getNoteDropIndex(editableNotes, NOTE_THREE_ID, NOTE_ID)).toBe(0);
    expect(getNoteDropIndex(editableNotes, NOTE_TWO_ID, NOTE_THREE_ID)).toBe(2);
    expect(getNoteDropIndex(editableNotes, NOTE_TWO_ID, NOTE_ID)).toBe(0);
    expect(getNoteDropIndex(editableNotes, NOTE_ID, NOTE_ID)).toBeNull();
    expect(getNoteDropIndex(editableNotes, NOTE_ID, "missing")).toBeNull();
    expect(NOTE_LIST_SENSOR_TYPES).toEqual({ pointer: NonTouchNotePointerSensor, touch: TouchSensor, keyboard: KeyboardSensor });
    expect(NonTouchNotePointerSensor.prototype).toBeInstanceOf(PointerSensor);
    expect(NOTE_LIST_SENSOR_OPTIONS.pointer).toEqual({ activationConstraint: { distance: 8 } });
    expect(NOTE_LIST_SENSOR_OPTIONS.touch).toEqual({ activationConstraint: { delay: 180, tolerance: 8 } });
    expect(NOTE_LIST_SENSOR_OPTIONS.keyboard.coordinateGetter).toBe(sortableKeyboardCoordinates);
    expect(NOTE_LIST_SENSOR_OPTIONS.keyboard.keyboardCodes).toEqual({
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    });
    expect(NOTE_LIST_SORTING_STRATEGY({} as never)).toBeNull();
  });

  it("reorders masonry notes with the whole card and does not open the editor after drop", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const notes: Note[] = [
      { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "", attachments: [{ type: "link", url: "https://example.com/a", label: "A" }], rank: 1024, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_TWO_ID, gameId: DUCK_ID, bodyMarkdown: "B", attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_THREE_ID, gameId: DUCK_ID, bodyMarkdown: "C", attachments: [], rank: 3072, createdAt: NOW, updatedAt: NOW },
    ];
    const rects = new Map([
      [NOTE_ID, domRect(0, 100, 360, 100)],
      [NOTE_TWO_ID, domRect(367, 100, 360, 220)],
      [NOTE_THREE_ID, domRect(0, 207, 360, 90)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".notes-list")) return domRect(0, 100, 727, 500);
      if (this.matches(".note-drag-preview")) return domRect(0, 0, 360, 100);
      if (this.dataset.noteId) return rects.get(this.dataset.noteId) ?? domRect(0, 0, 360, 100);
      if (this.matches(".note-card__content")) return domRect(0, 0, 360, 80);
      return domRect(0, 0, 1024, 768);
    });

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={notes} onSave={onSave} />);
    const first = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const firstLink = within(first).getByRole("link", { name: "A" });

    await user.pointer([{ keys: "[MouseLeft>]", target: firstLink, coords: { clientX: 20, clientY: 120 } }]);
    expect(first).not.toHaveClass("is-dragging");
    await user.pointer([{ target: firstLink, coords: { clientX: 40, clientY: 120 } }]);
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    await user.pointer([{ target: firstLink, coords: { clientX: 40, clientY: 240 } }]);
    await user.pointer([{ keys: "[/MouseLeft]", target: firstLink, coords: { clientX: 40, clientY: 240 } }]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedNotes = [...onSave.mock.calls[0][0].notes].sort((a, b) => a.rank - b.rank);
    expect(savedNotes.map((note) => note.clientId)).toEqual([NOTE_TWO_ID, NOTE_THREE_ID, NOTE_ID]);
    expect(savedNotes.at(-1)?.rank).toBe(4096);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("reorders a YouTube-only note from its dedicated drag handle", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const notes: Note[] = [
      { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "", attachments: [{ type: "link", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", label: "YouTube" }], rank: 1024, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_TWO_ID, gameId: DUCK_ID, bodyMarkdown: "B", attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_THREE_ID, gameId: DUCK_ID, bodyMarkdown: "C", attachments: [], rank: 3072, createdAt: NOW, updatedAt: NOW },
    ];
    const rects = new Map([
      [NOTE_ID, domRect(0, 100, 360, 230)],
      [NOTE_TWO_ID, domRect(367, 100, 360, 100)],
      [NOTE_THREE_ID, domRect(367, 207, 360, 100)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".notes-list")) return domRect(0, 100, 727, 500);
      if (this.matches(".note-drag-preview")) return domRect(0, 0, 360, 100);
      if (this.dataset.noteId) return rects.get(this.dataset.noteId) ?? domRect(0, 0, 360, 100);
      if (this.matches(".note-card__content")) return domRect(0, 0, 360, 203);
      return domRect(0, 0, 1024, 768);
    });

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={notes} onSave={onSave} />);
    const first = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const handle = within(first).getByRole("button", { name: "Перетащить заметку" });
    expect(first).toHaveClass("note-card--media-only");
    expect(first).not.toHaveAttribute("tabindex");
    expect(screen.getByTitle("Видео YouTube")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1");

    await user.pointer([{ keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 315 } }]);
    expect(first).not.toHaveClass("is-dragging");
    await user.pointer([{ target: handle, coords: { clientX: 40, clientY: 315 } }]);
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    await user.pointer([{ target: handle, coords: { clientX: 400, clientY: 260 } }]);
    await user.pointer([{ keys: "[/MouseLeft]", target: handle, coords: { clientX: 400, clientY: 260 } }]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect([...onSave.mock.calls[0][0].notes].sort((a, b) => a.rank - b.rank).map((note) => note.clientId)).toEqual([NOTE_TWO_ID, NOTE_THREE_ID, NOTE_ID]);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("supports keyboard sorting from a media-only note handle", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const notes: Note[] = [
      { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "", attachments: [{ type: "link", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", label: "YouTube" }], rank: 1024, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_TWO_ID, gameId: DUCK_ID, bodyMarkdown: "B", attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_THREE_ID, gameId: DUCK_ID, bodyMarkdown: "C", attachments: [], rank: 3072, createdAt: NOW, updatedAt: NOW },
    ];
    const rects = new Map([
      [NOTE_ID, domRect(0, 100, 360, 230)],
      [NOTE_TWO_ID, domRect(367, 100, 360, 100)],
      [NOTE_THREE_ID, domRect(734, 100, 360, 100)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".notes-list")) return domRect(0, 100, 1094, 240);
      if (this.matches(".note-drag-preview")) return domRect(0, 0, 360, 100);
      if (this.dataset.noteId) return rects.get(this.dataset.noteId) ?? domRect(0, 0, 360, 100);
      if (this.matches(".note-card__content")) return domRect(0, 0, 360, 203);
      return domRect(0, 0, 1024, 768);
    });

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={notes} onSave={onSave} />);
    const handle = within(document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!).getByRole("button", { name: "Перетащить заметку" });
    handle.focus();
    await user.keyboard("[Space]");
    await waitFor(() => expect(handle.closest("article")).toHaveClass("is-dragging"));
    await user.keyboard("[ArrowRight]");
    await user.keyboard("[Enter]");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect([...onSave.mock.calls[0][0].notes].sort((a, b) => a.rank - b.rank).map((note) => note.clientId)).toEqual([NOTE_TWO_ID, NOTE_ID, NOTE_THREE_ID]);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("does not start note dragging from an interactive task checkbox", async () => {
    const user = userEvent.setup();
    const note: Note = { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "- [ ] Найти секрет", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.dataset.noteId) return domRect(0, 100, 360, 100);
      if (this.matches(".note-card__content")) return domRect(0, 0, 360, 80);
      return domRect(0, 0, 360, 120);
    });

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const checkbox = screen.getByRole("checkbox", { name: "Отметить: Найти секрет" });

    await user.pointer([{ keys: "[MouseLeft>]", target: checkbox, coords: { clientX: 20, clientY: 120 } }]);
    await user.pointer([{ target: checkbox, coords: { clientX: 50, clientY: 120 } }]);
    expect(card).not.toHaveClass("is-dragging");
    await user.pointer([{ keys: "[/MouseLeft]", target: checkbox, coords: { clientX: 50, clientY: 120 } }]);
  });

  it("supports keyboard note sorting while keeping Enter for inline editing", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const notes: Note[] = [
      { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "A", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_TWO_ID, gameId: DUCK_ID, bodyMarkdown: "B", attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_THREE_ID, gameId: DUCK_ID, bodyMarkdown: "C", attachments: [], rank: 3072, createdAt: NOW, updatedAt: NOW },
    ];
    const rects = new Map([
      [NOTE_ID, domRect(0, 100, 360, 100)],
      [NOTE_TWO_ID, domRect(367, 100, 360, 100)],
      [NOTE_THREE_ID, domRect(734, 100, 360, 100)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".notes-list")) return domRect(0, 100, 1094, 120);
      if (this.matches(".note-drag-preview")) return domRect(0, 0, 360, 100);
      if (this.dataset.noteId) return rects.get(this.dataset.noteId) ?? domRect(0, 0, 360, 100);
      if (this.matches(".note-card__content")) return domRect(0, 0, 360, 80);
      return domRect(0, 0, 1024, 768);
    });

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={notes} onSave={onSave} />);
    const first = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    first.focus();

    await user.keyboard("[Space]");
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    await user.keyboard("[ArrowRight]");
    await user.keyboard("[Enter]");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect([...onSave.mock.calls[0][0].notes].sort((a, b) => a.rank - b.rank).map((note) => note.clientId)).toEqual([NOTE_TWO_ID, NOTE_ID, NOTE_THREE_ID]);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
  });

  it("reserves note image geometry before Safari finishes lazy decoding", () => {
    const assetId = "a".repeat(64);
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "",
      attachments: [{ type: "image", assetId, alt: "Карта уровня" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(
      <GamePage
        assets={{ [assetId]: { id: assetId, mime: "image/webp", width: 1280, height: 720, base64: "AAAA", alt: "Карта уровня", originalName: "map.png" } }}
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[note]}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Карта уровня" })).toHaveAttribute("width", "1280");
    expect(screen.getByRole("img", { name: "Карта уровня" })).toHaveAttribute("height", "720");
  });

  it("opens YouTube upload and attaches one canonical video to the note draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Видео прохождения",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(
      <GamePage
        assets={{}}
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[note]}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText("Видео прохождения").closest("article")!);
    const upload = screen.getByRole("link", { name: "Загрузить видео на YouTube" });
    expect(upload).toHaveAttribute("href", "https://www.youtube.com/upload");
    expect(upload).toHaveAttribute("target", "_blank");
    expect(upload).toHaveAttribute("rel", expect.stringContaining("noopener"));

    await user.click(upload);
    const input = screen.getByRole("textbox", { name: "Ссылка на YouTube" });
    expect(input).toHaveFocus();
    await user.type(input, "https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Некорректная ссылка YouTube");
    expect(input).toHaveValue("https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ");
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "https://youtu.be/dQw4w9WgXcQ?t=42");
    await user.click(screen.getByRole("button", { name: "Прикрепить видео YouTube" }));
    expect(screen.getByTitle("Видео YouTube")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1",
    );

    await user.click(upload);
    const duplicateInput = screen.getByRole("textbox", { name: "Ссылка на YouTube" });
    await user.type(duplicateInput, "https://www.youtube.com/watch?v=dQw4w9WgXcQ{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Видео уже прикреплено");
    expect(screen.getAllByTitle("Видео YouTube")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Закрыть поле ссылки YouTube" }));
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes).toEqual([
      expect.objectContaining({
        id: NOTE_ID,
        attachments: [{
          type: "link",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          label: "YouTube",
        }],
      }),
    ]);
  });

  it("renders YouTube links as removable privacy-enhanced videos and keeps ordinary links", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Ссылки",
      attachments: [
        { type: "link", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", label: "YouTube" },
        { type: "link", url: "./files/map.pdf", label: "Карта" },
      ],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(
      <GamePage
        assets={{}}
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[note]}
        onSave={onSave}
      />,
    );

    const iframe = screen.getByTitle("Видео YouTube");
    expect(iframe).toHaveAttribute("loading", "lazy");
    expect(iframe).toHaveAttribute("allowfullscreen");
    expect(iframe.getAttribute("src")).not.toContain("autoplay");
    expect(screen.getByRole("link", { name: "Карта" })).toHaveAttribute("href", "./files/map.pdf");

    await user.click(screen.getByText("Ссылки").closest("article")!);
    await user.click(screen.getByRole("button", { name: "Удалить видео YouTube" }));
    expect(screen.queryByTitle("Видео YouTube")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Карта" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].attachments).toEqual([
      { type: "link", url: "./files/map.pdf", label: "Карта" },
    ]);
  });

  it("edits a YouTube-only note from its media footer without changing the embed", async () => {
    const user = userEvent.setup();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "",
      attachments: [{ type: "link", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", label: "YouTube" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    const iframe = screen.getByTitle("Видео YouTube");
    const card = iframe.closest("article")!;
    expect(card).toHaveClass("note-card--media-only");
    expect(within(card).getByRole("button", { name: "Перетащить заметку" })).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("");
    expect(screen.getByTitle("Видео YouTube")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1");
  });

  it("opens compact attachment actions and adds multiple images and files through mounted inputs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Материалы",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    vi.mocked(optimizeNoteImage).mockResolvedValue({
      asset: { id: "a".repeat(64), mime: "image/webp", width: 20, height: 10, base64: "V0VCUA==", alt: "Карта", originalName: "map.png" },
      blob: new Blob(["webp"], { type: "image/webp" }),
      byteLength: 4,
    });

    const view = render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={onSave} />);
    await user.click(screen.getByText("Материалы").closest("article")!);

    const imageInput = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать изображения"]')!;
    const fileInput = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать файлы"]')!;
    expect(imageInput).toHaveAttribute("multiple");
    expect(fileInput).toHaveAttribute("multiple");
    expect(imageInput).not.toBeVisible();
    expect(fileInput).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Добавить вложение" }));
    expect(screen.getByRole("button", { name: "Изображение" })).toHaveFocus();
    const imageClick = vi.spyOn(imageInput, "click").mockImplementation(() => undefined);
    const fileClick = vi.spyOn(fileInput, "click").mockImplementation(() => undefined);
    await user.click(screen.getByRole("button", { name: "Изображение" }));
    expect(imageClick).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Файл" }));
    expect(fileClick).toHaveBeenCalledTimes(1);
    imageClick.mockRestore();
    fileClick.mockRestore();

    const images = [
      new File(["one"], "map.png", { type: "image/png" }),
      new File(["two"], "boss.png", { type: "image/png" }),
    ];
    fireEvent.change(imageInput, { target: { files: images } });
    await waitFor(() => expect(optimizeNoteImage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("img", { name: "map" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: "boss" })).toBeInTheDocument();

    const files = [
      new File(["guide"], "guide.pdf", { type: "application/pdf" }),
      new File(["save"], "save.dat", { type: "application/octet-stream" }),
    ];
    fireEvent.change(fileInput, { target: { files } });
    const guide = await screen.findByRole("link", { name: /guide\.pdf/ });
    const save = screen.getByRole("link", { name: /save\.dat/ });
    expect(guide).toHaveAttribute("download", "guide.pdf");
    expect(guide).not.toHaveAttribute("target");
    expect(save).toHaveTextContent("4 Б");

    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].attachments).toEqual([
      expect.objectContaining({ type: "pending-image" }),
      expect.objectContaining({ type: "pending-image" }),
      expect.objectContaining({ type: "pending-file", label: "guide.pdf", file: expect.objectContaining({ mime: "application/pdf", originalName: "guide.pdf", byteLength: 5 }) }),
      expect.objectContaining({ type: "pending-file", label: "save.dat", file: expect.objectContaining({ mime: "application/octet-stream", originalName: "save.dat", byteLength: 4 }) }),
    ]);
  });

  it("preflights the optimized image size even when Safari leaves its MIME empty", async () => {
    const user = userEvent.setup();
    const canAddBlob = vi.fn(() => "Изображение не помещается в локальное хранилище Safari");
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Материалы",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    vi.mocked(optimizeNoteImage).mockResolvedValue({
      asset: { id: "a".repeat(64), mime: "image/webp", width: 20, height: 10, base64: "V0VCUA==", alt: "Карта", originalName: "map.webp" },
      blob: new Blob(["webp"], { type: "image/webp" }),
      byteLength: 4,
    });
    const view = render(<GamePage assets={{}} canAddBlob={canAddBlob} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    await user.click(screen.getByText("Материалы").closest("article")!);
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать изображения"]')!;
    const file = new File(["source"], "map.webp", { type: "" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Изображение не помещается в локальное хранилище Safari");
    expect(optimizeNoteImage).toHaveBeenCalledWith(file, "map");
    expect(canAddBlob).toHaveBeenCalledWith(4);
    expect(screen.queryByRole("img", { name: "map" })).not.toBeInTheDocument();
  });

  it("includes existing pending attachments when preflighting a later file", async () => {
    const user = userEvent.setup();
    const canAddBlob = vi.fn((byteLength: number) => byteLength > 5 ? "Файл не помещается в localStorage Safari" : null);
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Материалы",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const view = render(<GamePage assets={{}} canAddBlob={canAddBlob} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    await user.click(screen.getByText("Материалы").closest("article")!);
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать файлы"]')!;

    fireEvent.change(input, { target: { files: [new File(["1234"], "first.dat")] } });
    expect(await screen.findByRole("link", { name: /first\.dat/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(["12"], "second.dat")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Файл не помещается в localStorage Safari");
    expect(canAddBlob.mock.calls.map(([byteLength]) => byteLength)).toEqual([4, 6]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /second\.dat/ })).not.toBeInTheDocument();
  });

  it("rejects a file before reading it when the Safari patch budget cannot fit it", async () => {
    const user = userEvent.setup();
    const canAddBlob = vi.fn(() => "Файл не помещается в localStorage Safari");
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Материалы",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const view = render(<GamePage assets={{}} canAddBlob={canAddBlob} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    await user.click(screen.getByText("Материалы").closest("article")!);
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать файлы"]')!;
    fireEvent.change(input, { target: { files: [new File(["oversized"], "video.mov", { type: "video/quicktime" })] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Файл не помещается в localStorage Safari");
    expect(canAddBlob).toHaveBeenCalledWith(9);
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /video\.mov/ })).not.toBeInTheDocument();
  });

  it("renders published files as compact downloads through the asset resolver", () => {
    const assetId = "f".repeat(64);
    const asset = {
      id: assetId,
      kind: "file",
      mime: "application/pdf",
      byteLength: 2048,
      originalName: "map.pdf",
    } as Asset;
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Карта",
      attachments: [{ type: "file", assetId, label: "Карта мира" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const resolveAssetUrl = vi.fn(() => "/mylib/media/file.bin");

    render(<GamePage assets={{ [assetId]: asset }} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={resolveAssetUrl} />);

    const link = screen.getByRole("link", { name: /Карта мира/ });
    expect(link).toHaveAttribute("href", "/mylib/media/file.bin");
    expect(link).toHaveAttribute("download", "Карта мира");
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveTextContent("2 КБ");
    expect(resolveAssetUrl).toHaveBeenCalledWith(assetId);
  });

  it("creates a game with multiple platforms and Markdown-only notes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();

    render(
      <GamePage
        assets={{}}
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
    expect(screen.queryByText("Коллекции")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Отзыв" })).not.toBeInTheDocument();
    expect(screen.queryByText("Все изменения останутся локальными, пока вы не опубликуете патч.")).not.toBeInTheDocument();
    const notesEditor = screen.getByRole("region", { name: "Заметки" });
    expect(notesEditor).not.toHaveClass("form-card");
    expect(screen.queryByRole("heading", { name: "Заметки" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Добавить заметку" }));
    const noteEditor = within(notesEditor).getByRole("textbox", { name: "Текст заметки" });
    await user.type(noteEditor, "Секреты [[гайд](https://example.com/ducktales)");
    expect(within(notesEditor).queryByRole("button", { name: "Предпросмотр" })).not.toBeInTheDocument();
    expect(within(notesEditor).queryByRole("button", { name: "Ссылка" })).not.toBeInTheDocument();
    expect(notesEditor.querySelectorAll('input[type="file"][hidden]')).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "DuckTales",
      platforms: ["NES", "Switch"],
      reviewMarkdown: "",
      notes: [expect.objectContaining({
        bodyMarkdown: "Секреты [гайд](https://example.com/ducktales)",
        rank: 1024,
        attachments: [],
      })],
    }));
  });

  it("edits game metadata in place without entering a page-wide edit mode", async () => {
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
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[note]}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "Название" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "DuckTales" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Название" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DuckTales" })).toHaveTextContent("DuckTales");

    await user.click(screen.getByRole("button", { name: "DuckTales" }));
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "DuckTales Remastered");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(DUCK_ID);
    expect(saved.title).toBe("DuckTales Remastered");
    expect(saved.platforms).toEqual(["NES"]);
    expect(saved.reviewMarkdown).toBe("");
    expect(saved.notes).toEqual([expect.objectContaining({
      id: NOTE_ID,
      clientId: NOTE_ID,
      bodyMarkdown: "Старая заметка",
      attachments: [{ type: "link", url: "./files/map.pdf", label: "Карта" }],
      rank: 1024,
    })]);
    expect(screen.queryByRole("textbox", { name: "Название" })).not.toBeInTheDocument();
  });

  it("offers existing platforms and tags while editing them in place", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();

    render(
      <GamePage
        assets={{}}
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[]}
        onSave={onSave}
        platformSuggestions={["NES", "Switch", "PlayStation 5"]}
        tagSuggestions={["platformer", "mario", "metroidvania"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Платформы" }));
    const platformInput = screen.getByRole("combobox", { name: "Платформы" });
    const platformList = document.getElementById(platformInput.getAttribute("list") ?? "");
    expect(platformInput).toHaveFocus();
    expect(Array.from(platformList?.querySelectorAll("option") ?? []).map((option) => option.value)).toEqual(["Switch", "PlayStation 5"]);
    await user.type(platformInput, "switch{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].platforms).toEqual(["NES", "Switch"]);

    await user.click(screen.getByRole("button", { name: "Теги" }));
    const tagInput = screen.getByRole("combobox", { name: "Теги" });
    const tagList = document.getElementById(tagInput.getAttribute("list") ?? "");
    const existingTag = tagInput.closest(".tag-input")?.querySelector(".tag-chip");
    expect(tagInput).toHaveFocus();
    expect(existingTag).toHaveTextContent("platformer");
    expect(existingTag).not.toHaveTextContent("#platformer");
    expect(Array.from(tagList?.querySelectorAll("option") ?? []).map((option) => option.value)).toEqual(["mario", "metroidvania"]);
    await user.type(tagInput, "MARIO{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].tags).toEqual(["platformer", "mario"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Теги" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Теги" })).toBeInTheDocument();
  });

  it("edits a note in place and preserves its stable id and attachments", async () => {
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

    const view = render(
      <GamePage
        assets={{}}
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[note]}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText("Старая заметка").closest("article")!);
    const noteText = screen.getByRole("textbox", { name: "Текст заметки" });
    await user.clear(noteText);
    await user.type(noteText, "Обновлённая заметка");
    view.rerender(
      <GamePage
        assets={{}}
        game={makeGame({ reviewMarkdown: "", updatedAt: "2026-07-16T11:00:00.000Z" })}
        mode="game"
        notes={[note]}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("Обновлённая заметка");
    expect(screen.queryByRole("button", { name: "Ссылка" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Предпросмотр" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.id).toBe(DUCK_ID);
    expect(saved.reviewMarkdown).toBe("");
    expect(saved.notes).toEqual([expect.objectContaining({
      id: NOTE_ID,
      clientId: NOTE_ID,
      bodyMarkdown: "Обновлённая заметка",
      attachments: [{ type: "link", url: "./files/map.pdf", label: "Карта" }],
      rank: 1024,
    })]);
  });

  it("does not resurrect a cancelled note after pasted image processing finishes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Старая заметка",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    let finishImage!: (image: Awaited<ReturnType<typeof optimizeNoteImage>>) => void;
    vi.mocked(optimizeNoteImage).mockReturnValueOnce(new Promise((resolve) => { finishImage = resolve; }));
    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={onSave} />);

    await user.click(screen.getByText("Старая заметка").closest("article")!);
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const file = new File(["image"], "secret.png", { type: "image/png" });
    const clipboardData = {
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
      types: ["Files"],
    } as unknown as DataTransfer;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboardData });
    fireEvent(editor, paste);

    await waitFor(() => expect(optimizeNoteImage).toHaveBeenCalledWith(file, "secret"));
    expect(editor.closest("article")).toHaveAttribute("aria-busy", "true");
    await user.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    finishImage({
      asset: { id: "a".repeat(64), mime: "image/webp", width: 20, height: 10, base64: "V0VCUA==", alt: "secret", originalName: "secret.png" },
      blob: new Blob(["webp"], { type: "image/webp" }),
      byteLength: 4,
    });

    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument());
    expect(screen.getByText("Старая заметка")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("moves a legacy review into the ordinary note list only once", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Старая заметка",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(
      <GamePage
        assets={{}}
        game={makeGame()}
        mode="game"
        notes={[note]}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByText("Хорошая игра").closest("article")!);
    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved.reviewMarkdown).toBe("");
    expect(saved.notes).toEqual([
      {
        clientId: `legacy-review:${DUCK_ID}`,
        bodyMarkdown: "Хорошая игра",
        attachments: [],
        rank: 512,
      },
      expect.objectContaining({
        id: NOTE_ID,
        clientId: NOTE_ID,
        bodyMarkdown: "Старая заметка",
        rank: 1024,
      }),
    ]);
  });

  it("shows a failed game deletion in the existing inline error area", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("Safari отклонил удаление"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <GamePage
        assets={{}}
        game={makeGame({ reviewMarkdown: "" })}
        mode="game"
        notes={[]}
        onDelete={onDelete}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Удалить игру" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Safari отклонил удаление"));
    expect(onDelete).toHaveBeenCalledWith(DUCK_ID);
  });
});

describe("DiffDialog", () => {
  const item = { id: "title-op", group: "changed" as const, title: "DuckTales: название" };

  it("shows a real action error on demand without local-only or storage diagnostics", async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();

    render(
      <DiffDialog
        error="Safari отклонил запись"
        items={[]}
        onClose={vi.fn()}
        onDismissError={onDismissError}
        onExport={vi.fn()}
        onImport={vi.fn()}
        open
        patchBytes={0}
        payload=""
        publishCommand="npm run publish:clipboard"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Safari отклонил запись");
    expect(screen.queryByText("Только на этом устройстве")).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage API/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Скрыть" }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("blocks publication for conflicts and forwards conflict and undo actions", async () => {
    const user = userEvent.setup();
    const onResolveConflict = vi.fn();
    const onUndoItem = vi.fn();
    const onUndoGroup = vi.fn();
    const onClearAll = vi.fn();
    const copyPatch = vi.fn().mockResolvedValue(true);

    render(
      <DiffDialog
        conflicts={[{
          id: "title-conflict",
          path: `/games/${DUCK_ID}/title`,
          label: "Название DuckTales",
          staticValue: "DuckTales Remastered",
          localValue: "DuckTales Local",
        }]}
        copyPatch={copyPatch}
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
        payload="payload"
        publishCommand="npm run publish:clipboard"
      />,
    );

    expect(screen.getByRole("button", { name: "Скопировать патч" })).toBeDisabled();
    expect(screen.getByText("Сначала разрешите все конфликты.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Оставить локальное" }));
    expect(onResolveConflict).toHaveBeenCalledWith("title-conflict", "local");
    await user.click(screen.getByRole("button", { name: `Отменить: ${item.title}` }));
    expect(onUndoItem).toHaveBeenCalledWith(item.id);
    await user.click(screen.getByRole("button", { name: "Отменить группу" }));
    expect(onUndoGroup).toHaveBeenCalledWith("changed");
    await user.click(screen.getByRole("button", { name: "Отменить все правки" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(copyPatch).not.toHaveBeenCalled();
  });

  it("shows a manual Safari fallback when clipboard copying is rejected", async () => {
    const user = userEvent.setup();
    const payload = "H4sIAAAAAAAA";
    const copyPatch = vi.fn().mockResolvedValue(false);

    render(
      <DiffDialog
        copyPatch={copyPatch}
        items={[item]}
        onClose={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        open
        patchBytes={1024}
        payload={payload}
        publishCommand="npm run publish:clipboard"
      />,
    );

    expect(screen.getByText("npm run publish:clipboard")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Скопировать патч" }));
    const fallback = await screen.findByLabelText(/Safari не разрешил доступ к буферу/);
    expect(fallback).toHaveValue(payload);
    expect(copyPatch).toHaveBeenCalledTimes(1);
  });
});

describe("TierListPage", () => {
  it("gives every minimal tier row an accessible name", () => {
    render(<TierListPage assets={{}} games={[makeGame()]} onMoveGame={vi.fn()} />);

    expect(screen.getByRole("region", { name: "S" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Без оценки" })).toBeInTheDocument();
  });

  it("uses the whole cover-only tile as the drag activator", () => {
    render(<TierListPage assets={{}} games={[makeGame()]} onMoveGame={vi.fn()} />);

    const cover = screen.getByRole("link", { name: /DuckTales, статус: Играю.*пробел — перетащить/ });
    const card = cover.closest("article");
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute("role");
    expect(card).toHaveAttribute("title", "DuckTales");
    expect(cover).toHaveAttribute("title", "DuckTales");
    expect(cover).toHaveAttribute("tabindex", "0");
    expect(card?.querySelector(".game-card__cover")).toBeInTheDocument();
    expect(card?.querySelector(".game-card__body")).not.toBeInTheDocument();
    expect(card?.querySelector(".game-card__drag")).not.toBeInTheDocument();
    expect(card?.querySelector(".game-card__keyboard-drag")).not.toBeInTheDocument();
    expect(card?.querySelector(".game-card__move")).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect(card?.querySelector(".status-dot")).not.toBeInTheDocument();
    expect(card?.textContent).toBe("");
    expect(screen.queryByLabelText("1 игр")).not.toBeInTheDocument();
  });

  it("marks platinum cover-only cards with a platinum frame and an accessible status", () => {
    render(<TierListPage assets={{}} games={[makeGame({ status: "platinum" })]} onMoveGame={vi.fn()} />);

    const cover = screen.getByRole("link", { name: /DuckTales, статус: Платина.*пробел — перетащить/ });
    const card = cover.closest("article");
    expect(cover).toHaveClass("cover--platinum");
    expect(card?.textContent).toBe("");
    expect(card?.querySelector(".status-dot")).not.toBeInTheDocument();
  });

  it("leaves completed cover-only cards without the platinum frame", () => {
    render(<TierListPage assets={{}} games={[makeGame({ status: "completed" })]} onMoveGame={vi.fn()} />);

    const cover = screen.getByRole("link", { name: /DuckTales, статус: Пройдено.*пробел — перетащить/ });
    expect(cover).not.toHaveClass("cover--platinum");
  });

  it("opens a game on a regular cover click", async () => {
    const user = userEvent.setup();
    const onOpenGame = vi.fn();
    render(<TierListPage assets={{}} games={[makeGame()]} onMoveGame={vi.fn()} onOpenGame={onOpenGame} />);

    await user.click(screen.getByRole("link", { name: /DuckTales, статус: Играю.*пробел — перетащить/ }));

    expect(onOpenGame).toHaveBeenCalledWith(DUCK_ID);
  });

  it("opens on Enter while reserving Space for keyboard dragging", async () => {
    const user = userEvent.setup();
    const onOpenGame = vi.fn();
    render(<TierListPage assets={{}} games={[makeGame()]} onMoveGame={vi.fn()} onOpenGame={onOpenGame} />);
    const cover = screen.getByRole("link", { name: /DuckTales, статус: Играю.*пробел — перетащить/ });

    cover.focus();
    await user.keyboard("[Enter]");

    expect(onOpenGame).toHaveBeenCalledWith(DUCK_ID);
  });

  it("wires pointer, touch, and keyboard sensors with deliberate activation constraints", () => {
    expect(TIER_LIST_SENSOR_TYPES).toEqual({
      pointer: NonTouchPointerSensor,
      touch: TouchSensor,
      keyboard: KeyboardSensor,
    });
    expect(NonTouchPointerSensor.prototype).toBeInstanceOf(PointerSensor);
    expect(TIER_LIST_SENSOR_OPTIONS.pointer).toEqual({ activationConstraint: { distance: 8 } });
    expect(TIER_LIST_SENSOR_OPTIONS.touch).toEqual({ activationConstraint: { delay: 180, tolerance: 8 } });
    expect(TIER_LIST_SENSOR_OPTIONS.keyboard.coordinateGetter).toBe(sortableKeyboardCoordinates);
    expect(TIER_LIST_SORTING_STRATEGY).toBe(rectSortingStrategy);
    expect(TIER_LIST_SENSOR_OPTIONS.keyboard.keyboardCodes).toEqual({
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    });
  });

  it("routes touch away from the pointer sensor so a quick swipe can scroll", () => {
    const onActivation = vi.fn();
    const handler = NonTouchPointerSensor.activators[0].handler;

    expect(handler({ nativeEvent: { pointerType: "touch", isPrimary: true, button: 0 } } as never, { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
    expect(handler({ nativeEvent: { pointerType: "pen", isPrimary: true, button: 0 } } as never, { onActivation })).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
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
        const title = this.getAttribute("title") ?? "";
        return domRect(cardLeft.get(title) ?? 0, 100, 120, 160);
      }
      if (this.matches(".tier-row__games")) return domRect(0, 100, 560, 180);
      return domRect(0, 0, 1024, 768);
    });

    render(<TierListPage assets={{}} games={games} onMoveGame={onMoveGame} />);
    const cover = screen.getByRole("link", { name: /DuckTales, статус: Играю.*пробел — перетащить/ });
    const card = cover.closest("article");
    cover.focus();

    await user.keyboard("[Space]");
    await waitFor(() => expect(card).toHaveClass("is-dragging"));
    await user.keyboard("[ArrowRight]");
    await user.keyboard("[Space]");

    await waitFor(() => {
      expect(onMoveGame).toHaveBeenCalledWith(DUCK_ID, { tierId: "a", index: 1 });
    });
  });

  it("supports a primary-pointer drag after the distance threshold", async () => {
    const user = userEvent.setup();
    const onMoveGame = vi.fn();
    const onOpenGame = vi.fn();
    const games = [
      makeGame({ placement: { tierId: "a", rank: 1024 } }),
      makeGame({ id: MARIO_ID, title: "Mario", placement: { tierId: "a", rank: 2048 } }),
      makeGame({ id: ZELDA_ID, title: "Zelda", placement: { tierId: "a", rank: 3072 } }),
    ];
    const cardLeft = new Map([["DuckTales", 0], ["Mario", 140], ["Zelda", 280]]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-card")) {
        const title = this.getAttribute("title") ?? "";
        return domRect(cardLeft.get(title) ?? 0, 100, 120, 160);
      }
      if (this.matches(".tier-row__games")) return domRect(0, 100, 560, 180);
      return domRect(0, 0, 1024, 768);
    });

    render(<TierListPage assets={{}} games={games} onMoveGame={onMoveGame} onOpenGame={onOpenGame} />);
    const cover = screen.getByRole("link", { name: /DuckTales, статус: Играю.*пробел — перетащить/ });
    const card = cover.closest("article");
    expect(card).not.toBeNull();

    await user.pointer([{ keys: "[MouseLeft>]", target: cover, coords: { clientX: 10, clientY: 120 } }]);
    expect(card).not.toHaveClass("is-dragging");
    await user.pointer([{ target: cover, coords: { clientX: 170, clientY: 120 } }]);
    await waitFor(() => expect(card).toHaveClass("is-dragging"));
    await user.pointer([{ target: cover, coords: { clientX: 180, clientY: 120 } }]);
    await user.pointer([{ keys: "[/MouseLeft]", target: cover, coords: { clientX: 180, clientY: 120 } }]);

    await waitFor(() => {
      expect(onMoveGame).toHaveBeenCalledWith(DUCK_ID, { tierId: "a", index: 1 });
    });
    expect(onOpenGame).not.toHaveBeenCalled();
  });

  it("moves a game into an empty tier row under the pointer", async () => {
    const user = userEvent.setup();
    const onMoveGame = vi.fn();
    const games = [makeGame({ placement: { tierId: "a", rank: 1024 } })];
    const tierTop: Record<string, number> = { s: 20, a: 100, b: 200, c: 300, d: 400, f: 500, unranked: 600 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const tierRow = this.closest(".tier-row");
      const tierId = tierRow?.className.match(/tier-row--(s|a|b|c|d|f|unranked)/)?.[1] ?? "s";
      if (this.matches(".game-card")) return domRect(0, tierTop[tierId], 120, 72);
      if (this.matches(".tier-row__games")) return domRect(0, tierTop[tierId], 560, 72);
      return domRect(0, 0, 1024, 768);
    });

    render(<TierListPage assets={{}} games={games} onMoveGame={onMoveGame} />);
    const cover = screen.getByRole("link", { name: /DuckTales, статус: Играю.*пробел — перетащить/ });
    const card = cover.closest("article");
    expect(card).not.toBeNull();
    const emptyTier = screen.getByRole("region", { name: "B" }).querySelector<HTMLElement>(".tier-row__games");
    expect(emptyTier).not.toBeNull();

    await user.pointer([{ keys: "[MouseLeft>]", target: cover, coords: { clientX: 10, clientY: 120 } }]);
    await user.pointer([{ target: cover, coords: { clientX: 20, clientY: 120 } }]);
    await waitFor(() => expect(card).toHaveClass("is-dragging"));
    await user.pointer([{ target: cover, coords: { clientX: 240, clientY: 220 } }]);
    await user.pointer([{ keys: "[/MouseLeft]", target: cover, coords: { clientX: 240, clientY: 220 } }]);

    await waitFor(() => {
      expect(onMoveGame).toHaveBeenCalledWith(DUCK_ID, { tierId: "b", index: 0 });
    });
    expect(screen.queryByRole("dialog", { name: "DuckTales" })).not.toBeInTheDocument();
  });
});
