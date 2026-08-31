import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FlashcardsGenerator from "@/components/FlashcardsGenerator";

/**
 * The card-count chips are a single-select group driven by `cardCount`. Its
 * default used to be "12", which matches none of the offered options (5/10/20/30),
 * so the group rendered with nothing selected while generation silently used 12.
 * These tests pin the invariant rather than the specific default.
 */

const renderGenerator = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FlashcardsGenerator />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

/** The chips are the only `aria-pressed` buttons whose label reads "N cards". */
const cardCountChips = () =>
  screen
    .getAllByRole("button")
    .filter(
      (el) =>
        el.hasAttribute("aria-pressed") && /^\d+ cards/.test(el.textContent ?? "")
    );

describe("FlashcardsGenerator card-count selector", () => {
  it("renders exactly one selected chip on mount", () => {
    renderGenerator();

    const chips = cardCountChips();
    expect(chips.length).toBeGreaterThan(0);

    const selected = chips.filter(
      (el) => el.getAttribute("aria-pressed") === "true"
    );
    expect(selected).toHaveLength(1);
  });

  it("selects a count that is actually one of the offered options", () => {
    renderGenerator();

    const selected = cardCountChips().find(
      (el) => el.getAttribute("aria-pressed") === "true"
    );

    // Whatever the default becomes, it has to be a real option — that is the
    // property the original bug violated.
    expect(selected?.textContent).toMatch(/^\d+ cards/);
  });
});
