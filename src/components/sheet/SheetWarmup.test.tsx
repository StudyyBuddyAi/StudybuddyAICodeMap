import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SheetWarmup from "./SheetWarmup";
import type { WarmupQuestion } from "@/lib/sheet-outline";

const questions: WarmupQuestion[] = [
  {
    q: "Jaundice in the first 24 hours of life is…",
    options: ["Physiologic", "Pathologic until proven otherwise", "Breast-milk jaundice"],
    answer: 1,
    why: "Early jaundice means haemolysis until proven otherwise.",
    block: "Jaundice",
  },
  {
    q: "Surfactant deficiency mainly affects…",
    options: ["Post-term infants", "Preterm infants", "Infants of any age", "Infants born by C-section"],
    answer: 1,
    why: "Type II pneumocytes make enough surfactant only from about 34 weeks.",
  },
];

const setup = (over: Partial<React.ComponentProps<typeof SheetWarmup>> = {}) => {
  const props = {
    questions,
    keyForBlock: (title: string) => (title === "Jaundice" ? "part3" : undefined),
    sectionReady: () => false,
    onJump: vi.fn(),
    onClose: vi.fn(),
    onTouched: vi.fn(),
    ...over,
  };
  render(<SheetWarmup {...props} />);
  return props;
};

describe("SheetWarmup", () => {
  it("asks the first question, and on an answer says why and which block answers it", () => {
    const props = setup();
    expect(screen.getByText("Warm-up · 1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Physiologic/ }));
    expect(screen.getByText("Not quite.")).toBeInTheDocument();
    expect(screen.getByText(/haemolysis until proven otherwise/)).toBeInTheDocument();
    // The block hasn't landed yet, so it is named, not linked.
    expect(screen.getByText("Coming up in Jaundice")).toBeInTheDocument();
    expect(props.onTouched).toHaveBeenCalled();
  });

  it("links to the block once it has landed", () => {
    const props = setup({ sectionReady: (key) => key === "part3" });
    fireEvent.click(screen.getByRole("button", { name: /Pathologic/ }));
    expect(screen.getByText("Right.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Read it in Jaundice/ }));
    expect(props.onJump).toHaveBeenCalledWith("part3");
  });

  it("answers from the keyboard, moves on with Enter, and ends with the score", () => {
    setup();
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByText("Right.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("Warm-up · 2 of 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText(/Warm-up done · 1 of 2 right/)).toBeInTheDocument();
  });

  it("leaves keys alone while the student is typing elsewhere", () => {
    render(<input aria-label="Ask" />);
    setup();
    fireEvent.keyDown(screen.getByLabelText("Ask"), { key: "2" });
    expect(screen.queryByText("Right.")).not.toBeInTheDocument();
  });

  it("asks the same questions as a check after reading, pointing back up at the block", () => {
    const props = setup({ mode: "check", sectionReady: () => true });
    expect(screen.getByText("Quick check · 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/Answer from what you just read/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pathologic/ }));
    fireEvent.click(screen.getByRole("button", { name: /See it in Jaundice/ }));
    expect(props.onJump).toHaveBeenCalledWith("part3");
  });

  it("can be skipped", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
