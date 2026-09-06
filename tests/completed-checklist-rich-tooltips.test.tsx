import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownView } from "../src/components/Markdown";
import type { Game, Note } from "../src/domain";
import { GamePage } from "../src/pages/GamePage";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverMock));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const source = "# Note\n\n## Complete\n- [x] [Entry][?]\n";
const definitions = "\n[?Entry]:\n    Description\n";
const game: Game = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Synthetic game",
  coverAssetId: null,
  platforms: [],
  tags: [],
  status: "playing",
  placement: { tierId: "unranked", rank: 1024 },
  reviewMarkdown: "",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

function makeNote(bodyMarkdown: string): Note {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    gameId: game.id,
    bodyMarkdown,
    attachments: [],
    rank: 1024,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

it("hides the last completed section with terminal rich tooltip definitions on GamePage", () => {
  render(
    <GamePage
      assets={{}}
      completedChecklistFilterEnabled
      game={game}
      mode="game"
      notes={[makeNote(source + definitions)]}
      onSave={vi.fn()}
    />,
  );

  expect(screen.queryByRole("heading", { name: /Complete/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /^Note/ })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Скрыто 1 секций" })).toHaveLength(1);
  expect(screen.queryByText("Description")).not.toBeInTheDocument();
});

it("also hides the section in standalone rich Markdown", () => {
  render(
    <MarkdownView
      completedChecklistFilterEnabled
      markdown={source + definitions}
      richTooltipsEnabled
    />,
  );

  expect(screen.queryByRole("heading", { name: /Complete/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скрыто 1 секций" })).toBeInTheDocument();
});

it.each([
  source + "\nOrdinary paragraph\n" + definitions,
  source.replace("[x]", "[ ]") + definitions,
  source.replace("[x]", "[-]") + definitions,
  source + definitions + "\nVisible interruption\n",
])("keeps a section containing visible work or ordinary content: %s", (bodyMarkdown) => {
  render(
    <GamePage
      assets={{}}
      completedChecklistFilterEnabled
      game={game}
      mode="game"
      notes={[makeNote(bodyMarkdown)]}
      onSave={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Скрыто 1 секций" })).not.toBeInTheDocument();
});

it("preserves raw-source filtering for legacy review cards", () => {
  render(
    <GamePage
      assets={{}}
      completedChecklistFilterEnabled
      game={{ ...game, reviewMarkdown: source + definitions }}
      mode="game"
      notes={[]}
      onSave={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Скрыто 1 секций" })).not.toBeInTheDocument();
});

it("counts a completed parent once when terminal definitions follow its last child", () => {
  const bodyMarkdown = "# Note\n## Parent\n### Child\n- [x] [Entry][?]\n" + definitions;
  render(
    <GamePage
      assets={{}}
      completedChecklistFilterEnabled
      game={game}
      mode="game"
      notes={[makeNote(bodyMarkdown)]}
      onSave={vi.fn()}
    />,
  );

  expect(screen.queryByRole("heading", { name: /Parent|Child/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Скрыто 1 секций" })).toHaveLength(1);
});

it("reveals sections and tasks independently while preserving tooltip bodies and source", async () => {
  const onSave = vi.fn();
  const note = makeNote(source + definitions);
  const view = render(
    <GamePage
      assets={{}}
      completedChecklistFilterEnabled
      game={game}
      mode="game"
      notes={[note]}
      onSave={onSave}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 секций" }));
  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Скрыто 1 пунктов" }));
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Entry" }));
  expect(within(await screen.findByRole("dialog")).getByText("Description")).toBeInTheDocument();

  view.rerender(
    <GamePage
      assets={{}}
      completedChecklistFilterEnabled={false}
      game={game}
      mode="game"
      notes={[note]}
      onSave={onSave}
    />,
  );
  expect(screen.getByRole("heading", { name: /Complete/ })).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(onSave).not.toHaveBeenCalled();
});
