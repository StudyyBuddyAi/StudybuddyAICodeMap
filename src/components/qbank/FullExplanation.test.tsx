import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Question } from "@/lib/qbank-types";

let hookValue: Record<string, unknown>;
vi.mock("@/hooks/use-full-explanation", () => ({ useFullExplanation: () => hookValue }));

import FullExplanation from "./FullExplanation";

const question = {
  id: "q1",
  option_a: "Amiodarone",
  option_b: "Metoprolol",
  option_c: "Diltiazem",
  option_d: "Lidocaine",
  option_e: "Sotalol",
} as unknown as Question;

const explained = {
  status: "explained",
  explanation: {
    bottomLine: "Amiodarone raises digoxin levels.",
    explanation: ["It inhibits **P-glycoprotein**.", "Halve the dose."],
    options: { a: "Correct: P-gp inhibition.", b: "No effect on levels." },
    table: { title: "Drugs and digoxin", columns: ["Drug", "Effect"], rows: [["Amiodarone", "Raises"], ["Lidocaine", "None"]] },
    algorithm: {
      title: "Suspected toxicity",
      steps: [{ text: "Check level" }, { text: "Unstable?", yes: "Digoxin Fab", no: "Supportive care" }, { text: "Monitor" }],
    },
    highYield: ["Xanthopsia means digoxin toxicity."],
  },
};

describe("FullExplanation", () => {
  beforeEach(() => {
    hookValue = { data: explained, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false };
  });

  it("shows the table, the algorithm and every option", () => {
    render(<FullExplanation question={question} correct="a" />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Effect" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Lidocaine" })).toBeInTheDocument();
    expect(screen.getByText("Unstable?").closest("li")).toHaveTextContent("Yes → Digoxin Fab");
    expect(screen.getByText("A. Amiodarone").closest("li")).toHaveAttribute("data-key", "correct");
    expect(screen.getByText("P-glycoprotein").tagName).toBe("STRONG");
  });

  it("folds away once read", () => {
    render(<FullExplanation question={question} correct="a" />);
    fireEvent.click(screen.getByRole("button", { name: /Full explanation/ }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says it is writing, and offers a retry on failure", () => {
    hookValue = { ...hookValue, data: undefined, isLoading: true };
    const { rerender } = render(<FullExplanation question={question} correct="a" />);
    expect(screen.getByRole("status")).toHaveTextContent("Writing the full explanation");

    const refetch = vi.fn();
    hookValue = { ...hookValue, isLoading: false, isError: true, refetch };
    rerender(<FullExplanation question={question} correct="a" />);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows nothing while a doubt about the key is reviewed", () => {
    hookValue = { ...hookValue, data: { status: "held" } };
    const { container } = render(<FullExplanation question={question} correct="a" />);
    expect(container).toBeEmptyDOMElement();
  });
});
