import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardCode, KeyboardSensor, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { StrictMode, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffDialog } from "../src/components/DiffDialog";
import { AppShell } from "../src/components/AppShell";
import { GlobalGameSearch } from "../src/components/GlobalGameSearch";
import { optimizeNoteImage } from "../src/domain/assets";
import {
  createMarkdownDiff,
  type ChangeReviewModel,
  type ReviewChange,
} from "../src/domain";
import type { Asset, Game, Note } from "../src/domain/types";
import { CatalogPage } from "../src/pages/CatalogPage";
import {
  GamePage,
  getNoteDropIndex,
  NonTouchNotePointerSensor,
  noteKeyboardCoordinates,
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

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

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
const PROGRESS_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const PROGRESS_ITEM_TWO_ID = "88888888-8888-4888-8888-888888888888";
const PROGRESS_ITEM_THREE_ID = "99999999-9999-4999-8999-999999999999";
const PROGRESS_ICON_ID = "a".repeat(64);
const PROGRESS_ICON_TWO_ID = "b".repeat(64);
const PROGRESS_ICON_THREE_ID = "c".repeat(64);
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

    expect(screen.getByRole("button", { name: "Локальные правки: 3, 86 Б, хранилище требует внимания" })).toHaveClass("patch-pill--critical");
    expect(screen.queryByText("Осталось мало места")).not.toBeInTheDocument();
    expect(screen.queryByText("Правки живут только в этом Safari")).not.toBeInTheDocument();
  });

  it("keeps persistence errors in the header instead of adding another page block", () => {
    render(<AppShell onOpenDiff={vi.fn()} route="tiers" storage={{ bytes: 12, error: "Safari отклонил запись", operationCount: 2 }}><div>Тирлист</div></AppShell>);

    expect(screen.getByRole("button", { name: "Локальные правки: 2, 12 Б, ошибка: Safari отклонил запись" })).toHaveClass("patch-pill--error");
    expect(screen.getByRole("alert")).toHaveTextContent("Safari отклонил запись");
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

  it("omits duplicate search controls and always orders games by the latest change", async () => {
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
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(Array.from(document.querySelectorAll(".catalog-list .game-card__title")).map((node) => node.textContent)).toEqual(["Z game", "A game"]);
    expect(screen.queryByRole("region", { name: "Поиск и фильтры" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Активные фильтры" })).not.toBeInTheDocument();
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
  });

  it("keeps search stable when StrictMode replays state updaters", async () => {
    const user = userEvent.setup();
    const games = [makeGame()];
    window.location.hash = "#/games";
    render(<StrictMode><GlobalGameSearch games={games} /><CatalogPage assets={{}} games={games} /></StrictMode>);

    const search = screen.getByRole("searchbox", { name: "Глобальный поиск игр" });
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
      <><GlobalGameSearch games={games} /><CatalogPage assets={{}} games={games} /></>,
    );

    const search = screen.getByRole("searchbox", { name: "Глобальный поиск игр" });
    expect(search).toHaveValue("duck");
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    expect(screen.queryByText("Super Mario Odyssey")).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    expect(screen.queryByText("Super Mario Odyssey")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Фильтры/ }));
    expect(screen.getByRole("dialog", { name: "Фильтры каталога" })).toBeInTheDocument();
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
    const activeFilters = screen.getByRole("region", { name: "Активные фильтры" });
    expect(within(activeFilters).getByRole("button", { name: "Убрать фильтр: NES" })).toBeInTheDocument();
    expect(within(activeFilters).getByRole("button", { name: "Убрать фильтр: Switch" })).toBeInTheDocument();
    await user.click(within(activeFilters).getByRole("button", { name: "Убрать фильтр: #mario" }));
    expect(screen.getByText("DuckTales")).toBeInTheDocument();
    expect(screen.getByText("Super Mario Odyssey")).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).not.toContain("tag=mario"));
    expect(screen.queryByText("Коллекции")).not.toBeInTheDocument();
    expect(screen.queryByText("Коллекция")).not.toBeInTheDocument();
  });
});

describe("GamePage", () => {
  it("places the three-column progress grid after metadata and before delete tools", () => {
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon: Asset = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    };
    render(<GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={makeGame({
      progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }],
      reviewMarkdown: "",
    })} mode="game" notes={[progressNote]} onDelete={vi.fn()} onSave={vi.fn()} resolveAssetUrl={() => "/campaign.webp"} />);

    const sidebar = screen.getByRole("complementary", { name: "DuckTales" });
    const children = Array.from(sidebar.children);
    const cover = sidebar.querySelector(".game-sidebar__cover")!;
    const title = within(sidebar).getByRole("heading", { level: 1, name: "DuckTales" });
    const metadata = sidebar.querySelector(".game-sidebar__meta")!;
    const progress = sidebar.querySelector(".game-progress")!;
    const tools = sidebar.querySelector(".game-sidebar__tools")!;
    expect(children.indexOf(cover)).toBeLessThan(children.indexOf(title));
    expect(children.indexOf(title)).toBeLessThan(children.indexOf(metadata));
    expect(children.indexOf(metadata)).toBeLessThan(children.indexOf(progress));
    expect(children.indexOf(progress)).toBeLessThan(children.indexOf(tools));
    expect(progress.querySelector(".game-progress__grid")).toHaveClass("game-progress__grid");
    expect(screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" })).toHaveTextContent("1/2");
  });

  it("keeps an empty progress heading and add cell visible", () => {
    render(<GamePage assets={{}} game={makeGame({ progressItems: [] })} mode="game" notes={[]} onSave={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Прогресс" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeVisible();
  });

  it("restores the add cell even when a Safari-style click does not focus it implicitly", async () => {
    render(<GamePage assets={{}} game={makeGame({ progressItems: [] })} mode="game" notes={[]} onSave={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Добавить элемент прогресса" });

    fireEvent.click(add);
    expect(screen.getByRole("dialog", { name: "Элемент прогресса" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(add).toHaveFocus());
  });

  it("keeps existing progress viewable under storage lock while disabling image growth", async () => {
    const user = userEvent.setup();
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon: Asset = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    };
    render(<GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={makeGame({
      progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }],
    })} mode="game" notes={[progressNote]} onSave={vi.fn()} resolveAssetUrl={() => "/campaign.webp"} storageLocked />);

    expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeDisabled();
    const item = screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" });
    expect(item).toBeEnabled();
    await user.click(item);
    expect(screen.getByRole("dialog", { name: "Элемент прогресса" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Заметка" })).toHaveValue(NOTE_ID);
    expect(screen.getByLabelText("Выбрать файл")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Вставить" })).toBeDisabled();
  });

  it("restores the real grid trigger after Escape and Cancel", async () => {
    const user = userEvent.setup();
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    } as Asset;
    render(<GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={makeGame({ progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }] })} mode="game" notes={[progressNote]} onSave={vi.fn()} resolveAssetUrl={() => "/campaign.webp"} />);

    const trigger = screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("restores focus to the add cell after deleting the active item", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    } as Asset;

    function Harness() {
      const [game, setGame] = useState(makeGame({ progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }] }));
      return <GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={game} mode="game" notes={[progressNote]} onSave={(input) => {
        setGame((current) => ({
          ...current,
          progressItems: input.progressItems.map((item) => ({ id: item.id, iconAssetId: item.iconAssetId!, noteId: item.noteId })),
        }));
      }} resolveAssetUrl={() => "/campaign.webp"} />;
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" }));
    await user.click(screen.getByRole("button", { name: "Удалить" }));

    expect(confirm).toHaveBeenCalledWith("Удалить элемент прогресса?");
    await waitFor(() => expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toHaveFocus());
  });

  it("restores focus to the remounted add cell after deleting the final progress item", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    } as Asset;

    function Harness() {
      const [revision, setRevision] = useState(0);
      const [game, setGame] = useState(makeGame({ progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }] }));
      return <GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={game} key={revision} mode="game" notes={[progressNote]} onSave={(input) => {
        setGame((current) => ({
          ...current,
          progressItems: input.progressItems.map((item) => ({ id: item.id, iconAssetId: item.iconAssetId!, noteId: item.noteId })),
        }));
        setRevision((current) => current + 1);
      }} resolveAssetUrl={() => "/campaign.webp"} />;
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" }));
    await user.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toHaveFocus());
  });

  it("waits for the add cell to become enabled before restoring final-deletion focus", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let inspectDeleteFrame = false;
    const deleteFrameAddStates: boolean[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      if (inspectDeleteFrame) {
        const add = document.querySelector<HTMLButtonElement>(".game-progress__add");
        if (add) deleteFrameAddStates.push(add.disabled);
      }
      callback(performance.now());
      return 1;
    });
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    } as Asset;

    function Harness() {
      const [game, setGame] = useState(makeGame({ progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }] }));
      return <GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={game} mode="game" notes={[progressNote]} onSave={(input) => {
        flushSync(() => setGame((current) => ({
          ...current,
          progressItems: input.progressItems.map((item) => ({ id: item.id, iconAssetId: item.iconAssetId!, noteId: item.noteId })),
        })));
      }} resolveAssetUrl={() => "/campaign.webp"} />;
    }

    render(<StrictMode><Harness /></StrictMode>);
    await user.click(screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" }));
    inspectDeleteFrame = true;
    await user.click(screen.getByRole("button", { name: "Удалить" }));

    const add = screen.getByRole("button", { name: "Добавить элемент прогресса" });
    expect(deleteFrameAddStates).toContain(true);
    expect(add).toBeEnabled();
    expect(add).toHaveFocus();
  });

  it("restores focus to the progress section after deleting the last item under storage lock", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const progressNote: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "# Кампания\n- [x] Глава 1\n- [ ] Глава 2",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const icon = {
      id: PROGRESS_ICON_ID,
      kind: "image",
      mime: "image/webp",
      width: 64,
      height: 64,
      byteLength: 128,
      alt: "Кампания",
      originalName: "campaign.webp",
    } as Asset;

    function Harness() {
      const [game, setGame] = useState(makeGame({ progressItems: [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }] }));
      return <GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={game} mode="game" notes={[progressNote]} onSave={(input) => {
        setGame((current) => ({
          ...current,
          progressItems: input.progressItems.map((item) => ({ id: item.id, iconAssetId: item.iconAssetId!, noteId: item.noteId })),
        }));
      }} resolveAssetUrl={() => "/campaign.webp"} storageLocked />;
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Редактировать элемент прогресса: 1 из 2" }));
    await user.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Прогресс" })).toHaveFocus());
  });

  it("preserves progress items when an unrelated title save runs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const progressItems = [{ id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID }];
    render(<GamePage assets={{}} game={makeGame({ progressItems })} mode="game" notes={[]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "DuckTales" }));
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "DuckTales Remastered");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].progressItems).toEqual([{ ...progressItems[0], pendingIcon: null }]);
  });

  it("persists whole-cell pointer reordering without losing progress item data or opening edit after drop", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const progressNotes: Note[] = [
      { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "# A\n- [x] A\n- [ ] B", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_TWO_ID, gameId: DUCK_ID, bodyMarkdown: "# B\n- [x] A\n- [x] B\n- [ ] C", attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_THREE_ID, gameId: DUCK_ID, bodyMarkdown: "# C\n- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D", attachments: [], rank: 3072, createdAt: NOW, updatedAt: NOW },
    ];
    const progressItems = [
      { id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID },
      { id: PROGRESS_ITEM_TWO_ID, iconAssetId: PROGRESS_ICON_TWO_ID, noteId: NOTE_TWO_ID },
      { id: PROGRESS_ITEM_THREE_ID, iconAssetId: PROGRESS_ICON_THREE_ID, noteId: NOTE_THREE_ID },
    ];
    const icon: Asset = { id: PROGRESS_ICON_ID, kind: "image", mime: "image/webp", width: 64, height: 64, byteLength: 128, alt: "Прогресс", originalName: "progress.webp" };
    const rects = new Map([
      [PROGRESS_ITEM_ID, domRect(0, 0, 88, 88)],
      [PROGRESS_ITEM_TWO_ID, domRect(92, 0, 88, 88)],
      [PROGRESS_ITEM_THREE_ID, domRect(92, 93, 88, 88)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-progress__grid")) return domRect(0, 0, 272, 181);
      if (this.matches(".game-progress__drag-overlay")) return domRect(0, 0, 88, 88);
      if (this.dataset.progressItemId) return rects.get(this.dataset.progressItemId) ?? domRect(0, 0, 88, 88);
      return domRect(0, 0, 1024, 768);
    });

    function Harness() {
      const [game, setGame] = useState(makeGame({ progressItems }));
      return <GamePage assets={{ [PROGRESS_ICON_ID]: icon }} game={game} mode="game" notes={progressNotes} onSave={(input) => {
        onSave(input);
        setGame((current) => ({
          ...current,
          title: input.title,
          progressItems: input.progressItems.map((item) => ({ id: item.id, iconAssetId: item.iconAssetId, noteId: item.noteId })),
        }));
      }} resolveAssetUrl={() => "/progress.webp"} />;
    }

    render(<Harness />);
    const first = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_ID}"]`)!;
    const third = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_THREE_ID}"]`)!;
    const grid = document.querySelector(".game-progress__grid")!;

    await user.pointer([
      { keys: "[MouseLeft>]", target: first, coords: { clientX: 20, clientY: 40 } },
      { target: first, coords: { clientX: 32, clientY: 40 } },
    ]);
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    await user.pointer([
      { target: third, coords: { clientX: 160, clientY: 130 } },
    ]);
    await waitFor(() => expect(third).toHaveClass("is-drop-target"));
    await user.pointer([
      { keys: "[/MouseLeft]", target: third, coords: { clientX: 160, clientY: 130 } },
    ]);

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].progressItems).toEqual([
      { ...progressItems[1], pendingIcon: null },
      { ...progressItems[2], pendingIcon: null },
      { ...progressItems[0], pendingIcon: null },
    ]);
    expect(screen.queryByRole("dialog", { name: "Элемент прогресса" })).not.toBeInTheDocument();
    expect(grid.lastElementChild).toHaveAccessibleName("Добавить элемент прогресса");
    await waitFor(() => expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeEnabled());

    const movedAfterDrop = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_ID}"]`)!;
    await waitFor(() => {
      movedAfterDrop.click();
      expect(screen.getByRole("dialog", { name: "Элемент прогресса" })).toBeVisible();
    });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(movedAfterDrop).toHaveFocus());

    onSave.mockClear();
    const moved = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_ID}"]`)!;
    moved.focus();
    await user.keyboard("[Space][Escape]");
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "DuckTales" }));
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "DuckTales Remastered");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].progressItems.map((item) => item.id)).toEqual([
      PROGRESS_ITEM_TWO_ID,
      PROGRESS_ITEM_THREE_ID,
      PROGRESS_ITEM_ID,
    ]);
  });

  it("persists keyboard grid movement and restores focus to the moved progress item", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const progressNotes: Note[] = [
      { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "- [x] A\n- [ ] B", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_TWO_ID, gameId: DUCK_ID, bodyMarkdown: "- [x] A\n- [x] B\n- [ ] C", attachments: [], rank: 2048, createdAt: NOW, updatedAt: NOW },
      { id: NOTE_THREE_ID, gameId: DUCK_ID, bodyMarkdown: "- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D", attachments: [], rank: 3072, createdAt: NOW, updatedAt: NOW },
    ];
    const progressItems = [
      { id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID },
      { id: PROGRESS_ITEM_TWO_ID, iconAssetId: PROGRESS_ICON_TWO_ID, noteId: NOTE_TWO_ID },
      { id: PROGRESS_ITEM_THREE_ID, iconAssetId: PROGRESS_ICON_THREE_ID, noteId: NOTE_THREE_ID },
    ];
    const rects = new Map([
      [PROGRESS_ITEM_ID, domRect(0, 100, 88, 88)],
      [PROGRESS_ITEM_TWO_ID, domRect(92, 100, 88, 88)],
      [PROGRESS_ITEM_THREE_ID, domRect(184, 100, 88, 88)],
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.matches(".game-progress__grid")) return domRect(0, 100, 272, 88);
      if (this.matches(".game-progress__drag-overlay")) return domRect(0, 0, 88, 88);
      if (this.dataset.progressItemId) return rects.get(this.dataset.progressItemId) ?? domRect(0, 0, 88, 88);
      return domRect(0, 0, 1024, 768);
    });

    function Harness() {
      const [game, setGame] = useState(makeGame({ progressItems }));
      return <GamePage assets={{}} game={game} mode="game" notes={progressNotes} onSave={(input) => {
        onSave(input);
        setGame((current) => ({
          ...current,
          progressItems: input.progressItems.map((item) => ({ id: item.id, iconAssetId: item.iconAssetId, noteId: item.noteId })),
        }));
      }} storageLocked />;
    }

    render(<Harness />);
    expect(screen.getByRole("button", { name: "Добавить элемент прогресса" })).toBeDisabled();
    const first = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_ID}"]`)!;
    const second = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_TWO_ID}"]`)!;
    first.focus();
    await user.keyboard("[Space]");
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    await user.keyboard("[ArrowRight]");
    await waitFor(() => expect(second).toHaveClass("is-drop-target"));
    await user.keyboard("[Enter]");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].progressItems.map((item) => item.id)).toEqual([
      PROGRESS_ITEM_TWO_ID,
      PROGRESS_ITEM_ID,
      PROGRESS_ITEM_THREE_ID,
    ]);
    expect(document.activeElement).toHaveAttribute("data-progress-item-id", PROGRESS_ITEM_ID);
  });

  it("disables progress sorting while a save is pending and restores it after settlement", async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const progressNote: Note = { id: NOTE_ID, gameId: DUCK_ID, bodyMarkdown: "- [x] A\n- [ ] B", attachments: [], rank: 1024, createdAt: NOW, updatedAt: NOW };
    render(<GamePage assets={{}} game={makeGame({ progressItems: [
      { id: PROGRESS_ITEM_ID, iconAssetId: PROGRESS_ICON_ID, noteId: NOTE_ID },
      { id: PROGRESS_ITEM_TWO_ID, iconAssetId: PROGRESS_ICON_TWO_ID, noteId: NOTE_ID },
    ] })} mode="game" notes={[progressNote]} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "DuckTales" }));
    const title = screen.getByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "DuckTales pending");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const first = document.querySelector<HTMLButtonElement>(`[data-progress-item-id="${PROGRESS_ITEM_ID}"]`)!;
    expect(first).toHaveAttribute("aria-disabled", "true");
    await user.pointer([
      { keys: "[MouseLeft>]", target: first, coords: { clientX: 20, clientY: 40 } },
      { target: first, coords: { clientX: 40, clientY: 40 } },
      { keys: "[/MouseLeft]", target: first, coords: { clientX: 40, clientY: 40 } },
    ]);
    expect(first).not.toHaveClass("is-dragging");

    resolveSave();
    await waitFor(() => expect(first).toHaveAttribute("aria-disabled", "false"));
  });

  it("shows the platinum ribbon only on a platinum game cover", () => {
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
    expect(screen.getByRole("button", { name: "Добавить заметку в новую группу" })).toBeEnabled();
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

  it("keeps the game page minimal and edits notes only from their footer actions", async () => {
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
    expect(screen.getAllByRole("button", { name: "Редактировать заметку" })).toHaveLength(2);
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
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    await user.click(within(cards[0] as HTMLElement).getByRole("button", { name: "Редактировать заметку" }));
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
    expect(confirm).not.toHaveBeenCalled();
    await user.click(within(cards[1] as HTMLElement).getByRole("button", { name: "Редактировать заметку" }));
    expect(confirm).toHaveBeenCalledWith("Отменить несохранённые изменения заметки?");
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("Хорошая игра — черновик");
    await user.click(screen.getByRole("button", { name: "Отменить редактирование" }));
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    const restoredCard = notesSection.querySelectorAll(".note-card")[0] as HTMLElement;
    expect(within(restoredCard).getByText("Хорошая игра")).toBeInTheDocument();
    expect(restoredCard).not.toHaveAttribute("tabindex");
    fireEvent.keyDown(restoredCard, { key: "Enter" });
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    await user.click(within(restoredCard).getByRole("button", { name: "Редактировать заметку" }));
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
    expect(getNoteDropIndex(editableNotes, NOTE_ID, NOTE_THREE_ID, "before")).toBe(1);
    expect(getNoteDropIndex(editableNotes, NOTE_ID, NOTE_THREE_ID, "after")).toBe(2);
    expect(getNoteDropIndex(editableNotes, NOTE_THREE_ID, NOTE_ID, "before")).toBe(0);
    expect(getNoteDropIndex(editableNotes, NOTE_THREE_ID, NOTE_ID, "after")).toBe(1);
    expect(getNoteDropIndex(editableNotes, NOTE_ID, NOTE_ID)).toBeNull();
    expect(getNoteDropIndex(editableNotes, NOTE_ID, "missing")).toBeNull();
    expect(NOTE_LIST_SENSOR_TYPES).toEqual({ pointer: NonTouchNotePointerSensor, touch: TouchSensor, keyboard: KeyboardSensor });
    expect(NonTouchNotePointerSensor.prototype).toBeInstanceOf(PointerSensor);
    expect(NOTE_LIST_SENSOR_OPTIONS.pointer).toEqual({ activationConstraint: { distance: 8 } });
    expect(NOTE_LIST_SENSOR_OPTIONS.touch).toEqual({ activationConstraint: { delay: 180, tolerance: 8 } });
    expect(NOTE_LIST_SENSOR_OPTIONS.keyboard.coordinateGetter).toBe(noteKeyboardCoordinates);
    expect(NOTE_LIST_SENSOR_OPTIONS.keyboard.keyboardCodes).toEqual({
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
    });
    expect(NOTE_LIST_SORTING_STRATEGY({} as never)).toBeNull();
  });

  it("reorders shelf notes from their footer handle without opening the editor after drop", async () => {
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
    const firstSurface = first.querySelector<HTMLElement>(".note-card__surface")!;
    const handle = within(first).getByRole("button", { name: "Перетащить заметку" });

    await user.pointer([{ keys: "[MouseLeft>]", target: firstSurface, coords: { clientX: 20, clientY: 120 } }]);
    await user.pointer([{ target: firstSurface, coords: { clientX: 40, clientY: 120 } }]);
    expect(first).not.toHaveClass("is-dragging");
    await user.pointer([{ keys: "[/MouseLeft]", target: firstSurface, coords: { clientX: 40, clientY: 120 } }]);
    await user.pointer([{ keys: "[MouseLeft>]", target: handle, coords: { clientX: 20, clientY: 195 } }]);
    await user.pointer([{ target: handle, coords: { clientX: 40, clientY: 195 } }]);
    await waitFor(() => expect(first).toHaveClass("is-dragging"));
    await user.pointer([{ target: handle, coords: { clientX: 40, clientY: 240 } }]);
    await user.pointer([{ keys: "[/MouseLeft]", target: handle, coords: { clientX: 40, clientY: 240 } }]);

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

  it("supports keyboard note sorting from every note footer handle", async () => {
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
    const handle = within(first).getByRole("button", { name: "Перетащить заметку" });
    handle.focus();

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

  it("keeps attachments before text in both note view and inline editor", async () => {
    const user = userEvent.setup();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Текст после вложения",
      attachments: [{ type: "link", url: "https://example.com/guide", label: "Гайд" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const surface = card.querySelector<HTMLElement>(".note-card__surface")!;
    expect(Array.from(surface.children).map((child) => child.className)).toEqual(["note-attachments", "note-card__text"]);

    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    const textarea = screen.getByRole("textbox", { name: "Текст заметки" });
    const editor = textarea.closest<HTMLElement>("article")!;
    expect(editor.children[0]).toHaveClass("note-attachments");
    expect(editor.children[1]).toHaveClass("monaco-note-editor");
    expect(editor.children[1]).toContainElement(textarea);
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

    await user.click(within(screen.getByText("Видео прохождения").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
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

  it("closes only the YouTube URL input on Escape and keeps the note editor mounted", async () => {
    const user = userEvent.setup();
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Видео прохождения",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);

    await user.click(within(screen.getByText("Видео прохождения").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const modelKey = editor.closest(".monaco-note-editor")?.getAttribute("data-model-key");
    await user.click(screen.getByRole("link", { name: "Загрузить видео на YouTube" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Ссылка на YouTube" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toBe(editor);
    expect(editor.closest(".monaco-note-editor")).toHaveAttribute("data-model-key", modelKey);
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

    await user.click(within(screen.getByText("Ссылки").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
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

  it("keeps a published MP4 interactive while exposing media-only drag and edit controls", async () => {
    const user = userEvent.setup();
    const assetId = "e".repeat(64);
    const asset: Asset = { id: assetId, kind: "file", mime: "video/mp4", byteLength: 1024, originalName: "run.mp4" };
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "",
      attachments: [{ type: "file", assetId, label: "Boss run" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(<GamePage assets={{ [assetId]: asset }} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => `/mylib/media/${assetId}.mp4`} />);
    const video = screen.getByLabelText("Видео «Boss run»");
    const card = video.closest("article")!;
    expect(video).toHaveAttribute("src", `/mylib/media/${assetId}.mp4#t=0.001`);
    expect(card).toHaveClass("note-card--media-only");
    expect(within(card).getByRole("button", { name: "Перетащить заметку" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Редактировать заметку" })).toBeInTheDocument();

    await user.click(video);
    expect(screen.queryByRole("textbox", { name: "Текст заметки" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Редактировать заметку" }));
    expect(screen.getByRole("textbox", { name: "Текст заметки" })).toHaveValue("");
    expect(screen.getByLabelText("Видео «Boss run»")).toBeInTheDocument();
  });

  it("keeps an MP4 from the local delta playable as an unchanged data URL", () => {
    const assetId = "f".repeat(64);
    const asset: Asset = { id: assetId, kind: "file", mime: "video/mp4", byteLength: 4, originalName: "local.mp4" };
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "",
      attachments: [{ type: "file", assetId, label: "Local run" }],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };

    render(<GamePage assets={{ [assetId]: asset }} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} resolveAssetUrl={() => "data:video/mp4;base64,AAAA"} />);

    expect(screen.getByLabelText("Видео «Local run»")).toHaveAttribute("src", "data:video/mp4;base64,AAAA");
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
      asset: { id: "a".repeat(64), kind: "image", mime: "image/webp", width: 20, height: 10, byteLength: 4, alt: "Карта", originalName: "map.png" },
      blob: new Blob(["webp"], { type: "image/webp" }),
      byteLength: 4,
    });

    const view = render(<GamePage assets={{}} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={onSave} />);
    await user.click(within(screen.getByText("Материалы").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));

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
    const save = await screen.findByRole("link", { name: /save\.dat/ });
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

  it("previews MP4 files added by drop or file picker and preserves Safari MIME fallback", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const canAddBlob = vi.fn(() => null);
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Материалы",
      attachments: [],
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const view = render(<GamePage assets={{}} canAddBlob={canAddBlob} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={onSave} />);
    await user.click(within(screen.getByText("Материалы").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
    const editor = screen.getByRole("textbox", { name: "Текст заметки" });
    const dropped = new File(["drop"], "dropped.MP4", { type: "" });

    fireEvent.drop(editor, { dataTransfer: { files: [dropped], items: [], types: ["Files"] } });
    const droppedVideo = await screen.findByLabelText("Видео «dropped.MP4»");
    expect(droppedVideo).toHaveAttribute("controls");
    expect(droppedVideo).toHaveAttribute("playsinline");
    expect(droppedVideo).toHaveAttribute("preload", "metadata");
    expect(droppedVideo).not.toHaveAttribute("autoplay");
    expect(droppedVideo.getAttribute("src")).toMatch(/^blob:.*#t=0\.001$/);

    const picked = new File(["picked"], "picked.mp4", { type: "video/mp4" });
    const fileInput = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать файлы"]')!;
    fireEvent.change(fileInput, { target: { files: [picked] } });
    expect((await screen.findByLabelText("Видео «picked.mp4»")).getAttribute("src")).toMatch(/^blob:.*#t=0\.001$/);

    await user.click(screen.getByRole("button", { name: "Сохранить заметку" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].notes[0].attachments).toEqual([
      expect.objectContaining({ type: "pending-file", label: "dropped.MP4", file: expect.objectContaining({ mime: "video/mp4", originalName: "dropped.MP4", byteLength: 4 }) }),
      expect.objectContaining({ type: "pending-file", label: "picked.mp4", file: expect.objectContaining({ mime: "video/mp4", originalName: "picked.mp4", byteLength: 6 }) }),
    ]);
    expect(canAddBlob.mock.calls.map(([byteLength]) => byteLength)).toEqual([4, 10]);
  });

  it("preflights the optimized image size even when Safari leaves its MIME empty", async () => {
    const user = userEvent.setup();
    vi.mocked(optimizeNoteImage).mockClear();
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
      asset: { id: "a".repeat(64), kind: "image", mime: "image/webp", width: 20, height: 10, byteLength: 4, alt: "Карта", originalName: "map.webp" },
      blob: new Blob(["webp"], { type: "image/webp" }),
      byteLength: 4,
    });
    const view = render(<GamePage assets={{}} canAddBlob={canAddBlob} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={vi.fn()} />);
    await user.click(within(screen.getByText("Материалы").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать изображения"]')!;
    const file = new File(["source"], "map.webp", { type: "" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Изображение не помещается в локальное хранилище Safari");
    expect(optimizeNoteImage).not.toHaveBeenCalled();
    expect(canAddBlob).toHaveBeenCalledWith(file.size);
    expect(screen.queryByRole("img", { name: "map" })).not.toBeInTheDocument();
  });

  it("creates an image note in an existing group from the group add card", async () => {
    const onSave = vi.fn<(input: GameSaveInput) => void>();
    const canAddBlob = vi.fn(() => null);
    const note: Note = {
      id: NOTE_ID,
      gameId: DUCK_ID,
      bodyMarkdown: "Материалы",
      attachments: [],
      groupRank: 2048,
      rank: 1024,
      createdAt: NOW,
      updatedAt: NOW,
    };
    vi.mocked(optimizeNoteImage).mockResolvedValue({
      asset: { id: "a".repeat(64), kind: "image", mime: "image/webp", width: 20, height: 10, byteLength: 4, alt: "Карта", originalName: "map.webp" },
      blob: new Blob(["webp"], { type: "image/webp" }),
      byteLength: 4,
    });
    render(<GamePage assets={{}} canAddBlob={canAddBlob} game={makeGame({ reviewMarkdown: "" })} mode="game" notes={[note]} onSave={onSave} />);
    const addCard = screen.getByRole("button", { name: "Добавить заметку в группу 1" });
    const file = new File(["source"], "map.PNG", { type: "" });

    fireEvent.drop(addCard, { dataTransfer: { files: [file], items: [], types: ["Files"], dropEffect: "none" } });

    const image = await screen.findByRole("img", { name: "map" });
    expect(image.closest(".note-group")).toHaveAttribute("data-note-group-rank", "2048");
    expect(optimizeNoteImage).toHaveBeenCalledWith(file, "map");
    expect(canAddBlob).toHaveBeenCalledWith(file.size);
    expect(onSave).not.toHaveBeenCalled();
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
    await user.click(within(screen.getByText("Материалы").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Выбрать файлы"]')!;

    fireEvent.change(input, { target: { files: [new File(["1234"], "first.dat")] } });
    expect(await screen.findByRole("link", { name: /first\.dat/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File(["12"], "second.dat")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Файл не помещается в localStorage Safari");
    expect(canAddBlob.mock.calls.map(([byteLength]) => byteLength)).toEqual([4, 6]);
    expect(read).not.toHaveBeenCalled();
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
    await user.click(within(screen.getByText("Материалы").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
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
    expect(link.closest("article")).not.toHaveClass("note-card--media-only");
    expect(document.querySelector("video")).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Добавить заметку в новую группу" }));
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

    await user.click(within(screen.getByText("Старая заметка").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
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

    await user.click(within(screen.getByText("Старая заметка").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
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
      asset: { id: "a".repeat(64), kind: "image", mime: "image/webp", width: 20, height: 10, byteLength: 4, alt: "secret", originalName: "secret.png" },
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

    await user.click(within(screen.getByText("Хорошая игра").closest<HTMLElement>("article")!).getByRole("button", { name: "Редактировать заметку" }));
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
  const noteChange: ReviewChange = {
    id: "note-parcels-row",
    selectionId: "note-parcels",
    entity: { map: "notes", id: NOTE_ID },
    kind: "changed",
    title: "Посылки",
    summary: "Изменены детали посылок",
    changedAt: "2026-08-04T12:00:00.000Z",
    operationPaths: [`/notes/${NOTE_ID}/bodyMarkdown`],
    gameIds: [DUCK_ID],
    evidence: [{
      type: "markdown",
      before: Array.from({ length: 16 }, (_, index) => `- Старый пункт ${index + 1}`).join("\n"),
      after: Array.from({ length: 16 }, (_, index) => `- Новый пункт ${index + 1}`).join("\n"),
      diff: createMarkdownDiff(
        Array.from({ length: 16 }, (_, index) => `- Старый пункт ${index + 1}`).join("\n"),
        Array.from({ length: 16 }, (_, index) => `- Новый пункт ${index + 1}`).join("\n"),
      ),
    }],
  };
  const titleChange: ReviewChange = {
    id: "game-title-row",
    selectionId: "game-title",
    entity: { map: "games", id: DUCK_ID },
    kind: "changed",
    title: "Название",
    summary: "Название: LEGO Harry Potter → Lego Harry Potter: Years 1–4",
    changedAt: "2026-08-04T11:00:00.000Z",
    operationPaths: [`/games/${DUCK_ID}/title`],
    gameIds: [DUCK_ID],
    evidence: [{ type: "scalar", before: "LEGO Harry Potter", after: "Lego Harry Potter: Years 1–4" }],
  };
  const crossGameChange: ReviewChange = {
    id: "cross-game-lego-row",
    selectionId: "cross-game-order",
    entity: { map: "games", id: DUCK_ID },
    kind: "moved",
    title: "Позиция в тирлисте",
    summary: "Перемещено: A · позиция 2 → S · позиция 1",
    changedAt: "2026-08-04T10:00:00.000Z",
    operationPaths: [`/games/${DUCK_ID}/placement`],
    gameIds: [DUCK_ID, MARIO_ID],
    evidence: [{ type: "move", before: "A · позиция 2", after: "S · позиция 1" }],
  };
  const crossGameOccurrence: ReviewChange = {
    ...crossGameChange,
    id: "cross-game-mario-row",
    entity: { map: "games", id: MARIO_ID },
    operationPaths: [`/games/${MARIO_ID}/placement`],
  };
  const review: ChangeReviewModel = {
    groups: [
      {
        id: `game:${DUCK_ID}`,
        gameId: DUCK_ID,
        title: "Lego Harry Potter: Years 1–4",
        coverAssetId: null,
        newestChangedAt: noteChange.changedAt,
        changes: [noteChange, titleChange, crossGameChange],
      },
      {
        id: `game:${MARIO_ID}`,
        gameId: MARIO_ID,
        title: "A Plague Tale",
        coverAssetId: null,
        newestChangedAt: crossGameOccurrence.changedAt,
        changes: [crossGameOccurrence],
      },
    ],
    changesById: {
      [noteChange.id]: noteChange,
      [titleChange.id]: titleChange,
      [crossGameChange.id]: crossGameChange,
      [crossGameOccurrence.id]: crossGameOccurrence,
    },
    changesBySelectionId: {
      [noteChange.selectionId]: [noteChange],
      [titleChange.selectionId]: [titleChange],
      [crossGameChange.selectionId]: [crossGameChange, crossGameOccurrence],
    },
    uniqueSelectionIds: [noteChange.selectionId, titleChange.selectionId, crossGameChange.selectionId],
  };
  const emptyReview: ChangeReviewModel = { groups: [], changesById: {}, changesBySelectionId: {}, uniqueSelectionIds: [] };
  const emptySelection = {
    enabled: false,
    explicitSelectionIds: new Set<string>(),
    selectedSelectionIds: new Set<string>(),
    dependencySelectionIds: new Set<string>(),
    dependencyLabels: {},
    selectedPaths: undefined,
  };

  function renderDialog(model: ChangeReviewModel = review, overrides: Partial<Parameters<typeof DiffDialog>[0]> = {}) {
    return render(
      <DiffDialog
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        open
        patchBytes={1024}
        review={model}
        selection={emptySelection}
        {...overrides}
      />,
    );
  }

  function ControlledDialog({ dependencies = false }: { dependencies?: boolean }) {
    const [open, setOpen] = useState(true);
    const [selectionMode, setSelectionMode] = useState(false);
    const [explicitSelectionIds, setExplicitSelectionIds] = useState<ReadonlySet<string>>(new Set());
    const dependencySelectionIds = dependencies && explicitSelectionIds.has(noteChange.selectionId)
      ? new Set(["guide-asset"])
      : new Set<string>();
    const selectedSelectionIds = new Set([...explicitSelectionIds, ...dependencySelectionIds]);
    const assetChange: ReviewChange = {
      id: "guide-asset-row",
      selectionId: "guide-asset",
      entity: { map: "assets", id: "a".repeat(64) },
      kind: "asset",
      title: "guide.pdf",
      summary: "Добавлен файл «guide.pdf»",
      changedAt: "2026-08-04T09:00:00.000Z",
      operationPaths: [`/assets/${"a".repeat(64)}`],
      gameIds: [DUCK_ID],
      evidence: [{ type: "asset", assetId: "a".repeat(64), originalName: "guide.pdf", mime: "application/pdf", byteLength: 4096 }],
    };
    const model: ChangeReviewModel = dependencies ? {
      ...review,
      groups: [{ ...review.groups[0], changes: [...review.groups[0].changes, assetChange] }, review.groups[1]],
      changesById: { ...review.changesById, [assetChange.id]: assetChange },
      changesBySelectionId: { ...review.changesBySelectionId, [assetChange.selectionId]: [assetChange] },
      uniqueSelectionIds: [...review.uniqueSelectionIds, assetChange.selectionId],
    } : review;
    const toggleChange = (selectionId: string) => setExplicitSelectionIds((current) => {
      const next = new Set(current);
      if (next.has(selectionId)) next.delete(selectionId);
      else next.add(selectionId);
      return next;
    });
    const toggleGame = (gameId: string | null) => setExplicitSelectionIds((current) => {
      const group = model.groups.find((candidate) => candidate.gameId === gameId);
      const ids = [...new Set(group?.changes.map((change) => change.selectionId) ?? [])];
      const next = new Set(current);
      if (ids.every((selectionId) => selectedSelectionIds.has(selectionId))) ids.forEach((selectionId) => next.delete(selectionId));
      else ids.forEach((selectionId) => next.add(selectionId));
      return next;
    });
    const close = () => {
      setOpen(false);
      setSelectionMode(false);
      setExplicitSelectionIds(new Set());
    };
    return <>
      {!open ? <button onClick={() => setOpen(true)} type="button">Открыть изменения</button> : null}
      <DiffDialog
        onClose={close}
        onEnterSelection={() => setSelectionMode(true)}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onToggleChange={toggleChange}
        onToggleGame={toggleGame}
        open={open}
        patchBytes={1024}
        review={model}
        selection={{
          enabled: selectionMode,
          explicitSelectionIds,
          selectedSelectionIds,
          dependencySelectionIds,
          dependencyLabels: dependencies ? { "guide-asset": "связано с «Посылки»" } : {},
          selectedPaths: explicitSelectionIds.size
            ? [...new Set([...selectedSelectionIds].flatMap((selectionId) =>
              (model.changesBySelectionId[selectionId] ?? []).flatMap((change) => change.operationPaths),
            ))].sort()
            : undefined,
        }}
        sync={{
          busy: false,
          connected: true,
          error: null,
          onConnect: vi.fn(),
          onDisconnect: vi.fn(),
          onSync: vi.fn(),
          pagesPending: false,
          persistence: "session",
          stage: "idle",
        }}
      />
    </>;
  }

  it("groups compact evidence by game and hides checkboxes in review mode", () => {
    const resolveAssetUrl = vi.fn(() => "blob:local-cover");
    renderDialog({
      ...review,
      groups: [{ ...review.groups[0], coverAssetId: "cover-asset" }, review.groups[1]],
    }, { resolveAssetUrl });

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Lego Harry Potter: Years 1–4");
    expect(headings[1]).toHaveTextContent("A Plague Tale");
    expect(screen.getByText("Посылки")).toBeInTheDocument();
    expect(screen.getByText("LEGO Harry Potter → Lego Harry Potter: Years 1–4")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Lego Harry Potter/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выбрать часть" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Свернуть: Lego Harry Potter: Years 1–4" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("img", { name: "Обложка: Lego Harry Potter: Years 1–4" })).toHaveAttribute("src", "blob:local-cover");
    expect(resolveAssetUrl).toHaveBeenCalledWith("cover-asset");
  });

  it("uses labeled chips instead of visible service markers", () => {
    const chipChange: ReviewChange = {
      ...titleChange,
      id: "game-tags-row",
      selectionId: "game-tags",
      title: "Теги",
      summary: "Теги: +co-op; −solo",
      operationPaths: [`/games/${DUCK_ID}/tags`],
      evidence: [{ type: "chips", added: ["co-op"], removed: ["solo"] }],
    };
    renderDialog({
      groups: [{ ...review.groups[0], changes: [chipChange] }],
      changesById: { [chipChange.id]: chipChange },
      changesBySelectionId: { [chipChange.selectionId]: [chipChange] },
      uniqueSelectionIds: [chipChange.selectionId],
    });

    expect(screen.getByLabelText("Добавлено: co-op")).toBeInTheDocument();
    expect(screen.getByLabelText("Удалено: solo")).toBeInTheDocument();
    expect(screen.queryByText(/\+co-op|−solo|~co-op/u)).not.toBeInTheDocument();
  });

  it("renders image asset evidence as a resolved thumbnail with exact metadata", () => {
    const assetId = "a".repeat(64);
    const imageChange: ReviewChange = {
      ...titleChange,
      id: "cover-asset-row",
      selectionId: "cover-asset",
      entity: { map: "assets", id: assetId },
      kind: "asset",
      title: "cover.webp",
      summary: "Добавлен файл «cover.webp»",
      operationPaths: [`/assets/${assetId}`],
      evidence: [{ type: "asset", assetId, originalName: "cover.webp", mime: "image/webp", byteLength: 24 * 1024, width: 800, height: 600 }],
    };
    const resolveAssetUrl = vi.fn(() => "blob:image-evidence");
    renderDialog({
      groups: [{ ...review.groups[0], changes: [imageChange] }],
      changesById: { [imageChange.id]: imageChange },
      changesBySelectionId: { [imageChange.selectionId]: [imageChange] },
      uniqueSelectionIds: [imageChange.selectionId],
    }, { resolveAssetUrl });

    expect(screen.getByRole("img", { name: "Превью: cover.webp" })).toHaveAttribute("src", "blob:image-evidence");
    expect(screen.getByText("800×600 · image/webp · 24 КБ")).toBeInTheDocument();
    expect(resolveAssetUrl).toHaveBeenCalledWith(assetId);
  });

  it("selects a game, exposes indeterminate state, and counts unique cross-game changes once", async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    await user.click(screen.getByRole("button", { name: "Выбрать часть" }));
    await user.click(screen.getByRole("checkbox", { name: "Выбрать изменение: Посылки" }));

    expect(screen.getByRole("checkbox", { name: "Выбрать игру: Lego Harry Potter: Years 1–4" }))
      .toHaveProperty("indeterminate", true);
    expect(screen.getByRole("button", { name: "Синхронизировать выбранное · 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Выбрать игру: Lego Harry Potter: Years 1–4" }));
    expect(screen.getAllByRole("checkbox", { name: "Выбрать изменение: Позиция в тирлисте" }).every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Синхронизировать выбранное · 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: "Выбрать изменение: Позиция в тирлисте" })).toHaveLength(2);
  });

  it("disables dependency-only rows, explains them, and returns to full sync after the final explicit deselection", async () => {
    const user = userEvent.setup();
    render(<ControlledDialog dependencies />);
    await user.click(screen.getByRole("button", { name: "Выбрать часть" }));
    await user.click(screen.getByRole("checkbox", { name: "Выбрать изменение: Посылки" }));

    const dependency = screen.getByRole("checkbox", { name: "Выбрать изменение: guide.pdf" });
    expect(dependency).toBeChecked();
    expect(dependency).toBeDisabled();
    expect(screen.getByText("связано с «Посылки»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Синхронизировать выбранное · 2" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Выбрать изменение: Посылки" }));
    expect(screen.getByRole("button", { name: "Синхронизировать всё" })).toBeInTheDocument();
  });

  it("keeps note preview controls local and resets selection, collapse, and preview state after reopening", async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    const noteRow = screen.getByText("Посылки").closest("li");
    expect(noteRow).not.toBeNull();
    expect(within(noteRow as HTMLElement).getByRole("button", { name: /Весь diff/ })).toBeInTheDocument();
    expect(within(noteRow as HTMLElement).getByRole("button", { name: "Показать исходник" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Выбрать часть" }));
    await user.click(screen.getByRole("checkbox", { name: "Выбрать изменение: Посылки" }));
    await user.click(screen.getByRole("button", { name: "Показать исходник" }));
    expect(screen.getByRole("button", { name: "Показать как выглядит" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Свернуть: Lego Harry Potter: Years 1–4" }));

    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await user.click(screen.getByRole("button", { name: "Открыть изменения" }));

    expect(screen.queryByRole("checkbox", { name: "Выбрать изменение: Посылки" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Свернуть: Lego Harry Potter: Years 1–4" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Показать исходник" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Синхронизировать всё" })).toBeInTheDocument();
  });

  it("keeps the hidden import picker from intercepting export clicks", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();

    const { container } = render(
      <DiffDialog
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={onExport}
        onImport={vi.fn()}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        open
        patchBytes={0}
        review={emptyReview}
        selection={emptySelection}
      />,
    );

    const importInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(importInput).not.toBeNull();
    expect(importInput).toHaveAttribute("hidden");

    const openImportPicker = vi.spyOn(importInput!, "click");
    await user.click(screen.getByRole("button", { name: "Экспортировать локальную копию" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(openImportPicker).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Импорт" }));
    expect(openImportPicker).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("shows a real action error on demand without local-only or storage diagnostics", async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();

    renderDialog(emptyReview, { error: "Safari отклонил запись", onDismissError });

    expect(screen.getByRole("alert")).toHaveTextContent("Safari отклонил запись");
    expect(screen.queryByText("Только на этом устройстве")).not.toBeInTheDocument();
    expect(screen.queryByText(/Storage API/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Скрыть" }));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("forwards conflict resolution and undo actions", async () => {
    const user = userEvent.setup();
    const onResolveConflict = vi.fn();
    const onUndoChange = vi.fn();
    const onUndoGame = vi.fn();
    const onClearAll = vi.fn();
    render(
      <DiffDialog
        conflicts={[{
          id: "title-conflict",
          path: `/games/${DUCK_ID}/title`,
          label: "Название DuckTales",
          staticValue: "DuckTales Remastered",
          localValue: "DuckTales Local",
        }]}
        onClearAll={onClearAll}
        onClose={vi.fn()}
        onEnterSelection={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onResolveConflict={onResolveConflict}
        onToggleChange={vi.fn()}
        onToggleGame={vi.fn()}
        onUndoChange={onUndoChange}
        onUndoGame={onUndoGame}
        open
        patchBytes={2048}
        review={review}
        selection={emptySelection}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Оставить локальное" }));
    expect(onResolveConflict).toHaveBeenCalledWith("title-conflict", "local");
    await user.click(screen.getByRole("button", { name: "Отменить: Посылки" }));
    expect(onUndoChange).toHaveBeenCalledWith(noteChange.selectionId);
    await user.click(screen.getByRole("button", { name: "Отменить игру: Lego Harry Potter: Years 1–4" }));
    expect(onUndoGame).toHaveBeenCalledWith(DUCK_ID);
    await user.click(screen.getByRole("button", { name: "Отменить все правки" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
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

  it("marks platinum cover-only cards with a platinum ribbon and an accessible status", () => {
    render(<TierListPage assets={{}} games={[makeGame({ status: "platinum" })]} onMoveGame={vi.fn()} />);

    const cover = screen.getByRole("link", { name: /DuckTales, статус: Платина.*пробел — перетащить/ });
    const card = cover.closest("article");
    expect(cover).toHaveClass("cover--platinum");
    expect(card?.textContent).toBe("");
    expect(card?.querySelector(".status-dot")).not.toBeInTheDocument();
  });

  it("leaves completed cover-only cards without the platinum ribbon", () => {
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
