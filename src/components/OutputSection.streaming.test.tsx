import { describe, it, expect, beforeAll } from "vitest";
import { act, render, screen, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
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
        <MemoryRouter>
          <AuthProvider>{ui}</AuthProvider>
        </MemoryRouter>
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

  it("shows the draft of the section in flight when the caller names it", async () => {
    await renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["overview", "memoryHooks"]}
        liveKey="clinicalApproach"
      />
    );

    // The section being written shows what has arrived of it so far...
    expect(sectionText("clinicalApproach")).toContain("Diagnosis: echo");
    expect(screen.getAllByLabelText("Writing section")).toHaveLength(1);
    // ...but it isn't finished, so it offers no actions yet...
    expect(screen.getAllByLabelText("Section loaded")).toHaveLength(2);
    // ...and sections after it still wait.
    expect(sectionText("examTraps")).not.toContain("HFpEF is not HFrEF");
  });

  it("keeps the skeleton while the in-flight section has no words yet", async () => {
    await renderSheet(
      <OutputSection
        output={JSON.stringify({ ...SHEET, clinicalApproach: "" })}
        isStreaming
        streamedKeys={["overview", "memoryHooks"]}
        liveKey="clinicalApproach"
      />
    );
    expect(sectionText("clinicalApproach")).toBe("Clinical Approach");
  });

  it("reports generation progress in the sticky bar while streaming", async () => {
    await renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        isStreaming
        streamedKeys={["overview", "memoryHooks"]}
        liveKey="clinicalApproach"
        generationStatus={{ planned: true, sources: 4 }}
      />
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Writing Clinical Approach");
    expect(status).toHaveTextContent("4 sources");
    // Six sections are counted (flashcards arrive separately); two are done.
    expect(status).toHaveTextContent("2/6");
    expect(screen.queryByText(/Highlight any text/)).not.toBeInTheDocument();
  });

  it("shows the highlight hint, not progress, for a sheet that isn't generating", async () => {
    await renderSheet(
      <OutputSection
        output={JSON.stringify(SHEET)}
        generationStatus={{ planned: true, sources: "off" }}
      />
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(/Highlight any text/)).toBeInTheDocument();
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

describe("OutputSection recall checks", () => {
  const WITH_DECK: GeneratedSheet = {
    ...SHEET,
    clinicalApproach:
      "Diagnosis: **BNP** first, then **echocardiography** to measure ejection fraction.",
    flashcards: [
      {
        tag: "Next Step",
        question: "Suspected heart failure: which blood test comes first?",
        answer: "BNP, then echocardiography to measure the ejection fraction.",
      },
    ],
  };

  it("asks a question under the section it tests, answer hidden", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(WITH_DECK)} />);

    const section = document.querySelector('[data-section-key="clinicalApproach"]')!;
    expect(section.textContent).toContain("Check yourself");
    expect(section.textContent).toContain("which blood test comes first?");
    const answer = section.querySelector(".recall-answer")!;
    expect(answer).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      screen.getByRole("button", { name: /show answer/i }).click();
    });
    expect(answer).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("button", { name: /hide/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("holds the questions back until the sheet has finished", async () => {
    await renderSheet(
      <OutputSection
        output={JSON.stringify(WITH_DECK)}
        isStreaming
        streamedKeys={["overview", "memoryHooks", "clinicalApproach"]}
      />
    );
    expect(screen.queryByText("Check yourself")).not.toBeInTheDocument();
  });
});

describe("OutputSection section plan", () => {
  /** A drug sheet: sections a disease template has no name for. */
  const PLANNED: GeneratedSheet = {
    topic: "Warfarin",
    plan: [
      { key: "moa", title: "Mechanism of Action", kind: "prose", icon: "drug" },
      { key: "monitoring", title: "Monitoring", kind: "list", icon: "data" },
      { key: "reversal", title: "Reversal", kind: "prose" },
    ],
    sections: {
      moa: "Inhibits **vitamin K epoxide reductase**.",
      monitoring: ["INR 2-3 for most indications", "Recheck at 3 days"],
      reversal: "Vitamin K plus **four-factor PCC** for major bleeding.",
    },
    overview: "",
    memoryHooks: [],
    clinicalApproach: "",
    keyPoints: [],
    examTraps: [],
    flashcards: [],
    referenceNote: "General knowledge.",
  };

  it("lays the document out from the plan, not the legacy six", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(PLANNED)} />);

    expect(heading(/Mechanism of Action/)).toBeInTheDocument();
    expect(heading(/Monitoring/)).toBeInTheDocument();
    expect(heading(/Reversal/)).toBeInTheDocument();
    // The legacy sections are not in this plan, so they must not appear.
    expect(heading(/Memory Hooks/)).not.toBeInTheDocument();
    expect(heading(/Clinical Approach/)).not.toBeInTheDocument();
    expect(heading(/Exam Traps/)).not.toBeInTheDocument();
  });

  it("still appends flashcards and the reference note", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(PLANNED)} />);
    expect(heading(/Flashcards/)).toBeInTheDocument();
    expect(heading(/Reference Note/)).toBeInTheDocument();
  });

  it("renders each section by its declared kind", async () => {
    await renderSheet(<OutputSection output={JSON.stringify(PLANNED)} />);

    expect(sectionText("moa")).toContain("vitamin K epoxide reductase");
    // A list section numbers its items; a prose one does not.
    expect(sectionText("monitoring")).toContain("INR 2-3 for most indications");
    expect(sectionText("monitoring")).toContain("Recheck at 3 days");
    expect(sectionText("reversal")).toContain("four-factor PCC");
  });

  it("falls back to the legacy layout when no plan arrived", async () => {
    // An edge function that predates the plan frame sends no plan at all; the
    // sheet must render exactly as it always did rather than render nothing.
    await renderSheet(<OutputSection output={JSON.stringify(SHEET)} />);

    for (const name of Object.values(HEADING)) {
      expect(heading(name)).toBeInTheDocument();
    }
  });

  it("tracks the in-flight section against the plan's own order", async () => {
    await renderSheet(
      <OutputSection output={JSON.stringify(PLANNED)} isStreaming streamedKeys={["moa"]} />
    );

    expect(screen.getAllByLabelText("Section loaded")).toHaveLength(1);
    // monitoring is next in the plan, so it is the one being written.
    expect(screen.getAllByLabelText("Writing section")).toHaveLength(1);
  });
});
