import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Flashcards from "@/pages/Flashcards";

/**
 * The flip card carried `role="button"` on a plain <div> with no `tabIndex` and
 * no `onKeyDown` — it announced a control that could be neither reached nor
 * activated from the keyboard. Spaced repetition is the product's core loop, so
 * that made the central feature mouse-only.
 */

const STORAGE_KEY = "studybuddy_decks_v1";
const MOUNT_HEAVY_TIMEOUT_MS = 20_000;

const card = {
  id: "card-1",
  question: "Which artery is occluded?",
  answer: "The right coronary artery.",
  tag: "Next Step",
  topic: "Cardiology",
  grounded: false,
  createdAt: Date.now(),
  interval: 0,
  dueAt: Date.now(),
  lastReviewed: null,
  reviewCount: 0,
};

beforeEach(() => localStorage.setItem(STORAGE_KEY, JSON.stringify([card])));
afterEach(() => localStorage.clear());

const startSession = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Flashcards />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: /^review$/i })[0]);
  });
};

/** The card itself, as distinct from the separate "Show Answer" button. */
const flipCard = () =>
  screen
    .getAllByRole("button", { name: /show (answer|question)/i })
    .find((el) => el.tagName !== "BUTTON")!;

describe("flashcard keyboard operation", () => {
  it("puts the flip card in the tab order", async () => {
    await startSession();
    expect(flipCard()).toHaveAttribute("tabindex", "0");
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it("flips on Enter", async () => {
    await startSession();
    expect(flipCard()).toHaveAttribute("aria-label", "Show answer");

    await act(async () => {
      fireEvent.keyDown(flipCard(), { key: "Enter" });
    });

    await waitFor(() =>
      expect(flipCard()).toHaveAttribute("aria-label", "Show question")
    );
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it("flips on Space", async () => {
    await startSession();

    await act(async () => {
      fireEvent.keyDown(flipCard(), { key: " " });
    });

    await waitFor(() =>
      expect(flipCard()).toHaveAttribute("aria-label", "Show question")
    );
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it("ignores keys that are not activation keys", async () => {
    await startSession();

    await act(async () => {
      fireEvent.keyDown(flipCard(), { key: "a" });
    });

    expect(flipCard()).toHaveAttribute("aria-label", "Show answer");
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
