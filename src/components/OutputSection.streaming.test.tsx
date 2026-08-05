import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OutputSection from "./OutputSection";
import type { GeneratedSheet } from "@/types/generated-sheet";

// jsdom has no layout, so the scroll-on-new-sheet effect needs a stub.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

/** SaveButton reads study history through react-query. */
function renderSheet(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const SHEET: GeneratedSheet = {
  topicEmoji: "*",
  topic: "Heart Failure",
  overview: "Mechanism: reduced output",
  memoryHooks: ["FACES"],
  clinicalApproach: "Diagnosis: echo",
  keyPoints: ["If S3 then volume overload"],
  examTraps: ["HFpEF is not HFrEF"],
  flashcards: [{ tag: "Next Step", question: "What next?", answer: "Start an ACEi." }],
  referenceNote: "Standard references.",
};

/** Matched on the heading text, so the config's emoji prefixes don't matter. */
const HEADING = {
  overview: /Overview/,
  memoryHooks: /Memory Hooks/,
  clinicalApproach: /Clinical Approach/,
  keyPoints: /Key Points/,
  examTraps: /Exam Traps/,
  flashcards: /Flashcards/,
  referenceNote: /Reference Note/,
};

const heading = (name: RegExp) => screen.queryByRole("heading", { name });

describe("OutputSection streaming", () => {
  it("renders only the sections that have finished streaming", () => {
    renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["topicEmoji", "topic", "overview", "memoryHooks"]}
      />
    );

    expect(heading(HEADING.overview)).toBeInTheDocument();
    expect(heading(HEADING.memoryHooks)).toBeInTheDocument();
    // Present in the object but not yet marked complete — must stay hidden.
    expect(heading(HEADING.clinicalApproach)).not.toBeInTheDocument();
    expect(heading(HEADING.examTraps)).not.toBeInTheDocument();
    expect(heading(HEADING.flashcards)).not.toBeInTheDocument();
  });

  it("disables Save while streaming so a partial sheet can't be persisted", () => {
    renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["overview"]}
      />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("renders every section and enables Save once streaming ends", () => {
    renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    for (const name of Object.values(HEADING)) {
      expect(heading(name)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("survives a partial sheet whose later fields are still empty", () => {
    const partial: GeneratedSheet = {
      ...SHEET,
      clinicalApproach: "",
      keyPoints: [],
      examTraps: [],
      flashcards: [],
      referenceNote: "",
    };
    expect(() =>
      renderSheet(
        <OutputSection
          output={JSON.stringify(partial)}
          isStreaming
          streamedKeys={["overview", "memoryHooks"]}
        />
      )
    ).not.toThrow();
  });
});
