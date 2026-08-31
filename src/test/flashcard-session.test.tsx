import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Flashcards from "@/pages/Flashcards";

/**
 * "Practice Again" on the session-complete screen used to call
 * `shuffleRemaining`, which shuffles `cards.slice(index + 1)` — always empty
 * once the session is finished. It fired a toast and left `done === true`, so
 * the screen never changed. This drives a real session to completion and then
 * asserts the button actually restarts it.
 */

const STORAGE_KEY = "studybuddy_decks_v1";

const card = (n: number) => ({
  id: `card-${n}`,
  question: `Question ${n}`,
  answer: `Answer ${n}`,
  tag: "Next Step",
  topic: "Cardiology",
  grounded: false,
  createdAt: Date.now(),
  interval: 0,
  dueAt: Date.now(),
  lastReviewed: null,
  reviewCount: 0,
});

const renderPage = async () => {
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
};

const clickText = async (label: RegExp) => {
  // Several buttons can share a label (the due-cards strip and a deck row both
  // say "Review"); the first is the one a user reaches first.
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: label })[0]);
  });
};

beforeEach(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([card(1), card(2)]));
});

afterEach(() => {
  localStorage.clear();
});

/**
 * Rate the visible card and wait for the next one to slide in.
 *
 * `handleRate` advances via a 150ms setTimeout. Driving that with fake timers
 * raced the async act() flush and made this suite intermittently fail under
 * parallel load, so we wait on the observable outcome instead.
 */
const rateCard = async () => {
  await clickText(/show answer/i);
  await clickText(/got it/i);
};

/**
 * Mounting /flashcards pulls in the generator, StudyMode, DeckList and the
 * grounding queries, which takes ~3-5s in jsdom and tips past the 5s default
 * when the suite runs in parallel. The budget is raised rather than the test
 * trimmed: driving a real session to completion is the point.
 */
const MOUNT_HEAVY_TIMEOUT_MS = 20_000;

describe("flashcard session restart", () => {
  it("reaches the completion screen after rating every card", async () => {
    await renderPage();
    await clickText(/^review$/i);

    await rateCard();
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    await rateCard();

    await waitFor(() =>
      expect(screen.getByText(/all cards reviewed/i)).toBeInTheDocument()
    );
  }, MOUNT_HEAVY_TIMEOUT_MS);

  it("restarts the session when 'Practice Again' is clicked", async () => {
    await renderPage();
    await clickText(/^review$/i);

    await rateCard();
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    await rateCard();
    await waitFor(() =>
      expect(screen.getByText(/all cards reviewed/i)).toBeInTheDocument()
    );

    await clickText(/practice again/i);

    // The completion screen must be gone and the deck back at card 1 of 2.
    expect(screen.queryByText(/all cards reviewed/i)).not.toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    // getAll, not get: the flip card itself carries role="button" alongside the
    // real "Show Answer" control (see audit finding #15).
    expect(
      screen.getAllByRole("button", { name: /show answer/i }).length
    ).toBeGreaterThan(0);
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
