import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagInput } from "../src/components/TagInput";

describe("TagInput autocomplete", () => {
  it("adds an exact suggestion and dismisses its native popup immediately", () => {
    const onChange = vi.fn();
    render(
      <TagInput
        label="Платформы"
        onChange={onChange}
        suggestions={["NES", "Nintendo Switch", "PlayStation 5"]}
        values={["NES"]}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Платформы" });
    fireEvent.focus(input);
    expect(input).toHaveAttribute("list");

    fireEvent.change(input, { target: { value: "Nintendo Switch" } });

    expect(onChange).toHaveBeenCalledWith(["NES", "Nintendo Switch"]);
    expect(input).toHaveValue("");
    expect(input).not.toHaveAttribute("list");

    fireEvent.change(input, { target: { value: "Play" } });
    expect(input).toHaveAttribute("list");

    fireEvent.blur(input, { relatedTarget: document.body });
    expect(input).not.toHaveAttribute("list");
  });

  it("blurs the autocomplete before it is removed during navigation", () => {
    const { unmount } = render(
      <TagInput label="Платформы" onChange={vi.fn()} suggestions={["NES"]} values={[]} />,
    );
    const input = screen.getByRole("combobox", { name: "Платформы" }) as HTMLInputElement;
    const blur = vi.spyOn(input, "blur");

    fireEvent.focus(input);
    unmount();

    expect(blur).toHaveBeenCalledOnce();
  });
});
