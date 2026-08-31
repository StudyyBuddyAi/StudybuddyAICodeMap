import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RatingButtons, { RATING_OPTIONS } from "@/components/RatingButtons";

/**
 * The three ratings were written twice with contradictory meanings: StudyMode
 * called `good` "Got it" in emerald, Flashcards called the same rating
 * "Almost" in amber — and then counted it as *Known*. One component now owns
 * the scale so /library and /flashcards cannot disagree again.
 */
describe("RatingButtons", () => {
  it("offers exactly the three spaced-repetition ratings", () => {
    render(<RatingButtons onRate={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(RATING_OPTIONS.map((o) => o.rating)).toEqual([
      "again",
      "good",
      "easy",
    ]);
  });

  it("maps each label to the rating it actually sends", () => {
    const onRate = vi.fn();
    render(<RatingButtons onRate={onRate} />);

    fireEvent.click(screen.getByRole("button", { name: /don't know/i }));
    expect(onRate).toHaveBeenLastCalledWith("again");

    fireEvent.click(screen.getByRole("button", { name: /almost/i }));
    expect(onRate).toHaveBeenLastCalledWith("good");

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(onRate).toHaveBeenLastCalledWith("easy");
  });

  it("takes colour from semantic tokens, not raw palette classes", () => {
    // The middle rating was amber in one screen and emerald in the other.
    const classes = RATING_OPTIONS.map((o) => o.className).join(" ");
    expect(classes).toMatch(/danger/);
    expect(classes).toMatch(/warning/);
    expect(classes).toMatch(/success/);
    expect(classes).not.toMatch(/-(red|emerald|amber|green)-[0-9]{3}/);
  });

  it("gives every rating an accessible name explaining what it does", () => {
    render(<RatingButtons onRate={vi.fn()} />);
    for (const { label, hint } of RATING_OPTIONS) {
      expect(
        screen.getByRole("button", { name: `${label} — ${hint}` })
      ).toBeInTheDocument();
    }
  });

  it("disables every rating when the session is busy", () => {
    render(<RatingButtons onRate={vi.fn()} disabled />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
