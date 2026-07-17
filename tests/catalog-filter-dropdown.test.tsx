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
  it("stay open while focus moves inside and close when focus leaves", async () => {
    const user = userEvent.setup();
    render(<CatalogPage assets={{}} games={[game]} />);

    const summary = screen.getByText("Статус").closest("summary")!;
    const dropdown = summary.closest("details")!;
    const checkbox = screen.getByRole("checkbox", { name: "Играю" });
    const search = screen.getByRole("searchbox", { name: "Поиск игр" });

    await user.click(summary);
    expect(dropdown).toHaveAttribute("open");

    fireEvent.blur(summary, { relatedTarget: checkbox });
    expect(dropdown).toHaveAttribute("open");

    fireEvent.blur(checkbox, { relatedTarget: search });
    expect(dropdown).not.toHaveAttribute("open");
  });
});
