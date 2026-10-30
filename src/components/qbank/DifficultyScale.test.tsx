import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DifficultyScale from "./DifficultyScale";

describe("DifficultyScale", () => {
  it("lays the levels out easier to harder, each saying where it sits", () => {
    render(<DifficultyScale value="balanced" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: /easier to harder/i });
    const steps = within(group).getAllByRole("radio");
    expect(steps.map((s) => s.textContent)).toEqual([
      expect.stringMatching(/^Foundations.*Easier/),
      expect.stringMatching(/^Balanced.*Exam level/),
      expect.stringMatching(/^Challenge.*Harder/),
    ]);
    expect(steps[1]).toHaveAttribute("aria-checked", "true");
    expect(steps[0]).toHaveAttribute("aria-checked", "false");
  });

  it("changes level on a tap", () => {
    const onChange = vi.fn();
    render(<DifficultyScale value="balanced" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /^Challenge/ }));
    expect(onChange).toHaveBeenCalledWith("challenge");
  });
});
