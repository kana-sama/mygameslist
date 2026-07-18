import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalGameSearch } from "../src/components/GlobalGameSearch";
import type { Game } from "../src/domain/types";

const DATE = "2026-07-18T10:00:00.000Z";

function game(id: string, title: string): Game {
  return {
    id,
    title,
    coverAssetId: null,
    platforms: ["SNES"],
    tags: ["platformer"],
    status: "played",
    placement: { tierId: "a", rank: 1024 },
    reviewMarkdown: "",
    createdAt: DATE,
    updatedAt: DATE,
  };
}

const marioKart = game("11111111-1111-4111-8111-111111111111", "Mario Kart");
const marioWorld = game("22222222-2222-4222-8222-222222222222", "Super Mario World");
const zelda = game("33333333-3333-4333-8333-333333333333", "The Legend of Zelda");
const lostVikings = game("44444444-4444-4444-8444-444444444444", "The Lost Vikings");
const lostLevels = game("55555555-5555-4555-8555-555555555555", "Super Mario Bros.: The Lost Levels");
const metalGearSolid = game("66666666-6666-4666-8666-666666666666", "Metal Gear Solid");

beforeEach(() => { window.location.hash = "#/"; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("global game search keyboard routing", () => {
  it("opens the only matching game on Enter", () => {
    const onNavigate = vi.fn();
    render(<GlobalGameSearch games={[marioKart, marioWorld, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    fireEvent.change(input, { target: { value: "Zelda" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onNavigate).toHaveBeenCalledWith(`#/games/${zelda.id}`);
  });

  it("opens the only fuzzy match entered in the wrong keyboard layout", () => {
    const onNavigate = vi.fn();
    render(<GlobalGameSearch games={[marioKart, marioWorld, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    fireEvent.change(input, { target: { value: "яудвф" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onNavigate).toHaveBeenCalledWith(`#/games/${zelda.id}`);
  });

  it("opens the filtered catalog when several games match and none is selected", () => {
    const onNavigate = vi.fn();
    render(<GlobalGameSearch games={[marioKart, marioWorld, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    fireEvent.change(input, { target: { value: "Mario" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onNavigate).toHaveBeenCalledWith("#/games?q=Mario");
  });

  it("opens the keyboard-selected game even when several games match", () => {
    const onNavigate = vi.fn();
    render(<GlobalGameSearch games={[marioWorld, marioKart, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    fireEvent.change(input, { target: { value: "Mario" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onNavigate).toHaveBeenCalledWith(`#/games/${marioKart.id}`);
  });

  it("opens the catalog when a short fuzzy query matches several games", () => {
    const onNavigate = vi.fn();
    render(<GlobalGameSearch games={[lostVikings, lostLevels, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    input.focus();
    fireEvent.change(input, { target: { value: "lst" } });

    expect(screen.getByRole("option", { name: /The Lost Vikings/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /The Lost Levels/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("#/games?q=lst");
  });

  it("opens a game found by its title initials", () => {
    const onNavigate = vi.fn();
    render(<GlobalGameSearch games={[metalGearSolid, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    fireEvent.change(input, { target: { value: "mgs" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onNavigate).toHaveBeenCalledWith(`#/games/${metalGearSolid.id}`);
  });

  it("reopens the hidden results when typing after navigating to a game", () => {
    const onNavigate = vi.fn((href: string) => { window.location.hash = href; });
    render(<GlobalGameSearch games={[marioKart, marioWorld, zelda]} onNavigate={onNavigate} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    input.focus();
    fireEvent.change(input, { target: { value: "Zelda" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(input, { target: { value: "Mario" } });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("uses the catalog itself as results and opens only the filter panel", () => {
    window.location.hash = "#/games?q=Mario";
    render(<GlobalGameSearch games={[marioKart, marioWorld, zelda]} />);

    const input = screen.getByRole("searchbox", { name: "Глобальный поиск игр" });
    expect(input).toHaveValue("Mario");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
    expect(screen.getByRole("dialog", { name: "Фильтры каталога" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the entire search panel with the explicit close button", async () => {
    const user = userEvent.setup();
    render(<GlobalGameSearch games={[marioKart, marioWorld, zelda]} />);
    const input = screen.getByRole("combobox", { name: "Глобальный поиск игр" });

    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Закрыть поиск" }));

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
