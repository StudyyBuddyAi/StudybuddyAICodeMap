import { describe, it, expect, beforeAll } from "vitest";
import { act, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import OutputSection from "./OutputSection";
import type { GeneratedSheet } from "@/types/generated-sheet";

// jsdom has no layout, so the scroll-on-new-sheet effect needs a stub.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

/**
 * SaveButton reads study history through react-query, and its useAuth resolves a
 * session one microtask after mount. Awaiting inside act() lets that settle before
 * the assertions run, so the state update isn't reported as unwrapped.
 */
async function renderSheet(ui: React.ReactElement): Promise<RenderResult> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let result!: RenderResult;
  await act(async () => {
    result = render(
      // OutputSection calls useNavigate (section actions route out to Flashcards),
      // so it needs router context even though these tests never navigate.
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  });
  return result;
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
  it("lays out every section from the first frame", async () => {
    // The layout must not change shape as content lands, so all seven slots
    // exist even before anything has streamed.
    await renderSheet(
      <OutputSection output={JSON.stringify(SHEET)} isStreaming streamedKeys={[]} />
    );

    for (const name of Object.values(HEADING)) {
      expect(heading(name)).toBeInTheDocument();
    }
  });

  it("shows content only for sections that finished streaming", async () => {
    await renderSheet(
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

  it("marks exactly one section as being written", async () => {
    await renderSheet(
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

  it("offers per-section actions only once a section has landed", async () => {
    await renderSheet(
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

  it("disables Save while streaming so a partial sheet can't be persisted", async () => {
    await renderSheet(
      <OutputSection output={JSON.stringify(SHEET)} isStreaming streamedKeys={["overview"]} />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("renders every section as ready once streaming ends", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    for (const name of Object.values(HEADING)) {
      expect(heading(name)).toBeInTheDocument();
    }
    expect(screen.getAllByLabelText("Section loaded")).toHaveLength(7);
    expect(screen.queryByLabelText("Writing section")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Waiting")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("resets Save for a new generation without resetting during updates", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let result!: RenderResult;
    await act(async () => {
      result = render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <OutputSection
              output={JSON.stringify(SHEET)}
              inputText="Heart failure"
              generationId={1}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    expect(screen.getByRole("button", { name: /saved/i })).toBeDisabled();

    await act(async () => {
      result.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <OutputSection
              output={JSON.stringify({ ...SHEET, overview: "Updated overview" })}
              inputText="Heart failure"
              generationId={1}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });
    expect(screen.getByRole("button", { name: /saved/i })).toBeDisabled();

    await act(async () => {
      result.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <OutputSection
              output={JSON.stringify({ ...SHEET, topic: "Asthma" })}
              inputText="Asthma"
              generationId={2}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("clears enhancements from the previous sheet on a new generation", async () => {
    const previousSheet: GeneratedSheet = {
      ...SHEET,
      enhancements: {
        "expand:reduced output": {
          mode: "expand",
          sourceText: "reduced output",
          result: "Previous topic expansion",
          createdAt: new Date().toISOString(),
        },
      },
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let result!: RenderResult;
    await act(async () => {
      result = render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <OutputSection
              output={JSON.stringify(previousSheet)}
              generationId={1}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });
    expect(document.querySelector('[title="Re-open enhancement"]')).toBeInTheDocument();

    await act(async () => {
      result.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <OutputSection output={JSON.stringify(SHEET)} generationId={2} />
          </MemoryRouter>
        </QueryClientProvider>
      );
    });
    expect(document.querySelector('[title="Re-open enhancement"]')).not.toBeInTheDocument();
    expect(screen.queryByText("Previous topic expansion")).not.toBeInTheDocument();
  });

  it("survives a partial sheet whose later fields are still empty", async () => {
    const partial: GeneratedSheet = {
      ...SHEET,
      clinicalApproach: "",
      keyPoints: [],
      examTraps: [],
      flashcards: [],
      referenceNote: "",
    };
    // Rejects rather than throws now that the render is awaited, but a render or
    // effect error still fails the test.
    await expect(
      renderSheet(
        <OutputSection
          output={JSON.stringify(partial)}
          isStreaming
          streamedKeys={["overview", "memoryHooks"]}
        />
      )
    ).resolves.toBeTruthy();
  });
});
