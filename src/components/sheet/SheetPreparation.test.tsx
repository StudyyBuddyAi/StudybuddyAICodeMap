import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LazyMotion, domAnimation } from "motion/react";
import SheetPreparation from "./SheetPreparation";
import type { GenerationStatus } from "@/components/SheetProgress";
import type { SheetSectionSpec } from "@/types/generated-sheet";
import { modelUsedFrom } from "@/lib/model-used";

const PLAN: SheetSectionSpec[] = [
  { key: "moa", title: "Mechanism of Action", kind: "prose" },
  { key: "monitoring", title: "Monitoring", kind: "table", columns: ["Parameter", "Target", "When"] },
];

const prep = (status: GenerationStatus, plan: SheetSectionSpec[] | null = null, model?: string) =>
  render(
    <LazyMotion features={domAnimation}>
      <SheetPreparation
        input="Lithium"
        status={status}
        plan={plan}
        model={model ? modelUsedFrom(model, false) : undefined}
      />
    </LazyMotion>
  );

describe("SheetPreparation", () => {
  it("starts with the topic and the library in progress, and a question about the topic", () => {
    prep({ planned: false, sources: "pending" });
    expect(screen.getByText("Working out what kind of topic this is")).toBeInTheDocument();
    expect(screen.getByText("Searching the guideline library")).toBeInTheDocument();
    expect(screen.getByText(/What do you already know about Lithium\?/)).toBeInTheDocument();
  });

  it("says what the topic was read as, and asks about the first planned section", () => {
    prep({ planned: true, sources: "pending", archetype: "drug" }, PLAN);
    expect(screen.getByText("Read Lithium as a drug")).toBeInTheDocument();
    expect(screen.getByText("Sections: Mechanism of Action · Monitoring")).toBeInTheDocument();
    expect(screen.getByText(/How does Lithium work/)).toBeInTheDocument();
  });

  it("names the passages found and the books they came from", () => {
    prep({ planned: true, sources: 3, books: ["BAP Bipolar Disorder Guideline"], archetype: "drug" }, PLAN);
    expect(screen.getByText("Found 3 guideline passages")).toBeInTheDocument();
    expect(screen.getByText("BAP Bipolar Disorder Guideline")).toBeInTheDocument();
  });

  it("is honest when the library had nothing, or was switched off", () => {
    const { unmount } = prep({ planned: true, sources: 0 }, PLAN);
    expect(screen.getByText("Nothing close in the library")).toBeInTheDocument();
    unmount();
    prep({ planned: true, sources: "off" }, PLAN);
    expect(screen.getByText("Guideline library off for this sheet")).toBeInTheDocument();
  });

  it("says who is writing, and when it is thinking", () => {
    prep(
      { planned: true, sources: 3, archetype: "drug", writing: true, thinking: true },
      PLAN,
      "openrouter/openai/gpt-oss-20b"
    );
    expect(screen.getByText("Thinking it through before writing")).toBeInTheDocument();
    expect(screen.getByText("GPT-OSS 20B is writing this sheet.")).toBeInTheDocument();
  });
});
