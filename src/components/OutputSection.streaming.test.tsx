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

/**
 * Text of one section card. Read as a whole because the renderer splits a line
 * into separate spans for its label and its bold keywords.
 */
const sectionText = (key: string) =>
  document.querySelector(`[data-section-key="${key}"]`)?.textContent ?? "";

describe("OutputSection streaming", () => {
  it("lays out every section from the first frame", () => {
    // The layout must not change shape as content lands, so all seven slots
    // exist even before anything has streamed.
    renderSheet(
      <OutputSection output={JSON.stringify(SHEET)} isStreaming streamedKeys={[]} />
    );

    for (const name of Object.values(HEADING)) {
      expect(heading(name)).toBeInTheDocument();
    }
  });

  it("shows content only for sections that finished streaming", () => {
    renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["topicEmoji", "topic", "overview", "memoryHooks"]}
      />
    );

    expect(sectionText("overview")).toContain("Mechanism: reduced output");
    expect(sectionText("memoryHooks")).toContain("FACES");
    // Present in the sheet object, but not yet marked complete.
    expect(sectionText("clinicalApproach")).not.toContain("Diagnosis: echo");
    expect(sectionText("examTraps")).not.toContain("HFpEF is not HFrEF");
  });

  it("marks exactly one section as being written", () => {
    renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["overview", "memoryHooks"]}
      />
    );

    // clinicalApproach is next in order, so it is the one in flight.
    expect(screen.getAllByLabelText("Writing section")).toHaveLength(1);
    expect(screen.getAllByLabelText("Waiting").length).toBeGreaterThan(0);
  });

  it("offers per-section actions only once a section has landed", () => {
    renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["overview"]}
      />
    );

    // Two sections are ready in the finished sheet's terms, but only the one
    // that streamed should expose Copy / the loaded check.
    expect(screen.getAllByLabelText("Section loaded")).toHaveLength(1);
  });

  it("disables Save while streaming so a partial sheet can't be persisted", () => {
    renderSheet(
      <OutputSection output={JSON.stringify(SHEET)} isStreaming streamedKeys={["overview"]} />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("renders every section as ready once streaming ends", () => {
    renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    for (const name of Object.values(HEADING)) {
      expect(heading(name)).toBeInTheDocument();
    }
    expect(screen.getAllByLabelText("Section loaded")).toHaveLength(7);
    expect(screen.queryByLabelText("Writing section")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Waiting")).not.toBeInTheDocument();
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
