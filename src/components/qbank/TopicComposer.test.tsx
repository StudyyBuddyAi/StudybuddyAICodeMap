import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import TopicComposer from "./TopicComposer";
import type { TopicOption } from "@/lib/topic-suggest";

const OPTIONS: TopicOption[] = [
  { title: "Atrial Fibrillation & Flutter", systemName: "Cardiovascular", systemKey: "cardiovascular", source: "curriculum" },
  { title: "Diabetic Ketoacidosis & Hyperosmolar State", systemName: "Endocrinology", systemKey: "endocrine", source: "curriculum" },
  { title: "Human Development & Pediatrics", systemName: "Human Development & Pediatrics", systemKey: "peds_dev", source: "system" },
];

function Harness({ initial = [] as string[], max = 5, onSubmit = vi.fn(), onBrowse = vi.fn() }) {
  const [topics, setTopics] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  return (
    <>
      <TopicComposer
        topics={topics}
        onChange={setTopics}
        draft={draft}
        onDraftChange={setDraft}
        options={OPTIONS}
        max={max}
        onSubmit={onSubmit}
        onBrowse={onBrowse}
      />
      <output data-testid="topics">{topics.join("|")}</output>
    </>
  );
}

const input = () => screen.getByRole("combobox");
const chosen = () => screen.getByTestId("topics").textContent;

describe("TopicComposer", () => {
  it("turns typed text into a chip on Enter and on a comma", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "heart failure" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "nephrotic syndrome" } });
    fireEvent.keyDown(input(), { key: "," });
    expect(chosen()).toBe("heart failure|nephrotic syndrome");
    expect(input()).toHaveValue("");
  });

  it("takes the highlighted suggestion, found from an abbreviation", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "dka" } });
    expect(screen.getByRole("option", { name: /Diabetic Ketoacidosis/ })).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(chosen()).toBe("Diabetic Ketoacidosis & Hyperosmolar State");
  });

  it("splits a pasted list into chips", () => {
    render(<Harness />);
    fireEvent.paste(input(), { clipboardData: { getData: () => "asthma, COPD; pneumonia" } });
    expect(chosen()).toBe("asthma|COPD|pneumonia");
  });

  it("offers the fix for a typo", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "pediatrcs" } });
    fireEvent.click(screen.getByRole("button", { name: /all of Human Development & Pediatrics/i }));
    expect(chosen()).toBe("Human Development & Pediatrics");
  });

  it("refuses junk and duplicates, and stops at the limit", () => {
    render(<Harness initial={["asthma"]} max={2} />);
    fireEvent.change(input(), { target: { value: "hhhhhh" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(chosen()).toBe("asthma");

    fireEvent.change(input(), { target: { value: "Asthma" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(chosen()).toBe("asthma");

    fireEvent.change(input(), { target: { value: "sepsis" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(chosen()).toBe("asthma|sepsis");
    expect(input()).toBeDisabled();
  });

  it("removes the last chip on Backspace and starts the set on Enter when the box is empty", () => {
    const onSubmit = vi.fn();
    render(<Harness initial={["asthma", "sepsis"]} onSubmit={onSubmit} />);
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chosen()).toBe("asthma");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("removes a chip with its button", () => {
    render(<Harness initial={["asthma", "sepsis"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove asthma" }));
    expect(chosen()).toBe("sepsis");
  });
});
