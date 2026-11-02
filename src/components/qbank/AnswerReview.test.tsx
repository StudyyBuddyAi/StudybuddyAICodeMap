import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Question } from "@/lib/qbank-types";

// The review's two networked children are not what this tests.
vi.mock("./FullExplanation", () => ({ default: () => null }));
vi.mock("./ReportQuestion", () => ({ default: () => null }));

import AnswerReview from "./AnswerReview";

const question = {
  id: "q1",
  subject: "Cardiovascular",
  domain: "Pharmacology",
  topic: "Benzodiazepines",
  question_text: "Which mechanism?",
  option_a: "Frequency of opening",
  option_b: "Duration of opening",
  option_c: "Direct opening",
  option_d: "Reuptake block",
  option_e: "Transaminase block",
  correct_option: "a",
  explanation: "Benzodiazepines raise the **frequency** of opening.",
  media: [],
} as unknown as Question;

const renderReview = (q: Question) =>
  render(<AnswerReview question={q} correct="a" selected="b" onOpenMedia={() => {}} />);

describe("AnswerReview", () => {
  it("tells the student a withdrawn question's answer is not to be relied on", () => {
    renderReview({ ...question, withdrawn: true });
    expect(screen.getByRole("note")).toHaveTextContent("Withdrawn after review");
  });

  it("says nothing of the kind for a question in good standing", () => {
    renderReview(question);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByText(/The correct answer is/)).toBeInTheDocument();
  });
});
