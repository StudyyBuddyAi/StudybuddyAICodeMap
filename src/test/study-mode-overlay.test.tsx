import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StudyMode from "@/components/StudyMode";
import type { Card } from "@/hooks/use-flashcard-deck";

/**
 * Stage 3b: StudyMode was a bare `fixed inset-0` div — no focus trap, so Tab
 * walked straight out into the page behind it, and no focus restore on close.
 *
 * Note on the migration's risk: the plan warned that a Radix swap would discard
 * mid-review progress. It does not, because Library already renders StudyMode
 * conditionally (`{studyOpen && …}`) — closing has always unmounted it and
 * ended the session. Unmount-on-close is the existing contract, not a
 * regression. What these tests pin is that closing still works from every
 * affordance, and that focus is handled.
 */

const cards: Card[] = [1, 2, 3].map((n) => ({
  id: `c${n}`,
  question: `Q${n}`,
  answer: `A${n}`,
  tag: "Next Step",
  topic: "Cardiology",
  grounded: false,
  createdAt: Date.now(),
  interval: 0,
  dueAt: Date.now(),
  lastReviewed: null,
  reviewCount: 0,
}));

const renderStudyMode = async (onClose = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <StudyMode dueCards={cards} onReview={vi.fn()} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
  return onClose;
};

describe("StudyMode overlay semantics", () => {
  it("exposes itself as a dialog and marks the page behind it hidden", async () => {
    await renderStudyMode();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-state", "open");

    // This Radix version expresses modality by hiding siblings from assistive
    // tech rather than by setting aria-modal on the content itself, so assert
    // the behaviour rather than the attribute.
    const siblings = Array.from(document.body.children).filter(
      (el) => !el.contains(dialog)
    );
    expect(siblings.some((el) => el.getAttribute("aria-hidden") === "true")).toBe(
      true
    );
  });

  it("has an accessible name and description", async () => {
    await renderStudyMode();
    expect(screen.getByRole("dialog")).toHaveAccessibleName(/flashcard review/i);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(/due flashcards/i);
  });

  it("closes on Escape", async () => {
    const onClose = await renderStudyMode();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes from the dialog's own close button", async () => {
    const onClose = await renderStudyMode();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("moves focus into the dialog rather than leaving it on the page", async () => {
    await renderStudyMode();
    await waitFor(() => {
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });
  });

  it("starts every session at the first card", async () => {
    await renderStudyMode();
    expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();
  });
});
