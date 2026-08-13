import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withComputedRevision, type Game, type LibraryDatabase, type Note } from "../src/domain";

const renderCounters = vi.hoisted(() => ({
  root: 0,
  route: 0,
  page: 0,
  affectedNote: 0,
  siblingNote: 0,
  fullSaves: 0,
  interactionSaves: vi.fn(),
}));

vi.mock("../src/components/AppShell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/AppShell")>();
  return {
    ...actual,
    AppShell: (props: ComponentProps<typeof actual.AppShell>) => {
      renderCounters.root += 1;
      return createElement(actual.AppShell, props);
    },
  };
});

vi.mock("../src/components/ShelfGrid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/ShelfGrid")>();
  return {
    ...actual,
    ShelfGrid: (props: ComponentProps<typeof actual.ShelfGrid>) => {
      if (props.className === "notes-list") renderCounters.page += 1;
      return createElement(actual.ShelfGrid, props);
    },
  };
});

vi.mock("../src/components/Markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/Markdown")>();
  return {
    ...actual,
    MarkdownView: (props: ComponentProps<typeof actual.MarkdownView>) => {
      if (props.markdown.includes("Affected note")) renderCounters.affectedNote += 1;
      if (props.markdown.includes("Sibling note")) renderCounters.siblingNote += 1;
      return createElement(actual.MarkdownView, props);
    },
  };
});

vi.mock("../src/pages/GamePage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pages/GamePage")>();
  return {
    ...actual,
    GamePage: (props: ComponentProps<typeof actual.GamePage>) => {
      renderCounters.route += 1;
      const connected = (props as ComponentProps<typeof actual.GamePage> & {
        noteInteractionSource?: {
          saveNoteInteraction: (update: unknown) => Promise<void>;
        };
      }).noteInteractionSource;
      return createElement(actual.GamePage, {
        ...props,
        onSave: async (...args: Parameters<typeof props.onSave>) => {
          renderCounters.fullSaves += 1;
          await props.onSave(...args);
        },
        ...(connected ? {
          noteInteractionSource: {
            ...connected,
            saveNoteInteraction: async (update: unknown) => {
              renderCounters.interactionSaves(update);
              await connected.saveNoteInteraction(update);
            },
          },
        } : {}),
      } as ComponentProps<typeof actual.GamePage>);
    },
  };
});

vi.mock("../src/components/MonacoMarkdownEditor", async () => (
  import("./mocks/MonacoMarkdownEditorMock")
));

import App from "../src/App";

const GAME_ID = "11111111-1111-4111-8111-111111111111";
const AFFECTED_NOTE_ID = "22222222-2222-4222-8222-222222222222";
const SIBLING_NOTE_ID = "33333333-3333-4333-8333-333333333333";
const PUBLICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_COMMIT_SHA = "f".repeat(40);
const NOW = "2026-08-14T08:00:00.000Z";

function game(): Game {
  return {
    id: GAME_ID,
    title: "Render isolation game",
    coverAssetId: null,
    platforms: ["PC"],
    tags: [],
    status: "playing",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function note(id: string, bodyMarkdown: string, rank: number): Note {
  return {
    id,
    gameId: GAME_ID,
    bodyMarkdown,
    attachments: [],
    rank,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function database(): LibraryDatabase {
  const value: LibraryDatabase = {
    schemaVersion: 2,
    revision: "",
    publicationId: PUBLICATION_ID,
    games: { [GAME_ID]: game() },
    notes: {
      [AFFECTED_NOTE_ID]: note(AFFECTED_NOTE_ID, [
        "# Affected note",
        "- [ ] Affected task",
        "- Affected group",
        "  - [ ] Nested task",
      ].join("\n"), 1024),
      [SIBLING_NOTE_ID]: note(SIBLING_NOTE_ID, "# Sibling note\n- [ ] Sibling task", 2048),
    },
    assets: {},
  };
  return withComputedRevision(value);
}

function snapshotCounters() {
  return {
    root: renderCounters.root,
    route: renderCounters.route,
    page: renderCounters.page,
    affectedNote: renderCounters.affectedNote,
    siblingNote: renderCounters.siblingNote,
  };
}

beforeEach(() => {
  window.location.hash = `#/games/${GAME_ID}`;
  window.sessionStorage.clear();
  renderCounters.root = 0;
  renderCounters.route = 0;
  renderCounters.page = 0;
  renderCounters.affectedNote = 0;
  renderCounters.siblingNote = 0;
  renderCounters.fullSaves = 0;
  renderCounters.interactionSaves.mockReset();
  const library = database();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sourceCommitSha: SOURCE_COMMIT_SHA, database: structuredClone(library) }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("route-backed note interaction render isolation", () => {
  it("updates one subscribed note and the current diff without redrawing the route, page, or sibling", async () => {
    const user = userEvent.setup();
    render(<App />);

    const affectedTask = await screen.findByRole("checkbox", { name: "Отметить: Affected task" });
    const affectedCard = affectedTask.closest<HTMLElement>("article")!;
    const siblingTask = screen.getByRole("checkbox", { name: "Отметить: Sibling task" });
    const siblingCard = siblingTask.closest<HTMLElement>("article")!;
    const affectedViewport = affectedCard.querySelector<HTMLElement>(".note-card__viewport")!;
    const siblingViewport = siblingCard.querySelector<HTMLElement>(".note-card__viewport")!;
    affectedViewport.scrollTop = 60;
    siblingViewport.scrollTop = 40;
    const pageScroll = [window.scrollX, window.scrollY];
    const initialDom = { affectedCard, siblingCard, affectedViewport, siblingViewport };
    const beforeCheckbox = snapshotCounters();

    await user.click(affectedTask);

    await waitFor(() => expect(affectedTask).toBeChecked());
    await waitFor(() => expect(screen.getByRole("button", { name: /^Локальные правки: 1,/ })).toBeInTheDocument());
    expect(renderCounters.interactionSaves).toHaveBeenNthCalledWith(1, {
      noteId: AFFECTED_NOTE_ID,
      field: "bodyMarkdown",
      value: expect.stringContaining("- [x] Affected task"),
    });
    expect(renderCounters.fullSaves).toBe(0);
    expect(renderCounters.root).toBe(beforeCheckbox.root);
    expect(renderCounters.route).toBe(beforeCheckbox.route);
    expect(renderCounters.page).toBe(beforeCheckbox.page);
    expect(renderCounters.affectedNote).toBeGreaterThan(beforeCheckbox.affectedNote);
    expect(renderCounters.siblingNote).toBe(beforeCheckbox.siblingNote);
    expect(siblingTask).toBeEnabled();
    expect(siblingTask).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("checkbox", { name: "Снять отметку: Affected task" }).closest("article")).toBe(initialDom.affectedCard);
    expect(screen.getByRole("checkbox", { name: "Отметить: Sibling task" }).closest("article")).toBe(initialDom.siblingCard);
    expect(initialDom.affectedCard.querySelector(".note-card__viewport")).toBe(initialDom.affectedViewport);
    expect(initialDom.siblingCard.querySelector(".note-card__viewport")).toBe(initialDom.siblingViewport);
    expect(initialDom.affectedViewport.scrollTop).toBe(60);
    expect(initialDom.siblingViewport.scrollTop).toBe(40);
    expect([window.scrollX, window.scrollY]).toEqual(pageScroll);

    const collapse = within(affectedCard).getByRole("button", { name: /^Affected group / });
    const beforeCollapse = snapshotCounters();
    await user.click(collapse);

    await waitFor(() => expect(collapse).toHaveAttribute("aria-expanded", "false"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Локальные правки: 2,/ })).toBeInTheDocument());
    expect(renderCounters.interactionSaves).toHaveBeenNthCalledWith(2, {
      noteId: AFFECTED_NOTE_ID,
      field: "collapsedChecklistSections",
      value: [expect.any(String)],
    });
    expect(renderCounters.fullSaves).toBe(0);
    expect(renderCounters.root).toBe(beforeCollapse.root);
    expect(renderCounters.route).toBe(beforeCollapse.route);
    expect(renderCounters.page).toBe(beforeCollapse.page);
    expect(renderCounters.affectedNote).toBeGreaterThan(beforeCollapse.affectedNote);
    expect(renderCounters.siblingNote).toBe(beforeCollapse.siblingNote);
    expect(screen.getByRole("checkbox", { name: "Отметить: Sibling task" }).closest("article")).toBe(initialDom.siblingCard);
    expect(initialDom.affectedViewport.scrollTop).toBe(60);
    expect(initialDom.siblingViewport.scrollTop).toBe(40);
    expect([window.scrollX, window.scrollY]).toEqual(pageScroll);

    await user.click(screen.getByRole("button", { name: /^Локальные правки: 2,/ }));
    const diff = await screen.findByRole("dialog", { name: "Локальные правки" });
    expect(within(diff).getByRole("checkbox", { name: "Стало отмечено" })).toBeChecked();
    expect(within(diff).getByText(/^Свёрнутые разделы:/)).toBeInTheDocument();
  });
});
