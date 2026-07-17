import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Game } from "../src/domain/types";
import { CatalogPage } from "../src/pages/CatalogPage";

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
    render(<CatalogPage assets={{}} games={[game]} />);

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
    render(<CatalogPage assets={{}} games={[game]} />);

    const summary = screen.getByText("Статус").closest("summary")!;
    const dropdown = summary.closest("details")!;
    const search = screen.getByRole("searchbox", { name: "Поиск игр" });

    await user.click(summary);
    await user.click(search);
    expect(dropdown).not.toHaveAttribute("open");

    await user.click(summary);
    search.focus();
    expect(dropdown).not.toHaveAttribute("open");
  });
});
