import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import InMemory from "./InMemory";
import { MEMORIAL } from "@/content/memorial";

const renderPage = () =>
  render(
    <MemoryRouter>
      <InMemory />
    </MemoryRouter>,
  );

const slideName = () => screen.getByRole("group").getAttribute("aria-label");

describe("InMemory", () => {
  // The deck holds still while a print is tucked away; let each move land
  // before the next by moving the clock a second on every read.
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1000));
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens on the first card, with the dedication above it", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(MEMORIAL.dedication);
    expect(slideName()).toBe(`1 of 3: ${MEMORIAL.cards[0].label}`);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("moves through the cards and goes round, by buttons and arrow keys", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(slideName()).toBe(`2 of 3: ${MEMORIAL.cards[1].label}`);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(slideName()).toBe(`3 of 3: ${MEMORIAL.cards[2].label}`);
    // After the last card comes the first again.
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(slideName()).toBe(`1 of 3: ${MEMORIAL.cards[0].label}`);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(slideName()).toBe(`3 of 3: ${MEMORIAL.cards[2].label}`);
  });

  it("shows the words for the top photo only, and the classmates' names with theirs", () => {
    renderPage();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "Their names" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(screen.getByRole("list", { name: "Their names" })).toBeInTheDocument();
  });

  it("marks a card's empty photo frame as a photo still to come", () => {
    renderPage();
    expect(screen.getByRole("img", { name: `${MEMORIAL.cards[0].label}: photo to come` })).toBeInTheDocument();
  });
});
