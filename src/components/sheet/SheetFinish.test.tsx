import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LazyMotion, domAnimation } from "motion/react";
import SheetFinish, { type SheetDeck } from "./SheetFinish";

const finish = (deck: SheetDeck | null, handlers = {}) =>
  render(
    <LazyMotion features={domAnimation}>
      <SheetFinish
        topic="Lithium"
        deck={deck}
        onPractice={vi.fn()}
        onExport={vi.fn()}
        onShare={vi.fn()}
        onNewSheet={vi.fn()}
        {...handlers}
      />
    </LazyMotion>
  );

describe("SheetFinish", () => {
  it("offers to keep the sheet's own deck, by count", () => {
    const onSave = vi.fn();
    finish({ count: 3, saved: false, onSave, onReview: vi.fn() });
    screen.getByRole("button", { name: "Add 3 cards to my deck" }).click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("points at the deck once it is kept", () => {
    const onReview = vi.fn();
    finish({ count: 3, saved: true, onSave: vi.fn(), onReview });
    screen.getByRole("button", { name: /In your deck/ }).click();
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("still offers practice and the rest without a deck", () => {
    const onNewSheet = vi.fn();
    finish(null, { onNewSheet });
    expect(screen.queryByRole("button", { name: /deck/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Practice QBank/ })).toBeInTheDocument();
    screen.getByRole("button", { name: /New sheet/ }).click();
    expect(onNewSheet).toHaveBeenCalledOnce();
  });

  it("writes a full deck from the sheet, then points at it", () => {
    const onWrite = vi.fn();
    const { rerender } = finish(null, { fullDeck: { status: "idle", count: 0, onWrite, onReview: vi.fn() } });
    screen.getByRole("button", { name: "Write a full deck from this sheet" }).click();
    expect(onWrite).toHaveBeenCalledOnce();

    rerender(
      <LazyMotion features={domAnimation}>
        <SheetFinish
          topic="Lithium"
          deck={null}
          fullDeck={{ status: "writing", count: 0, onWrite, onReview: vi.fn() }}
          onPractice={vi.fn()}
          onExport={vi.fn()}
          onShare={vi.fn()}
          onNewSheet={vi.fn()}
        />
      </LazyMotion>
    );
    expect(screen.getByRole("button", { name: /Writing cards from your sheet/ })).toBeDisabled();
  });

  it("says how many cards the full deck added", async () => {
    const onReview = vi.fn();
    finish(null, { fullDeck: { status: "done", count: 18, onWrite: vi.fn(), onReview } });
    (await screen.findByRole("button", { name: "18 cards from your sheet · Review" })).click();
    expect(onReview).toHaveBeenCalledOnce();
  });
});
