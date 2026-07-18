import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GlobalGameSearch } from "../src/components/GlobalGameSearch";
import type { Game } from "../src/domain/types";

const game: Game = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "DuckTales",
  coverAssetId: null,
  platforms: ["NES"],
  tags: ["platformer"],
  status: "playing",
  placement: { tierId: "a", rank: 1024 },
  reviewMarkdown: "",
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
};

describe("catalog filter dropdowns", () => {
  it("keeps a filter open when Safari reports no blur destination for an option click", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/games";
    render(<GlobalGameSearch games={[game]} />);

    await user.click(screen.getByRole("button", { name: "Фильтры" }));
    const summary = screen.getByText("Статус").closest("summary")!;
    const dropdown = summary.closest("details")!;
    const checkbox = screen.getByRole("checkbox", { name: "Играю" });
    const option = checkbox.closest("label")!;

    await user.click(summary);
    expect(dropdown).toHaveAttribute("open");

    fireEvent.blur(summary, { relatedTarget: null });
    await user.click(option);

    expect(checkbox).toBeChecked();
    expect(dropdown).toHaveAttribute("open");
  });

  it("closes an open filter when the pointer or keyboard focus leaves it", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/games";
    render(<GlobalGameSearch games={[game]} />);

    await user.click(screen.getByRole("button", { name: "Фильтры" }));
    const summary = screen.getByText("Статус").closest("summary")!;
    const dropdown = summary.closest("details")!;
    const tierSummary = screen.getByText("Тир").closest("summary")!;

    await user.click(summary);
    await user.click(tierSummary);
    expect(dropdown).not.toHaveAttribute("open");

    await user.click(summary);
    tierSummary.focus();
    expect(dropdown).not.toHaveAttribute("open");
  });
});
