import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import DealingTable, { type DealtCard } from "./DealingTable";
import { EXAM_THEME } from "@/lib/qbank-exam-theme";

const dealt = (n: number, topic = "DKA"): DealtCard[] =>
  Array.from({ length: n }, (_, i) => ({
    question: `Question ${i + 1}?`,
    answer: "A.",
    tag: "Mechanism",
    topic,
    grounded: false,
    seq: i,
  }));

describe("DealingTable", () => {
  it("lays out a slot for every card and fills them as cards land", () => {
    render(
      <DealingTable cards={dealt(3)} total={12} topics={["DKA"]} theme={EXAM_THEME.step1} status="writing" onCancel={vi.fn()} />
    );
    const table = screen.getByRole("list", { name: "Cards written so far" });
    expect(table.children).toHaveLength(12);
    expect(within(table).getAllByText(/^Question \d+\?$/)).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("3 of 12 written");
  });

  it("stops on request, and names each topic on a mixed deck", () => {
    const onCancel = vi.fn();
    render(
      <DealingTable
        cards={[...dealt(1, "Asthma"), { ...dealt(1, "COPD")[0], seq: 1 }]}
        total={6}
        topics={["Asthma", "COPD"]}
        theme={EXAM_THEME.step2ck}
        status="writing"
        onCancel={onCancel}
      />
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Writing 6 cards on 2 topics");
    expect(screen.getByText("COPD")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("says when the deck is dealt, with nothing left to stop", () => {
    render(<DealingTable cards={dealt(5)} total={5} topics={["DKA"]} theme={EXAM_THEME.mixed} status="done" onCancel={vi.fn()} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Dealt — your review starts now");
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
